"""
Concert parsing and filtering logic

Handles artist matching and concert filtering based on Last.fm data.
"""

from typing import List, Dict, Set, Tuple
from parsers.html_extractor import ConcertHTMLExtractor


class ConcertParser:
    """Parses and filters concert data based on Last.fm artists"""
    
    def __init__(self, lastfm_artists: Set[str], base_url: str = "https://en.concerts-metal.com"):
        """Initialize concert parser
        
        Args:
            lastfm_artists: Set of Last.fm artist names to filter by
            base_url: Base URL for HTML extraction
        """
        self.lastfm_artists = lastfm_artists
        self.html_extractor = ConcertHTMLExtractor(base_url)
        
        # Create normalized lookup dict for O(1) artist matching
        self.lastfm_artists_normalized = {
            artist.lower().strip(): artist 
            for artist in lastfm_artists
        }
    
    def matches_lastfm_artists(self, performers: List[str]) -> List[str]:
        """Check if any performer matches Last.fm artists list
        
        Args:
            performers: List of performer names from concert
            
        Returns:
            List of matched Last.fm artist names (using Last.fm capitalization)
        """
        if not self.lastfm_artists_normalized:
            return []  # If no filter, return empty list
        
        matched = []
        # O(1) lookup using normalized dictionary
        for performer in performers:
            normalized = performer.lower().strip()
            if normalized in self.lastfm_artists_normalized:
                original = self.lastfm_artists_normalized[normalized]
                if original not in matched:
                    matched.append(original)
        return matched
    
    def filter_concerts(self, concerts: List[Dict]) -> Tuple[List[Dict], int, int]:
        """Filter concerts by Last.fm artists and add matched_artists field
        
        Args:
            concerts: List of concert dicts
            
        Returns:
            Tuple of (filtered_concerts, total_count, matched_count)
        """
        filtered = []
        total_count = len(concerts)
        matched_count = 0
        
        for concert in concerts:
            performers = concert.get('performers', [])
            matched_artists = self.matches_lastfm_artists(performers)
            
            if matched_artists:
                # Add matched artists to concert data
                concert['matched_artists'] = matched_artists
                filtered.append(concert)
                matched_count += 1
        
        return filtered, total_count, matched_count
    
    def parse_and_filter_page(self, soup) -> Tuple[List[Dict], List[Dict]]:
        """Parse a page and filter concerts by Last.fm artists
        
        Args:
            soup: BeautifulSoup object of the page
            
        Returns:
            Tuple of (all_concerts, filtered_concerts)
        """
        # Extract all events from page
        all_concerts = self.html_extractor.extract_events_from_page(soup)
        
        # Filter and add matched_artists field
        filtered_concerts, _, _ = self.filter_concerts(all_concerts)
        
        return all_concerts, filtered_concerts
