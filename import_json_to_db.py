#!/usr/bin/env python3
"""
Import existing JSON data into database
"""

import json
import sys
from db_writer import ConcertDatabaseWriter

def import_json_to_db(json_file: str, db_path: str):
    """Import concerts from JSON file to database
    
    Args:
        json_file: Path to JSON file (my_concerts.json format)
        db_path: Path to SQLite database
    """
    print(f"Reading JSON file: {json_file}")
    
    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Parse structured JSON (Country -> Artist -> concerts)
    concerts_to_import = []
    artist_playcounts = {}
    recent_artists = set()
    
    for country, artists in data.items():
        for artist_name, artist_data in artists.items():
            playcount = artist_data.get('playcount', 0)
            recent = artist_data.get('recent', False)
            
            artist_playcounts[artist_name] = playcount
            if recent:
                recent_artists.add(artist_name)
            
            for concert in artist_data.get('concerts', []):
                # Add matched_artists field for database writer
                concert['matched_artists'] = [artist_name]
                concerts_to_import.append(concert)
    
    print(f"Found {len(concerts_to_import)} concerts from {len(artist_playcounts)} artists")
    
    # Write to database
    print(f"\nWriting to database: {db_path}")
    with ConcertDatabaseWriter(db_path) as writer:
        writer.write_concerts(concerts_to_import, artist_playcounts, recent_artists)
        writer.print_stats()
    
    print(f"\n✅ Import complete!")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python import_json_to_db.py <json_file> <db_path>")
        print("Example: python import_json_to_db.py my_concerts.json data/concerts.db")
        sys.exit(1)
    
    import_json_to_db(sys.argv[1], sys.argv[2])
