"""
Centralized HTTP client with session management, retries, proxy support, and FlareSolverr integration
"""

import os
import random
import time
import urllib3
import requests
from typing import Optional, List, Union
from requests.adapters import HTTPAdapter
from utils import get_logger
from services.proxy import ProxyManager

logger = get_logger(__name__)

def get_flaresolverr_config():
    """Get FlareSolverr configuration from environment (evaluated at runtime)"""
    url = os.getenv('FLARESOLVERR_URL', 'http://localhost:8191/v1')
    enabled = os.getenv('FLARESOLVERR_URL') is not None
    return url, enabled

# Legacy constants for backward compatibility (will be deprecated)
FLARESOLVERR_URL = os.getenv('FLARESOLVERR_URL', 'http://localhost:8191/v1')
FLARESOLVERR_ENABLED = os.getenv('FLARESOLVERR_URL') is not None

# System CA bundle paths (in order of preference)
SYSTEM_CA_BUNDLES = [
    '/etc/ssl/certs/ca-certificates.crt',  # Debian/Ubuntu
    '/etc/pki/tls/certs/ca-bundle.crt',    # RHEL/CentOS
    '/etc/ssl/ca-bundle.pem',               # OpenSUSE
    '/etc/ssl/cert.pem',                    # Alpine/macOS
]

def get_system_ca_bundle() -> Optional[str]:
    """Find the system CA certificate bundle

    Returns:
        Path to system CA bundle, or None if not found
    """
    for path in SYSTEM_CA_BUNDLES:
        if os.path.exists(path):
            return path
    return None


class HTTPClient:
    """Shared HTTP client with session management, proxy rotation, rate limiting, and FlareSolverr support"""

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
        verify_ssl: Union[bool, str] = True,
        use_system_ca: bool = False,
        user_agents: Optional[List[str]] = None,
        proxy_manager: Optional[ProxyManager] = None,
        pool_connections: int = 1,
        pool_maxsize: int = 1,
        use_flaresolverr: bool = False
    ):
        """Initialize HTTP client

        Args:
            timeout: Request timeout in seconds
            verify_ssl: Whether to verify SSL certificates (bool or path to CA bundle)
            use_system_ca: Use system CA bundle instead of certifi (fixes some cert issues)
            user_agents: List of user agents to rotate (uses defaults if None)
            proxy_manager: Optional ProxyManager instance for proxy rotation
            pool_connections: Number of connection pools
            pool_maxsize: Max connections per pool
            use_flaresolverr: Use FlareSolverr for bypassing Cloudflare/Turnstile
        """
        self.timeout = timeout
        self.user_agents = user_agents or self.DEFAULT_USER_AGENTS
        self.proxy_manager = proxy_manager
        self.session = self._create_session(pool_connections, pool_maxsize)
        self._last_url = None

        # Get FlareSolverr configuration at runtime
        self.flaresolverr_url, flaresolverr_enabled = get_flaresolverr_config()
        self.use_flaresolverr = use_flaresolverr and flaresolverr_enabled
        self.flaresolverr_session_id = None
        self.flaresolverr_session_proxy = None  # Track which proxy the session is using
        self.cloudflare_active = None  # None = unknown, True = active, False = not active

        # Log FlareSolverr status
        if use_flaresolverr and not flaresolverr_enabled:
            logger.warning("FlareSolverr requested but FLARESOLVERR_URL not set in environment")
        elif self.use_flaresolverr:
            proxy_status = f" with {len(self.proxy_manager.proxies)} proxies" if self.proxy_manager else " without proxies"
            logger.info(f"FlareSolverr enabled at {self.flaresolverr_url}{proxy_status}")
            # Note: We'll create session on first request with a proxy (if available)

        # Determine SSL verification setting
        if verify_ssl is False:
            self.verify_ssl = False
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            # Note: SSL verification disabled - this is a security risk
            # Only disable for specific domains with known certificate issues
        elif use_system_ca:
            # Use system CA bundle instead of certifi
            system_ca = get_system_ca_bundle()
            if system_ca:
                self.verify_ssl = system_ca
            else:
                # Fall back to certifi if no system bundle found
                self.verify_ssl = True
        elif isinstance(verify_ssl, str):
            # Custom CA bundle path provided
            self.verify_ssl = verify_ssl
        else:
            # Default: use certifi
            self.verify_ssl = True
    
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

    def _init_flaresolverr_session(self):
        """Initialize FlareSolverr session for persistent cookies"""
        try:
            # Generate unique session ID
            import uuid
            self.flaresolverr_session_id = f"session_{uuid.uuid4().hex[:8]}"

            response = requests.post(
                self.flaresolverr_url,
                json={"cmd": "sessions.create", "session": self.flaresolverr_session_id},
                timeout=30
            )

            if response.status_code == 200:
                logger.debug(f"FlareSolverr session created: {self.flaresolverr_session_id}")
            else:
                logger.warning(f"Failed to create FlareSolverr session: {response.status_code}")
                self.flaresolverr_session_id = None
        except Exception as e:
            logger.warning(f"Failed to initialize FlareSolverr session: {e}")
            self.flaresolverr_session_id = None

    def _flaresolverr_request(self, url: str, max_retries: int = 3) -> Optional[requests.Response]:
        """Make request through FlareSolverr to bypass Cloudflare/Turnstile

        Args:
            url: URL to fetch
            max_retries: Maximum number of retry attempts

        Returns:
            Response object or None if all retries failed
        """
        for attempt in range(max_retries):
            try:
                # Get proxy if proxy manager is available
                proxy_dict = None
                proxy_url = None
                if self.proxy_manager:
                    proxy_dict = self.proxy_manager.get_next_proxy()
                    if proxy_dict:
                        # Extract proxy URL from dict (format: {'http': 'http://user:pass@ip:port', 'https': '...'})
                        proxy_url = proxy_dict.get('http') or proxy_dict.get('https')
                        logger.debug(f"Using proxy for FlareSolverr: {proxy_url}")
                    else:
                        logger.warning("ProxyManager available but get_next_proxy() returned None (no working proxies?)")
                else:
                    logger.debug("No ProxyManager available for FlareSolverr request")

                # Prepare FlareSolverr request
                payload = {
                    "cmd": "request.get",
                    "url": url,
                    "maxTimeout": 60000,
                }

                # Smart Cloudflare detection:
                # - First request ONLY: Use tabs_till_verify to solve any challenge
                # - After first request: Session has cookies, no need for tabs_till_verify
                # This works for both scenarios:
                #   1. Cloudflare active: First request solves challenge, session gets cookies
                #   2. No Cloudflare: First request loads directly, subsequent requests stay fast
                if self.cloudflare_active is None:
                    payload["tabs_till_verify"] = 1
                    mode_description = "first request (challenge detection)"
                else:
                    # After first request, session has cookies - no tabs_till_verify needed
                    mode_description = "fast mode (using session cookies)"

                # Add proxy if available (FlareSolverr format: {"url": "http://ip:port"})
                if proxy_url:
                    payload["proxy"] = {"url": proxy_url}

                # Add session if available
                if self.flaresolverr_session_id:
                    payload["session"] = self.flaresolverr_session_id

                # Make request to FlareSolverr
                proxy_display = f" via {proxy_url}" if proxy_url else ""
                logger.debug(f"FlareSolverr request ({mode_description}){proxy_display}: {url}")
                response = requests.post(
                    self.flaresolverr_url,
                    json=payload,
                    timeout=120
                )

                if response.status_code != 200:
                    raise Exception(f"FlareSolverr returned status {response.status_code}")

                data = response.json()

                # Check for errors
                if data.get('status') != 'ok':
                    error_msg = data.get('message', 'Unknown error')
                    raise Exception(f"FlareSolverr error: {error_msg}")

                # Extract solution
                solution = data.get('solution', {})
                html_content = solution.get('response')
                status_code = solution.get('status')

                if not html_content:
                    raise Exception("FlareSolverr returned empty response")

                # Mark first request as complete and switch to fast mode
                if self.cloudflare_active is None:
                    # Check if FlareSolverr had to solve a challenge using timing
                    # Timestamps are at top level, not in solution
                    start_timestamp = data.get('startTimestamp', 0)
                    end_timestamp = data.get('endTimestamp', 0)

                    # Calculate request duration (milliseconds)
                    duration_ms = end_timestamp - start_timestamp if end_timestamp and start_timestamp else 0
                    duration_sec = duration_ms / 1000.0

                    # Cloudflare challenge solving takes 5-15 seconds (with tabs_till_verify)
                    # Direct page loads are typically < 2 seconds
                    # Threshold: 3 seconds - if first request took > 3s, challenge was solved
                    challenge_solved = duration_sec > 3.0

                    if challenge_solved:
                        logger.info(f"Cloudflare challenge detected and solved in {duration_sec:.1f}s")
                        logger.info("Session now has cf_clearance cookie - switching to fast mode for subsequent requests")
                    else:
                        logger.info(f"No Cloudflare challenge - page loaded directly in {duration_sec:.1f}s")
                        logger.info("Switching to fast mode for subsequent requests")

                    # Always switch to fast mode after first request
                    # Session has cookies (if challenge was solved) or no protection (if no challenge)
                    self.cloudflare_active = False  # False means "first request done, use fast mode"

                # Success - mark proxy as working
                if self.proxy_manager and proxy_dict:
                    self.proxy_manager.mark_proxy_success(proxy_dict)
                    logger.debug(f"FlareSolverr proxy marked as working: {proxy_url}")

                # Create mock response object
                mock_response = requests.Response()
                mock_response.status_code = status_code or 200
                mock_response._content = html_content.encode('utf-8')
                mock_response.url = solution.get('url', url)
                mock_response.headers = solution.get('headers', {})

                logger.debug(f"FlareSolverr success: {url} (status: {mock_response.status_code})")
                return mock_response

            except Exception as e:
                # Mark proxy as failed
                if self.proxy_manager and proxy_dict:
                    self.proxy_manager.mark_proxy_failed(proxy_dict)

                error_detail = str(e)

                # Retry if we have attempts left
                if attempt < max_retries - 1:
                    retry_delay = 2 + attempt  # Increasing delay: 2s, 3s, 4s...
                    logger.warning(
                        f"FlareSolverr request failed (attempt {attempt + 1}/{max_retries}): {error_detail} - "
                        f"retrying in {retry_delay}s..."
                    )
                    time.sleep(retry_delay)
                    continue

                # All retries exhausted
                logger.error(f"FlareSolverr request failed after {max_retries} attempts: {error_detail}")
                return None

        return None
    
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
        force_flaresolverr: bool = False,
        **kwargs
    ) -> Optional[requests.Response]:
        """Perform GET request with retries and proxy rotation

        Args:
            url: URL to fetch
            max_retries: Maximum number of retry attempts
            headers: Optional custom headers (merged with default headers)
            base_url: Base URL for Referer header
            force_flaresolverr: Force using FlareSolverr even if disabled by default
            **kwargs: Additional arguments passed to requests.get

        Returns:
            Response object or None if all retries failed
        """
        # Use FlareSolverr if enabled or forced
        if self.use_flaresolverr or force_flaresolverr:
            return self._flaresolverr_request(url, max_retries)

        # Standard request flow
        for attempt in range(max_retries):
            try:
                # Get proxy if proxy manager is available
                proxy = None
                proxy_display = "direct connection"
                if self.proxy_manager:
                    proxy = self.proxy_manager.get_next_proxy()
                    if proxy:
                        # Extract proxy address for logging
                        proxy_url = proxy.get('http') or proxy.get('https', '')
                        proxy_display = f"proxy {proxy_url}"

                # Merge headers
                request_headers = self._get_headers(base_url)
                if headers:
                    request_headers.update(headers)

                # Log request details
                logger.debug(f"GET {url} via {proxy_display}")

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
                    logger.debug(f"Request succeeded via {proxy_display}")

                # Store URL for next request's Referer
                self._last_url = url

                return response

            except requests.RequestException as e:
                # Mark proxy as failed
                if self.proxy_manager and proxy:
                    self.proxy_manager.mark_proxy_failed(proxy)

                # Determine error details for logging
                error_detail = str(e)
                cloudflare_detected = False

                if hasattr(e, 'response') and e.response is not None:
                    status_code = e.response.status_code
                    error_detail = f"HTTP {status_code}"

                    # Check for Cloudflare/Turnstile protection
                    if status_code == 403 or status_code == 503:
                        response_text = e.response.text.lower() if hasattr(e.response, 'text') else ''
                        if 'cloudflare' in response_text or 'turnstile' in response_text or 'just a moment' in response_text:
                            cloudflare_detected = True
                            error_detail += " (Cloudflare/Turnstile protection detected)"

                    if status_code >= 500:
                        error_detail += " (server error)"
                    elif status_code == 429:
                        error_detail += " (rate limited)"
                    elif status_code == 403:
                        error_detail += " (forbidden)"
                    elif status_code == 404:
                        error_detail += " (not found)"
                elif isinstance(e, requests.Timeout):
                    error_detail = f"Timeout after {self.timeout}s"
                elif isinstance(e, requests.ConnectionError):
                    error_detail = "Connection error"

                # If Cloudflare detected and FlareSolverr available, try it
                _, flaresolverr_enabled = get_flaresolverr_config()
                if cloudflare_detected and flaresolverr_enabled and not self.use_flaresolverr:
                    logger.warning(f"{error_detail} - attempting with FlareSolverr...")
                    return self._flaresolverr_request(url, max_retries)

                # Retry if we have attempts left
                if attempt < max_retries - 1:
                    retry_delay = 1 + attempt  # Increasing delay: 1s, 2s, 3s...
                    logger.warning(
                        f"Request failed (attempt {attempt + 1}/{max_retries}): {error_detail} - "
                        f"retrying in {retry_delay}s..."
                    )
                    time.sleep(retry_delay)
                    continue

                # All retries exhausted
                logger.error(
                    f"Request failed after {max_retries} attempts: {error_detail}"
                )
                return None

        return None

    def post(
        self,
        url: str,
        max_retries: int = 3,
        headers: Optional[dict] = None,
        data: Optional[dict] = None,
        json: Optional[dict] = None,
        **kwargs
    ) -> Optional[requests.Response]:
        """Perform POST request with retries and proxy rotation

        Args:
            url: URL to post to
            max_retries: Maximum number of retry attempts
            headers: Optional custom headers (merged with default headers)
            data: Optional form data
            json: Optional JSON data
            **kwargs: Additional arguments passed to requests.post

        Returns:
            Response object or None if all retries failed
        """
        # Standard request flow (FlareSolverr only supports GET for now)
        for attempt in range(max_retries):
            try:
                # Get proxy if proxy manager is available
                proxy = None
                proxy_display = "direct connection"
                if self.proxy_manager:
                    proxy = self.proxy_manager.get_next_proxy()
                    if proxy:
                        # Extract proxy address for logging
                        proxy_url = proxy.get('http') or proxy.get('https', '')
                        proxy_display = f"proxy {proxy_url}"

                # Merge headers
                request_headers = self._get_headers()
                if headers:
                    request_headers.update(headers)

                # Log request details
                logger.debug(f"POST {url} via {proxy_display}")

                # Make request
                response = self.session.post(
                    url,
                    timeout=self.timeout,
                    verify=self.verify_ssl,
                    headers=request_headers,
                    proxies=proxy,
                    data=data,
                    json=json,
                    **kwargs
                )
                response.raise_for_status()

                # Success - mark proxy as working
                if self.proxy_manager and proxy:
                    self.proxy_manager.mark_proxy_success(proxy)
                    logger.debug(f"Request succeeded via {proxy_display}")

                return response

            except requests.RequestException as e:
                # Mark proxy as failed
                if self.proxy_manager and proxy:
                    self.proxy_manager.mark_proxy_failed(proxy)

                # Determine error details for logging
                error_detail = str(e)
                if hasattr(e, 'response') and e.response is not None:
                    status_code = e.response.status_code
                    error_detail = f"HTTP {status_code}"

                    if status_code >= 500:
                        error_detail += " (server error)"
                    elif status_code == 429:
                        error_detail += " (rate limited)"
                    elif status_code == 403:
                        error_detail += " (forbidden)"
                elif isinstance(e, requests.Timeout):
                    error_detail = f"Timeout after {self.timeout}s"
                elif isinstance(e, requests.ConnectionError):
                    error_detail = "Connection error"

                # Retry if we have attempts left
                if attempt < max_retries - 1:
                    retry_delay = 1 + attempt
                    logger.warning(
                        f"POST request failed (attempt {attempt + 1}/{max_retries}): {error_detail} - "
                        f"retrying in {retry_delay}s..."
                    )
                    time.sleep(retry_delay)
                    continue

                # All retries exhausted
                logger.error(f"POST request failed after {max_retries} attempts: {error_detail}")
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
        """Close the session and destroy FlareSolverr session"""
        self.session.close()

        # Destroy FlareSolverr session if it exists
        if self.flaresolverr_session_id:
            try:
                requests.post(
                    self.flaresolverr_url,
                    json={"cmd": "sessions.destroy", "session": self.flaresolverr_session_id},
                    timeout=10
                )
                logger.debug(f"FlareSolverr session destroyed: {self.flaresolverr_session_id}")
            except Exception as e:
                logger.debug(f"Failed to destroy FlareSolverr session: {e}")
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
