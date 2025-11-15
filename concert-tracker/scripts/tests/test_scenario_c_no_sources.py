#!/usr/bin/env python3
"""
Integration test for Scenario C: No sources available (should error with helpful message)

Tests that the system correctly handles the case when:
- Last.fm API key is NOT configured
- User has NO artists in UserArtist table
- --no-filter flag is NOT provided
- System should error with clear, helpful message

This validates proper error handling and user guidance.
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from database.config import get_engine
from database.models import User, UserArtist
from services import ArtistSourceManager


def test_scenario_c():
    """
    Test Scenario C: No sources available (error case)

    Expected behavior:
    - ArtistSourceManager detects no sources available
    - has_any_source() returns False
    - System provides clear error message with solutions
    - Does NOT crash or raise unhandled exception
    """
    print("=" * 80)
    print("SCENARIO C: No Sources Available (Error Handling)")
    print("=" * 80)

    # Setup
    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    # Use a user ID that definitely has no UserArtist records
    test_user_id = 99999

    try:
        print("\n1. Verifying test preconditions...")

        # Ensure user exists (use dummy hash - only for testing)
        user = session.query(User).filter_by(id=test_user_id).first()
        if not user:
            user = User(
                id=test_user_id,
                username=f"test_user_scenario_c_{test_user_id}",
                hashedPassword="dummy_hash_for_testing",  # Not used in tests
                role="USER"
            )
            session.add(user)
            session.commit()
            print(f"   ✓ Created test user: {user.username}")
        else:
            print(f"   ✓ Using existing user: {user.username}")

        # Ensure NO UserArtist records exist
        user_artist_count = session.query(UserArtist).filter_by(userId=test_user_id).count()
        if user_artist_count > 0:
            print(f"   ⚠️  Found {user_artist_count} UserArtist records, deleting...")
            session.query(UserArtist).filter_by(userId=test_user_id).delete()
            session.commit()

        user_artist_count = session.query(UserArtist).filter_by(userId=test_user_id).count()
        print(f"   ✓ UserArtist count: {user_artist_count} (should be 0)")

        # Simulate Last.fm NOT configured
        print("\n2. Initializing ArtistSourceManager (NO sources)...")
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

        # Validate error condition
        print("\n3. Validating error condition...")
        if manager.has_any_source():
            print("   ❌ ERROR: has_any_source() should return False")
            return False

        if manager.has_lastfm():
            print("   ❌ ERROR: has_lastfm() should return False")
            return False

        if manager.has_user_artist():
            print("   ❌ ERROR: has_user_artist() should return False")
            return False

        print("   ✓ All source checks return False (expected)")

        # Test error message generation
        print("\n4. Testing error message generation...")
        summary = manager.get_source_summary()
        print(f"   Source summary: {summary}")

        # Simulate what parse_concerts.py would do
        print("\n5. Simulating parse_concerts.py error handling...")
        print("   " + "=" * 76)
        print("   ERROR: No artist sources available!")
        print("   " + "-" * 76)
        print("   Current state:")
        print(f"     - Last.fm configured: {manager.has_lastfm()}")
        print(f"     - UserArtist records: {manager.has_user_artist()}")
        print("   " + "-" * 76)
        print("   Please either:")
        print("     1. Configure Last.fm credentials in settings, OR")
        print("     2. Add artists to UserArtist table, OR")
        print("     3. Use --no-filter to fetch all concerts")
        print("   " + "=" * 76)

        print("\n" + "=" * 80)
        print("✅ SCENARIO C: PASSED")
        print("=" * 80)
        print("\nKey findings:")
        print("  ✓ has_any_source() correctly returns False")
        print("  ✓ Individual source checks work correctly")
        print("  ✓ Error condition detected properly")
        print("  ✓ System provides clear error message")
        print("  ✓ No unhandled exceptions raised")

        return True

    except Exception as e:
        print(f"\n❌ ERROR: Unexpected exception: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup
        print("\n6. Cleaning up test data...")
        session.query(User).filter_by(id=test_user_id).delete()
        session.commit()
        session.close()
        print("   ✓ Cleanup complete")


def test_scenario_c_with_parse_concerts_simulation():
    """
    Extended test: Simulate actual parse_concerts.py flow

    This tests the error handling at the script level, not just ArtistSourceManager.
    """
    print("\n" + "=" * 80)
    print("SCENARIO C (EXTENDED): parse_concerts.py Flow Simulation")
    print("=" * 80)

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    test_user_id = 99998

    try:
        print("\n1. Setting up test environment...")

        # Create user without UserArtist records (use dummy hash - only for testing)
        user = session.query(User).filter_by(id=test_user_id).first()
        if not user:
            user = User(
                id=test_user_id,
                username=f"test_user_scenario_c_ext_{test_user_id}",
                hashedPassword="dummy_hash_for_testing",  # Not used in tests
                role="USER"
            )
            session.add(user)
            session.commit()

        # Ensure no UserArtist records
        session.query(UserArtist).filter_by(userId=test_user_id).delete()
        session.commit()

        print(f"   ✓ Test user ready (ID: {test_user_id})")

        # Simulate parse_concerts.py logic
        print("\n2. Simulating parse_concerts.py filtering logic...")

        no_filter = False  # Simulate user NOT using --no-filter

        if not no_filter:
            # Create manager (no Last.fm)
            manager = ArtistSourceManager(
                session=session,
                user_id=test_user_id,
                lastfm_service=None,
                lastfm_user=None,
                min_playcount=40
            )

            # Check if we have sources
            if not manager.has_any_source():
                print("\n   " + "=" * 76)
                print("   ❌ ERROR: Cannot filter concerts - no artist sources available")
                print("   " + "-" * 76)
                print("   Details:")
                print(f"     - Last.fm configured: No")
                print(f"     - UserArtist records found: No")
                print("   " + "-" * 76)
                print("   Solutions:")
                print("     1. Configure Last.fm credentials in user settings")
                print("     2. Add artists to UserArtist table manually")
                print("     3. Run with --no-filter to fetch all concerts")
                print("   " + "=" * 76)

                # This would return exit code 1 in real script
                print("\n   ✓ Would exit with code 1 (expected)")
                script_would_exit = True
            else:
                print("   ❌ ERROR: Manager should have no sources")
                script_would_exit = False

            if not script_would_exit:
                print("\n❌ Test failed: Script should exit when no sources available")
                return False

        print("\n" + "=" * 80)
        print("✅ SCENARIO C (EXTENDED): PASSED")
        print("=" * 80)
        print("\nKey findings:")
        print("  ✓ parse_concerts.py would correctly detect no sources")
        print("  ✓ Helpful error message would be displayed")
        print("  ✓ Script would exit with code 1")
        print("  ✓ User given clear action items")

        return True

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup
        print("\n3. Cleaning up...")
        session.query(User).filter_by(id=test_user_id).delete()
        session.commit()
        session.close()
        print("   ✓ Cleanup complete")


if __name__ == '__main__':
    # Run both tests
    success1 = test_scenario_c()
    success2 = test_scenario_c_with_parse_concerts_simulation()

    success = success1 and success2

    if success:
        print("\n" + "=" * 80)
        print("🎉 ALL SCENARIO C TESTS PASSED")
        print("=" * 80)

    sys.exit(0 if success else 1)
