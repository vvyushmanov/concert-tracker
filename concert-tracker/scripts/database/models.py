"""
SQLAlchemy database models for concert tracker
Matches Prisma schema for Next.js web app
"""

from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Text, Float, UniqueConstraint, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
from datetime import datetime, timezone

from database.config import get_engine

Base = declarative_base()


class Artist(Base):
    """Artist model - shared artist data (no user-specific fields)"""
    __tablename__ = 'Artist'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True, nullable=False, index=True)
    mbid = Column(String, nullable=True)  # MusicBrainz ID
    imageUrl = Column(String, nullable=True)  # Artist image from fanart.tv or Last.fm
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))
    
    # Relationship
    concerts = relationship('ArtistConcert', back_populates='artist', cascade='all, delete-orphan')
    user_stats = relationship('UserArtist', back_populates='artist', cascade='all, delete-orphan')
    
    def __repr__(self):
        return f"<Artist(id={self.id}, name='{self.name}', mbid={self.mbid})>"


class Country(Base):
    """Country model - stores country metadata"""
    __tablename__ = 'Country'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True, nullable=False, index=True)  # Full name: "Turkey", "France"
    code = Column(String, unique=True, nullable=False, index=True)  # ISO code: "tr", "fr"
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))
    
    normalized_cities = relationship('CityNormalized', back_populates='country', cascade='all, delete-orphan')
    user_active_countries = relationship('UserActiveCountry', back_populates='country', cascade='all, delete-orphan')

    def __repr__(self):
        return f"<Country(id={self.id}, name='{self.name}', code='{self.code}')>"


class CityNormalized(Base):
    """Normalized city model - stores unique normalized city names per country"""
    __tablename__ = 'CityNormalized'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    normalizedCity = Column(String, nullable=False, index=True)
    countryId = Column(Integer, ForeignKey('Country.id'), nullable=False, index=True)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))
    
    # Relationships
    country = relationship('Country', back_populates='normalized_cities')
    city_mappings = relationship('CityMapping', back_populates='city_normalized', cascade='all, delete-orphan')
    
    def __repr__(self):
        return f"<CityNormalized(id={self.id}, normalizedCity='{self.normalizedCity}', countryId={self.countryId})>"


class CityMapping(Base):
    """City mapping model for normalization
    
    Note: In MySQL, originalCity uses utf8mb4_bin collation (binary/accent-sensitive)
    to preserve diacritics. This ensures "Düsseldorf" and "Dusseldorf" are treated
    as distinct cities. See migration: prisma/migrations/fix_citymapping_collation.sql
    """
    __tablename__ = 'CityMapping'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    # Binary collation in MySQL to preserve diacritics (Düsseldorf ≠ Dusseldorf)
    originalCity = Column(String, nullable=False)
    countryId = Column(Integer, ForeignKey('Country.id'), nullable=False, index=True)
    cityNormalizedId = Column(Integer, ForeignKey('CityNormalized.id'), nullable=False, index=True)  # FK to CityNormalized
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    source = Column(String, nullable=False)  # 'manual', 'geocoded', 'text_normalized'
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))
    
    # Relationships
    city_normalized = relationship('CityNormalized', back_populates='city_mappings')
    concerts = relationship('Concert', back_populates='city_mapping', cascade='all, delete-orphan')
    
    def __repr__(self):
        normalized = self.city_normalized.normalizedCity if self.city_normalized else 'None'
        return f"<CityMapping('{self.originalCity}' -> '{normalized}', countryId={self.countryId})>"


class Concert(Base):
    """Concert model - matches Prisma Concert schema"""
    __tablename__ = 'Concert'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    eventName = Column(String, nullable=False)
    eventUrl = Column(String, nullable=False, unique=True, index=True)  # Unique constraint for upserts
    dateStart = Column(Integer, nullable=False, index=True)  # Unix timestamp
    dateEnd = Column(Integer, nullable=False)  # Unix timestamp
    venue = Column(String, nullable=False)
    cityMappingId = Column(Integer, ForeignKey('CityMapping.id'), nullable=False, index=True)  # FK to CityMapping
    countryId = Column(Integer, ForeignKey('Country.id'), nullable=False, index=True)
    postalCode = Column(String, nullable=True)
    performers = Column(Text, nullable=False)  # JSON array stored as text
    imageUrl = Column(String, nullable=True)
    organizer = Column(String, nullable=True)
    organizerUrl = Column(String, nullable=True)
    ticketLinks = Column(Text, nullable=False, default='[]')  # JSON array stored as text
    
    # Timestamps (Unix timestamps)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))
    
    # Relationships
    city_mapping = relationship('CityMapping', back_populates='concerts')
    artists = relationship('ArtistConcert', back_populates='concert', cascade='all, delete-orphan')
    user_interactions = relationship('UserConcert', back_populates='concert', cascade='all, delete-orphan')
    
    def __repr__(self):
        return f"<Concert(id={self.id}, name='{self.eventName}', date={self.dateStart})>"


class Setting(Base):
    """Setting model for configuration management"""
    __tablename__ = 'Setting'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=False)
    valueType = Column(String(20), nullable=False)  # 'string', 'int', 'bool', 'json'
    description = Column(Text, nullable=True)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))
    
    def __repr__(self):
        return f"<Setting(key='{self.key}', value='{self.value}', type='{self.valueType}')>"


class User(Base):
    """User model"""
    __tablename__ = 'User'

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    hashedPassword = Column(String(255), nullable=False)
    role = Column(String(10), nullable=False, default='USER', index=True)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))

    settings = relationship('UserSetting', back_populates='user', cascade='all, delete-orphan')
    concerts = relationship('UserConcert', back_populates='user', cascade='all, delete-orphan')
    artists = relationship('UserArtist', back_populates='user', cascade='all, delete-orphan')
    activeCountries = relationship('UserActiveCountry', back_populates='user', cascade='all, delete-orphan')
    auditLogs = relationship('SettingAuditLog', back_populates='user', cascade='all, delete-orphan')


class UserSetting(Base):
    """Per-user settings"""
    __tablename__ = 'UserSetting'

    id = Column(Integer, primary_key=True, autoincrement=True)
    userId = Column(Integer, ForeignKey('User.id'), nullable=False, index=True)
    key = Column(String(100), nullable=False)
    value = Column(Text, nullable=False)
    valueType = Column(String(20), nullable=False)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))

    user = relationship('User', back_populates='settings')

    __table_args__ = (
        UniqueConstraint('userId', 'key', name='uq_usersetting_user_key'),
    )


class UserConcert(Base):
    """User-specific concert interaction data"""
    __tablename__ = 'UserConcert'

    id = Column(Integer, primary_key=True, autoincrement=True)
    userId = Column(Integer, ForeignKey('User.id'), nullable=False)
    concertId = Column(Integer, ForeignKey('Concert.id'), nullable=False)
    interested = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    isPrivate = Column(Boolean, nullable=False, default=False)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))

    user = relationship('User', back_populates='concerts')
    concert = relationship('Concert', back_populates='user_interactions')

    __table_args__ = (
        UniqueConstraint('userId', 'concertId', name='uq_userconcert_user_concert'),
        Index('ix_userconcert_userId', 'userId'),
        Index('ix_userconcert_concertId', 'concertId'),
        Index('ix_userconcert_isPrivate', 'isPrivate'),
    )


class UserArtist(Base):
    """User-specific artist metrics"""
    __tablename__ = 'UserArtist'

    id = Column(Integer, primary_key=True, autoincrement=True)
    userId = Column(Integer, ForeignKey('User.id'), nullable=False)
    artistId = Column(Integer, ForeignKey('Artist.id'), nullable=False)
    playcount = Column(Integer, nullable=False, default=0)
    playcount12month = Column(Integer, nullable=False, default=0)
    recent = Column(Boolean, nullable=False, default=False)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()), onupdate=lambda: int(datetime.now(timezone.utc).timestamp()))

    user = relationship('User', back_populates='artists')
    artist = relationship('Artist', back_populates='user_stats')

    __table_args__ = (
        UniqueConstraint('userId', 'artistId', name='uq_userartist_user_artist'),
        Index('ix_userartist_userId', 'userId'),
        Index('ix_userartist_artistId', 'artistId'),
    )


class UserActiveCountry(Base):
    """Tracks which countries are active per user"""
    __tablename__ = 'UserActiveCountry'

    id = Column(Integer, primary_key=True, autoincrement=True)
    userId = Column(Integer, ForeignKey('User.id'), nullable=False)
    countryId = Column(Integer, ForeignKey('Country.id'), nullable=False)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))

    user = relationship('User', back_populates='activeCountries')
    country = relationship('Country', back_populates='user_active_countries')

    __table_args__ = (
        UniqueConstraint('userId', 'countryId', name='uq_useractivecountry_user_country'),
        Index('ix_useractivecountry_userId', 'userId'),
        Index('ix_useractivecountry_countryId', 'countryId'),
    )


class SettingAuditLog(Base):
    """Audit trail for global setting changes"""
    __tablename__ = 'SettingAuditLog'

    id = Column(Integer, primary_key=True, autoincrement=True)
    userId = Column(Integer, ForeignKey('User.id'), nullable=False, index=True)
    key = Column(String(100), nullable=False, index=True)
    oldValue = Column(Text, nullable=True)
    newValue = Column(Text, nullable=False)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))

    user = relationship('User', back_populates='auditLogs')


class ArtistConcert(Base):
    """Junction table for many-to-many Artist-Concert relationship"""
    __tablename__ = 'ArtistConcert'

    id = Column(Integer, primary_key=True, autoincrement=True)
    artistId = Column(Integer, ForeignKey('Artist.id'), nullable=False)
    concertId = Column(Integer, ForeignKey('Concert.id'), nullable=False)
    isPrimary = Column(Boolean, nullable=False, default=False)  # True for headliner/main artist
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.now(timezone.utc).timestamp()))

    artist = relationship('Artist', back_populates='concerts')
    concert = relationship('Concert', back_populates='artists')

    __table_args__ = (
        UniqueConstraint('artistId', 'concertId', name='uq_artistconcert_artist_concert'),
        Index('ix_ArtistConcert_artistId', 'artistId'),
        Index('ix_ArtistConcert_concertId', 'concertId'),
        Index('ix_ArtistConcert_isPrimary', 'isPrimary'),
    )

    def __repr__(self):
        return f"<ArtistConcert(artistId={self.artistId}, concertId={self.concertId}, isPrimary={self.isPrimary})>"



def create_database(db_path: str = None):
    """Create database and tables if they don't exist
    
    Args:
        db_path: Path to SQLite database file (for SQLite) or None to use DB_TYPE-based configuration
    """
    engine = get_engine(db_path, echo=False)
    Base.metadata.create_all(engine)
    return engine


def get_session(db_path: str = None):
    """Get a database session
    
    Args:
        db_path: Path to SQLite database file (for SQLite) or None to use DB_TYPE-based configuration
        
    Returns:
        SQLAlchemy session
    """
    engine = create_database(db_path)
    Session = sessionmaker(bind=engine)
    return Session()
