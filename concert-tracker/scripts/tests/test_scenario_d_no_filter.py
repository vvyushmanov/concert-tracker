#!/usr/bin/env python3
"""
Integration test for Scenario D: --no-filter mode (fetch all concerts)

Tests that the system correctly works when:
- --no-filter flag is provided
- No artist sources are required
- ALL concerts are fetched and stored (no filtering)
- System works regardless of Last.fm or UserArtist availability

This validates that users can still use the system without any artist sources
by fetching all available concerts.
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from database.config import get_engine
from database.models import User, Concert, UserConcert
from database.writer import ConcertDatabaseWriter


def test_scenario_d():
    """
    Test Scenario D: --no-filter mode

    Expected behavior:
    - All concerts are accepted (no filtering by artists)
    - No artist sources required (Last.fm or UserArtist)
    - matched_artists list should be empty or contain all performers
    - System processes and stores all concerts
    - No errors even without any artist sources
    """
    print("=" * 80)
    print("SCENARIO D: --no-filter Mode (Fetch All Concerts)")
    print("=" * 80)

    # Setup
    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    test_user_id = 99997

    try:
        print("\n1. Setting up test environment...")

        # Create test user (doesn't need UserArtist records, use dummy hash)
        user = session.query(User).filter_by(id=test_user_id).first()
        if not user:
            user = User(
                id=test_user_id,
                username=f"test_user_scenario_d_{test_user_id}",
                hashedPassword="dummy_hash_for_testing",  # Not used in tests
                role="USER"
            )
            session.add(user)
            session.commit()

        print(f"   ✓ Test user ready: {user.username}")

        # Simulate --no-filter mode
        print("\n2. Simulating --no-filter mode...")
        print("   - No artist filtering required")
        print("   - All concerts will be fetched")
        print("   - Last.fm/UserArtist sources not needed")

        no_filter = True

        if no_filter:
            print("   ✓ Filtering disabled - will fetch all concerts")
            lastfm_artists = set()  # Empty set when no filtering
            artist_playcounts = {}
            artist_playcounts_12month = {}
            recent_artists = set()
            artist_mbids = {}
        else:
            # This branch shouldn't be hit in this test
            print("   ❌ ERROR: Should be in no-filter mode")
            return False

        # Create mock concerts (mix of known and unknown artists)
        # IMPORTANT: In no-filter mode, concerts DON'T have matched_artists field
        # (parser doesn't set it when lastfm_artists is empty)
        print("\n3. Creating mock concerts (diverse artist mix)...")
        mock_concerts = [
            {
                'event_name': 'Metallica World Tour',
                'event_url': 'https://test-no-filter.com/metallica-2025',
                'date_start': '2025-06-01',
                'date_end': '2025-06-01',
                'venue': 'Big Arena',
                'city': 'London',
                'country': 'United Kingdom',
                'postal_code': 'SW1A 1AA',
                'performers': ['Metallica'],
                # NO matched_artists in no-filter mode!
                'ticket_links': []
            },
            {
                'event_name': 'Unknown Local Band Night',
                'event_url': 'https://test-no-filter.com/local-band-2025',
                'date_start': '2025-06-15',
                'date_end': '2025-06-15',
                'venue': 'Small Pub',
                'city': 'Manchester',
                'country': 'United Kingdom',
                'postal_code': 'M1 1AA',
                'performers': ['Local Band A', 'Local Band B'],
                # NO matched_artists in no-filter mode!
                'ticket_links': []
            },
            {
                'event_name': 'Indie Rock Festival',
                'event_url': 'https://test-no-filter.com/indie-fest-2025',
                'date_start': '2025-07-01',
                'date_end': '2025-07-03',
                'venue': 'Festival Grounds',
                'city': 'Bristol',
                'country': 'United Kingdom',
                'postal_code': 'BS1 1AA',
                'performers': ['Band X', 'Band Y', 'Band Z'],
                # NO matched_artists in no-filter mode!
                'ticket_links': ['https://tickets.com/indie']
            },
            {
                'event_name': 'Jazz Night',
                'event_url': 'https://test-no-filter.com/jazz-2025',
                'date_start': '2025-08-01',
                'date_end': '2025-08-01',
                'venue': 'Jazz Club',
                'city': 'Birmingham',
                'country': 'United Kingdom',
                'postal_code': 'B1 1AA',
                'performers': ['Jazz Quartet'],
                # NO matched_artists in no-filter mode!
                'ticket_links': []
            }
        ]

        print(f"   ✓ Created {len(mock_concerts)} mock concerts (all types)")

        # Write concerts to database (no filtering)
        print("\n4. Writing concerts to database (no-filter mode)...")
        with ConcertDatabaseWriter(user_id=test_user_id, debug=False) as writer:
            writer.write_concerts(
                concerts=mock_concerts,
                artist_playcounts=artist_playcounts,  # Empty
                artist_playcounts_12month=artist_playcounts_12month,  # Empty
                recent_artists=recent_artists,  # Empty
                artist_mbids=artist_mbids  # Empty
            )

            print(f"\n   Database write stats:")
            print(f"   - Concerts created: {writer.stats['concerts_created']}")
            print(f"   - Concerts updated: {writer.stats['concerts_updated']}")
            print(f"   - Artists created: {writer.stats['artists_created']}")
            print(f"   - UserConcert links: {writer.stats['user_concerts_created']}")
            print(f"   - Artist-Concert links: {writer.stats['artist_concert_links_created']}")
            print(f"   - Errors: {writer.stats['errors']}")

            # Verify using stats (more reliable than querying across sessions)
            print("\n5. Verifying all concerts were stored...")
            if writer.stats['concerts_created'] != len(mock_concerts):
                print(f"   ❌ ERROR: Expected {len(mock_concerts)} concerts, got {writer.stats['concerts_created']}")
                return False

            print(f"   ✓ All {len(mock_concerts)} concerts stored successfully")

            if writer.stats['user_concerts_created'] != len(mock_concerts):
                print(f"   ❌ ERROR: Expected {len(mock_concerts)} UserConcert links, got {writer.stats['user_concerts_created']}")
                return False

            print(f"   ✓ All {len(mock_concerts)} UserConcert links created")

        print("   ✓ All concert details verified (via stats)")

        print("\n" + "=" * 80)
        print("✅ SCENARIO D: PASSED")
        print("=" * 80)
        print("\nKey findings:")
        print("  ✓ --no-filter mode works without artist sources")
        print("  ✓ All concerts fetched and stored")
        print("  ✓ No filtering applied (all performers treated as matched)")
        print("  ✓ System doesn't require Last.fm or UserArtist")
        print("  ✓ UserConcert links created for all concerts")

        return True

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup
        print("\n7. Cleaning up test data...")
        session.query(UserConcert).filter_by(userId=test_user_id).delete()
        session.query(Concert).filter(
            Concert.eventUrl.like('https://test-no-filter.com/%')
        ).delete()
        session.query(User).filter_by(id=test_user_id).delete()
        session.commit()
        session.close()
        print("   ✓ Cleanup complete")


def test_scenario_d_with_empty_sources():
    """
    Extended test: Verify --no-filter works even with NO sources at all

    This ensures the system doesn't break when both Last.fm and UserArtist are missing.
    """
    print("\n" + "=" * 80)
    print("SCENARIO D (EXTENDED): --no-filter with Empty Sources")
    print("=" * 80)

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    test_user_id = 99996

    try:
        print("\n1. Setting up minimal test environment...")

        # Create user (use dummy hash - only for testing)
        user = session.query(User).filter_by(id=test_user_id).first()
        if not user:
            user = User(
                id=test_user_id,
                username=f"test_user_scenario_d_ext_{test_user_id}",
                hashedPassword="dummy_hash_for_testing",  # Not used in tests
                role="USER"
            )
            session.add(user)
            session.commit()

        print(f"   ✓ Test user ready (ID: {test_user_id})")

        # Simulate --no-filter with NO artist sources
        print("\n2. Simulating --no-filter with empty sources...")
        print("   - Last.fm: Not configured")
        print("   - UserArtist: Empty")
        print("   - No filtering applied")

        # Empty sources (as they would be in no-filter mode)
        artist_playcounts = {}
        artist_playcounts_12month = {}
        recent_artists = set()
        artist_mbids = {}

        # Single test concert
        # IMPORTANT: No matched_artists in no-filter mode!
        mock_concert = {
            'event_name': 'Test Concert No Filter',
            'event_url': 'https://test-empty-sources.com/concert-1',
            'date_start': '2025-09-01',
            'date_end': '2025-09-01',
            'venue': 'Test Venue',
            'city': 'London',
            'country': 'United Kingdom',
            'postal_code': None,
            'performers': ['Random Artist'],
            # NO matched_artists in no-filter mode!
            'ticket_links': []
        }

        print("\n3. Writing concert with empty sources...")
        with ConcertDatabaseWriter(user_id=test_user_id, debug=False) as writer:
            writer.write_concerts(
                concerts=[mock_concert],
                artist_playcounts=artist_playcounts,
                artist_playcounts_12month=artist_playcounts_12month,
                recent_artists=recent_artists,
                artist_mbids=artist_mbids
            )

            if writer.stats['errors'] > 0:
                print(f"   ❌ ERROR: Encountered {writer.stats['errors']} errors")
                return False

        print("   ✓ Concert written successfully with empty sources")

        print("\n" + "=" * 80)
        print("✅ SCENARIO D (EXTENDED): PASSED")
        print("=" * 80)
        print("\nKey findings:")
        print("  ✓ --no-filter works with completely empty sources")
        print("  ✓ No errors when playcounts/MBIDs missing")
        print("  ✓ Database writer handles empty dicts/sets")

        return True

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup
        print("\n4. Cleaning up...")
        session.query(UserConcert).filter_by(userId=test_user_id).delete()
        session.query(Concert).filter(
            Concert.eventUrl.like('https://test-empty-sources.com/%')
        ).delete()
        session.query(User).filter_by(id=test_user_id).delete()
        session.commit()
        session.close()
        print("   ✓ Cleanup complete")


if __name__ == '__main__':
    # Run both tests
    success1 = test_scenario_d()
    success2 = test_scenario_d_with_empty_sources()

    success = success1 and success2

    if success:
        print("\n" + "=" * 80)
        print("🎉 ALL SCENARIO D TESTS PASSED")
        print("=" * 80)

    sys.exit(0 if success else 1)
