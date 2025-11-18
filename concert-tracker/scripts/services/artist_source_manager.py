"""
Artist Source Manager - Centralized logic for artist filtering sources

Manages multiple artist sources (UserArtist, Last.fm) for concert filtering

PATTERN FOR OPTIONAL LAST.FM USAGE:
====================================

All code that uses Last.fm should follow this pattern:

1. Check if Last.fm is configured via credentials/config
2. If not configured:
   - Log clear warning message
   - Degrade gracefully (use alternative source or skip)
   - Do NOT raise exception (unless require_lastfm=True)
3. If configured but API fails:
   - Log error with actionable message
   - Return empty/default result

Example:
    if credentials.lastfm_api_key:
        try:
            # Use Last.fm
        except Exception as e:
            logger.warning(f"Last.fm unavailable: {e}")
            # Degrade gracefully
    else:
        logger.info("Last.fm not configured, using alternative source")
"""

from typing import Set, Dict, Tuple, Optional
from sqlalchemy.orm import Session

from database.models import Artist, UserArtist
from services.lastfm_service import LastFMService
from utils.validation import is_musicbrainz_id
from utils import get_logger

logger = get_logger(__name__)


class ArtistSourceManager:
    """Manages artist sources for concert filtering

    Supports multiple artist sources:
    - UserArtist table (primary, database-stored artists)
    - Last.fm API (optional, requires API key and username)

    Returns union of all available sources for comprehensive filtering.
    """

    def __init__(
        self,
        session: Session,
        user_id: int,
        lastfm_service: Optional[LastFMService] = None,
        lastfm_user: Optional[str] = None,
        min_playcount: int = 40
    ):
        """Initialize ArtistSourceManager

        Args:
            session: Database session
            user_id: User ID for filtering
            lastfm_service: Optional LastFMService instance
            lastfm_user: Optional Last.fm username
            min_playcount: Last.fm playcount filter (only used if lastfm_service provided)
        """
        self.session = session
        self.user_id = user_id
        self.lastfm_service = lastfm_service
        self.lastfm_user = lastfm_user
        self.min_playcount = min_playcount

    def has_lastfm(self) -> bool:
        """Check if Last.fm source is available"""
        return self.lastfm_service is not None and self.lastfm_user is not None

    def has_user_artist(self) -> bool:
        """Check if UserArtist records exist for this user"""
        count = self.session.query(UserArtist).filter_by(userId=self.user_id).count()
        return count > 0

    def has_any_source(self) -> bool:
        """Check if we have any artist source available"""
        return self.has_user_artist() or self.has_lastfm()

    def get_source_summary(self) -> str:
        """Return human-readable summary of active sources"""
        sources = []

        if self.has_user_artist():
            count = self.session.query(UserArtist).filter_by(userId=self.user_id).count()
            sources.append(f"UserArtist ({count} artists)")

        if self.has_lastfm():
            sources.append(f"Last.fm (min playcount: {self.min_playcount})")

        if not sources:
            return "No artist sources available"

        return " + ".join(sources)

    def fetch_filtering_artists(self) -> Tuple[Set[str], Set[str], Dict[str, int], Dict[str, int], Dict[str, str]]:
        """Fetch artists for concert filtering from available sources

        Returns:
            Tuple of (matches fetch_lastfm_artists() return format):
            - all_artists: Set[str] - Union of UserArtist + Last.fm artists
            - recent_artists: Set[str] - Recently active artists (from Last.fm only)
            - playcounts: Dict[str, int] - Overall playcounts (from Last.fm or 0)
            - playcounts_12month: Dict[str, int] - 12-month playcounts (from Last.fm or 0)
            - artist_mbids: Dict[str, str] - Known MBIDs (from both sources)

        Strategy:
            1. Fetch UserArtist records for user_id
            2. If Last.fm configured: fetch top artists, merge with UserArtist
            3. Return union of both sources
        """
        all_artists: Set[str] = set()
        playcounts: Dict[str, int] = {}
        playcounts_12month: Dict[str, int] = {}
        recent_artists: Set[str] = set()
        artist_mbids: Dict[str, str] = {}

        # Source 1: UserArtist table
        if self.has_user_artist():
            user_artists = (
                self.session.query(UserArtist, Artist)
                .join(Artist, UserArtist.artistId == Artist.id)
                .filter(UserArtist.userId == self.user_id)
                .all()
            )

            logger.info(f"Loaded {len(user_artists)} artists from UserArtist table")

            for user_artist, artist in user_artists:
                all_artists.add(artist.name)

                # Use UserArtist playcounts if available (may be 0 if not from Last.fm)
                if user_artist.playcount:
                    playcounts[artist.name] = user_artist.playcount
                if user_artist.playcount12month:
                    playcounts_12month[artist.name] = user_artist.playcount12month

                # Store MBID if available
                if artist.mbid:
                    artist_mbids[artist.name] = artist.mbid

        # Source 2: Last.fm API (optional)
        if self.has_lastfm():
            logger.info(f"Fetching artists from Last.fm for user: {self.lastfm_user}")

            # Fetch all user artists from Last.fm
            overall_dict, month12_dict = self.lastfm_service.fetch_all_user_artists(self.lastfm_user)

            # Filter by playcount threshold
            # Note: overall_dict has both artist names (lowercase) and MBIDs as keys
            # We only want entries keyed by artist name, not MBID duplicates
            lastfm_artists_filtered = {
                key: data for key, data in overall_dict.items()
                if data.get('playcount', 0) >= self.min_playcount
                and not is_musicbrainz_id(key)  # Exclude MBID keys (UUID format)
            }

            logger.info(f"Loaded {len(lastfm_artists_filtered)} artists from Last.fm (playcount >= {self.min_playcount})")

            for _, artist_data in lastfm_artists_filtered.items():
                # Get the actual artist name from the data
                artist_name = artist_data.get('name')
                if not artist_name:
                    continue
                all_artists.add(artist_name)

                # Update playcounts (overwrite UserArtist values if Last.fm has them)
                playcount = artist_data.get('playcount', 0)
                if playcount > 0:
                    playcounts[artist_name] = playcount

                # Get 12-month playcount
                # Note: month12_dict uses lowercase keys
                playcount_12m = 0
                artist_name_lower = artist_name.lower()
                if artist_name_lower in month12_dict:
                    playcount_12m = month12_dict[artist_name_lower].get('playcount', 0)
                    if playcount_12m > 0:
                        playcounts_12month[artist_name] = playcount_12m
                        # Track recent artists (those with recent plays)
                        recent_artists.add(artist_name)

                # Store MBID if available
                mbid = artist_data.get('mbid')
                if mbid and isinstance(mbid, str):
                    mbid = mbid.strip()
                    if mbid:
                        artist_mbids[artist_name] = mbid

        # Return in same order as fetch_lastfm_artists() for compatibility
        return all_artists, recent_artists, playcounts, playcounts_12month, artist_mbids
