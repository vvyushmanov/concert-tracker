# City Database Restructuring - Complete Implementation Guide

## Overview

Restructure city data into normalized tables with proper foreign key relationships, eliminating redundant string fields.

## Final Structure

```
CityNormalized
├── id (PK)
├── normalizedCity (unique per country)
├── countryId (FK to Country)
└── UNIQUE(normalizedCity, countryId)

CityMapping
├── id (PK)
├── originalCity (with diacritics, utf8mb4_bin)
├── cityNormalizedId (FK to CityNormalized)
├── latitude
├── longitude
└── UNIQUE(originalCity, cityNormalizedId)

Concert
├── id (PK)
├── cityMappingId (FK to CityMapping) - ONLY FK, no string field
└── ... other fields
```

**Key Principle:** Concert has NO `city` or `normalizedCity` string fields - only `cityMappingId` FK.

---

## Complete File List

### Python Files (8 files)
1. `scripts/database/models.py` - Add CityNormalized model, update CityMapping & Concert
2. `scripts/database/writer.py` - Update upsert_concert() to use cityMappingId
3. `scripts/database/normalizers/city.py` - Update get_or_create_city_mapping()
4. `scripts/migrate_city_structure.py` - NEW migration script
5. `tests/test_city_e2e.py` - Update tests

### Prisma Schemas (3 files)
6. `prisma/schema.prisma`
7. `prisma/schema.mysql.prisma`
8. `prisma/schema.sqlite.prisma`

### API Routes (6 files)
9. `app/api/concerts/route.ts` - Update includes & filters
10. `app/api/concerts/[id]/route.ts` - Update includes
11. `app/api/stats/route.ts` - Group by cityMappingId
12. `app/api/map/concerts/route.ts` - Update includes & coordinate access
13. `app/countries/[country]/page.tsx` - Update grouping logic
14. `app/calendar/page.tsx` - Update includes

### Frontend Components (10+ files)
15. `app/page.tsx` - Update concert includes
16. `app/ConcertGrid.tsx` - Update Concert type (line 15), access concert.cityMapping.originalCity
17. `app/concerts/[id]/page.tsx` - Update includes & display
18. `app/artists/[id]/ArtistConcerts.tsx` - Update display
19. `app/countries/page.tsx` - Update grouping
20. `app/countries/[country]/CountryConcerts.tsx` - Update Concert type (lines 15-16), grouping & display
21. `app/calendar/CalendarView.tsx` - Update Concert type (lines 14-15), display
22. `app/map/ConcertMap.tsx` - Update coordinate access
23. `app/types/map.ts` - Update Concert type (if exists)

---

## Migration Strategy Summary

**Key Principle:** Add new fields first, migrate data, then remove old fields.

### Why This Approach?

1. **Safety:** Old fields remain until migration is verified
2. **Rollback:** Can revert code changes without data loss
3. **Testing:** Can test new structure while old structure still works
4. **Collation:** Must be applied via raw SQL (Prisma doesn't support it)

### Migration Steps Overview

1. **Phase 1:** Add new tables/columns (nullable), keep old fields
2. **Phase 2:** Run data migration script to populate new fields
3. **Phase 3-6:** Update code to use new structure (old fields ignored)
4. **Phase 7:** Drop old columns after everything works

### Critical Files to Create/Edit

1. **Prisma Migrations** (generated, then edited):
   - `prisma/migrations/YYYYMMDDHHMMSS_add_city_normalized_tables/migration.sql` - Add collation SQL
   - `prisma/migrations/YYYYMMDDHHMMSS_make_city_fks_required/migration.sql` - Auto-generated
   - `prisma/migrations/YYYYMMDDHHMMSS_drop_old_city_columns/migration.sql` - Add DROP COLUMN SQL

2. **Python Script:**
   - `scripts/migrate_city_structure.py` - Data migration script

---

## Phase 1: Database Schema Changes

### Step 1.1: Update Prisma Schemas (Add New Fields ONLY)

**DO NOT remove old fields yet!** Add new tables and columns alongside existing ones.

**Update all 3 schema files:**
- `prisma/schema.prisma`
- `prisma/schema.mysql.prisma`
- `prisma/schema.sqlite.prisma`

```prisma
// NEW MODEL
model CityNormalized {
  id             Int            @id @default(autoincrement())
  normalizedCity String         @db.VarChar(255)
  countryId      Int
  country        Country        @relation(fields: [countryId], references: [id])
  cityMappings   CityMapping[]
  
  @@unique([normalizedCity, countryId])
  @@index([countryId])
}

// UPDATED - Add new fields, KEEP old fields
model CityMapping {
  id                Int             @id @default(autoincrement())
  originalCity      String          @db.VarChar(255)
  normalizedCity    String          @db.VarChar(255)  // KEEP for now
  cityNormalizedId  Int?            // NEW - nullable for migration
  cityNormalized    CityNormalized? @relation(fields: [cityNormalizedId], references: [id])
  latitude          Float?
  longitude         Float?
  concerts          Concert[]
  
  @@unique([originalCity, normalizedCity])  // Keep old constraint
  @@index([cityNormalizedId])
}

// UPDATED - Add new field, KEEP old fields
model Concert {
  id              Int          @id @default(autoincrement())
  name            String       @db.VarChar(255)
  venue           String       @db.VarChar(255)
  city            String       @db.VarChar(255)  // KEEP for now
  normalizedCity  String       @db.VarChar(255)  // KEEP for now
  cityMappingId   Int?         // NEW - nullable for migration
  cityMapping     CityMapping? @relation(fields: [cityMappingId], references: [id])
  countryId       Int
  // ... other fields
  
  @@index([cityMappingId])
  @@index([countryId])
}

// UPDATED - Add relation
model Country {
  id                Int               @id @default(autoincrement())
  name              String            @db.VarChar(255)
  code              String            @db.VarChar(2)
  concerts          Concert[]
  normalizedCities  CityNormalized[]  // NEW
  activeForUsers    UserActiveCountry[]
  
  @@unique([code])
}
```

### Step 1.2: Create Migration

**Create migration (don't apply yet):**

```bash
# Create migration without applying
docker compose -f docker-compose.dev.yml exec web npx prisma migrate dev --create-only --name add_city_normalized_tables
```

This creates: `prisma/migrations/YYYYMMDDHHMMSS_add_city_normalized_tables/migration.sql`

### Step 1.3: Verify/Update Collation in Migration (MySQL Only)

**Check the generated migration file:**

`prisma/migrations/YYYYMMDDHHMMSS_add_city_normalized_tables/migration.sql`

The `CityMapping` table should already have `utf8mb4_bin` collation on `originalCity` from the previous collation fix. If you're starting fresh or it's missing, the migration file should look like:

```sql
-- CreateTable
CREATE TABLE `CityNormalized` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `normalizedCity` VARCHAR(255) NOT NULL,
    `countryId` INTEGER NOT NULL,
    -- indexes and constraints...
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable (adds new columns to CityMapping)
ALTER TABLE `CityMapping` 
  ADD COLUMN `cityNormalizedId` INTEGER NULL;

-- AlterTable (adds new column to Concert)
ALTER TABLE `Concert` 
  ADD COLUMN `cityMappingId` INTEGER NULL;

-- ... other generated statements ...
```

**Note:** If `CityMapping.originalCity` doesn't already have `utf8mb4_bin` collation, add this at the end:

```sql
-- Ensure originalCity uses accent-sensitive collation
ALTER TABLE `CityMapping` 
  MODIFY COLUMN `originalCity` VARCHAR(255) 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_bin 
  NOT NULL;
```

**Why check?** The collation fix should already be in place from the previous migration. This is just a safety check.

### Step 1.4: Apply Migration

```bash
# Apply the migration (includes collation change)
docker compose -f docker-compose.dev.yml exec web npx prisma migrate deploy

# Generate Prisma client
docker compose -f docker-compose.dev.yml exec web npx prisma generate
```

**Result:** New tables/columns added with correct collation, old fields still exist.

---

## Phase 2: Data Migration

### Step 2.1: Update SQLAlchemy Models

**File:** `scripts/database/models.py`

Add `CityNormalized` model and update relationships. **Keep old fields in Concert and CityMapping models** for migration script to work.

```python
class CityNormalized(Base):
    __tablename__ = 'CityNormalized'
    id = Column(Integer, primary_key=True)
    normalizedCity = Column(String(255), nullable=False)
    countryId = Column(Integer, ForeignKey('Country.id'), nullable=False)
    country = relationship('Country', back_populates='normalized_cities')
    city_mappings = relationship('CityMapping', back_populates='city_normalized')
    __table_args__ = (
        UniqueConstraint('normalizedCity', 'countryId'),
        Index('ix_CityNormalized_countryId', 'countryId'),
    )

class CityMapping(Base):
    __tablename__ = 'CityMapping'
    id = Column(Integer, primary_key=True)
    originalCity = Column(String(255), nullable=False)
    normalizedCity = Column(String(255), nullable=False)  # KEEP
    cityNormalizedId = Column(Integer, ForeignKey('CityNormalized.id'), nullable=True)  # Nullable
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    city_normalized = relationship('CityNormalized', back_populates='city_mappings')
    concerts = relationship('Concert', back_populates='city_mapping')

class Concert(Base):
    __tablename__ = 'Concert'
    id = Column(Integer, primary_key=True)
    # ... other fields
    city = Column(String(255), nullable=False)  # KEEP
    normalizedCity = Column(String(255), nullable=False)  # KEEP
    cityMappingId = Column(Integer, ForeignKey('CityMapping.id'), nullable=True)  # Nullable
    city_mapping = relationship('CityMapping', back_populates='concerts')
```

### Step 2.2: Create Migration Script

**File:** `scripts/migrate_city_structure.py`

The script will:
1. Extract unique `(normalizedCity, countryId)` from existing `CityMapping` table
2. Create `CityNormalized` records
3. Update `CityMapping.cityNormalizedId` to link to `CityNormalized`
4. For each concert:
   - Find or create `CityMapping` based on `(concert.city, concert.normalizedCity, concert.countryId)`
   - Set `concert.cityMappingId`
5. Verify all concerts have `cityMappingId` set
6. Report any issues

**Run migration:**
```bash
# Dry run first (preview changes)
docker compose -f docker-compose.dev.yml exec web python scripts/migrate_city_structure.py --dry-run --verbose

# Apply migration
docker compose -f docker-compose.dev.yml exec web python scripts/migrate_city_structure.py --verbose
```

### Step 2.3: Verification Queries

After migration, verify data integrity:

```sql
-- Check all concerts have cityMappingId
SELECT COUNT(*) FROM Concert WHERE cityMappingId IS NULL;
-- Should return 0

-- Check all CityMapping have cityNormalizedId
SELECT COUNT(*) FROM CityMapping WHERE cityNormalizedId IS NULL;
-- Should return 0

-- Check data consistency
SELECT 
  c.id, c.city, c.normalizedCity, 
  cm.originalCity, cn.normalizedCity as normalized
FROM Concert c
JOIN CityMapping cm ON c.cityMappingId = cm.id
JOIN CityNormalized cn ON cm.cityNormalizedId = cn.id
LIMIT 10;
-- Verify city names match
```

---

## Phase 3: Python Backend

### Update `scripts/database/normalizers/city.py`:
```python
def get_or_create_city_mapping(session, original_city: str, country, verbose=False):
    # 1. Normalize city name
    # 2. Get/create CityNormalized
    # 3. Get/create CityMapping
    # 4. Return CityMapping object
```

### Update `scripts/database/writer.py`:
```python
def upsert_concert(self, concert_data, country):
    city_mapping = get_or_create_city_mapping(
        self.session, concert_data['city'], country, self.verbose
    )
    concert.cityMappingId = city_mapping.id
```

---

## Phase 4: API Routes

### Standard Prisma Include Pattern:
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

### Access Pattern:
```typescript
concert.cityMapping.originalCity           // Display name
concert.cityMapping.cityNormalized.normalizedCity  // For grouping
concert.cityMapping.latitude/longitude     // Coordinates
```

### Files to Update:
- `app/api/concerts/route.ts` - Filter by `cityMapping.originalCity`
- `app/api/concerts/[id]/route.ts` - Add includes
- `app/api/stats/route.ts` - Group by `cityMappingId`
- `app/api/map/concerts/route.ts` - Add includes, extract coordinates
- `app/countries/[country]/page.tsx` - Group by normalized city
- `app/calendar/page.tsx` - Add includes

---

## Phase 5: Frontend Components

### Type Definition:
```typescript
type Concert = {
  id: number;
  name: string;
  venue: string;
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
  // ... other fields
};
```

### Display Pattern:
```typescript
// Display city name
{concert.cityMapping.originalCity}

// Group by normalized city
const grouped = concerts.reduce((acc, concert) => {
  const key = concert.cityMapping.cityNormalized.normalizedCity;
  if (!acc[key]) acc[key] = [];
  acc[key].push(concert);
  return acc;
}, {});

// Map coordinates
const lat = concert.cityMapping.latitude;
const lon = concert.cityMapping.longitude;
```

### Files to Update:

**Type Definitions (in each component):**
- `app/ConcertGrid.tsx` - Line 15: `city: string` → remove, add `cityMapping` object
- `app/calendar/CalendarView.tsx` - Lines 14-15: Remove `city` and `normalizedCity`, add `cityMapping`
- `app/countries/[country]/CountryConcerts.tsx` - Lines 15-16: Remove `city` and `normalizedCity`, add `cityMapping`
- `app/artists/[id]/ArtistConcerts.tsx` - Check for `city` field in type
- `app/concerts/[id]/page.tsx` - Check for `city` field in type
- `app/map/ConcertMap.tsx` - Update to use `cityMapping.latitude/longitude`
- `app/types/map.ts` - Update Concert type if centralized type exists

**Display Updates:**
- Replace all `concert.city` with `concert.cityMapping.originalCity`
- Replace all `concert.normalizedCity` with `concert.cityMapping.cityNormalized.normalizedCity`
- Update grouping logic to use `concert.cityMapping.cityNormalized.normalizedCity`

**Server Components (Prisma queries):**
- `app/page.tsx` - Add `cityMapping` include
- `app/concerts/[id]/page.tsx` - Add `cityMapping` include
- `app/artists/[id]/page.tsx` - Add `cityMapping` include
- `app/countries/page.tsx` - Add `cityMapping` include, update grouping
- `app/countries/[country]/page.tsx` - Add `cityMapping` include
- `app/calendar/page.tsx` - Add `cityMapping` include

---

## Phase 6: Testing

### Test Scenarios:
1. New city (creates both CityNormalized + CityMapping)
2. Existing normalized city, new original (creates only CityMapping)
3. Existing city mapping (reuses)
4. City with diacritics (separate CityMapping, same CityNormalized)
5. Grouping by normalized city works
6. Map displays correct coordinates
7. All pages display city names correctly

### Update Test File:
- `tests/test_city_e2e.py` - Update to use new structure

---

## Phase 7: Cleanup (Drop Old Columns)

**⚠️ CRITICAL: Only proceed after ALL phases 1-6 are complete and verified!**

### Step 7.1: Make Fields Non-Nullable

First, ensure all new FK fields are populated:

```sql
-- Verify no NULL values
SELECT COUNT(*) FROM Concert WHERE cityMappingId IS NULL;
SELECT COUNT(*) FROM CityMapping WHERE cityNormalizedId IS NULL;
-- Both should return 0
```

**Update Prisma schemas** to make fields non-nullable:
```prisma
model CityMapping {
  cityNormalizedId  Int             // Remove ? (was Int?)
  cityNormalized    CityNormalized  // Remove ? (was CityNormalized?)
}

model Concert {
  cityMappingId   Int          // Remove ? (was Int?)
  cityMapping     CityMapping  // Remove ? (was CityMapping?)
}
```

**Apply:**
```bash
# Create migration
docker compose -f docker-compose.dev.yml exec web npx prisma migrate dev --create-only --name make_city_fks_required
```

Then apply:
```bash
docker compose -f docker-compose.dev.yml exec web npx prisma migrate deploy
```

### Step 7.2: Drop Old Columns via Migration

**Create migration:**
```bash
docker compose -f docker-compose.dev.yml exec web npx prisma migrate dev --create-only --name drop_old_city_columns
```

**Edit the generated migration file** and add:

```sql
-- Drop old string columns
ALTER TABLE `Concert` DROP COLUMN `city`;
ALTER TABLE `Concert` DROP COLUMN `normalizedCity`;
ALTER TABLE `CityMapping` DROP COLUMN `normalizedCity`;

-- Update CityMapping unique constraint
ALTER TABLE `CityMapping` DROP INDEX `CityMapping_originalCity_normalizedCity_key`;
ALTER TABLE `CityMapping` ADD UNIQUE INDEX `CityMapping_originalCity_cityNormalizedId_key` (`originalCity`, `cityNormalizedId`);
```

**Apply:**
```bash
docker compose -f docker-compose.dev.yml exec web npx prisma migrate deploy
```

### Step 7.3: Update Prisma Schemas (Remove Old Fields)

**Remove from all 3 schema files:**
```prisma
model CityMapping {
  id                Int             @id @default(autoincrement())
  originalCity      String          @db.VarChar(255)
  // REMOVED: normalizedCity String @db.VarChar(255)
  cityNormalizedId  Int
  cityNormalized    CityNormalized  @relation(fields: [cityNormalizedId], references: [id])
  latitude          Float?
  longitude         Float?
  concerts          Concert[]
  
  @@unique([originalCity, cityNormalizedId])  // Updated constraint
  @@index([cityNormalizedId])
}

model Concert {
  id              Int          @id @default(autoincrement())
  name            String       @db.VarChar(255)
  venue           String       @db.VarChar(255)
  // REMOVED: city String @db.VarChar(255)
  // REMOVED: normalizedCity String @db.VarChar(255)
  cityMappingId   Int
  cityMapping     CityMapping  @relation(fields: [cityMappingId], references: [id])
  countryId       Int
  // ... other fields
}
```

**Regenerate client:**
```bash
docker compose -f docker-compose.dev.yml exec web npx prisma generate
```

### Step 7.4: Update SQLAlchemy Models

**File:** `scripts/database/models.py`

Remove old fields:
```python
class CityMapping(Base):
    __tablename__ = 'CityMapping'
    id = Column(Integer, primary_key=True)
    originalCity = Column(String(255), nullable=False)
    # REMOVED: normalizedCity = Column(String(255), nullable=False)
    cityNormalizedId = Column(Integer, ForeignKey('CityNormalized.id'), nullable=False)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    city_normalized = relationship('CityNormalized', back_populates='city_mappings')
    concerts = relationship('Concert', back_populates='city_mapping')
    __table_args__ = (
        UniqueConstraint('originalCity', 'cityNormalizedId'),
        Index('ix_CityMapping_cityNormalizedId', 'cityNormalizedId'),
    )

class Concert(Base):
    __tablename__ = 'Concert'
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    venue = Column(String(255), nullable=False)
    # REMOVED: city = Column(String(255), nullable=False)
    # REMOVED: normalizedCity = Column(String(255), nullable=False)
    cityMappingId = Column(Integer, ForeignKey('CityMapping.id'), nullable=False)
    countryId = Column(Integer, ForeignKey('Country.id'), nullable=False)
    # ... other fields
    city_mapping = relationship('CityMapping', back_populates='concerts')
```

### Step 7.5: Final Verification

```sql
-- Verify schema changes
DESCRIBE Concert;
DESCRIBE CityMapping;
-- Should NOT show old city/normalizedCity columns

-- Test queries work
SELECT 
  c.id, c.name, c.venue,
  cm.originalCity,
  cn.normalizedCity,
  co.name as country
FROM Concert c
JOIN CityMapping cm ON c.cityMappingId = cm.id
JOIN CityNormalized cn ON cm.cityNormalizedId = cn.id
JOIN Country co ON c.countryId = co.id
LIMIT 5;
```

---

## Implementation Checklist

### Phase 1: Schema Changes ✓
- [ ] **Step 1.1:** Update Prisma schemas (add new fields, keep old)
  - [ ] `prisma/schema.prisma`
  - [ ] `prisma/schema.mysql.prisma`
  - [ ] `prisma/schema.sqlite.prisma`
- [ ] **Step 1.2:** Create migration (don't apply yet)
  - [ ] Run `prisma migrate dev --create-only --name add_city_normalized_tables`
  - [ ] Note the generated migration folder path
- [ ] **Step 1.3:** Add collation change to migration (MySQL only)
  - [ ] Edit generated `migration.sql` file
  - [ ] Add `ALTER TABLE CityMapping MODIFY COLUMN originalCity` with utf8mb4_bin
- [ ] **Step 1.4:** Apply migration
  - [ ] Run `prisma migrate deploy`
  - [ ] Run `prisma generate`

### Phase 2: Data Migration ✓
- [ ] **Step 2.1:** Update SQLAlchemy models (keep old fields)
- [ ] **Step 2.2:** Create `migrate_city_structure.py` script
- [ ] **Step 2.3:** Run migration
  - [ ] Dry run with `--dry-run --verbose`
  - [ ] Review output
  - [ ] Apply migration
  - [ ] Run verification queries
  - [ ] Verify: 0 NULL cityMappingId values
  - [ ] Verify: 0 NULL cityNormalizedId values

### Phase 3: Python Backend ✓
- [ ] Update `scripts/database/normalizers/city.py`
  - [ ] Rewrite `get_or_create_city_mapping()` function
- [ ] Update `scripts/database/writer.py`
  - [ ] Update `upsert_concert()` to use cityMappingId
  - [ ] Remove references to city/normalizedCity strings
- [ ] Test scanner with new structure
  - [ ] Run scanner in dev environment
  - [ ] Verify concerts created with cityMappingId
  - [ ] Check logs for errors

### Phase 4: API Routes ✓
- [ ] `app/api/concerts/route.ts` - Add cityMapping include, update filter
- [ ] `app/api/concerts/[id]/route.ts` - Add cityMapping include
- [ ] `app/api/stats/route.ts` - Group by cityMappingId
- [ ] `app/api/map/concerts/route.ts` - Add cityMapping include
- [ ] `app/countries/[country]/page.tsx` - Add include, update grouping
- [ ] `app/calendar/page.tsx` - Add cityMapping include

### Phase 5: Frontend Components ✓
- [ ] **Type Definitions:**
  - [ ] `app/ConcertGrid.tsx` (line 15)
  - [ ] `app/calendar/CalendarView.tsx` (lines 14-15)
  - [ ] `app/countries/[country]/CountryConcerts.tsx` (lines 15-16)
  - [ ] `app/artists/[id]/ArtistConcerts.tsx`
  - [ ] `app/concerts/[id]/page.tsx`
  - [ ] `app/map/ConcertMap.tsx`
- [ ] **Display Updates:**
  - [ ] Replace `concert.city` → `concert.cityMapping.originalCity`
  - [ ] Replace `concert.normalizedCity` → `concert.cityMapping.cityNormalized.normalizedCity`
  - [ ] Update grouping logic
- [ ] **Server Components:**
  - [ ] `app/page.tsx` - Add cityMapping include
  - [ ] All other pages with Prisma queries

### Phase 6: Testing ✓
- [ ] Update `tests/test_city_e2e.py`
- [ ] Test scanner (create new concerts)
- [ ] Test all pages:
  - [ ] Home page (/)
  - [ ] Artists page (/artists)
  - [ ] Artist detail (/artists/[id])
  - [ ] Countries page (/countries)
  - [ ] Country detail (/countries/[country])
  - [ ] Calendar (/calendar)
  - [ ] Concert detail (/concerts/[id])
  - [ ] Map (/map)
- [ ] Verify grouping by normalized city
- [ ] Verify coordinates on map
- [ ] Verify city names display correctly

### Phase 7: Cleanup (Drop Old Columns) ✓
**⚠️ Only after phases 1-6 complete!**
- [ ] **Step 7.1:** Make FK fields non-nullable
  - [ ] Update Prisma schemas (remove ?)
  - [ ] Create migration: `prisma migrate dev --create-only --name make_city_fks_required`
  - [ ] Apply: `prisma migrate deploy`
- [ ] **Step 7.2:** Drop old columns via migration
  - [ ] Create migration: `prisma migrate dev --create-only --name drop_old_city_columns`
  - [ ] Edit migration file to add DROP COLUMN statements
  - [ ] Apply: `prisma migrate deploy`
- [ ] **Step 7.3:** Update Prisma schemas (remove old fields)
  - [ ] Remove city/normalizedCity from Concert
  - [ ] Remove normalizedCity from CityMapping
  - [ ] Run `prisma generate`
- [ ] **Step 7.4:** Update SQLAlchemy models (remove old fields)
- [ ] **Step 7.5:** Final verification
  - [ ] Check schema with DESCRIBE
  - [ ] Test queries
  - [ ] Test scanner
  - [ ] Test all pages again

---

## Rollback Plan

If issues occur:

1. **Before dropping columns:** Revert code changes, old columns still exist
2. **After dropping columns:** Restore from database backup
3. **Keep migration script** for re-running if needed

---

## Notes

- **Collation:** `CityMapping.originalCity` uses `utf8mb4_bin` (accent-sensitive)
- **Coordinates:** Fetched on first CityMapping creation
- **Grouping:** Always use `cityNormalized.normalizedCity` for grouping
- **Display:** Always use `cityMapping.originalCity` for display
- **No string fields:** Concert table has NO city string fields after migration

