#!/usr/bin/env python3
"""
Background script to fetch artist images from fanart.tv using MusicBrainz IDs.
This runs separately from the concert parser to avoid slowing down parsing.

Usage:
    python fetch_artist_images.py --db-path data/concerts.db
    python fetch_artist_images.py --db-path data/concerts.db --limit 10  # Test mode
"""

import argparse
import os
import time
import requests
from datetime import datetime
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from db_models import Artist

# Load environment variables
load_dotenv()

def log(message: str):
    """Log message with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}")

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
            return None, None  # Artist not found in fanart.tv
        
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
        
    except requests.RequestException as e:
        log(f"  Error fetching fanart for {mbid}: {e}")
        return None, None

def main():
    parser = argparse.ArgumentParser(description='Fetch artist images from fanart.tv')
    parser.add_argument(
        '--db-path',
        type=str,
        default='data/concerts.db',
        help='Path to SQLite database'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit number of artists to process (for testing)'
    )
    parser.add_argument(
        '--delay',
        type=float,
        default=0.5,
        help='Delay between API requests in seconds (default: 0.5)'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Re-fetch images even if already present'
    )
    
    args = parser.parse_args()
    
    # Get fanart.tv API key from environment
    fanart_api_key = os.getenv('FANART_API_KEY')
    if not fanart_api_key:
        print("Error: FANART_API_KEY not found in .env file")
        print("Get your free API key from: https://fanart.tv/get-an-api-key/")
        return 1
    
    # Connect to database
    log(f"Connecting to database: {args.db_path}")
    engine = create_engine(f'sqlite:///{args.db_path}')
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # Query artists that need images
    if args.force:
        query = session.query(Artist).filter(Artist.mbid.isnot(None))
        log("Fetching ALL artists with MusicBrainz IDs (force mode)")
    else:
        query = session.query(Artist).filter(
            Artist.mbid.isnot(None),
            Artist.imageUrl.is_(None)
        )
        log("Fetching artists with MusicBrainz IDs but no images")
    
    if args.limit:
        query = query.limit(args.limit)
        log(f"Limiting to {args.limit} artists")
    
    artists = query.all()
    
    if not artists:
        log("No artists need image fetching!")
        return 0
    
    log(f"Found {len(artists)} artists to process\n")
    
    # Process each artist
    stats = {
        'processed': 0,
        'images_found': 0,
        'images_not_found': 0,
        'errors': 0
    }
    
    for i, artist in enumerate(artists, 1):
        log(f"[{i}/{len(artists)}] Processing: {artist.name}")
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
        if i < len(artists):  # Don't delay after last one
            time.sleep(args.delay)
    
    session.close()
    
    # Print summary
    log("\n" + "="*60)
    log("SUMMARY")
    log("="*60)
    log(f"Artists processed: {stats['processed']}")
    log(f"Images found: {stats['images_found']}")
    log(f"Images not found: {stats['images_not_found']}")
    log(f"Errors: {stats['errors']}")
    log("="*60)
    
    return 0

if __name__ == '__main__':
    exit(main())
