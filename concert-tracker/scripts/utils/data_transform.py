"""
Data transformation utilities for concert data
"""

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
