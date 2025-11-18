"""
Fanart.tv API service for fetching artist images
"""

import requests
import time
from typing import Optional, Tuple
from utils import get_logger

logger = get_logger(__name__)


class FanartService:
    """Client for fanart.tv API interactions"""

    BASE_URL = "https://webservice.fanart.tv/v3/music"
    MAX_RETRIES = 3  # Number of retry attempts
    RETRY_BACKOFF = 2.0  # Exponential backoff multiplier

    def __init__(self, api_key: str, timeout: int = 10):
        """Initialize Fanart service

        Args:
            api_key: fanart.tv API key
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.timeout = timeout
    
    def fetch_artist_image(self, mbid: str, verbose: bool = False) -> Tuple[Optional[str], Optional[str]]:
        """Fetch artist image from fanart.tv with fallback options and retry logic

        Args:
            mbid: MusicBrainz ID
            verbose: If True, print retry attempts

        Returns:
            Tuple of (image_url, image_type) or (None, None) if not found
            Priority: artistthumb > artistbackground > hdmusiclogo > albumcover
        """
        url = f"{self.BASE_URL}/{mbid}"
        params = {'api_key': self.api_key}

        for attempt in range(self.MAX_RETRIES):
            try:
                response = requests.get(url, params=params, timeout=self.timeout)

                if response.status_code == 404:
                    return None, None  # Artist not found in fanart.tv

                response.raise_for_status()
                data = response.json()

                # Priority 1: artistthumb (best for artist cards)
                artist_thumbs = data.get('artistthumb', [])
                if artist_thumbs:
                    sorted_thumbs = sorted(artist_thumbs, key=lambda x: int(x.get('likes', 0)), reverse=True)
                    return sorted_thumbs[0].get('url'), 'artistthumb'

                # Priority 2: artistbackground (fallback)
                artist_backgrounds = data.get('artistbackground', [])
                if artist_backgrounds:
                    sorted_backgrounds = sorted(artist_backgrounds, key=lambda x: int(x.get('likes', 0)), reverse=True)
                    return sorted_backgrounds[0].get('url'), 'artistbackground'

                # Priority 3: hdmusiclogo
                hd_logos = data.get('hdmusiclogo', [])
                if hd_logos:
                    sorted_logos = sorted(hd_logos, key=lambda x: int(x.get('likes', 0)), reverse=True)
                    return sorted_logos[0].get('url'), 'hdmusiclogo'

                # Priority 4: albumcover (last resort - use newest album with highest ID)
                albums = data.get('albums', {})
                all_album_covers = []
                for album_id, album_data in albums.items():
                    album_covers = album_data.get('albumcover', [])
                    all_album_covers.extend(album_covers)

                if all_album_covers:
                    # Sort by ID (descending) to get the newest/highest ID
                    sorted_covers = sorted(all_album_covers, key=lambda x: int(x.get('id', 0)), reverse=True)
                    return sorted_covers[0].get('url'), 'albumcover'

                return None, None

            except requests.exceptions.Timeout:
                if attempt < self.MAX_RETRIES - 1:
                    logger.warning(f"Timeout, retrying... (attempt {attempt + 2}/{self.MAX_RETRIES})")
                    wait_time = self.RETRY_BACKOFF ** attempt
                    time.sleep(wait_time)
                    continue
                return None, None
            except requests.exceptions.HTTPError as e:
                # Don't retry on 4xx errors (client errors)
                if e.response is not None and 400 <= e.response.status_code < 500:
                    return None, None
                # Retry on 5xx errors (server errors)
                if attempt < self.MAX_RETRIES - 1:
                    logger.warning(f"HTTP {e.response.status_code if e.response else 'error'}, retrying... (attempt {attempt + 2}/{self.MAX_RETRIES})")
                    wait_time = self.RETRY_BACKOFF ** attempt
                    time.sleep(wait_time)
                    continue
                return None, None
            except requests.RequestException as e:
                if attempt < self.MAX_RETRIES - 1:
                    logger.warning(f"Error: {e}, retrying... (attempt {attempt + 2}/{self.MAX_RETRIES})")
                    wait_time = self.RETRY_BACKOFF ** attempt
                    time.sleep(wait_time)
                    continue
                return None, None

        return None, None
