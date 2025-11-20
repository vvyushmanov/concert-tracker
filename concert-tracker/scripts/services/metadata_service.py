"""
Artist metadata service

Orchestrates fetching artist metadata from Last.fm and Fanart.tv.
Handles MBID repair, image fetching, and playcount updates.
"""

import requests
from typing import Optional, Tuple, Dict, List, Any
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from database.models import Artist, UserArtist
from services.lastfm_service import LastFMService
from services.fanart_service import FanartService
from utils import get_logger

logger = get_logger(__name__)

class ArtistMetadataService:
    """Service for fetching and updating artist metadata"""

    def __init__(self, lastfm_api_key: Optional[str] = None, fanart_api_key: Optional[str] = None, lastfm_user: Optional[str] = None) -> None:
        """Initialize metadata service

        Args:
            lastfm_api_key: Last.fm API key (optional)
            fanart_api_key: Fanart.tv API key (optional)
            lastfm_user: Last.fm username (optional, for playcount fetching)
        """
        self.lastfm_service = LastFMService(lastfm_api_key) if lastfm_api_key else None
        self.fanart_service = FanartService(fanart_api_key) if fanart_api_key else None
        self.lastfm_user = lastfm_user
        self.musicbrainz_service = None  # Lazy initialization

    def has_lastfm(self) -> bool:
        """Check if Last.fm is configured"""
        return self.lastfm_service is not None and self.lastfm_user is not None

    def has_fanart(self) -> bool:
        """Check if Fanart.tv is configured"""
        return self.fanart_service is not None

    def _get_musicbrainz_service(self) -> Any:
        """Lazy initialize MusicBrainz service"""
        if self.musicbrainz_service is None:
            from services.musicbrainz_service import MusicBrainzService
            self.musicbrainz_service = MusicBrainzService()
        return self.musicbrainz_service
    
    def repair_mbid(self, artist: Artist, overall_dict: Optional[Dict[str, Any]] = None, month12_dict: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """Attempt to find and set MBID for an artist

        Strategy:
            1. Try MusicBrainz first (always available, no auth required)
            2. Fall back to Last.fm if configured and MusicBrainz fails

        Args:
            artist: Artist object
            overall_dict: Pre-fetched overall artist data (optional, from Last.fm)
            month12_dict: Pre-fetched 12-month artist data (optional, from Last.fm)

        Returns:
            MBID if found, None otherwise
        """
        mbid = None
        source = None

        # Primary: Try MusicBrainz first
        try:
            mb_service = self._get_musicbrainz_service()
            mbid = mb_service.get_artist_mbid(artist.name)
            if mbid:
                source = "MusicBrainz"
        except Exception as e:
            logger.warning(f"MusicBrainz lookup failed for {artist.name}: {e}")

        # Fallback to Last.fm if configured and MusicBrainz failed
        if not mbid and self.has_lastfm():
            # Try lookup from pre-fetched data first
            if overall_dict and month12_dict:
                _, _, mbid = self.lastfm_service.lookup_artist_playcounts(
                    artist.name,
                    None,
                    overall_dict,
                    month12_dict
                )
                if mbid:
                    source = "Last.fm (cached)"

            # Fallback to artist.getinfo API call
            if not mbid:
                artist_info = self.lastfm_service.get_artist_info(artist.name)
                if artist_info:
                    mbid = artist_info.get('mbid')
                    if mbid:
                        source = "Last.fm (API)"

        if mbid and source:
            logger.info(f"Found MBID for {artist.name} via {source}: {mbid}")

        return mbid
    
    def fetch_artist_image(self, artist: Artist) -> Tuple[Optional[str], Optional[str]]:
        """Fetch artist image from Fanart.tv

        Args:
            artist: Artist object with MBID

        Returns:
            Tuple of (image_url, image_type) or (None, None)
        """
        if not artist.mbid:
            return None, None

        if not self.has_fanart():
            return None, None

        return self.fanart_service.fetch_artist_image(artist.mbid)
    
    def update_artist_metadata(self, session: Session, artist: Artist,
                              fetch_mbid: bool = True, fetch_image: bool = True,
                              overall_dict: Optional[Dict[str, Any]] = None, month12_dict: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Update artist metadata (MBID and/or image)

        Args:
            session: Database session
            artist: Artist object
            fetch_mbid: Whether to fetch MBID if missing
            fetch_image: Whether to fetch image
            overall_dict: Pre-fetched overall artist data (optional)
            month12_dict: Pre-fetched 12-month artist data (optional)

        Returns:
            Dict with update results: {'mbid_updated': bool, 'image_updated': bool, 'mbid': str, 'image_url': str}
        """
        result = {
            'mbid_updated': False,
            'image_updated': False,
            'mbid': artist.mbid,
            'image_url': artist.imageUrl
        }
        
        # Fetch MBID if missing and requested
        if fetch_mbid and not artist.mbid:
            mbid = self.repair_mbid(artist, overall_dict, month12_dict)
            if mbid:
                artist.mbid = mbid
                artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                result['mbid_updated'] = True
                result['mbid'] = mbid
        
        # Fetch image if MBID available and requested
        if fetch_image and artist.mbid:
            image_url, image_type = self.fetch_artist_image(artist)
            if image_url:
                artist.imageUrl = image_url
                artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                result['image_updated'] = True
                result['image_url'] = image_url
        
        return result
    
    def update_user_artist_stats(self, session: Session, user_id: int, artist: Artist,
                                 overall_dict: Optional[Dict[str, Any]] = None, month12_dict: Optional[Dict[str, Any]] = None) -> Tuple[int, int]:
        """Update or create UserArtist stats for a specific user

        Args:
            session: Database session
            user_id: User ID
            artist: Artist object
            overall_dict: Pre-fetched overall artist data (optional, from Last.fm)
            month12_dict: Pre-fetched 12-month artist data (optional, from Last.fm)

        Returns:
            Tuple of (overall_playcount, playcount_12month)
        """
        # Return zeros if Last.fm not configured
        if not self.has_lastfm():
            logger.warning(f"Skipping playcount update for {artist.name} (Last.fm not configured)")
            return 0, 0

        # Lookup playcounts
        playcount, playcount12month, mbid = self.lastfm_service.lookup_artist_playcounts(
            artist.name,
            artist.mbid,
            overall_dict or {},
            month12_dict or {}
        )

        # Update MBID if discovered during lookup
        if mbid and not artist.mbid:
            artist.mbid = mbid
            artist.updatedAt = int(datetime.now(timezone.utc).timestamp())

        # Update or create UserArtist
        user_artist = session.query(UserArtist).filter_by(
            userId=user_id,
            artistId=artist.id
        ).first()

        if user_artist:
            # Update existing
            user_artist.playcount = playcount
            user_artist.playcount12month = playcount12month
            user_artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
        else:
            # Create new
            user_artist = UserArtist(
                userId=user_id,
                artistId=artist.id,
                playcount=playcount,
                playcount12month=playcount12month,
                recent=False  # Will be updated by parser
            )
            session.add(user_artist)

        return playcount, playcount12month
    
    def bulk_repair_mbids(self, session: Session, artists: List[Artist]) -> int:
        """Bulk repair MBIDs for multiple artists

        Strategy:
            1. Try MusicBrainz bulk fetch first (always available)
            2. Fall back to Last.fm bulk fetch if configured

        Args:
            session: Database session
            artists: List of Artist objects without MBIDs

        Returns:
            Number of MBIDs repaired
        """
        if not artists:
            return 0

        repaired_count = 0

        # Try MusicBrainz bulk fetch first
        try:
            mb_service = self._get_musicbrainz_service()
            artist_names = [a.name for a in artists if not a.mbid]

            if artist_names:
                logger.info(f"Fetching {len(artist_names)} MBIDs from MusicBrainz...")
                mb_results = mb_service.bulk_fetch_mbids(artist_names)

                for artist in artists:
                    if artist.mbid:
                        continue

                    mbid = mb_results.get(artist.name)
                    if mbid:
                        artist.mbid = mbid
                        artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                        repaired_count += 1

        except Exception as e:
            logger.error(f"MusicBrainz bulk fetch failed: {e}")

        # Fall back to Last.fm for artists still missing MBIDs
        if self.has_lastfm():
            artists_still_missing = [a for a in artists if not a.mbid]

            if artists_still_missing:
                logger.info(f"Fetching remaining {len(artists_still_missing)} MBIDs from Last.fm...")
                overall_dict, month12_dict = self.lastfm_service.fetch_all_user_artists(self.lastfm_user)

                for artist in artists_still_missing:
                    _, _, mbid = self.lastfm_service.lookup_artist_playcounts(
                        artist.name,
                        None,
                        overall_dict,
                        month12_dict
                    )

                    if mbid:
                        artist.mbid = mbid
                        artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                        repaired_count += 1

        return repaired_count


# =============================================================================
# Convenience Function for CLI/Script Usage
# =============================================================================

def fetch_artist_metadata(
    db_path: Optional[str] = None,
    silent: bool = False,
    user_id: Optional[int] = None,
    batch_size: int = 5
) -> int:
    """
    Convenience function for post-parser metadata enrichment.

    This is a simplified version optimized for calling after parser runs.
    Focuses on MBID repair and image fetching, skipping playcount refresh.

    Strategy:
        - MBID repair: MusicBrainz (primary) → Last.fm (fallback if configured)
        - Images: Fanart.tv (if configured)
        - Playcounts: Skipped (use fetch_metadata.py for full refresh)
        - Batch commits: Saves progress every N artists to prevent data loss

    Args:
        db_path: Path to SQLite database or None to use DATABASE_URL env var
        silent: If True, suppress most output
        user_id: If provided, only process artists associated with this user
        batch_size: Number of artists to process before committing (default: 5)

    Returns:
        0 on success, 1 on error

    Example:
        >>> from services.metadata_service import fetch_artist_metadata
        >>> result = fetch_artist_metadata(db_path="data/concerts.db", user_id=1)
    """
    import time
    from sqlalchemy.orm import sessionmaker
    from database.models import Artist, UserArtist
    from database.config import get_engine
    from utils.credentials import load_credentials

    def query_artists():
        """Helper to query artists (with or without user filter)"""
        if user_id:
            user_artist_ids = session.query(UserArtist.artistId).filter_by(
                userId=user_id
            ).distinct().all()
            artist_ids = [id[0] for id in user_artist_ids]

            if not artist_ids:
                return None, []

            artists = session.query(Artist).filter(Artist.id.in_(artist_ids)).all()
            return artist_ids, artists
        else:
            return None, session.query(Artist).all()

    # Load credentials using centralized loader
    try:
        credentials, _ = load_credentials(
            user_id=user_id,
            db_path=db_path,
            require_lastfm=False,
            require_countries=False
        )
        lastfm_api_key = credentials.lastfm_api_key
        lastfm_user = credentials.lastfm_user
        fanart_api_key = credentials.fanart_api_key
    except Exception as e:
        logger.warning(f"Could not load credentials: {e}")
        logger.warning("Proceeding with MusicBrainz only (no Last.fm/Fanart)")
        lastfm_api_key = lastfm_user = fanart_api_key = None

    # Check what services are available
    fanart_available = bool(fanart_api_key)
    lastfm_available = bool(lastfm_api_key and lastfm_user)

    logger.info("Metadata sources:")
    logger.info(f"  MusicBrainz: ✓ Available (no auth required)")
    logger.info(f"  Last.fm: {'✓ Configured' if lastfm_available else '✗ Not configured'}")
    logger.info(f"  Fanart.tv: {'✓ Configured' if fanart_available else '✗ Not configured'}")

    if not fanart_available and not lastfm_available:
        logger.warning("No metadata services configured")
        logger.warning("Will use MusicBrainz for MBID lookups only")

    # Create metadata service
    metadata_service = ArtistMetadataService(
        lastfm_api_key=lastfm_api_key,
        fanart_api_key=fanart_api_key,
        lastfm_user=lastfm_user
    )

    # Connect to database
    try:
        engine = get_engine(db_path)
    except ValueError as e:
        raise ValueError(f"Database configuration error: {e}")

    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Query artists - filter by user if user_id provided
        user_artist_ids, all_artists = query_artists()

        if user_artist_ids is not None and not all_artists:
            logger.warning(f"No artists found for user ID {user_id}")
            return 0

        logger.info(f"Processing {len(all_artists)} artists" +
                    (f" for user ID {user_id}" if user_id else ""))

        # =====================================================================
        # Phase 1: MBID Auto-Repair
        # =====================================================================
        artists_missing_mbid = [a for a in all_artists if not a.mbid]

        if artists_missing_mbid:
            logger.info(f"Repairing MBIDs for {len(artists_missing_mbid)} artists...")
            mbid_repair_count = metadata_service.bulk_repair_mbids(session, artists_missing_mbid)

            try:
                session.commit()
                logger.info(f"✓ Repaired {mbid_repair_count}/{len(artists_missing_mbid)} MBIDs")
            except Exception as e:
                session.rollback()
                logger.error(f"Commit failed: {e}")

        # =====================================================================
        # Phase 2: Image Fetching
        # =====================================================================
        # Re-query artists after Phase 1 to ensure we see updated MBIDs
        # (SQLAlchemy session may have expired objects after commit)
        _, all_artists = query_artists()
        artists_needing_images = [a for a in all_artists if a.mbid and not a.imageUrl]

        if artists_needing_images:
            if not fanart_available:
                logger.warning(f"Skipping image fetch for {len(artists_needing_images)} artists (Fanart.tv not configured)")
            else:
                logger.info(f"Fetching images for {len(artists_needing_images)} artists...")
                images_found = 0

                for idx, artist in enumerate(artists_needing_images, 1):
                    logger.info(f"[{idx}/{len(artists_needing_images)}] {artist.name}")

                    image_url, image_type = metadata_service.fetch_artist_image(artist)

                    if image_url:
                        artist.imageUrl = image_url
                        images_found += 1
                        logger.info(f"Found {image_type}: {image_url[:60]}...")
                    else:
                        logger.warning("✗ No image found")

                    # Commit after each artist to prevent data loss on errors
                    try:
                        session.commit()
                    except Exception as e:
                        session.rollback()
                        logger.error(f"Commit failed for {artist.name}: {e}")

                    time.sleep(0.5)  # Rate limiting for Fanart.tv

                    if idx % batch_size == 0:
                        logger.info(f"Progress: {idx}/{len(artists_needing_images)} artists processed")

                logger.info(f"✓ Found {images_found}/{len(artists_needing_images)} images")

        return 0

    except Exception as e:
        logger.error(f"Error fetching metadata: {e}")
        return 1
    finally:
        session.close()
