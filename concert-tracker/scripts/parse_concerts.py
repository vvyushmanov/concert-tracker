#!/usr/bin/env python3
"""
CLI entry point for concert parsing

Parses concerts from concerts-metal.com, filters by artist sources,
and saves to database or JSON.

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
import json
import argparse
import time
from dotenv import load_dotenv

# Import from library modules
from parsers import CountryConcertParser, GracefulShutdown
from services import ProxyManager, ArtistSourceManager, LastFMService
from config import ConfigManager
from utils.validation import validate_artist_sources
from utils.credentials import load_credentials

# Import database writer if available
try:
    from database import ConcertDatabaseWriter
    DB_AVAILABLE = True
except ImportError:
    DB_AVAILABLE = False
    ConcertDatabaseWriter = None


def finalize_and_cleanup(db_writer, args, data_to_save, all_concerts, lastfm_artists):
    """Finalize database writes and fetch metadata for artists

    Args:
        db_writer: Database writer instance (or None)
        args: Command line arguments
        data_to_save: Concerts to save
        all_concerts: All concerts (for --save-all)
        lastfm_artists: Last.fm artists set
    """
    # Save JSON if needed
    if args.output in ['json', 'both'] and not args.dry_run:
        print(f"✅ Final output: {len(data_to_save)} concerts in {args.json}")

    # Handle database finalization
    if args.output in ['db', 'both'] and db_writer and not args.dry_run:
        db_writer.print_stats()

        # Auto-fetch metadata for all artists (new and existing without complete metadata)
        # This includes MBID repair and image fetching
        # Strategy: MusicBrainz (primary) → Last.fm (fallback if configured)
        # Always run to ensure no artists are missing MBIDs or images
        print(f"\n🔄 Fetching metadata for artists...")
        if db_writer.stats['artists_created'] > 0:
            print(f"   - New artists created: {db_writer.stats['artists_created']}")
        print(f"   - Checking all artists for missing MBIDs/images...")

        try:
            from services.metadata import fetch_artist_metadata
            # Note: fetch_artist_metadata reads Last.fm config from ConfigManager
            # It will use MusicBrainz as primary source and Last.fm as fallback if configured
            result = fetch_artist_metadata(args.db_path, silent=False, user_id=args.user_id)
            if result == 0:
                print("✅ Metadata fetch completed")
            else:
                print(f"⚠️  Metadata fetch had issues (exit code: {result})")
        except Exception as e:
            print(f"⚠️  Could not auto-fetch metadata: {e}")

        db_writer.close()
        print(f"✅ Database output: {args.db_path}")

    # Optionally save all concerts (JSON only)
    if args.save_all and lastfm_artists and args.output in ['json', 'both'] and not args.dry_run:
        all_filename = args.json.replace('.json', '_all.json')
        with open(all_filename, 'w', encoding='utf-8') as f:
            json.dump(all_concerts, f, indent=2, ensure_ascii=False)
        print(f"Saved all {len(all_concerts)} concerts to {all_filename}")


def main():
    # Load environment variables
    load_dotenv()
    
    parser = argparse.ArgumentParser(
        description='Parse concerts from country pages, filtered by Last.fm artists'
    )
    parser.add_argument(
        '--json',
        help='Output JSON file (default: my_concerts.json)',
        default='my_concerts.json'
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
        '--save-all',
        action='store_true',
        help='Save all concerts in addition to filtered ones'
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
        choices=['json', 'db', 'both'],
        default='json',
        help='Output mode: json (default), db (database), or both'
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
    
    args = parser.parse_args()
    
    # Dry run mode overrides output settings
    if args.dry_run:
        print("\n" + "="*60)
        print("DRY RUN MODE - NO DATA WILL BE SAVED")
        print("="*60)
        print("This mode will fetch and parse data but skip all writes.")
        print("Useful for testing proxies, delays, and parsing logic.")
        print("="*60 + "\n")
    
    # Check if database module is available
    if args.output in ['db', 'both'] and not DB_AVAILABLE:
        print("ERROR: Database output requested but SQLAlchemy is not installed")
        print("Please install: pip install sqlalchemy")
        return 1
    
    # Initialize database writer if needed (skip in dry run)
    db_writer = None
    if not args.dry_run and args.output in ['db', 'both']:
        if args.db_path:
            print(f"Local database output mode: SQLite at {args.db_path}")
        else:
            print(f"Using configured database")
        if args.user_id:
            print(f"User-specific mode: Writing to UserArtist and UserConcert for user ID {args.user_id}")
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
            print("\n" + "="*60)
            print("PROXY CONFIGURATION")
            print("="*60)
            
            validate = not args.no_proxy_validation
            
            if args.use_proxies == 'webshare':
                config = ConfigManager()
                webshare_url = config.get('WEBSHARE_PROXY_URL')
                if not webshare_url:
                    print("❌ ERROR: WEBSHARE_PROXY_URL not found in settings")
                    print("   Add your Webshare download URL to .env or settings:")
                    print("   WEBSHARE_PROXY_URL=https://proxy.webshare.io/api/v2/...")
                    return 1
                
                print(f"Using Webshare.io proxies")
                proxy_manager = ProxyManager(
                    webshare_url=webshare_url,
                    validate_on_load=validate,
                    validation_workers=args.proxy_workers
                )
            elif args.use_proxies == 'custom':
                proxy_file = 'proxies.txt'
                if not os.path.exists(proxy_file):
                    print(f"❌ ERROR: {proxy_file} not found")
                    print(f"   Create it with: python proxy_manager.py create-template")
                    return 1
                
                print(f"Loading custom proxies from: {proxy_file}")
                proxy_manager = ProxyManager(
                    proxy_file=proxy_file,
                    validate_on_load=validate,
                    validation_workers=args.proxy_workers
                )
            
            if proxy_manager and proxy_manager.proxies:
                proxy_manager.print_stats()
            else:
                print("⚠️  No working proxies available. Continuing without proxies.")
                proxy_manager = None
            
            print("="*60 + "\n")
        else:
            print("\n⚠️  No proxies configured. Using direct connection.")
            print("   To avoid IP bans, use:")
            print("   --use-proxies webshare  (add WEBSHARE_PROXY_URL to .env)")
            print("   --use-proxies custom    (create proxies.txt)\n")
        
        # Load credentials using centralized loader
        # Supports both user-specific mode (with --user-id) and global mode (without --user-id)
        credentials, validation = load_credentials(
            user_id=args.user_id,
            db_path=args.db_path,
            require_countries=True
        )

        if validation.is_error():
            print(validation)
            return 1

        # Extract credentials (works for both user-specific and global modes)
        country_codes = credentials.country_codes
        lastfm_api_key = credentials.lastfm_api_key
        lastfm_user = credentials.lastfm_user
        min_playcount = credentials.min_playcount

        # Display configuration info
        if args.user_id:
            print(f"User: {credentials.username} (ID: {args.user_id})")
            print(f"Active countries for user: {', '.join(country_codes) if country_codes else 'None'}")
        else:
            print(f"ℹ️  {validation.message}")  # Global mode for all concerts/artists
            print(f"Country codes from config: {', '.join(country_codes)}")
        
        # Fetch artists for concert filtering
        lastfm_artists = set()
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

            # Print validation result
            print(validation_result)

            # Exit if validation failed
            if validation_result.is_error():
                return 1

            # Show which sources are being used
            print(f"\nArtist sources: {manager.get_source_summary()}")
            if lastfm_user:
                print(f"Last.fm user: {lastfm_user}")
            print(f"Minimum playcount threshold: {min_playcount}")

            # Fetch artists from all available sources
            lastfm_artists, recent_artists, artist_playcounts, artist_playcounts_12month, artist_mbids = \
                manager.fetch_filtering_artists()

            if not lastfm_artists:
                print("WARNING: No artists loaded from any source, proceeding without filtering")
        else:
            # Validate no-filter mode
            validation_result = validate_artist_sources(
                user_id=args.user_id,
                lastfm_configured=False,  # Doesn't matter in no-filter mode
                userartist_count=0,  # Doesn't matter in no-filter mode
                no_filter=True
            )
            print(validation_result)
            print()
        
        print()
        
        # Collect all concerts from all countries
        all_concerts = []
        all_filtered_concerts = []
        
        # Initialize output file with empty array (only for JSON output, skip in dry run)
        if not args.dry_run and args.output in ['json', 'both']:
            with open(args.json, 'w', encoding='utf-8') as f:
                json.dump([], f)
            print(f"Initialized output file: {args.json}\n")
        
        # Track proxy stats across all countries
        total_proxy_successes = 0
        total_proxy_failures = 0
        
        try:
            for idx, country_code in enumerate(country_codes):
                # Check for interruption
                if shutdown.interrupted:
                    print(f"\n⚠️  Stopping after completing current country...")
                    break
                
                # Add delay between countries to avoid rate limiting
                if idx > 0:
                    delay_time = args.delay * CountryConcertParser.COUNTRY_DELAY_MULTIPLIER
                    print(f"\nWaiting {delay_time} seconds before next country...")
                    time.sleep(delay_time)
                
                print(f"\n{'='*80}")
                print(f"Processing country: {country_code.upper()}")
                print(f"{'='*80}")
        
                concert_parser = CountryConcertParser(
                    country_code,
                    max_pages=args.max_pages,
                    delay=args.delay,
                    lastfm_artists=lastfm_artists,
                    proxy_manager=proxy_manager,
                    debug=args.debug,
                    shutdown_flag=shutdown
                )
        
                # Define callback wrapper for incremental saving
                def save_callback(all_concerts_so_far, filtered_concerts_so_far, page_num):
                    # Skip all saves in dry run mode
                    if args.dry_run:
                        print(f"  🔍 [DRY RUN] Would save progress here (page {page_num})")
                        return
                    
                    # Save based on frequency setting
                    should_save = False
                    
                    if args.save_frequency == 'page':
                        should_save = True
                    elif args.save_frequency == 'auto':
                        # Save every PAGES_PER_SAVE pages
                        should_save = (page_num % CountryConcertParser.PAGES_PER_SAVE == 0)
                    
                    if should_save:
                        # Save to JSON if needed
                        if args.output in ['json', 'both']:
                            concert_parser.save_progress(
                                args.json,
                                all_concerts,
                                all_filtered_concerts,
                                recent_artists,
                                artist_playcounts,
                                bool(lastfm_artists)
                            )
                        
                        # Save to database if needed
                        if args.output in ['db', 'both'] and db_writer:
                            data_to_write = filtered_concerts_so_far if lastfm_artists else all_concerts_so_far
                            db_writer.write_concerts(data_to_write, artist_playcounts, artist_playcounts_12month, recent_artists, artist_mbids)
                        
                        print(f"  💾 Progress saved (page {page_num})")
        
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
                    # Save to JSON if needed
                    if args.output in ['json', 'both']:
                        concert_parser.save_progress(
                            args.json,
                            all_concerts,
                            all_filtered_concerts,
                            recent_artists,
                            artist_playcounts,
                            bool(lastfm_artists)
                        )
                    
                    # Save to database if needed
                    if args.output in ['db', 'both'] and db_writer:
                        data_to_write = concert_parser.filtered_concerts if lastfm_artists else concert_parser.concerts
                        db_writer.write_concerts(data_to_write, artist_playcounts, artist_playcounts_12month, recent_artists, artist_mbids)
        
                data_to_save = all_filtered_concerts if lastfm_artists else all_concerts
                if args.dry_run:
                    print(f"\n🔍 [DRY RUN] Country complete: {len(data_to_save)} total concerts parsed (not saved)")
                else:
                    output_desc = f"{args.json}" if args.output in ['json', 'both'] else "database"
                    print(f"\n💾 Country complete: {len(data_to_save)} total concerts saved to {output_desc}")
                
                # Accumulate proxy stats
                total_proxy_successes += concert_parser.proxy_successes
                total_proxy_failures += concert_parser.proxy_failures
                
                # Print country summary
                if not args.no_summary:
                    # Pass normalizer to show normalization preview
                    concert_parser.print_statistics(country_code, normalizer=display_normalizer)
        
        finally:
            # Always execute cleanup, even on interruption
            data_to_save = all_filtered_concerts if lastfm_artists else all_concerts
            finalize_and_cleanup(db_writer, args, data_to_save, all_concerts, lastfm_artists)
    
    # Print overall summary
    print(f"\n\n{'='*80}")
    print("OVERALL SUMMARY")
    print(f"{'='*80}")
    print(f"Countries processed: {len(country_codes)}")
    print(f"Total concerts found: {len(all_concerts)}")
    if lastfm_artists:
        print(f"Concerts matching Last.fm artists: {len(all_filtered_concerts)}")
        print(f"Overall match rate: {len(all_filtered_concerts)/len(all_concerts)*100:.1f}%" if all_concerts else "Match rate: 0%")
    
    # Print proxy statistics if proxies were used
    if proxy_manager:
        print(f"\nProxy usage:")
        total_proxy_requests = total_proxy_successes + total_proxy_failures
        print(f"  Successful requests: {total_proxy_successes}")
        print(f"  Failed requests: {total_proxy_failures}")
        if total_proxy_requests > 0:
            print(f"  Success rate: {total_proxy_successes/total_proxy_requests*100:.1f}%")
        proxy_manager.print_stats()
    
    print(f"{'='*80}\n")
    
    # Cleanup is now handled in the finally block above
    # Print dry-run message if applicable
    if args.dry_run:
        data_to_save = all_filtered_concerts if lastfm_artists else all_concerts
        print(f"\n🔍 [DRY RUN] Completed: {len(data_to_save)} concerts parsed (nothing saved)")
        print(f"   To save data, run without --dry-run flag")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
