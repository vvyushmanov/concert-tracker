"""
SQLAlchemy database models for concert tracker

DEPRECATED: This module provides backward-compatible imports.
New code should use: from database.models import ...
"""

# Import everything from new location
from database.models import (
    Artist,
    Concert,
    UserArtist,
    UserConcert,
    User,
    UserSetting,
    UserActiveCountry,
    Country,
    CityMapping,
    SettingAuditLog,
    Setting,
    Base,
    get_session
)

# Re-export for backward compatibility
__all__ = [
    'Artist',
    'Concert',
    'UserArtist',
    'UserConcert',
    'User',
    'UserSetting',
    'UserActiveCountry',
    'Country',
    'CityMapping',
    'SettingAuditLog',
    'Setting',
    'Base',
    'get_session',
]
