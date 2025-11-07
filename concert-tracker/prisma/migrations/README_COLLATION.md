# CityMapping Collation Fix

## Problem
The `CityMapping.originalCity` column was using MySQL's default `utf8mb4_unicode_ci` collation, which is **accent-insensitive**. This caused cities with diacritics to be treated as identical:
- "Düsseldorf" (with umlaut) = "Dusseldorf" (without umlaut)
- "İstanbul" (Turkish İ) = "Istanbul" (regular I)

This prevented the system from creating separate CityMapping records for each variant.

## Solution
Changed `originalCity` column to use `utf8mb4_bin` collation (binary/accent-sensitive).

### Migration Applied
```sql
ALTER TABLE `CityMapping` 
  MODIFY COLUMN `originalCity` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
```

### Files Updated
1. **Database**: `fix_citymapping_collation.sql` (applied to production DB)
2. **Python Model**: `scripts/database/models.py` (added documentation comments)
3. **Test**: `scripts/test_city_e2e.py` (verifies both variants create separate mappings)

## Behavior After Fix

### Database Queries
- `WHERE originalCity = 'Düsseldorf'` → Only matches "Düsseldorf" (exact match)
- `WHERE originalCity = 'Dusseldorf'` → Only matches "Dusseldorf" (exact match)
- Both can coexist in the database with same `normalizedCity = "Dusseldorf"`

### Concert Parser
When scanning concerts:
1. Concert with `city = "Dusseldorf"` → Creates/finds mapping with `originalCity = "Dusseldorf"`
2. Concert with `city = "Düsseldorf"` → Creates/finds mapping with `originalCity = "Düsseldorf"`
3. Both mappings share `normalizedCity = "Dusseldorf"` for grouping

### API Coordinate Lookup
The `/api/map/concerts` endpoint uses a two-tier lookup:
1. **Primary**: Match `concert.city` to `CityMapping.originalCity` (exact match with diacritics)
2. **Fallback**: Match `concert.normalizedCity` to `CityMapping.originalCity` (for old records)

## Why Not Change Prisma Schema?
Prisma doesn't support specifying collation in the schema file. Collation is a database-level concern managed through:
- Raw SQL migrations (this file)
- Database configuration
- Documentation in code comments

## Testing
Run the end-to-end test to verify:
```bash
docker compose -f docker-compose.dev.yml exec web python scripts/test_city_e2e.py
```

Expected: 5/5 tests pass, including verification that both "Dusseldorf" and "Düsseldorf" create separate CityMapping records.

## Notes
- `normalizedCity` keeps `utf8mb4_unicode_ci` collation (doesn't need to preserve diacritics)
- In-memory cache uses `original_city` as key (not `normalized_text`) to avoid collisions
- SQLite (used in tests) doesn't have this issue as it uses binary comparison by default
