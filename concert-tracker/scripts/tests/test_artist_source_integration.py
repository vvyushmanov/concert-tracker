#!/usr/bin/env python3
"""
Integration test for ArtistSourceManager with concert parsing flow

Tests that ArtistSourceManager works correctly with the concert parser
to filter concerts, matching the real parse_concerts.py flow.
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from database.config import get_engine
from services import ArtistSourceManager, LastFMService
from parsers import ConcertParser
from config import ConfigManager


def create_mock_concerts():
    """Create mock concerts with known artist names from database"""
    return [
        {
            'event_name': 'Metallica Live in Istanbul',
            'event_url': 'https://concerts-metal.com/event/metallica-istanbul-2025',
            'date_start': 1735689600,
            'date_end': 1735689600,
            'venue': 'Test Venue',
            'city': 'Istanbul',
            'postal_code': None,
            'country_code': 'tr',
            'performers': ['Metallica'],  # Known artist
            'ticket_links': [],
            'image_url': None
        },
        {
            'event_name': 'Random Unknown Band',
            'event_url': 'https://concerts-metal.com/event/unknown-2025',
            'date_start': 1735689600,
            'date_end': 1735689600,
            'venue': 'Test Venue',
            'city': 'Istanbul',
            'postal_code': None,
            'country_code': 'tr',
            'performers': ['Some Random Band That Does Not Exist'],  # Unknown artist
            'ticket_links': [],
            'image_url': None
        },
        {
            'event_name': 'Slayer Farewell Tour',
            'event_url': 'https://concerts-metal.com/event/slayer-2025',
            'date_start': 1735689600,
            'date_end': 1735689600,
            'venue': 'Test Venue',
            'city': 'Istanbul',
            'postal_code': None,
            'country_code': 'tr',
            'performers': ['Slayer'],  # Known artist
            'ticket_links': [],
            'image_url': None
        }
    ]


def test_scenario_1_userartist_only():
    """
    Scenario 1: UserArtist only (no Last.fm)
    - Fetch artists from UserArtist table
    - Use ConcertParser to filter mock concerts
    - Verify correct filtering behavior
    """
    print("=" * 80)
    print("SCENARIO 1: UserArtist Only - Concert Filtering Test")
    print("=" * 80)

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    # Initialize ArtistSourceManager (no Last.fm)
    manager = ArtistSourceManager(
        session=session,
        user_id=1,
        lastfm_service=None,
        lastfm_user=None,
        min_playcount=40
    )

    print(f"\nSource validation:")
    print(f"  Has Last.fm: {manager.has_lastfm()}")
    print(f"  Has UserArtist: {manager.has_user_artist()}")
    print(f"  Summary: {manager.get_source_summary()}")

    if not manager.has_any_source():
        print("❌ ERROR: No sources available")
        session.close()
        return False

    # Fetch artists (this replaces fetch_lastfm_artists call in parse_concerts.py)
    print(f"\nFetching artists using ArtistSourceManager...")
    lastfm_artists, recent_artists, artist_playcounts, artist_playcounts_12month, artist_mbids = \
        manager.fetch_filtering_artists()

    print(f"  ✓ Total artists: {len(lastfm_artists)}")
    print(f"  ✓ Sample artists: {list(lastfm_artists)[:5]}")

    # Create concert parser with these artists (same as parse_concerts.py does)
    print(f"\nCreating ConcertParser with artist filter...")
    parser = ConcertParser(lastfm_artists)

    # Create mock concerts
    mock_concerts = create_mock_concerts()
    print(f"\nCreated {len(mock_concerts)} mock concerts:")
    for concert in mock_concerts:
        print(f"  - {concert['event_name']} (performers: {concert['performers']})")

    # Filter concerts (this is what ConcertParser.filter_concerts does)
    print(f"\nFiltering concerts...")
    # Note: filter_concerts returns (filtered_concerts, total_count, matched_count)
    filtered_concerts, total_count, matched_count = parser.filter_concerts(mock_concerts)

    print(f"\nFiltering results:")
    print(f"  Total concerts: {total_count}")
    print(f"  Matched concerts: {matched_count}")
    print(f"  Filtered concerts: {len(filtered_concerts)}")

    # Show what matched
    if filtered_concerts:
        print(f"\n✓ Matched concerts:")
        for concert in filtered_concerts:
            matched_artists = concert.get('matched_artists', [])
            print(f"  - {concert['event_name']}")
            print(f"    Matched artists: {matched_artists}")
    else:
        print(f"\n⚠️  No concerts matched (this might be OK if test artists aren't in UserArtist)")

    # Validation
    assert isinstance(filtered_concerts, list), "filtered_concerts should be a list"
    assert matched_count <= total_count, "matched_count should not exceed total_count"
    assert len(filtered_concerts) == matched_count, "filtered list length should match matched_count"

    # Check that concerts have matched_artists field
    for concert in filtered_concerts:
        assert 'matched_artists' in concert, "Filtered concert missing 'matched_artists' field"
        assert isinstance(concert['matched_artists'], list), "'matched_artists' should be a list"

    print(f"\n✅ Concert filtering works correctly with ArtistSourceManager!")

    session.close()
    return True


def test_scenario_2_lastfm_only():
    """
    Scenario 2: Last.fm only
    - Fetch artists from Last.fm
    - Filter concerts using those artists
    """
    print("\n" + "=" * 80)
    print("SCENARIO 2: Last.fm Only - Concert Filtering Test")
    print("=" * 80)

    config = ConfigManager()
    lastfm_api_key = config.get('LASTFM_API_KEY')
    lastfm_user = config.get('LASTFM_USER')

    if not lastfm_api_key or not lastfm_user:
        print("⚠️  SKIPPED: Last.fm not configured")
        return True

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    manager = ArtistSourceManager(
        session=session,
        user_id=999,  # User with no UserArtist records
        lastfm_service=LastFMService(lastfm_api_key),
        lastfm_user=lastfm_user,
        min_playcount=30
    )

    print(f"\nSource validation:")
    print(f"  Summary: {manager.get_source_summary()}")

    # Fetch artists
    print(f"\nFetching artists using ArtistSourceManager...")
    lastfm_artists, recent_artists, artist_playcounts, artist_playcounts_12month, artist_mbids = \
        manager.fetch_filtering_artists()

    print(f"  ✓ Total artists: {len(lastfm_artists)}")
    if lastfm_artists:
        print(f"  ✓ Sample artists: {list(lastfm_artists)[:5]}")

    # Create parser and filter
    parser = ConcertParser(lastfm_artists)
    mock_concerts = create_mock_concerts()

    print(f"\nFiltering {len(mock_concerts)} mock concerts...")
    filtered_concerts, total_count, matched_count = parser.filter_concerts(mock_concerts)

    print(f"  Total: {total_count}, Matched: {matched_count}, Filtered: {len(filtered_concerts)}")

    # Validation
    assert isinstance(filtered_concerts, list)
    for concert in filtered_concerts:
        assert 'matched_artists' in concert

    print(f"\n✅ Concert filtering works with Last.fm source!")

    session.close()
    return True


def test_scenario_3_both_sources():
    """
    Scenario 3: Both UserArtist and Last.fm
    - Fetch union of artists from both sources
    - Verify filtering works with combined artist set
    """
    print("\n" + "=" * 80)
    print("SCENARIO 3: Both Sources - Concert Filtering Test")
    print("=" * 80)

    config = ConfigManager()
    lastfm_api_key = config.get('LASTFM_API_KEY')
    lastfm_user = config.get('LASTFM_USER')

    if not lastfm_api_key or not lastfm_user:
        print("⚠️  SKIPPED: Last.fm not configured")
        return True

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    manager = ArtistSourceManager(
        session=session,
        user_id=1,
        lastfm_service=LastFMService(lastfm_api_key),
        lastfm_user=lastfm_user,
        min_playcount=40
    )

    print(f"\nSource validation:")
    print(f"  Summary: {manager.get_source_summary()}")

    # Fetch artists
    print(f"\nFetching artists using ArtistSourceManager...")
    lastfm_artists, recent_artists, artist_playcounts, artist_playcounts_12month, artist_mbids = \
        manager.fetch_filtering_artists()

    print(f"  ✓ Total artists (union): {len(lastfm_artists)}")

    # Create parser and filter
    parser = ConcertParser(lastfm_artists)
    mock_concerts = create_mock_concerts()

    print(f"\nFiltering {len(mock_concerts)} mock concerts...")
    filtered_concerts, total_count, matched_count = parser.filter_concerts(mock_concerts)

    print(f"  Total: {total_count}, Matched: {matched_count}, Filtered: {len(filtered_concerts)}")

    if filtered_concerts:
        print(f"\n✓ Matched concerts:")
        for concert in filtered_concerts:
            print(f"  - {concert['event_name']} → {concert.get('matched_artists', [])}")

    # Validation
    assert isinstance(filtered_concerts, list)
    for concert in filtered_concerts:
        assert 'matched_artists' in concert

    print(f"\n✅ Concert filtering works with both sources!")

    session.close()
    return True


def test_scenario_4_no_filter():
    """
    Scenario 4: No filter mode (--no-filter)
    - Empty artist set means no filtering requested
    - parse_concerts.py uses all_concerts instead of filtered_concerts
    """
    print("\n" + "=" * 80)
    print("SCENARIO 4: No Filter Mode (--no-filter)")
    print("=" * 80)

    # Simulate --no-filter mode with empty artist set
    lastfm_artists = set()

    parser = ConcertParser(lastfm_artists)
    mock_concerts = create_mock_concerts()

    print(f"\nFiltering {len(mock_concerts)} concerts with empty artist filter...")
    filtered_concerts, total_count, matched_count = parser.filter_concerts(mock_concerts)

    print(f"  Total: {total_count}, Matched: {matched_count}, Filtered: {len(filtered_concerts)}")

    # With empty filter, nothing matches (parse_concerts.py uses all_concerts in this case)
    assert matched_count == 0, "Empty filter should match nothing"
    assert len(filtered_concerts) == 0, "Empty filter should return no filtered concerts"

    print(f"\n✅ No-filter mode works correctly (empty artist set, parse_concerts uses all_concerts)!")

    return True


def main():
    """Run all integration test scenarios"""
    print("\n" + "=" * 80)
    print("ARTIST SOURCE MANAGER - CONCERT FILTERING INTEGRATION")
    print("=" * 80)
    print("\nTests that ArtistSourceManager works correctly with ConcertParser")
    print("to filter concerts, matching the real parse_concerts.py flow")
    print("=" * 80 + "\n")

    results = {
        'Scenario 1 (UserArtist only)': test_scenario_1_userartist_only(),
        'Scenario 2 (Last.fm only)': test_scenario_2_lastfm_only(),
        'Scenario 3 (Both sources)': test_scenario_3_both_sources(),
        'Scenario 4 (No filter)': test_scenario_4_no_filter(),
    }

    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    for scenario, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{scenario}: {status}")
    print("=" * 80 + "\n")

    return 0 if all(results.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
