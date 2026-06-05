#!/usr/bin/env python3
"""
Centralized database configuration.

MySQL is the only deployed backend (via DATABASE_URL). The optional db_path
argument creates a throwaway SQLite engine for isolated tests / scratch runs.
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from utils import get_logger

logger = get_logger(__name__)

# Load environment variables
load_dotenv()


def get_engine(db_path: str = None, echo: bool = False) -> Engine:
    """
    Create a SQLAlchemy engine.

    Priority:
    1. db_path given -> SQLite scratch DB (the --db-path argument, used by tests)
    2. else          -> MySQL via DATABASE_URL (the deployed backend)

    Args:
        db_path: Optional path to a SQLite file (test/scratch only).
        echo: If True, log all SQL statements.

    Returns:
        SQLAlchemy Engine instance.

    Raises:
        ValueError: If neither db_path nor DATABASE_URL is available.
    """
    # Priority 1: explicit SQLite scratch DB (tests pass --db-path)
    if db_path:
        return create_engine(f'sqlite:///{db_path}', echo=echo)

    # Priority 2: MySQL via DATABASE_URL (the only deployed backend)
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise ValueError(
            "No database configuration found. Set DATABASE_URL "
            "(e.g. mysql://user:pass@host:3306/db), or pass db_path for a SQLite scratch DB."
        )
    # Use the PyMySQL driver with SSL disabled (safe on the Docker internal network).
    if database_url.startswith('mysql://'):
        database_url = database_url.replace('mysql://', 'mysql+pymysql://', 1)
    return create_engine(database_url, echo=echo, connect_args={'ssl_disabled': True})


if __name__ == '__main__':
    # Print configuration when run directly
    try:
        engine = get_engine()
        logger.info(f"Engine created successfully: {engine.url}")
    except ValueError as e:
        logger.error(f"Error: {e}")
