# Artist-Concert Many-to-Many Backend Implementation Summary

## ✅ Completed Changes

### 1. Database Schema Updates

**Files Modified:**
- `/concert-tracker/prisma/schema.prisma`
- `/concert-tracker/prisma/schema.mysql.prisma`
- `/concert-tracker/prisma/schema.sqlite.prisma`
- `/concert-tracker/scripts/database/models.py`

**Changes:**
- Added `ArtistConcert` junction table with fields:
  - `id` (PK)
  - `artistId` (FK → Artist)
  - `concertId` (FK → Concert)
  - `isPrimary` (Boolean) - marks headliner
  - `createdAt` (Unix timestamp)
  - Unique constraint on `(artistId, concertId)`
  - Indexes on `artistId`, `concertId`, `isPrimary`

- Updated `Artist` model:
  - Changed `concerts` relation from `Concert[]` to `ArtistConcert[]`

- Updated `Concert` model:
  - Added `artists` relation → `ArtistConcert[]`
  - Kept `artistId` field (marked as DEPRECATED for migration)

### 2. Data Migration

**File Created:** `/concert-tracker/scripts/migrate_artist_concert.py`

**What it does:**
- Creates `ArtistConcert` records from existing `Concert.artistId` (marked as `isPrimary=True`)
- Parses `Concert.performers` JSON and creates additional links for matched artists
- Only links artists that exist in the `Artist` table
- Skips if link already exists

**Migration Results:**
- 568 concerts processed
- 568 primary links created
- 69 additional links created
- Total: 637 artist-concert relationships

### 3. Python Backend Updates

**File Modified:** `/concert-tracker/scripts/database/writer.py`

**Key Changes:**

#### Added `link_artists_to_concert()` method:
```python
def link_artists_to_concert(self, concert, matched_artists, artist_mbids):
    # Check if primary artist already exists
    existing_primary = query(ArtistConcert).filter_by(
        concertId=concert.id,
        isPrimary=True
    ).first()
    
    for idx, artist_name in enumerate(matched_artists):
        # Only mark as primary if: first in list AND no primary exists
        is_primary = (idx == 0) and (existing_primary is None)
        
        # Get or create artist (creates if doesn't exist)
        artist = self.get_or_create_artist(name=artist_name, mbid=mbid)
        
        # Create ArtistConcert link
        artist_concert = ArtistConcert(
            artistId=artist.id,
            concertId=concert.id,
            isPrimary=is_primary
        )
```

#### Updated `write_concerts()` method:
- Calls `link_artists_to_concert()` for ALL matched artists
- Creates artists for additional performers (not just primary)
- Passes `artist_mbids` to preserve MusicBrainz IDs

#### Updated `upsert_concert()` method:
- **Removed `artistId` from update values** for existing concerts
- This prevents changing primary artist when different users scan

#### Added comprehensive debug logging:
- Shows all performers vs matched artists
- Displays primary artist determination
- Logs each artist link creation with role (PRIMARY/ADDITIONAL)
- Shows MBID and artist ID for each link

### 4. Primary Artist Logic

**Rule: "First Scan Wins"**

1. **New concert**: First artist in `matched_artists` becomes primary
2. **Existing concert**: Primary artist never changes
3. **Multiple users**: Each user can match different artists, but only ONE primary exists

**Example:**
```
Concert performers: [A, B, C]

User 1 scans (listens to A, B):
  - A → isPrimary=True  ✅
  - B → isPrimary=False

User 2 scans (listens to C):
  - C → isPrimary=False  ✅ (NOT primary, A already is)
  - A remains primary
```

### 5. Stats Tracking

**New stats added:**
- `artist_concert_links_created` - Number of new links created
- `artist_concert_links_skipped` - Number of existing links found

**Updated stats display:**
```
Artist-Concert links created: 15
Artist-Concert links skipped: 3
```

## 🔍 How It Works

### Scenario 1: New Concert with Multiple Artists

**Input:**
```python
concert_data = {
    'performers': ['Metallica', 'Slayer', 'Megadeth'],
    'matched_artists': ['Metallica', 'Slayer'],  # User listens to these
}
```

**Process:**
1. Create/update `Metallica` artist → ID 1
2. Create/update `Slayer` artist → ID 2
3. Create concert → ID 100
4. Create `ArtistConcert` links:
   - (artistId=1, concertId=100, isPrimary=True)
   - (artistId=2, concertId=100, isPrimary=False)
5. Create `UserArtist` for both artists
6. Create `UserConcert` link

**Result:**
- Concert has 2 linked artists
- Metallica is marked as primary (first in list)
- Megadeth not linked (user doesn't listen to them)

### Scenario 2: Different User Scans Same Concert

**User 2 Input:**
```python
concert_data = {
    'performers': ['Metallica', 'Slayer', 'Megadeth'],
    'matched_artists': ['Megadeth'],  # User 2 only listens to Megadeth
}
```

**Process:**
1. Concert already exists (ID 100)
2. Check for existing primary → Found: Metallica
3. Create/update `Megadeth` artist → ID 3
4. Create `ArtistConcert` link:
   - (artistId=3, concertId=100, isPrimary=False)  ← NOT primary!
5. Create `UserArtist` for Megadeth (User 2)
6. Create `UserConcert` link (User 2)

**Result:**
- Concert now has 3 linked artists
- Metallica still primary (first scan wins)
- Megadeth added as additional artist
- User 2 can see this concert (via UserConcert link)

## 🎯 Key Benefits

1. **Multi-Artist Support**: Concerts can have multiple linked artists
2. **Multi-User Support**: Different users can match different artists
3. **Stable Primary Artist**: First scan determines headliner, never changes
4. **All Artists Created**: Even additional performers get Artist records
5. **MBIDs Preserved**: Can fetch images for all artists later
6. **Backward Compatible**: `Concert.artistId` kept for migration period

## 📊 Database State After Migration

```
Concert table:
- artistId field still exists (deprecated, for migration)
- Points to original primary artist

ArtistConcert table:
- 637 total links
- 568 with isPrimary=True (one per concert)
- 69 with isPrimary=False (additional artists)

Artist table:
- All matched artists from all users
- Includes MBIDs where available
```

## 🧪 Testing

**Test File Created:** `/concert-tracker/scripts/test_artist_concert_links.py`

**Test Scenarios:**
1. New concert with single artist
2. New concert with multiple artists
3. Same user re-scans existing concert
4. Different user scans same concert
5. New artist added by second user
6. Concert.artistId stability across scans

**Run Tests:**
```bash
docker compose -f docker-compose.dev.yml exec web python scripts/test_artist_concert_links.py
```

## 🚀 Next Steps

### Frontend Updates (Pending):
1. Update API routes to fetch artists via `ArtistConcert` junction
2. Update components to display multiple artists
3. Filter artists by user's playcount > 0
4. Highlight primary artist in UI
5. Keep `performers` JSON as fallback/reference

### Cleanup (After Frontend Complete):
1. Drop `Concert.artistId` column from all schemas
2. Remove fallback code in frontend
3. Update all queries to use `ArtistConcert` only

## 📝 Debug Commands

**Enable debug mode in scanner:**
```bash
docker compose -f docker-compose.dev.yml exec web python scripts/parse_concerts.py \
  --user-id 1 \
  --countries de \
  --max-pages 2 \
  --debug
```

**Check artist-concert links:**
```sql
SELECT 
  c.eventName,
  a.name as artistName,
  ac.isPrimary
FROM ArtistConcert ac
JOIN Artist a ON ac.artistId = a.id
JOIN Concert c ON ac.concertId = c.id
WHERE c.id = 100;
```

**Verify primary artist count:**
```sql
SELECT 
  concertId,
  COUNT(*) as primary_count
FROM ArtistConcert
WHERE isPrimary = TRUE
GROUP BY concertId
HAVING COUNT(*) > 1;  -- Should return 0 rows
```
