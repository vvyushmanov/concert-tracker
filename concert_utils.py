#!/usr/bin/env python3
"""
Utility functions for concert parsing
"""

import requests
from typing import List, Dict, Set


def restructure_concerts_by_country_and_band(
    concerts: List[Dict], 
    recent_artists: Set[str], 
    artist_playcounts: Dict[str, int]
) -> Dict:
    """Restructure concerts into nested dict: country -> band -> concerts
    
    Args:
        concerts: List of concert dicts
        recent_artists: Set of artists listened to in last 12 months
        artist_playcounts: Dict of artist -> playcount
    
    Returns:
        Dict structured as: {country: {band: [concerts]}}
    """
    result = {}
    
    for concert in concerts:
        country = concert.get('country', 'Unknown')
        matched_artists = concert.get('matched_artists', [])
        
        # Initialize country if not exists
        if country not in result:
            result[country] = {}
        
        # Add concert under each matched artist
        for artist in matched_artists:
            if artist not in result[country]:
                result[country][artist] = {
                    'playcount': artist_playcounts.get(artist, 0),
                    'recent': artist in recent_artists,
                    'concerts': []
                }
            
            # Create concert entry without redundant fields
            concert_entry = {
                'event_name': concert.get('event_name'),
                'event_url': concert.get('event_url'),
                'date_start': concert.get('date_start'),
                'date_end': concert.get('date_end'),
                'venue': concert.get('venue'),
                'city': concert.get('city'),
                'postal_code': concert.get('postal_code'),
                'performers': concert.get('performers', []),
                'image_url': concert.get('image_url'),
                'organizer': concert.get('organizer'),
                'organizer_url': concert.get('organizer_url'),
                'ticket_links': concert.get('ticket_links', [])
            }
            
            result[country][artist]['concerts'].append(concert_entry)
    
    return result


def fetch_lastfm_artists(
    api_key: str, 
    user: str, 
    limit: int = 400, 
    min_playcount: int = 40
) -> tuple:
    """Fetch top artists from Last.fm with playcount filtering
    
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
    """
    print("Fetching top artists from Last.fm...")
    
    url = "http://ws.audioscrobbler.com/2.0/"
    
    # Fetch overall top artists
    print("  - Fetching overall top artists...")
    params_overall = {
        "method": "user.gettopartists",
        "api_key": api_key,
        "user": user,
        "format": "json",
        "limit": limit
    }
    
    # Fetch 12-month top artists
    print("  - Fetching last 12 months top artists...")
    params_12month = {
        "method": "user.gettopartists",
        "api_key": api_key,
        "user": user,
        "format": "json",
        "limit": limit,
        "period": "12month"
    }
    
    try:
        # Get overall artists
        response_overall = requests.get(url, params=params_overall, timeout=10)
        response_overall.raise_for_status()
        data_overall = response_overall.json()
        
        # Get 12-month artists
        response_12month = requests.get(url, params=params_12month, timeout=10)
        response_12month.raise_for_status()
        data_12month = response_12month.json()
        
        # Process overall artists
        artists_overall = data_overall.get("topartists", {}).get("artist", [])
        overall_playcounts = {}
        filtered_artists = set()
        
        for artist in artists_overall:
            name = artist.get("name")
            playcount = int(artist.get("playcount", 0))
            if name:
                overall_playcounts[name] = playcount
                if playcount >= min_playcount:
                    filtered_artists.add(name)
        
        # Process 12-month artists
        artists_12month = data_12month.get("topartists", {}).get("artist", [])
        recent_artists = set()
        
        for artist in artists_12month:
            name = artist.get("name")
            if name and name in filtered_artists:  # Only include if meets playcount threshold
                recent_artists.add(name)
        
        print(f"  ✓ Loaded {len(filtered_artists)} artists (with {min_playcount}+ plays)")
        print(f"  ✓ {len(recent_artists)} artists listened to in last 12 months")
        
        return filtered_artists, recent_artists, overall_playcounts
    except Exception as e:
        print(f"Error fetching Last.fm data: {e}")
        return set(), set(), {}
