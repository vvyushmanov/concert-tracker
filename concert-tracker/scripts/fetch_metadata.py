#!/usr/bin/env python3
"""
CLI entry point for artist metadata fetching

Fetches artist metadata (MBIDs, images, playcounts) from multiple sources.

Metadata Sources:
    - MusicBrainz: Primary source for MBIDs (always available, no auth required)
    - Last.fm: Optional source for playcounts and fallback MBIDs
    - Fanart.tv: Optional source for high-resolution artist images

Credential Loading:
    - Uses centralized load_credentials() for user-specific mode (--user-id)
    - Validates credentials and provides helpful error messages
    - Falls back to global ConfigManager for legacy mode

Usage:
    python cli/fetch_metadata.py [options]
"""

import sys
import os
import argparse
import time
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

# Import from library modules
from database.models import Artist, UserArtist
from database.config import get_engine
from utils import fetch_all_user_artists, lookup_artist_playcounts
from config import ConfigManager
from services import ArtistMetadataService
from utils import log
from services.metadata import fetch_fanart_image, update_user_artist_stats
from utils.credentials import load_credentials

# Load environment variables
load_dotenv()

def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description='Fetch artist metadata (MBID, images, playcounts) from Last.fm and fanart.tv'
    )
    parser.add_argument(
        '--db-path',
        type=str,
        required=False,
        help='Path to SQLite database (optional if DATABASE_URL env var is set)'
    )
    parser.add_argument(
        '--user-id',
        type=int,
        help='User ID for per-user playcount updates (recommended)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit number of artists to process (for testing)'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Re-fetch images even if already present'
    )
    parser.add_argument(
        '--refresh-playcounts',
        action='store_true',
        help='Refresh playcounts for all artists (even those with MBID and images)'
    )
    parser.add_argument(
        '--delay',
        type=float,
        default=0.25,
        help='Delay in seconds between API calls (default: 0.25)'
    )
    
    args = parser.parse_args()
    
    # Load user-specific or global config
    if args.user_id:
        # User-specific mode: load credentials using centralized loader
        credentials, validation = load_credentials(
            user_id=args.user_id,
            db_path=args.db_path,
            require_lastfm=False,
            require_countries=False
        )

        if validation.is_error():
            print(validation)
            return 1

        # Extract credentials
        lastfm_api_key = credentials.lastfm_api_key
        lastfm_user = credentials.lastfm_user
        fanart_api_key = credentials.fanart_api_key

        log(f"User-specific mode: {credentials.username} (ID: {args.user_id})")
        log(f"Last.fm user: {lastfm_user}")
    else:
        # Global mode (legacy)
        log("WARNING: Running in legacy mode without --user-id")
        log("Playcounts will not be saved. Use --user-id for full functionality.")
        config = ConfigManager()
        fanart_api_key = config.get('FANART_API_KEY')
        lastfm_api_key = config.get('LASTFM_API_KEY')
        lastfm_user = config.get('LASTFM_USER', '')
        log(f"Last.fm user: {lastfm_user}")
    
    # Check what services are available (all optional now)
    lastfm_available = bool(lastfm_api_key and lastfm_user)
    fanart_available = bool(fanart_api_key)

    log("\n" + "="*60)
    log("METADATA SOURCES STATUS")
    log("="*60)
    log(f"Last.fm: {'✓ Configured' if lastfm_available else '✗ Not configured'}")
    log(f"Fanart.tv: {'✓ Configured' if fanart_available else '✗ Not configured'}")
    log(f"MusicBrainz: ✓ Available (no auth required)")
    log("="*60 + "\n")

    if not lastfm_available:
        log("WARNING: Last.fm not configured - playcount updates will be skipped")
        log("         To enable: Configure LASTFM_API_KEY and LASTFM_USER in settings")

    if not fanart_available:
        log("WARNING: Fanart.tv not configured - image fetching will be skipped")
        log("         To enable: Configure FANART_API_KEY in settings")
        log("         Get your free API key from: https://fanart.tv/get-an-api-key/")

    if not lastfm_available and not fanart_available:
        log("\nWARNING: Limited functionality - only MusicBrainz MBID lookups available")
        log("         Configure at least one service for full metadata enrichment\n")
    
    # Connect to database
    try:
        if args.db_path:
            log(f"Connecting to database: {args.db_path}")
        else:
            log(f"Connecting to database via DB_TYPE configuration")
        engine = get_engine(args.db_path)
    except ValueError as e:
        print(f"Error: {e}")
        return 1
    
    # Schema check removed - playcounts are now in UserArtist table
    
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # Query artists - filter by user if user_id provided
    if args.user_id:
        # Get only artists associated with this user via UserArtist table
        user_artist_ids = session.query(UserArtist.artistId).filter_by(userId=args.user_id).distinct().all()
        user_artist_ids = [id[0] for id in user_artist_ids]
        
        if not user_artist_ids:
            log(f"No artists found for user ID {args.user_id}")
            return 0
        
        all_artists = session.query(Artist).filter(Artist.id.in_(user_artist_ids)).all()
        log(f"Processing {len(all_artists)} artists for user ID {args.user_id}")
    else:
        # Legacy mode: all artists
        all_artists = session.query(Artist).all()
        log(f"Processing all {len(all_artists)} artists (no user filter)")
    
    # PHASE 0: Automatic MBID repair (runs always, regardless of flags)
    # Strategy: MusicBrainz first, then Last.fm if configured
    artists_missing_mbid = [a for a in all_artists if not a.mbid]

    mbid_repair_count = 0
    if artists_missing_mbid:
        log("=" * 60)
        log(f"PHASE 0: MBID Auto-Repair ({len(artists_missing_mbid)} artists without MBID)")
        log("=" * 60 + "\n")

        # Use ArtistMetadataService for MBID repair
        metadata_service = ArtistMetadataService(
            lastfm_api_key=lastfm_api_key,
            fanart_api_key=fanart_api_key,
            lastfm_user=lastfm_user
        )

        # Bulk repair using the service (which tries MusicBrainz first)
        try:
            mbid_repair_count = metadata_service.bulk_repair_mbids(session, artists_missing_mbid)
            session.commit()
            log(f"\n✓ Auto-repaired {mbid_repair_count}/{len(artists_missing_mbid)} MBIDs\n")
        except Exception as e:
            log(f"Error during MBID repair: {e}")
            session.rollback()

        # Re-evaluate artists needing images after MBID repair
        # Artists that just got MBIDs should now be eligible for image fetching
        if fanart_available and mbid_repair_count > 0:
            log("Re-evaluating artists needing images after MBID repair...")

    # Determine which phases to run
    # Re-evaluate after Phase 0 MBID repairs to ensure artists with new MBIDs get images
    if args.refresh_playcounts and not args.force:
        log(f"Refresh playcounts mode: Will update playcounts for all {len(all_artists)} artists")
        # Skip Phase 1, but still run Phase 2 if images are needed
        artists_without_mbid = [a for a in all_artists if not a.mbid]
        artists_with_mbid = [a for a in all_artists if a.mbid and not a.imageUrl]
        if artists_with_mbid:
            log(f"  Also found {len(artists_with_mbid)} artists with MBID but missing images")
    else:
        # Normal mode: separate into groups for processing
        if args.force:
            log("Force mode: Will re-fetch metadata for all artists")

        # Re-evaluate lists after Phase 0 (MBID repair may have moved artists between lists)
        artists_without_mbid = [a for a in all_artists if not a.mbid]
        artists_with_mbid = [a for a in all_artists if a.mbid and (args.force or not a.imageUrl)]

        if args.limit:
            # Apply limit across both groups
            total_artists = artists_without_mbid + artists_with_mbid
            artists_without_mbid = [a for a in total_artists if not a.mbid][:args.limit]
            remaining = args.limit - len(artists_without_mbid)
            artists_with_mbid = [a for a in total_artists if a.mbid][:remaining] if remaining > 0 else []
            log(f"Limiting to {args.limit} artists total")
    
    total_count = len(artists_without_mbid) + len(artists_with_mbid)
    
    if total_count == 0 and not args.refresh_playcounts:
        log("No artists need processing!")
        if not args.refresh_playcounts:
            return 0
    
    if total_count > 0:
        log(f"Found {len(artists_without_mbid)} artists without MBID (will fetch MBID + playcounts + images)")
        log(f"Found {len(artists_with_mbid)} artists with MBID needing images (will fetch images only)")
        log(f"Total: {total_count} artists to process\n")
    
    # Process each artist
    stats = {
        'processed': 0,
        'mbid_fetched': mbid_repair_count if artists_missing_mbid else 0,  # Include Phase 0 repairs
        'mbid_not_found': 0,
        'playcounts_updated': 0,
        'images_found': 0,
        'images_not_found': 0,
        'errors': 0
    }
    
    current_index = 0
    
    # Phase 1: Process artists without MBID (handled by Phase 0 now)
    # This phase now only handles playcount updates if Last.fm is available
    if artists_without_mbid and lastfm_available:
        log("=" * 60)
        log("PHASE 1: Fetching playcounts and images for artists with new MBIDs")
        log("=" * 60 + "\n")

        # Fetch all user artists in bulk for efficient lookup
        overall_dict, month12_dict = fetch_all_user_artists(lastfm_api_key, lastfm_user)
        log("")

        for artist in artists_without_mbid:
            # Skip if MBID wasn't repaired in Phase 0
            if not artist.mbid:
                continue

            current_index += 1
            log(f"[{current_index}/{total_count}] Processing: {artist.name}")
            log(f"  MBID: {artist.mbid}")

            # Look up playcounts from pre-fetched data
            playcount, playcount_12month, _ = lookup_artist_playcounts(
                artist.name,
                artist.mbid,
                overall_dict,
                month12_dict
            )

            # Update user-specific playcounts
            if args.user_id and (playcount > 0 or playcount_12month > 0):
                log(f"  ✓ Updated user playcounts: overall={playcount}, 12-month={playcount_12month}")
                update_user_artist_stats(session, args.user_id, artist, playcount, playcount_12month)
                stats['playcounts_updated'] += 1

            # Try to fetch image from fanart.tv if configured
            if fanart_available:
                image_url, image_type = fetch_fanart_image(artist.mbid, fanart_api_key)

                if image_url:
                    log(f"  ✓ Found image ({image_type}): {image_url[:60]}...")
                    artist.imageUrl = image_url
                    stats['images_found'] += 1
                else:
                    log(f"  ✗ No image found on fanart.tv")
                    stats['images_not_found'] += 1

                # Rate limit fanart.tv API calls
                time.sleep(args.delay)

            stats['processed'] += 1

            # Commit after each artist to save progress
            try:
                session.commit()
            except Exception as e:
                log(f"  Error saving to database: {e}")
                session.rollback()
                stats['errors'] += 1

        log("\n")
    
    # Phase 2: Process artists with MBID but no images (if Fanart.tv configured)
    if artists_with_mbid:
        if not fanart_available:
            log("=" * 60)
            log("PHASE 2: Image Fetch SKIPPED")
            log("=" * 60)
            log(f"⚠️  Fanart.tv not configured - skipping {len(artists_with_mbid)} artists")
            log("   Configure FANART_API_KEY to enable image fetching")
            log("   Get your free API key from: https://fanart.tv/get-an-api-key/\n")
        else:
            log("=" * 60)
            log("PHASE 2: Fetching images for artists with MBID")
            log("=" * 60 + "\n")

            for artist in artists_with_mbid:
                current_index += 1
                log(f"[{current_index}/{total_count}] Processing: {artist.name}")
                log(f"  MBID: {artist.mbid}")

                # Fetch image from fanart.tv
                image_url, image_type = fetch_fanart_image(artist.mbid, fanart_api_key)

                if image_url:
                    log(f"  ✓ Found image ({image_type}): {image_url[:60]}...")
                    artist.imageUrl = image_url
                    stats['images_found'] += 1
                else:
                    log(f"  ✗ No image found")
                    stats['images_not_found'] += 1

                stats['processed'] += 1

                # Commit after each artist to save progress
                try:
                    session.commit()
                except Exception as e:
                    log(f"  Error saving to database: {e}")
                    session.rollback()
                    stats['errors'] += 1

                # Rate limiting
                if current_index < total_count:
                    time.sleep(args.delay)
    
    # Phase 3: Refresh playcounts for all artists (if requested and Last.fm configured)
    if args.refresh_playcounts:
        if not lastfm_available:
            log("=" * 60)
            log("PHASE 3: Playcount Refresh SKIPPED")
            log("=" * 60)
            log("⚠️  Last.fm not configured - cannot refresh playcounts")
            log("   Configure LASTFM_API_KEY and LASTFM_USER to enable playcount tracking\n")
        else:
            log("=" * 60)
            phase_name = "PHASE 3" if total_count > 0 else "Refreshing playcounts for all artists"
            log(f"{phase_name}: Refreshing playcounts for all artists")
            log("=" * 60 + "\n")

            # Get all artists that weren't already processed in Phase 1
            artists_for_playcount_refresh = [a for a in all_artists if a not in artists_without_mbid]

            if args.limit and len(artists_for_playcount_refresh) > 0:
                # Adjust for limit if some were already processed
                remaining_limit = args.limit - current_index
                if remaining_limit > 0:
                    artists_for_playcount_refresh = artists_for_playcount_refresh[:remaining_limit]
                else:
                    artists_for_playcount_refresh = []

            total_to_refresh = len(artists_for_playcount_refresh)
            log(f"Will refresh playcounts for {total_to_refresh} artists\n")

            # Fetch all user artists in bulk (much more efficient - only 2 API calls!)
            overall_dict, month12_dict = fetch_all_user_artists(lastfm_api_key, lastfm_user)
            log("")

            for idx, artist in enumerate(artists_for_playcount_refresh, 1):
                log(f"[{idx}/{total_to_refresh}] Refreshing playcounts: {artist.name}")

                # Look up playcounts from pre-fetched data
                playcount, playcount_12month, _ = lookup_artist_playcounts(
                    artist.name,
                    artist.mbid,
                    overall_dict,
                    month12_dict
                )

                if args.user_id and (playcount > 0 or playcount_12month > 0):
                    log(f"  ✓ Updated user playcounts: overall={playcount}, 12-month={playcount_12month}")
                    update_user_artist_stats(session, args.user_id, artist, playcount, playcount_12month)
                    stats['playcounts_updated'] += 1
                else:
                    log(f"  ✗ No playcount data found or no user-id specified")
            
            # Commit after each artist to save progress
            try:
                session.commit()
            except Exception as e:
                log(f"  Error saving to database: {e}")
                session.rollback()
                stats['errors'] += 1
        
        log("\n")
    
    session.close()
    
    # Print summary
    log("\n" + "="*60)
    log("SUMMARY")
    log("="*60)
    log(f"Artists processed: {stats['processed']}")
    log(f"MBIDs fetched: {stats['mbid_fetched']}")
    log(f"MBIDs not found: {stats['mbid_not_found']}")
    log(f"Playcounts updated: {stats['playcounts_updated']}")
    log(f"Images found: {stats['images_found']}")
    log(f"Images not found: {stats['images_not_found']}")
    log(f"Errors: {stats['errors']}")
    log("="*60)
    
    return 0

if __name__ == '__main__':
    exit(main())
