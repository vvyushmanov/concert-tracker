"""
Last.fm API service for fetching artist data and playcounts
"""

import requests
from typing import List, Dict, Set, Tuple, Optional


class LastFMService:
    """Client for Last.fm API interactions"""
    
    BASE_URL = "http://ws.audioscrobbler.com/2.0/"
    
    def __init__(self, api_key: str, timeout: int = 10):
        """Initialize Last.fm service
        
        Args:
            api_key: Last.fm API key
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.timeout = timeout
    
    def fetch_top_artists(
        self,
        user: str,
        limit: int = 400,
        min_playcount: int = 40
    ) -> Tuple[Set[str], Set[str], Dict[str, int], Dict[str, int], Dict[str, str]]:
        """Fetch top artists from Last.fm with playcount filtering
        
        Args:
            user: Last.fm username
            limit: Maximum number of artists to fetch
            min_playcount: Minimum playcount threshold
        
        Returns:
            Tuple of:
            - Set of all artist names (with min_playcount filter)
            - Set of recent artist names (listened in last 12 months)
            - Dict of artist name -> overall playcount
            - Dict of artist name -> 12-month playcount
            - Dict of artist name -> MusicBrainz ID
        """
        print("Fetching top artists from Last.fm...")
        
        # Fetch overall top artists
        print("  - Fetching overall top artists...")
        params_overall = {
            "method": "user.gettopartists",
            "api_key": self.api_key,
            "user": user,
            "format": "json",
            "limit": limit
        }
        
        # Fetch 12-month top artists
        print("  - Fetching last 12 months top artists...")
        params_12month = {
            "method": "user.gettopartists",
            "api_key": self.api_key,
            "user": user,
            "format": "json",
            "limit": limit,
            "period": "12month"
        }
        
        try:
            # Get overall artists
            response_overall = requests.get(self.BASE_URL, params=params_overall, timeout=self.timeout)
            response_overall.raise_for_status()
            data_overall = response_overall.json()
            
            # Get 12-month artists
            response_12month = requests.get(self.BASE_URL, params=params_12month, timeout=self.timeout)
            response_12month.raise_for_status()
            data_12month = response_12month.json()
            
            # Process overall artists
            artists_overall = data_overall.get("topartists", {}).get("artist", [])
            overall_playcounts = {}
            artist_mbids = {}
            filtered_artists = set()
            
            for artist in artists_overall:
                name = artist.get("name")
                playcount = int(artist.get("playcount", 0))
                if name:
                    overall_playcounts[name] = playcount
                    
                    # Extract MusicBrainz ID for later image fetching
                    mbid = artist.get("mbid", "").strip()
                    if mbid:
                        artist_mbids[name] = mbid
                    
                    if playcount >= min_playcount:
                        filtered_artists.add(name)
            
            # Process 12-month artists
            artists_12month = data_12month.get("topartists", {}).get("artist", [])
            recent_artists = set()
            playcounts_12month = {}
            
            for artist in artists_12month:
                name = artist.get("name")
                playcount_12m = int(artist.get("playcount", 0))
                if name:
                    playcounts_12month[name] = playcount_12m
                    if name in filtered_artists:  # Only include if meets overall playcount threshold
                        recent_artists.add(name)
            
            print(f"  ✓ Loaded {len(filtered_artists)} artists (with {min_playcount}+ plays)")
            print(f"  ✓ {len(recent_artists)} artists listened to in last 12 months")
            print(f"  ✓ {len(artist_mbids)} artists with MusicBrainz IDs")
            
            return filtered_artists, recent_artists, overall_playcounts, playcounts_12month, artist_mbids
        except Exception as e:
            print(f"Error fetching Last.fm data: {e}")
            return set(), set(), {}, {}, {}
    
    def fetch_all_user_artists(
        self,
        user: str,
        limit: int = 1000
    ) -> Tuple[Dict[str, Dict], Dict[str, Dict]]:
        """Fetch all user's artists from Last.fm (overall and 12-month periods)
        
        This is much more efficient than fetching per-artist data when refreshing metadata
        for multiple artists. Makes only 2 API calls total.
        
        Args:
            user: Last.fm username
            limit: Max artists to fetch (default 1000, API max)
            
        Returns:
            Tuple of:
            - Dict mapping artist identifier -> overall artist data (with playcount, mbid, name)
            - Dict mapping artist identifier -> 12-month artist data (with playcount, mbid, name)
            
            Artist identifier is MBID if available, otherwise lowercase artist name
        """
        print("Fetching all user artists from Last.fm...")
        
        try:
            # Fetch overall top artists
            params_overall = {
                'method': 'user.gettopartists',
                'user': user,
                'api_key': self.api_key,
                'format': 'json',
                'limit': limit
            }
            
            print("  Fetching overall top artists...")
            response_overall = requests.get(self.BASE_URL, params=params_overall, timeout=30)
            response_overall.raise_for_status()
            data_overall = response_overall.json()
            
            # Fetch 12-month top artists
            params_12month = {
                'method': 'user.gettopartists',
                'user': user,
                'api_key': self.api_key,
                'format': 'json',
                'limit': limit,
                'period': '12month'
            }
            
            print("  Fetching 12-month top artists...")
            response_12month = requests.get(self.BASE_URL, params=params_12month, timeout=30)
            response_12month.raise_for_status()
            data_12month = response_12month.json()
            
            # Process both artist lists
            artists_overall = data_overall.get('topartists', {}).get('artist', [])
            artists_12month = data_12month.get('topartists', {}).get('artist', [])
            
            overall_dict = self._process_artist_list(artists_overall)
            month12_dict = self._process_artist_list(artists_12month)
            
            print(f"  ✓ Loaded {len(overall_dict)} overall artists")
            print(f"  ✓ Loaded {len(month12_dict)} 12-month artists")
            
            return overall_dict, month12_dict
            
        except Exception as e:
            print(f"Error fetching Last.fm user artists: {e}")
            return {}, {}
    
    def get_artist_info(self, artist_name: str) -> Optional[Dict]:
        """Get artist info from Last.fm (includes MBID)
        
        Args:
            artist_name: Artist name to look up
            
        Returns:
            Artist data dict or None if not found
        """
        try:
            params = {
                'method': 'artist.getinfo',
                'artist': artist_name,
                'api_key': self.api_key,
                'format': 'json'
            }
            response = requests.get(self.BASE_URL, params=params, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            
            if 'artist' in data:
                return data['artist']
            return None
        except Exception:
            return None
    
    def lookup_artist_playcounts(
        self,
        artist_name: str,
        artist_mbid: Optional[str],
        overall_dict: Dict[str, Dict],
        month12_dict: Dict[str, Dict]
    ) -> Tuple[int, int, Optional[str]]:
        """Look up artist playcounts from pre-fetched user artist data
        
        Args:
            artist_name: Artist name
            artist_mbid: Artist MusicBrainz ID (can be None)
            overall_dict: Dict from fetch_all_user_artists (overall period)
            month12_dict: Dict from fetch_all_user_artists (12-month period)
            
        Returns:
            Tuple of (overall_playcount, playcount_12month, mbid_found)
            mbid_found is the MBID if discovered during lookup, None otherwise
        """
        overall_playcount = 0
        playcount_12month = 0
        mbid_found = artist_mbid
        found_via_mbid = False
        
        # Try to find by MBID first (most reliable)
        if artist_mbid:
            if artist_mbid in overall_dict:
                overall_playcount = overall_dict[artist_mbid]['playcount']
                found_via_mbid = True
            if artist_mbid in month12_dict:
                playcount_12month = month12_dict[artist_mbid]['playcount']
                found_via_mbid = True
        
        # Fallback to name lookup if MBID lookup didn't find anything
        if not found_via_mbid:
            name_key = artist_name.lower()
            if name_key in overall_dict:
                data = overall_dict[name_key]
                overall_playcount = data['playcount']
                # Capture MBID if we found it via name lookup
                if not mbid_found and data['mbid']:
                    mbid_found = data['mbid']
            if name_key in month12_dict:
                data = month12_dict[name_key]
                playcount_12month = data['playcount']
                # Capture MBID if we found it via name lookup
                if not mbid_found and data['mbid']:
                    mbid_found = data['mbid']
        
        return overall_playcount, playcount_12month, mbid_found
    
    def _process_artist_list(self, artists: List[Dict]) -> Dict[str, Dict]:
        """Helper to process artist list into lookup dict
        
        Args:
            artists: List of artist dicts from Last.fm API
            
        Returns:
            Dict mapping artist identifier -> artist data (name, mbid, playcount)
            Stores entries with both MBID (if available) and lowercase name as keys
        """
        result = {}
        for artist in artists:
            name = artist.get('name', '')
            if not name:
                continue
                
            mbid = artist.get('mbid', '').strip()
            playcount = int(artist.get('playcount', 0))
            
            artist_data = {
                'name': name,
                'mbid': mbid if mbid else None,
                'playcount': playcount
            }
            
            # Always store by lowercase name for fallback lookup
            result[name.lower()] = artist_data
            
            # Also store by MBID if available (for faster MBID-based lookup)
            if mbid:
                result[mbid] = artist_data
        
        return result
