#!/usr/bin/env python3
"""
Test raw Last.fm API response to understand discrepancy
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
    print("RAW LAST.FM API TEST")
    print("=" * 80)
    print(f"User: {user}")
    print()

    # Test 12-month period
    params = {
        'method': 'user.gettopartists',
        'user': user,
        'api_key': api_key,
        'format': 'json',
        'limit': 1000,
        'period': '12month'
    }

    headers = {
        'User-Agent': 'ConcertTracker/1.0'
    }

    print("Fetching 12-month top artists from Last.fm API...")
    response = requests.get('http://ws.audioscrobbler.com/2.0/', params=params, timeout=30, headers=headers)
    response.raise_for_status()
    data = response.json()

    # Check pagination info
    topartists = data.get('topartists', {})
    attr = topartists.get('@attr', {})

    total = attr.get('total')
    perPage = attr.get('perPage')
    page = attr.get('page')
    totalPages = attr.get('totalPages')

    artists = topartists.get('artist', [])

    print(f"\nAPI Response Metadata:")
    print(f"  Total artists available: {total}")
    print(f"  Per page: {perPage}")
    print(f"  Current page: {page}")
    print(f"  Total pages: {totalPages}")
    print(f"  Artists in this response: {len(artists)}")

    # Count unique artists (by name)
    unique_names = set()
    unique_mbids = set()
    artists_with_mbid = 0

    for artist in artists:
        name = artist.get('name', '')
        mbid = artist.get('mbid', '').strip()

        if name:
            unique_names.add(name.lower())
        if mbid:
            unique_mbids.add(mbid)
            artists_with_mbid += 1

    print(f"\nUnique counts:")
    print(f"  Unique artist names: {len(unique_names)}")
    print(f"  Artists with MBID: {artists_with_mbid}")
    print(f"  Unique MBIDs: {len(unique_mbids)}")

    # If there are more pages, we need pagination
    if totalPages and int(totalPages) > 1:
        print(f"\n⚠️  WARNING: API has {totalPages} pages, but we only fetch page 1")
        print(f"   This means we're missing {int(total) - len(artists)} artists!")
        print(f"   Need to implement pagination to get all {total} artists")
    else:
        print(f"\n✅ All artists retrieved in single page")

    # Show sample artists
    print(f"\nSample artists (first 5):")
    for i, artist in enumerate(artists[:5]):
        name = artist.get('name', 'Unknown')
        playcount = artist.get('playcount', 0)
        mbid = artist.get('mbid', 'none')
        print(f"  {i+1}. {name} - {playcount} plays (MBID: {mbid[:8] if mbid else 'none'}...)")

    return 0


if __name__ == '__main__':
    sys.exit(main())
