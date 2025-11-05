"""
External service integrations

Provides API clients for Last.fm, Fanart.tv, HTTP requests, and proxy management.
"""

from services.http_client import HTTPClient
from services.lastfm_service import LastFMService
from services.fanart_service import FanartService
from services.metadata_service import ArtistMetadataService
from services.proxy import ProxyManager

__all__ = [
    'HTTPClient',
    'LastFMService',
    'FanartService',
    'ArtistMetadataService',
    'ProxyManager',
]
