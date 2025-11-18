#!/usr/bin/env python3
"""
CLI entry point for artist metadata fetching

Fetches artist metadata (MBIDs, images, playcounts) from multiple sources.

Metadata Sources:
    - MusicBrainz: Primary source for MBIDs (always available, no auth required)
    - Last.fm: Optional source for playcounts and fallback MBIDs
    - Fanart.tv: Optional source for high-resolution artist images

Credential Loading:
    - Uses centralized load_credentials() for all modes
    - User-specific mode: --user-id (for per-user metadata)
    - Global mode: no --user-id (for refreshing all artists, admin tasks)
    - Validates credentials and provides helpful error messages

Usage:
    python cli/fetch_metadata.py [options]
"""

import argparse
import time
from dotenv import load_dotenv
from sqlalchemy.orm import sessionmaker

# Import from library modules
from database.models import Artist, UserArtist
from database.config import get_engine
from services.lastfm_service import LastFMService
from services import ArtistMetadataService
from services.fanart_service import FanartService
from utils import get_logger, setup_logging
from utils.credentials import load_credentials

logger = get_logger(__name__)
setup_logging()

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
    
    # Load credentials using centralized loader
    # Supports both user-specific mode (with --user-id) and global mode (without --user-id)
    credentials, validation = load_credentials(
        user_id=args.user_id,
        db_path=args.db_path,
        require_lastfm=False,
        require_countries=False
    )

    if validation.is_error():
        logger.error(validation)
        return 1

    # Extract credentials (works for both user-specific and global modes)
    lastfm_api_key = credentials.lastfm_api_key
    lastfm_user = credentials.lastfm_user
    fanart_api_key = credentials.fanart_api_key

    # Display configuration info
    if args.user_id:
        logger.info(f"User-specific mode: {credentials.username} (ID: {args.user_id})")
        logger.info(f"Last.fm user: {lastfm_user}")
    else:
        logger.info(f"ℹ️  {validation.message}")  # Global mode for all artists
        logger.info("Note: Playcounts will not be saved without --user-id (global mode)")
        logger.info(f"Last.fm user: {lastfm_user}")
    
    # Check what services are available (all optional now)
    lastfm_available = bool(lastfm_api_key and lastfm_user)
    fanart_available = bool(fanart_api_key)

    # Create service instances
    fanart_service = FanartService(api_key=fanart_api_key) if fanart_available else None
    metadata_service = ArtistMetadataService(
        lastfm_api_key=lastfm_api_key,
        fanart_api_key=fanart_api_key,
        lastfm_user=lastfm_user
    )

    logger.info("="*60)
    logger.info("METADATA SOURCES STATUS")
    logger.info("="*60)
    logger.info(f"Last.fm: {'✓ Configured' if lastfm_available else '✗ Not configured'}")
    logger.info(f"Fanart.tv: {'✓ Configured' if fanart_available else '✗ Not configured'}")
    logger.info(f"MusicBrainz: ✓ Available (no auth required)")
    logger.info("="*60 + "\n")

    if not lastfm_available:
        logger.warning("Last.fm not configured - playcount updates will be skipped")
        logger.info("To enable: Configure LASTFM_API_KEY and LASTFM_USER in settings")

    if not fanart_available:
        logger.warning("Fanart.tv not configured - image fetching will be skipped")
        logger.info("To enable: Configure FANART_API_KEY in settings")
        logger.info("Get your free API key from: https://fanart.tv/get-an-api-key/")

    if not lastfm_available and not fanart_available:
        logger.warning("Limited functionality - only MusicBrainz MBID lookups available")
        logger.info("Configure at least one service for full metadata enrichment\n")
    
    # Connect to database
    try:
        if args.db_path:
            logger.info(f"Connecting to database: {args.db_path}")
        else:
            logger.info(f"Connecting to database via DB_TYPE configuration")
        engine = get_engine(args.db_path)
    except ValueError as e:
        logger.error(f"Error: {e}")
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
            logger.info(f"No artists found for user ID {args.user_id}")
            return 0
        
        all_artists = session.query(Artist).filter(Artist.id.in_(user_artist_ids)).all()
        logger.info(f"Processing {len(all_artists)} artists for user ID {args.user_id}")
    else:
        # Global mode: all artists
        all_artists = session.query(Artist).all()
        logger.info(f"Processing all {len(all_artists)} artists (no user filter)")
    
    # PHASE 0: Automatic MBID repair (runs always, regardless of flags)
    # Strategy: MusicBrainz first, then Last.fm if configured
    artists_missing_mbid = [a for a in all_artists if not a.mbid]

    mbid_repair_count = 0
    if artists_missing_mbid:
        logger.info("=" * 60)
        logger.info(f"PHASE 0: MBID Auto-Repair ({len(artists_missing_mbid)} artists without MBID)")
        logger.info("=" * 60 + "\n")

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
            logger.info(f"\n✓ Auto-repaired {mbid_repair_count}/{len(artists_missing_mbid)} MBIDs\n")
        except Exception as e:
            logger.error(f"Error during MBID repair: {e}")
            session.rollback()

        # Re-evaluate artists needing images after MBID repair
        # Artists that just got MBIDs should now be eligible for image fetching
        if fanart_available and mbid_repair_count > 0:
            logger.info("Re-evaluating artists needing images after MBID repair...")

    # Determine which phases to run
    # Re-evaluate after Phase 0 MBID repairs to ensure artists with new MBIDs get images
    if args.refresh_playcounts and not args.force:
        logger.info(f"Refresh playcounts mode: Will update playcounts for all {len(all_artists)} artists")
        # Skip Phase 1, but still run Phase 2 if images are needed
        artists_without_mbid = [a for a in all_artists if not a.mbid]
        artists_with_mbid = [a for a in all_artists if a.mbid and not a.imageUrl]
        if artists_with_mbid:
            logger.info(f"  Also found {len(artists_with_mbid)} artists with MBID but missing images")
    else:
        # Normal mode: separate into groups for processing
        if args.force:
            logger.info("Force mode: Will re-fetch metadata for all artists")

        # Re-evaluate lists after Phase 0 (MBID repair may have moved artists between lists)
        artists_without_mbid = [a for a in all_artists if not a.mbid]
        artists_with_mbid = [a for a in all_artists if a.mbid and (args.force or not a.imageUrl)]

        if args.limit:
            # Apply limit across both groups
            total_artists = artists_without_mbid + artists_with_mbid
            artists_without_mbid = [a for a in total_artists if not a.mbid][:args.limit]
            remaining = args.limit - len(artists_without_mbid)
            artists_with_mbid = [a for a in total_artists if a.mbid][:remaining] if remaining > 0 else []
            logger.info(f"Limiting to {args.limit} artists total")
    
    total_count = len(artists_without_mbid) + len(artists_with_mbid)
    
    if total_count == 0 and not args.refresh_playcounts:
        logger.info("No artists need processing!")
        if not args.refresh_playcounts:
            return 0
    
    if total_count > 0:
        logger.info(f"Found {len(artists_without_mbid)} artists without MBID (will fetch MBID + playcounts + images)")
        logger.info(f"Found {len(artists_with_mbid)} artists with MBID needing images (will fetch images only)")
        logger.info(f"Total: {total_count} artists to process\n")
    
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
        logger.info("=" * 60)
        logger.info("PHASE 1: Fetching playcounts and images for artists with new MBIDs")
        logger.info("=" * 60 + "\n")

        # Fetch all user artists in bulk for efficient lookup
        lastfm_service = LastFMService(api_key=lastfm_api_key)
        overall_dict, month12_dict = lastfm_service.fetch_all_user_artists(lastfm_user)
        logger.info("")

        for artist in artists_without_mbid:
            # Skip if MBID wasn't repaired in Phase 0
            if not artist.mbid:
                continue

            current_index += 1
            logger.info(f"[{current_index}/{total_count}] Processing: {artist.name}")
            logger.info(f"  MBID: {artist.mbid}")

            # Update user-specific playcounts using metadata service
            if args.user_id:
                playcount, playcount_12month = metadata_service.update_user_artist_stats(
                    session, args.user_id, artist, overall_dict, month12_dict
                )

                if playcount > 0 or playcount_12month > 0:
                    logger.info(f"  ✓ Updated user playcounts: overall={playcount}, 12-month={playcount_12month}")
                    stats['playcounts_updated'] += 1

            # Try to fetch image from fanart.tv if configured
            if fanart_available:
                image_url, image_type = fanart_service.fetch_artist_image(artist.mbid)

                if image_url:
                    logger.info(f"  ✓ Found image ({image_type}): {image_url[:60]}...")
                    artist.imageUrl = image_url
                    stats['images_found'] += 1
                else:
                    logger.info(f"  ✗ No image found on fanart.tv")
                    stats['images_not_found'] += 1

                # Rate limit fanart.tv API calls
                time.sleep(args.delay)

            stats['processed'] += 1

            # Commit after each artist to save progress
            try:
                session.commit()
            except Exception as e:
                logger.info(f"  Error saving to database: {e}")
                session.rollback()
                stats['errors'] += 1

        logger.info("\n")
    
    # Phase 2: Process artists with MBID but no images (if Fanart.tv configured)
    if artists_with_mbid:
        if not fanart_available:
            logger.info("=" * 60)
            logger.info("PHASE 2: Image Fetch SKIPPED")
            logger.info("=" * 60)
            logger.info(f"⚠️  Fanart.tv not configured - skipping {len(artists_with_mbid)} artists")
            logger.info("   Configure FANART_API_KEY to enable image fetching")
            logger.info("   Get your free API key from: https://fanart.tv/get-an-api-key/\n")
        else:
            logger.info("=" * 60)
            logger.info("PHASE 2: Fetching images for artists with MBID")
            logger.info("=" * 60 + "\n")

            for artist in artists_with_mbid:
                current_index += 1
                logger.info(f"[{current_index}/{total_count}] Processing: {artist.name}")
                logger.info(f"  MBID: {artist.mbid}")

                # Fetch image from fanart.tv
                image_url, image_type = fanart_service.fetch_artist_image(artist.mbid)

                if image_url:
                    logger.info(f"  ✓ Found image ({image_type}): {image_url[:60]}...")
                    artist.imageUrl = image_url
                    stats['images_found'] += 1
                else:
                    logger.info(f"  ✗ No image found")
                    stats['images_not_found'] += 1

                stats['processed'] += 1

                # Commit after each artist to save progress
                try:
                    session.commit()
                except Exception as e:
                    logger.info(f"  Error saving to database: {e}")
                    session.rollback()
                    stats['errors'] += 1

                # Rate limiting
                if current_index < total_count:
                    time.sleep(args.delay)
    
    # Phase 3: Refresh playcounts for all artists (if requested and Last.fm configured)
    if args.refresh_playcounts:
        if not lastfm_available:
            logger.info("=" * 60)
            logger.info("PHASE 3: Playcount Refresh SKIPPED")
            logger.info("=" * 60)
            logger.info("⚠️  Last.fm not configured - cannot refresh playcounts")
            logger.info("   Configure LASTFM_API_KEY and LASTFM_USER to enable playcount tracking\n")
        else:
            logger.info("=" * 60)
            phase_name = "PHASE 3" if total_count > 0 else "Refreshing playcounts for all artists"
            logger.info(f"{phase_name}: Refreshing playcounts for all artists")
            logger.info("=" * 60 + "\n")

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
            logger.info(f"Will refresh playcounts for {total_to_refresh} artists\n")

            # Fetch all user artists in bulk (much more efficient - only 2 API calls!)
            lastfm_service = LastFMService(api_key=lastfm_api_key)
            overall_dict, month12_dict = lastfm_service.fetch_all_user_artists(lastfm_user)
            logger.info("")

            for idx, artist in enumerate(artists_for_playcount_refresh, 1):
                logger.info(f"[{idx}/{total_to_refresh}] Refreshing playcounts: {artist.name}")

                # Update user-specific playcounts using metadata service
                if args.user_id:
                    playcount, playcount_12month = metadata_service.update_user_artist_stats(
                        session, args.user_id, artist, overall_dict, month12_dict
                    )

                    if playcount > 0 or playcount_12month > 0:
                        logger.info(f"  ✓ Updated user playcounts: overall={playcount}, 12-month={playcount_12month}")
                        stats['playcounts_updated'] += 1
                    else:
                        logger.info(f"  ✗ No playcount data found")
                else:
                    logger.info(f"  ✗ No user-id specified")
            
            # Commit after each artist to save progress
            try:
                session.commit()
            except Exception as e:
                logger.info(f"  Error saving to database: {e}")
                session.rollback()
                stats['errors'] += 1
        
        logger.info("\n")
    
    session.close()
    
    # Print summary
    logger.info("="*60)
    logger.info("SUMMARY")
    logger.info("="*60)
    logger.info(f"Artists processed: {stats['processed']}")
    logger.info(f"MBIDs fetched: {stats['mbid_fetched']}")
    logger.info(f"MBIDs not found: {stats['mbid_not_found']}")
    logger.info(f"Playcounts updated: {stats['playcounts_updated']}")
    logger.info(f"Images found: {stats['images_found']}")
    logger.info(f"Images not found: {stats['images_not_found']}")
    logger.info(f"Errors: {stats['errors']}")
    logger.info("="*60)
    
    return 0

if __name__ == '__main__':
    exit(main())
