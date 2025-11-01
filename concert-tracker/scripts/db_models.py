"""
SQLAlchemy database models for concert tracker
Matches Prisma schema for Next.js web app
"""

from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
from datetime import datetime

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
    
    def __repr__(self):
        return f"<Artist(id={self.id}, name='{self.name}', playcount={self.playcount})>"


class CityMapping(Base):
    """City mapping model for normalization"""
    __tablename__ = 'CityMapping'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    originalCity = Column(String, nullable=False)
    country = Column(String, nullable=False)
    normalizedCity = Column(String, nullable=False, index=True)
    latitude = Column(String, nullable=True)  # Store as string for precision
    longitude = Column(String, nullable=True)  # Store as string for precision
    source = Column(String, nullable=False)  # 'manual', 'geocoded', 'text_normalized'
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))
    
    def __repr__(self):
        return f"<CityMapping('{self.originalCity}' -> '{self.normalizedCity}', {self.country})>"


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
    country = Column(String, nullable=False, index=True)
    postalCode = Column(String, nullable=True)
    performers = Column(Text, nullable=False)  # JSON array stored as text
    imageUrl = Column(String, nullable=True)
    organizer = Column(String, nullable=True)
    organizerUrl = Column(String, nullable=True)
    ticketLinks = Column(Text, nullable=False, default='[]')  # JSON array stored as text
    
    # Foreign key
    artistId = Column(Integer, ForeignKey('Artist.id'), nullable=False, index=True)
    
    # User interaction fields
    interested = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    
    # Timestamps (Unix timestamps)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))
    
    # Relationship
    artist = relationship('Artist', back_populates='concerts')
    
    def __repr__(self):
        return f"<Concert(id={self.id}, name='{self.eventName}', date={self.dateStart})>"


def create_database(db_path: str):
    """Create database and tables if they don't exist
    
    Args:
        db_path: Path to SQLite database file
    """
    engine = create_engine(f'sqlite:///{db_path}', echo=False)
    Base.metadata.create_all(engine)
    return engine


def get_session(db_path: str):
    """Get a database session
    
    Args:
        db_path: Path to SQLite database file
        
    Returns:
        SQLAlchemy session
    """
    engine = create_database(db_path)
    Session = sessionmaker(bind=engine)
    return Session()
