# Global Scanning: Code Reuse Analysis

**Quick Reference**: How to implement global scanning WITHOUT duplicating existing code

---

## TL;DR

**Total new code**: ~400 lines across 4 phases
**Code reused**: 5,000+ lines of existing infrastructure
**Duplication risk**: ⚠️ HIGH if not following this guide

---

## Phase-by-Phase Breakdown

### Phase 1: Schema Migration (3 new fields)

**File**: `concert-tracker/prisma/schema.*.prisma`

```prisma
model UserConcert {
  // EXISTING FIELDS (unchanged)
  id, userId, concertId, interested, notes, isPrivate, createdAt, updatedAt

  // NEW FIELDS (only these 3!)
  autoMatched Boolean @default(false)
  matchReason String? @db.VarChar(50)
  matchedAt   Int?

  // NEW INDEXES
  @@index([userId, autoMatched])
  @@index([matchReason])
}
```

**Reuses**: Prisma migration system (nothing to write)

**New code**: 3 field declarations + 2 indexes = **5 lines**

---

### Phase 2: Concert Matcher Service (~250 lines)

**File**: `concert-tracker/scripts/services/concert_matcher.py`

#### What's NEW:
```python
class ConcertMatcher:
    def __init__(self, session, batch_size, debug):
        # Initialize with existing session (no connection logic)
        pass

    def match_concerts_for_all_users(self, concert_ids, new_concerts_only):
        # NEW: Core matching algorithm
        pass

    def match_concerts_for_user(self, user_id, concert_ids, new_concerts_only):
        # NEW: Single-user matching logic
        pass
```

#### What's REUSED:
```python
# Database
from database.models import (
    Concert, User, UserArtist, UserConcert,
    ArtistConcert, UserActiveCountry, get_session  # ← EXISTING
)

# Logging
from utils import get_logger  # ← EXISTING
logger = get_logger(__name__)

# Session management
session = get_session()  # ← EXISTING (passed from caller)
```

**New code**: ~250 lines (matching logic only)
**Reused**: Database models, logging, session management

---

### Phase 3: Global Scanner Integration (~50 lines)

**File**: `concert-tracker/scripts/parse_concerts.py` (MODIFY existing)

#### Changes Summary:

| Section | Lines Changed | Change Type |
|---------|---------------|-------------|
| Argument parser | +10 lines | Add `--global-scan` flag |
| Credential validation | +15 lines | Allow `user_id=None` for global mode |
| Parsing loop | +10 lines | Track `new_concert_ids` |
| Finalize function | +15 lines | Call `ConcertMatcher` |
| **TOTAL** | **~50 lines** | **Additions only** |

#### What's REUSED (NO changes needed):

```python
# ✅ REUSE: Credential loading (existing function)
credentials, validation = load_credentials(
    user_id=user_id_for_parsing,  # Can be None now
    db_path=args.db_path,
    require_countries=True
)

# ✅ REUSE: Proxy setup (existing code)
proxy_manager = ProxyManager(
    webshare_url=webshare_url,
    validate_on_load=validate,
    validation_workers=args.proxy_workers
)

# ✅ REUSE: Country parsing (existing loop)
concert_parser = CountryConcertParser(
    country_code,
    filtering_artists=filtering_artists,
    # ... all existing parameters ...
)

# ✅ REUSE: Database writer (existing class)
db_writer = ConcertDatabaseWriter(args.db_path, user_id=user_id, debug=args.debug)

# ✅ REUSE: Artist filtering (existing --no-filter flag)
if args.no_filter:  # Already implemented!
    filtering_artists = set()
```

#### What's NEW (only these additions):

```python
# NEW: Global scan flag
parser.add_argument('--global-scan', action='store_true', ...)

# NEW: Allow user_id=None
if args.global_scan:
    user_id_for_parsing = None
    args.no_filter = True  # Auto-enable existing flag
else:
    user_id_for_parsing = args.user_id

# NEW: Track new concerts
new_concert_ids = []
if args.global_scan:
    for concert_data in concerts_to_write:
        concert = db_writer.session.query(Concert).filter_by(...).first()
        if concert.createdAt == concert.updatedAt:
            new_concert_ids.append(concert.id)

# NEW: Trigger matching
if args.global_scan and not args.skip_matching:
    from services.concert_matcher import ConcertMatcher
    matcher = ConcertMatcher(db_writer.session, debug=args.debug)
    match_stats = matcher.match_concerts_for_all_users(
        concert_ids=new_concert_ids,
        new_concerts_only=True
    )
```

**New code**: ~50 lines
**Reused**: ~500 lines (entire parse_concerts.py infrastructure)

---

### Phase 4: Scheduled Background Job (~100 lines)

**File**: `concert-tracker/scripts/scheduled_scan.py` (NEW file)

#### Entire file is a thin wrapper:

```python
#!/usr/bin/env python3
import subprocess
from utils import get_logger, setup_logging  # ← REUSE

logger = get_logger(__name__)
setup_logging(verbose=True)

def run_global_scan(use_proxies, max_pages, dry_run):
    # NEW: Build command for subprocess
    cmd = [
        sys.executable,
        'parse_concerts.py',           # ← REUSE parse_concerts.py
        '--global-scan',               # ← NEW flag from Phase 3
        '--save-frequency', 'country',
        '--debug'
    ]

    # NEW: Execute subprocess
    result = subprocess.run(cmd, capture_output=True, timeout=7200)

    if result.returncode == 0:
        # NEW: Run metadata enrichment
        subprocess.run([
            sys.executable,
            'fetch_metadata.py',       # ← REUSE fetch_metadata.py
            '--delay', '0.5'
        ])

def main():
    # NEW: CLI argument parsing
    parser = argparse.ArgumentParser(...)
    args = parser.parse_args()

    # NEW: Orchestration
    exit_code = run_global_scan(...)
    return exit_code

if __name__ == '__main__':
    sys.exit(main())
```

**New code**: ~100 lines (orchestration wrapper)
**Reused**: `parse_concerts.py` (does all the work), `fetch_metadata.py`, logging

---

## Anti-Duplication Checklist

### ❌ DO NOT Duplicate These (Already Exist!)

- [ ] Database connection logic → Use `get_session()`
- [ ] Credential loading → Use `load_credentials()`
- [ ] Config management → Use `ConfigManager`
- [ ] Logging setup → Use `get_logger()` and `setup_logging()`
- [ ] Proxy rotation → Use `ProxyManager`
- [ ] Artist filtering → Use existing `--no-filter` flag
- [ ] Concert parsing → Use `CountryConcertParser`
- [ ] Database writes → Use `ConcertDatabaseWriter`
- [ ] Validation logic → Use `validate_artist_sources()`
- [ ] Graceful shutdown → Use `GracefulShutdown` context

### ✅ DO Create These (New Functionality)

- [x] `UserConcert.autoMatched` field (Phase 1)
- [x] `UserConcert.matchReason` field (Phase 1)
- [x] `UserConcert.matchedAt` field (Phase 1)
- [x] `ConcertMatcher` class (Phase 2)
- [x] `--global-scan` CLI flag (Phase 3)
- [x] Concert ID tracking logic (Phase 3)
- [x] Matching trigger in `finalize_and_cleanup()` (Phase 3)
- [x] `scheduled_scan.py` orchestration wrapper (Phase 4)
- [x] `match_concerts.py` failsafe matcher CLI (Phase 4)

---

## Code Review Red Flags

### 🚨 If you see these, STOP and refactor:

1. **New credential loading logic**
   ```python
   # ❌ BAD: Duplicating credential logic
   config = ConfigManager()
   api_key = config.get('LASTFM_API_KEY')
   user = config.get('LASTFM_USER')

   # ✅ GOOD: Reuse existing function
   credentials, validation = load_credentials(user_id=user_id, ...)
   ```

2. **New database connection**
   ```python
   # ❌ BAD: Creating new connection logic
   engine = create_engine(database_url)
   Session = sessionmaker(bind=engine)

   # ✅ GOOD: Reuse existing function
   session = get_session(db_path)
   ```

3. **New logging setup**
   ```python
   # ❌ BAD: Custom logging
   logging.basicConfig(level=logging.INFO)
   logger = logging.getLogger(__name__)

   # ✅ GOOD: Reuse existing infrastructure
   from utils import get_logger, setup_logging
   setup_logging(verbose=True)
   logger = get_logger(__name__)
   ```

4. **Reimplementing artist filtering**
   ```python
   # ❌ BAD: New filtering logic
   def get_artists_global():
       # Fetch from Last.fm...
       # Fetch from UserArtist...
       # Merge results...

   # ✅ GOOD: Use existing flag
   args.no_filter = True  # Existing functionality!
   ```

5. **New config reading**
   ```python
   # ❌ BAD: Reading config directly
   country_codes = os.getenv('COUNTRY_CODES').split(',')

   # ✅ GOOD: Use centralized loader
   credentials, validation = load_credentials(...)
   country_codes = credentials.country_codes
   ```

---

## Integration Points Map

### How Components Connect:

```
scheduled_scan.py (NEW - Phase 4)
    ↓ subprocess.run()
    ↓
parse_concerts.py (MODIFIED - Phase 3)
    ├─→ load_credentials()        [EXISTING - REUSE]
    ├─→ ProxyManager               [EXISTING - REUSE]
    ├─→ CountryConcertParser       [EXISTING - REUSE]
    ├─→ ConcertDatabaseWriter      [EXISTING - REUSE]
    ├─→ validate_artist_sources()  [EXISTING - REUSE]
    └─→ ConcertMatcher (NEW - Phase 2)
            ├─→ get_session()      [EXISTING - REUSE]
            ├─→ Database models    [EXISTING - REUSE]
            └─→ get_logger()       [EXISTING - REUSE]
```

### Dependency Graph:

```
Phase 1 (Schema)
    ↓
Phase 2 (ConcertMatcher)
    ├─→ Uses: database.models (existing)
    ├─→ Uses: utils.logging (existing)
    └─→ Uses: database.config (existing)
    ↓
Phase 3 (Global Scanner)
    ├─→ Uses: Phase 2 (ConcertMatcher)
    ├─→ Uses: parse_concerts.py infrastructure (existing)
    └─→ Adds: 50 lines of integration code
    ↓
Phase 4 (Scheduler)
    └─→ Calls: Phase 3 (parse_concerts.py --global-scan)
```

---

## Metrics: Code Reuse Efficiency

| Metric | Value | Notes |
|--------|-------|-------|
| **Existing codebase** | ~5,000 lines | Python scripts |
| **New code (Phases 1-4)** | ~550 lines | 11% addition |
| **Reused code** | ~4,450 lines | 89% reuse rate |
| **Files modified** | 2 files | `schema.prisma`, `parse_concerts.py` |
| **Files created** | 3 files | `concert_matcher.py`, `scheduled_scan.py`, `match_concerts.py` |
| **Duplicate functions** | 0 | ✅ Zero duplication |
| **Cron jobs** | 3 | Scan (2am), Failsafe (3am), Metadata (4am) |

---

## Implementation Checklist

### Before Starting Each Phase:

- [ ] Read existing code in files you'll modify
- [ ] Identify reusable functions/classes
- [ ] Check if functionality already exists (e.g., `--no-filter`)
- [ ] Import existing utilities instead of writing new ones
- [ ] Review "Anti-Duplication Checklist" above

### During Implementation:

- [ ] Every new function → Check if equivalent exists
- [ ] Every new import → Verify it's not duplicating existing code
- [ ] Every database query → Use existing models/session
- [ ] Every config read → Use `load_credentials()` or `ConfigManager`
- [ ] Every log statement → Use `get_logger()`

### Code Review Questions:

- [ ] Could this use an existing function instead?
- [ ] Does this duplicate logic from another file?
- [ ] Can this be simplified by reusing infrastructure?
- [ ] Is this creating a new pattern when one exists?

---

## Summary

### The Golden Rule:

> **"If it exists in the codebase, reuse it. If it doesn't, create it ONCE in the right place."**

### Phase-Specific Rules:

1. **Phase 1**: Only touch schema files
2. **Phase 2**: Only create `ConcertMatcher` (pure service class)
3. **Phase 3**: Only add to `parse_concerts.py` (no new utilities)
4. **Phase 4**: Only create thin wrapper (calls existing scripts)

### Success Criteria:

✅ **550 lines of new code** (including failsafe matcher)
✅ **4,450+ lines reused**
✅ **Zero duplicate functions**
✅ **All existing tests still pass**
✅ **Failsafe mechanism** for reliable matching

---

**Last Updated**: 2025-12-08
**Compliance**: Zero-Duplication Architecture
