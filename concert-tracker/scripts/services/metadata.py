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

import argparse
import os
import time
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from database.models import Artist, UserArtist
from database.config import get_engine
from config import ConfigManager, load_user_config
from services import ArtistMetadataService
from utils import log
from services import FanartService
# Load environment variables
load_dotenv()


def update_user_artist_stats(session, user_id: int, artist: Artist, playcount: int, playcount12month: int):
    """Update or create UserArtist stats for a specific user
    
    DEPRECATED: This is a backward-compatible wrapper.
    Use ArtistMetadataService.update_user_artist_stats() instead.
    
    Args:
        session: Database session
        user_id: User ID
        artist: Artist object
        playcount: Overall playcount
        playcount12month: 12-month playcount
    """
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


def fetch_fanart_image(mbid: str, api_key: str) -> tuple:
    """Fetch artist image from fanart.tv with fallback options
    
    DEPRECATED: Use FanartService.fetch_artist_image() instead
    
    Args:
        mbid: MusicBrainz ID
        api_key: fanart.tv API key
        
    Returns:
        Tuple of (image_url, image_type) or (None, None) if not found
    """
    service = FanartService(api_key)
    return service.fetch_artist_image(mbid)

def fetch_metadata_for_new_artists(db_path: str = None, silent: bool = False, user_id: int = None) -> int:
    """Fetch metadata (MBID + images) for artists without complete metadata

    This is a simplified version optimized for calling after parser runs.
    It focuses on MBID repair and image fetching, skipping playcount refresh.

    Strategy:
        - MBID repair: MusicBrainz (primary) → Last.fm (fallback if configured)
        - Images: Fanart.tv (if configured)
        - Playcounts: Skipped (use fetch_metadata.py for full refresh)

    Args:
        db_path: Path to SQLite database (for SQLite) or None to use DATABASE_URL env var (for MySQL)
        silent: If True, suppress most output
        user_id: If provided, only process artists associated with this user

    Returns:
        0 on success, 1 on error
    """
    def log_internal(message: str):
        if not silent:
            log(message)

    # Get API keys from config (both optional)
    config = ConfigManager()
    fanart_api_key = config.get('FANART_API_KEY')
    lastfm_api_key = config.get('LASTFM_API_KEY')
    lastfm_user = config.get('LASTFM_USER', '')

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

            for artist in artists_missing_mbid:
                mbid = None

                # Try MusicBrainz
                try:
                    mbid = mb_service.get_artist_mbid(artist.name)
                    if mbid:
                        mbid_from_mb += 1
                except Exception as e:
                    if not silent:
                        log_internal(f"    MusicBrainz lookup failed for {artist.name}: {e}")

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
                    except Exception:
                        pass

                if mbid:
                    artist.mbid = mbid
                    mbid_repair_count += 1

            session.commit()
            log_internal(f"  ✓ Repaired {mbid_repair_count}/{len(artists_missing_mbid)} MBIDs")
            log_internal(f"    - From MusicBrainz: {mbid_from_mb}")
            if lastfm_available:
                log_internal(f"    - From Last.fm: {mbid_from_lastfm}")
        
        # Fetch images for artists with MBID but no image
        artists_needing_images = [a for a in all_artists if a.mbid and not a.imageUrl]

        if artists_needing_images:
            if not fanart_available:
                log_internal(f"  ⚠️  Skipping image fetch for {len(artists_needing_images)} artists (Fanart.tv not configured)")
            else:
                log_internal(f"  Fetching images for {len(artists_needing_images)} artists...")
                images_found = 0

                for artist in artists_needing_images:
                    image_url, _ = fetch_fanart_image(artist.mbid, fanart_api_key)
                    if image_url:
                        artist.imageUrl = image_url
                        images_found += 1
                    time.sleep(0.25)  # Rate limiting

                session.commit()
                log_internal(f"  ✓ Found {images_found}/{len(artists_needing_images)} images")
        
        session.close()
        return 0
        
    except Exception as e:
        if not silent:
            print(f"Error fetching metadata: {e}")
        session.close()
        return 1


