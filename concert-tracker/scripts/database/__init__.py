"""
Database layer for concert tracker

Provides models, database writer, configuration, and normalizers.
"""

# Core database models
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

# Database writer
from database.writer import ConcertDatabaseWriter

# Database configuration
from database.config import get_engine

# Normalizers
from database.normalizers.city import CityNormalizer
from database.normalizers.country import get_or_create_country

__all__ = [
    # Models
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
    # Writer
    'ConcertDatabaseWriter',
    # Config
    'get_engine',
    # Normalizers
    'CityNormalizer',
    'get_or_create_country',
]
