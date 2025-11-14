"""
MusicBrainz service for fetching artist data
"""

import requests
import time
from typing import List, Dict, Set, Tuple, Optional

class MusicBrainzService:
    """Client for MusicBrainz API interactions"""

    BASE_URL = "https://musicbrainz.org/ws/2/"
    RATE_LIMIT_DELAY = 1.1  # MusicBrainz requires 1 request/second minimum

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

    def fetch_artist_info(self, artist_name: str) -> Optional[Dict]:
        """
        Fetch an artist from MusicBrainz with filters:
        - exact name match (case-insensitive)
        - highest score wins
        """
        self._rate_limit_wait()

        url = self.BASE_URL + "artist"
        params = {
            "query": f'artist:"{artist_name}"',
            "fmt": "json"
        }
        headers = {
            "User-Agent": "ConcertTracker/1.0 (vyushmanov@example.com)"   # recommended by MusicBrainz
        }

        try:
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

        except Exception as e:
            print(f"Error fetching MusicBrainz data: {e}")
            return None

    def get_artist_mbid(self, artist_name: str) -> Optional[str]:
        """Get MBID for an artist by name

        Args:
            artist_name: Artist name to look up

        Returns:
            MusicBrainz ID (MBID) if found, None otherwise
        """
        artist_info = self.fetch_artist_info(artist_name)
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

            if idx % 10 == 0 or idx == total:
                print(f"  MusicBrainz: Fetched {idx}/{total} MBIDs...")

        return result
