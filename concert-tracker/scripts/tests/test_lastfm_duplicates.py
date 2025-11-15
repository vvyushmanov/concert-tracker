#!/usr/bin/env python3
"""
Test for duplicate artist names (case-insensitive) in Last.fm data
"""

import sys
import os
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import ConfigManager


def main():
    config = ConfigManager()
    api_key = config.get('LASTFM_API_KEY')
    user = config.get('LASTFM_USER')

    if not api_key or not user:
        print("ERROR: Last.fm not configured")
        return 1

    print("=" * 80)
    print("CHECKING FOR DUPLICATE ARTIST NAMES IN LAST.FM DATA")
    print("=" * 80)

    params = {
        'method': 'user.gettopartists',
        'user': user,
        'api_key': api_key,
        'format': 'json',
        'limit': 1000,
        'period': '12month'
    }

    response = requests.get('http://ws.audioscrobbler.com/2.0/', params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    artists = data.get('topartists', {}).get('artist', [])
    print(f"Total artists from API: {len(artists)}\n")

    # Track lowercase names and MBIDs
    lowercase_names = {}
    mbid_to_artists = {}

    for artist in artists:
        name = artist.get('name', '')
        if not name:
            continue

        name_lower = name.lower()
        mbid = artist.get('mbid', '').strip()

        # Check for lowercase name collisions
        if name_lower in lowercase_names:
            print(f"⚠️  DUPLICATE LOWERCASE NAME:")
            print(f"   First:  '{lowercase_names[name_lower]}'")
            print(f"   Second: '{name}'")
            print(f"   Lowercase: '{name_lower}'")
            print()
        else:
            lowercase_names[name_lower] = name

        # Check for MBID collisions
        if mbid:
            if mbid in mbid_to_artists:
                print(f"⚠️  DUPLICATE MBID:")
                print(f"   First:  '{mbid_to_artists[mbid]}'")
                print(f"   Second: '{name}'")
                print(f"   MBID: {mbid}")
                print()
            else:
                mbid_to_artists[mbid] = name

    print(f"Summary:")
    print(f"  Total artists: {len(artists)}")
    print(f"  Unique lowercase names: {len(lowercase_names)}")
    print(f"  Artists with MBID: {len(mbid_to_artists)}")
    print(f"  Lost due to lowercase collision: {len(artists) - len(lowercase_names)}")

    # Simulate the _process_artist_list method
    result = {}
    for artist in artists:
        name = artist.get('name', '')
        if not name:
            continue

        mbid = artist.get('mbid', '').strip()
        playcount = int(artist.get('playcount', 0))

        artist_data = {
            'name': name,
            'mbid': mbid if mbid else None,
            'playcount': playcount
        }

        # Always store by lowercase name for fallback lookup
        result[name.lower()] = artist_data

        # Also store by MBID if available (for faster MBID-based lookup)
        if mbid:
            result[mbid] = artist_data

    # Count unique names (excluding MBID keys)
    unique_artist_count = sum(1 for key in result.keys() if '-' not in key)

    print(f"\nAfter _process_artist_list simulation:")
    print(f"  Total keys in dict: {len(result)}")
    print(f"  Keys without hyphens (artist names): {unique_artist_count}")
    print(f"  Keys with hyphens (MBIDs): {len(result) - unique_artist_count}")

    if unique_artist_count != len(artists):
        print(f"\n❌ DISCREPANCY: {len(artists) - unique_artist_count} artists lost!")
    else:
        print(f"\n✅ All artists preserved")

    return 0


if __name__ == '__main__':
    sys.exit(main())
