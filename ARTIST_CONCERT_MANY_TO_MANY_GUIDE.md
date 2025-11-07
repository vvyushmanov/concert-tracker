# Artist-Concert Many-to-Many Relationship Implementation Guide

## Problem
Concerts currently have a single `artistId` field, but many concerts feature multiple artists. The `performers` field stores all artists as JSON text without proper relational structure.

## Solution: ArtistConcert Junction Table

### New Database Structure

```
Artist (1) ←→ (N) ArtistConcert (N) ←→ (1) Concert

ArtistConcert {
  id: Int (PK)
  artistId: Int (FK → Artist.id)
  concertId: Int (FK → Concert.id)
  isPrimary: Boolean (marks headliner)
  createdAt: Int
}
```

### Schema Changes

**Remove from Concert:**
- `artistId` field (foreign key)
- `artist` relation

**Add to Concert:**
- `artists` relation → `ArtistConcert[]`

**Remove from Artist:**
- `concerts` relation

**Add to Artist:**
- `concerts` relation → `ArtistConcert[]`

## Files Requiring Changes

### Phase 1: Database Schema (4 files)

1. **`/concert-tracker/prisma/schema.prisma`**
   - Add `ArtistConcert` model
   - Update `Concert` model (keep `artistId` temporarily for migration)
   - Update `Artist` model

2. **`/concert-tracker/prisma/schema.mysql.prisma`**
   - Same changes as above

3. **`/concert-tracker/prisma/schema.sqlite.prisma`**
   - Same changes as above

4. **`/concert-tracker/scripts/database/models.py`**
   - Add SQLAlchemy `ArtistConcert` model
   - Update `Concert` model relationships
   - Update `Artist` model relationships

### Phase 2: Python Backend (2 files)

5. **`/concert-tracker/scripts/database/writer.py`**
   - Add `link_artists_to_concert()` method
   - Update `write_concerts()` to call new method
   - Create `ArtistConcert` records for ALL matched artists
   - Mark first matched artist as `isPrimary=True`

6. **`/concert-tracker/scripts/parsers/country_parser.py`**
   - No changes needed (already extracts `matched_artists`)

### Phase 3: Frontend API Routes (5 files)

7. **`/app/api/concerts/route.ts`**
   - Update include to fetch `artists` via junction table
   - Parse artist data from junction

8. **`/app/api/concerts/[id]/route.ts`**
   - Update GET to include artists array
   - Keep backward compatibility during transition

9. **`/app/page.tsx`**
   - Update query to include artists via junction
   - Transform data for client component

10. **`/app/artists/[id]/page.tsx`**
    - Query concerts via `ArtistConcert` junction
    - Show all concerts where artist performs (not just primary)

11. **`/app/artists/page.tsx`**
    - Update concert count query to use junction table

### Phase 4: Frontend Components (7 files)

12. **`/app/concerts/[id]/page.tsx`**
    - Display multiple artists with links
    - Show only artists with playcount > 0
    - Highlight primary artist
    - Keep performers text as reference

13. **`/app/ConcertGrid.tsx`**
    - Update to show primary artist or multiple artists
    - Handle artists array

14. **`/app/calendar/page.tsx`**
    - Update includes to fetch artists array

15. **`/app/countries/[country]/page.tsx`**
    - Update includes to fetch artists array

16. **`/app/map/MapClient.tsx`**
    - Update concert data structure
    - Handle artists array in markers

17. **`/app/map/ConcertMap.tsx`**
    - Update tooltip to show multiple artists
    - Handle artists array

18. **`/app/types/map.ts`**
    - Update Concert interface to include artists array

### Phase 5: Migration Script (1 file)

19. **Create: `/concert-tracker/scripts/migrate_artist_concert.py`**
    - Create `ArtistConcert` records from existing `Concert.artistId`
    - Parse `performers` JSON and match against `Artist` table
    - Create additional `ArtistConcert` records for matched performers
    - Only link artists that exist in `Artist` table with playcount > 0

### Phase 6: Cleanup (after verification)

20. **Remove `Concert.artistId` column**
    - Drop from all Prisma schemas
    - Drop from SQLAlchemy models
    - Remove fallback code in frontend

## Implementation Strategy

### Step 1: Schema Changes (Keep artistId temporarily)
- Add `ArtistConcert` model to all schemas
- Add `artists` relation to Concert/Artist
- Keep `artistId` field for migration
- Run Prisma migration

### Step 2: Data Migration
- Create migration script
- Populate `ArtistConcert` from existing data
- Verify data integrity
- Test queries

### Step 3: Backend Updates
- Update `ConcertDatabaseWriter` to create junction records
- Test with new concert parsing
- Verify all matched artists are linked

### Step 4: Frontend Updates (Backward Compatible)
- Update API routes to include `artists` array
- Keep fallback to `artist` field during transition
- Update components to display multiple artists
- Test all views

### Step 5: Cleanup
- Drop `Concert.artistId` column
- Remove fallback code
- Final testing

## Display Logic

### Concert Detail Page
```tsx
{/* Show tracked artists with links */}
{concert.artists
  .filter(ac => ac.artist.playcount > 0)
  .map(ac => (
    <Link 
      href={`/artists/${ac.artistId}`}
      className={ac.isPrimary ? 'font-bold' : ''}
    >
      {ac.artist.name}
    </Link>
  ))
}

{/* Show all performers as text reference */}
<div className="text-sm text-gray-500">
  All performers: {concert.performers.join(', ')}
</div>
```

### Concert Grid/List
```tsx
{/* Show primary artist or first tracked artist */}
{concert.artists.find(ac => ac.isPrimary)?.artist.name || 
 concert.artists[0]?.artist.name}
```

## Query Patterns

### Fetch concert with artists (Prisma)
```typescript
const concert = await prisma.concert.findUnique({
  where: { id },
  include: {
    artists: {
      include: {
        artist: {
          include: {
            userStats: { where: { userId } }
          }
        }
      }
    }
  }
});
```

### Fetch artist's concerts (Prisma)
```typescript
const artistConcerts = await prisma.artistConcert.findMany({
  where: { artistId },
  include: {
    concert: {
      include: {
        countryObj: true,
        userInteractions: { where: { userId } }
      }
    }
  }
});
```

### Create artist-concert links (Python)
```python
# In ConcertDatabaseWriter
def link_artists_to_concert(self, concert: Concert, matched_artists: List[str]):
    """Create ArtistConcert links for all matched artists"""
    for idx, artist_name in enumerate(matched_artists):
        artist = self.session.query(Artist).filter_by(name=artist_name).first()
        if artist:
            # Check if link exists
            existing = self.session.query(ArtistConcert).filter_by(
                artistId=artist.id,
                concertId=concert.id
            ).first()
            
            if not existing:
                link = ArtistConcert(
                    artistId=artist.id,
                    concertId=concert.id,
                    isPrimary=(idx == 0)  # First artist is primary
                )
                self.session.add(link)
```

## Benefits

1. **Proper Relationships** - Query all concerts for any performing artist
2. **Better Filtering** - Filter by any artist, not just headliner
3. **Accurate Counts** - Artist page shows ALL concerts they perform at
4. **User-Specific Display** - Only show artists user tracks (playcount > 0)
5. **Maintains Data** - Keep `performers` JSON as backup/reference

## Implementation Status

### ✅ Phase 1: Database Schema - COMPLETE
- ✅ Added `ArtistConcert` model to all 3 Prisma schemas (MySQL, SQLite, active)
- ✅ Updated SQLAlchemy models with `ArtistConcert` model
- ✅ Kept `Concert.artistId` temporarily (marked as DEPRECATED)
- ✅ Ran Prisma migration successfully (`npx prisma db push`)

### ✅ Phase 2: Data Migration - COMPLETE
- ✅ Created `/concert-tracker/scripts/migrate_artist_concert.py`
- ✅ Successfully migrated 568 concerts → 637 artist-concert links
  - 568 primary links (one per concert)
  - 69 additional links (performers from same concerts)
- ✅ Verified data integrity (all concerts have exactly one primary artist)

### ✅ Phase 3: Python Backend - COMPLETE
- ✅ Updated `ConcertDatabaseWriter` with `link_artists_to_concert()` method
- ✅ Implemented "first scan wins" logic for primary artist
- ✅ Creates Artist records for ALL matched artists (not just primary)
- ✅ Prevents multiple primary artists per concert
- ✅ Preserves MusicBrainz IDs for all artists
- ✅ Added comprehensive debug logging
- ✅ Updated stats tracking (artist_concert_links_created/skipped)

**Key Implementation Details:**
- Primary artist determination: First artist in `matched_artists` array
- Existing concerts: Primary artist never changes (stable across scans)
- Multi-user support: Each user can match different artists
- Concert.artistId: No longer updated for existing concerts (migration compatibility)

### ✅ Phase 3.5: Testing - COMPLETE
- ✅ Created comprehensive test suite (`test_artist_concert_links.py`)
- ✅ All 40 tests passing (100% success rate)
- ✅ Verbose mode available (`--verbose` or `-v` flag)

**Test Coverage:**
1. ✅ New concert with single matched artist
2. ✅ New concert with multiple matched artists
3. ✅ Same user re-scans existing concert
4. ✅ Different user scans same concert with different matched artists
5. ✅ Second user adds new artist to existing concert
6. ✅ Concert.artistId remains stable across scans

### 🔄 Phase 4: Frontend API Routes - PENDING
- [ ] Update `/app/api/concerts/route.ts`
- [ ] Update `/app/api/concerts/[id]/route.ts`
- [ ] Update `/app/page.tsx`
- [ ] Update `/app/artists/[id]/page.tsx`
- [ ] Update `/app/artists/page.tsx`

### 🔄 Phase 5: Frontend Components - PENDING
- [ ] Update `/app/concerts/[id]/page.tsx`
- [ ] Update `/app/ConcertGrid.tsx`
- [ ] Update `/app/calendar/page.tsx`
- [ ] Update `/app/countries/[country]/page.tsx`
- [ ] Update `/app/map/MapClient.tsx`
- [ ] Update `/app/map/ConcertMap.tsx`
- [ ] Update `/app/types/map.ts`

### 🔄 Phase 6: Cleanup - PENDING
- [ ] Drop `Concert.artistId` column from all schemas
- [ ] Remove fallback code in frontend
- [ ] Final testing

## Testing Checklist

- ✅ Schema migration runs successfully
- ✅ Data migration populates junction table correctly
- ✅ New concerts create multiple artist links
- ✅ Primary artist logic works ("first scan wins")
- ✅ No duplicate primary artists per concert
- ✅ Multi-user support works correctly
- ✅ Artist records created for all matched performers
- ✅ MBIDs preserved for all artists
- [ ] Concert detail page shows multiple artists
- [ ] Artist detail page shows all concerts (not just as primary)
- [ ] Concert grid shows primary artist
- [ ] Filtering by artist works for any performing artist
- [ ] Map markers show multiple artists
- [ ] Calendar view handles multiple artists
- [ ] No broken links or missing data
