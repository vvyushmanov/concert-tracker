# City Database Restructuring - Concise Implementation Plan

## General Idea

**Problem:** City data is stored as redundant strings (`city`, `normalizedCity`) in Concert table, causing data duplication and inconsistency.

**Solution:** Normalize city data into proper relational tables with foreign keys:
- `CityNormalized` - Stores unique normalized city names per country
- `CityMapping` - Maps original city names (with diacritics) to normalized cities, includes coordinates
- `Concert` - Links to `CityMapping` via FK only (no string fields)

**Key Principle:** Concert table has NO city string fields - only `cityMappingId` foreign key.

---

## Database Changes

### New Table: CityNormalized
```sql
- id (PK)
- normalizedCity VARCHAR(255)
- countryId (FK to Country)
- UNIQUE(normalizedCity, countryId)
```

### Updated Table: CityMapping
```sql
ADD: cityNormalizedId (FK to CityNormalized)
KEEP: originalCity (utf8mb4_bin collation for diacritics)
KEEP: latitude, longitude
DROP LATER: normalizedCity (string field)
```

### Updated Table: Concert
```sql
ADD: cityMappingId (FK to CityMapping)
DROP LATER: city (string field)
DROP LATER: normalizedCity (string field)
```

### Updated Table: Country
```sql
ADD: normalizedCities relationship
```

---

## Files Requiring Updates (24 files)

### Python Backend (5 files)
1. **`scripts/database/models.py`**
   - Add `CityNormalized` SQLAlchemy model
   - Update `CityMapping` model (add `cityNormalizedId`, keep old fields temporarily)
   - Update `Concert` model (add `cityMappingId`, keep old fields temporarily)
   - Update `Country` model (add `normalized_cities` relationship)

2. **`scripts/database/normalizers/city.py`**
   - Rewrite `get_or_create_city_mapping()` function:
     - Get/create `CityNormalized` first
     - Get/create `CityMapping` linked to `CityNormalized`
     - Return `CityMapping` object

3. **`scripts/database/writer.py`**
   - Update `upsert_concert()`:
     - Use `city_mapping.id` instead of string fields
     - Set `concert.cityMappingId = city_mapping.id`
     - Remove references to `city`/`normalizedCity` strings

4. **`scripts/migrate_city_structure.py`** (NEW)
   - Create `CityNormalized` records from existing data
   - Update `CityMapping.cityNormalizedId`
   - Update `Concert.cityMappingId`
   - Verify all FKs populated

5. **`tests/test_city_e2e.py`**
   - Update to use new structure

### Prisma Schemas (3 files)
6. **`prisma/schema.prisma`**
7. **`prisma/schema.mysql.prisma`**
8. **`prisma/schema.sqlite.prisma`**

All three need:
- Add `CityNormalized` model
- Update `CityMapping` (add `cityNormalizedId?`, keep `normalizedCity` temporarily)
- Update `Concert` (add `cityMappingId?`, keep `city`/`normalizedCity` temporarily)
- Update `Country` (add `normalizedCities` relation)

### API Routes (6 files)

**Standard include pattern:**
```typescript
include: {
  cityMapping: {
    include: {
      cityNormalized: {
        include: { country: true }
      }
    }
  }
}
```

9. **`app/api/concerts/route.ts`**
   - Add `cityMapping` include
   - Update filter: `where.city` → `where.cityMapping = { originalCity: cityName }`

10. **`app/api/concerts/[id]/route.ts`**
    - Add `cityMapping` include

11. **`app/api/stats/route.ts`**
    - Change `groupBy: ['city']` → `groupBy: ['cityMappingId']`
    - Fetch city names via `CityMapping` join

12. **`app/api/map/concerts/route.ts`**
    - Add `cityMapping` include
    - Access coordinates: `concert.cityMapping.latitude/longitude`

13. **`app/countries/[country]/page.tsx`**
    - Add `cityMapping` include
    - Update grouping logic to use `cityMapping.cityNormalized.normalizedCity`

14. **`app/calendar/page.tsx`**
    - Add `cityMapping` include

### Frontend Components (10 files)

**Type definition changes:**
```typescript
// REMOVE:
city: string;
normalizedCity: string;

// ADD:
cityMapping: {
  id: number;
  originalCity: string;
  latitude: number | null;
  longitude: number | null;
  cityNormalized: {
    id: number;
    normalizedCity: string;
    country: { id: number; name: string; code: string; };
  };
};
```

**Display pattern:**
```typescript
// Display: concert.cityMapping.originalCity
// Grouping: concert.cityMapping.cityNormalized.normalizedCity
// Coordinates: concert.cityMapping.latitude/longitude
```

15. **`app/page.tsx`** - Add `cityMapping` include in Prisma query

16. **`app/ConcertGrid.tsx`**
    - Update Concert type (line 15)
    - Replace `concert.city` → `concert.cityMapping.originalCity`

17. **`app/concerts/[id]/page.tsx`**
    - Add `cityMapping` include
    - Update display

18. **`app/artists/[id]/ArtistConcerts.tsx`**
    - Update Concert type
    - Update display

19. **`app/countries/page.tsx`**
    - Add `cityMapping` include
    - Update grouping logic

20. **`app/countries/[country]/CountryConcerts.tsx`**
    - Update Concert type (lines 15-16)
    - Replace `concert.city` → `concert.cityMapping.originalCity`
    - Replace `concert.normalizedCity` → `concert.cityMapping.cityNormalized.normalizedCity`
    - Update grouping

21. **`app/calendar/CalendarView.tsx`**
    - Update Concert type (lines 14-15)
    - Replace city field references

22. **`app/map/ConcertMap.tsx`**
    - Update to use `concert.cityMapping.latitude/longitude`

23. **`app/types/map.ts`** (if exists)
    - Update Concert type definition

24. **Any other components** that reference `concert.city` or `concert.normalizedCity`

---

## Implementation Summary

**7 Phases:**
1. **Schema Changes** - Add new tables/columns (keep old fields)
2. **Data Migration** - Populate new FKs from existing data
3. **Python Backend** - Update to use new structure
4. **API Routes** - Add includes, update filters/grouping
5. **Frontend** - Update types and display logic
6. **Testing** - Verify all functionality works
7. **Cleanup** - Drop old columns after verification

**Migration Strategy:** Add → Migrate → Update Code → Drop (safe, reversible)

---

## Quick Reference

### Prisma Include Pattern
```typescript
include: {
  cityMapping: {
    include: {
      cityNormalized: {
        include: { country: true }
      }
    }
  }
}
```

### Access Patterns
```typescript
// Display city name
concert.cityMapping.originalCity

// Group by normalized city
concert.cityMapping.cityNormalized.normalizedCity

// Get coordinates
concert.cityMapping.latitude
concert.cityMapping.longitude

// Get country
concert.cityMapping.cityNormalized.country.name
```

### Python Backend Pattern
```python
# Get/create city mapping
city_mapping = get_or_create_city_mapping(session, original_city, country)

# Link to concert
concert.cityMappingId = city_mapping.id
```

---

## Notes

- **Collation:** `CityMapping.originalCity` uses `utf8mb4_bin` (accent-sensitive)
- **Coordinates:** Fetched on first CityMapping creation
- **Grouping:** Always use `cityNormalized.normalizedCity` for grouping
- **Display:** Always use `cityMapping.originalCity` for display
- **No string fields:** Concert table has NO city string fields after migration

See `CITY_RESTRUCTURING_PLAN.md` for detailed step-by-step implementation guide.
