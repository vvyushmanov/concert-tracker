#!/usr/bin/env python3
"""
Country Concert Parser for concerts-metal.com
Parses all concerts from country-specific pages with pagination support
Filters concerts by Last.fm top artists
"""

import requests
from bs4 import BeautifulSoup
import json
import re
from typing import List, Dict, Optional, Set, Tuple
import argparse
import time
from datetime import datetime
import os
import random
from urllib.parse import urljoin
from dotenv import load_dotenv
import urllib3

from concert_utils import restructure_concerts_by_country_and_band, fetch_lastfm_artists

# Import database writer if needed (lazy import to avoid dependency issues)
try:
    from db_writer import ConcertDatabaseWriter
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
    
    def __init__(self, country_code: str, max_pages: Optional[int] = None, delay: float = 1.0, 
                 lastfm_artists: Optional[Set[str]] = None):
        self.country_code = country_code.lower()
        self.base_url = self.BASE_URL
        self.max_pages = max_pages
        self.delay = delay  # Delay between requests to be polite
        self.concerts = []
        self.filtered_concerts = []  # Concerts matching Last.fm artists
        self.pages_processed = 0
        self.lastfm_artists = lastfm_artists or set()
        # Create normalized lookup dict for O(1) artist matching
        self.lastfm_artists_normalized = {
            artist.lower().strip(): artist 
            for artist in (lastfm_artists or set())
        }
        self.total_concerts_found = 0
        self.matched_concerts = 0
        
        # Configure session with SSL handling and connection pooling
        self.session = requests.Session()
        
        # Disable SSL warnings but use custom SSL context
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        
        # Configure connection pooling (keep it simple to avoid issues)
        from requests.adapters import HTTPAdapter
        adapter = HTTPAdapter(pool_connections=1, pool_maxsize=1)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        
        self._warm_up_session()  # Pre-warm session to avoid slow first request
    
    def _warm_up_session(self):
        """Pre-warm the session with a dummy request to avoid slow first request"""
        try:
            # Make a quick HEAD request to establish connection
            # Use verify=False for this specific domain due to cert issues
            self.session.head(self.base_url, verify=False, timeout=10)
        except:
            pass  # Ignore errors, this is just to warm up the connection
    
    def _random_delay(self, base_delay: float) -> float:
        """Add random variation to delay to appear more human-like"""
        variation = base_delay * self.DELAY_RANDOMNESS
        return base_delay + random.uniform(-variation, variation)
        
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
    
    def fetch_page(self, url: str) -> Optional[BeautifulSoup]:
        """Fetch a single page and return BeautifulSoup object"""
        try:
            start_time = time.time()
            
            # Rotate user agents to appear more human-like
            user_agents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ]
            
            headers = {
                'User-Agent': random.choice(user_agents),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,en-GB;q=0.8',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0',
                'Referer': self.base_url if hasattr(self, '_last_url') else None
            }
            
            # Remove None values
            headers = {k: v for k, v in headers.items() if v is not None}
            
            # Use verify=False only for this specific domain due to certificate issues
            # In production, you should fix the certificate or use certifi
            response = self.session.get(
                url, 
                timeout=self.REQUEST_TIMEOUT, 
                verify=False,  # Only because this specific site has cert issues
                headers=headers, 
                allow_redirects=True
            )
            response.raise_for_status()
            
            fetch_time = time.time() - start_time
            self._last_url = url  # Store for next request's Referer
            
            # Parse HTML
            parse_start = time.time()
            soup = BeautifulSoup(response.text, 'html.parser')
            parse_time = time.time() - parse_start
            
            total_time = time.time() - start_time
            if total_time > 2.0:
                self._log(f"  Timing: fetch={fetch_time:.2f}s, parse={parse_time:.2f}s, total={total_time:.2f}s")
            
            # Check for rate limiting
            if 'limit.html' in response.url or len(response.text) < self.RATE_LIMIT_MIN_RESPONSE_SIZE:
                print(f"  [ERROR] ⚠️  RATE LIMITED! The website is blocking requests.")
                print(f"  [ERROR] Please wait 10-15 minutes before trying again.")
                print(f"  [ERROR] Consider using --delay 3 or higher to be more polite.")
            
            return soup
        except requests.RequestException as e:
            print(f"Error fetching {url}: {e}")
            return None
    
    def extract_venue_info(self, event_div) -> Dict[str, str]:
        """Extract venue information from event div"""
        venue_info = {
            'venue': None,
            'city': None,
            'country': None,
            'postal_code': None
        }
        
        location = event_div.find('div', itemprop='location')
        if location:
            venue_meta = location.find('meta', itemprop='name')
            if venue_meta:
                venue_info['venue'] = venue_meta.get('content')
            
            address = location.find('div', itemprop='address')
            if address:
                city_meta = address.find('meta', itemprop='addressLocality')
                country_meta = address.find('meta', itemprop='addressCountry')
                postal_meta = address.find('meta', itemprop='postalCode')
                
                if city_meta:
                    venue_info['city'] = city_meta.get('content')
                if country_meta:
                    venue_info['country'] = country_meta.get('content')
                if postal_meta:
                    venue_info['postal_code'] = postal_meta.get('content')
        
        return venue_info
    
    def extract_performers(self, event_div) -> List[str]:
        """Extract all performers from event"""
        performers = []
        performer_divs = event_div.find_all('div', itemprop='performer')
        for performer in performer_divs:
            name_meta = performer.find('meta', itemprop='name')
            if name_meta:
                performers.append(name_meta.get('content'))
        return performers
    
    def matches_lastfm_artists(self, performers: List[str]) -> List[str]:
        """Check if any performer matches Last.fm artists list
        
        Returns:
            List of matched Last.fm artist names (using Last.fm capitalization)
        """
        if not self.lastfm_artists_normalized:
            return []  # If no filter, return empty list
        
        start_time = time.time()
        matched = []
        # O(1) lookup using normalized dictionary
        for performer in performers:
            normalized = performer.lower().strip()
            if normalized in self.lastfm_artists_normalized:
                original = self.lastfm_artists_normalized[normalized]
                if original not in matched:
                    matched.append(original)
        match_time = time.time() - start_time
        if match_time > 0.1:
            self._log(f"  Match timing: {match_time:.2f}s")
        return matched
    
    def extract_event_details(self, event_div) -> Dict:
        """Extract all details from a single event div"""
        start_time = time.time()
        event = {
            'event_name': None,
            'event_url': None,
            'date_start': None,
            'date_end': None,
            'venue': None,
            'city': None,
            'country': None,
            'postal_code': None,
            'performers': [],
            'image_url': None,
            'organizer': None,
            'organizer_url': None,
            'ticket_links': [],
            'matched_artists': []  # Artists that matched from Last.fm
        }
        
        # Event name - find the meta tag that's NOT inside the location div
        all_name_metas = event_div.find_all('meta', itemprop='name')
        for name_meta in all_name_metas:
            parent_location = name_meta.find_parent('div', itemprop='location')
            if not parent_location:
                event['event_name'] = name_meta.get('content')
                break
        
        # Event URL
        url_link = event_div.find('a', itemprop='url')
        if url_link:
            event['event_url'] = url_link.get('href')
            if event['event_url'] and not event['event_url'].startswith('http'):
                event['event_url'] = urljoin(self.base_url, event['event_url'])
        
        # Dates
        start_date = event_div.find('meta', itemprop='startDate')
        end_date = event_div.find('meta', itemprop='endDate')
        if start_date:
            event['date_start'] = start_date.get('content')
        if end_date:
            event['date_end'] = end_date.get('content')
        
        # Venue info
        venue_info = self.extract_venue_info(event_div)
        event.update(venue_info)
        
        # Performers
        event['performers'] = self.extract_performers(event_div)
        
        # Image
        image_meta = event_div.find('meta', itemprop='image')
        if image_meta:
            event['image_url'] = image_meta.get('content')
        
        # Organizer
        organizer_div = event_div.find('div', itemprop='organizer')
        if organizer_div:
            org_name = organizer_div.find('meta', itemprop='name')
            org_url = organizer_div.find('meta', itemprop='url')
            if org_name:
                event['organizer'] = org_name.get('content')
            if org_url:
                event['organizer_url'] = org_url.get('content')
        
        # Ticket links
        ticket_offers = event_div.find_all('span', itemprop='offers')
        for offer in ticket_offers:
            link = offer.find('a', itemprop='url')
            if link:
                ticket_info = {
                    'vendor': link.get_text(strip=True),
                    'url': link.get('href')
                }
                price_meta = offer.find('meta', itemprop='price')
                currency_meta = offer.find('meta', itemprop='priceCurrency')
                if price_meta and currency_meta:
                    ticket_info['price'] = f"{price_meta.get('content')} {currency_meta.get('content')}"
                
                event['ticket_links'].append(ticket_info)
        
        # Find matched artists from Last.fm (using Last.fm capitalization)
        event['matched_artists'] = self.matches_lastfm_artists(event['performers'])
        
        extract_time = time.time() - start_time
        if extract_time > 0.1:
            self._log(f"  Extract timing: {extract_time:.2f}s")
        return event
    
    def parse_page(self, soup: BeautifulSoup) -> Tuple[List[Dict], List[Dict]]:
        """Parse a single page and return all concerts and filtered concerts
        
        Returns:
            Tuple of (all_concerts, filtered_concerts)
        """
        start_time = time.time()
        concerts = []
        filtered_concerts = []
        event_divs = soup.find_all('div', itemtype='https://schema.org/MusicEvent')
        
        for event_div in event_divs:
            event_details = self.extract_event_details(event_div)
            if event_details['event_name']:
                concerts.append(event_details)
                
                # Check if matches Last.fm artists
                if event_details['matched_artists']:  # Non-empty list means match
                    filtered_concerts.append(event_details)
        
        parse_time = time.time() - start_time
        if parse_time > 1.0:
            self._log(f"  Parse timing: {parse_time:.2f}s for {len(concerts)} concerts")
        
        return concerts, filtered_concerts
    
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
    
    def parse_all_pages(self, on_page_complete=None):
        """Parse all pages starting from page 1
        
        Args:
            on_page_complete: Optional callback function called after each page is parsed
                             with signature: on_page_complete(all_concerts, filtered_concerts)
        """
        page_num = 1
        
        while True:
            # Check if we've reached max pages
            if self.max_pages and page_num > self.max_pages:
                print(f"Reached maximum page limit ({self.max_pages})")
                break
            
            url = self.get_page_url(page_num)
            self._log(f"Fetching page {page_num}: {url}")
            
            page_start = time.time()
            soup = self.fetch_page(url)
            if not soup:
                print(f"Failed to fetch page {page_num}, stopping")
                break
            
            # Parse concerts from this page
            all_concerts, filtered_concerts = self.parse_page(soup)
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
                delay = self._random_delay(self.delay)
                time.sleep(delay)
        
        return self.concerts
    
    def save_to_json(self, filename: str, filtered_only: bool = False):
        """Save concerts to JSON file"""
        data_to_save = self.filtered_concerts if filtered_only else self.concerts
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data_to_save, f, indent=2, ensure_ascii=False)
        print(f"\nSaved {len(data_to_save)} concerts to {filename}")
    
    def print_summary(self):
        """Print a summary of parsed concerts"""
        print(f"\n{'='*80}")
        print(f"Country: {self.country_code.upper()}")
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
            print(f"   Location: {concert['city']}, {concert['country']}")
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


def main():
    # Load environment variables
    load_dotenv()
    
    parser = argparse.ArgumentParser(
        description='Parse concerts from country pages, filtered by Last.fm artists'
    )
    parser.add_argument(
        '--json',
        help='Output JSON file (default: my_concerts.json)',
        default='my_concerts.json'
    )
    parser.add_argument(
        '--max-pages',
        type=int,
        help='Maximum number of pages per country (default: no limit)',
        default=None
    )
    parser.add_argument(
        '--delay',
        type=float,
        help=f'Delay in seconds between page requests (default: {CountryConcertParser.DEFAULT_DELAY})',
        default=CountryConcertParser.DEFAULT_DELAY
    )
    parser.add_argument(
        '--no-summary',
        action='store_true',
        help='Do not print summary to console'
    )
    parser.add_argument(
        '--no-filter',
        action='store_true',
        help='Do not filter by Last.fm artists (get all concerts)'
    )
    parser.add_argument(
        '--save-all',
        action='store_true',
        help='Save all concerts in addition to filtered ones'
    )
    parser.add_argument(
        '--save-frequency',
        type=str,
        choices=['page', 'country', 'auto'],
        default='auto',
        help=f'How often to save progress: per page, per country, or auto (every {CountryConcertParser.PAGES_PER_SAVE} pages, default: auto)'
    )
    parser.add_argument(
        '--output',
        type=str,
        choices=['json', 'db', 'both'],
        default='json',
        help='Output mode: json (default), db (database), or both'
    )
    parser.add_argument(
        '--db-path',
        type=str,
        help='Path to SQLite database file (required for db/both output modes)',
        default=None
    )
    
    args = parser.parse_args()
    
    # Validate database arguments
    if args.output in ['db', 'both'] and not args.db_path:
        parser.error("--db-path is required when using --output db or --output both")
        return 1
    
    # Check if database module is available
    if args.output in ['db', 'both'] and not DB_AVAILABLE:
        print("ERROR: Database output requested but SQLAlchemy is not installed")
        print("Please install: pip install sqlalchemy")
        return 1
    
    # Initialize database writer if needed
    db_writer = None
    if args.output in ['db', 'both']:
        print(f"Database output mode: {args.db_path}")
        db_writer = ConcertDatabaseWriter(args.db_path)
    
    # Get country codes from .env
    country_codes_str = os.getenv('COUNTRY_CODES', 'tr,fr,de')
    country_codes = [code.strip() for code in country_codes_str.split(',')]
    
    print(f"Country codes from .env: {', '.join(country_codes)}")
    
    # Fetch Last.fm artists if filtering is enabled
    lastfm_artists = set()
    recent_artists = set()
    artist_playcounts = {}
    
    if not args.no_filter:
        lastfm_api_key = os.getenv('LASTFM_API_KEY')
        if not lastfm_api_key:
            print("ERROR: LASTFM_API_KEY not found in .env file")
            return 1
        
        # Get Last.fm user from .env (default: Megalox2)
        lastfm_user = os.getenv('LASTFM_USER', 'Megalox2')
        print(f"Last.fm user: {lastfm_user}")
        
        # Get min playcount from env (default 40)
        min_playcount = int(os.getenv('MIN_PLAYCOUNT', '40'))
        print(f"Minimum playcount threshold: {min_playcount}")
        
        lastfm_artists, recent_artists, artist_playcounts, artist_images = fetch_lastfm_artists(
            lastfm_api_key,
            user=lastfm_user,
            min_playcount=min_playcount
        )
        if not lastfm_artists:
            print("WARNING: No Last.fm artists loaded, proceeding without filtering")
    else:
        print("Filtering disabled - will fetch all concerts")
    
    print()
    
    # Collect all concerts from all countries
    all_concerts = []
    all_filtered_concerts = []
    
    # Initialize output file with empty array (only for JSON output)
    if args.output in ['json', 'both']:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump([], f)
        print(f"Initialized output file: {args.json}\n")
    
    for idx, country_code in enumerate(country_codes):
        # Add delay between countries to avoid rate limiting
        if idx > 0:
            delay_time = args.delay * CountryConcertParser.COUNTRY_DELAY_MULTIPLIER
            print(f"\nWaiting {delay_time} seconds before next country...")
            time.sleep(delay_time)
        
        print(f"\n{'='*80}")
        print(f"Processing country: {country_code.upper()}")
        print(f"{'='*80}")
        
        concert_parser = CountryConcertParser(
            country_code,
            max_pages=args.max_pages,
            delay=args.delay,
            lastfm_artists=lastfm_artists
        )
        
        # Define callback wrapper for incremental saving
        def save_callback(all_concerts_so_far, filtered_concerts_so_far, page_num):
            # Save based on frequency setting
            should_save = False
            
            if args.save_frequency == 'page':
                should_save = True
            elif args.save_frequency == 'auto':
                # Save every PAGES_PER_SAVE pages
                should_save = (page_num % CountryConcertParser.PAGES_PER_SAVE == 0)
            
            if should_save:
                # Save to JSON if needed
                if args.output in ['json', 'both']:
                    concert_parser.save_progress(
                        args.json,
                        all_concerts,
                        all_filtered_concerts,
                        recent_artists,
                        artist_playcounts,
                        bool(lastfm_artists)
                    )
                
                # Save to database if needed
                if args.output in ['db', 'both'] and db_writer:
                    data_to_write = filtered_concerts_so_far if lastfm_artists else all_concerts_so_far
                    db_writer.write_concerts(data_to_write, artist_playcounts, recent_artists, artist_images)
                
                print(f"  💾 Progress saved (page {page_num})")
        
        # Parse all pages for this country
        # Use callback for 'page' and 'auto' modes
        callback = save_callback if args.save_frequency in ['page', 'auto'] else None
        concert_parser.parse_all_pages(on_page_complete=callback)
        
        # Collect final results from this country
        all_concerts.extend(concert_parser.concerts)
        all_filtered_concerts.extend(concert_parser.filtered_concerts)
        
        # Save after country completion (for 'country' mode or final save for 'auto')
        if args.save_frequency in ['country', 'auto']:
            # Save to JSON if needed
            if args.output in ['json', 'both']:
                concert_parser.save_progress(
                    args.json,
                    all_concerts,
                    all_filtered_concerts,
                    recent_artists,
                    artist_playcounts,
                    bool(lastfm_artists)
                )
            
            # Save to database if needed
            if args.output in ['db', 'both'] and db_writer:
                data_to_write = concert_parser.filtered_concerts if lastfm_artists else concert_parser.concerts
                db_writer.write_concerts(data_to_write, artist_playcounts, recent_artists, artist_images)
        
        data_to_save = all_filtered_concerts if lastfm_artists else all_concerts
        output_desc = f"{args.json}" if args.output in ['json', 'both'] else "database"
        print(f"\n💾 Country complete: {len(data_to_save)} total concerts saved to {output_desc}")
        
        # Print country summary
        if not args.no_summary:
            concert_parser.print_summary()
    
    # Print overall summary
    print(f"\n\n{'='*80}")
    print("OVERALL SUMMARY")
    print(f"{'='*80}")
    print(f"Countries processed: {len(country_codes)}")
    print(f"Total concerts found: {len(all_concerts)}")
    if lastfm_artists:
        print(f"Concerts matching Last.fm artists: {len(all_filtered_concerts)}")
        print(f"Overall match rate: {len(all_filtered_concerts)/len(all_concerts)*100:.1f}%" if all_concerts else "Match rate: 0%")
    print(f"{'='*80}\n")
    
    # Final save already done incrementally
    data_to_save = all_filtered_concerts if lastfm_artists else all_concerts
    
    # Print final output message
    if args.output in ['json', 'both']:
        print(f"✅ Final output: {len(data_to_save)} concerts in {args.json}")
    
    if args.output in ['db', 'both'] and db_writer:
        db_writer.print_stats()
        db_writer.close()
        print(f"✅ Database output: {args.db_path}")
    
    # Optionally save all concerts (JSON only)
    if args.save_all and lastfm_artists and args.output in ['json', 'both']:
        all_filename = args.json.replace('.json', '_all.json')
        with open(all_filename, 'w', encoding='utf-8') as f:
            json.dump(all_concerts, f, indent=2, ensure_ascii=False)
        print(f"Saved all {len(all_concerts)} concerts to {all_filename}")
    
    return 0


if __name__ == '__main__':
    exit(main())
