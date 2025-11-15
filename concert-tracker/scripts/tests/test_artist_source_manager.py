#!/usr/bin/env python3
"""
Test script for ArtistSourceManager

Tests various configurations:
- UserArtist only (no Last.fm)
- Last.fm only (no UserArtist)
- Both sources (union)
- No sources (error case)
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from database.config import get_engine
from services import ArtistSourceManager, LastFMService
from config import ConfigManager


def test_user_artist_only(user_id: int):
    """Test with UserArtist source only (no Last.fm)"""
    print("=" * 60)
    print("TEST 1: UserArtist Only (No Last.fm)")
    print("=" * 60)

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    manager = ArtistSourceManager(
        session=session,
        user_id=user_id,
        lastfm_service=None,
        lastfm_user=None,
        min_playcount=40
    )

    print(f"Has Last.fm: {manager.has_lastfm()}")
    print(f"Has UserArtist: {manager.has_user_artist()}")
    print(f"Has any source: {manager.has_any_source()}")
    print(f"Source summary: {manager.get_source_summary()}")
    print()

    if manager.has_any_source():
        artists, recent, playcounts, playcounts_12m, mbids = manager.fetch_filtering_artists()
        print(f"Total artists: {len(artists)}")
        print(f"Artists with playcounts: {len(playcounts)}")
        print(f"Artists with 12-month playcounts: {len(playcounts_12m)}")
        print(f"Recent artists: {len(recent)}")
        print(f"Artists with MBIDs: {len(mbids)}")
        print(f"Sample artists: {list(artists)[:5]}")
    else:
        print("ERROR: No artist sources available!")

    session.close()
    print()


def test_lastfm_only(user_id: int):
    """Test with Last.fm source only (no UserArtist records)"""
    print("=" * 60)
    print("TEST 2: Last.fm Only (No UserArtist)")
    print("=" * 60)

    config = ConfigManager()
    lastfm_api_key = config.get('LASTFM_API_KEY')
    lastfm_user = config.get('LASTFM_USER')

    if not lastfm_api_key or not lastfm_user:
        print("SKIPPED: Last.fm not configured")
        print()
        return

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    # Use a user ID with no UserArtist records (e.g., 999)
    test_user_id = 999

    manager = ArtistSourceManager(
        session=session,
        user_id=test_user_id,
        lastfm_service=LastFMService(lastfm_api_key),
        lastfm_user=lastfm_user,
        min_playcount=40
    )

    print(f"Has Last.fm: {manager.has_lastfm()}")
    print(f"Has UserArtist: {manager.has_user_artist()}")
    print(f"Has any source: {manager.has_any_source()}")
    print(f"Source summary: {manager.get_source_summary()}")
    print()

    if manager.has_any_source():
        artists, recent, playcounts, playcounts_12m, mbids = manager.fetch_filtering_artists()
        print(f"Total artists: {len(artists)}")
        print(f"Artists with playcounts: {len(playcounts)}")
        print(f"Artists with 12-month playcounts: {len(playcounts_12m)}")
        print(f"Recent artists: {len(recent)}")
        print(f"Artists with MBIDs: {len(mbids)}")
        print(f"Sample artists: {list(artists)[:5]}")
    else:
        print("ERROR: No artist sources available!")

    session.close()
    print()


def test_both_sources(user_id: int):
    """Test with both UserArtist and Last.fm (union)"""
    print("=" * 60)
    print("TEST 3: Both Sources (UserArtist + Last.fm)")
    print("=" * 60)

    config = ConfigManager()
    lastfm_api_key = config.get('LASTFM_API_KEY')
    lastfm_user = config.get('LASTFM_USER')

    if not lastfm_api_key or not lastfm_user:
        print("SKIPPED: Last.fm not configured")
        print()
        return

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    manager = ArtistSourceManager(
        session=session,
        user_id=user_id,
        lastfm_service=LastFMService(lastfm_api_key),
        lastfm_user=lastfm_user,
        min_playcount=40
    )

    print(f"Has Last.fm: {manager.has_lastfm()}")
    print(f"Has UserArtist: {manager.has_user_artist()}")
    print(f"Has any source: {manager.has_any_source()}")
    print(f"Source summary: {manager.get_source_summary()}")
    print()

    if manager.has_any_source():
        artists, recent, playcounts, playcounts_12m, mbids = manager.fetch_filtering_artists()
        print(f"Total artists: {len(artists)}")
        print(f"Artists with playcounts: {len(playcounts)}")
        print(f"Artists with 12-month playcounts: {len(playcounts_12m)}")
        print(f"Recent artists: {len(recent)}")
        print(f"Artists with MBIDs: {len(mbids)}")
        print(f"Sample artists: {list(artists)[:5]}")
    else:
        print("ERROR: No artist sources available!")

    session.close()
    print()


def test_no_sources():
    """Test with no sources (error case)"""
    print("=" * 60)
    print("TEST 4: No Sources (Error Case)")
    print("=" * 60)

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    # Use a user ID with no UserArtist records and no Last.fm
    test_user_id = 999

    manager = ArtistSourceManager(
        session=session,
        user_id=test_user_id,
        lastfm_service=None,
        lastfm_user=None,
        min_playcount=40
    )

    print(f"Has Last.fm: {manager.has_lastfm()}")
    print(f"Has UserArtist: {manager.has_user_artist()}")
    print(f"Has any source: {manager.has_any_source()}")
    print(f"Source summary: {manager.get_source_summary()}")
    print()

    if not manager.has_any_source():
        print("✓ Correctly detected no sources available")
        print("This should trigger an error in parse_concerts.py")
    else:
        print("ERROR: Should have no sources but has_any_source() returned True")

    session.close()
    print()


def main():
    """Run all tests"""
    import argparse

    parser = argparse.ArgumentParser(description='Test ArtistSourceManager')
    parser.add_argument('--user-id', type=int, default=1, help='User ID for testing')
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("ARTIST SOURCE MANAGER TESTS")
    print("=" * 60 + "\n")

    test_user_artist_only(args.user_id)
    test_lastfm_only(args.user_id)
    test_both_sources(args.user_id)
    test_no_sources()

    print("=" * 60)
    print("ALL TESTS COMPLETED")
    print("=" * 60)


if __name__ == '__main__':
    main()
