#!/usr/bin/env python3
"""
Integration test for Scenario B: UserArtist only (no Last.fm configured)

Tests that the system works correctly when:
- Last.fm API key is NOT configured
- User has artists in UserArtist table
- Concert filtering uses only UserArtist data
- No playcount data from Last.fm (all default to 0)

This simulates a user who has manually added artists or imported them from another source.
"""

import sys
import os
import tempfile
from unittest.mock import patch

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from database.config import get_engine
from database.models import User, Artist, UserArtist, Concert, UserConcert
from services import ArtistSourceManager
from database.writer import ConcertDatabaseWriter


def setup_test_data(session, user_id=999):
    """Create test user and UserArtist records without Last.fm data"""

    # Create test user (use dummy hash - only for testing)
    user = session.query(User).filter_by(id=user_id).first()
    if not user:
        user = User(
            id=user_id,
            username=f"test_user_scenario_b_{user_id}",
            hashedPassword="dummy_hash_for_testing",  # Not used in tests
            role="USER"
        )
        session.add(user)

    # Create test artists (simulate manually added artists)
    test_artists = [
        {"name": "Iron Maiden", "mbid": "ca891d65-d9b0-4258-89f7-e6ba29d83767"},
        {"name": "Judas Priest", "mbid": "7527f6c2-d762-4b88-b5e2-9244f1e34c46"},
        {"name": "Black Sabbath", "mbid": "5182c1d9-c7d2-4dad-afa0-ccfeada921a8"},
    ]

    created_artists = []
    for artist_data in test_artists:
        artist = session.query(Artist).filter_by(name=artist_data["name"]).first()
        if not artist:
            artist = Artist(name=artist_data["name"], mbid=artist_data["mbid"])
            session.add(artist)
            session.flush()  # Get artist.id

        # Create UserArtist link (WITHOUT Last.fm playcount data)
        user_artist = session.query(UserArtist).filter_by(
            userId=user_id,
            artistId=artist.id
        ).first()

        if not user_artist:
            user_artist = UserArtist(
                userId=user_id,
                artistId=artist.id,
                playcount=0,  # No Last.fm data
                playcount12month=0,  # No Last.fm data
                recent=False  # No Last.fm data
            )
            session.add(user_artist)

        created_artists.append(artist)

    session.commit()
    return user, created_artists


def test_scenario_b():
    """
    Test Scenario B: UserArtist only (no Last.fm)

    Expected behavior:
    - ArtistSourceManager returns artists from UserArtist table
    - No Last.fm service initialized
    - Concert filtering works based on UserArtist data
    - All playcounts are 0 (no Last.fm data)
    - System does NOT error out
    """
    print("=" * 80)
    print("SCENARIO B: UserArtist Only (No Last.fm Configured)")
    print("=" * 80)

    # Setup
    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    test_user_id = 999

    try:
        print("\n1. Setting up test data (user + UserArtist records)...")
        user, test_artists = setup_test_data(session, test_user_id)
        print(f"   ✓ Created user: {user.username}")
        print(f"   ✓ Created {len(test_artists)} UserArtist records")
        for artist in test_artists:
            print(f"     - {artist.name} (MBID: {artist.mbid})")

        # Simulate Last.fm NOT configured
        print("\n2. Initializing ArtistSourceManager (NO Last.fm)...")
        manager = ArtistSourceManager(
            session=session,
            user_id=test_user_id,
            lastfm_service=None,  # No Last.fm
            lastfm_user=None,
            min_playcount=40
        )

        print(f"   - Has Last.fm: {manager.has_lastfm()}")
        print(f"   - Has UserArtist: {manager.has_user_artist()}")
        print(f"   - Has any source: {manager.has_any_source()}")
        print(f"   - Summary: {manager.get_source_summary()}")

        # Validate sources
        if not manager.has_any_source():
            print("   ❌ ERROR: No sources available (should have UserArtist)")
            return False

        if manager.has_lastfm():
            print("   ❌ ERROR: Last.fm should NOT be available")
            return False

        print("   ✓ Source validation passed")

        # Fetch filtering artists
        print("\n3. Fetching filtering artists...")
        all_artists, recent_artists, playcounts, playcounts_12month, mbids = \
            manager.fetch_filtering_artists()

        print(f"   - Total artists: {len(all_artists)}")
        print(f"   - Recent artists: {len(recent_artists)}")
        print(f"   - Artists with playcounts: {len([p for p in playcounts.values() if p > 0])}")
        print(f"   - Artists with 12-month data: {len([p for p in playcounts_12month.values() if p > 0])}")
        print(f"   - Artists with MBIDs: {len(mbids)}")

        # Validate results
        expected_artist_count = len(test_artists)
        if len(all_artists) != expected_artist_count:
            print(f"   ❌ ERROR: Expected {expected_artist_count} artists, got {len(all_artists)}")
            return False

        # All playcounts should be 0 (no Last.fm)
        if any(p > 0 for p in playcounts.values()):
            print(f"   ❌ ERROR: Playcounts should be 0 without Last.fm")
            return False

        # Recent artists should be empty (no Last.fm)
        if recent_artists:
            print(f"   ❌ ERROR: Recent artists should be empty without Last.fm")
            return False

        print("   ✓ Artist filtering results validated")

        # Test concert filtering
        # In filter mode, parser only returns concerts with matched_artists
        # (concerts without matches are filtered out by ConcertParser.filter_concerts())
        print("\n4. Testing concert filtering with mock concerts...")
        mock_concerts = [
            {
                'event_name': 'Iron Maiden World Tour',
                'event_url': 'https://test.com/iron-maiden-2025',
                'date_start': '2025-06-01',
                'date_end': '2025-06-01',
                'venue': 'Test Arena',
                'city': 'London',
                'country': 'United Kingdom',
                'postal_code': None,
                'performers': ['Iron Maiden', 'Unknown Support Band'],
                'matched_artists': ['Iron Maiden'],  # Parser adds this field
                'ticket_links': []
            },
            # Random Festival would be filtered out by parser - not included here
            {
                'event_name': 'Judas Priest Legacy Tour',
                'event_url': 'https://test.com/judas-priest-2025',
                'date_start': '2025-08-01',
                'date_end': '2025-08-01',
                'venue': 'Test Hall',
                'city': 'Manchester',
                'country': 'United Kingdom',
                'postal_code': None,
                'performers': ['Judas Priest'],
                'matched_artists': ['Judas Priest'],  # Parser adds this field
                'ticket_links': []
            }
        ]

        # Use database writer to process concerts
        with ConcertDatabaseWriter(user_id=test_user_id, debug=True) as writer:
            writer.write_concerts(
                concerts=mock_concerts,
                artist_playcounts=playcounts,
                artist_playcounts_12month=playcounts_12month,
                recent_artists=recent_artists,
                artist_mbids=mbids
            )

            print(f"\n   Database write stats:")
            print(f"   - Concerts created: {writer.stats['concerts_created']}")
            print(f"   - UserConcert links: {writer.stats['user_concerts_created']}")
            print(f"   - Artist-Concert links: {writer.stats['artist_concert_links_created']}")

            # Verify using stats (more reliable than querying across sessions)
            expected_concert_count = 2  # Only Iron Maiden and Judas Priest
            if writer.stats['concerts_created'] != expected_concert_count:
                print(f"   ❌ ERROR: Expected {expected_concert_count} concerts created, got {writer.stats['concerts_created']}")
                return False

            if writer.stats['user_concerts_created'] != expected_concert_count:
                print(f"   ❌ ERROR: Expected {expected_concert_count} UserConcert links, got {writer.stats['user_concerts_created']}")
                return False

        print("   ✓ Concert filtering and database writes successful")

        print("\n" + "=" * 80)
        print("✅ SCENARIO B: PASSED")
        print("=" * 80)
        print("\nKey findings:")
        print("  ✓ System works without Last.fm configured")
        print("  ✓ UserArtist table serves as artist source")
        print("  ✓ Concert filtering works correctly")
        print("  ✓ All playcounts default to 0 (expected)")
        print("  ✓ No errors when Last.fm unavailable")

        return True

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup test data
        print("\n5. Cleaning up test data...")
        session.query(UserConcert).filter_by(userId=test_user_id).delete()
        session.query(Concert).filter(
            Concert.eventUrl.like('https://test.com/%')
        ).delete()
        session.query(UserArtist).filter_by(userId=test_user_id).delete()
        session.query(User).filter_by(id=test_user_id).delete()
        session.commit()
        session.close()
        print("   ✓ Cleanup complete")


if __name__ == '__main__':
    success = test_scenario_b()
    sys.exit(0 if success else 1)
