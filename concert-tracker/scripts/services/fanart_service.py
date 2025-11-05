"""
Fanart.tv API service for fetching artist images
"""

import requests
from typing import Optional, Tuple


class FanartService:
    """Client for fanart.tv API interactions"""
    
    BASE_URL = "https://webservice.fanart.tv/v3/music"
    
    def __init__(self, api_key: str, timeout: int = 10):
        """Initialize Fanart service
        
        Args:
            api_key: fanart.tv API key
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.timeout = timeout
    
    def fetch_artist_image(self, mbid: str) -> Tuple[Optional[str], Optional[str]]:
        """Fetch artist image from fanart.tv with fallback options
        
        Args:
            mbid: MusicBrainz ID
            
        Returns:
            Tuple of (image_url, image_type) or (None, None) if not found
            Priority: artistthumb > artistbackground > hdmusiclogo > albumcover
        """
        url = f"{self.BASE_URL}/{mbid}"
        params = {'api_key': self.api_key}
        
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
            
        except requests.RequestException:
            return None, None
