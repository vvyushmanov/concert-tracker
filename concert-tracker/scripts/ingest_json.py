#!/usr/bin/env python3
"""
Ingest a JSON array of scraped concerts into the GLOBAL concert tables.

This is the backend entry point for the M2 desktop scraper agent: the agent
scrapes concerts-metal.com in a real browser, POSTs the JSON to /api/ingest,
and the route hands that JSON to this script. It is deliberately separate from
parse_concerts.py (which hard-requires active countries, owns proxy/Last.fm
plumbing, and auto-spawns metadata) — this script only writes what it's given.

It uses ConcertDatabaseWriter(user_id=None): the GLOBAL population path, so it
creates only Concert / Artist / ArtistConcert rows and NEVER materializes
per-user UserConcert / UserArtist (relevance is computed at read time — see
lib/concerts.ts). Concerts in the agent/PoC shape carry no 'matched_artists'
key, so the writer links every name in `performers` (no-filter fallback).

Input shape (one array element per concert) — the snake_case keys the writer
reads, emitted as-is by the Electron agent:
    event_url, event_name, date_start, date_end, venue, city, country,
    postal_code, performers[], image_url, organizer, organizer_url,
    ticket_links[]   (extra keys such as _sourceCountry are ignored)

Output: exactly one machine-readable line on stdout for the caller to parse:
    INGEST_RESULT {"received": N, "before": X, "after": Y, "new": Z, ...}

Usage:
    python ingest_json.py --input-json /tmp/concerts.json
    python ingest_json.py --input-json out/all.json --db-path /tmp/scratch.db --debug
"""

import argparse
import json
import os
import sys

# Resolve sibling packages (database/, utils/) regardless of cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

from database.models import Concert
from database.writer import ConcertDatabaseWriter
from utils import get_logger, setup_logging

logger = get_logger(__name__)
load_dotenv()


def load_concerts(path: str) -> list:
    """Load and validate the input JSON array."""
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"Input JSON must be an array of concerts, got {type(data).__name__}")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ingest a JSON array of scraped concerts into the global concert tables."
    )
    parser.add_argument('--input-json', required=True,
                        help="Path to a JSON file containing an array of concert objects.")
    parser.add_argument('--db-path', default=None,
                        help="SQLite DB path. Omit to use DATABASE_URL (MySQL).")
    parser.add_argument('--debug', action='store_true', help="Verbose logging.")
    args = parser.parse_args()

    setup_logging(verbose=args.debug)

    if not os.path.isfile(args.input_json):
        logger.error(f"Input file not found: {args.input_json}")
        return 1

    try:
        concerts = load_concerts(args.input_json)
    except (json.JSONDecodeError, ValueError) as e:
        logger.error(f"Failed to read input JSON: {e}")
        return 1

    received = len(concerts)
    logger.info(f"Ingesting {received} concert(s) into the global tables (user_id=None)...")

    # GLOBAL population: user_id=None → writer skips UserConcert / UserArtist.
    # geocode=False: the async per-page ingest runs as many short-lived processes,
    # each of which would reset the geocoder's 1 req/s clock and hammer Nominatim/
    # Overpass into rate-limit (429) territory. So ingest writes city mappings
    # OFFLINE (text-normalized, no coordinates) — fast, never rate-limited, never
    # drops a concert — and backfill_city_coords.py fills coordinates afterward in a
    # single, properly-paced pass. Set INGEST_GEOCODE=1 to force inline geocoding.
    geocode_inline = os.getenv('INGEST_GEOCODE', '0') == '1'
    writer = ConcertDatabaseWriter(user_id=None, db_path=args.db_path, debug=args.debug, geocode=geocode_inline)
    try:
        before = writer.session.query(Concert).count()
        writer.write_concerts(concerts)
        # write_concerts commits per concert; counts reflect committed state.
        after = writer.session.query(Concert).count()

        result = {
            'received': received,
            'before': before,
            'after': after,
            'new': after - before,
            'concerts_created': writer.stats.get('concerts_created', 0),
            'concerts_updated': writer.stats.get('concerts_updated', 0),
            'artists_created': writer.stats.get('artists_created', 0),
            'artist_concert_links_created': writer.stats.get('artist_concert_links_created', 0),
            'errors': writer.stats.get('errors', 0),
        }
    finally:
        writer.close()

    if args.debug:
        writer.print_stats()

    logger.info(
        f"Ingest done: received={result['received']} new={result['new']} "
        f"(before={result['before']} after={result['after']}) errors={result['errors']}"
    )
    # The one line the caller (route / test) parses. Keep it last and alone.
    print("INGEST_RESULT " + json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
