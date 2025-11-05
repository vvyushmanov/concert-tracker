#!/usr/bin/env python3
"""
CLI entry point for artist metadata fetching

Fetches artist metadata (MBIDs, images, playcounts) from Last.fm and Fanart.tv.

Usage:
    python cli/fetch_metadata.py [options]
"""

import sys
import os
import argparse
import time
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

# Import from library modules
from database.models import Artist, UserArtist
from database.config import get_engine
from utils import fetch_all_user_artists, lookup_artist_playcounts
from config import ConfigManager, load_user_config
from services import ArtistMetadataService
from utils import log
from services.metadata import fetch_fanart_image, update_user_artist_stats

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
        # User-specific mode
        try:
            user_config_data = load_user_config(args.user_id, args.db_path)
            user_settings = user_config_data['settings']
            lastfm_api_key = user_settings.get('LASTFM_API_KEY')
            lastfm_user = user_settings.get('LASTFM_USER')
            log(f"User-specific mode: {user_config_data['user'].username} (ID: {args.user_id})")
            log(f"Last.fm user: {lastfm_user}")
        except ValueError as e:
            print(f"Error: {e}")
            return 1
        
        # Get FANART_API_KEY from global config (shared resource)
        config = ConfigManager()
        fanart_api_key = config.get('FANART_API_KEY')
    else:
        # Global mode (legacy)
        log("WARNING: Running in legacy mode without --user-id")
        log("Playcounts will not be saved. Use --user-id for full functionality.")
        config = ConfigManager()
        fanart_api_key = config.get('FANART_API_KEY')
        lastfm_api_key = config.get('LASTFM_API_KEY')
        lastfm_user = config.get('LASTFM_USER', '')
        log(f"Last.fm user: {lastfm_user}")
    
    if not fanart_api_key:
        print("Error: FANART_API_KEY not found in settings")
        print("Get your free API key from: https://fanart.tv/get-an-api-key/")
        return 1
    
    if not lastfm_api_key:
        print("Error: LASTFM_API_KEY not found in settings")
        print("Get your API key from: https://www.last.fm/api/account/create")
        return 1
    
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
    # This efficiently discovers and fills in missing MBIDs using bulk fetch
    artists_missing_mbid = [a for a in all_artists if not a.mbid]
    
    if artists_missing_mbid:
        log("=" * 60)
        log(f"PHASE 0: MBID Auto-Repair ({len(artists_missing_mbid)} artists without MBID)")
        log("=" * 60 + "\n")
        
        # Fetch all user artists in bulk
        overall_dict, month12_dict = fetch_all_user_artists(lastfm_api_key, lastfm_user)
        log("")
        
        mbid_repair_count = 0
        for idx, artist in enumerate(artists_missing_mbid, 1):
            # Look up MBID from pre-fetched data
            _, _, mbid = lookup_artist_playcounts(
                artist.name,
                None,
                overall_dict,
                month12_dict
            )
            
            # If not found in user's top artists, try artist.getinfo as fallback
            if not mbid:
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
                except Exception as e:
                    log(f"[{idx}/{len(artists_missing_mbid)}] {artist.name}: Error fetching from artist.getinfo: {e}")
            
            if mbid:
                log(f"[{idx}/{len(artists_missing_mbid)}] {artist.name}: Found MBID {mbid}")
                artist.mbid = mbid
                mbid_repair_count += 1
            else:
                log(f"[{idx}/{len(artists_missing_mbid)}] {artist.name}: MBID not found")
        
        # Commit all MBID updates
        try:
            session.commit()
            log(f"\n✓ Auto-repaired {mbid_repair_count}/{len(artists_missing_mbid)} MBIDs\n")
        except Exception as e:
            log(f"Error saving MBID repairs: {e}")
            session.rollback()
    
    # If only refreshing playcounts, skip the normal processing phases
    if args.refresh_playcounts and not args.force:
        log(f"Refresh playcounts mode: Will update playcounts for all {len(all_artists)} artists")
        artists_without_mbid = []
        artists_with_mbid = []
    else:
        # Normal mode: separate into groups for processing
        if args.force:
            log("Force mode: Will re-fetch metadata for all artists")
        
        artists_without_mbid = [a for a in all_artists if a.mbid is None]
        artists_with_mbid = [a for a in all_artists if a.mbid is not None and (args.force or a.imageUrl is None)]
        
        if args.limit:
            # Apply limit across both groups
            total_artists = artists_without_mbid + artists_with_mbid
            artists_without_mbid = [a for a in total_artists if a.mbid is None][:args.limit]
            remaining = args.limit - len(artists_without_mbid)
            artists_with_mbid = [a for a in total_artists if a.mbid is not None][:remaining] if remaining > 0 else []
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
    
    # Phase 1: Process artists without MBID (fetch everything)
    if artists_without_mbid:
        log("=" * 60)
        log("PHASE 1: Fetching metadata from Last.fm for artists without MBID")
        log("=" * 60 + "\n")
        
        # Fetch all user artists in bulk for efficient lookup
        overall_dict, month12_dict = fetch_all_user_artists(lastfm_api_key, lastfm_user)
        log("")
        
        for artist in artists_without_mbid:
            current_index += 1
            log(f"[{current_index}/{total_count}] Processing: {artist.name}")
            log(f"  Current: MBID=None")
            
            # Look up playcounts and MBID from pre-fetched data
            playcount, playcount_12month, mbid = lookup_artist_playcounts(
                artist.name,
                None,  # No MBID yet
                overall_dict,
                month12_dict
            )
            
            if mbid:
                log(f"  ✓ Found MBID: {mbid}")
                artist.mbid = mbid
                artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                stats['mbid_fetched'] += 1
            else:
                log(f"  ✗ MBID not found")
                stats['mbid_not_found'] += 1
            
            # Update user-specific playcounts
            if args.user_id and (playcount > 0 or playcount_12month > 0):
                log(f"  ✓ Updated user playcounts: overall={playcount}, 12-month={playcount_12month}")
                update_user_artist_stats(session, args.user_id, artist, playcount, playcount_12month)
                stats['playcounts_updated'] += 1
            
            # Try to fetch image from fanart.tv if we have MBID
            if mbid:
                image_url, image_type = fetch_fanart_image(mbid, fanart_api_key)
                
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
    
    # Phase 2: Process artists with MBID but no images
    if artists_with_mbid:
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
    
    # Phase 3: Refresh playcounts for all artists (if requested)
    if args.refresh_playcounts:
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
    log(f"MBIDs fetched from Last.fm: {stats['mbid_fetched']}")
    log(f"MBIDs not found: {stats['mbid_not_found']}")
    log(f"Playcounts updated: {stats['playcounts_updated']}")
    log(f"Images found: {stats['images_found']}")
    log(f"Images not found: {stats['images_not_found']}")
    log(f"Errors: {stats['errors']}")
    log("="*60)
    
    return 0

if __name__ == '__main__':
    exit(main())
