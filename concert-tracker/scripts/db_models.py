"""
SQLAlchemy database models for concert tracker
Matches Prisma schema for Next.js web app
"""

from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Text, UniqueConstraint, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
from datetime import datetime

from db_config import get_engine

Base = declarative_base()


class Artist(Base):
    """Artist model - matches Prisma Artist schema"""
    __tablename__ = 'Artist'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True, nullable=False, index=True)
    playcount = Column(Integer, nullable=False, default=0)
    playcount12month = Column(Integer, nullable=False, default=0)  # Last 12 months playcount
    recent = Column(Boolean, nullable=False, default=False)
    mbid = Column(String, nullable=True)  # MusicBrainz ID
    imageUrl = Column(String, nullable=True)  # Last.fm artist image (large size)
    
    # Relationship
    concerts = relationship('Concert', back_populates='artist', cascade='all, delete-orphan')
    user_stats = relationship('UserArtist', back_populates='artist', cascade='all, delete-orphan')
    
    def __repr__(self):
        return f"<Artist(id={self.id}, name='{self.name}', playcount={self.playcount})>"


class Country(Base):
    """Country model - stores country metadata"""
    __tablename__ = 'Country'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True, nullable=False, index=True)  # Full name: "Turkey", "France"
    code = Column(String, unique=True, nullable=False, index=True)  # ISO code: "tr", "fr"
    active = Column(Boolean, nullable=False, default=False, index=True)  # Whether this country is active for scanning
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))
    user_active_countries = relationship('UserActiveCountry', back_populates='country', cascade='all, delete-orphan')

    def __repr__(self):
        return f"<Country(id={self.id}, name='{self.name}', code='{self.code}', active={self.active})>"


class CityMapping(Base):
    """City mapping model for normalization"""
    __tablename__ = 'CityMapping'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    originalCity = Column(String, nullable=False)
    countryId = Column(Integer, ForeignKey('Country.id'), nullable=False, index=True)  # Now required
    normalizedCity = Column(String, nullable=False, index=True)
    latitude = Column(String, nullable=True)  # Store as string for precision
    longitude = Column(String, nullable=True)  # Store as string for precision
    source = Column(String, nullable=False)  # 'manual', 'geocoded', 'text_normalized'
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))
    
    def __repr__(self):
        return f"<CityMapping('{self.originalCity}' -> '{self.normalizedCity}', countryId={self.countryId})>"


class Concert(Base):
    """Concert model - matches Prisma Concert schema"""
    __tablename__ = 'Concert'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    eventName = Column(String, nullable=False)
    eventUrl = Column(String, nullable=False, unique=True, index=True)  # Unique constraint for upserts
    dateStart = Column(Integer, nullable=False, index=True)  # Unix timestamp
    dateEnd = Column(Integer, nullable=False)  # Unix timestamp
    venue = Column(String, nullable=False)
    city = Column(String, nullable=False, index=True)  # Original city name
    normalizedCity = Column(String, nullable=False, index=True)  # Normalized city name for grouping
    countryId = Column(Integer, ForeignKey('Country.id'), nullable=False, index=True)  # Now required
    postalCode = Column(String, nullable=True)
    performers = Column(Text, nullable=False)  # JSON array stored as text
    imageUrl = Column(String, nullable=True)
    organizer = Column(String, nullable=True)
    organizerUrl = Column(String, nullable=True)
    ticketLinks = Column(Text, nullable=False, default='[]')  # JSON array stored as text
    
    # Foreign key
    artistId = Column(Integer, ForeignKey('Artist.id'), nullable=False, index=True)
    
    # Timestamps (Unix timestamps)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))
    
    # Relationship
    artist = relationship('Artist', back_populates='concerts')
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
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))
    
    def __repr__(self):
        return f"<Setting(key='{self.key}', value='{self.value}', type='{self.valueType}')>"


class User(Base):
    """User model"""
    __tablename__ = 'User'

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    hashedPassword = Column(String(255), nullable=False)
    role = Column(String(10), nullable=False, default='USER', index=True)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))

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
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))

    user = relationship('User', back_populates='settings')

    __table_args__ = (
        UniqueConstraint('userId', 'key', name='uq_usersetting_user_key'),
    )


class UserConcert(Base):
    """User-specific concert interaction data"""
    __tablename__ = 'UserConcert'

    id = Column(Integer, primary_key=True, autoincrement=True)
    userId = Column(Integer, ForeignKey('User.id'), nullable=False, index=True)
    concertId = Column(Integer, ForeignKey('Concert.id'), nullable=False, index=True)
    interested = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))

    user = relationship('User', back_populates='concerts')
    concert = relationship('Concert', back_populates='user_interactions')

    __table_args__ = (
        UniqueConstraint('userId', 'concertId', name='uq_userconcert_user_concert'),
        Index('ix_userconcert_userId', 'userId'),
        Index('ix_userconcert_concertId', 'concertId'),
    )


class UserArtist(Base):
    """User-specific artist metrics"""
    __tablename__ = 'UserArtist'

    id = Column(Integer, primary_key=True, autoincrement=True)
    userId = Column(Integer, ForeignKey('User.id'), nullable=False, index=True)
    artistId = Column(Integer, ForeignKey('Artist.id'), nullable=False, index=True)
    playcount = Column(Integer, nullable=False, default=0)
    playcount12month = Column(Integer, nullable=False, default=0)
    recent = Column(Boolean, nullable=False, default=False)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))

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
    userId = Column(Integer, ForeignKey('User.id'), nullable=False, index=True)
    countryId = Column(Integer, ForeignKey('Country.id'), nullable=False, index=True)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))

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
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))

    user = relationship('User', back_populates='auditLogs')



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
