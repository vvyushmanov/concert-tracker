#!/usr/bin/env python3
"""
M1.5 regression test — concert population is decoupled from user preferences.

Pins the invariant the whole multi-user model relies on:
  * Writing concerts with user_id=None (the global population path the admin
    scan / M2 agent uses) creates ONLY global rows — Concert, Artist,
    ArtistConcert — and NEVER materializes per-user UserConcert / UserArtist.
  * Writing the same shape with a real user_id still materializes the per-user
    rows (proves the guard is about user_id, not a global regression).

Run inside the web container (has DATABASE_URL + deps):
  docker compose -f docker-compose.dev.yml exec -T web \
    sh -c 'cd /app/scripts && python3 tests/test_global_population_decoupled.py'
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import get_logger, setup_logging
from database.config import get_engine
from database.models import (
    Concert, Artist, ArtistConcert, UserConcert, UserArtist, CityMapping, Country, User,
)
from database.writer import ConcertDatabaseWriter
from sqlalchemy.orm import sessionmaker

logger = get_logger(__name__)
setup_logging(verbose=True)

P = '__test_m15_'
GLOBAL_URL = 'https://test-m15.example/global-concert'
USER_URL = 'https://test-m15.example/user-concert'
GLOBAL_ARTIST = P + 'GlobalOnlyBand'
USER_ARTIST = P + 'PerUserBand'


class Suite:
    def __init__(self):
        self.engine = get_engine()
        self.Session = sessionmaker(bind=self.engine)
        self.session = self.Session()
        self.results = []
        self.test_user_id = None

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
            raise RuntimeError("No CityMapping rows in DB — run a scan first so geocoding is cached.")
        country = self.session.get(Country, cm.countryId)
        return cm.originalCity, country.name

    def make_concert(self, url, artist):
        city, country = self.existing_city()
        return {
            'event_url': url,
            'event_name': P + 'Event',
            'date_start': '2027-01-15',
            'date_end': '2027-01-15',
            'venue': P + 'Venue',
            'city': city,
            'country': country,
            'performers': [artist],  # no 'matched_artists' → writer links all performers
        }

    def setup_user(self):
        u = User(username=P + 'user', hashedPassword='x', role='USER')
        self.session.add(u)
        self.session.commit()
        self.test_user_id = u.id
        logger.info(f"Created test user id={u.id}")

    # ---- the two scenarios -------------------------------------------------

    def test_global_path(self):
        logger.info("— GLOBAL population (user_id=None) —")
        w = ConcertDatabaseWriter(user_id=None)
        w.write_concerts([self.make_concert(GLOBAL_URL, GLOBAL_ARTIST)])
        w.close()
        self.refresh()

        concert = self.session.query(Concert).filter_by(eventUrl=GLOBAL_URL).first()
        artist = self.session.query(Artist).filter_by(name=GLOBAL_ARTIST).first()
        self.check(concert is not None, 'global Concert row created')
        self.check(artist is not None, 'global Artist row created')
        if concert and artist:
            link = self.session.query(ArtistConcert).filter_by(
                concertId=concert.id, artistId=artist.id).first()
            self.check(link is not None, 'ArtistConcert link created (artist linked to concert)')
            uc = self.session.query(UserConcert).filter_by(concertId=concert.id).count()
            self.check(uc == 0, f'NO UserConcert materialized for global concert (got {uc})')
        if artist:
            ua = self.session.query(UserArtist).filter_by(artistId=artist.id).count()
            self.check(ua == 0, f'NO UserArtist materialized for global artist (got {ua})')

    def test_user_path(self):
        logger.info("— PER-USER population (user_id set) —")
        w = ConcertDatabaseWriter(user_id=self.test_user_id)
        w.write_concerts([self.make_concert(USER_URL, USER_ARTIST)])
        w.close()
        self.refresh()

        concert = self.session.query(Concert).filter_by(eventUrl=USER_URL).first()
        artist = self.session.query(Artist).filter_by(name=USER_ARTIST).first()
        self.check(concert is not None, 'concert row created (user path)')
        if concert:
            uc = self.session.query(UserConcert).filter_by(
                concertId=concert.id, userId=self.test_user_id).count()
            self.check(uc == 1, f'UserConcert materialized when user_id set (got {uc})')
        if artist:
            ua = self.session.query(UserArtist).filter_by(
                artistId=artist.id, userId=self.test_user_id).count()
            self.check(ua == 1, f'UserArtist materialized when user_id set (got {ua})')

    # ---- cleanup -----------------------------------------------------------

    def cleanup(self):
        self.refresh()
        concert_ids = [c.id for c in self.session.query(Concert).filter(
            Concert.eventUrl.in_([GLOBAL_URL, USER_URL])).all()]
        artist_ids = [a.id for a in self.session.query(Artist).filter(
            Artist.name.in_([GLOBAL_ARTIST, USER_ARTIST])).all()]

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
        if self.test_user_id:
            self.session.query(User).filter(User.id == self.test_user_id).delete(synchronize_session=False)
        self.session.commit()
        logger.info("Cleaned up test data.")

    def summary(self):
        passed = sum(1 for r, _ in self.results if r == 'PASS')
        failed = len(self.results) - passed
        logger.info(f"\nTotal: {len(self.results)}, Passed: {passed}, Failed: {failed}")
        return failed == 0


def main():
    s = Suite()
    try:
        s.setup_user()
        s.test_global_path()
        s.test_user_path()
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
