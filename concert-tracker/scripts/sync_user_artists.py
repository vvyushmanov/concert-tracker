#!/usr/bin/env python3
"""
Sync a user's followed artists from Last.fm — WITHOUT scraping concerts.

This is the decoupled counterpart to the old parser-coupled flow: in the
read-time personalization model, a user's followed artists (the `UserArtist`
table) drive what concerts they see. This script refreshes that set from the
user's Last.fm top artists on demand (additive: it creates/updates UserArtist
rows; it never removes — manual unfollow handles removal).

Usage:
    python sync_user_artists.py --user-id 1
    python sync_user_artists.py --user-id 1 --debug

Exit codes:
    0 = success
    1 = error (bad user / DB)
    2 = Last.fm not configured for this user (use manual follow instead)
"""

import sys
import os
import json
import argparse
from typing import Dict, Tuple
from dotenv import load_dotenv

from utils import setup_logging, get_logger
from utils.validation import is_musicbrainz_id
from utils.credentials import load_credentials
from services.lastfm_service import LastFMService
from database import ConcertDatabaseWriter

logger = get_logger(__name__)


def upsert_lastfm_artists(
    writer: ConcertDatabaseWriter,
    overall_dict: Dict[str, dict],
    month12_dict: Dict[str, dict],
    min_playcount: int,
) -> int:
    """Upsert Last.fm artists into UserArtist for writer.user_id.

    Pure DB logic (no network) so it can be tested with synthetic dicts.
    Mirrors ArtistSourceManager's Last.fm processing, but WRITES UserArtist.

    Args:
        writer: ConcertDatabaseWriter constructed with a user_id.
        overall_dict: Last.fm overall artists, keyed by lowercase name AND mbid;
                      each value has {'name', 'playcount', 'mbid'}.
        month12_dict: 12-month playcounts, keyed by lowercase name.
        min_playcount: only sync artists at/above this overall playcount.

    Returns:
        Number of artists synced (created or updated).
    """
    if not writer.user_id:
        raise ValueError("writer must be constructed with a user_id")

    # Filter by playcount threshold; exclude MBID-keyed duplicate entries.
    filtered = {
        key: data
        for key, data in overall_dict.items()
        if data.get("playcount", 0) >= min_playcount and not is_musicbrainz_id(key)
    }

    synced = 0
    for _, data in filtered.items():
        name = data.get("name")
        if not name:
            continue
        playcount = data.get("playcount", 0)
        pc12 = month12_dict.get(name.lower(), {}).get("playcount", 0)
        recent = pc12 > 0
        mbid = (data.get("mbid") or "").strip() or None

        artist = writer.get_or_create_artist(name, mbid=mbid)
        writer.get_or_create_user_artist(
            artist, playcount=playcount, playcount12month=pc12, recent=recent
        )
        synced += 1

    writer.session.commit()
    return synced


def sync_user_artists(
    writer: ConcertDatabaseWriter,
    lastfm_service: LastFMService,
    lastfm_user: str,
    min_playcount: int,
) -> int:
    """Fetch the user's Last.fm artists and upsert them into UserArtist."""
    overall_dict, month12_dict = lastfm_service.fetch_all_user_artists(lastfm_user)
    return upsert_lastfm_artists(writer, overall_dict, month12_dict, min_playcount)


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Sync a user's followed artists from Last.fm (no concert scraping)"
    )
    parser.add_argument("--user-id", type=int, required=True, help="User ID to sync")
    parser.add_argument("--db-path", help="SQLite path (optional if DATABASE_URL set)")
    parser.add_argument("--debug", action="store_true", help="Verbose logging")
    parser.add_argument("--no-color-log", action="store_true", help="Disable colored log output")
    args = parser.parse_args()

    setup_logging(verbose=args.debug, use_colors=not args.no_color_log)

    credentials, validation = load_credentials(user_id=args.user_id, db_path=args.db_path)
    if validation.is_error():
        validation.log(logger)
        return 1

    if not (credentials.lastfm_api_key and credentials.lastfm_user):
        logger.error(
            "Last.fm is not configured for this user "
            "(need a Last.fm username + API key). Add artists manually instead."
        )
        return 2

    logger.info(
        f"Syncing Last.fm artists for user {args.user_id} "
        f"(lastfm_user={credentials.lastfm_user}, min_playcount={credentials.min_playcount})"
    )

    writer = ConcertDatabaseWriter(args.db_path, user_id=args.user_id, debug=args.debug)
    try:
        lastfm_service = LastFMService(credentials.lastfm_api_key)
        synced = sync_user_artists(
            writer, lastfm_service, credentials.lastfm_user, credentials.min_playcount
        )
        logger.info(
            f"Synced {synced} artists "
            f"(created={writer.stats['user_artists_created']}, "
            f"updated={writer.stats['user_artists_updated']})"
        )
        # Machine-readable line for the API route to parse.
        print(
            "SYNC_RESULT "
            + json.dumps(
                {
                    "synced": synced,
                    "created": writer.stats["user_artists_created"],
                    "updated": writer.stats["user_artists_updated"],
                }
            )
        )
    except Exception as e:
        logger.error(f"Last.fm sync failed: {e}", exc_info=args.debug)
        return 1
    finally:
        writer.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
