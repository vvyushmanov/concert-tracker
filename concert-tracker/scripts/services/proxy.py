#!/usr/bin/env python3
"""
Proxy Manager for rotating proxies to avoid IP bans
Supports loading proxies from file or fetching from free proxy lists
"""

import requests
import random
import time
from typing import List, Dict, Optional, Set
from dataclasses import dataclass
from datetime import datetime, timedelta
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib3
from utils import get_logger

logger = get_logger(__name__)

# Disable SSL warnings for proxy validation
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


@dataclass
class ProxyInfo:
    """Information about a proxy"""
    url: str  # Format: http://ip:port or http://user:pass@ip:port
    protocol: str  # 'http' or 'https'
    failures: int = 0
    last_used: Optional[datetime] = None
    last_failure: Optional[datetime] = None
    response_time: Optional[float] = None
    is_working: bool = True


class ProxyManager:
    """Manages proxy rotation and validation"""
    
    # Configuration
    MAX_FAILURES = 3  # Max failures before marking proxy as dead
    FAILURE_COOLDOWN = 300  # Seconds to wait before retrying failed proxy
    VALIDATION_TIMEOUT = 5  # Timeout for proxy validation (reduced for speed)
    TEST_URL = "https://httpbin.org/ip"  # URL to test proxies
    MAX_FREE_PROXIES = 200  # Limit free proxy list size
    VALIDATION_WORKERS = 50  # Parallel validation threads
    
    def __init__(self, proxy_file: Optional[str] = None, 
                 validate_on_load: bool = True,
                 max_proxies: Optional[int] = None,
                 validation_workers: int = 50,
                 webshare_url: Optional[str] = None):
        """
        Initialize proxy manager
        
        Args:
            proxy_file: Path to file with proxy list (one per line)
            validate_on_load: Validate proxies when loading
            webshare_url: Webshare.io download URL
        """
        self.proxies: List[ProxyInfo] = []
        self.dead_proxies: Set[str] = set()
        self.lock = threading.Lock()
        self.current_index = 0
        self.max_proxies = max_proxies or self.MAX_FREE_PROXIES
        self.validation_workers = validation_workers
        
        # Load proxies
        if webshare_url:
            self._load_from_webshare_url(webshare_url, validate_on_load)
        elif proxy_file:
            self._load_from_file(proxy_file, validate_on_load)
        if not self.proxies:
            logger.warning("No proxies loaded. Will use direct connection.")
    
    def _load_from_webshare_url(self, url: str, validate: bool = True):
        """Load proxies from Webshare.io download URL"""
        try:
            logger.info("Downloading proxies from Webshare.io...")
            response = requests.get(url, timeout=30)
            response.raise_for_status()

            lines = [line.strip() for line in response.text.strip().split('\n') if line.strip()]
            logger.info(f"Downloaded {len(lines)} proxies from Webshare")

            for line in lines:
                proxy_info = self._parse_proxy_line(line)
                if proxy_info:
                    self.proxies.append(proxy_info)

            if validate and self.proxies:
                logger.info("Validating proxies...")
                self._validate_all_proxies()

        except Exception as e:
            logger.error(f"Error downloading from Webshare: {e}")
    
    def _load_from_file(self, filepath: str, validate: bool = True):
        """Load proxies from file
        
        File format (one per line):
            ip:port
            protocol://ip:port
            protocol://user:pass@ip:port
        """
        try:
            with open(filepath, 'r') as f:
                lines = [line.strip() for line in f if line.strip() and not line.startswith('#')]

            logger.info(f"Loaded {len(lines)} proxies from {filepath}")

            for line in lines:
                proxy_info = self._parse_proxy_line(line)
                if proxy_info:
                    self.proxies.append(proxy_info)

            if validate and self.proxies:
                logger.info("Validating proxies...")
                self._validate_all_proxies()

        except FileNotFoundError:
            logger.error(f"Proxy file not found: {filepath}")
        except Exception as e:
            logger.error(f"Error loading proxies: {e}")
    
    def _parse_proxy_line(self, line: str) -> Optional[ProxyInfo]:
        """Parse a proxy line into ProxyInfo
        
        Supports formats:
        - ip:port
        - ip:port:username:password (Webshare format)
        - protocol://ip:port
        - protocol://user:pass@ip:port
        """
        try:
            # Check if it's Webshare format (ip:port:username:password)
            if line.count(':') == 3 and '://' not in line:
                parts = line.split(':')
                ip, port, username, password = parts
                protocol = 'http'
                url = f'http://{username}:{password}@{ip}:{port}'
                return ProxyInfo(url=url, protocol=protocol)
            
            # Detect protocol
            if '://' in line:
                protocol = line.split('://')[0]
                url = line
            else:
                # Default to http if no protocol specified
                protocol = 'http'
                url = f'http://{line}'
            
            return ProxyInfo(url=url, protocol=protocol)
        except Exception as e:
            logger.warning(f"Failed to parse proxy line '{line}': {e}")
            return None
    
    
    def _validate_proxy(self, proxy_info: ProxyInfo) -> bool:
        """Validate a single proxy"""
        try:
            proxies = {
                'http': proxy_info.url,
                'https': proxy_info.url
            }
            
            start_time = time.time()
            response = requests.get(
                self.TEST_URL,
                proxies=proxies,
                timeout=self.VALIDATION_TIMEOUT,
                verify=False
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                proxy_info.response_time = response_time
                proxy_info.is_working = True
                return True
            else:
                proxy_info.is_working = False
                return False
                
        except Exception:
            proxy_info.is_working = False
            return False
    
    def _validate_all_proxies(self):
        """Validate all proxies in parallel and remove dead ones"""
        logger.info(f"Testing {len(self.proxies)} proxies with {self.validation_workers} workers...")
        working = []
        tested = 0

        with ThreadPoolExecutor(max_workers=self.validation_workers) as executor:
            # Submit all validation tasks
            future_to_proxy = {executor.submit(self._validate_proxy, proxy): proxy for proxy in self.proxies}

            # Process results as they complete
            for future in as_completed(future_to_proxy):
                proxy = future_to_proxy[future]
                tested += 1

                try:
                    if future.result():
                        working.append(proxy)
                        logger.debug(f"Working proxy {tested}/{len(self.proxies)}: {proxy.url} ({proxy.response_time:.2f}s)")
                    else:
                        if tested % 100 == 0:  # Only log progress every 100 dead proxies
                            logger.info(f"Tested {tested}/{len(self.proxies)}, found {len(working)} working...")
                except Exception:
                    pass

        self.proxies = working
        logger.info(f"{len(self.proxies)} working proxies found out of {tested} tested")
    
    def get_next_proxy(self) -> Optional[Dict[str, str]]:
        """Get next proxy in rotation
        
        Returns:
            Dict with 'http' and 'https' keys, or None if no proxies available
        """
        with self.lock:
            if not self.proxies:
                return None
            
            # Filter out recently failed proxies
            available = [
                p for p in self.proxies
                if p.is_working and (
                    p.last_failure is None or
                    (datetime.now() - p.last_failure).total_seconds() > self.FAILURE_COOLDOWN
                )
            ]
            
            if not available:
                # If all proxies are in cooldown, use any working proxy
                available = [p for p in self.proxies if p.is_working]
            
            if not available:
                return None
            
            # Round-robin selection
            proxy_info = available[self.current_index % len(available)]
            self.current_index += 1
            
            proxy_info.last_used = datetime.now()
            
            return {
                'http': proxy_info.url,
                'https': proxy_info.url
            }
    
    def get_random_proxy(self) -> Optional[Dict[str, str]]:
        """Get random proxy (alternative to round-robin)
        
        Returns:
            Dict with 'http' and 'https' keys, or None if no proxies available
        """
        with self.lock:
            if not self.proxies:
                return None
            
            # Filter working proxies
            available = [p for p in self.proxies if p.is_working]
            
            if not available:
                return None
            
            proxy_info = random.choice(available)
            proxy_info.last_used = datetime.now()
            
            return {
                'http': proxy_info.url,
                'https': proxy_info.url
            }
    
    def mark_proxy_failed(self, proxy_dict: Dict[str, str]):
        """Mark a proxy as failed"""
        if not proxy_dict:
            return
        
        proxy_url = proxy_dict.get('http') or proxy_dict.get('https')
        
        with self.lock:
            for proxy_info in self.proxies:
                if proxy_info.url == proxy_url:
                    proxy_info.failures += 1
                    proxy_info.last_failure = datetime.now()
                    
                    if proxy_info.failures >= self.MAX_FAILURES:
                        proxy_info.is_working = False
                        self.dead_proxies.add(proxy_url)
                        logger.warning(f"Proxy marked as dead: {proxy_url}")
                    break
    
    def mark_proxy_success(self, proxy_dict: Dict[str, str]):
        """Mark a proxy as successful (reset failure count)"""
        if not proxy_dict:
            return
        
        proxy_url = proxy_dict.get('http') or proxy_dict.get('https')
        
        with self.lock:
            for proxy_info in self.proxies:
                if proxy_info.url == proxy_url:
                    proxy_info.failures = 0
                    proxy_info.is_working = True
                    break
    
    def get_stats(self) -> Dict:
        """Get proxy statistics"""
        with self.lock:
            working = [p for p in self.proxies if p.is_working]
            return {
                'total': len(self.proxies),
                'working': len(working),
                'dead': len(self.dead_proxies),
                'avg_response_time': sum(p.response_time or 0 for p in working) / len(working) if working else 0
            }
    
    def print_stats(self):
        """Print proxy statistics"""
        stats = self.get_stats()
        logger.info("PROXY STATISTICS")
        logger.info(f"Total proxies: {stats['total']}")
        logger.info(f"Working proxies: {stats['working']}")
        logger.info(f"Dead proxies: {stats['dead']}")
        if stats['avg_response_time'] > 0:
            logger.info(f"Average response time: {stats['avg_response_time']:.2f}s")


def create_proxy_list_template(filename: str = "proxies.txt"):
    """Create a template proxy list file"""
    template = """# Proxy list - one proxy per line
# Supported formats:
#   ip:port
#   http://ip:port
#   https://ip:port
#   http://user:pass@ip:port
#
# Example:
# 123.45.67.89:8080
# http://123.45.67.89:3128
# http://user:password@123.45.67.89:8080
#
# Add your proxies below:

"""
    
    with open(filename, 'w') as f:
        f.write(template)

    logger.info(f"Created proxy list template: {filename}")
    logger.info("Add your proxies to this file and run with --proxy-file proxies.txt")


if __name__ == '__main__':
    import sys
    from utils.logging_config import setup_logging

    setup_logging()

    if len(sys.argv) > 1 and sys.argv[1] == 'create-template':
        create_proxy_list_template()
    else:
        logger.info("Proxy Manager - use with country_concert_parser.py")
        logger.info("Run: python proxy_manager.py create-template")
