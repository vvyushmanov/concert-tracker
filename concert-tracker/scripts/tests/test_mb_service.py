#!/usr/bin/env python3

import sys
import os
import unittest
import time
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.musicbrainz_service import MusicBrainzService

RATE_LIMIT_DELAY = 1.1


class TestMusicBrainzService(unittest.TestCase):
    def test_fetch_artist_info(self):
        mb_service = MusicBrainzService()
        time.sleep(RATE_LIMIT_DELAY)
        artist_info = mb_service.fetch_artist_info("Sabaton")
        self.assertIsNotNone(artist_info)
        self.assertEqual(artist_info["name"], "Sabaton")
        self.assertEqual(artist_info["type"], "Group")
        print(artist_info)

    def test_get_artist_mbids(self):
        mb_service = MusicBrainzService()
        time.sleep(RATE_LIMIT_DELAY)
        artist_mbid = mb_service.get_artist_mbid("Sabaton")
        self.assertIsNotNone(artist_mbid)
        self.assertEqual(artist_mbid, "39a31de6-763d-48b6-a45c-f7cfad58ffd8")
        print(artist_mbid)

    def test_get_nonexistent_artist_mbids(self):
        mb_service = MusicBrainzService()
        time.sleep(RATE_LIMIT_DELAY)
        artist_mbid = mb_service.get_artist_mbid("Nonexistent Artist")
        self.assertIsNone(artist_mbid)


if __name__ == "__main__":
    unittest.main()
