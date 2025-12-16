"""
City normalization module for concert tracker.

Handles text normalization, manual mappings, and geocoding.

This module coordinates:
- Text normalization (via CityTextNormalizer)
- Manual mapping lookups (database)
- Geocoding (via Nominatim API)
- Smart clustering (via Overpass API)
- Database persistence
"""

import re
import time
from typing import Optional, Tuple, Dict
from datetime import datetime, timezone
import requests
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from database.models import CityMapping, CityNormalized
from database.normalizers.country import get_or_create_country
from services.city_text_normalizer import CityTextNormalizer
from utils import get_logger
from utils.geo_distance import haversine_distance

logger = get_logger(__name__)


class CityNormalizer:
    """
    Normalizes city names using hybrid approach.

    Strategy:
    1. Check manual mapping table (database)
    2. Apply text normalization (via CityTextNormalizer)
    3. Use geocoding for unknown cities (with caching)
    4. Smart clustering to nearby larger cities

    The normalizer coordinates between text normalization services,
    geocoding APIs, and database operations to provide consistent
    city name normalization.
    """

    # Configuration
    GEOCODING_ENABLED = True
    GEOCODING_PROVIDER = 'nominatim'
    RATE_LIMIT = 1.1  # requests per second
    TIMEOUT = 10  # seconds (increased from 5s - Nominatim can be slow during peak loads)
    CLUSTER_RADIUS_KM = 35  # cities within this radius are considered same metro area
    MIN_MAJOR_CITY_POPULATION = 400000  # cities above this population won't be clustered
    USER_AGENT = 'concert-tracker/1.0 (vyushmanov lastfm-parser; contact via github.com/vyushmanov)'

    def __init__(self, db_session: Session, verbose: bool = False):
        """
        Initialize normalizer with database session and services.

        Args:
            db_session: SQLAlchemy session for database operations
            verbose: Enable verbose logging for debugging
        """
        self.db = db_session
        self.last_geocode_time = 0
        self.last_overpass_time = 0
        self._geocode_cache = {}  # In-memory cache for current session
        self.verbose = verbose

        # Initialize text normalizer service
        self._text_normalizer = CityTextNormalizer()
        
    def normalize(self, city: str, country: str) -> str:
        """Normalize a city name using hybrid approach
        
        Args:
            city: Original city name (with diacritics, as-is from source)
            country: Country name
            
        Returns:
            Normalized city name
        """
        if not city:
            return city
        
        logger.debug(f"Starting normalization for: '{city}', {country}")

        # Step 1: Check if we already have a mapping for this EXACT original city (preserving diacritics)
        existing_mapping = self._check_manual_mapping(city, country)
        if existing_mapping:
            normalized_city = existing_mapping.city_normalized.normalizedCity if existing_mapping.city_normalized else None
            logger.debug(f"Found {existing_mapping.source} mapping: '{city}' -> '{normalized_city}'")
            return normalized_city
        
        logger.debug("No existing mapping found for original city")

        # Step 2: Apply text normalization (for API requests and normalizedCity field)
        normalized = self._text_normalizer.normalize(city)
        logger.debug(f"Text normalized: '{city}' -> '{normalized}'")

        # Step 3: Try geocoding and clustering
        logger.debug("Attempting geocoding and clustering...")
        geocoded_result = self._geocode_and_cluster(city, country, normalized)
        if geocoded_result:
            logger.debug(f"Geocoding result: '{normalized}' -> '{geocoded_result}'")
            return geocoded_result

        # Step 4: No geocoding result, return text normalized version
        logger.debug(f"No geocoding result, returning text normalized: '{normalized}'")
        return normalized
    
    def _check_manual_mapping(self, city: str, country: str) -> Optional[CityMapping]:
        """Check if city mapping exists in database
        
        Args:
            city: City name to look up
            country: Country name
            
        Returns:
            CityMapping object if found, None otherwise
        """
        # Get country object first
        country_obj = get_or_create_country(self.db, country, verbose=False)
        if not country_obj:
            return None
        
        return self.db.query(CityMapping).filter(
            CityMapping.originalCity == city,
            CityMapping.countryId == country_obj.id
        ).first()
    
    # Text normalization delegated to CityTextNormalizer service
    # See services/city_text_normalizer.py
    
    def _geocode_and_cluster(self, original_city: str, country: str, normalized_text: str) -> Optional[str]:
        """Geocode city and check for nearby cities to cluster
        
        Args:
            original_city: Original city name (with diacritics preserved)
            country: Country name
            normalized_text: Text-normalized city name (for API requests)
            
        Returns:
            Clustered city name if found, None otherwise
        """
        # Check in-memory cache first using ORIGINAL city name to preserve diacritics
        # This ensures "Düsseldorf" and "Dusseldorf" are treated as different cache entries
        cache_key = f"{original_city}|{country}"
        if cache_key in self._geocode_cache:
            cached = self._geocode_cache[cache_key]
            # Mapping already stored when cache was created, just return result
            return cached['normalized']
        
        # Get coordinates and metadata for the city
        metadata = self._geocode_city(normalized_text, country)
        if not metadata:
            logger.debug(f"Could not geocode '{normalized_text}', skipping clustering")
            return None

        lat, lon = metadata['lat'], metadata['lon']
        municipality = metadata.get('municipality')
        current_population = metadata.get('population', 0)

        logger.debug(f"City coordinates: ({lat}, {lon})")
        if current_population > 0:
            logger.debug(f"City population: {current_population:,}")
        
        # Check if this is a major city (should not be clustered to distant cities)
        if current_population >= self.MIN_MAJOR_CITY_POPULATION:
            logger.debug(f"City is major (pop >= {self.MIN_MAJOR_CITY_POPULATION:,}), checking for exact match in DB")

            # For major cities, still check if there's an existing city at the SAME location
            # This handles alternative names (e.g., "Athina" vs "Athens")
            exact_match = self._find_exact_location_match(lat, lon, country)
            if exact_match:
                logger.debug(f"Found existing city at same location: '{exact_match}'")
                self._store_mapping(original_city, country, exact_match, lat, lon, 'geocoded')
                self._geocode_cache[cache_key] = {'normalized': exact_match, 'lat': lat, 'lon': lon}
                return exact_match

            # No exact match, use normalized text
            logger.debug(f"No existing city at this location, using: '{normalized_text}'")
            self._store_mapping(original_city, country, normalized_text, lat, lon, 'geocoded')
            self._geocode_cache[cache_key] = {'normalized': normalized_text, 'lat': lat, 'lon': lon}
            return normalized_text
        
        # SMART CLUSTERING FALLBACK CHAIN (Option C):
        # 1. Check if there's a nearby city in database (prioritize existing knowledge)
        cluster_center = self._find_cluster_center(lat, lon, country, metadata)
        if cluster_center:
            logger.debug(f"Found cluster center in database: '{cluster_center}'")
            self._store_mapping(original_city, country, cluster_center, lat, lon, 'geocoded')
            # Cache the result
            self._geocode_cache[cache_key] = {'normalized': cluster_center, 'lat': lat, 'lon': lon}
            return cluster_center

        # 2. Use Overpass API to find largest nearby city
        largest_nearby = self._find_largest_nearby_city_overpass(lat, lon, country)
        if largest_nearby:
            # Text-normalize the Overpass result
            nearby_normalized = self._text_normalizer.normalize(largest_nearby['name'])

            # If it's the same city (distance <= 1 km), use it directly
            # This prevents falling through to municipality fallback
            if largest_nearby['distance'] <= 1.0:
                logger.debug(f"Overpass confirmed same city: '{nearby_normalized}'")
                self._store_mapping(original_city, country, nearby_normalized,
                                  largest_nearby['lat'], largest_nearby['lon'], 'geocoded')
                self._geocode_cache[cache_key] = {'normalized': nearby_normalized,
                                                 'lat': largest_nearby['lat'], 'lon': largest_nearby['lon']}
                return nearby_normalized

            # Only cluster to a different city if distance > 1 km
            if nearby_normalized != normalized_text:
                logger.debug(f"Using Overpass result: '{normalized_text}' → '{nearby_normalized}'")
                self._store_mapping(original_city, country, nearby_normalized,
                                  largest_nearby['lat'], largest_nearby['lon'], 'geocoded')
                # Cache the result
                self._geocode_cache[cache_key] = {'normalized': nearby_normalized,
                                                 'lat': largest_nearby['lat'], 'lon': largest_nearby['lon']}
                return nearby_normalized

        # 3. Use municipality field as fallback if available and different from current city
        if municipality:
            # Text-normalize the municipality name
            municipality_normalized = self._text_normalizer.normalize(municipality)
            if municipality_normalized != normalized_text:
                logger.debug(f"Using municipality (no nearby cities found): '{normalized_text}' → '{municipality_normalized}'")
                self._store_mapping(original_city, country, municipality_normalized, lat, lon, 'geocoded')
                # Cache the result
                self._geocode_cache[cache_key] = {'normalized': municipality_normalized, 'lat': lat, 'lon': lon}
                return municipality_normalized

        # 4. No clustering needed - this is a standalone city
        logger.debug(f"No nearby city found within {self.CLUSTER_RADIUS_KM} km, '{normalized_text}' is standalone")
        self._store_mapping(original_city, country, normalized_text, lat, lon, 'geocoded')
        # Cache the result
        self._geocode_cache[cache_key] = {'normalized': normalized_text, 'lat': lat, 'lon': lon}
        return normalized_text
    
    def _geocode_city(self, city: str, country: str) -> Optional[Dict]:
        """Get coordinates and metadata for a city using Nominatim API.

        Args:
            city: City name
            country: Country name

        Returns:
            Dict with lat, lon, municipality, population, importance or None if not found
        """
        # Retry logic with exponential backoff
        max_retries = 3
        retry_delay = 2  # seconds

        for attempt in range(max_retries):
            # Rate limiting (apply to all attempts including retries)
            elapsed = time.time() - self.last_geocode_time
            if elapsed < self.RATE_LIMIT:
                logger.debug(f"Rate limiting: waiting {self.RATE_LIMIT - elapsed:.2f}s")
                time.sleep(self.RATE_LIMIT - elapsed)

            try:
                url = 'https://nominatim.openstreetmap.org/search'
                params = {
                    'q': f'{city}, {country}',
                    'format': 'json',
                    'limit': 1,
                    'addressdetails': 1,
                    'extratags': 1
                }
                headers = {
                    'User-Agent': self.USER_AGENT
                }

                if attempt == 0:
                    logger.debug(f"Querying Nominatim: '{city}, {country}'")
                else:
                    logger.warning(f"Retry attempt {attempt + 1}/{max_retries}...")

                response = requests.get(url, params=params, headers=headers, timeout=self.TIMEOUT)
                self.last_geocode_time = time.time()

                if response.status_code == 200:
                    data = response.json()
                    if data:
                        result = data[0]
                        lat, lon = float(result['lat']), float(result['lon'])

                        # Extract metadata for smart clustering
                        address = result.get('address', {})
                        extratags = result.get('extratags', {})

                        municipality = address.get('municipality') or address.get('city')
                        population = extratags.get('population', '0')
                        try:
                            population = int(population)
                        except (ValueError, TypeError):
                            population = 0

                        importance = float(result.get('importance', 0))

                        metadata = {
                            'lat': lat,
                            'lon': lon,
                            'municipality': municipality,
                            'population': population,
                            'importance': importance
                        }

                        logger.debug(f"Found coordinates: {lat}, {lon}")
                        logger.debug(f"Display name: {result.get('display_name', 'N/A')}")
                        if municipality and municipality != city:
                            logger.debug(f"Municipality: {municipality}")
                        if population > 0:
                            logger.debug(f"Population: {population:,}")
                        logger.debug(f"Importance: {importance:.3f}")

                        return metadata
                    else:
                        logger.warning("No results found")
                        return None  # No results, don't retry
                else:
                    logger.error(f"API error: status {response.status_code}")

                    # Retry on server errors (5xx) or rate limiting (429)
                    if response.status_code >= 500 or response.status_code == 429:
                        if attempt < max_retries - 1:
                            wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                            logger.warning(f"Retrying in {wait_time}s...")
                            time.sleep(wait_time)
                            continue
                    return None

            except Exception as e:
                logger.error(f"Geocoding error on attempt {attempt + 1}: {e}")

                # Retry on exceptions (timeouts, connection errors)
                if attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                    logger.warning(f"Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue

                logger.error(f"Geocoding failed for {city}, {country} after {max_retries} attempts: {e}")
                return None

        return None  # All retries failed
    
    def _find_exact_location_match(self, lat: float, lon: float, country: str, threshold_km: float = 1.0) -> Optional[str]:
        """Find if there's an existing city at the exact same location (within threshold)
        
        This handles alternative names for the same city (e.g., "Athina" vs "Athens")
        
        Args:
            lat: Latitude
            lon: Longitude
            country: Country name
            threshold_km: Maximum distance in km to consider "same location" (default 1 km)
            
        Returns:
            Name of existing city if found, None otherwise
        """
        # Get country object first
        country_obj = get_or_create_country(self.db, country, verbose=False)
        if not country_obj:
            return None
        
        # Find all cities in the same country that have coordinates
        existing_cities = self.db.query(CityMapping).filter(
            CityMapping.countryId == country_obj.id,
            CityMapping.latitude.isnot(None),
            CityMapping.longitude.isnot(None)
        ).all()

        logger.debug(f"Checking {len(existing_cities)} existing cities in {country}")

        # Find cities at the same location (within threshold)
        for existing in existing_cities:
            existing_coords = (existing.latitude, existing.longitude)
            distance = haversine_distance(
                lat, lon,
                existing_coords[0], existing_coords[1]
            )

            if distance <= threshold_km:
                normalized = existing.city_normalized.normalizedCity if existing.city_normalized else None
                logger.debug(f"Found existing city at same location: '{normalized}' ({distance:.3f} km away)")
                return normalized

        logger.debug(f"No existing city found within {threshold_km} km")
        return None
    
    def _find_cluster_center(self, lat: float, lon: float, country: str, current_metadata: Dict) -> Optional[str]:
        """Find if there's a larger/more important city nearby that should be the cluster center
        
        Args:
            lat: Latitude
            lon: Longitude
            country: Country name
            current_metadata: Metadata of current city (importance, population)
            
        Returns:
            Name of cluster center city if found, None otherwise
        """
        # Find all cities in the same country that have coordinates
        # Get country object first
        country_obj = get_or_create_country(self.db, country, verbose=False)
        if not country_obj:
            return None
        
        nearby_cities = self.db.query(CityMapping).filter(
            CityMapping.countryId == country_obj.id,
            CityMapping.latitude.isnot(None),
            CityMapping.longitude.isnot(None)
        ).all()

        logger.debug(f"Found {len(nearby_cities)} cities in {country} with coordinates")

        current_importance = current_metadata.get('importance', 0)
        current_population = current_metadata.get('population', 0)

        # Find nearby cities within cluster radius
        candidates = []
        for nearby in nearby_cities:
            nearby_coords = (nearby.latitude, nearby.longitude)
            distance = haversine_distance(
                lat, lon,
                nearby_coords[0], nearby_coords[1]
            )

            if distance <= self.CLUSTER_RADIUS_KM:
                # Get stored metadata for comparison (if available from extratags)
                # For now, we'll cluster to ANY nearby city that was seen first
                # In future, we could store importance/population in CityMapping
                normalized = nearby.city_normalized.normalizedCity if nearby.city_normalized else None
                if normalized:
                    candidates.append({
                        'name': normalized,
                        'distance': distance
                    })

                    logger.debug(f"Found nearby city: '{normalized}' at {distance:.2f} km")

        if candidates:
            # Cluster to the closest city
            # (In future: could prioritize by importance/population if stored in DB)
            closest = min(candidates, key=lambda x: x['distance'])
            logger.debug(f"Clustering to nearest city: '{closest['name']}' ({closest['distance']:.2f} km)")
            return closest['name']
        
        return None
    
    def _find_largest_nearby_city_overpass(self, lat: float, lon: float, country: str) -> Optional[Dict]:
        """Find the largest city within radius using Overpass API
        
        Args:
            lat: Latitude
            lon: Longitude
            country: Country name (for filtering)
            
        Returns:
            Dict with city name, population, lat, lon, or None
        """
        # Convert km to meters for Overpass API
        radius_m = self.CLUSTER_RADIUS_KM * 1000
        
        # Overpass QL query to find cities/towns within radius
        query = f"""
        [out:json][timeout:10];
        (
          node["place"~"city|town"]["name"](around:{radius_m},{lat},{lon});
          way["place"~"city|town"]["name"](around:{radius_m},{lat},{lon});
          relation["place"~"city|town"]["name"](around:{radius_m},{lat},{lon});
        );
        out tags center;
        """
        
        # Retry logic with exponential backoff
        max_retries = 3
        retry_delay = 2  # seconds
        
        for attempt in range(max_retries):
            # Rate limiting (apply to all attempts including retries)
            elapsed = time.time() - self.last_overpass_time
            if elapsed < self.RATE_LIMIT:
                logger.debug(f"Rate limiting: waiting {self.RATE_LIMIT - elapsed:.2f}s")
                time.sleep(self.RATE_LIMIT - elapsed)

            try:
                if attempt == 0:
                    logger.debug(f"Querying for cities within {self.CLUSTER_RADIUS_KM} km...")
                else:
                    logger.debug(f"Retry attempt {attempt + 1}/{max_retries}...")

                url = 'https://overpass-api.de/api/interpreter'
                response = requests.post(url, data={'data': query}, timeout=30)
                self.last_overpass_time = time.time()

                if response.status_code != 200:
                    logger.debug(f"API error: status {response.status_code}")

                    # Retry on server errors (5xx) or rate limiting (429)
                    if response.status_code >= 500 or response.status_code == 429:
                        if attempt < max_retries - 1:
                            wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                            logger.debug(f"Retrying in {wait_time}s...")
                            time.sleep(wait_time)
                            continue
                    return None

                data = response.json()
                elements = data.get('elements', [])

                if not elements:
                    logger.debug("No cities/towns found within radius")
                    return None
                
                # Extract cities with population data
                cities = []
                for elem in elements:
                    tags = elem.get('tags', {})
                    name = tags.get('name')
                    population = tags.get('population', '0')
                    place_type = tags.get('place')  # 'city' or 'town'
                    
                    if not name:
                        continue
                    
                    try:
                        pop = int(population.replace(',', '').replace(' ', ''))
                    except (ValueError, TypeError, AttributeError):
                        pop = 0
                    
                    # Get coordinates (handle different element types)
                    if elem.get('type') == 'node':
                        elem_lat = elem.get('lat')
                        elem_lon = elem.get('lon')
                    elif 'center' in elem:
                        elem_lat = elem['center'].get('lat')
                        elem_lon = elem['center'].get('lon')
                    else:
                        continue
                    
                    if elem_lat and elem_lon:
                        distance = haversine_distance(lat, lon, float(elem_lat), float(elem_lon))
                        
                        cities.append({
                            'name': name,
                            'population': pop,
                            'place_type': place_type,
                            'distance': distance,
                            'lat': float(elem_lat),
                            'lon': float(elem_lon)
                        })
                
                if not cities:
                    logger.debug("No valid cities found")
                    return None

                # Sort by: 1) place_type (city > town), 2) population (desc), 3) distance (asc)
                cities.sort(key=lambda x: (
                    0 if x['place_type'] == 'city' else 1,  # Cities first
                    -x['population'],  # Larger population first
                    x['distance']  # Closer first
                ))

                largest = cities[0]

                logger.debug(f"Found {len(cities)} cities/towns within {self.CLUSTER_RADIUS_KM} km")
                logger.debug(f"Largest: {largest['name']} (pop: {largest['population']:,}, type: {largest['place_type']}, {largest['distance']:.2f} km)")
                if len(cities) > 1:
                    logger.debug(f"Runner-up: {cities[1]['name']} (pop: {cities[1]['population']:,}, {cities[1]['distance']:.2f} km)")

                return largest

            except Exception as e:
                logger.debug(f"Error on attempt {attempt + 1}: {e}")

                # Retry on exceptions
                if attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt)
                    logger.debug(f"Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue

                return None

        return None  # All retries failed

    # Haversine distance calculation delegated to utils.geo_distance
    # See utils/geo_distance.py
    
    def _get_or_create_city_normalized(self, normalized_city: str, country_id: int) -> CityNormalized:
        """Get or create CityNormalized with retry logic for race conditions.

        Args:
            normalized_city: Normalized city name
            country_id: Country ID

        Returns:
            CityNormalized object

        Raises:
            RuntimeError: If unable to create or retrieve after max retries
        """
        max_retries = 3
        now = int(datetime.now(timezone.utc).timestamp())

        for attempt in range(max_retries):
            # Try to get existing
            city_normalized = self.db.query(CityNormalized).filter(
                CityNormalized.normalizedCity == normalized_city,
                CityNormalized.countryId == country_id
            ).first()

            if city_normalized:
                return city_normalized

            # Try to create new
            city_normalized = CityNormalized(
                normalizedCity=normalized_city,
                countryId=country_id,
                createdAt=now,
                updatedAt=now
            )

            try:
                self.db.add(city_normalized)
                self.db.flush()
                return city_normalized
            except IntegrityError:
                self.db.rollback()
                logger.debug(f"Concurrent creation of normalized city '{normalized_city}', attempt {attempt + 1}/{max_retries}")

                if attempt < max_retries - 1:
                    # Small delay before retry to reduce contention
                    time.sleep(0.01 * (attempt + 1))  # 10ms, 20ms, 30ms
                else:
                    # Final attempt - just query
                    city_normalized = self.db.query(CityNormalized).filter(
                        CityNormalized.normalizedCity == normalized_city,
                        CityNormalized.countryId == country_id
                    ).first()

                    if not city_normalized:
                        raise RuntimeError(
                            f"Failed to create or retrieve normalized city '{normalized_city}' "
                            f"after {max_retries} attempts"
                        )

                    return city_normalized

        # Should not reach here, but just in case
        raise RuntimeError(f"Failed to get or create normalized city '{normalized_city}'")

    def _store_mapping(self, original_city: str, country: str, normalized_city: str,
                      latitude: Optional[float], longitude: Optional[float], source: str):
        """Store city mapping in database

        Args:
            original_city: Original city name
            country: Country name
            normalized_city: Normalized city name
            latitude: Latitude (optional)
            longitude: Longitude (optional)
            source: Source of normalization ('manual', 'geocoded', 'text_normalized')
        """
        # Check if mapping already exists
        existing = self._check_manual_mapping(original_city, country)
        if existing:
            return  # Don't overwrite existing mappings

        # Get or create country
        country_obj = get_or_create_country(self.db, country, verbose=self.verbose)
        country_id = country_obj.id if country_obj else None

        now = int(datetime.now(timezone.utc).timestamp())

        # Step 1: Get or create CityNormalized record with retry logic
        city_normalized = self._get_or_create_city_normalized(normalized_city, country_id)
        
        # Step 2: Create CityMapping linked to CityNormalized
        mapping = CityMapping(
            originalCity=original_city,
            countryId=country_id,
            cityNormalizedId=city_normalized.id,
            latitude=latitude,
            longitude=longitude,
            source=source,
            createdAt=now,
            updatedAt=now
        )
        
        try:
            self.db.add(mapping)
            self.db.commit()
        except IntegrityError as e:
            # Duplicate entry - another process/thread already inserted this mapping
            # This is expected in concurrent scenarios, just rollback silently
            self.db.rollback()
            logger.debug(f"Mapping for {original_city}, {country} already exists (concurrent insert)")
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error storing mapping for {original_city}: {e}")
    
    def add_manual_mapping(self, original_city: str, country: str, normalized_city: str,
                          latitude: Optional[float] = None, longitude: Optional[float] = None):
        """Add a manual city mapping
        
        Args:
            original_city: Original city name
            country: Country name
            normalized_city: Normalized city name
            latitude: Latitude (optional)
            longitude: Longitude (optional)
        """
        self._store_mapping(original_city, country, normalized_city, latitude, longitude, 'manual')


def get_or_create_city_mapping(session: Session, original_city: str, country: str, verbose: bool = False) -> Optional[CityMapping]:
    """Get or create a city mapping for the given city and country.
    
    This is the main entry point for getting city mappings. It will:
    1. Check if mapping exists in database
    2. If not, normalize the city name and create a new mapping
    3. Link to CityNormalized table
    
    Args:
        session: SQLAlchemy session
        original_city: Original city name (with diacritics preserved)
        country: Country name
        verbose: Enable verbose logging
        
    Returns:
        CityMapping object or None if country not found
    """
    # Get country object
    country_obj = get_or_create_country(session, country, verbose=verbose)
    if not country_obj:
        return None
    
    # Check if mapping already exists
    existing = session.query(CityMapping).filter(
        CityMapping.originalCity == original_city,
        CityMapping.countryId == country_obj.id
    ).first()
    
    if existing:
        return existing
    
    # Create new mapping using normalizer
    normalizer = CityNormalizer(session, verbose=verbose)
    normalized_city = normalizer.normalize(original_city, country)
    
    # Query again in case normalizer created it
    mapping = session.query(CityMapping).filter(
        CityMapping.originalCity == original_city,
        CityMapping.countryId == country_obj.id
    ).first()
    
    return mapping
