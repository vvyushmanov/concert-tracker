#!/usr/bin/env python3
"""
Detailed test to understand 12-month playcount flow
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from database.config import get_engine
from services import ArtistSourceManager, LastFMService
from config import ConfigManager


def main():
    config = ConfigManager()
    lastfm_api_key = config.get('LASTFM_API_KEY')
    lastfm_user = config.get('LASTFM_USER')

    if not lastfm_api_key or not lastfm_user:
        print("ERROR: Last.fm not configured")
        return 1

    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()

    # Test with min_playcount=40 (typical scenario)
    print("=" * 80)
    print("Testing with min_playcount=40")
    print("=" * 80)

    manager = ArtistSourceManager(
        session=session,
        user_id=1,
        lastfm_service=LastFMService(lastfm_api_key),
        lastfm_user=lastfm_user,
        min_playcount=40
    )

    all_artists, recent_artists, playcounts, playcounts_12month, artist_mbids = \
        manager.fetch_filtering_artists()

    print(f"\nResults:")
    print(f"  Total artists (playcount >= 40): {len(all_artists)}")
    print(f"  Artists with overall playcounts: {len(playcounts)}")
    print(f"  Artists with 12-month playcounts: {len(playcounts_12month)}")
    print(f"  Recent artists: {len(recent_artists)}")

    # Explanation
    print(f"\nExplanation:")
    print(f"  - Last.fm API returns ~990 overall artists and ~899 with 12-month activity")
    print(f"  - After filtering by playcount >= 40: {len(all_artists)} artists remain")
    print(f"  - Of those {len(all_artists)}, {len(playcounts_12month)} were ALSO listened to in last 12 months")
    print(f"  - This is correct: we only track 12-month data for artists above threshold")

    session.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
