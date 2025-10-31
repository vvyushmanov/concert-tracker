"""
Database writer for concert data
Handles upserts and data conversion from parser format to database format
"""

import json
from datetime import datetime
from typing import List, Dict, Set
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db_models import Artist, Concert, get_session
from city_normalizer import CityNormalizer


class ConcertDatabaseWriter:
    """Writes concert data to SQLite database"""
    
    def __init__(self, db_path: str, auto_add_mappings: bool = False):
        """Initialize database writer
        
        Args:
            db_path: Path to SQLite database file
            auto_add_mappings: If True, automatically add common manual city mappings
        """
        self.db_path = db_path
        self.session = get_session(db_path)
        self.normalizer = CityNormalizer(self.session)
        
        # Automatically add common manual mappings if enabled
        if auto_add_mappings:
            self._add_common_manual_mappings()
        
        self.stats = {
            'artists_created': 0,
            'artists_updated': 0,
            'concerts_created': 0,
            'concerts_updated': 0,
            'cities_normalized': 0,
            'errors': 0
        }
    
    def _add_common_manual_mappings(self):
        """Add common manual city mappings for known metropolitan areas"""
        mappings = [
            # Lyon agglomeration (France)
            ('Lyon (Décines-Charpieu)', 'France', 'Lyon'),
            ('Décines-Charpieu', 'France', 'Lyon'),
            ('Villeurbanne', 'France', 'Lyon'),
            
            # Paris agglomeration (France)
            ('Saint-Denis', 'France', 'Paris'),
            ('Montreuil', 'France', 'Paris'),
            ('Clichy', 'France', 'Paris'),
            
            # London agglomeration (UK)
            ('Camden', 'United Kingdom', 'London'),
            ('Brixton', 'United Kingdom', 'London'),
            ('Islington', 'United Kingdom', 'London'),
            
            # Berlin agglomeration (Germany)
            ('Kreuzberg', 'Germany', 'Berlin'),
            ('Friedrichshain', 'Germany', 'Berlin'),
            
            # Frankfurt agglomeration (Germany)
            ('Wiesbaden', 'Germany', 'Frankfurt'),
        ]
        
        for original, country, normalized in mappings:
            try:
                self.normalizer.add_manual_mapping(original, country, normalized)
            except Exception:
                # Silently skip if mapping already exists
                pass
    
    def close(self):
        """Close database session"""
        self.session.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
    
    def get_or_create_artist(self, name: str, playcount: int = 0, recent: bool = False, mbid: str = None) -> Artist:
        """Get existing artist or create new one
        
        Args:
            name: Artist name
            playcount: Last.fm playcount
            recent: Whether artist is recently listened to
            mbid: MusicBrainz ID for fetching images later
            
        Returns:
            Artist object
        """
        artist = self.session.query(Artist).filter_by(name=name).first()
        
        if artist:
            # Update playcount, recent flag, and mbid if changed
            updated = False
            if artist.playcount != playcount:
                artist.playcount = playcount
                updated = True
            if artist.recent != recent:
                artist.recent = recent
                updated = True
            if mbid and artist.mbid != mbid:
                artist.mbid = mbid
                updated = True
            if updated:
                self.stats['artists_updated'] += 1
        else:
            # Create new artist
            artist = Artist(name=name, playcount=playcount, recent=recent, mbid=mbid)
            self.session.add(artist)
            self.stats['artists_created'] += 1
        
        return artist
    
    def parse_date(self, date_str: str) -> int:
        """Parse date string to Unix timestamp
        
        Args:
            date_str: Date string in format YYYY-MM-DD
            
        Returns:
            Unix timestamp (seconds since epoch)
        """
        try:
            dt = datetime.strptime(date_str, '%Y-%m-%d')
            return int(dt.timestamp())
        except (ValueError, TypeError):
            # Fallback to current date if parsing fails
            return int(datetime.utcnow().timestamp())
    
    def upsert_concert(
        self,
        concert_data: Dict,
        artist: Artist,
        artist_playcounts: Dict[str, int] = None,
        recent_artists: Set[str] = None
    ) -> str:
        """Insert or update concert in database
        
        Args:
            concert_data: Concert data from parser
            artist: Artist object (primary artist for this concert)
            artist_playcounts: Dict of artist playcounts from Last.fm
            recent_artists: Set of recent artists from Last.fm
            
        Returns:
            Normalized city name
        """
        event_url = concert_data.get('event_url')
        if not event_url:
            raise ValueError("Concert must have event_url")
        
        # Check if concert already exists
        concert = self.session.query(Concert).filter_by(eventUrl=event_url).first()
        
        # Prepare data
        performers_json = json.dumps(concert_data.get('performers', []))
        ticket_links_json = json.dumps(concert_data.get('ticket_links', []))
        
        # Normalize city name
        original_city = concert_data.get('city', '')
        country = concert_data.get('country', '')
        normalized_city = self.normalizer.normalize(original_city, country)
        self.stats['cities_normalized'] += 1
        
        if concert:
            # Update existing concert
            concert.eventName = concert_data.get('event_name', '')
            concert.dateStart = self.parse_date(concert_data.get('date_start'))
            concert.dateEnd = self.parse_date(concert_data.get('date_end'))
            concert.venue = concert_data.get('venue', '')
            concert.city = original_city
            concert.normalizedCity = normalized_city
            concert.country = country
            concert.postalCode = concert_data.get('postal_code')
            concert.performers = performers_json
            concert.imageUrl = concert_data.get('image_url')
            concert.organizer = concert_data.get('organizer')
            concert.organizerUrl = concert_data.get('organizer_url')
            concert.ticketLinks = ticket_links_json
            concert.artistId = artist.id
            concert.updatedAt = int(datetime.utcnow().timestamp())
            
            self.stats['concerts_updated'] += 1
        else:
            # Create new concert
            concert = Concert(
                eventName=concert_data.get('event_name', ''),
                eventUrl=event_url,
                dateStart=self.parse_date(concert_data.get('date_start')),
                dateEnd=self.parse_date(concert_data.get('date_end')),
                venue=concert_data.get('venue', ''),
                city=original_city,
                normalizedCity=normalized_city,
                country=country,
                postalCode=concert_data.get('postal_code'),
                performers=performers_json,
                imageUrl=concert_data.get('image_url'),
                organizer=concert_data.get('organizer'),
                organizerUrl=concert_data.get('organizer_url'),
                ticketLinks=ticket_links_json,
                artistId=artist.id,
                interested=False,
                notes=None
            )
            self.session.add(concert)
            self.stats['concerts_created'] += 1
        
        return normalized_city
    
    def write_concerts(
        self,
        concerts: List[Dict],
        artist_playcounts: Dict[str, int] = None,
        recent_artists: Set[str] = None,
        artist_mbids: Dict[str, str] = None
    ):
        """Write multiple concerts to database
        
        Args:
            concerts: List of concert data from parser
            artist_playcounts: Dict of artist playcounts from Last.fm
            recent_artists: Set of recent artists from Last.fm
            artist_mbids: Dict of artist MusicBrainz IDs from Last.fm
        """
        artist_playcounts = artist_playcounts or {}
        recent_artists = recent_artists or set()
        artist_mbids = artist_mbids or {}
        
        for concert_data in concerts:
            try:
                # Get matched artists (primary artist for this concert)
                matched_artists = concert_data.get('matched_artists', [])
                
                if not matched_artists:
                    # Skip concerts without matched artists
                    continue
                
                # Use first matched artist as primary
                primary_artist_name = matched_artists[0]
                playcount = artist_playcounts.get(primary_artist_name, 0)
                is_recent = primary_artist_name in recent_artists
                mbid = artist_mbids.get(primary_artist_name)
                
                # Get or create artist
                artist = self.get_or_create_artist(
                    name=primary_artist_name,
                    playcount=playcount,
                    recent=is_recent,
                    mbid=mbid
                )
                
                # Upsert concert and get normalized city
                normalized_city = self.upsert_concert(
                    concert_data,
                    artist,
                    artist_playcounts,
                    recent_artists
                )
                
                # Store normalized city back in concert_data for display purposes
                if normalized_city:
                    concert_data['normalizedCity'] = normalized_city
                
            except Exception as e:
                print(f"Error writing concert {concert_data.get('event_name', 'Unknown')}: {e}")
                self.stats['errors'] += 1
                continue
        
        # Commit all changes
        try:
            self.session.commit()
        except IntegrityError as e:
            print(f"Database integrity error: {e}")
            self.session.rollback()
            self.stats['errors'] += 1
    
    def print_stats(self):
        """Print statistics about database operations"""
        print(f"\n{'='*80}")
        print("DATABASE WRITE STATISTICS")
        print(f"{'='*80}")
        print(f"Artists created: {self.stats['artists_created']}")
        print(f"Artists updated: {self.stats['artists_updated']}")
        print(f"Concerts created: {self.stats['concerts_created']}")
        print(f"Concerts updated: {self.stats['concerts_updated']}")
        print(f"Cities normalized: {self.stats['cities_normalized']}")
        if self.stats['errors'] > 0:
            print(f"Errors: {self.stats['errors']}")
        print(f"{'='*80}\n")
