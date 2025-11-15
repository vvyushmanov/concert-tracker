#!/usr/bin/env python3
"""
Test 12-month playcount retrieval for specific artists

This test checks if ArtistSourceManager correctly fetches and returns
12-month playcounts for artists like Sabaton.
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from database.config import get_engine
from services import ArtistSourceManager, LastFMService
from config import ConfigManager


def test_12month_playcount():
    """Test that 12-month playcounts are correctly fetched"""
    print("=" * 80)
    print("12-MONTH PLAYCOUNT TEST")
    print("=" * 80)

    config = ConfigManager()
    lastfm_api_key = config.get('LASTFM_API_KEY')
    lastfm_user = config.get('LASTFM_USER')

    if not lastfm_api_key or not lastfm_user:
        print("ERROR: Last.fm not configured")
        return 1

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    # Test with Last.fm only (min playcount 1 to get all artists)
    manager = ArtistSourceManager(
        session=session,
        user_id=1,
        lastfm_service=LastFMService(lastfm_api_key),
        lastfm_user=lastfm_user,
        min_playcount=1  # Get all artists
    )

    print(f"\nFetching artists from Last.fm...")
    all_artists, recent_artists, playcounts, playcounts_12month, artist_mbids = \
        manager.fetch_filtering_artists()

    print(f"\n✓ Total artists: {len(all_artists)}")
    print(f"✓ Artists with overall playcounts: {len(playcounts)}")
    print(f"✓ Artists with 12-month playcounts: {len(playcounts_12month)}")
    print(f"✓ Recent artists (with 12-month activity): {len(recent_artists)}")

    # Check for Sabaton specifically
    sabaton_variants = ['Sabaton', 'sabaton', 'SABATON']
    sabaton_found = None

    for variant in sabaton_variants:
        if variant in all_artists:
            sabaton_found = variant
            break

    if sabaton_found:
        print(f"\n{'=' * 80}")
        print(f"SABATON DATA:")
        print(f"{'=' * 80}")
        print(f"Artist name in set: '{sabaton_found}'")
        print(f"Overall playcount: {playcounts.get(sabaton_found, 'NOT FOUND')}")
        print(f"12-month playcount: {playcounts_12month.get(sabaton_found, 'NOT FOUND')}")
        print(f"Is recent: {sabaton_found in recent_artists}")
        print(f"MBID: {artist_mbids.get(sabaton_found, 'NOT FOUND')}")

        # Validate
        if sabaton_found in playcounts_12month:
            playcount_12m = playcounts_12month[sabaton_found]
            print(f"\n✅ SUCCESS: Sabaton has 12-month playcount = {playcount_12m}")

            if sabaton_found in recent_artists:
                print(f"✅ SUCCESS: Sabaton is marked as recent")
            else:
                print(f"❌ FAIL: Sabaton should be marked as recent but isn't")
                return 1
        else:
            print(f"\n❌ FAIL: Sabaton NOT in playcounts_12month dictionary")
            print(f"Keys in playcounts_12month: {list(playcounts_12month.keys())[:10]}...")
            return 1
    else:
        print(f"\n❌ FAIL: Sabaton not found in artist set")
        print(f"Sample artists: {list(all_artists)[:20]}")
        return 1

    # Show sample of recent artists with 12-month data
    print(f"\n{'=' * 80}")
    print(f"SAMPLE RECENT ARTISTS (first 10):")
    print(f"{'=' * 80}")

    count = 0
    for artist in sorted(recent_artists):
        if count >= 10:
            break
        playcount_overall = playcounts.get(artist, 0)
        playcount_12m = playcounts_12month.get(artist, 0)
        print(f"{artist:30} Overall: {playcount_overall:5} | 12-month: {playcount_12m:5}")
        count += 1

    session.close()
    print(f"\n{'=' * 80}")
    print("✅ TEST PASSED")
    print(f"{'=' * 80}\n")
    return 0


if __name__ == '__main__':
    sys.exit(test_12month_playcount())
