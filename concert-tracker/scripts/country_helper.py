"""
Country helper functions

DEPRECATED: This module provides backward-compatible imports.
New code should use: from database.normalizers.country import get_or_create_country
"""

from database.normalizers.country import get_or_create_country

__all__ = ['get_or_create_country']
