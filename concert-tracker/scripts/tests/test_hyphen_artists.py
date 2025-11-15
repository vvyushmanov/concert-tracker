#!/usr/bin/env python3
"""
Find artists with hyphens in their names
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
    print("ARTISTS WITH HYPHENS IN THEIR NAMES")
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

    # Find artists with hyphens in lowercase names
    artists_with_hyphens = []
    for artist in artists:
        name = artist.get('name', '')
        if not name:
            continue

        name_lower = name.lower()
        if '-' in name_lower:
            playcount = artist.get('playcount', 0)
            mbid = artist.get('mbid', '').strip()
            artists_with_hyphens.append((name, playcount, mbid))

    print(f"\nFound {len(artists_with_hyphens)} artists with hyphens in their (lowercase) names:\n")

    for name, playcount, mbid in sorted(artists_with_hyphens, key=lambda x: x[1], reverse=True):
        has_mbid = "✓" if mbid else "✗"
        print(f"  {name:40} {playcount:4} plays | MBID: {has_mbid}")

    print(f"\n{'=' * 80}")
    print(f"These artists are being filtered out by the check: if '-' not in key")
    print(f"We need a better way to distinguish MBIDs from artist names!")
    print(f"{'=' * 80}")

    # Show example MBID format
    print(f"\nMBID format example: 39a31de6-763d-48b6-a45c-f7cfad58ffd8 (UUID with 4 hyphens)")
    print(f"Artist names with hyphens: Usually 1-2 hyphens, not UUID format")

    return 0


if __name__ == '__main__':
    sys.exit(main())
