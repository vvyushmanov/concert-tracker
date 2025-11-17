# Implementation Guide: Consolidate Metadata Scripts

**Goal**: Eliminate code duplication by removing `metadata.py` and creating a convenience wrapper in `metadata_service.py`

**Impact**: Removes ~165 lines of duplicate code, establishes single source of truth

---

## 📋 Pre-Implementation Checklist

- [ ] Backup current code or create a git branch
- [ ] Verify virtual environment is active: `~/lastfm-parser/venv/bin/python`
- [ ] Note current state: `metadata.py` is imported by `parse_concerts.py:32`
- [ ] Confirm tests exist: Check if any tests import from `services.metadata`

---

## 🔧 Implementation Steps

### **Step 1: Add Convenience Function to metadata_service.py**

**File**: `concert-tracker/scripts/services/metadata_service.py`

**Action**: Add the following function **at the end of the file** (after line 281, after the `ArtistMetadataService` class definition)

**Code to add**:

```python
# =============================================================================
# Convenience Function for CLI/Script Usage
# =============================================================================

def fetch_artist_metadata(
    db_path: str = None,
    silent: bool = False,
    user_id: int = None,
    batch_size: int = 5
) -> int:
    """
    Convenience function for post-parser metadata enrichment.

    This is a simplified version optimized for calling after parser runs.
    Focuses on MBID repair and image fetching, skipping playcount refresh.

    Strategy:
        - MBID repair: MusicBrainz (primary) → Last.fm (fallback if configured)
        - Images: Fanart.tv (if configured)
        - Playcounts: Skipped (use fetch_metadata.py for full refresh)
        - Batch commits: Saves progress every N artists to prevent data loss

    Args:
        db_path: Path to SQLite database or None to use DATABASE_URL env var
        silent: If True, suppress most output
        user_id: If provided, only process artists associated with this user
        batch_size: Number of artists to process before committing (default: 5)

    Returns:
        0 on success, 1 on error

    Example:
        >>> from services.metadata_service import fetch_artist_metadata
        >>> result = fetch_artist_metadata(db_path="data/concerts.db", user_id=1)
    """
    import time
    from sqlalchemy.orm import sessionmaker
    from database.models import Artist, UserArtist
    from database.config import get_engine
    from utils.credentials import load_credentials
    from utils import log

    def log_internal(message: str):
        """Internal logger that respects silent flag"""
        if not silent:
            log(message)

    # Load credentials using centralized loader
    try:
        credentials, validation = load_credentials(
            user_id=user_id,
            db_path=db_path,
            require_lastfm=False,
            require_countries=False
        )
        # Even if validation has errors, we can still proceed with available credentials
        # (Last.fm and Fanart are optional for metadata fetching)
        lastfm_api_key = credentials.lastfm_api_key
        lastfm_user = credentials.lastfm_user
        fanart_api_key = credentials.fanart_api_key
    except Exception as e:
        # Fallback to None if credential loading fails
        if not silent:
            log_internal(f"Warning: Could not load credentials: {e}")
            log_internal("Proceeding with MusicBrainz only (no Last.fm/Fanart)")
        lastfm_api_key = None
        lastfm_user = None
        fanart_api_key = None

    # Check what services are available
    fanart_available = bool(fanart_api_key)
    lastfm_available = bool(lastfm_api_key and lastfm_user)

    if not silent:
        log_internal("Metadata sources:")
        log_internal(f"  MusicBrainz: ✓ Available (no auth required)")
        log_internal(f"  Last.fm: {'✓ Configured' if lastfm_available else '✗ Not configured'}")
        log_internal(f"  Fanart.tv: {'✓ Configured' if fanart_available else '✗ Not configured'}")

    if not fanart_available and not lastfm_available:
        if not silent:
            log_internal("Warning: No metadata services configured")
            log_internal("Will use MusicBrainz for MBID lookups only")

    # Create metadata service
    metadata_service = ArtistMetadataService(
        lastfm_api_key=lastfm_api_key,
        fanart_api_key=fanart_api_key,
        lastfm_user=lastfm_user
    )

    # Connect to database
    try:
        engine = get_engine(db_path)
    except ValueError as e:
        raise ValueError(f"Database configuration error: {e}")

    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Query artists - filter by user if user_id provided
        if user_id:
            # Get only artists associated with this user via UserArtist table
            user_artist_ids = session.query(UserArtist.artistId).filter_by(
                userId=user_id
            ).distinct().all()
            user_artist_ids = [id[0] for id in user_artist_ids]

            if not user_artist_ids:
                log_internal(f"  No artists found for user ID {user_id}")
                return 0

            all_artists = session.query(Artist).filter(Artist.id.in_(user_artist_ids)).all()
            log_internal(f"  Processing {len(all_artists)} artists for user ID {user_id}")
        else:
            # Global mode: all artists
            all_artists = session.query(Artist).all()
            log_internal(f"  Processing all {len(all_artists)} artists")

        # =====================================================================
        # Phase 1: MBID Auto-Repair
        # =====================================================================
        artists_missing_mbid = [a for a in all_artists if not a.mbid]

        if artists_missing_mbid:
            log_internal(f"  Repairing MBIDs for {len(artists_missing_mbid)} artists...")

            # Use bulk repair method from service
            mbid_repair_count = metadata_service.bulk_repair_mbids(session, artists_missing_mbid)

            # Commit progress
            try:
                session.commit()
                log_internal(f"  ✓ Repaired {mbid_repair_count}/{len(artists_missing_mbid)} MBIDs")
            except Exception as e:
                session.rollback()
                if not silent:
                    log_internal(f"  ⚠️  Commit failed: {e}")

        # =====================================================================
        # Phase 2: Image Fetching
        # =====================================================================
        # Re-query artists after Phase 1 to ensure we see updated MBIDs
        # We must re-query (not just re-filter) because SQLAlchemy session
        # might have expired objects after commit, causing stale data
        if user_id:
            all_artists = session.query(Artist).filter(Artist.id.in_(user_artist_ids)).all()
        else:
            all_artists = session.query(Artist).all()

        artists_needing_images = [a for a in all_artists if a.mbid and not a.imageUrl]

        if artists_needing_images:
            if not fanart_available:
                log_internal(f"  ⚠️  Skipping image fetch for {len(artists_needing_images)} artists (Fanart.tv not configured)")
            else:
                log_internal(f"  Fetching images for {len(artists_needing_images)} artists...")
                images_found = 0

                for idx, artist in enumerate(artists_needing_images, 1):
                    # Show progress
                    if not silent:
                        log_internal(f"    [{idx}/{len(artists_needing_images)}] {artist.name}")

                    # Use service method to fetch image
                    image_url, image_type = metadata_service.fetch_artist_image(artist)

                    if image_url:
                        artist.imageUrl = image_url
                        images_found += 1
                        if not silent:
                            log_internal(f"      ✓ Found {image_type}: {image_url[:60]}...")
                    elif not silent:
                        log_internal(f"      ✗ No image found")

                    # Commit after each artist to prevent data loss on errors
                    # This is safe since we already have rate limiting (0.5s sleep below)
                    try:
                        session.commit()
                    except Exception as e:
                        session.rollback()
                        if not silent:
                            log_internal(f"      ⚠️  Commit failed for {artist.name}: {e}")

                    # Rate limiting (safer delay for Fanart.tv)
                    time.sleep(0.5)

                    # Progress indicator every N artists
                    if idx % batch_size == 0 and not silent:
                        log_internal(f"    💾 Progress: {idx}/{len(artists_needing_images)} artists processed")

                # Summary log
                log_internal(f"  ✓ Found {images_found}/{len(artists_needing_images)} images")

        session.close()
        return 0

    except Exception as e:
        if not silent:
            print(f"Error fetching metadata: {e}")
        session.close()
        return 1
```

**Notes**:
- This function wraps the `ArtistMetadataService` class methods
- Uses `bulk_repair_mbids()` for MBID repair
- Uses `fetch_artist_image()` for image fetching
- Handles its own database session management
- Same signature as current `metadata.py::fetch_artist_metadata()`

**Important Implementation Details**:

1. **Phase 1 → Phase 2 Data Visibility** (lines 172-180):
   - Phase 2 **re-queries** artists from database after Phase 1 commits
   - This ensures we see fresh data with updated MBIDs (not stale session objects)
   - Cannot just re-filter because SQLAlchemy may expire objects after commit
   - Re-query is safe and ensures consistency

2. **Per-Artist Commits in Phase 2** (lines 199-206):
   - Commits after EACH artist instead of batching
   - Prevents data loss if a single commit fails during batch processing
   - Since we already have 0.5s rate limiting, commit overhead is negligible
   - Individual rollback on error means only failed artist is lost, not entire batch

3. **Progress Indicators** (lines 211-213):
   - Shows progress every N artists (using `batch_size` parameter)
   - Doesn't affect commit frequency, just logging frequency

---

### **Step 2: Update Import in parse_concerts.py**

**File**: `concert-tracker/scripts/parse_concerts.py`

**Action**: Change line 32

**Before** (line 32):
```python
from services.metadata import fetch_artist_metadata
```

**After**:
```python
from services.metadata_service import fetch_artist_metadata
```

**Note**: No other changes needed in this file - the function signature remains identical.

---

### **Step 3: Delete metadata.py**

**File**: `concert-tracker/scripts/services/metadata.py`

**Action**: Delete the entire file

**Command**:
```bash
rm concert-tracker/scripts/services/metadata.py
```

**Verification**: Ensure no other files import from `services.metadata`:
```bash
cd ~/lastfm-parser
grep -r "from services.metadata import" concert-tracker/scripts/
grep -r "from services import.*metadata" concert-tracker/scripts/ --exclude-dir=__pycache__
```

Expected output: Only `parse_concerts.py` should appear (and it will be fixed in Step 2)

---

### **Step 4: Verify No Dangling Imports**

**Action**: Search for any remaining references to the old module

**Commands**:
```bash
cd ~/lastfm-parser/concert-tracker/scripts

# Check for imports
grep -r "services.metadata" . --exclude-dir=__pycache__

# Check for __init__.py exports
grep "metadata" services/__init__.py
```

**Expected**:
- `services/__init__.py` should NOT export anything from `metadata.py`
- Only `metadata_service` exports should remain

**If found**: Remove or update any dangling imports

---

## ✅ Testing Steps

### **Test 1: Import Verification**

```bash
cd ~/lastfm-parser
~/lastfm-parser/venv/bin/python -c "from concert-tracker.scripts.services.metadata_service import fetch_artist_metadata; print('✓ Import successful')"
```

Expected: `✓ Import successful`

---

### **Test 2: Parse Concerts Integration Test**

```bash
cd ~/lastfm-parser/concert-tracker/scripts

# Run parse_concerts with metadata fetch
~/lastfm-parser/venv/bin/python parse_concerts.py \
    --user-id 1 \
    --output db \
    --countries tr \
    --limit 5
```

**Expected behavior**:
- Script runs without import errors
- After concert parsing, metadata fetch runs automatically
- MBIDs and images are fetched
- No errors related to missing `services.metadata`

---

### **Test 3: Direct Function Call Test**

Create a test script: `test_metadata_service.py`

```python
#!/usr/bin/env python3
"""Test the refactored fetch_artist_metadata function"""

import sys
sys.path.insert(0, '/home/vyushmanov/lastfm-parser/concert-tracker/scripts')

from services.metadata_service import fetch_artist_metadata

# Test with minimal parameters
result = fetch_artist_metadata(
    db_path="data/concerts.db",
    user_id=1,
    silent=False,
    batch_size=5
)

print(f"\n{'='*60}")
print(f"Test Result: {'✓ SUCCESS' if result == 0 else '✗ FAILED'}")
print(f"Exit code: {result}")
print(f"{'='*60}")

sys.exit(result)
```

Run:
```bash
~/lastfm-parser/venv/bin/python test_metadata_service.py
```

Expected: Exit code 0, metadata processing completes

---

### **Test 4: Service Class Still Works**

```python
#!/usr/bin/env python3
"""Test that ArtistMetadataService class still works independently"""

import sys
sys.path.insert(0, '/home/vyushmanov/lastfm-parser/concert-tracker/scripts')

from services.metadata_service import ArtistMetadataService
from database.models import Artist
from database.config import get_engine
from sqlalchemy.orm import sessionmaker

# Create service
service = ArtistMetadataService(
    lastfm_api_key=None,
    fanart_api_key=None,
    lastfm_user=None
)

# Test methods exist
assert hasattr(service, 'repair_mbid'), "repair_mbid method missing"
assert hasattr(service, 'fetch_artist_image'), "fetch_artist_image method missing"
assert hasattr(service, 'bulk_repair_mbids'), "bulk_repair_mbids method missing"

print("✓ All service methods exist")
print("✓ Service class unchanged")
```

---

## 🔄 Rollback Plan

If issues occur, revert with:

```bash
cd ~/lastfm-parser

# Restore metadata.py from git
git checkout concert-tracker/scripts/services/metadata.py

# Restore parse_concerts.py import
git checkout concert-tracker/scripts/parse_concerts.py

# Remove changes to metadata_service.py
git checkout concert-tracker/scripts/services/metadata_service.py
```

---

## 📊 Success Criteria

- [ ] `metadata.py` deleted
- [ ] `fetch_artist_metadata()` function added to `metadata_service.py`
- [ ] `parse_concerts.py` import updated
- [ ] No import errors when running `parse_concerts.py`
- [ ] Metadata fetch completes successfully after parsing
- [ ] `ArtistMetadataService` class methods still work independently
- [ ] All tests pass

---

## 🎯 Expected Outcomes

**Before**:
- 2 files: `metadata.py` (272 lines) + `metadata_service.py` (281 lines) = 553 lines
- ~165 lines of duplication

**After**:
- 1 file: `metadata_service.py` (~420 lines total)
- 0 lines of duplication
- **Net reduction: ~133 lines**

---

## 📝 Additional Notes

### **Dependencies to Watch**

1. **Imports in new function**: All imports are localized inside the function to avoid circular dependencies
2. **Session management**: Function creates its own session (doesn't reuse parse_concerts session)
3. **Error handling**: Gracefully handles missing credentials (falls back to MusicBrainz only)

### **Future Improvements** (optional)

After this refactoring works, consider:
1. Extract batch commit logic to a shared utility
2. Standardize progress logging across all scripts
3. Add unit tests for `fetch_artist_metadata()` function
4. Add `bulk_fetch_images()` method to match `bulk_repair_mbids()`

---

## 🐛 Troubleshooting

| **Error** | **Cause** | **Solution** |
|-----------|-----------|--------------|
| `ModuleNotFoundError: No module named 'services.metadata'` | Old import still exists | Check Step 2, ensure import updated |
| `ImportError: cannot import name 'fetch_artist_metadata'` | Function not added to metadata_service.py | Check Step 1, ensure function added at end of file |
| Circular import error | Import at top of file instead of inside function | Ensure imports are inside the function (as shown in Step 1) |
| Database connection error | `db_path` parameter issue | Check `get_engine()` call and DATABASE_URL env var |

---

## 📚 Context & Analysis

### **Why This Refactoring?**

**Problem**: Code duplication between two files implementing the same functionality:
- `metadata.py` (272 lines) - Procedural approach
- `metadata_service.py` (281 lines) - OOP service class

**Duplication Details**:
- ~60-65% code overlap
- ~165-180 lines of functionally duplicate code
- Same MBID repair logic (MusicBrainz → Last.fm fallback)
- Same image fetching logic (Fanart.tv)
- Divergent implementations make maintenance difficult

**Solution**: Consolidate all metadata logic into the service class, provide convenience wrapper for CLI usage.

### **Benefits**:
1. **Single source of truth** - All metadata operations in one place
2. **Reduced maintenance burden** - Fix bugs once, not twice
3. **Better testability** - Test service layer independently
4. **Consistent behavior** - No more divergent implementations
5. **Clearer architecture** - Service class (logic) + wrapper function (convenience)

---

## 🔧 Implementation Fixes Applied

This implementation addresses two critical issues identified during code review:

### **Fix #1: Phase 1 → Phase 2 Data Visibility**

**Problem**: Artists that receive MBIDs in Phase 1 might not be visible in Phase 2's image fetching.

**Original Code** (problematic):
```python
all_artists = session.query(Artist).all()  # Query once
# ... Phase 1: repair MBIDs and commit ...
artists_needing_images = [a for a in all_artists if a.mbid and not a.imageUrl]  # Stale data?
```

**Issue**: While Python passes object references (so in-place modifications should work), SQLAlchemy may:
- Expire objects after `session.commit()`
- Mark session state as stale
- Cause lazy loading to re-query from database
- Result: `all_artists` might not reflect committed MBID changes

**Fixed Code** (safe):
```python
all_artists = session.query(Artist).all()
# ... Phase 1: repair MBIDs and commit ...

# RE-QUERY from database to get fresh data
if user_id:
    all_artists = session.query(Artist).filter(Artist.id.in_(user_artist_ids)).all()
else:
    all_artists = session.query(Artist).all()

# Now we're guaranteed to see updated MBIDs
artists_needing_images = [a for a in all_artists if a.mbid and not a.imageUrl]
```

**Why it works**:
- Re-querying ensures we get fresh data from database
- No reliance on session state or object identity
- Guaranteed consistency after commit
- Small performance cost (~10-50ms) is worth the safety

---

### **Fix #2: Batch Rollback Data Loss Prevention**

**Problem**: If batch commit fails, entire batch of changes is lost.

**Original Code** (problematic):
```python
for idx, artist in enumerate(artists, 1):
    artist.imageUrl = image_url  # Modify artist

    if idx % batch_size == 0:  # Every 5 artists
        try:
            session.commit()  # Commit batch
        except:
            session.rollback()  # LOSES ALL 5 ARTISTS!
```

**Fixed Code**:
```python
for idx, artist in enumerate(artists, 1):
    artist.imageUrl = image_url

    # Commit immediately after each artist
    try:
        session.commit()
    except Exception as e:
        session.rollback()  # Only loses this ONE artist
        log_internal(f"⚠️ Commit failed for {artist.name}: {e}")

    time.sleep(0.5)  # Rate limiting already present

    # Progress indicator (doesn't affect commits)
    if idx % batch_size == 0:
        log_internal(f"Progress: {idx}/{total} processed")
```

**Why it works**:
- Each artist is committed individually
- If one fails, only that artist's data is lost
- Other artists in the "batch" are already committed
- No performance penalty since we already have 0.5s sleep for rate limiting

**Trade-off**: Slightly more database commits, but:
- We already sleep 0.5s per artist (rate limiting)
- Commit overhead (~10-50ms) is negligible compared to 500ms sleep
- Data safety is worth the minimal overhead

---

**Implementation Time Estimate**: 15-20 minutes
**Testing Time Estimate**: 10-15 minutes
**Total**: ~30-35 minutes

---

**Ready to implement when you are!** Save this guide and follow the steps sequentially. Each step has verification commands to ensure correctness before proceeding.
