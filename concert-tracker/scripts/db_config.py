#!/usr/bin/env python3
"""
Centralized database configuration module
Provides factory functions for SQLAlchemy engine creation
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

# Load environment variables
load_dotenv()


def get_engine(db_path: str = None, echo: bool = False) -> Engine:
    """
    Get SQLAlchemy engine with automatic database type detection
    
    Priority:
    1. If db_path provided -> SQLite (legacy support for --db-path argument)
    2. If DB_TYPE is set -> Use corresponding environment variable
       - sqlite: SQLITE_DB_PATH
       - mysql: DATABASE_URL
    3. Else -> Error
    
    Args:
        db_path: Optional path to SQLite database file (legacy support)
        echo: If True, log all SQL statements
        
    Returns:
        SQLAlchemy Engine instance
        
    Raises:
        ValueError: If no valid database configuration is found
    """
    # Priority 1: Legacy --db-path argument (SQLite)
    if db_path:
        connection_url = f'sqlite:///{db_path}'
        return create_engine(connection_url, echo=echo)
    
    # Priority 2: DB_TYPE-based configuration
    db_type = os.getenv('DB_TYPE', '').lower()
    
    if db_type == 'sqlite':
        sqlite_path = os.getenv('SQLITE_DB_PATH')
        if not sqlite_path:
            raise ValueError(
                "DB_TYPE is set to 'sqlite' but SQLITE_DB_PATH environment variable is not set. "
                "Please set SQLITE_DB_PATH in your .env file (e.g., SQLITE_DB_PATH=file:/app/data/concerts.db)"
            )
        sqlite_path = sqlite_path.replace('file:', 'sqlite:///')
        print(f"Using SQLite database at {sqlite_path}")
        return create_engine(sqlite_path, echo=echo)
    
    elif db_type == 'mysql':
        database_url = os.getenv('DATABASE_URL')
        if not database_url:
            raise ValueError(
                "DB_TYPE is set to 'mysql' but DATABASE_URL environment variable is not set. "
                "Please set DATABASE_URL in your .env file (e.g., DATABASE_URL=mysql://user:pass@host:3306/db)"
            )
        return create_engine(database_url, echo=echo)
    
    # Priority 3: No configuration found
    raise ValueError(
        "No database configuration found. Please either:\n"
        "  1. Pass db_path argument (for SQLite), or\n"
        "  2. Set DB_TYPE environment variable ('sqlite' or 'mysql') with corresponding:\n"
        "     - SQLITE_DB_PATH for SQLite\n"
        "     - DATABASE_URL for MySQL"
    )


def get_db_type() -> str:
    """Get the configured database type"""
    return os.getenv('DB_TYPE', 'sqlite').lower()


def is_mysql() -> bool:
    """Check if MySQL is configured"""
    return get_db_type() == 'mysql'


def is_sqlite() -> bool:
    """Check if SQLite is configured"""
    return get_db_type() == 'sqlite'


if __name__ == '__main__':
    # Print configuration when run directly
    print(f"DB_TYPE: {get_db_type()}")
    try:
        engine = get_engine()
        print(f"Engine created successfully: {engine.url}")
    except ValueError as e:
        print(f"Error: {e}")
