"""
Geographic distance calculation utilities.

Provides functions for calculating distances between geographic coordinates.
"""

from math import radians, sin, cos, sqrt, atan2


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the distance between two points on Earth using the Haversine formula.

    The Haversine formula calculates the great-circle distance between two points
    on a sphere given their longitudes and latitudes.

    Args:
        lat1: Latitude of the first point in degrees
        lon1: Longitude of the first point in degrees
        lat2: Latitude of the second point in degrees
        lon2: Longitude of the second point in degrees

    Returns:
        Distance between the two points in kilometers

    Example:
        >>> # Distance from Paris to London
        >>> haversine_distance(48.8566, 2.3522, 51.5074, -0.1278)
        343.56...
    """
    R = 6371  # Earth's radius in kilometers

    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return R * c
