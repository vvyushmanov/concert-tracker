"""
Database configuration and engine factory

DEPRECATED: This module provides backward-compatible imports.
New code should use: from database.config import get_engine
"""

from database.config import get_engine

__all__ = ['get_engine']
