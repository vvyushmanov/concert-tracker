"""
MusicBrainz service for fetching artist data
"""

import requests
import time
from typing import List, Dict, Set, Tuple, Optional
from utils import get_logger

logger = get_logger(__name__)

class MusicBrainzService:
    """Client for MusicBrainz API interactions"""

    BASE_URL = "https://musicbrainz.org/ws/2/"
    RATE_LIMIT_DELAY = 1.1  # MusicBrainz requires 1 request/second minimum
    MAX_RETRIES = 3  # Number of retry attempts
    RETRY_BACKOFF = 2.0  # Exponential backoff multiplier

    def __init__(self, timeout: int = 10):
        self.timeout = timeout
        self.last_request_time = 0
        self.request_count = 0

    def _rate_limit_wait(self):
        """Ensure we respect MusicBrainz rate limiting (1 request/second)"""
        current_time = time.time()
        time_since_last_request = current_time - self.last_request_time

        if time_since_last_request < self.RATE_LIMIT_DELAY:
            sleep_time = self.RATE_LIMIT_DELAY - time_since_last_request
            time.sleep(sleep_time)

        self.last_request_time = time.time()
        self.request_count += 1

    def fetch_artist_info(self, artist_name: str, verbose: bool = False) -> Optional[Dict]:
        """
        Fetch an artist from MusicBrainz with filters:
        - exact name match (case-insensitive)
        - highest score wins
        - automatic retries with exponential backoff

        Args:
            artist_name: Name of the artist to look up
            verbose: If True, print retry attempts

        Returns:
            Artist info dict or None if not found
        """
        url = self.BASE_URL + "artist"
        params = {
            "query": f'artist:"{artist_name}"',
            "fmt": "json"
        }
        headers = {
            "User-Agent": "ConcertTracker/1.0 (vyushmanov@example.com)"   # recommended by MusicBrainz
        }

        for attempt in range(self.MAX_RETRIES):
            try:
                # Apply rate limiting before each request
                self._rate_limit_wait()

                response = requests.get(url, params=params, headers=headers, timeout=self.timeout)
                response.raise_for_status()
                data = response.json()

                artists = data.get("artists", [])
                if not artists:
                    return None

                # Filter to exact (case-insensitive) name matches
                exact_matches = [
                    a for a in artists
                    if a.get("name", "").lower() == artist_name.lower()
                ]

                # If no exact matches, fall back to the best scored result
                if exact_matches:
                    best = max(exact_matches, key=lambda a: a.get("score", 0))
                else:
                    best = max(artists, key=lambda a: a.get("score", 0))

                return best

            except requests.exceptions.Timeout:
                if attempt < self.MAX_RETRIES - 1:
                    logger.warning(f"Timeout, retrying... (attempt {attempt + 2}/{self.MAX_RETRIES})")
                    wait_time = self.RETRY_BACKOFF ** attempt
                    time.sleep(wait_time)
                    continue
                return None
            except requests.exceptions.HTTPError as e:
                # Don't retry on 4xx errors (client errors)
                if e.response is not None and 400 <= e.response.status_code < 500:
                    return None
                # Retry on 5xx errors (server errors)
                if attempt < self.MAX_RETRIES - 1:
                    logger.warning(f"HTTP {e.response.status_code if e.response else 'error'}, retrying... (attempt {attempt + 2}/{self.MAX_RETRIES})")
                    wait_time = self.RETRY_BACKOFF ** attempt
                    time.sleep(wait_time)
                    continue
                return None
            except Exception as e:
                if attempt < self.MAX_RETRIES - 1:
                    logger.warning(f"Error: {e}, retrying... (attempt {attempt + 2}/{self.MAX_RETRIES})")
                    wait_time = self.RETRY_BACKOFF ** attempt
                    time.sleep(wait_time)
                    continue
                return None

        return None

    def get_artist_mbid(self, artist_name: str, verbose: bool = False) -> Optional[str]:
        """Get MBID for an artist by name with retry logic

        Args:
            artist_name: Artist name to look up
            verbose: If True, print retry attempts

        Returns:
            MusicBrainz ID (MBID) if found, None otherwise
        """
        artist_info = self.fetch_artist_info(artist_name, verbose=verbose)
        if artist_info:
            return artist_info.get("id", "")
        return None

    def bulk_fetch_mbids(self, artist_names: List[str]) -> Dict[str, Optional[str]]:
        """Fetch MBIDs for multiple artists with rate limiting

        Args:
            artist_names: List of artist names

        Returns:
            Dict mapping artist_name → mbid (or None if not found)
        """
        result = {}
        total = len(artist_names)

        for idx, artist_name in enumerate(artist_names, 1):
            mbid = self.get_artist_mbid(artist_name)
            result[artist_name] = mbid
            logger.info(f"MusicBrainz: Fetched {idx}/{total} MBIDs...")
            logger.debug(f"  {artist_name} -> {mbid}")

        return result
