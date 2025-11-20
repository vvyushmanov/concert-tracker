#!/usr/bin/env python3
"""
CLI entry point for concert parsing

Parses concerts from concerts-metal.com, filters by artist sources,
and saves to database.

Artist Sources:
    - UserArtist table (user-specific saved artists)
    - Last.fm API (optional, if configured)
    - No filter mode (--no-filter): fetch all concerts

Credential Loading:
    - Uses centralized load_credentials() for all modes
    - User-specific mode: --user-id (for per-user concert filtering)
    - Global mode: no --user-id (for all concerts/artists, admin tasks)
    - Validates credentials and provides helpful error messages

Usage:
    python cli/parse_concerts.py [options]
"""

import sys
import os
import argparse
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv

# Import logging infrastructure
from utils import setup_logging, get_logger, interruptible_sleep

# Import from library modules
from parsers import CountryConcertParser, GracefulShutdown

# Setup module logger
logger = get_logger(__name__)
from services import ProxyManager, ArtistSourceManager, LastFMService
from services.metadata_service import fetch_artist_metadata
from config import ConfigManager
from utils.validation import validate_artist_sources
from utils.credentials import load_credentials
from database import ConcertDatabaseWriter


def finalize_and_cleanup(
    db_writer: Optional['ConcertDatabaseWriter'],
    args: argparse.Namespace,
) -> None:
    """
    Finalize database writes and optionally trigger metadata enrichment.

    Args:
        db_writer: Database writer instance (None if using JSON output)
        args: Command line arguments with user settings

    Side Effects:
        - Prints database statistics (if db_writer provided)
        - Spawns metadata fetch subprocess for artist enrichment
        - Commits database transaction and closes session
        - Logs database output path
    """

    # Handle database finalization
    if args.output in ['db'] and db_writer and not args.dry_run:
        db_writer.print_stats()

        # Auto-fetch metadata for all artists (new and existing without complete metadata)
        # This includes MBID repair and image fetching
        # Strategy: MusicBrainz (primary) → Last.fm (fallback if configured)
        # Always run to ensure no artists are missing MBIDs or images
        logger.info("Fetching metadata for artists...")
        if db_writer.stats['artists_created'] > 0:
            logger.info(f"  New artists created: {db_writer.stats['artists_created']}")
        logger.info("  Checking all artists for missing MBIDs/images...")

        try:
            # Note: fetch_artist_metadata reads Last.fm config from ConfigManager
            # It will use MusicBrainz as primary source and Last.fm as fallback if configured
            result = fetch_artist_metadata(args.db_path, silent=False, user_id=args.user_id)
            if result == 0:
                logger.info("Metadata fetch completed")
            else:
                logger.warning(f"Metadata fetch had issues (exit code: {result})")
        except Exception as e:
            logger.warning(f"Could not auto-fetch metadata: {e}")

        db_writer.close()
        logger.info(f"Database output: {args.db_path}")

def main():
    # Load environment variables
    load_dotenv()

    # Parse arguments first to get debug flag
    parser = argparse.ArgumentParser(
        description='Parse concerts from country pages, filtered by Last.fm artists'
    )
    parser.add_argument(
        '--max-pages',
        type=int,
        help='Maximum number of pages per country (default: no limit)',
        default=None
    )
    parser.add_argument(
        '--delay',
        type=float,
        help=f'Delay in seconds between page requests (default: {CountryConcertParser.DEFAULT_DELAY})',
        default=CountryConcertParser.DEFAULT_DELAY
    )
    parser.add_argument(
        '--no-summary',
        action='store_true',
        help='Do not print summary to console'
    )
    parser.add_argument(
        '--no-filter',
        action='store_true',
        help='Do not filter by Last.fm artists (get all concerts)'
    )
    parser.add_argument(
        '--save-frequency',
        type=str,
        choices=['page', 'country', 'auto'],
        default='auto',
        help=f'How often to save progress: per page, per country, or auto (every {CountryConcertParser.PAGES_PER_SAVE} pages, default: auto)'
    )
    parser.add_argument(
        '--output',
        type=str,
        choices=['db'],
        default='db',
        help='Output mode: db (default)'
    )
    parser.add_argument(
        '--db-path',
        type=str,
        help='Path to SQLite database file (optional if DATABASE_URL env var is set)',
        default=None
    )
    parser.add_argument(
        '--use-proxies',
        type=str,
        choices=['custom', 'webshare'],
        help='Enable proxy rotation: custom (from proxies.txt) or webshare (from WEBSHARE_PROXY_URL in .env)',
        default=None
    )
    parser.add_argument(
        '--no-proxy-validation',
        action='store_true',
        help='Skip proxy validation on load (faster startup but may use dead proxies)'
    )
    parser.add_argument(
        '--proxy-workers',
        type=int,
        default=50,
        help='Number of parallel workers for proxy validation (default: 50)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Dry run mode: fetch and parse data but do not save anything (for testing/debugging)'
    )
    parser.add_argument(
        '--debug',
        action='store_true',
        help='Enable debug mode with verbose logging and timing information'
    )
    parser.add_argument(
        '--user-id',
        type=int,
        help='User ID for per-user data (creates UserArtist and UserConcert links)',
        default=None
    )
    parser.add_argument(
        '--no-page-detection',
        action='store_true',
        help='Disable automatic page count detection (use sequential fetching instead)'
    )
    parser.add_argument(
        '--no-color-log',
        action='store_true',
        help='Disable colored output in logs (useful for log files or CI/CD)'
    )

    args = parser.parse_args()

    # Setup logging based on debug flag
    setup_logging(verbose=args.debug, use_colors=not args.no_color_log)

    # Dry run mode overrides output settings
    if args.dry_run:
        logger.info("=" * 60)
        logger.info("DRY RUN MODE - NO DATA WILL BE SAVED")
        logger.info("=" * 60)
        logger.info("This mode will fetch and parse data but skip all writes.")
        logger.info("Useful for testing proxies, delays, and parsing logic.")
        logger.info("=" * 60)

    
    # Initialize database writer if needed (skip in dry run)
    db_writer = None
    if not args.dry_run and args.output in ['db']:
        if args.db_path:
            logger.info(f"Local database output mode: SQLite at {args.db_path}")
        else:
            logger.info("Using configured database")
        if args.user_id:
            logger.info(f"User-specific mode: Writing to UserArtist and UserConcert for user ID {args.user_id}")
        db_writer = ConcertDatabaseWriter(args.db_path, user_id=args.user_id, debug=args.debug)
    
    # Get normalizer for display purposes
    # In normal mode: use db_writer's normalizer
    # In dry-run mode: create a temporary in-memory normalizer
    if db_writer:
        display_normalizer = db_writer.normalizer
    else:
        from database.models import get_session
        from database.normalizers import CityNormalizer
        display_session = get_session(':memory:')
        display_normalizer = CityNormalizer(display_session, verbose=args.debug)
    
    # Use graceful shutdown handler for the entire main function
    with GracefulShutdown() as shutdown:
        # Initialize proxy manager if needed
        proxy_manager = None
        if args.use_proxies:
            logger.info("=" * 60)
            logger.info("PROXY CONFIGURATION")
            logger.info("=" * 60)
            
            validate = not args.no_proxy_validation
            
            if args.use_proxies == 'webshare':
                config = ConfigManager()
                webshare_url = config.get('WEBSHARE_PROXY_URL')
                if not webshare_url:
                    logger.error("WEBSHARE_PROXY_URL not found in settings")
                    logger.error("Add your Webshare download URL to .env or settings:")
                    logger.error("WEBSHARE_PROXY_URL=https://proxy.webshare.io/api/v2/...")
                    return 1

                logger.info("Using Webshare.io proxies")
                proxy_manager = ProxyManager(
                    webshare_url=webshare_url,
                    validate_on_load=validate,
                    validation_workers=args.proxy_workers
                )
            elif args.use_proxies == 'custom':
                proxy_file = 'proxies.txt'
                if not os.path.exists(proxy_file):
                    logger.error(f"{proxy_file} not found")
                    logger.error("Create it with: python proxy_manager.py create-template")
                    return 1

                logger.info(f"Loading custom proxies from: {proxy_file}")
                proxy_manager = ProxyManager(
                    proxy_file=proxy_file,
                    validate_on_load=validate,
                    validation_workers=args.proxy_workers
                )
            
            if proxy_manager and proxy_manager.proxies:
                proxy_manager.print_stats()
            else:
                logger.warning("No working proxies available. Continuing without proxies.")
                proxy_manager = None

            logger.info("=" * 60)
        else:
            logger.warning("No proxies configured. Using direct connection.")
            logger.info("To avoid IP bans, use:")
            logger.info("  --use-proxies webshare  (add WEBSHARE_PROXY_URL to .env)")
            logger.info("  --use-proxies custom    (create proxies.txt)")
        
        # Load credentials using centralized loader
        # Supports both user-specific mode (with --user-id) and global mode (without --user-id)
        credentials, validation = load_credentials(
            user_id=args.user_id,
            db_path=args.db_path,
            require_countries=True
        )

        if validation.is_error():
            logger.error(str(validation))
            return 1

        # Extract credentials (works for both user-specific and global modes)
        country_codes = credentials.country_codes
        lastfm_api_key = credentials.lastfm_api_key
        lastfm_user = credentials.lastfm_user
        min_playcount = credentials.min_playcount

        # Display configuration info
        if args.user_id:
            logger.info(f"User: {credentials.username} (ID: {args.user_id})")
            logger.info(f"Active countries for user: {', '.join(country_codes) if country_codes else 'None'}")
        else:
            logger.info(f"Global mode: {validation.message}")
            logger.info(f"Country codes from config: {', '.join(country_codes)}")
        
        # Fetch artists for concert filtering
        filtering_artists = set()
        recent_artists = set()
        artist_playcounts = {}
        artist_playcounts_12month = {}
        artist_mbids = {}

        if not args.no_filter:
            # Get database session for ArtistSourceManager
            # Use db_writer's session if available, otherwise create temporary session
            if db_writer:
                manager_session = db_writer.session
            else:
                from database.models import get_session
                manager_session = get_session(args.db_path)

            # Initialize Last.fm service if API key available
            lastfm_service = None
            if lastfm_api_key and lastfm_user:
                lastfm_service = LastFMService(lastfm_api_key)

            # Create ArtistSourceManager
            manager = ArtistSourceManager(
                session=manager_session,
                user_id=args.user_id,
                lastfm_service=lastfm_service,
                lastfm_user=lastfm_user,
                min_playcount=min_playcount
            )

            # Validate artist sources using centralized validation
            from database.models import UserArtist
            userartist_count = manager_session.query(UserArtist).filter_by(userId=args.user_id).count()

            validation_result = validate_artist_sources(
                user_id=args.user_id,
                lastfm_configured=(lastfm_service is not None and lastfm_user is not None),
                userartist_count=userartist_count,
                no_filter=False  # We're in filter mode here
            )

            # Log validation result at appropriate level
            validation_result.log(logger)

            # Exit if validation failed
            if validation_result.is_error():
                return 1

            # Show which sources are being used
            logger.info(f"Artist sources: {manager.get_source_summary()}")
            if lastfm_user:
                logger.info(f"Last.fm user: {lastfm_user}")
            logger.info(f"Minimum playcount threshold: {min_playcount}")

            # Fetch artists from all available sources
            filtering_artists, recent_artists, artist_playcounts, artist_playcounts_12month, artist_mbids = \
                manager.fetch_filtering_artists()

            if not filtering_artists:
                logger.error("No artists loaded from any source, exiting")
                return 1
        else:
            # Validate no-filter mode
            validation_result = validate_artist_sources(
                user_id=args.user_id,
                lastfm_configured=False,  # Doesn't matter in no-filter mode
                userartist_count=0,  # Doesn't matter in no-filter mode
                no_filter=True
            )
            validation_result.log(logger)
        
        # Collect all concerts from all countries
        all_concerts = []
        all_filtered_concerts = []
        
        # Track proxy stats across all countries
        total_proxy_successes = 0
        total_proxy_failures = 0
        
        try:
            for idx, country_code in enumerate(country_codes):
                # Check for interruption
                if shutdown.interrupted:
                    logger.warning("Stopping after completing current country...")
                    break

                # Add delay between countries to avoid rate limiting
                if idx > 0:
                    delay_time = args.delay * CountryConcertParser.COUNTRY_DELAY_MULTIPLIER
                    logger.info(f"Waiting {delay_time} seconds before next country...")
                    if not interruptible_sleep(delay_time, shutdown):
                        logger.warning("Interrupted during country delay...")
                        break

                logger.info("=" * 80)
                logger.info(f"Processing country: {country_code.upper()}")
                logger.info("=" * 80)
        
                concert_parser = CountryConcertParser(
                    country_code,
                    max_pages=args.max_pages,
                    delay=args.delay,
                    lastfm_artists=filtering_artists,
                    proxy_manager=proxy_manager,
                    debug=args.debug,
                    shutdown_flag=shutdown
                )
        
                # Define callback wrapper for incremental saving
                def save_callback(all_concerts_so_far, filtered_concerts_so_far, page_num):
                    # Skip all saves in dry run mode
                    if args.dry_run:
                        logger.info(f"[DRY RUN] Would save progress here (page {page_num})")
                        return

                    # Save based on frequency setting
                    should_save = False

                    if args.save_frequency == 'page':
                        should_save = True
                    elif args.save_frequency == 'auto':
                        # Save every PAGES_PER_SAVE pages
                        should_save = (page_num % CountryConcertParser.PAGES_PER_SAVE == 0)

                    if should_save:
                        # Save to database if needed
                        if args.output in ['db'] and db_writer:
                            data_to_write = filtered_concerts_so_far if filtering_artists else all_concerts_so_far
                            db_writer.write_concerts(data_to_write, artist_playcounts, artist_playcounts_12month, recent_artists, artist_mbids)

                        logger.info(f"Progress saved (page {page_num})")
        
                # Parse all pages for this country
                # Use callback for 'page' and 'auto' modes
                callback = save_callback if args.save_frequency in ['page', 'auto'] else None
                detect_pages = not args.no_page_detection
                concert_parser.parse_all_pages(on_page_complete=callback, detect_total_pages=detect_pages)
                
                # Collect final results from this country
                all_concerts.extend(concert_parser.concerts)
                all_filtered_concerts.extend(concert_parser.filtered_concerts)
        
                # Save after country completion (for 'country' mode or final save for 'auto')
                if not args.dry_run and args.save_frequency in ['country', 'auto']:
                    
                    # Save to database if needed
                    if args.output in ['db'] and db_writer:
                        data_to_write = concert_parser.filtered_concerts if filtering_artists else concert_parser.concerts
                        db_writer.write_concerts(data_to_write, artist_playcounts, artist_playcounts_12month, recent_artists, artist_mbids)
        
                data_to_save = all_filtered_concerts if filtering_artists else all_concerts
                if args.dry_run:
                    logger.info(f"[DRY RUN] Country complete: {len(data_to_save)} total concerts parsed (not saved)")
                else:
                    logger.info(f"Country complete: {len(data_to_save)} total concerts saved to database")
                
                # Accumulate proxy stats
                total_proxy_successes += concert_parser.proxy_successes
                total_proxy_failures += concert_parser.proxy_failures
                
                # Print country summary
                if not args.no_summary:
                    # Pass normalizer to show normalization preview
                    concert_parser.print_statistics(country_code, normalizer=display_normalizer)
        
        finally:
            # Always execute cleanup, even on interruption
            finalize_and_cleanup(db_writer, args)
    
    # Print overall summary
    logger.info("=" * 80)
    logger.info("OVERALL SUMMARY")
    logger.info("=" * 80)
    logger.info(f"Countries processed: {len(country_codes)}")
    logger.info(f"Total concerts found: {len(all_concerts)}")
    if filtering_artists:
        logger.info(f"Concerts matching filtered artists: {len(all_filtered_concerts)}")
        match_rate = f"{len(all_filtered_concerts)/len(all_concerts)*100:.1f}%" if all_concerts else "0%"
        logger.info(f"Overall match rate: {match_rate}")

    # Print proxy statistics if proxies were used
    if proxy_manager:
        logger.info("Proxy usage:")
        total_proxy_requests = total_proxy_successes + total_proxy_failures
        logger.info(f"  Successful requests: {total_proxy_successes}")
        logger.info(f"  Failed requests: {total_proxy_failures}")
        if total_proxy_requests > 0:
            logger.info(f"  Success rate: {total_proxy_successes/total_proxy_requests*100:.1f}%")
        proxy_manager.print_stats()

    # Cleanup is now handled in the finally block above
    # Print dry-run message if applicable
    if args.dry_run:
        data_to_save = all_filtered_concerts if filtering_artists else all_concerts
        logger.info(f"[DRY RUN] Completed: {len(data_to_save)} concerts parsed (nothing saved)")
        logger.info("To save data, run without --dry-run flag")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
