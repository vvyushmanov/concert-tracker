#!/usr/bin/env python3
"""
CLI entry point for artist metadata fetching

Fetches artist metadata (MBIDs, images, playcounts) from multiple sources.

Metadata Sources:
    - MusicBrainz: Primary source for MBIDs (always available, no auth required)
    - Last.fm: Optional source for playcounts and fallback MBIDs
    - Fanart.tv: Optional source for high-resolution artist images

Credential Loading:
    - Uses centralized load_credentials() for all modes
    - User-specific mode: --user-id (for per-user metadata)
    - Global mode: no --user-id (for refreshing all artists, admin tasks)
    - Validates credentials and provides helpful error messages

Usage:
    python cli/fetch_metadata.py [options]
"""

import argparse
import atexit
import os
import tempfile
import time
from typing import List, Dict, Tuple, Optional
from dotenv import load_dotenv
from sqlalchemy.orm import sessionmaker, Session

# Import from library modules
from database.models import Artist, UserArtist
from database.config import get_engine
from services.lastfm_service import LastFMService
from services import ArtistMetadataService
from services.fanart_service import FanartService
from utils import get_logger, setup_logging
from utils.credentials import load_credentials

logger = get_logger(__name__)

# Load environment variables
load_dotenv()

# Single-flight lock: the ingest worker spawns this after every drain-with-new, and
# a full MBID+image pass over thousands of artists can run well over an hour at
# MusicBrainz's ~1 req/s. Without a lock, a second scan mid-run would spawn an
# overlapping process and double the API load on the same artist set. The stale
# threshold is deliberately long so a legitimately slow run is never reclaimed.
LOCK_PATH = os.path.join(tempfile.gettempdir(), 'concert-tracker-metadata.lock')
LOCK_STALE_SECONDS = 3 * 60 * 60  # 3h — longer than any realistic full pass

# How long to wait before re-querying MusicBrainz for an artist it previously had
# no entry for. Without this, every crawl re-runs the FULL no-MBID backlog through
# MusicBrainz (~1 req/s) — thousands of obscure acts it will never have. They're
# retried after this window in case MusicBrainz has since added them.
MBID_RECHECK_SECONDS = 30 * 24 * 60 * 60  # 30 days

# Mirror of MBID_RECHECK_SECONDS for fanart.tv images. Without this, every metadata
# pass re-queries the FULL "has MBID but no image" backlog against fanart.tv —
# thousands of obscure acts it has no image for, re-checked forever. Stamped on a
# fruitless lookup and retried only after this window (in case fanart.tv added one).
IMAGE_RECHECK_SECONDS = 30 * 24 * 60 * 60  # 30 days


def needs_mbid_lookup(artist, now: int) -> bool:
    """True if the artist has no MBID and hasn't been checked within the recheck window."""
    if artist.mbid:
        return False
    checked = artist.mbidCheckedAt
    return checked is None or checked < now - MBID_RECHECK_SECONDS


def needs_image_lookup(artist, now: int) -> bool:
    """True if the artist has an MBID, no image yet, and hasn't had a fruitless
    fanart.tv check within the recheck window."""
    if artist.imageUrl or not artist.mbid:
        return False
    checked = artist.imageCheckedAt
    return checked is None or checked < now - IMAGE_RECHECK_SECONDS


def acquire_lock() -> Optional[int]:
    """Atomically create the lock file. Returns its fd, or None if a live run holds it."""
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
                logger.warning(f"Removing stale metadata lock ({age:.0f}s old)")
                try:
                    os.unlink(LOCK_PATH)
                except OSError:
                    return None
                continue
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


class MetadataProcessor:
    """
    Orchestrates artist metadata fetching across multiple phases.

    Phases:
        0: MBID Auto-Repair - Fixes missing MBIDs (always runs)
        1: Playcounts & Images - Process artists with new MBIDs
        2: Image Fetch - Fetch images for artists with MBID but no image
        3: Playcount Refresh - Bulk refresh playcounts (optional)
    """

    def __init__(
        self,
        session: Session,
        metadata_service: ArtistMetadataService,
        fanart_service: Optional[FanartService],
        lastfm_api_key: Optional[str],
        lastfm_user: Optional[str],
        user_id: Optional[int],
        delay: float = 0.25
    ):
        """
        Initialize the metadata processor.

        Args:
            session: SQLAlchemy database session
            metadata_service: Service for metadata operations
            fanart_service: Service for fetching artist images (optional)
            lastfm_api_key: Last.fm API key (optional)
            lastfm_user: Last.fm username (optional)
            user_id: User ID for per-user stats (optional)
            delay: Delay between API calls in seconds
        """
        self.session = session
        self.metadata_service = metadata_service
        self.fanart_service = fanart_service
        self.lastfm_api_key = lastfm_api_key
        self.lastfm_user = lastfm_user
        self.user_id = user_id
        self.delay = delay

        self.lastfm_available = bool(lastfm_api_key and lastfm_user)
        self.fanart_available = bool(fanart_service)

        # Processing stats
        self.stats = {
            'processed': 0,
            'mbid_fetched': 0,
            'mbid_not_found': 0,
            'playcounts_updated': 0,
            'images_found': 0,
            'images_not_found': 0,
            'errors': 0
        }

        # Artist lists populated by categorize_artists()
        self.artists_without_mbid: List[Artist] = []
        self.artists_with_mbid: List[Artist] = []
        self.current_index = 0
        self.total_count = 0

    def phase_0_mbid_repair(self, all_artists: List[Artist]) -> int:
        """
        Phase 0: Automatic MBID repair for artists missing MBIDs.

        Uses MusicBrainz first, then Last.fm as fallback if configured.
        Always runs regardless of other flags.

        Args:
            all_artists: All artists to check for missing MBIDs

        Returns:
            Number of MBIDs repaired
        """
        now = int(time.time())
        without_mbid = [a for a in all_artists if not a.mbid]
        # Skip artists we've already failed to resolve within the recheck window, so
        # each crawl doesn't re-query the whole no-MBID backlog through MusicBrainz.
        candidates = [a for a in without_mbid if needs_mbid_lookup(a, now)]
        skipped = len(without_mbid) - len(candidates)
        recheck_days = MBID_RECHECK_SECONDS // 86400

        if not candidates:
            if skipped:
                logger.info(
                    f"PHASE 0: MBID Auto-Repair — nothing to query "
                    f"({skipped} without MBID already checked within {recheck_days}d)\n"
                )
            return 0

        logger.info("=" * 60)
        msg = f"PHASE 0: MBID Auto-Repair ({len(candidates)} to query"
        if skipped:
            msg += f", {skipped} skipped — checked within {recheck_days}d"
        logger.info(msg + ")")
        logger.info("=" * 60 + "\n")

        # Bulk repair using the service (which tries MusicBrainz first, Last.fm next)
        mbid_repair_count = 0
        try:
            mbid_repair_count = self.metadata_service.bulk_repair_mbids(
                self.session, candidates
            )
            # Stamp the ones STILL without an MBID so we don't re-query them next
            # crawl — both sources had nothing. Retried after the recheck window.
            stamped = 0
            for a in candidates:
                if not a.mbid:
                    a.mbidCheckedAt = now
                    stamped += 1
            self.session.commit()
            tail = f"; marked {stamped} as checked (no MBID found — won't re-query for {recheck_days}d)" if stamped else ""
            logger.info(f"\n✓ Auto-repaired {mbid_repair_count}/{len(candidates)} MBIDs{tail}\n")
        except Exception as e:
            logger.error(f"Error during MBID repair: {e}")
            self.session.rollback()

        # Re-evaluate artists needing images after MBID repair
        if self.fanart_available and mbid_repair_count > 0:
            logger.info("Re-evaluating artists needing images after MBID repair...")

        self.stats['mbid_fetched'] = mbid_repair_count
        return mbid_repair_count

    def categorize_artists(
        self,
        all_artists: List[Artist],
        force: bool = False,
        limit: Optional[int] = None,
        refresh_playcounts: bool = False
    ) -> Tuple[List[Artist], List[Artist]]:
        """
        Categorize artists into processing groups based on their current state.

        Args:
            all_artists: All artists to categorize
            force: If True, re-fetch metadata even if present
            limit: Maximum number of artists to process
            refresh_playcounts: If True, skip Phase 1 but run Phase 2

        Returns:
            Tuple of (artists_without_mbid, artists_with_mbid)
        """
        now = int(time.time())
        recheck_days = IMAGE_RECHECK_SECONDS // 86400
        # Artists with an MBID but no image that we checked recently and found
        # nothing for — skipped this run (parity with the Phase 0 MBID throttle).
        throttled_images = (
            0 if force
            else sum(1 for a in all_artists if a.mbid and not a.imageUrl and not needs_image_lookup(a, now))
        )

        if refresh_playcounts and not force:
            logger.info(f"Refresh playcounts mode: Will update playcounts for all {len(all_artists)} artists")
            artists_without_mbid = [a for a in all_artists if not a.mbid]
            artists_with_mbid = [a for a in all_artists if needs_image_lookup(a, now)]
            if artists_with_mbid:
                logger.info(f"  Also found {len(artists_with_mbid)} artists with MBID but missing images")
        else:
            if force:
                logger.info("Force mode: Will re-fetch metadata for all artists")

            artists_without_mbid = [a for a in all_artists if not a.mbid]
            artists_with_mbid = [a for a in all_artists if a.mbid and (force or needs_image_lookup(a, now))]

            if limit:
                total_artists = artists_without_mbid + artists_with_mbid
                artists_without_mbid = [a for a in total_artists if not a.mbid][:limit]
                remaining = limit - len(artists_without_mbid)
                artists_with_mbid = [a for a in total_artists if a.mbid][:remaining] if remaining > 0 else []
                logger.info(f"Limiting to {limit} artists total")

        if throttled_images:
            logger.info(
                f"  Skipping {throttled_images} artists with MBID but no image — "
                f"fanart.tv had nothing within the last {recheck_days}d (will retry after)"
            )

        self.artists_without_mbid = artists_without_mbid
        self.artists_with_mbid = artists_with_mbid
        self.total_count = len(artists_without_mbid) + len(artists_with_mbid)

        if self.total_count > 0:
            logger.info(f"Found {len(artists_without_mbid)} artists without MBID (will fetch MBID + playcounts + images)")
            logger.info(f"Found {len(artists_with_mbid)} artists with MBID needing images (will fetch images only)")
            logger.info(f"Total: {self.total_count} artists to process\n")

        return artists_without_mbid, artists_with_mbid

    def phase_1_process_artists_without_mbid(self) -> None:
        """
        Phase 1: Process artists without MBID (after Phase 0 repair).

        Updates playcounts if Last.fm is available and fetches images
        from Fanart.tv for artists that received MBIDs in Phase 0.
        """
        if not self.artists_without_mbid or not self.lastfm_available:
            return

        logger.info("=" * 60)
        logger.info("PHASE 1: Fetching playcounts and images for artists with new MBIDs")
        logger.info("=" * 60 + "\n")

        # Fetch all user artists in bulk for efficient lookup
        lastfm_service = LastFMService(api_key=self.lastfm_api_key)
        overall_dict, month12_dict = lastfm_service.fetch_all_user_artists(self.lastfm_user)
        logger.info("")

        for artist in self.artists_without_mbid:
            # Skip if MBID wasn't repaired in Phase 0
            if not artist.mbid:
                continue

            self.current_index += 1
            logger.info(f"[{self.current_index}/{self.total_count}] Processing: {artist.name}")
            logger.info(f"  MBID: {artist.mbid}")

            # Update user-specific playcounts
            if self.user_id:
                playcount, playcount_12month = self.metadata_service.update_user_artist_stats(
                    self.session, self.user_id, artist, overall_dict, month12_dict
                )

                if playcount > 0 or playcount_12month > 0:
                    logger.info(f"  ✓ Updated user playcounts: overall={playcount}, 12-month={playcount_12month}")
                    self.stats['playcounts_updated'] += 1

            # Try to fetch image from fanart.tv if configured
            if self.fanart_available:
                image_url, image_type = self.fanart_service.fetch_artist_image(artist.mbid)

                if image_url:
                    logger.info(f"  ✓ Found image ({image_type}): {image_url[:60]}...")
                    artist.imageUrl = image_url
                    self.stats['images_found'] += 1
                else:
                    logger.info(f"  ✗ No image found on fanart.tv")
                    # Stamp so we don't re-query fanart.tv for this imageless artist
                    # every crawl; retried only after IMAGE_RECHECK_SECONDS.
                    artist.imageCheckedAt = int(time.time())
                    self.stats['images_not_found'] += 1

                # Rate limit fanart.tv API calls
                time.sleep(self.delay)

            self.stats['processed'] += 1

            # Commit after each artist to save progress
            try:
                self.session.commit()
            except Exception as e:
                logger.info(f"  Error saving to database: {e}")
                self.session.rollback()
                self.stats['errors'] += 1

        logger.info("\n")

    def phase_2_fetch_images(self) -> None:
        """
        Phase 2: Fetch images for artists that have MBID but no image.

        Requires Fanart.tv to be configured.
        """
        if not self.artists_with_mbid:
            return

        if not self.fanart_available:
            logger.info("=" * 60)
            logger.info("PHASE 2: Image Fetch SKIPPED")
            logger.info("=" * 60)
            logger.warning(f"Fanart.tv not configured - skipping {len(self.artists_with_mbid)} artists")
            logger.info("   Configure FANART_API_KEY to enable image fetching")
            logger.info("   Get your free API key from: https://fanart.tv/get-an-api-key/\n")
            return

        logger.info("=" * 60)
        logger.info("PHASE 2: Fetching images for artists with MBID")
        logger.info("=" * 60 + "\n")

        for artist in self.artists_with_mbid:
            self.current_index += 1
            logger.info(f"[{self.current_index}/{self.total_count}] Processing: {artist.name}")
            logger.info(f"  MBID: {artist.mbid}")

            # Fetch image from fanart.tv
            image_url, image_type = self.fanart_service.fetch_artist_image(artist.mbid)

            if image_url:
                logger.info(f"  ✓ Found image ({image_type}): {image_url[:60]}...")
                artist.imageUrl = image_url
                self.stats['images_found'] += 1
            else:
                logger.info(f"  ✗ No image found")
                # Stamp so we don't re-query fanart.tv for this imageless artist
                # every crawl; retried only after IMAGE_RECHECK_SECONDS.
                artist.imageCheckedAt = int(time.time())
                self.stats['images_not_found'] += 1

            self.stats['processed'] += 1

            # Commit after each artist to save progress
            try:
                self.session.commit()
            except Exception as e:
                logger.info(f"  Error saving to database: {e}")
                self.session.rollback()
                self.stats['errors'] += 1

            # Rate limiting
            if self.current_index < self.total_count:
                time.sleep(self.delay)

    def phase_3_refresh_playcounts(
        self,
        all_artists: List[Artist],
        limit: Optional[int] = None
    ) -> None:
        """
        Phase 3: Refresh playcounts for all artists (optional).

        Bulk updates playcount statistics from Last.fm for artists
        that weren't processed in Phase 1.

        Args:
            all_artists: All artists to potentially refresh
            limit: Maximum total artists to process
        """
        if not self.lastfm_available:
            logger.info("=" * 60)
            logger.info("PHASE 3: Playcount Refresh SKIPPED")
            logger.info("=" * 60)
            logger.warning("Last.fm not configured - cannot refresh playcounts")
            logger.info("   Configure LASTFM_API_KEY and LASTFM_USER to enable playcount tracking\n")
            return

        logger.info("=" * 60)
        phase_name = "PHASE 3" if self.total_count > 0 else "Refreshing playcounts for all artists"
        logger.info(f"{phase_name}: Refreshing playcounts for all artists")
        logger.info("=" * 60 + "\n")

        # Get all artists that weren't already processed in Phase 1
        artists_for_playcount_refresh = [a for a in all_artists if a not in self.artists_without_mbid]

        if limit and len(artists_for_playcount_refresh) > 0:
            # Adjust for limit if some were already processed
            remaining_limit = limit - self.current_index
            if remaining_limit > 0:
                artists_for_playcount_refresh = artists_for_playcount_refresh[:remaining_limit]
            else:
                artists_for_playcount_refresh = []

        total_to_refresh = len(artists_for_playcount_refresh)
        logger.info(f"Will refresh playcounts for {total_to_refresh} artists\n")

        # Fetch all user artists in bulk (much more efficient - only 2 API calls!)
        lastfm_service = LastFMService(api_key=self.lastfm_api_key)
        overall_dict, month12_dict = lastfm_service.fetch_all_user_artists(self.lastfm_user)
        logger.info("")

        for idx, artist in enumerate(artists_for_playcount_refresh, 1):
            logger.info(f"[{idx}/{total_to_refresh}] Refreshing playcounts: {artist.name}")

            # Update user-specific playcounts using metadata service
            if self.user_id:
                playcount, playcount_12month = self.metadata_service.update_user_artist_stats(
                    self.session, self.user_id, artist, overall_dict, month12_dict
                )

                if playcount > 0 or playcount_12month > 0:
                    logger.info(f"  ✓ Updated user playcounts: overall={playcount}, 12-month={playcount_12month}")
                    self.stats['playcounts_updated'] += 1
                else:
                    logger.info(f"  ✗ No playcount data found")
            else:
                logger.info(f"  ✗ No user-id specified")

        # Commit after each artist to save progress
        try:
            self.session.commit()
        except Exception as e:
            logger.info(f"  Error saving to database: {e}")
            self.session.rollback()
            self.stats['errors'] += 1

        logger.info("\n")

    def print_summary(self) -> None:
        """Print processing summary statistics."""
        logger.info("=" * 60)
        logger.info("SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Artists processed: {self.stats['processed']}")
        logger.info(f"MBIDs fetched: {self.stats['mbid_fetched']}")
        logger.info(f"MBIDs not found: {self.stats['mbid_not_found']}")
        logger.info(f"Playcounts updated: {self.stats['playcounts_updated']}")
        logger.info(f"Images found: {self.stats['images_found']}")
        logger.info(f"Images not found: {self.stats['images_not_found']}")
        logger.info(f"Errors: {self.stats['errors']}")
        logger.info("=" * 60)

def main():
    """
    Main function - orchestrates metadata fetching workflow.

    Parses arguments, loads credentials, initializes services, and
    delegates processing to MetadataProcessor for each phase.
    """
    parser = argparse.ArgumentParser(
        description='Fetch artist metadata (MBID, images, playcounts) from Last.fm and fanart.tv'
    )
    parser.add_argument(
        '--db-path',
        type=str,
        required=False,
        help='Path to SQLite database (optional if DATABASE_URL env var is set)'
    )
    parser.add_argument(
        '--user-id',
        type=int,
        help='User ID for per-user playcount updates (recommended)'
    )
    parser.add_argument(
        '--artist-id',
        type=int,
        help='Process a single artist by ID (e.g. to enrich a newly added artist)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit number of artists to process (for testing)'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Re-fetch images even if already present'
    )
    parser.add_argument(
        '--refresh-playcounts',
        action='store_true',
        help='Refresh playcounts for all artists (even those with MBID and images)'
    )
    parser.add_argument(
        '--delay',
        type=float,
        default=0.25,
        help='Delay in seconds between API calls (default: 0.25)'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Enable verbose logging'
    )
    parser.add_argument(
        '--no-color-log',
        action='store_true',
        help='Disable colored log output (for non-TTY callers)'
    )

    args = parser.parse_args()
    setup_logging(verbose=args.verbose, use_colors=not args.no_color_log)

    # Single-flight: bail if another metadata pass is already running (the worker
    # re-triggers this after every drain; overlapping runs would double MusicBrainz
    # load on the same artists). Released on exit via atexit, covering every return.
    lock_fd = acquire_lock()
    if lock_fd is None:
        logger.info("Another metadata pass is already running — exiting.")
        return 0
    atexit.register(release_lock, lock_fd)

    # Load credentials using centralized loader
    credentials, validation = load_credentials(
        user_id=args.user_id,
        db_path=args.db_path,
        require_lastfm=False,
        require_countries=False
    )

    if validation.is_error():
        validation.log(logger)
        return 1

    # Extract credentials
    lastfm_api_key = credentials.lastfm_api_key
    lastfm_user = credentials.lastfm_user
    fanart_api_key = credentials.fanart_api_key

    # Display configuration info
    if args.user_id:
        logger.info(f"User-specific mode: {credentials.username} (ID: {args.user_id})")
        logger.info(f"Last.fm user: {lastfm_user}")
    else:
        logger.info(f"ℹ️  {validation.message}")
        logger.info("Note: Playcounts will not be saved without --user-id (global mode)")
        logger.info(f"Last.fm user: {lastfm_user}")

    # Check what services are available
    lastfm_available = bool(lastfm_api_key and lastfm_user)
    fanart_available = bool(fanart_api_key)

    # Create service instances
    fanart_service = FanartService(api_key=fanart_api_key) if fanart_available else None
    metadata_service = ArtistMetadataService(
        lastfm_api_key=lastfm_api_key,
        fanart_api_key=fanart_api_key,
        lastfm_user=lastfm_user
    )

    # Display metadata sources status
    logger.info("=" * 60)
    logger.info("METADATA SOURCES STATUS")
    logger.info("=" * 60)
    logger.info(f"Last.fm: {'✓ Configured' if lastfm_available else '✗ Not configured'}")
    logger.info(f"Fanart.tv: {'✓ Configured' if fanart_available else '✗ Not configured'}")
    logger.info(f"MusicBrainz: ✓ Available (no auth required)")
    logger.info("=" * 60 + "\n")

    if not lastfm_available:
        logger.warning("Last.fm not configured - playcount updates will be skipped")
        logger.info("To enable: Configure LASTFM_API_KEY and LASTFM_USER in settings")

    if not fanart_available:
        logger.warning("Fanart.tv not configured - image fetching will be skipped")
        logger.info("To enable: Configure FANART_API_KEY in settings")
        logger.info("Get your free API key from: https://fanart.tv/get-an-api-key/")

    if not lastfm_available and not fanart_available:
        logger.warning("Limited functionality - only MusicBrainz MBID lookups available")
        logger.info("Configure at least one service for full metadata enrichment\n")

    # Connect to database
    try:
        if args.db_path:
            logger.info(f"Connecting to database: {args.db_path}")
        else:
            logger.info(f"Connecting to database via DB_TYPE configuration")
        engine = get_engine(args.db_path)
    except ValueError as e:
        logger.error(f"Error: {e}")
        return 1

    Session = sessionmaker(bind=engine)
    session = Session()

    # Query artists - single artist, per-user, or global (in priority order)
    if args.artist_id:
        all_artists = session.query(Artist).filter(Artist.id == args.artist_id).all()
        if not all_artists:
            logger.info(f"No artist found with ID {args.artist_id}")
            return 0
        logger.info(f"Processing single artist ID {args.artist_id} ({all_artists[0].name})")
    elif args.user_id:
        user_artist_ids = session.query(UserArtist.artistId).filter_by(userId=args.user_id).distinct().all()
        user_artist_ids = [id[0] for id in user_artist_ids]

        if not user_artist_ids:
            logger.info(f"No artists found for user ID {args.user_id}")
            return 0

        all_artists = session.query(Artist).filter(Artist.id.in_(user_artist_ids)).all()
        logger.info(f"Processing {len(all_artists)} artists for user ID {args.user_id}")
    else:
        all_artists = session.query(Artist).all()
        logger.info(f"Processing all {len(all_artists)} artists (no user filter)")

    # Create metadata processor
    processor = MetadataProcessor(
        session=session,
        metadata_service=metadata_service,
        fanart_service=fanart_service,
        lastfm_api_key=lastfm_api_key,
        lastfm_user=lastfm_user,
        user_id=args.user_id,
        delay=args.delay
    )

    # Phase 0: MBID Auto-Repair (always runs)
    processor.phase_0_mbid_repair(all_artists)

    # Categorize artists for processing
    processor.categorize_artists(
        all_artists,
        force=args.force,
        limit=args.limit,
        refresh_playcounts=args.refresh_playcounts
    )

    # Check if there's work to do
    if processor.total_count == 0 and not args.refresh_playcounts:
        logger.info("No artists need processing!")
        return 0

    # Phase 1: Process artists without MBID (playcounts + images)
    processor.phase_1_process_artists_without_mbid()

    # Phase 2: Fetch images for artists with MBID
    processor.phase_2_fetch_images()

    # Phase 3: Refresh playcounts (optional)
    if args.refresh_playcounts:
        processor.phase_3_refresh_playcounts(all_artists, limit=args.limit)

    session.close()

    # Print summary
    processor.print_summary()

    return 0

if __name__ == '__main__':
    exit(main())
