#!/usr/bin/env python3
"""
Backfill coordinates for city mappings stored offline by the async ingest.

The async per-page ingest (ingest_json.py, geocode=False) writes CityMapping rows
WITHOUT coordinates — fast, and crucially never rate-limited, because each page is
its own short-lived process and live geocoding there would reset the 1 req/s clock
and hammer Nominatim into 429s. This script fills those coordinates in a SINGLE,
properly-paced process: since it's the ONLY place that geocodes, Nominatim's
1 req/s policy is honored globally and the rate limit is never hit.

Properties:
  • Idempotent + resumable — only touches rows with NULL latitude, commits each as
    it goes, and can be re-run to pick up cities that didn't resolve last time.
  • Non-fatal — a city that can't be geocoded keeps null coordinates and is retried
    next pass (the map just can't pin it yet); one bad city never blocks the rest.
  • Self-exclusive — a lock file (with stale-lock recovery) prevents two passes
    geocoding at once, so the worker can safely spawn it after every drain.
  • Coordinates only — no Overpass clustering here (that's the flakiest, most
    rate-limited call); this pass is pure Nominatim to keep it fast and polite.

Usage:
    python backfill_city_coords.py                      # up to --limit cities
    python backfill_city_coords.py --limit 500 --debug
    python backfill_city_coords.py --db-path /tmp/scratch.db
"""

import argparse
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Optional

# Resolve sibling packages (database/, utils/) regardless of cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
from sqlalchemy.orm import sessionmaker

from database.config import get_engine
from database.models import CityMapping
from database.normalizers.city import CityNormalizer
from utils import get_logger, setup_logging

logger = get_logger(__name__)
load_dotenv()

LOCK_PATH = os.path.join(tempfile.gettempdir(), 'concert-tracker-coord-backfill.lock')
LOCK_STALE_SECONDS = 1800  # a lock older than this is presumed orphaned (crash) and reclaimed
EXIT_MORE_REMAIN = 10  # exit code telling the caller "I hit --limit; run me again to drain the rest"


def acquire_lock() -> Optional[int]:
    """Atomically create the lock file. Returns its fd, or None if a live pass holds it."""
    for _ in range(2):
        try:
            fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {int(time.time())}\n".encode())
            return fd
        except FileExistsError:
            try:
                age = time.time() - os.path.getmtime(LOCK_PATH)
            except OSError:
                return None
            if age > LOCK_STALE_SECONDS:
                logger.warning(f"Removing stale backfill lock ({age:.0f}s old)")
                try:
                    os.unlink(LOCK_PATH)
                except OSError:
                    return None
                continue  # retry the open once
            return None
    return None


def release_lock(fd: Optional[int]) -> None:
    if fd is not None:
        try:
            os.close(fd)
        except OSError:
            pass
    try:
        os.unlink(LOCK_PATH)
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill coordinates for offline city mappings.")
    parser.add_argument('--limit', type=int, default=300,
                        help="Max cities to geocode this run (default 300; ~1.1s each).")
    parser.add_argument('--db-path', default=None,
                        help="SQLite DB path. Omit to use DATABASE_URL (MySQL).")
    parser.add_argument('--debug', action='store_true', help="Verbose logging.")
    args = parser.parse_args()

    setup_logging(verbose=args.debug)

    lock_fd = acquire_lock()
    if lock_fd is None:
        logger.info("Another coordinate backfill is already running — exiting.")
        return 0

    session = None
    try:
        engine = get_engine(args.db_path)
        Session = sessionmaker(bind=engine)
        session = Session()

        # Only rows missing coordinates. Oldest first → fair, deterministic progress.
        pending = (
            session.query(CityMapping)
            .filter(CityMapping.latitude.is_(None))
            .order_by(CityMapping.id.asc())
            .limit(args.limit)
            .all()
        )

        if not pending:
            logger.info("No city mappings need coordinates — nothing to backfill.")
            return 0

        logger.info(f"Backfilling coordinates for up to {len(pending)} city mapping(s)...")

        # One normalizer instance → one rate-limit clock for the whole run (~1 req/s).
        normalizer = CityNormalizer(session, verbose=args.debug)

        filled = 0
        missed = 0
        examined = 0
        rl_strikes = 0  # consecutive rate-limited misses → trip the circuit breaker
        circuit_broke = False
        for mapping in pending:
            examined += 1
            cn = mapping.city_normalized
            normalized_city = cn.normalizedCity if cn else None
            country_name = cn.country.name if (cn and cn.country) else None
            if not normalized_city or not country_name:
                logger.warning(
                    f"Mapping id={mapping.id} ('{mapping.originalCity}') has no normalized city/country — skipping"
                )
                missed += 1
                continue

            metadata = normalizer._geocode_city(normalized_city, country_name)
            if metadata:
                rl_strikes = 0
                mapping.latitude = metadata['lat']
                mapping.longitude = metadata['lon']
                mapping.source = 'geocoded'
                mapping.updatedAt = int(datetime.now(timezone.utc).timestamp())
                try:
                    session.commit()
                    filled += 1
                    logger.info(f"✓ {normalized_city}, {country_name} → ({metadata['lat']:.4f}, {metadata['lon']:.4f})")
                except Exception as e:
                    session.rollback()
                    missed += 1
                    logger.error(f"Failed to save coordinates for '{normalized_city}, {country_name}': {e}")
            else:
                missed += 1  # _geocode_city already logged a descriptive, named reason
                # Circuit breaker: if we're being actively rate-limited, stop now
                # rather than grind through the rest. Hammering a server that's
                # already throttling us only prolongs the block; the remainder
                # resumes on the next pass once the limit clears. (Clean "no match"
                # misses don't set this flag, so they never trip the breaker.)
                if normalizer._last_was_rate_limited:
                    rl_strikes += 1
                    if rl_strikes >= 3:
                        logger.warning(
                            "Nominatim is rate-limiting us — backing off and stopping this pass. "
                            "The rest will resume automatically on the next backfill."
                        )
                        circuit_broke = True
                        break
                else:
                    rl_strikes = 0

        logger.info(
            f"Backfill done: {filled} filled, {missed} still missing (retried next pass), "
            f"of {examined} examined."
        )

        # Best-effort "fill ALL": if we stopped only because we hit --limit (not a
        # rate-limit block) and rows still need coordinates, signal the caller to run
        # another pass so the whole backlog drains over bounded, resumable chunks.
        # Exit 0 on a rate-limit block — don't hot-loop; the next scheduled pass picks up.
        if not circuit_broke and examined >= args.limit:
            remaining = session.query(CityMapping).filter(CityMapping.latitude.is_(None)).count()
            if remaining > 0:
                logger.info(f"{remaining} city mapping(s) still need coordinates — requesting another pass.")
                return EXIT_MORE_REMAIN
        return 0
    except Exception as e:
        logger.error(f"Coordinate backfill failed: {e}", exc_info=True)
        return 1
    finally:
        if session is not None:
            try:
                session.close()
            except Exception:
                pass
        release_lock(lock_fd)


if __name__ == '__main__':
    sys.exit(main())
