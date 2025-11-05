#!/usr/bin/env python3
"""
Utility functions for concert parsing

DEPRECATED: This module provides backward-compatible wrappers.
New code should use the services/ and utils/ modules directly.
"""

from typing import List, Dict, Set, Tuple, Optional

# Import from new locations
from services.lastfm_service import LastFMService
from utils.data_transform import restructure_concerts_by_country_and_band


# Backward-compatible wrapper functions
def fetch_lastfm_artists(
    api_key: str, 
    user: str, 
    limit: int = 400, 
    min_playcount: int = 40
) -> tuple:
    """Fetch top artists from Last.fm with playcount filtering
    
    DEPRECATED: Use LastFMService.fetch_top_artists() instead
    
    Args:
        api_key: Last.fm API key
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
    service = LastFMService(api_key)
    return service.fetch_top_artists(user, limit, min_playcount)


def fetch_all_user_artists(api_key: str, user: str, limit: int = 1000) -> Tuple[Dict[str, Dict], Dict[str, Dict]]:
    """Fetch all user's artists from Last.fm (overall and 12-month periods)
    
    DEPRECATED: Use LastFMService.fetch_all_user_artists() instead
    
    Args:
        api_key: Last.fm API key
        user: Last.fm username
        limit: Max artists to fetch (default 1000, API max)
        
    Returns:
        Tuple of:
        - Dict mapping artist identifier -> overall artist data (with playcount, mbid, name)
        - Dict mapping artist identifier -> 12-month artist data (with playcount, mbid, name)
    """
    service = LastFMService(api_key)
    return service.fetch_all_user_artists(user, limit)


def lookup_artist_playcounts(
    artist_name: str,
    artist_mbid: Optional[str],
    overall_dict: Dict[str, Dict],
    month12_dict: Dict[str, Dict]
) -> Tuple[int, int, Optional[str]]:
    """Look up artist playcounts from pre-fetched user artist data
    
    DEPRECATED: Use LastFMService.lookup_artist_playcounts() instead
    
    Args:
        artist_name: Artist name
        artist_mbid: Artist MusicBrainz ID (can be None)
        overall_dict: Dict from fetch_all_user_artists (overall period)
        month12_dict: Dict from fetch_all_user_artists (12-month period)
        
    Returns:
        Tuple of (overall_playcount, playcount_12month, mbid_found)
    """
    service = LastFMService("")  # API key not needed for lookup
    return service.lookup_artist_playcounts(artist_name, artist_mbid, overall_dict, month12_dict)
