#!/usr/bin/env python3
"""
Migrate an existing database and fetch artist images.
This script:
1. Adds mbid and imageUrl columns if missing
2. Fetches MusicBrainz IDs from Last.fm for all artists
3. Fetches images from fanart.tv

Usage:
    python migrate_and_fetch_images.py --db-path db.backup
"""

import argparse
import os
import time
import requests
from datetime import datetime
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker
import sys
sys.path.insert(0, 'concert-tracker/scripts')
from db_models import Base, Artist
from db_config import get_engine

# Load environment variables
load_dotenv('concert-tracker/scripts/.env')

def log(message: str):
    """Log message with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}")

def migrate_database(engine):
    """Add mbid and imageUrl columns if they don't exist"""
    log("Checking database schema...")
    
    with engine.connect() as conn:
        # Check if columns exist
        result = conn.execute(text("PRAGMA table_info(Artist)"))
        columns = [row[1] for row in result]
        
        needs_migration = False
        
        if 'mbid' not in columns:
            log("  Adding 'mbid' column...")
            conn.execute(text("ALTER TABLE Artist ADD COLUMN mbid VARCHAR"))
            conn.commit()
            needs_migration = True
        
        if 'imageUrl' not in columns:
            log("  Adding 'imageUrl' column...")
            conn.execute(text("ALTER TABLE Artist ADD COLUMN imageUrl VARCHAR"))
            conn.commit()
            needs_migration = True
        
        if needs_migration:
            log("  ✓ Database migrated successfully")
        else:
            log("  ✓ Database schema is up to date")

def fetch_lastfm_mbid(artist_name: str, api_key: str) -> str:
    """Fetch MusicBrainz ID for an artist from Last.fm
    
    Args:
        artist_name: Name of the artist
        api_key: Last.fm API key
        
    Returns:
        MusicBrainz ID or None if not found
    """
    url = "http://ws.audioscrobbler.com/2.0/"
    params = {
        "method": "artist.getinfo",
        "artist": artist_name,
        "api_key": api_key,
        "format": "json"
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        mbid = data.get('artist', {}).get('mbid', '').strip()
        return mbid if mbid else None
        
    except Exception as e:
        log(f"    Error fetching Last.fm data: {e}")
        return None

def fetch_fanart_image(mbid: str, api_key: str) -> tuple:
    """Fetch artist image from fanart.tv with fallback options
    
    Args:
        mbid: MusicBrainz ID
        api_key: fanart.tv API key
        
    Returns:
        Tuple of (image_url, image_type) or (None, None) if not found
        Priority: artistthumb > artistbackground > hdmusiclogo
    """
    url = f"https://webservice.fanart.tv/v3/music/{mbid}"
    params = {'api_key': api_key}
    
    try:
        response = requests.get(url, params=params, timeout=10)
        
        if response.status_code == 404:
            return None, None
        
        response.raise_for_status()
        data = response.json()
        
        # Priority 1: artistthumb (best for artist cards)
        artist_thumbs = data.get('artistthumb', [])
        if artist_thumbs:
            sorted_thumbs = sorted(artist_thumbs, key=lambda x: int(x.get('likes', 0)), reverse=True)
            return sorted_thumbs[0].get('url'), 'artistthumb'
        
        # Priority 2: artistbackground (fallback)
        artist_backgrounds = data.get('artistbackground', [])
        if artist_backgrounds:
            sorted_backgrounds = sorted(artist_backgrounds, key=lambda x: int(x.get('likes', 0)), reverse=True)
            return sorted_backgrounds[0].get('url'), 'artistbackground'
        
        # Priority 3: hdmusiclogo
        hd_logos = data.get('hdmusiclogo', [])
        if hd_logos:
            sorted_logos = sorted(hd_logos, key=lambda x: int(x.get('likes', 0)), reverse=True)
            return sorted_logos[0].get('url'), 'hdmusiclogo'
        
        # Priority 4: albumcover (last resort - use newest album with highest ID)
        albums = data.get('albums', {})
        all_album_covers = []
        for album_id, album_data in albums.items():
            album_covers = album_data.get('albumcover', [])
            all_album_covers.extend(album_covers)
        
        if all_album_covers:
            # Sort by ID (descending) to get the newest/highest ID
            sorted_covers = sorted(all_album_covers, key=lambda x: int(x.get('id', 0)), reverse=True)
            return sorted_covers[0].get('url'), 'albumcover'
        
        return None, None
        
    except Exception as e:
        log(f"    Error fetching fanart: {e}")
        return None, None

def main():
    parser = argparse.ArgumentParser(description='Migrate database and fetch artist images')
    parser.add_argument(
        '--db-path',
        type=str,
        required=True,
        help='Path to SQLite database'
    )
    parser.add_argument(
        '--delay',
        type=float,
        default=0.5,
        help='Delay between API requests in seconds (default: 0.5)'
    )
    parser.add_argument(
        '--skip-migration',
        action='store_true',
        help='Skip database migration step'
    )
    parser.add_argument(
        '--skip-mbid',
        action='store_true',
        help='Skip fetching MusicBrainz IDs (use if already present)'
    )
    parser.add_argument(
        '--skip-images',
        action='store_true',
        help='Skip fetching images (only fetch mbids)'
    )
    
    args = parser.parse_args()
    
    # Get API keys from environment
    lastfm_api_key = os.getenv('LASTFM_API_KEY')
    fanart_api_key = os.getenv('FANART_API_KEY')
    
    if not lastfm_api_key:
        print("Error: LASTFM_API_KEY not found in .env file")
        return 1
    
    if not fanart_api_key and not args.skip_images:
        print("Error: FANART_API_KEY not found in .env file")
        print("Get your free API key from: https://fanart.tv/get-an-api-key/")
        return 1
    
    # Connect to database
    log(f"Connecting to database: {args.db_path}")
    try:
        engine = get_engine(args.db_path)
    except ValueError as e:
        print(f"Error: {e}")
        return 1
    
    # Migrate database
    if not args.skip_migration:
        migrate_database(engine)
    
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # Get all artists
    artists = session.query(Artist).all()
    log(f"Found {len(artists)} artists to process\n")
    
    stats = {
        'processed': 0,
        'mbids_found': 0,
        'mbids_not_found': 0,
        'images_found': 0,
        'images_not_found': 0,
        'errors': 0
    }
    
    # Process each artist
    for i, artist in enumerate(artists, 1):
        log(f"[{i}/{len(artists)}] Processing: {artist.name}")
        
        # Step 1: Fetch MusicBrainz ID if needed
        if not args.skip_mbid and not artist.mbid:
            log(f"  Fetching MusicBrainz ID from Last.fm...")
            mbid = fetch_lastfm_mbid(artist.name, lastfm_api_key)
            
            if mbid:
                log(f"  ✓ Found MBID: {mbid}")
                artist.mbid = mbid
                stats['mbids_found'] += 1
            else:
                log(f"  ✗ No MBID found")
                stats['mbids_not_found'] += 1
            
            time.sleep(args.delay)
        
        # Step 2: Fetch image if we have mbid
        if not args.skip_images and artist.mbid and not artist.imageUrl:
            log(f"  Fetching image from fanart.tv...")
            image_url, image_type = fetch_fanart_image(artist.mbid, fanart_api_key)
            
            if image_url:
                log(f"  ✓ Found image ({image_type}): {image_url[:60]}...")
                artist.imageUrl = image_url
                stats['images_found'] += 1
            else:
                log(f"  ✗ No image found")
                stats['images_not_found'] += 1
            
            time.sleep(args.delay)
        
        stats['processed'] += 1
        
        # Commit after each artist
        try:
            session.commit()
        except Exception as e:
            log(f"  Error saving to database: {e}")
            session.rollback()
            stats['errors'] += 1
        
        log("")  # Empty line for readability
    
    session.close()
    
    # Print summary
    log("="*60)
    log("SUMMARY")
    log("="*60)
    log(f"Artists processed: {stats['processed']}")
    if not args.skip_mbid:
        log(f"MusicBrainz IDs found: {stats['mbids_found']}")
        log(f"MusicBrainz IDs not found: {stats['mbids_not_found']}")
    if not args.skip_images:
        log(f"Images found: {stats['images_found']}")
        log(f"Images not found: {stats['images_not_found']}")
    log(f"Errors: {stats['errors']}")
    log("="*60)
    
    return 0

if __name__ == '__main__':
    exit(main())
