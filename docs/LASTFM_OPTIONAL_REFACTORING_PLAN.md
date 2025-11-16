# 🔄 Phase-Based Refactoring Plan: Make Last.fm Optional

**Branch:** `develop/last_fm_optional`
**Goal:** Refactor Python backend to use UserArtist as primary artist source, with Last.fm as optional complement
**Date:** November 2024

---

## 📋 **PHASE 1: Core Service Layer - MusicBrainz Enhancement**

### 1.1 Implement MusicBrainz Rate Limiting
**File:** `concert-tracker/scripts/services/musicbrainz_service.py`

**Changes:**
- Add `last_request_time` tracking
- Implement `_rate_limit_wait()` method (1.1s minimum between requests)
- Add rate limiting to `fetch_artist_info()` and `get_artist_mbid()`
- Add request counter for debugging

### 1.2 Add Bulk MBID Fetching
**File:** `concert-tracker/scripts/services/musicbrainz_service.py`

**Changes:**
- Add `bulk_fetch_mbids(artist_names: List[str]) -> Dict[str, Optional[str]]` method
- Efficiently fetch MBIDs for multiple artists with rate limiting
- Return dict mapping artist_name → mbid

---

## 📋 **PHASE 2: Metadata Service Refactoring**

### 2.1 Make Last.fm Optional in ArtistMetadataService
**File:** `concert-tracker/scripts/services/metadata_service.py`

**Changes:**
- Update `__init__` to accept optional `lastfm_api_key` and `fanart_api_key`
- Add `has_lastfm()` and `has_fanart()` helper methods
- Update `repair_mbid()`:
  - **Primary:** Try MusicBrainz first (new MusicBrainzService instance)
  - **Fallback:** Try Last.fm if configured
  - Log source of MBID (musicbrainz/lastfm/none)
- Update `bulk_repair_mbids()`:
  - Try MusicBrainz bulk fetch first
  - Fall back to Last.fm if configured and MusicBrainz fails
- Update `update_user_artist_stats()`:
  - Return (0, 0) if Last.fm not configured
  - Log skip message

### 2.2 Update fetch_metadata.py Functions
**File:** `concert-tracker/scripts/services/metadata.py`

**Changes:**
- Update `fetch_artist_metadata()`:
  - Make Last.fm completely optional
  - Use MusicBrainz as primary MBID source
  - Skip playcount updates if Last.fm not configured
  - Add clear logging for what's being skipped

---

## 📋 **PHASE 3: Artist Filtering Strategy**

### 3.1 Create Artist Source Manager
**New File:** `concert-tracker/scripts/services/artist_source_manager.py`

**Purpose:** Centralized logic for artist filtering sources

**Class:** `ArtistSourceManager`
```python
class ArtistSourceManager:
    def __init__(self, session, user_id, lastfm_service=None, min_playcount=40):
        """
        Args:
            session: Database session
            user_id: User ID
            lastfm_service: Optional LastFMService instance
            min_playcount: Last.fm playcount filter (only used if lastfm_service provided)
        """

    def fetch_filtering_artists(self) -> Tuple[Set[str], Dict[str, int], Dict[str, int], Set[str], Dict[str, str]]:
        """
        Fetch artists for concert filtering from available sources

        Returns:
            - all_artists: Set[str] - Union of UserArtist + Last.fm artists
            - playcounts: Dict[str, int] - Overall playcounts (from Last.fm or 0)
            - playcounts_12month: Dict[str, int] - 12-month playcounts (from Last.fm or 0)
            - recent_artists: Set[str] - Recently active artists (from Last.fm only)
            - artist_mbids: Dict[str, str] - Known MBIDs (from both sources)

        Strategy:
            1. Fetch UserArtist records for user_id
            2. If Last.fm configured: fetch top artists, merge with UserArtist
            3. Return union of both sources
        """

    def has_any_source(self) -> bool:
        """Check if we have any artist source available"""

    def get_source_summary(self) -> str:
        """Return human-readable summary of active sources"""
```

### 3.2 Update Concert Parser
**File:** `concert-tracker/scripts/parsers/concert_parser.py`

**Changes:**
- Update docstrings: "Parses and filters concert data based on configured artist sources"
- No functional changes (already accepts generic `lastfm_artists` set)

---

## 📋 **PHASE 4: Main Script Refactoring**

### 4.1 Update parse_concerts.py
**File:** `concert-tracker/scripts/parse_concerts.py`

**Major Changes:**

#### 4.1.1 Configuration Loading (lines 268-300)
- Make Last.fm API key and user **optional**
- Load `lastfm_api_key` and `lastfm_user` but don't fail if missing
- Remove error exits for missing Last.fm config

#### 4.1.2 Artist Fetching (lines 302-328)
**Replace this section with:**
```python
# Initialize ArtistSourceManager
artist_source_manager = ArtistSourceManager(
    session=get_session(args.db_path),  # Need to create session
    user_id=args.user_id,
    lastfm_service=LastFMService(lastfm_api_key) if lastfm_api_key and lastfm_user else None,
    min_playcount=min_playcount
)

# Fetch filtering artists if filtering enabled
if not args.no_filter:
    # Validate sources
    if not artist_source_manager.has_any_source():
        print("ERROR: Cannot filter concerts - no artist sources available")
        print("- Last.fm not configured (missing LASTFM_API_KEY or LASTFM_USER)")
        print(f"- No UserArtist records found for user ID {args.user_id}")
        print("- Use --no-filter to fetch all concerts without filtering")
        return 1

    print("\nArtist Sources:")
    print(artist_source_manager.get_source_summary())
    print()

    # Fetch artists from all available sources
    lastfm_artists, artist_playcounts, artist_playcounts_12month, recent_artists, artist_mbids = \
        artist_source_manager.fetch_filtering_artists()

    print(f"Total filtering artists: {len(lastfm_artists)}")
else:
    print("Filtering disabled - will fetch all concerts")
    lastfm_artists = set()
    # ... rest stays same
```

#### 4.1.3 Database Writer Calls (lines 401-403, 432-433)
- Ensure `artist_playcounts`, `artist_playcounts_12month`, `recent_artists`, `artist_mbids` are passed
- These should be empty dicts/sets if no filtering

#### 4.1.4 Finalization (line 54-63)
- Update `finalize_and_cleanup()` to pass Last.fm status
- Call metadata repair with optional Last.fm

---

## 📋 **PHASE 5: Database Writer Updates**

### 5.1 Make Last.fm Data Optional
**File:** `concert-tracker/scripts/database/writer.py`

**Changes:**
- Update `write_concerts()` method signature to make parameters optional with defaults:
  ```python
  def write_concerts(
      self,
      concerts: List[Dict],
      artist_playcounts: Dict[str, int] = None,
      artist_playcounts_12month: Dict[str, int] = None,
      recent_artists: Set[str] = None,
      artist_mbids: Dict[str, str] = None
  ):
      # Default to empty if not provided
      artist_playcounts = artist_playcounts or {}
      artist_playcounts_12month = artist_playcounts_12month or {}
      recent_artists = recent_artists or set()
      artist_mbids = artist_mbids or {}
  ```

- Update UserArtist creation logic:
  - Set `playcount=0` if not in `artist_playcounts`
  - Set `playcount12month=0` if not in `artist_playcounts_12month`
  - Set `recent=False` always (as per requirement 13)

---

## 📋 **PHASE 6: Standalone fetch_metadata.py Script**

### 6.1 Make Script Work Without Last.fm
**File:** `concert-tracker/scripts/fetch_metadata.py`

**Changes:**

#### 6.1.1 Configuration Validation (lines 79-108)
- Make Last.fm API key **optional**
- Don't fail if `LASTFM_API_KEY` or `LASTFM_USER` missing
- Warn user about limited functionality

#### 6.1.2 Phase 0: MBID Auto-Repair (lines 143-198)
**Replace with:**
```python
# PHASE 0: MBID Auto-Repair
# Strategy: Try MusicBrainz first, then Last.fm if configured

artists_missing_mbid = [a for a in all_artists if not a.mbid]

if artists_missing_mbid:
    log("=" * 60)
    log(f"PHASE 0: MBID Auto-Repair ({len(artists_missing_mbid)} artists without MBID)")
    log("=" * 60 + "\n")

    # Initialize MusicBrainz service
    from services import MusicBrainzService
    mb_service = MusicBrainzService()

    mbid_repair_count = 0
    mbid_from_mb = 0
    mbid_from_lastfm = 0

    for idx, artist in enumerate(artists_missing_mbid, 1):
        mbid = None

        # Try MusicBrainz first
        try:
            mbid = mb_service.get_artist_mbid(artist.name)
            if mbid:
                mbid_from_mb += 1
                log(f"[{idx}/{len(artists_missing_mbid)}] {artist.name}: Found MBID from MusicBrainz: {mbid}")
        except Exception as e:
            log(f"[{idx}/{len(artists_missing_mbid)}] {artist.name}: MusicBrainz lookup failed: {e}")

        # Fallback to Last.fm if configured and MB failed
        if not mbid and lastfm_api_key and lastfm_user:
            # Try bulk fetch from Last.fm (existing logic)
            # ... existing Last.fm lookup code ...
            if mbid:
                mbid_from_lastfm += 1

        if mbid:
            artist.mbid = mbid
            mbid_repair_count += 1
        else:
            log(f"[{idx}/{len(artists_missing_mbid)}] {artist.name}: MBID not found")

    session.commit()
    log(f"\n✓ Auto-repaired {mbid_repair_count}/{len(artists_missing_mbid)} MBIDs")
    log(f"  - From MusicBrainz: {mbid_from_mb}")
    if lastfm_api_key:
        log(f"  - From Last.fm: {mbid_from_lastfm}")
    log()
```

#### 6.1.3 Phase 3: Refresh Playcounts (lines 347-398)
**Wrap entire phase:**
```python
# Phase 3: Refresh playcounts for all artists (if Last.fm configured)
if args.refresh_playcounts:
    if not lastfm_api_key or not lastfm_user:
        log("⚠️  PHASE 3 SKIPPED: Last.fm not configured (playcount refresh requires Last.fm)")
    else:
        log("=" * 60)
        # ... existing playcount refresh logic ...
```

---

## 📋 **PHASE 7: Testing & Validation**

### 7.1 Create Test Scenarios

**Scenario A: Last.fm Configured + UserArtist exists**
```bash
# Should use union of both sources
python parse_concerts.py --user-id 1 --output db --dry-run
```

**Scenario B: Last.fm NOT configured + UserArtist exists**
```bash
# Should filter by UserArtist only
# Remove/comment LASTFM_API_KEY from user settings
python parse_concerts.py --user-id 1 --output db --dry-run
```

**Scenario C: Last.fm NOT configured + NO UserArtist**
```bash
# Should error with helpful message
python parse_concerts.py --user-id 999 --output db --dry-run
```

**Scenario D: --no-filter mode**
```bash
# Should fetch all concerts regardless of sources
python parse_concerts.py --user-id 1 --output db --no-filter --dry-run
```

**Scenario E: Standalone metadata script**
```bash
# Should repair MBIDs via MusicBrainz without Last.fm
python fetch_metadata.py --user-id 1 --limit 10
```

### 7.2 Integration Tests
**File:** `concert-tracker/scripts/tests/test_lastfm_optional.py` (new)

**Test cases:**
- Test ArtistSourceManager with various configurations
- Test MusicBrainz rate limiting
- Test metadata repair priority (MB → Last.fm)
- Test UserArtist filtering
- Test union of sources

---

## 📋 **PHASE 8: Documentation Updates**

### 8.1 Update Architecture Guide
**File:** `CLAUDE.md`

**Changes:**
- Update "Data Flow Architecture" section
- Document new ArtistSourceManager
- Update concert discovery flow diagram
- Add "Last.fm Optional" section

### 8.2 Update README
**File:** `README.md` or create `docs/LASTFM_OPTIONAL_USAGE.md`

**Document:**
- How to use system without Last.fm
- How to populate UserArtist records
- Migration guide for existing users
- Future Spotify integration placeholder

---

## 📋 **PHASE 9: Configuration & Error Messages**

### 9.1 Add Configuration Validation Helper
**New File:** `concert-tracker/scripts/utils/validation.py`

**Function:** `validate_artist_sources()`
```python
def validate_artist_sources(
    user_id: int,
    lastfm_configured: bool,
    userartist_count: int,
    no_filter: bool
) -> Tuple[bool, str]:
    """
    Validate that we have artist sources for filtering

    Returns:
        (is_valid, error_message)
    """
```

### 9.2 Improve Error Messages
- Add colored output (optional)
- Add suggestions for each error case
- Link to documentation

---

## 📋 **PHASE 10: Cleanup & Edge Cases**

### 10.1 Handle Edge Cases
- Empty UserArtist table
- Duplicate artists from different sources (case sensitivity)
- MBID conflicts between sources
- Rate limit failures (both Last.fm and MusicBrainz)

### 10.2 Backward Compatibility
- Ensure existing scripts still work with Last.fm
- Don't break existing user workflows
- Graceful degradation

### 10.3 Logging Improvements
- Add source tracking for each artist
- Log statistics per source
- Add debug mode for troubleshooting

---

## ✅ **Success Criteria**

1. ✅ System works with Last.fm only (existing behavior)
2. ✅ System works with UserArtist only (no Last.fm)
3. ✅ System works with both (union filtering)
4. ✅ System works with --no-filter (no sources needed)
5. ✅ MusicBrainz rate limiting implemented
6. ✅ Metadata repair works without Last.fm
7. ✅ Clear error messages for misconfiguration
8. ✅ All existing tests pass
9. ✅ New integration tests pass
10. ✅ Documentation updated

---

## 🎯 **Execution Order**

1. **PHASE 1** → Foundation (MusicBrainz enhancement)
2. **PHASE 2** → Metadata service updates
3. **PHASE 3** → Artist source management (new abstraction)
4. **PHASE 9** → Validation helpers (needed for Phase 4)
5. **PHASE 4** → Main script refactoring
6. **PHASE 5** → Database writer updates
7. **PHASE 6** → Standalone script updates
8. **PHASE 7** → Testing
9. **PHASE 10** → Cleanup & edge cases
10. **PHASE 8** → Documentation

---

## 📝 **Requirements Summary**

### Artist Filtering Strategy
- Filter concerts by ALL artists in UserArtist table
- If `--no-filter` provided, pull and save all concerts

### UserArtist Population
- Stop if no UserArtist records AND no Last.fm configured AND no `--no-filter`
- Show helpful error message

### Playcount Filtering
- Treat any artist in UserArtist as "interesting" regardless of playcount

### MBID Priority
- Always try MusicBrainz first for MBID lookup
- Fall back to Last.fm if configured

### Playcount Updates
- Completely optional (only if Last.fm configured)
- Update for ALL UserArtist records when Last.fm is available

### Artist Discovery
- Use union of UserArtist artists ∪ Last.fm top artists when both available
- Add Last.fm artists to UserArtist if not present

### Recent Artists Flag
- Always set `recent=False` for UserArtist

### Error Handling
- Log warnings and continue if MusicBrainz fails
- Clear validation messages at startup

---

**This plan is ready for AI execution. Each phase is self-contained with clear inputs, outputs, and file references.**
