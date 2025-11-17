#!/usr/bin/env python3
"""
Background script to fetch artist metadata from Last.fm and fanart.tv.
- Fetches playcounts (overall and 12-month) from Last.fm
- Fetches MusicBrainz IDs from Last.fm for artists without MBID
- Fetches artist images from fanart.tv using MusicBrainz IDs

This runs separately from the concert parser to avoid slowing down parsing.

Usage:
    python fetch_artist_metadata.py --db-path data/concerts.db
    python fetch_artist_metadata.py --db-path data/concerts.db --limit 10  # Test mode
    python fetch_artist_metadata.py --db-path data/concerts.db --force     # Re-fetch all data
"""

import time
import requests
from dotenv import load_dotenv
from sqlalchemy.orm import sessionmaker

from database.models import Artist, UserArtist
from database.config import get_engine
from config import ConfigManager
from utils import log
from services import FanartService
from utils.credentials import load_credentials
# Load environment variables
load_dotenv()

def fetch_artist_metadata(db_path: str = None, silent: bool = False, user_id: int = None, batch_size: int = 5) -> int:
    """Fetch metadata (MBID + images) for artists without complete metadata

    This is a simplified version optimized for calling after parser runs.
    It focuses on MBID repair and image fetching, skipping playcount refresh.

    Strategy:
        - MBID repair: MusicBrainz (primary) → Last.fm (fallback if configured)
        - Images: Fanart.tv (if configured)
        - Playcounts: Skipped (use fetch_metadata.py for full refresh)
        - Batch commits: Saves progress every N artists to prevent data loss
        - Credentials: Uses centralized load_credentials() for user-specific mode

    Args:
        db_path: Path to SQLite database (for SQLite) or None to use DATABASE_URL env var (for MySQL)
        silent: If True, suppress most output
        user_id: If provided, only process artists associated with this user (loads credentials via load_credentials())
        batch_size: Number of artists to process before committing to database (default: 5)

    Returns:
        0 on success, 1 on error
    """
    def log_internal(message: str):
        if not silent:
            log(message)

    # Get API keys from config (both optional)
    lastfm_api_key = None
    lastfm_user = None
    fanart_api_key = None

    if user_id:
        try:
            credentials, validation = load_credentials(
                user_id=user_id,
                db_path=db_path,
                require_lastfm=False,
                require_countries=False
            )
            # Even if validation has errors, we can still proceed with available credentials
            # (Last.fm and Fanart are optional for metadata fetching)
            lastfm_api_key = credentials.lastfm_api_key
            lastfm_user = credentials.lastfm_user
            fanart_api_key = credentials.fanart_api_key
        except Exception as e:
            # Fallback to global config on error
            if not silent:
                log_internal(f"Warning: Could not load user credentials: {e}")
            config = ConfigManager()
            fanart_api_key = config.get('FANART_API_KEY')
    else:
        # No user specified, use global config
        config = ConfigManager()
        fanart_api_key = config.get('FANART_API_KEY')

    # Check what services are available
    fanart_available = bool(fanart_api_key)
    lastfm_available = bool(lastfm_api_key and lastfm_user)

    if not silent:
        log_internal("Metadata sources:")
        log_internal(f"  MusicBrainz: ✓ Available (no auth required)")
        log_internal(f"  Last.fm: {'✓ Configured' if lastfm_available else '✗ Not configured'}")
        log_internal(f"  Fanart.tv: {'✓ Configured' if fanart_available else '✗ Not configured'}")

    # MusicBrainz is always available, so we can always try MBID repair
    # Fanart.tv is optional
    if not fanart_available and not lastfm_available:
        if not silent:
            log_internal("Warning: No metadata services configured")
            log_internal("Will use MusicBrainz for MBID lookups only")

    lastfm_user = lastfm_user if lastfm_available else None
    
    # Connect to database
    try:
        engine = get_engine(db_path)
    except ValueError as e:
        raise ValueError(f"Database configuration error: {e}")
    
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        # Get artists - filter by user if user_id provided
        if user_id:
            # Get only artists associated with this user via UserArtist table
            user_artist_ids = session.query(UserArtist.artistId).filter_by(userId=user_id).distinct().all()
            user_artist_ids = [id[0] for id in user_artist_ids]
            
            if not user_artist_ids:
                log_internal(f"  No artists found for user ID {user_id}")
                return 0
            
            all_artists = session.query(Artist).filter(Artist.id.in_(user_artist_ids)).all()
            log_internal(f"  Processing {len(all_artists)} artists for user ID {user_id}")
        else:
            # Legacy mode: all artists
            all_artists = session.query(Artist).all()
            log_internal(f"  Processing all {len(all_artists)} artists")
        
        # MBID Auto-Repair for artists without MBID
        artists_missing_mbid = [a for a in all_artists if not a.mbid]

        if artists_missing_mbid:
            log_internal(f"  Repairing MBIDs for {len(artists_missing_mbid)} artists...")

            mbid_repair_count = 0
            mbid_from_mb = 0
            mbid_from_lastfm = 0

            # Primary: Try MusicBrainz first
            from services import MusicBrainzService
            mb_service = MusicBrainzService()

            for idx, artist in enumerate(artists_missing_mbid, 1):
                mbid = None

                # Show progress
                if not silent:
                    log_internal(f"    [{idx}/{len(artists_missing_mbid)}] {artist.name}")

                # Try MusicBrainz
                try:
                    mbid = mb_service.get_artist_mbid(artist.name, verbose=(not silent))
                    if mbid:
                        mbid_from_mb += 1
                        if not silent:
                            log_internal(f"      ✓ MusicBrainz MBID: {mbid}")
                except Exception as e:
                    if not silent:
                        log_internal(f"      ✗ MusicBrainz lookup failed: {e}")

                # Fallback to Last.fm if configured and MB failed
                if not mbid and lastfm_available:
                    try:
                        params = {
                            'method': 'artist.getinfo',
                            'artist': artist.name,
                            'api_key': lastfm_api_key,
                            'format': 'json'
                        }
                        response = requests.get("http://ws.audioscrobbler.com/2.0/", params=params, timeout=10)
                        response.raise_for_status()
                        data = response.json()
                        if 'artist' in data:
                            mbid = data['artist'].get('mbid', '').strip()
                            mbid = mbid if mbid else None
                            if mbid:
                                mbid_from_lastfm += 1
                                if not silent:
                                    log_internal(f"      ✓ Last.fm MBID: {mbid}")
                    except Exception as e:
                        if not silent:
                            log_internal(f"      ✗ Last.fm lookup failed: {e}")

                if mbid:
                    artist.mbid = mbid
                    mbid_repair_count += 1
                elif not silent:
                    log_internal(f"      ✗ No MBID found")

                # Batch commit to save progress
                if idx % batch_size == 0:
                    try:
                        session.commit()
                        if not silent:
                            log_internal(f"    💾 Saved progress ({idx}/{len(artists_missing_mbid)} artists processed)")
                    except Exception as e:
                        session.rollback()
                        if not silent:
                            log_internal(f"    ⚠️  Batch commit failed: {e}")

            # Final commit for remaining artists
            try:
                session.commit()
                log_internal(f"  ✓ Repaired {mbid_repair_count}/{len(artists_missing_mbid)} MBIDs")
                log_internal(f"    - From MusicBrainz: {mbid_from_mb}")
                if lastfm_available:
                    log_internal(f"    - From Last.fm: {mbid_from_lastfm}")
            except Exception as e:
                session.rollback()
                if not silent:
                    log_internal(f"  ⚠️  Final commit failed: {e}")
        
        # Fetch images for artists with MBID but no image
        artists_needing_images = [a for a in all_artists if a.mbid and not a.imageUrl]

        if artists_needing_images:
            if not fanart_available:
                log_internal(f"  ⚠️  Skipping image fetch for {len(artists_needing_images)} artists (Fanart.tv not configured)")
            else:
                log_internal(f"  Fetching images for {len(artists_needing_images)} artists...")
                images_found = 0
                fanart_service = FanartService(fanart_api_key)

                for idx, artist in enumerate(artists_needing_images, 1):
                    # Show progress
                    if not silent:
                        log_internal(f"    [{idx}/{len(artists_needing_images)}] {artist.name}")

                    image_url, image_type = fanart_service.fetch_artist_image(artist.mbid, verbose=(not silent))
                    if image_url:
                        artist.imageUrl = image_url
                        images_found += 1
                        if not silent:
                            log_internal(f"      ✓ Found {image_type}: {image_url[:60]}...")
                    elif not silent:
                        log_internal(f"      ✗ No image found")

                    # Rate limiting (safer delay for Fanart.tv)
                    time.sleep(0.5)

                    # Batch commit to save progress
                    if idx % batch_size == 0:
                        try:
                            session.commit()
                            if not silent:
                                log_internal(f"    💾 Saved progress ({idx}/{len(artists_needing_images)} artists processed)")
                        except Exception as e:
                            session.rollback()
                            if not silent:
                                log_internal(f"    ⚠️  Batch commit failed: {e}")

                # Final commit for remaining artists
                try:
                    session.commit()
                    log_internal(f"  ✓ Found {images_found}/{len(artists_needing_images)} images")
                except Exception as e:
                    session.rollback()
                    if not silent:
                        log_internal(f"  ⚠️  Final commit failed: {e}")
        
        session.close()
        return 0
        
    except Exception as e:
        if not silent:
            print(f"Error fetching metadata: {e}")
        session.close()
        return 1


