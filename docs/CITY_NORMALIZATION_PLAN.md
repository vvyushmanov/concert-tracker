# City Normalization Implementation Plan

## Overview
Normalize city names at scan time to handle variations (case, diacritics) and group metropolitan areas (e.g., Lyon suburbs → Lyon).

## Architecture Decision
**Normalize at scan time** (in Python parser) for:
- Data consistency across all views
- Better performance (no runtime normalization)
- Simpler queries and UI code
- Single source of truth

## Hybrid Approach (Priority Order)

### 1. Manual Mapping Table (Database)
- Check database table for known city mappings
- Handles special cases and metropolitan areas
- User can curate over time
- Fast lookup, no API calls

### 2. Text Normalization
- Case normalization (Istanbul → istanbul)
- Remove diacritics (Würzburg → Wurzburg)
- Standardize punctuation/whitespace
- Handle common abbreviations (St. → Saint)

### 3. Geocoding with Caching
- Use Nominatim (OpenStreetMap) API for unknown cities
- Get lat/lon coordinates
- Cluster cities within ~20-30km radius
- Cache results in database to avoid repeated API calls
- Rate limit: 1 request/second (Nominatim free tier)

### 4. Store Both Names
- `city` - Original name from source (for display)
- `normalized_city` - Normalized name (for grouping/filtering)

## Database Schema Changes

### New Table: `city_mappings`
```prisma
model CityMapping {
  id              Int      @id @default(autoincrement())
  originalCity    String   
  country         String
  normalizedCity  String
  latitude        Float?
  longitude       Float?
  source          String   // 'manual' | 'geocoded' | 'text_normalized'
  createdAt       Int
  updatedAt       Int
  
  @@unique([originalCity, country])
  @@index([normalizedCity, country])
}
```

### Update Table: `concerts`
```prisma
model Concert {
  // ... existing fields ...
  city            String   // Original city name
  normalizedCity  String   // Normalized city name
  // ... rest of fields ...
}
```

## Implementation Steps

### Step 1: Create city_normalizer.py Module
```python
class CityNormalizer:
    def __init__(self, db_session):
        self.db = db_session
        self.geocode_cache = {}
        
    def normalize(self, city: str, country: str) -> str:
        # 1. Check manual mapping table
        # 2. Apply text normalization
        # 3. Use geocoding if needed (with caching)
        # 4. Store result in city_mappings table
        pass
```

### Step 2: Text Normalization Functions
- `normalize_text(city: str) -> str`
  - Convert to lowercase
  - Remove diacritics using `unidecode`
  - Strip extra whitespace
  - Standardize punctuation
  - Handle abbreviations

### Step 3: Geocoding Integration
- `geocode_city(city: str, country: str) -> (lat, lon)`
  - Query Nominatim API
  - Respect rate limits (1 req/sec)
  - Handle errors gracefully
  - Cache results in database

### Step 4: Clustering Logic
- `find_cluster_center(lat: float, lon: float, country: str) -> str`
  - Query existing cities within radius
  - Find largest/most central city
  - Return normalized name

### Step 5: Update db_writer.py
- Import CityNormalizer
- Call normalize() before inserting concerts
- Store both original and normalized city names

### Step 6: Migration Script
- `migrate_normalize_cities.py`
- Process all existing concerts
- Apply normalization retroactively
- Update city_mappings table

## Configuration

### Geocoding Settings
```python
GEOCODING_CONFIG = {
    'enabled': True,
    'provider': 'nominatim',
    'rate_limit': 1.0,  # requests per second
    'timeout': 5,       # seconds
    'cluster_radius_km': 25,
    'user_agent': 'concert-tracker/1.0'
}
```

### Text Normalization Rules
```python
NORMALIZATION_RULES = {
    'case': 'lower',
    'remove_diacritics': True,
    'abbreviations': {
        'St.': 'Saint',
        'St ': 'Saint ',
        # ... more rules
    }
}
```

## Manual Mapping Examples

Initial seed data for `city_mappings`:
```sql
-- Lyon agglomeration
INSERT INTO city_mappings (originalCity, country, normalizedCity, source) VALUES
  ('Lyon (Décines-Charpieu)', 'France', 'Lyon', 'manual'),
  ('Décines-Charpieu', 'France', 'Lyon', 'manual'),
  ('Villeurbanne', 'France', 'Lyon', 'manual');

-- Paris agglomeration
INSERT INTO city_mappings (originalCity, country, normalizedCity, source) VALUES
  ('Saint-Denis', 'France', 'Paris', 'manual'),
  ('Montreuil', 'France', 'Paris', 'manual');
```

## API Integration

### Nominatim (OpenStreetMap)
- **Endpoint**: `https://nominatim.openstreetmap.org/search`
- **Free tier**: 1 request/second
- **No API key required**
- **User-Agent required**

Example query:
```python
params = {
    'city': city,
    'country': country,
    'format': 'json',
    'limit': 1
}
```

## Error Handling

### Geocoding Failures
- Log warning
- Fall back to text normalization only
- Don't block concert import
- Retry later with manual review

### Rate Limiting
- Implement exponential backoff
- Queue cities for batch processing
- Cache aggressively

## Testing Strategy

### Unit Tests
- Text normalization edge cases
- Geocoding mock responses
- Clustering logic

### Integration Tests
- Full normalization pipeline
- Database mapping lookups
- Cache behavior

### Manual Testing
- Known problem cities (Lyon, Istanbul, etc.)
- Edge cases (special characters, multiple countries with same city name)

## Rollout Plan

### Phase 1: Infrastructure (Week 1)
- Create database schema
- Implement text normalization
- Add manual mapping table support

### Phase 2: Geocoding (Week 2)
- Integrate Nominatim API
- Implement caching
- Add clustering logic

### Phase 3: Migration (Week 3)
- Create migration script
- Process existing data
- Validate results

### Phase 4: UI Updates (Week 4)
- Update filters to use normalized_city
- Show original city in display
- Add admin UI for manual mappings

## Monitoring & Maintenance

### Metrics to Track
- Normalization success rate
- Geocoding API usage
- Cache hit rate
- Manual mappings added

### Regular Tasks
- Review geocoding failures
- Add manual mappings for common cases
- Update normalization rules
- Re-normalize after rule changes

## Future Enhancements

### Possible Improvements
- Support for venue-level normalization
- Multi-language city names
- Timezone detection from coordinates
- Distance calculations for "nearby concerts"
- Admin UI for reviewing/editing mappings

## Dependencies

### Python Packages
```
unidecode>=1.3.0      # Diacritic removal
geopy>=2.3.0          # Geocoding wrapper
requests>=2.31.0      # HTTP client
```

### Database
- SQLite (existing)
- Add city_mappings table
- Add index on normalized_city

## Success Criteria

✅ Istanbul/istanbul treated as same city
✅ Würzburg/Wurzburg treated as same city
✅ Lyon suburbs grouped under Lyon
✅ No duplicate cities in filters
✅ Original city names preserved for display
✅ <2 second normalization per city (with cache)
✅ 95%+ normalization success rate
