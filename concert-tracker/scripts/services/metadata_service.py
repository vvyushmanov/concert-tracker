"""
Artist metadata service

Orchestrates fetching artist metadata from Last.fm and Fanart.tv.
Handles MBID repair, image fetching, and playcount updates.
"""

import requests
from typing import Optional, Tuple, Dict, List
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from database.models import Artist, UserArtist
from services.lastfm_service import LastFMService
from services.fanart_service import FanartService


class ArtistMetadataService:
    """Service for fetching and updating artist metadata"""

    def __init__(self, lastfm_api_key: str = None, fanart_api_key: str = None, lastfm_user: str = None):
        """Initialize metadata service

        Args:
            lastfm_api_key: Last.fm API key (optional)
            fanart_api_key: Fanart.tv API key (optional)
            lastfm_user: Last.fm username (optional, for playcount fetching)
        """
        self.lastfm_service = LastFMService(lastfm_api_key) if lastfm_api_key else None
        self.fanart_service = FanartService(fanart_api_key) if fanart_api_key else None
        self.lastfm_user = lastfm_user
        self.musicbrainz_service = None  # Lazy initialization

    def has_lastfm(self) -> bool:
        """Check if Last.fm is configured"""
        return self.lastfm_service is not None and self.lastfm_user is not None

    def has_fanart(self) -> bool:
        """Check if Fanart.tv is configured"""
        return self.fanart_service is not None

    def _get_musicbrainz_service(self):
        """Lazy initialize MusicBrainz service"""
        if self.musicbrainz_service is None:
            from services.musicbrainz_service import MusicBrainzService
            self.musicbrainz_service = MusicBrainzService()
        return self.musicbrainz_service
    
    def repair_mbid(self, artist: Artist, overall_dict: Dict = None, month12_dict: Dict = None) -> Optional[str]:
        """Attempt to find and set MBID for an artist

        Strategy:
            1. Try MusicBrainz first (always available, no auth required)
            2. Fall back to Last.fm if configured and MusicBrainz fails

        Args:
            artist: Artist object
            overall_dict: Pre-fetched overall artist data (optional, from Last.fm)
            month12_dict: Pre-fetched 12-month artist data (optional, from Last.fm)

        Returns:
            MBID if found, None otherwise
        """
        mbid = None
        source = None

        # Primary: Try MusicBrainz first
        try:
            mb_service = self._get_musicbrainz_service()
            mbid = mb_service.get_artist_mbid(artist.name)
            if mbid:
                source = "MusicBrainz"
        except Exception as e:
            print(f"  Warning: MusicBrainz lookup failed for {artist.name}: {e}")

        # Fallback to Last.fm if configured and MusicBrainz failed
        if not mbid and self.has_lastfm():
            # Try lookup from pre-fetched data first
            if overall_dict and month12_dict:
                _, _, mbid = self.lastfm_service.lookup_artist_playcounts(
                    artist.name,
                    None,
                    overall_dict,
                    month12_dict
                )
                if mbid:
                    source = "Last.fm (cached)"

            # Fallback to artist.getinfo API call
            if not mbid:
                artist_info = self.lastfm_service.get_artist_info(artist.name)
                if artist_info:
                    mbid = artist_info.get('mbid')
                    if mbid:
                        source = "Last.fm (API)"

        if mbid and source:
            print(f"  Found MBID for {artist.name} via {source}: {mbid}")

        return mbid
    
    def fetch_artist_image(self, artist: Artist) -> Tuple[Optional[str], Optional[str]]:
        """Fetch artist image from Fanart.tv

        Args:
            artist: Artist object with MBID

        Returns:
            Tuple of (image_url, image_type) or (None, None)
        """
        if not artist.mbid:
            return None, None

        if not self.has_fanart():
            return None, None

        return self.fanart_service.fetch_artist_image(artist.mbid)
    
    def update_artist_metadata(self, session: Session, artist: Artist, 
                              fetch_mbid: bool = True, fetch_image: bool = True,
                              overall_dict: Dict = None, month12_dict: Dict = None) -> Dict:
        """Update artist metadata (MBID and/or image)
        
        Args:
            session: Database session
            artist: Artist object
            fetch_mbid: Whether to fetch MBID if missing
            fetch_image: Whether to fetch image
            overall_dict: Pre-fetched overall artist data (optional)
            month12_dict: Pre-fetched 12-month artist data (optional)
            
        Returns:
            Dict with update results: {'mbid_updated': bool, 'image_updated': bool, 'mbid': str, 'image_url': str}
        """
        result = {
            'mbid_updated': False,
            'image_updated': False,
            'mbid': artist.mbid,
            'image_url': artist.imageUrl
        }
        
        # Fetch MBID if missing and requested
        if fetch_mbid and not artist.mbid:
            mbid = self.repair_mbid(artist, overall_dict, month12_dict)
            if mbid:
                artist.mbid = mbid
                artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                result['mbid_updated'] = True
                result['mbid'] = mbid
        
        # Fetch image if MBID available and requested
        if fetch_image and artist.mbid:
            image_url, image_type = self.fetch_artist_image(artist)
            if image_url:
                artist.imageUrl = image_url
                artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                result['image_updated'] = True
                result['image_url'] = image_url
        
        return result
    
    def update_user_artist_stats(self, session: Session, user_id: int, artist: Artist,
                                 overall_dict: Dict = None, month12_dict: Dict = None) -> Tuple[int, int]:
        """Update or create UserArtist stats for a specific user

        Args:
            session: Database session
            user_id: User ID
            artist: Artist object
            overall_dict: Pre-fetched overall artist data (optional, from Last.fm)
            month12_dict: Pre-fetched 12-month artist data (optional, from Last.fm)

        Returns:
            Tuple of (overall_playcount, playcount_12month)
        """
        # Return zeros if Last.fm not configured
        if not self.has_lastfm():
            print(f"  Skipping playcount update for {artist.name} (Last.fm not configured)")
            return 0, 0

        # Lookup playcounts
        playcount, playcount12month, mbid = self.lastfm_service.lookup_artist_playcounts(
            artist.name,
            artist.mbid,
            overall_dict or {},
            month12_dict or {}
        )

        # Update MBID if discovered during lookup
        if mbid and not artist.mbid:
            artist.mbid = mbid
            artist.updatedAt = int(datetime.now(timezone.utc).timestamp())

        # Update or create UserArtist
        user_artist = session.query(UserArtist).filter_by(
            userId=user_id,
            artistId=artist.id
        ).first()

        if user_artist:
            # Update existing
            user_artist.playcount = playcount
            user_artist.playcount12month = playcount12month
            user_artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
        else:
            # Create new
            user_artist = UserArtist(
                userId=user_id,
                artistId=artist.id,
                playcount=playcount,
                playcount12month=playcount12month,
                recent=False  # Will be updated by parser
            )
            session.add(user_artist)

        return playcount, playcount12month
    
    def bulk_repair_mbids(self, session: Session, artists: List[Artist]) -> int:
        """Bulk repair MBIDs for multiple artists

        Strategy:
            1. Try MusicBrainz bulk fetch first (always available)
            2. Fall back to Last.fm bulk fetch if configured

        Args:
            session: Database session
            artists: List of Artist objects without MBIDs

        Returns:
            Number of MBIDs repaired
        """
        if not artists:
            return 0

        repaired_count = 0

        # Try MusicBrainz bulk fetch first
        try:
            mb_service = self._get_musicbrainz_service()
            artist_names = [a.name for a in artists if not a.mbid]

            if artist_names:
                print(f"  Fetching {len(artist_names)} MBIDs from MusicBrainz...")
                mb_results = mb_service.bulk_fetch_mbids(artist_names)

                for artist in artists:
                    if artist.mbid:
                        continue

                    mbid = mb_results.get(artist.name)
                    if mbid:
                        artist.mbid = mbid
                        artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                        repaired_count += 1

        except Exception as e:
            print(f"  Warning: MusicBrainz bulk fetch failed: {e}")

        # Fall back to Last.fm for artists still missing MBIDs
        if self.has_lastfm():
            artists_still_missing = [a for a in artists if not a.mbid]

            if artists_still_missing:
                print(f"  Fetching remaining {len(artists_still_missing)} MBIDs from Last.fm...")
                overall_dict, month12_dict = self.lastfm_service.fetch_all_user_artists(self.lastfm_user)

                for artist in artists_still_missing:
                    _, _, mbid = self.lastfm_service.lookup_artist_playcounts(
                        artist.name,
                        None,
                        overall_dict,
                        month12_dict
                    )

                    if mbid:
                        artist.mbid = mbid
                        artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                        repaired_count += 1

        return repaired_count
