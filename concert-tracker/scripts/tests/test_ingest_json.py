#!/usr/bin/env python3
"""
M2.1 test — ingest_json.py ingests a JSON array of concerts globally.

Pins the contract the M2 agent → /api/ingest path relies on:
  * Running `ingest_json.py --input-json <file>` writes ONLY global rows —
    Concert, Artist, ArtistConcert — and NEVER materializes per-user
    UserConcert / UserArtist (it is the user_id=None population path).
  * Concerts in the PoC shape (no 'matched_artists' key) get their artists
    linked from `performers` (no-filter fallback).
  * The script prints exactly one machine-readable `INGEST_RESULT {json}` line
    whose counts are coherent: received == len(input), new == after - before,
    and after >= before.

This invokes the REAL script as a subprocess (the way the route will), so it
also covers arg parsing and the stdout contract — not just the writer.

Run inside the web container (has DATABASE_URL + deps):
  docker compose -f docker-compose.dev.yml exec -T web \
    sh -c 'cd /app/scripts && python3 tests/test_ingest_json.py'
"""
import sys
import os
import json
import subprocess
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import get_logger, setup_logging
from database.config import get_engine
from database.models import (
    Concert, Artist, ArtistConcert, UserConcert, UserArtist, CityMapping, Country,
)
from sqlalchemy.orm import sessionmaker

logger = get_logger(__name__)
setup_logging(verbose=True)

P = '__test_m21_'
SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ingest_json.py')
URL_A = 'https://test-m21.example/concert-a'
URL_B = 'https://test-m21.example/concert-b'
ARTIST_A = P + 'IngestBandA'
ARTIST_B = P + 'IngestBandB'
ARTIST_SHARED = P + 'IngestSharedBand'  # co-performer on both → proves multi-performer links


class Suite:
    def __init__(self):
        self.engine = get_engine()
        self.Session = sessionmaker(bind=self.engine)
        self.session = self.Session()
        self.results = []

    def refresh(self):
        self.session.close()
        self.session = self.Session()

    def check(self, ok, msg):
        self.results.append(('PASS' if ok else 'FAIL', msg))
        logger.info(f"  {'✅' if ok else '❌'} {msg}")
        return ok

    def existing_city(self):
        """Reuse an existing CityMapping so the writer skips network geocoding."""
        cm = self.session.query(CityMapping).first()
        if not cm:
            raise RuntimeError("No CityMapping rows in DB — run a scan/ingest first so geocoding is cached.")
        country = self.session.get(Country, cm.countryId)
        return cm.originalCity, country.name

    def make_concert(self, url, performers):
        city, country = self.existing_city()
        # PoC/agent shape: snake_case keys, NO 'matched_artists' (no-filter fallback).
        return {
            'event_url': url,
            'event_name': P + 'Event',
            'date_start': '2027-03-20',
            'date_end': '2027-03-20',
            'venue': P + 'Venue',
            'city': city,
            'country': country,
            'performers': performers,
            'ticket_links': [],
        }

    def run_ingest(self, concerts):
        """Write the fixture to a temp file and invoke the real script."""
        fd, path = tempfile.mkstemp(suffix='.json', prefix=P)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(concerts, f, ensure_ascii=False)
            proc = subprocess.run(
                [sys.executable, '-u', SCRIPT, '--input-json', path],
                capture_output=True, text=True, timeout=300,
            )
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        logger.info(f"ingest exit={proc.returncode}")
        if proc.stderr.strip():
            logger.info(f"ingest stderr tail: {proc.stderr.strip().splitlines()[-3:]}")
        return proc

    def parse_result_line(self, stdout):
        """Extract the single INGEST_RESULT {json} line."""
        lines = [ln for ln in stdout.splitlines() if ln.startswith('INGEST_RESULT ')]
        if len(lines) != 1:
            return None, len(lines)
        try:
            return json.loads(lines[0][len('INGEST_RESULT '):]), 1
        except json.JSONDecodeError:
            return None, 1

    # ---- the scenario ------------------------------------------------------

    def test_ingest(self):
        logger.info("— ingest_json.py global population —")
        fixture = [
            self.make_concert(URL_A, [ARTIST_A, ARTIST_SHARED]),
            self.make_concert(URL_B, [ARTIST_B, ARTIST_SHARED]),
        ]
        proc = self.run_ingest(fixture)
        self.check(proc.returncode == 0, f'script exited 0 (got {proc.returncode})')

        result, n = self.parse_result_line(proc.stdout)
        self.check(result is not None, f'exactly one parseable INGEST_RESULT line (found {n})')
        if result:
            self.check(result.get('received') == 2, f"received == 2 (got {result.get('received')})")
            self.check('before' in result and 'after' in result and 'new' in result,
                       'result has before/after/new keys')
            if all(k in result for k in ('before', 'after', 'new')):
                self.check(result['new'] == result['after'] - result['before'],
                           f"new == after - before ({result['new']} == {result['after']} - {result['before']})")
                self.check(result['after'] >= result['before'], 'after >= before')
                self.check(result['new'] == 2, f"new == 2 (both fixture concerts are fresh) (got {result['new']})")

        # Verify DB side effects directly.
        self.refresh()
        ca = self.session.query(Concert).filter_by(eventUrl=URL_A).first()
        cb = self.session.query(Concert).filter_by(eventUrl=URL_B).first()
        self.check(ca is not None and cb is not None, 'both global Concert rows created')

        a = self.session.query(Artist).filter_by(name=ARTIST_A).first()
        shared = self.session.query(Artist).filter_by(name=ARTIST_SHARED).first()
        self.check(a is not None, 'global Artist (A) created')
        self.check(shared is not None, 'global shared Artist created')

        if ca and a:
            link = self.session.query(ArtistConcert).filter_by(concertId=ca.id, artistId=a.id).first()
            self.check(link is not None, 'ArtistConcert link created from performers (no matched_artists)')
        if shared and ca and cb:
            shared_links = self.session.query(ArtistConcert).filter_by(artistId=shared.id).filter(
                ArtistConcert.concertId.in_([ca.id, cb.id])).count()
            self.check(shared_links == 2, f'shared co-performer linked to BOTH concerts (got {shared_links})')

        # The whole point: zero per-user rows from a global ingest.
        concert_ids = [c.id for c in (ca, cb) if c]
        artist_ids = [x.id for x in (a, shared, self.session.query(Artist).filter_by(name=ARTIST_B).first()) if x]
        if concert_ids:
            uc = self.session.query(UserConcert).filter(UserConcert.concertId.in_(concert_ids)).count()
            self.check(uc == 0, f'NO UserConcert materialized by ingest (got {uc})')
        if artist_ids:
            ua = self.session.query(UserArtist).filter(UserArtist.artistId.in_(artist_ids)).count()
            self.check(ua == 0, f'NO UserArtist materialized by ingest (got {ua})')

    def test_idempotent_rerun(self):
        """Re-ingesting the same payload adds nothing new (upsert on eventUrl)."""
        logger.info("— re-ingest is idempotent —")
        fixture = [
            self.make_concert(URL_A, [ARTIST_A, ARTIST_SHARED]),
            self.make_concert(URL_B, [ARTIST_B, ARTIST_SHARED]),
        ]
        proc = self.run_ingest(fixture)
        result, _ = self.parse_result_line(proc.stdout)
        if result:
            self.check(result.get('new') == 0,
                       f"re-ingest adds 0 new concerts (got {result.get('new')})")
            self.check(result.get('received') == 2, 'received still 2 on rerun')

    # ---- cleanup -----------------------------------------------------------

    def cleanup(self):
        self.refresh()
        concert_ids = [c.id for c in self.session.query(Concert).filter(
            Concert.eventUrl.in_([URL_A, URL_B])).all()]
        artist_ids = [a.id for a in self.session.query(Artist).filter(
            Artist.name.in_([ARTIST_A, ARTIST_B, ARTIST_SHARED])).all()]

        if concert_ids:
            self.session.query(UserConcert).filter(UserConcert.concertId.in_(concert_ids)).delete(synchronize_session=False)
            self.session.query(ArtistConcert).filter(ArtistConcert.concertId.in_(concert_ids)).delete(synchronize_session=False)
        if artist_ids:
            self.session.query(UserArtist).filter(UserArtist.artistId.in_(artist_ids)).delete(synchronize_session=False)
            self.session.query(ArtistConcert).filter(ArtistConcert.artistId.in_(artist_ids)).delete(synchronize_session=False)
        if concert_ids:
            self.session.query(Concert).filter(Concert.id.in_(concert_ids)).delete(synchronize_session=False)
        if artist_ids:
            self.session.query(Artist).filter(Artist.id.in_(artist_ids)).delete(synchronize_session=False)
        self.session.commit()
        logger.info("Cleaned up test data.")

    def summary(self):
        passed = sum(1 for r, _ in self.results if r == 'PASS')
        failed = len(self.results) - passed
        logger.info(f"\nTotal: {len(self.results)}, Passed: {passed}, Failed: {failed}")
        return failed == 0


def main():
    s = Suite()
    ok = False
    try:
        s.cleanup()  # self-heal from a prior aborted run
        s.test_ingest()
        s.test_idempotent_rerun()
        ok = s.summary()
    finally:
        try:
            s.cleanup()
        except Exception as e:
            logger.error(f"Cleanup failed: {e}")
        s.session.close()
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
