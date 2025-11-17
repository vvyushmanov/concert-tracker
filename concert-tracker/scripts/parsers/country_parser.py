#!/usr/bin/env python3
"""
Country Concert Parser for concerts-metal.com
Parses all concerts from country-specific pages with pagination support
Filters concerts by Last.fm top artists
"""

import requests
from bs4 import BeautifulSoup
import json
from typing import List, Dict, Optional, Set, Tuple
import argparse
import time
from datetime import datetime
import os
import random
from urllib.parse import urljoin
from dotenv import load_dotenv
import urllib3
import signal
import sys

from utils.data_transform import restructure_concerts_by_country_and_band
from services import ProxyManager
from config import ConfigManager
from parsers import ConcertParser
from services import HTTPClient
from utils import RateLimiter

# Import database writer if needed (lazy import to avoid dependency issues)
try:
    from database import ConcertDatabaseWriter
    DB_AVAILABLE = True
except ImportError:
    DB_AVAILABLE = False
    ConcertDatabaseWriter = None


class CountryConcertParser:
    """Parser for concerts-metal.com country pages with pagination"""
    
    # Configuration constants
    BASE_URL = "https://en.concerts-metal.com"
    REQUEST_TIMEOUT = 15
    RATE_LIMIT_MIN_RESPONSE_SIZE = 1000
    DEFAULT_DELAY = 3.0  # Base delay between requests
    DELAY_RANDOMNESS = 0.5  # Add random variation (±50%)
    COUNTRY_DELAY_MULTIPLIER = 3  # Longer delay between countries
    PAGES_PER_SAVE = 5  # Save progress every N pages in auto mode
    MAX_PAGE_BOUND = 100  # Maximum expected pages per country (for binary search)
    
    def __init__(self, country_code: str, max_pages: Optional[int] = None, delay: float = 1.0, 
                 lastfm_artists: Optional[Set[str]] = None, proxy_manager: Optional[ProxyManager] = None,
                 debug: bool = False, shutdown_flag: Optional['GracefulShutdown'] = None):
        self.country_code = country_code.lower()
        self.base_url = self.BASE_URL
        self.max_pages = max_pages
        self.delay = delay  # Delay between requests to be polite
        self.debug = debug  # Enable timing and debug logs
        self.shutdown_flag = shutdown_flag  # For graceful shutdown
        self.concerts = []
        self.filtered_concerts = []  # Concerts matching Last.fm artists
        self.pages_processed = 0
        self.lastfm_artists = lastfm_artists or set()
        self.total_concerts_found = 0
        self.matched_concerts = 0
        self.proxy_manager = proxy_manager
        self.proxy_failures = 0
        self.proxy_successes = 0
        
        # Create concert parser for filtering
        self.concert_parser = ConcertParser(self.lastfm_artists, self.BASE_URL)
        
        # Create HTTP client for requests
        self.http_client = HTTPClient(
            timeout=self.REQUEST_TIMEOUT,
            verify_ssl=False,  # This specific site has cert issues
            proxy_manager=proxy_manager,
            pool_connections=1,
            pool_maxsize=1
        )
        
        # Create rate limiter
        self.rate_limiter = RateLimiter(
            base_delay=self.delay,
            randomness=self.DELAY_RANDOMNESS
        )
    
        
    def get_page_url(self, page_num: int) -> str:
        """Generate URL for a specific page number"""
        if page_num == 1:
            return f"{self.base_url}/next_{self.country_code}_p1.html"
        else:
            return f"{self.base_url}/next_{self.country_code}_p{page_num}.html"
    
    def _log(self, message: str):
        """Log message with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"[{timestamp}] {message}")
    
    def fetch_page(self, url: str, max_retries: int = 3) -> Optional[BeautifulSoup]:
        """Fetch a single page and return BeautifulSoup object
        
        Uses HTTPClient service for requests with automatic retries and proxy rotation.
        
        Args:
            url: URL to fetch
            max_retries: Maximum number of retries
        """
        start_time = time.time()
        
        # Use HTTPClient to fetch the page
        response = self.http_client.get(url, max_retries=max_retries)
        
        if response is None:
            return None
        
        # Check for rate limiting
        if 'limit.html' in response.url or len(response.text) < self.RATE_LIMIT_MIN_RESPONSE_SIZE:
            print(f"  [ERROR] ⚠️  RATE LIMITED! The website is blocking requests.")
            print(f"  [ERROR] Please wait 10-15 minutes before trying again.")
            print(f"  [ERROR] Consider using --use-proxies webshare or --use-proxies custom")
            return None
        
        # Parse HTML
        parse_start = time.time()
        soup = BeautifulSoup(response.text, 'html.parser')
        parse_time = time.time() - parse_start
        
        total_time = time.time() - start_time
        if self.debug:
            fetch_time = total_time - parse_time
            self._log(f"  Timing: fetch={fetch_time:.2f}s, parse={parse_time:.2f}s, total={total_time:.2f}s")
        
        return soup
    
    def has_next_page(self, soup: BeautifulSoup, current_page: int) -> bool:
        """Check if there's a next page"""
        # Look for pagination links
        pagination = soup.find('nav', {'aria-label': 'Page navigation example'})
        if not pagination:
            return False
        
        # Look for next page link
        next_page = current_page + 1
        next_link = pagination.find('a', string=str(next_page))
        return next_link is not None
    
    def page_exists(self, page_num: int) -> bool:
        """Check if a specific page exists (has concerts)
        
        Args:
            page_num: Page number to check
            
        Returns:
            True if page exists and has concerts, False otherwise
        """
        url = self.get_page_url(page_num)
        soup = self.fetch_page(url)
        
        if not soup:
            return False
        
        # Check if page has any concerts
        event_divs = soup.find_all('div', itemtype='https://schema.org/MusicEvent')
        return len(event_divs) > 0
    
    def find_total_pages(self) -> int:
        """Find total number of pages using Binary Search
        
        Uses pure binary search with a known upper bound (MAX_PAGE_BOUND)
        for optimal efficiency when the maximum page count is predictable.
        
        Returns:
            Total number of pages, or 0 if no pages exist
        """
        self._log(f"🔍 Determining total page count (binary search 1-{self.MAX_PAGE_BOUND})...")
        start_time = time.time()
        
        left = 1
        right = self.MAX_PAGE_BOUND
        last_valid = 0
        requests_made = 0
        
        while left <= right:
            # Check for interruption
            if self.shutdown_flag and self.shutdown_flag.interrupted:
                self._log("  ⚠️  Interrupted during page count detection")
                return last_valid if last_valid > 0 else 1
            
            mid = (left + right + 1) // 2
            self._log(f"  Checking page {mid}...")
            requests_made += 1
            
            if self.page_exists(mid):
                last_valid = mid
                left = mid + 1
                self._log(f"    ✓ Page {mid} exists")
            else:
                right = mid - 1
                self._log(f"    ✗ Page {mid} doesn't exist")
            
            # Add small delay between checks
            self.rate_limiter.wait(multiplier=0.5)
        
        elapsed = time.time() - start_time
        if last_valid > 0:
            self._log(f"  ✅ Total pages: {last_valid} (found in {elapsed:.2f}s, {requests_made} requests)")
        else:
            self._log(f"  ⚠️  No pages found (checked in {elapsed:.2f}s)")
        
        return last_valid
    
    def parse_all_pages(self, on_page_complete=None, detect_total_pages=True):
        """Parse all pages starting from page 1
        
        Args:
            on_page_complete: Optional callback function called after each page is parsed
                             with signature: on_page_complete(all_concerts, filtered_concerts)
            detect_total_pages: If True, detect total page count before parsing (default: True)
        """
        # Detect total pages first if requested
        total_pages = None
        if detect_total_pages:
            total_pages = self.find_total_pages()
            if total_pages == 0:
                print("No pages found for this country")
                return self.concerts
            print(f"\n📊 Total pages to process: {total_pages}\n")
        
        page_num = 1
        
        while True:
            # Check for interruption
            if self.shutdown_flag and self.shutdown_flag.interrupted:
                print(f"\n⚠️  Stopping page fetching due to interrupt...")
                break
            
            # Check if we've reached max pages
            if self.max_pages and page_num > self.max_pages:
                print(f"Reached maximum page limit ({self.max_pages})")
                break
            
            # Check if we've reached detected total pages
            if total_pages and page_num > total_pages:
                print(f"Reached end of pages ({total_pages})")
                break
            
            url = self.get_page_url(page_num)
            progress_str = f" [{page_num}/{total_pages}]" if total_pages else ""
            self._log(f"Fetching page {page_num}{progress_str}: {url}")
            
            page_start = time.time()
            soup = self.fetch_page(url)
            if not soup:
                print(f"Failed to fetch page {page_num}, stopping")
                break
            
            # Parse concerts from this page
            all_concerts, filtered_concerts = self.concert_parser.parse_and_filter_page(soup)
            self.total_concerts_found += len(all_concerts)
            self.matched_concerts += len(filtered_concerts)
            
            page_time = time.time() - page_start
            self._log(f"  Found {len(all_concerts)} concerts on page {page_num} ({len(filtered_concerts)} matched) - took {page_time:.2f}s")
            
            if not all_concerts:
                print(f"No concerts found on page {page_num}, stopping")
                break
            
            self.concerts.extend(all_concerts)
            self.filtered_concerts.extend(filtered_concerts)
            self.pages_processed += 1
            
            # Call callback after each page if provided
            if on_page_complete:
                on_page_complete(self.concerts, self.filtered_concerts, page_num)
            
            # Check if there's a next page
            if not self.has_next_page(soup, page_num):
                print(f"No more pages found after page {page_num}")
                break
            
            page_num += 1
            
            # Be polite - add random delay between requests to appear human-like
            if page_num > 1:
                self.rate_limiter.wait()
        
        return self.concerts
    
    def save_to_json(self, filename: str, filtered_only: bool = False):
        """Save concerts to JSON file"""
        data_to_save = self.filtered_concerts if filtered_only else self.concerts
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data_to_save, f, indent=2, ensure_ascii=False)
        print(f"\nSaved {len(data_to_save)} concerts to {filename}")
    
    def print_statistics(self, country_code: str, normalizer=None):
        """Print statistics about parsed concerts
        
        Args:
            country_code: Country code being processed
            normalizer: Optional CityNormalizer to show normalized city names
        """
        print(f"Pages processed: {self.pages_processed}")
        print(f"Total concerts found: {self.total_concerts_found}")
        if self.lastfm_artists:
            print(f"Concerts matching Last.fm artists: {self.matched_concerts}")
            print(f"Match rate: {self.matched_concerts/self.total_concerts_found*100:.1f}%" if self.total_concerts_found > 0 else "Match rate: 0%")
        print(f"{'='*80}\n")
        
        # Use filtered concerts for summary if filtering is enabled
        concerts_to_show = self.filtered_concerts if self.lastfm_artists else self.concerts
        
        if not concerts_to_show:
            print("No concerts match your Last.fm artists.")
            return
        
        # Group by city
        cities = {}
        for concert in concerts_to_show:
            city = concert.get('city', 'Unknown')
            cities[city] = cities.get(city, 0) + 1
        
        print("Concerts by city (matching Last.fm):" if self.lastfm_artists else "Concerts by city:")
        for city, count in sorted(cities.items(), key=lambda x: x[1], reverse=True)[:10]:
                print(f"  {city}: {count}")
        
        print(f"\nFirst 5 matching concerts:" if self.lastfm_artists else "\nFirst 5 concerts:")
        for i, concert in enumerate(concerts_to_show[:5], 1):
            print(f"\n{i}. {concert['event_name']}")
            print(f"   Date: {concert['date_start']}", end='')
            if concert['date_end'] and concert['date_end'] != concert['date_start']:
                print(f" to {concert['date_end']}")
            else:
                print()
            
            # Show city with normalization info
            city_display = concert['city']
            # Check if concert has normalizedCity (set by db_writer)
            if 'normalizedCity' in concert and concert['normalizedCity'] != concert['city']:
                city_display = f"{concert['city']} → {concert['normalizedCity']}"
            # Or use normalizer to show what it would be normalized to (for dry-run/preview)
            elif normalizer and concert.get('city') and concert.get('country'):
                normalized = normalizer.normalize(concert['city'], concert['country'])
                if normalized != concert['city']:
                    city_display = f"{concert['city']} → {normalized}"
            print(f"   Location: {city_display}, {concert['country']}")
            
            if concert['performers']:
                performers_str = ', '.join(concert['performers'][:3])
                if len(concert['performers']) > 3:
                    performers_str += f" (+{len(concert['performers']) - 3} more)"
                print(f"   Performers: {performers_str}")
            if concert.get('matched_artists'):
                print(f"   ★ Matched: {', '.join(concert['matched_artists'])}")
    
    def save_progress(
        self,
        output_file: str,
        all_concerts: List[Dict],
        all_filtered_concerts: List[Dict],
        recent_artists: Set[str],
        artist_playcounts: Dict[str, int],
        use_filter: bool
    ) -> None:
        """Save progress to JSON file
        
        Args:
            output_file: Path to output JSON file
            all_concerts: All concerts collected so far (from all countries)
            all_filtered_concerts: Filtered concerts collected so far
            recent_artists: Set of recent Last.fm artists
            artist_playcounts: Dict of artist playcounts
            use_filter: Whether filtering is enabled
        """
        # Build cumulative data including previous countries + current country progress
        cumulative_all = list(all_concerts) + list(self.concerts)
        cumulative_filtered = list(all_filtered_concerts) + list(self.filtered_concerts)
        
        # Save incrementally
        data_to_save = cumulative_filtered if use_filter else cumulative_all
        
        # Restructure data by country and band
        if use_filter:
            structured_data = restructure_concerts_by_country_and_band(
                data_to_save, 
                recent_artists, 
                artist_playcounts
            )
        else:
            # If no filtering, use flat structure
            structured_data = data_to_save
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(structured_data, f, indent=2, ensure_ascii=False)


# GracefulShutdown and finalize_and_cleanup have been moved to cli/parse_concerts.py
# They are imported here for backward compatibility
class GracefulShutdown:
    """Context manager for graceful shutdown handling
    
    NOTE: This class has been moved to cli/parse_concerts.py
    This is kept here for backward compatibility.
    """
    def __init__(self):
        self.interrupted = False
        self.original_sigint = None
        self.original_sigterm = None
    
    def __enter__(self):
        self.original_sigint = signal.signal(signal.SIGINT, self._signal_handler)
        self.original_sigterm = signal.signal(signal.SIGTERM, self._signal_handler)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        signal.signal(signal.SIGINT, self.original_sigint)
        signal.signal(signal.SIGTERM, self.original_sigterm)
        return False
    
    def _signal_handler(self, signum, frame):
        if not self.interrupted:
            self.interrupted = True
            print("\n\n⚠️  Interrupt received - initiating graceful shutdown...")
            print("   Saving progress and fetching metadata for new artists...")
        else:
            print("\n⚠️  Second interrupt received - forcing exit!")
            sys.exit(1)


