"""
MusicBrainz service for fetching artist data
"""

import requests
from typing import List, Dict, Set, Tuple, Optional

class MusicBrainzService:
    """Client for MusicBrainz API interactions"""
    
    BASE_URL = "https://musicbrainz.org/ws/2/"
    RATE_LIMIT_DELAY = 1.1
    # TODO: implement rate limiting

    

    def __init__(self, timeout: int = 10):
        self.timeout = timeout


    def fetch_artist_info(self, artist_name: str) -> Optional[Dict]:
        """
        Fetch an artist from MusicBrainz with filters:
        - exact name match (case-insensitive)
        - highest score wins
        """

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
        artist_info = self.fetch_artist_info(artist_name)
        if artist_info:
            return artist_info.get("id", "")
        return None
                
        