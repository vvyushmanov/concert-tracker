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
    
    def __init__(self, lastfm_api_key: str, fanart_api_key: str, lastfm_user: str = None):
        """Initialize metadata service
        
        Args:
            lastfm_api_key: Last.fm API key
            fanart_api_key: Fanart.tv API key
            lastfm_user: Last.fm username (optional, for playcount fetching)
        """
        self.lastfm_service = LastFMService(lastfm_api_key)
        self.fanart_service = FanartService(fanart_api_key)
        self.lastfm_user = lastfm_user
    
    def repair_mbid(self, artist: Artist, overall_dict: Dict = None, month12_dict: Dict = None) -> Optional[str]:
        """Attempt to find and set MBID for an artist
        
        Args:
            artist: Artist object
            overall_dict: Pre-fetched overall artist data (optional)
            month12_dict: Pre-fetched 12-month artist data (optional)
            
        Returns:
            MBID if found, None otherwise
        """
        mbid = None
        
        # Try lookup from pre-fetched data first
        if overall_dict and month12_dict:
            _, _, mbid = self.lastfm_service.lookup_artist_playcounts(
                artist.name,
                None,
                overall_dict,
                month12_dict
            )
        
        # Fallback to artist.getinfo API call
        if not mbid:
            artist_info = self.lastfm_service.get_artist_info(artist.name)
            if artist_info:
                mbid = artist_info.get('mbid')
        
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
            overall_dict: Pre-fetched overall artist data (optional)
            month12_dict: Pre-fetched 12-month artist data (optional)
            
        Returns:
            Tuple of (overall_playcount, playcount_12month)
        """
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
        
        More efficient than individual repairs as it fetches all user artists once.
        
        Args:
            session: Database session
            artists: List of Artist objects without MBIDs
            
        Returns:
            Number of MBIDs repaired
        """
        if not artists or not self.lastfm_user:
            return 0
        
        # Fetch all user artists in bulk
        overall_dict, month12_dict = self.lastfm_service.fetch_all_user_artists(self.lastfm_user)
        
        repaired_count = 0
        for artist in artists:
            if artist.mbid:
                continue
            
            mbid = self.repair_mbid(artist, overall_dict, month12_dict)
            if mbid:
                artist.mbid = mbid
                artist.updatedAt = int(datetime.now(timezone.utc).timestamp())
                repaired_count += 1
        
        return repaired_count
