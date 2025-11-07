"""
City normalization module for concert tracker
Handles text normalization, manual mappings, and geocoding
"""

import re
import time
from typing import Optional, Tuple, Dict
from datetime import datetime, timezone
from unidecode import unidecode
import requests
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from database.models import CityMapping
from database.normalizers.country import get_or_create_country


class CityNormalizer:
    """Normalizes city names using hybrid approach:
    1. Check manual mapping table (database)
    2. Apply text normalization
    3. Use geocoding for unknown cities (with caching)
    """
    
    # Configuration
    GEOCODING_ENABLED = True
    GEOCODING_PROVIDER = 'nominatim'
    RATE_LIMIT = 1.1  # requests per second
    TIMEOUT = 5  # seconds
    CLUSTER_RADIUS_KM = 35  # cities within this radius are considered same metro area
    MIN_MAJOR_CITY_POPULATION = 400000  # cities above this population won't be clustered
    USER_AGENT = 'concert-tracker/1.0 (https://github.com/yourusername/concert-tracker)'
    
    # Text normalization rules
    ABBREVIATIONS = {
        'St.': 'Saint',
        'St ': 'Saint ',
        'Ste.': 'Sainte',
        'Ste ': 'Sainte ',
    }
    
    def __init__(self, db_session: Session, verbose: bool = False):
        """Initialize normalizer with database session
        
        Args:
            db_session: SQLAlchemy session for database operations
            verbose: Enable verbose logging for debugging
        """
        self.db = db_session
        self.last_geocode_time = 0
        self.last_overpass_time = 0
        self._geocode_cache = {}  # In-memory cache for current session
        self.verbose = verbose
        
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
        
        if self.verbose:
            print(f"\n[NORMALIZE] Starting normalization for: '{city}', {country}")
        
        # Step 1: Check if we already have a mapping for this EXACT original city (preserving diacritics)
        existing_mapping = self._check_manual_mapping(city, country)
        if existing_mapping:
            if self.verbose:
                print(f"[NORMALIZE] Found {existing_mapping.source} mapping: '{city}' -> '{existing_mapping.normalizedCity}'")
            return existing_mapping.normalizedCity
        
        if self.verbose:
            print(f"[NORMALIZE] No existing mapping found for original city")
        
        # Step 2: Apply text normalization (for API requests and normalizedCity field)
        normalized = self._normalize_text(city)
        if self.verbose:
            print(f"[NORMALIZE] Text normalized: '{city}' -> '{normalized}'")
        
        # Step 3: Try geocoding and clustering
        if self.verbose:
            print(f"[NORMALIZE] Attempting geocoding and clustering...")
        geocoded_result = self._geocode_and_cluster(city, country, normalized)
        if geocoded_result:
            if self.verbose:
                print(f"[NORMALIZE] Geocoding result: '{normalized}' -> '{geocoded_result}'")
            return geocoded_result
        
        # Step 4: No geocoding result, return text normalized version
        if self.verbose:
            print(f"[NORMALIZE] No geocoding result, returning text normalized: '{normalized}'")
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
    
    def _normalize_text(self, city: str) -> str:
        """Apply text normalization rules
        
        Args:
            city: Original city name
            
        Returns:
            Normalized city name
        """
        # Apply abbreviation replacements
        result = city
        for abbr, full in self.ABBREVIATIONS.items():
            result = result.replace(abbr, full)
        
        # Remove diacritics
        result = unidecode(result)
        
        # Normalize whitespace
        result = re.sub(r'\s+', ' ', result).strip()
        
        # Remove parenthetical suffixes (e.g., "Lyon (Décines-Charpieu)" -> "Lyon")
        # But only if there's content before the parenthesis
        match = re.match(r'^([^(]+?)\s*\([^)]+\)$', result)
        if match:
            result = match.group(1).strip()
        
        # Capitalize properly (Title Case)
        result = result.title()
        
        return result
    
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
            if self.verbose:
                print(f"[CLUSTER] Could not geocode '{normalized_text}', skipping clustering")
            return None
        
        lat, lon = metadata['lat'], metadata['lon']
        municipality = metadata.get('municipality')
        current_population = metadata.get('population', 0)
        
        if self.verbose:
            print(f"[CLUSTER] City coordinates: ({lat}, {lon})")
            if current_population > 0:
                print(f"[CLUSTER] City population: {current_population:,}")
        
        # Check if this is a major city (should not be clustered)
        if current_population >= self.MIN_MAJOR_CITY_POPULATION:
            if self.verbose:
                print(f"[CLUSTER] City is major (pop >= {self.MIN_MAJOR_CITY_POPULATION:,}), will not cluster")
            self._store_mapping(original_city, country, normalized_text, lat, lon, 'geocoded')
            self._geocode_cache[cache_key] = {'normalized': normalized_text, 'lat': lat, 'lon': lon}
            return normalized_text
        
        # SMART CLUSTERING FALLBACK CHAIN (Option C):
        # 1. Check if there's a nearby city in database (prioritize existing knowledge)
        cluster_center = self._find_cluster_center(lat, lon, country, metadata)
        if cluster_center:
            if self.verbose:
                print(f"[CLUSTER] Found cluster center in database: '{cluster_center}'")
            self._store_mapping(original_city, country, cluster_center, lat, lon, 'geocoded')
            # Cache the result
            self._geocode_cache[cache_key] = {'normalized': cluster_center, 'lat': lat, 'lon': lon}
            return cluster_center
        
        # 2. Use Overpass API to find largest nearby city
        largest_nearby = self._find_largest_nearby_city_overpass(lat, lon, country)
        if largest_nearby:
            # Text-normalize the Overpass result
            nearby_normalized = self._normalize_text(largest_nearby['name'])
            
            # If it's the same city (distance <= 1 km), use it directly
            # This prevents falling through to municipality fallback
            if largest_nearby['distance'] <= 1.0:
                if self.verbose:
                    print(f"[CLUSTER] Overpass confirmed same city: '{nearby_normalized}'")
                self._store_mapping(original_city, country, nearby_normalized, 
                                  largest_nearby['lat'], largest_nearby['lon'], 'geocoded')
                self._geocode_cache[cache_key] = {'normalized': nearby_normalized, 
                                                 'lat': largest_nearby['lat'], 'lon': largest_nearby['lon']}
                return nearby_normalized
            
            # Only cluster to a different city if distance > 1 km
            if nearby_normalized != normalized_text:
                if self.verbose:
                    print(f"[CLUSTER] Using Overpass result: '{normalized_text}' → '{nearby_normalized}'")
                self._store_mapping(original_city, country, nearby_normalized, 
                                  largest_nearby['lat'], largest_nearby['lon'], 'geocoded')
                # Cache the result
                self._geocode_cache[cache_key] = {'normalized': nearby_normalized, 
                                                 'lat': largest_nearby['lat'], 'lon': largest_nearby['lon']}
                return nearby_normalized
        
        # 3. Use municipality field as fallback if available and different from current city
        if municipality:
            # Text-normalize the municipality name
            municipality_normalized = self._normalize_text(municipality)
            if municipality_normalized != normalized_text:
                if self.verbose:
                    print(f"[CLUSTER] Using municipality (no nearby cities found): '{normalized_text}' → '{municipality_normalized}'")
                self._store_mapping(original_city, country, municipality_normalized, lat, lon, 'geocoded')
                # Cache the result
                self._geocode_cache[cache_key] = {'normalized': municipality_normalized, 'lat': lat, 'lon': lon}
                return municipality_normalized
        
        # 4. No clustering needed - this is a standalone city
        if self.verbose:
            print(f"[CLUSTER] No nearby city found within {self.CLUSTER_RADIUS_KM} km, '{normalized_text}' is standalone")
        self._store_mapping(original_city, country, normalized_text, lat, lon, 'geocoded')
        # Cache the result
        self._geocode_cache[cache_key] = {'normalized': normalized_text, 'lat': lat, 'lon': lon}
        return normalized_text
    
    def _geocode_city(self, city: str, country: str) -> Optional[Dict]:
        """Get coordinates and metadata for a city using Nominatim API
        
        Args:
            city: City name
            country: Country name
            
        Returns:
            Dict with lat, lon, municipality, population, importance or None if not found
        """
        # Rate limiting
        elapsed = time.time() - self.last_geocode_time
        if elapsed < self.RATE_LIMIT:
            if self.verbose:
                print(f"[GEOCODE] Rate limiting: waiting {self.RATE_LIMIT - elapsed:.2f}s")
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
            
            if self.verbose:
                print(f"[GEOCODE] Querying Nominatim: '{city}, {country}'")
            
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
                    
                    if self.verbose:
                        print(f"[GEOCODE] Found coordinates: {lat}, {lon}")
                        print(f"[GEOCODE] Display name: {result.get('display_name', 'N/A')}")
                        if municipality and municipality != city:
                            print(f"[GEOCODE] Municipality: {municipality}")
                        if population > 0:
                            print(f"[GEOCODE] Population: {population:,}")
                        print(f"[GEOCODE] Importance: {importance:.3f}")
                    
                    return metadata
                else:
                    if self.verbose:
                        print(f"[GEOCODE] No results found")
            else:
                if self.verbose:
                    print(f"[GEOCODE] API error: status {response.status_code}")
            
            return None
            
        except Exception as e:
            print(f"Geocoding error for {city}, {country}: {e}")
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
        
        if self.verbose:
            print(f"[CLUSTER] Found {len(nearby_cities)} cities in {country} with coordinates")
        
        current_importance = current_metadata.get('importance', 0)
        current_population = current_metadata.get('population', 0)
        
        # Find nearby cities within cluster radius
        candidates = []
        for nearby in nearby_cities:
            nearby_coords = (float(nearby.latitude), float(nearby.longitude))
            distance = self._haversine_distance(
                lat, lon,
                nearby_coords[0], nearby_coords[1]
            )
            
            if distance <= self.CLUSTER_RADIUS_KM:
                # Get stored metadata for comparison (if available from extratags)
                # For now, we'll cluster to ANY nearby city that was seen first
                # In future, we could store importance/population in CityMapping
                candidates.append({
                    'name': nearby.normalizedCity,
                    'distance': distance
                })
                
                if self.verbose:
                    print(f"[CLUSTER] Found nearby city: '{nearby.normalizedCity}' at {distance:.2f} km")
        
        if candidates:
            # Cluster to the closest city
            # (In future: could prioritize by importance/population if stored in DB)
            closest = min(candidates, key=lambda x: x['distance'])
            if self.verbose:
                print(f"[CLUSTER] Clustering to nearest city: '{closest['name']}' ({closest['distance']:.2f} km)")
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
            # Rate limiting (only on first attempt, not on retries)
            if attempt == 0:
                elapsed = time.time() - self.last_overpass_time
                if elapsed < self.RATE_LIMIT:
                    if self.verbose:
                        print(f"[OVERPASS] Rate limiting: waiting {self.RATE_LIMIT - elapsed:.2f}s")
                    time.sleep(self.RATE_LIMIT - elapsed)
            
            try:
                if self.verbose:
                    if attempt == 0:
                        print(f"[OVERPASS] Querying for cities within {self.CLUSTER_RADIUS_KM} km...")
                    else:
                        print(f"[OVERPASS] Retry attempt {attempt + 1}/{max_retries}...")
                
                url = 'https://overpass-api.de/api/interpreter'
                response = requests.post(url, data={'data': query}, timeout=30)
                self.last_overpass_time = time.time()
                
                if response.status_code != 200:
                    if self.verbose:
                        print(f"[OVERPASS] API error: status {response.status_code}")
                    
                    # Retry on server errors (5xx) or rate limiting (429)
                    if response.status_code >= 500 or response.status_code == 429:
                        if attempt < max_retries - 1:
                            wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                            if self.verbose:
                                print(f"[OVERPASS] Retrying in {wait_time}s...")
                            time.sleep(wait_time)
                            continue
                    return None
                
                data = response.json()
                elements = data.get('elements', [])
                
                if not elements:
                    if self.verbose:
                        print(f"[OVERPASS] No cities/towns found within radius")
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
                        distance = self._haversine_distance(lat, lon, float(elem_lat), float(elem_lon))
                        
                        cities.append({
                            'name': name,
                            'population': pop,
                            'place_type': place_type,
                            'distance': distance,
                            'lat': float(elem_lat),
                            'lon': float(elem_lon)
                        })
                
                if not cities:
                    if self.verbose:
                        print(f"[OVERPASS] No valid cities found")
                    return None
                
                # Sort by: 1) place_type (city > town), 2) population (desc), 3) distance (asc)
                cities.sort(key=lambda x: (
                    0 if x['place_type'] == 'city' else 1,  # Cities first
                    -x['population'],  # Larger population first
                    x['distance']  # Closer first
                ))
                
                largest = cities[0]
                
                if self.verbose:
                    print(f"[OVERPASS] Found {len(cities)} cities/towns within {self.CLUSTER_RADIUS_KM} km")
                    print(f"[OVERPASS] Largest: {largest['name']} (pop: {largest['population']:,}, type: {largest['place_type']}, {largest['distance']:.2f} km)")
                    if len(cities) > 1:
                        print(f"[OVERPASS] Runner-up: {cities[1]['name']} (pop: {cities[1]['population']:,}, {cities[1]['distance']:.2f} km)")
                
                return largest
                
            except Exception as e:
                if self.verbose:
                    print(f"[OVERPASS] Error on attempt {attempt + 1}: {e}")
                
                # Retry on exceptions
                if attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt)
                    if self.verbose:
                        print(f"[OVERPASS] Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                
                return None
        
        return None  # All retries failed
    
    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two points using Haversine formula
        
        Args:
            lat1, lon1: First point coordinates
            lat2, lon2: Second point coordinates
            
        Returns:
            Distance in kilometers
        """
        from math import radians, sin, cos, sqrt, atan2
        
        R = 6371  # Earth's radius in kilometers
        
        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        
        return R * c
    
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
        
        # Create new mapping
        now = int(datetime.now(timezone.utc).timestamp())
        mapping = CityMapping(
            originalCity=original_city,
            countryId=country_id,
            normalizedCity=normalized_city,
            latitude=str(latitude) if latitude is not None else None,
            longitude=str(longitude) if longitude is not None else None,
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
            if self.verbose:
                print(f"[INFO] Mapping for {original_city}, {country} already exists (concurrent insert)")
        except Exception as e:
            self.db.rollback()
            print(f"Error storing mapping for {original_city}: {e}")
    
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
