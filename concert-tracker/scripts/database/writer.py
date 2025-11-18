"""
Database writer for concert data
Handles upserts and data conversion from parser format to database format
"""

import json

import traceback
from datetime import datetime, timezone
from typing import List, Dict, Set
from sqlalchemy.exc import IntegrityError
from utils import get_logger

logger = get_logger(__name__)

from database.models import Artist, Concert, ArtistConcert, UserArtist, UserConcert, get_session
from database.normalizers.city import CityNormalizer, get_or_create_city_mapping


class ConcertDatabaseWriter:
    """Writes concert data to database (SQLite or MySQL)"""
    
    def __init__(self, db_path: str = None, user_id: int = None, auto_add_mappings: bool = False, debug: bool = False):
        """Initialize database writer
        
        Args:
            db_path: Path to SQLite database file (for SQLite) or None to use DATABASE_URL env var (for MySQL)
            user_id: User ID for per-user data (UserArtist, UserConcert). If None, uses legacy global mode.
            auto_add_mappings: If True, automatically add common manual city mappings
            debug: If True, enable verbose logging in normalizer
        """
        self.db_path = db_path
        self.user_id = user_id
        self.debug = debug
        self.session = get_session(db_path)
        self.normalizer = CityNormalizer(self.session, verbose=debug)
        
        # Automatically add common manual mappings if enabled
        if auto_add_mappings:
            self._add_common_manual_mappings()
        
        self.stats = {
            'artists_created': 0,
            'artists_updated': 0,
            'concerts_created': 0,
            'concerts_updated': 0,
            'user_artists_created': 0,
            'user_artists_updated': 0,
            'user_concerts_created': 0,
            'artist_concert_links_created': 0,
            'artist_concert_links_skipped': 0,
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
            except Exception as e:
                logger.debug(f"Skipping manual mapping '{original}' -> '{normalized}': {e}")
    
    def close(self):
        """Close database session"""
        self.session.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
    
    def get_or_create_artist(self, name: str, mbid: str = None) -> Artist:
        """Get existing artist or create new one (shared data only)
        
        Args:
            name: Artist name
            mbid: MusicBrainz ID for fetching images later
            
        Returns:
            Artist object
        """
        artist = self.session.query(Artist).filter_by(name=name).first()
        
        if artist:
            # Update mbid if provided and changed
            if mbid and artist.mbid != mbid:
                artist.mbid = mbid
                artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                self.stats['artists_updated'] += 1
        else:
            # Create new artist (shared data only)
            artist = Artist(name=name, mbid=mbid)
            self.session.add(artist)
            self.stats['artists_created'] += 1
        
        return artist
    
    def get_or_create_user_artist(self, artist: Artist, playcount: int = 0, playcount12month: int = 0, recent: bool = False) -> UserArtist:
        """Get existing UserArtist or create new one (user-specific artist metrics)
        
        Args:
            artist: Artist object
            playcount: Last.fm overall playcount for this user
            playcount12month: Last.fm 12-month playcount for this user
            recent: Whether artist is recently listened to by this user
            
        Returns:
            UserArtist object
        """
        if not self.user_id:
            raise ValueError("user_id must be set to use per-user artist metrics")
        
        user_artist = self.session.query(UserArtist).filter_by(
            userId=self.user_id,
            artistId=artist.id
        ).first()
        
        if user_artist:
            # Update metrics if changed
            updated = False
            if playcount != 0 and user_artist.playcount != playcount:
                user_artist.playcount = playcount
                updated = True
            if user_artist.playcount12month is not None and user_artist.playcount12month != playcount12month:
                user_artist.playcount12month = playcount12month
                updated = True
            if user_artist.recent != recent:
                user_artist.recent = recent
                updated = True
            if updated:
                user_artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                self.stats['user_artists_updated'] += 1
        else:
            # Create new UserArtist
            user_artist = UserArtist(
                userId=self.user_id,
                artistId=artist.id,
                playcount=playcount,
                playcount12month=playcount12month,
                recent=recent
            )
            self.session.add(user_artist)
            self.stats['user_artists_created'] += 1
        
        return user_artist
    
    def create_user_concert_link(self, concert: Concert):
        """Create UserConcert link if it doesn't exist
        
        Args:
            concert: Concert object to link to user
        """
        if not self.user_id:
            raise ValueError("user_id must be set to create user-concert links")
        
        # Check if link already exists
        existing = self.session.query(UserConcert).filter_by(
            userId=self.user_id,
            concertId=concert.id
        ).first()
        
        if not existing:
            user_concert = UserConcert(
                userId=self.user_id,
                concertId=concert.id,
                interested=False,
                notes=None
            )
            self.session.add(user_concert)
            self.stats['user_concerts_created'] += 1
            if self.debug:
                logger.debug(f"Created UserConcert link for concert ID {concert.id}")
    
    def link_artists_to_concert(
        self, 
        concert: Concert, 
        matched_artists: List[str], 
        artist_mbids: Dict[str, str] = None,
        artist_playcounts: Dict[str, int] = None,
        artist_playcounts_12month: Dict[str, int] = None,
        recent_artists: Set[str] = None
    ):
        """Create ArtistConcert links for all matched artists
        
        Creates Artist records if they don't exist (for additional artists beyond primary).
        Also creates/updates UserArtist records for all matched artists.
        Only creates ONE primary artist link per concert (first scan wins).
        
        Args:
            concert: Concert object to link artists to
            matched_artists: List of artist names that matched Last.fm artists
            artist_mbids: Optional dict of artist MusicBrainz IDs
            artist_playcounts: Optional dict of artist overall playcounts
            artist_playcounts_12month: Optional dict of artist 12-month playcounts
            recent_artists: Optional set of recent artists
        """
        if not matched_artists:
            return
        
        artist_mbids = artist_mbids or {}
        artist_playcounts = artist_playcounts or {}
        artist_playcounts_12month = artist_playcounts_12month or {}
        recent_artists = recent_artists or set()
        
        if self.debug:
            logger.debug(f"Creating ArtistConcert links for {len(matched_artists)} matched artist(s)...")

        # Check if a primary artist already exists for this concert
        existing_primary = self.session.query(ArtistConcert).filter_by(
            concertId=concert.id,
            isPrimary=True
        ).first()

        if self.debug and existing_primary:
            primary_artist = self.session.query(Artist).filter_by(id=existing_primary.artistId).first()
            logger.debug(f"Concert already has primary artist: {primary_artist.name if primary_artist else 'Unknown'}")
        
        for idx, artist_name in enumerate(matched_artists):
            # Determine if this should be primary
            # Only mark as primary if: it's first in list AND no primary exists yet
            is_primary = (idx == 0) and (existing_primary is None)
            
            if self.debug:
                if idx == 0 and existing_primary:
                    role = "ADDITIONAL (would be primary, but one exists)"
                elif is_primary:
                    role = "PRIMARY"
                else:
                    role = "ADDITIONAL"
                logger.debug(f"[{idx+1}/{len(matched_artists)}] {role}: {artist_name}")

            # Get or create artist (will create if doesn't exist)
            mbid = artist_mbids.get(artist_name)
            artist = self.get_or_create_artist(name=artist_name, mbid=mbid)

            if self.debug:
                logger.debug(f"Artist ID: {artist.id} (MBID: {artist.mbid or 'none'})")
            
            # Create/update UserArtist with user-specific stats for ALL matched artists
            if self.user_id:
                playcount = artist_playcounts.get(artist_name, 0)
                playcount12month = artist_playcounts_12month.get(artist_name, 0)
                is_recent = artist_name in recent_artists
                
                self.get_or_create_user_artist(
                    artist=artist,
                    playcount=playcount,
                    playcount12month=playcount12month,
                    recent=is_recent
                )

                if self.debug:
                    logger.debug(f"UserArtist: playcount={playcount}, 12mo={playcount12month}, recent={is_recent}")
            
            # Check if link already exists
            existing_link = self.session.query(ArtistConcert).filter_by(
                artistId=artist.id,
                concertId=concert.id
            ).first()
            
            if existing_link:
                self.stats['artist_concert_links_skipped'] += 1
                if self.debug:
                    existing_primary_str = "PRIMARY" if existing_link.isPrimary else "ADDITIONAL"
                    logger.debug(f"Link already exists (was {existing_primary_str})")
                continue

            # Create new link
            artist_concert = ArtistConcert(
                artistId=artist.id,
                concertId=concert.id,
                isPrimary=is_primary,
                createdAt=int(datetime.now(timezone.utc).timestamp())
            )
            self.session.add(artist_concert)
            self.stats['artist_concert_links_created'] += 1

            if self.debug:
                logger.debug(f"Created link (isPrimary={is_primary})")
    
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
            return int(datetime.now(timezone.utc).timestamp())
    
    def upsert_concert(
        self,
        concert_data: Dict
    ) -> str:
        """Insert or update concert in database

        NOTE: Primary artist (artistId field) is preserved on updates to maintain
        consistency across scans. The primary artist is determined during the initial
        concert creation and stored in ArtistConcert.isPrimary. This prevents data
        inconsistency when concerts are rescanned.

        Args:
            concert_data: Concert data from parser

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
        
        # Get or create city mapping (this handles normalization internally)
        original_city = concert_data.get('city', '')
        country_name = concert_data.get('country', '')
        city_mapping = get_or_create_city_mapping(self.session, original_city, country_name, verbose=self.debug)
        
        if city_mapping:
            city_mapping_id = city_mapping.id
            country_id = city_mapping.countryId
            self.stats['cities_normalized'] += 1
        else:
            # Fallback if city mapping creation failed
            # We cannot insert a concert without a valid cityMappingId (NOT NULL constraint)
            if self.debug:
                logger.debug(f"Skipping concert - failed to create city mapping for '{original_city}' in '{country_name}'")
            raise ValueError(f"Failed to create city mapping for '{original_city}' in '{country_name}'")
        
        if concert:
            # Check if any fields have changed
            has_changes = False
            changed_fields = []
            
            new_values = {
                'eventName': concert_data.get('event_name', ''),
                'dateStart': self.parse_date(concert_data.get('date_start')),
                'dateEnd': self.parse_date(concert_data.get('date_end')),
                'venue': concert_data.get('venue', ''),
                'cityMappingId': city_mapping_id,
                'countryId': country_id,
                'postalCode': concert_data.get('postal_code'),
                'performers': performers_json,
                'imageUrl': concert_data.get('image_url'),
                'organizer': concert_data.get('organizer'),
                'organizerUrl': concert_data.get('organizer_url'),
                'ticketLinks': ticket_links_json,
            }

            # Check each field for changes
            for field, new_value in new_values.items():
                old_value = getattr(concert, field)
                if old_value != new_value:
                    has_changes = True
                    changed_fields.append(f"{field}: '{old_value}' → '{new_value}'")
                    setattr(concert, field, new_value)
            
            # Only update timestamp and increment counter if there were actual changes
            if has_changes:
                concert.updatedAt = int(datetime.now(timezone.utc).timestamp())
                self.stats['concerts_updated'] += 1
                if self.debug:
                    logger.debug(f"Updated concert: {concert_data.get('event_name', 'Unknown')}")
                    for change in changed_fields:
                        logger.debug(f"  - {change}")
            else:
                if self.debug:
                    logger.debug(f"No changes for concert: {concert_data.get('event_name', 'Unknown')} (skipped update)")
        else:
            # Create new concert (without interested/notes - those are in UserConcert now)
            concert = Concert(
                eventName=concert_data.get('event_name', ''),
                eventUrl=event_url,
                dateStart=self.parse_date(concert_data.get('date_start')),
                dateEnd=self.parse_date(concert_data.get('date_end')),
                venue=concert_data.get('venue', ''),
                cityMappingId=city_mapping_id,
                countryId=country_id,
                postalCode=concert_data.get('postal_code'),
                performers=performers_json,
                imageUrl=concert_data.get('image_url'),
                organizer=concert_data.get('organizer'),
                organizerUrl=concert_data.get('organizer_url'),
                ticketLinks=ticket_links_json
            )
            self.session.add(concert)
            self.stats['concerts_created'] += 1
            if self.debug:
                normalized = city_mapping.city_normalized.normalizedCity if city_mapping and city_mapping.city_normalized else 'Unknown'
                logger.debug(f"Created new concert: {concert_data.get('event_name', 'Unknown')}")
                logger.debug(f"  - Date: {concert_data.get('date_start')}")
                logger.debug(f"  - Venue: {concert_data.get('venue', 'Unknown')}")
                logger.debug(f"  - City: {original_city} → {normalized}")
                logger.debug(f"  - Country: {country_name}")
        
        return
    
    def write_concerts(
        self,
        concerts: List[Dict],
        artist_playcounts: Dict[str, int] = None,
        artist_playcounts_12month: Dict[str, int] = None,
        recent_artists: Set[str] = None,
        artist_mbids: Dict[str, str] = None
    ):
        """Write multiple concerts to database

        Args:
            concerts: List of concert data from parser
            artist_playcounts: Dict of artist overall playcounts (optional, can be empty if Last.fm not used)
            artist_playcounts_12month: Dict of artist 12-month playcounts (optional, can be empty if Last.fm not used)
            recent_artists: Set of recent artists (optional, can be empty if Last.fm not used)
            artist_mbids: Dict of artist MusicBrainz IDs (can be from Last.fm, MusicBrainz, or database)

        Note:
            This method gracefully handles missing Last.fm data. If playcounts/recent artists
            are not provided, artists will still be created with default values (0 playcounts).
            MBIDs can come from any source (Last.fm, MusicBrainz, or existing database records).
        """
        artist_playcounts = artist_playcounts or {}
        artist_playcounts_12month = artist_playcounts_12month or {}
        recent_artists = recent_artists or set()
        artist_mbids = artist_mbids or {}

        # Log data availability for debugging
        if self.debug:
            has_playcounts = bool(artist_playcounts or artist_playcounts_12month)
            has_mbids = bool(artist_mbids)
            has_recent = bool(recent_artists)
            logger.debug(f"Writing {len(concerts)} concerts with metadata:")
            logger.debug(f"  - Playcounts available: {'Yes' if has_playcounts else 'No'}")
            logger.debug(f"  - MBIDs available: {'Yes' if has_mbids else 'No'}")
            logger.debug(f"  - Recent artists marked: {'Yes' if has_recent else 'No'}")
        
        for concert_data in concerts:
            try:
                # Get matched artists (primary artist for this concert)
                # In filter mode: matched_artists is set by parser
                # In no-filter mode: matched_artists may be missing, use all performers
                matched_artists = concert_data.get('matched_artists', [])
                all_performers = concert_data.get('performers', [])

                # If no matched_artists (no-filter mode), use all performers
                if not matched_artists:
                    matched_artists = all_performers

                if self.debug:
                    logger.debug(f"Processing concert: {concert_data.get('event_name', 'Unknown')}")
                    logger.debug(f"  All performers: {', '.join(all_performers)}")
                    has_filter = 'matched_artists' in concert_data
                    mode = "FILTERED" if has_filter else "NO-FILTER"
                    logger.debug(f"  Mode: {mode}")
                    logger.debug(f"  Matched artists: {', '.join(matched_artists) if matched_artists else 'NONE'}")

                if not matched_artists:
                    # Skip concerts without any artists at all
                    if self.debug:
                        logger.debug("SKIPPED: No artists (no performers)")
                    continue
                
                # Upsert concert
                # Note: Artist creation is handled in link_artists_to_concert() below
                self.upsert_concert(concert_data)
                
                # Get the concert object after upsert for additional operations
                event_url = concert_data.get('event_url')
                concert = self.session.query(Concert).filter_by(eventUrl=event_url).first()
                
                if concert:
                    # Create ArtistConcert links for all matched artists
                    # Also creates/updates UserArtist records for all matched artists
                    self.link_artists_to_concert(
                        concert, 
                        matched_artists, 
                        artist_mbids,
                        artist_playcounts,
                        artist_playcounts_12month,
                        recent_artists
                    )
                    
                    # If user_id is set, create UserConcert link
                    if self.user_id:
                        self.create_user_concert_link(concert)

                self.session.commit()
                
            except Exception as e:
                logger.error(f"Error writing concert {concert_data.get('event_name', 'Unknown')}: {e}")
                # Only show full traceback in debug mode
                if self.debug:
                    logger.debug(traceback.format_exc())
                # Critical: Rollback the session to clear the dirty state
                # This prevents PendingRollbackError on subsequent operations
                self.session.rollback()
                self.stats['errors'] += 1
                continue

        # Commit all changes
        try:
            self.session.commit()
        except IntegrityError as e:
            logger.error(f"Database integrity error: {e}")
            self.session.rollback()
            self.stats['errors'] += 1
    
    def print_stats(self):
        """Print statistics about database operations"""
        logger.info("=" * 80)
        logger.info("DATABASE WRITE STATISTICS")
        logger.info("=" * 80)
        logger.info(f"Artists created: {self.stats['artists_created']}")
        logger.info(f"Artists updated: {self.stats['artists_updated']}")
        logger.info(f"Concerts created: {self.stats['concerts_created']}")
        logger.info(f"Concerts updated: {self.stats['concerts_updated']}")
        logger.info(f"Artist-Concert links created: {self.stats['artist_concert_links_created']}")
        logger.info(f"Artist-Concert links skipped: {self.stats['artist_concert_links_skipped']}")
        if self.user_id:
            logger.info(f"User-Artist links created: {self.stats['user_artists_created']}")
            logger.info(f"User-Artist links updated: {self.stats['user_artists_updated']}")
            logger.info(f"User-Concert links created: {self.stats['user_concerts_created']}")
        logger.info(f"Cities normalized: {self.stats['cities_normalized']}")
        if self.stats['errors'] > 0:
            logger.info(f"Errors: {self.stats['errors']}")
        logger.info("=" * 80)
