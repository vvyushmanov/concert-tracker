"""
Centralized HTTP client with session management, retries, and proxy support
"""

import random
import time
import urllib3
import requests
from typing import Optional, List
from requests.adapters import HTTPAdapter


class HTTPClient:
    """Shared HTTP client with session management, proxy rotation, and rate limiting"""
    
    # Default user agents for rotation
    DEFAULT_USER_AGENTS = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
    
    def __init__(
        self,
        timeout: int = 15,
        verify_ssl: bool = True,
        user_agents: Optional[List[str]] = None,
        proxy_manager = None,
        pool_connections: int = 1,
        pool_maxsize: int = 1
    ):
        """Initialize HTTP client
        
        Args:
            timeout: Request timeout in seconds
            verify_ssl: Whether to verify SSL certificates
            user_agents: List of user agents to rotate (uses defaults if None)
            proxy_manager: Optional ProxyManager instance for proxy rotation
            pool_connections: Number of connection pools
            pool_maxsize: Max connections per pool
        """
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.user_agents = user_agents or self.DEFAULT_USER_AGENTS
        self.proxy_manager = proxy_manager
        self.session = self._create_session(pool_connections, pool_maxsize)
        self._last_url = None
        
        # Disable SSL warnings if not verifying
        if not verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    def _create_session(self, pool_connections: int, pool_maxsize: int) -> requests.Session:
        """Create and configure requests session
        
        Args:
            pool_connections: Number of connection pools
            pool_maxsize: Max connections per pool
            
        Returns:
            Configured requests.Session
        """
        session = requests.Session()
        adapter = HTTPAdapter(pool_connections=pool_connections, pool_maxsize=pool_maxsize)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session
    
    def _get_headers(self, base_url: Optional[str] = None) -> dict:
        """Generate request headers with random user agent
        
        Args:
            base_url: Base URL for Referer header
            
        Returns:
            Dict of HTTP headers
        """
        headers = {
            'User-Agent': random.choice(self.user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,en-GB;q=0.8',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0',
        }
        
        # Add Referer if we have a last URL
        if self._last_url:
            headers['Referer'] = self._last_url
        elif base_url:
            headers['Referer'] = base_url
        
        return headers
    
    def get(
        self,
        url: str,
        max_retries: int = 3,
        headers: Optional[dict] = None,
        base_url: Optional[str] = None,
        **kwargs
    ) -> Optional[requests.Response]:
        """Perform GET request with retries and proxy rotation
        
        Args:
            url: URL to fetch
            max_retries: Maximum number of retry attempts
            headers: Optional custom headers (merged with default headers)
            base_url: Base URL for Referer header
            **kwargs: Additional arguments passed to requests.get
            
        Returns:
            Response object or None if all retries failed
        """
        for attempt in range(max_retries):
            try:
                # Get proxy if proxy manager is available
                proxy = None
                if self.proxy_manager:
                    proxy = self.proxy_manager.get_next_proxy()
                
                # Merge headers
                request_headers = self._get_headers(base_url)
                if headers:
                    request_headers.update(headers)
                
                # Make request
                response = self.session.get(
                    url,
                    timeout=self.timeout,
                    verify=self.verify_ssl,
                    headers=request_headers,
                    proxies=proxy,
                    allow_redirects=True,
                    **kwargs
                )
                response.raise_for_status()
                
                # Success - mark proxy as working
                if self.proxy_manager and proxy:
                    self.proxy_manager.mark_proxy_success(proxy)
                
                # Store URL for next request's Referer
                self._last_url = url
                
                return response
                
            except requests.RequestException as e:
                # Mark proxy as failed
                if self.proxy_manager and proxy:
                    self.proxy_manager.mark_proxy_failed(proxy)
                
                # Retry if we have attempts left
                if attempt < max_retries - 1:
                    time.sleep(1)  # Brief delay before retry
                    continue
                
                # All retries exhausted
                return None
        
        return None
    
    def head(self, url: str, **kwargs) -> Optional[requests.Response]:
        """Perform HEAD request
        
        Args:
            url: URL to fetch
            **kwargs: Additional arguments passed to requests.head
            
        Returns:
            Response object or None on failure
        """
        try:
            response = self.session.head(
                url,
                timeout=self.timeout,
                verify=self.verify_ssl,
                **kwargs
            )
            return response
        except requests.RequestException:
            return None
    
    def warm_up(self, url: str):
        """Pre-warm the session with a dummy request
        
        Args:
            url: URL to warm up connection to
        """
        try:
            self.head(url)
        except:
            pass  # Ignore errors, this is just to warm up
    
    def close(self):
        """Close the session"""
        self.session.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
