#!/usr/bin/env python3
"""
Unit/integration test for sync_user_artists.upsert_lastfm_artists (no network).

Run inside the web container (has Python deps + DATABASE_URL):
  docker compose -f docker-compose.dev.yml exec -T web \
    sh -c 'cd /app/scripts && python3 tests/test_sync_user_artists.py'
"""
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import get_logger, setup_logging
from database import ConcertDatabaseWriter
from database.models import Artist, UserArtist, User, get_session
from sync_user_artists import upsert_lastfm_artists

logger = get_logger(__name__)
setup_logging(verbose=True)

PREFIX = "__test_sync_"
results = []


def check(cond, msg):
    results.append(cond)
    print(("  ✅ " if cond else "  ❌ ") + msg)


def main():
    now = int(time.time())
    session = get_session()

    # Fresh test user
    session.query(User).filter(User.username == PREFIX + "user").delete()
    session.commit()
    user = User(username=PREFIX + "user", hashedPassword="x", createdAt=now, updatedAt=now)
    session.add(user)
    session.commit()
    user_id = user.id

    # Synthetic Last.fm payload (mirrors LastFMService.fetch_all_user_artists shape:
    # overall_dict is keyed by BOTH lowercase name and mbid).
    name_a = PREFIX + "Aurora"
    name_m = PREFIX + "Manual"
    name_low = PREFIX + "LowPlay"
    mbid_a = "11111111-1111-1111-1111-111111111111"
    overall = {
        name_a.lower(): {"name": name_a, "playcount": 100, "mbid": mbid_a},
        mbid_a: {"name": name_a, "playcount": 100, "mbid": mbid_a},  # MBID-keyed dup → must be ignored
        name_m.lower(): {"name": name_m, "playcount": 80, "mbid": ""},
        name_low.lower(): {"name": name_low, "playcount": 5, "mbid": ""},  # below threshold
    }
    month12 = {name_a.lower(): {"playcount": 30}}

    writer = ConcertDatabaseWriter(user_id=user_id)
    try:
        synced = upsert_lastfm_artists(writer, overall, month12, min_playcount=40)
        check(synced == 2, f"synced 2 artists (got {synced}) — LowPlay below threshold + MBID dup excluded")

        rows = (
            writer.session.query(UserArtist, Artist)
            .join(Artist, UserArtist.artistId == Artist.id)
            .filter(UserArtist.userId == user_id)
            .all()
        )
        byname = {a.name: ua for ua, a in rows}
        check(set(byname.keys()) == {name_a, name_m}, f"UserArtist rows are exactly Aurora+Manual (got {sorted(byname)})")
        check(byname[name_a].playcount == 100 and byname[name_a].playcount12month == 30 and byname[name_a].recent is True,
              "Aurora: playcount=100, 12m=30, recent=True")
        check(byname[name_m].playcount == 80 and byname[name_m].recent is False,
              "Manual: playcount=80, recent=False (no 12m plays)")
        aurora = writer.session.query(Artist).filter_by(name=name_a).first()
        check(aurora.mbid == mbid_a, "Aurora Artist got its MBID stored")

        # Update path: re-run with a higher playcount → updates, no duplicate row
        overall[name_a.lower()]["playcount"] = 150
        synced2 = upsert_lastfm_artists(writer, overall, month12, min_playcount=40)
        check(synced2 == 2, "re-sync processes the same 2 artists")
        ua_count = writer.session.query(UserArtist).filter_by(userId=user_id).count()
        check(ua_count == 2, f"still exactly 2 UserArtist rows after re-sync (got {ua_count}) — no duplicates")
        writer.session.expire_all()
        aurora_ua = (
            writer.session.query(UserArtist)
            .join(Artist, UserArtist.artistId == Artist.id)
            .filter(UserArtist.userId == user_id, Artist.name == name_a)
            .first()
        )
        check(aurora_ua.playcount == 150, f"Aurora playcount updated to 150 (got {aurora_ua.playcount})")
    finally:
        # Cleanup
        writer.session.query(UserArtist).filter_by(userId=user_id).delete()
        writer.session.query(Artist).filter(Artist.name.like(PREFIX + "%")).delete(synchronize_session=False)
        writer.session.query(User).filter_by(id=user_id).delete()
        writer.session.commit()
        writer.close()
        session.close()

    passed = sum(1 for r in results if r)
    print(f"\n{'✅ PASS' if passed == len(results) else '❌ FAIL'} — {passed}/{len(results)} checks")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
