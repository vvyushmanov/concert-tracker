# Phases 1-4: Visual Code Change Summary

**Quick visual guide** showing exactly what changes and what stays the same.

---

## Phase 1: Schema Migration

### File: `concert-tracker/prisma/schema.mysql.prisma`

```diff
model UserConcert {
  id         Int     @id @default(autoincrement())
  userId     Int
  concertId  Int
  interested Boolean @default(false)
  notes      String? @db.Text
  isPrivate  Boolean @default(false)
  createdAt  Int
  updatedAt  Int

+ autoMatched Boolean @default(false)              // NEW
+ matchReason String? @db.VarChar(50)             // NEW
+ matchedAt   Int?                                // NEW

  user    User    @relation(...)
  concert Concert @relation(...)

  @@unique([userId, concertId])
  @@index([userId])
  @@index([concertId])
  @@index([isPrivate])
  @@index([interested])
  @@index([userId, interested])
+ @@index([userId, autoMatched])                  // NEW
+ @@index([matchReason])                          // NEW
}
```

**Lines changed**: 5 (3 fields + 2 indexes)
**Files modified**: 2 (`schema.mysql.prisma`, `schema.sqlite.prisma`)

---

## Phase 2: Concert Matcher Service

### New File: `concert-tracker/scripts/services/concert_matcher.py`

```
concert-tracker/scripts/services/
├── __init__.py                  [EXISTING - no changes]
├── artist_source_manager.py     [EXISTING - no changes]
├── fanart_service.py            [EXISTING - no changes]
├── http_client.py               [EXISTING - no changes]
├── lastfm_service.py            [EXISTING - no changes]
├── metadata_service.py          [EXISTING - no changes]
├── musicbrainz_service.py       [EXISTING - no changes]
├── proxy.py                     [EXISTING - no changes]
└── concert_matcher.py           [NEW - Phase 2] ← Only new file
```

**Structure of new file**:

```python
"""
Automatic concert-to-user matching service
"""

from database.models import (        # ← IMPORT existing
    Concert, User, UserArtist,
    UserConcert, ArtistConcert,
    UserActiveCountry
)
from utils import get_logger         # ← IMPORT existing

logger = get_logger(__name__)        # ← USE existing


class ConcertMatcher:                # ← NEW class (only new code)
    """Matches concerts to users based on artist libraries"""

    def __init__(self, session: Session, batch_size: int = 100, debug: bool = False):
        self.session = session       # ← RECEIVE existing session
        # ...

    def match_concerts_for_all_users(self, concert_ids, new_concerts_only):
        """Match concerts to all users"""
        # NEW LOGIC HERE (core algorithm)
        pass

    def match_concerts_for_user(self, user_id, concert_ids, new_concerts_only):
        """Match concerts to single user"""
        # NEW LOGIC HERE (single-user matching)
        pass
```

**Lines of code**: ~250 lines
**New functionality**: Concert matching algorithm
**Reused components**: Database models, logging, session management

---

## Phase 3: Global Scanner Integration

### File: `concert-tracker/scripts/parse_concerts.py` (MODIFIED)

#### Change 1: Add arguments (around line 183)

```diff
  parser.add_argument(
      '--user-id',
      type=int,
      help='User ID for per-user data',
      default=None
  )
+ parser.add_argument(                           # NEW
+     '--global-scan',                           # NEW
+     action='store_true',                       # NEW
+     help='Global scan mode'                    # NEW
+ )                                               # NEW
+ parser.add_argument(                           # NEW
+     '--skip-matching',                         # NEW
+     action='store_true',                       # NEW
+     help='Skip matching after global scan'     # NEW
+ )                                               # NEW
```

#### Change 2: Allow user_id=None (around line 274)

```diff
+ # Determine user_id for parsing                # NEW
+ if args.global_scan:                            # NEW
+     logger.info("GLOBAL SCAN MODE")             # NEW
+     user_id_for_parsing = None                  # NEW
+     if not args.no_filter:                      # NEW
+         args.no_filter = True                   # NEW (auto-enable existing flag)
+ else:                                           # NEW
+     user_id_for_parsing = args.user_id         # NEW
+
  # Load credentials (EXISTING function)
  credentials, validation = load_credentials(
-     user_id=args.user_id,                       # OLD
+     user_id=user_id_for_parsing,                # NEW
      db_path=args.db_path,
      require_countries=True
  )
```

#### Change 3: Track new concerts (around line 450)

```diff
  # Parse concerts (EXISTING loop)
  all_concerts = concert_parser.parse_concerts()

+ new_concert_ids = []                            # NEW
+
  # Write to database (EXISTING code)
  if db_writer:
      db_writer.write_concerts(
          filtered_concerts,
          # ... existing parameters ...
      )
+
+     # Track newly created concerts              # NEW
+     if args.global_scan:                        # NEW
+         for concert_data in filtered_concerts:  # NEW
+             concert = db_writer.session.query(Concert).filter_by(...).first()
+             if concert.createdAt == concert.updatedAt:
+                 new_concert_ids.append(concert.id)
```

#### Change 4: Call matcher (in finalize_and_cleanup function)

```diff
  def finalize_and_cleanup(
      db_writer: Optional['ConcertDatabaseWriter'],
      args: argparse.Namespace,
+     new_concert_ids: List[int] = None           # NEW parameter
  ) -> None:
      # ... existing metadata fetch logic ...

+     # NEW: Auto-matching for global scan        # NEW
+     if args.global_scan and not args.skip_matching and new_concert_ids:
+         logger.info("Starting automatic user matching...")
+
+         from services.concert_matcher import ConcertMatcher
+
+         matcher = ConcertMatcher(db_writer.session, debug=args.debug)
+         match_stats = matcher.match_concerts_for_all_users(
+             concert_ids=new_concert_ids,
+             new_concerts_only=True
+         )
+
+         logger.info(f"Matching complete: {match_stats['matches_created']} matches")

      db_writer.close()  # EXISTING
```

#### Change 5: Update finalize call (end of main)

```diff
- finalize_and_cleanup(db_writer, args)          # OLD
+ finalize_and_cleanup(db_writer, args, new_concert_ids)  # NEW
```

**Total lines added**: ~50 lines
**Total existing lines reused**: ~500 lines (entire infrastructure)
**Percentage of new code**: 10%

---

## Phase 4: Scheduled Background Job

### New Files: `concert-tracker/scripts/scheduled_scan.py` + `match_concerts.py`

```
concert-tracker/scripts/
├── parse_concerts.py            [EXISTING - modified in Phase 3]
├── fetch_metadata.py            [EXISTING - no changes]
├── add_country.py               [EXISTING - no changes]
├── invalidate_cache.py          [EXISTING - no changes]
├── scheduled_scan.py            [NEW - Phase 4] ← Scheduler wrapper
└── match_concerts.py            [NEW - Phase 4] ← Failsafe matcher
```

**Structure**:

```python
#!/usr/bin/env python3
"""Scheduled background job wrapper"""

import subprocess
from utils import get_logger, setup_logging  # ← IMPORT existing

logger = get_logger(__name__)                # ← USE existing
setup_logging(verbose=True)                  # ← USE existing


def run_global_scan(...):
    """Orchestrate global scan"""

    # Build command                            # NEW (orchestration)
    cmd = [
        sys.executable,
        'parse_concerts.py',                  # ← CALL existing script
        '--global-scan',                      # ← NEW flag from Phase 3
        # ... other existing flags ...
    ]

    # Execute                                  # NEW (subprocess call)
    result = subprocess.run(cmd, ...)

    # Run metadata                             # NEW (subprocess call)
    subprocess.run([
        sys.executable,
        'fetch_metadata.py',                  # ← CALL existing script
        # ... existing flags ...
    ])


def main():
    """CLI entry point"""                     # NEW (argument parsing)
    parser = argparse.ArgumentParser(...)
    args = parser.parse_args()

    exit_code = run_global_scan(...)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
```

**Lines of code**:
- `scheduled_scan.py`: ~100 lines (orchestration wrapper)
- `match_concerts.py`: ~150 lines (failsafe matcher CLI)

**New functionality**:
- Orchestration wrapper for automated scanning
- Standalone matcher for failsafe operations

**Reused scripts**: `parse_concerts.py`, `fetch_metadata.py`, `ConcertMatcher` service

---

## Summary: What Changed vs. What Stayed

### Changed Files (Phases 1-4)

| File | Lines Added | Lines Modified | Purpose |
|------|-------------|----------------|---------|
| `schema.mysql.prisma` | 5 | 0 | Add UserConcert fields |
| `schema.sqlite.prisma` | 5 | 0 | Add UserConcert fields |
| `parse_concerts.py` | 50 | 5 | Add global scan mode |
| **New Files** | | | |
| `concert_matcher.py` | 250 | - | Matching logic |
| `scheduled_scan.py` | 100 | - | Scheduler wrapper |
| `match_concerts.py` | 150 | - | Failsafe matcher CLI |
| **TOTAL** | **560 lines** | **5 lines** | **565 lines changed** |

### Unchanged Files (Still Used)

| File | Lines | Reused In |
|------|-------|-----------|
| `database/models.py` | ~500 | Phase 2, 3 |
| `database/writer.py` | ~400 | Phase 3 |
| `database/config.py` | ~100 | Phase 2, 3 |
| `utils/credentials.py` | ~200 | Phase 3 |
| `utils/logging_config.py` | ~150 | All phases |
| `utils/validation.py` | ~100 | Phase 3 |
| `config/manager.py` | ~200 | Phase 3 |
| `services/proxy.py` | ~300 | Phase 3 |
| `services/artist_source_manager.py` | ~300 | Phase 3 (indirectly) |
| `parsers/country_parser.py` | ~600 | Phase 3 |
| `fetch_metadata.py` | ~400 | Phase 4 |
| **TOTAL REUSED** | **~3,250 lines** | **All phases** |

### Code Reuse Ratio

```
New Code:     415 lines (11%)
Reused Code: 3,250 lines (89%)
────────────────────────────
Total Impact: 3,665 lines (100%)
```

---

## Execution Flow Comparison

### Before (User-Specific Scan)

```
User clicks "Scan" button
    ↓
Frontend: POST /api/scanner/start
    ↓
Backend spawns subprocess:
    python parse_concerts.py --user-id 1
        ├─→ load_credentials(user_id=1)           [EXISTING]
        ├─→ ArtistSourceManager.fetch_artists()   [EXISTING]
        ├─→ CountryConcertParser.parse()          [EXISTING]
        ├─→ ConcertDatabaseWriter.write()         [EXISTING]
        └─→ Creates UserConcert for user 1        [EXISTING]
    ↓
User sees their concerts
```

### After (Global Scan)

```
Cron job runs daily (2am)
    ↓
python scheduled_scan.py                          [NEW - Phase 4]
    ↓
Subprocess:
    python parse_concerts.py --global-scan        [MODIFIED - Phase 3]
        ├─→ load_credentials(user_id=None)        [EXISTING - reused]
        ├─→ args.no_filter = True                 [EXISTING - auto-enabled]
        ├─→ CountryConcertParser.parse()          [EXISTING - reused]
        ├─→ ConcertDatabaseWriter.write()         [EXISTING - reused]
        ├─→ Track new_concert_ids                 [NEW - 10 lines]
        └─→ ConcertMatcher.match_all_users()      [NEW - Phase 2]
                ├─→ For each user:
                │   ├─→ Get UserArtist              [EXISTING model]
                │   ├─→ Get UserActiveCountry       [EXISTING model]
                │   └─→ Create UserConcert          [EXISTING model]
                └─→ Bulk insert                     [NEW logic]
    ↓
python fetch_metadata.py                          [EXISTING - reused]
    ↓
Failsafe cron job runs (3am)                      [NEW - Phase 4]
    ↓
python match_concerts.py                          [NEW - Phase 4]
    └─→ ConcertMatcher.match_all_users()          [REUSE - Phase 2]
        └─→ Matches any concerts missed by scan
    ↓
All users see matched concerts automatically
```

---

## Integration Points Map

### Visual Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    scheduled_scan.py                        │
│                    [NEW - Phase 4]                          │
│                    ~100 lines                               │
└────────────────────────────┬────────────────────────────────┘
                             │ subprocess.run()
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                   parse_concerts.py                         │
│                   [MODIFIED - Phase 3]                      │
│                   +50 new lines / ~500 existing lines       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │ load_credentials()          [EXISTING - REUSE]       │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ProxyManager                [EXISTING - REUSE]       │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ CountryConcertParser        [EXISTING - REUSE]       │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ConcertDatabaseWriter       [EXISTING - REUSE]       │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ if --global-scan:           [NEW - Phase 3]          │  │
│  │   track new_concert_ids                              │  │
│  │   call ConcertMatcher       [NEW - Phase 2]    ──────┼──┐
│  └──────────────────────────────────────────────────────┘  │ │
└─────────────────────────────────────────────────────────────┘ │
                                                                │
                                                                ↓
┌─────────────────────────────────────────────────────────────┐
│              services/concert_matcher.py                    │
│              [NEW - Phase 2]                                │
│              ~250 lines                                     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │ get_session()               [EXISTING - REUSE]       │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Database Models             [EXISTING - REUSE]       │  │
│  │  - Concert                                           │  │
│  │  - UserArtist                                        │  │
│  │  - UserConcert              [MODIFIED - Phase 1]     │  │
│  │  - ArtistConcert                                     │  │
│  │  - UserActiveCountry                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ get_logger()                [EXISTING - REUSE]       │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ match_concerts_for_all_users()  [NEW - Phase 2]     │  │
│  │   - Batch processing                                 │  │
│  │   - Incremental matching                             │  │
│  │   - Bulk inserts                                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

### ✅ What Makes This Zero-Duplication

1. **Phase 2** creates ONE new service (ConcertMatcher) - imports everything else
2. **Phase 3** adds 50 lines to existing script - reuses entire infrastructure
3. **Phase 4** is a thin wrapper - calls existing scripts via subprocess

### ✅ What Stays Exactly The Same

- Database connection logic
- Credential loading
- Config management
- Logging infrastructure
- Proxy rotation
- Concert parsing
- Database writes
- Artist filtering (via `--no-filter`)

### ✅ Integration Strategy

- Phase 2: Import and use existing components
- Phase 3: Extend existing script with minimal additions
- Phase 4: Orchestrate existing scripts

### 📊 Final Metrics

| Metric | Value |
|--------|-------|
| New code | 565 lines |
| Reused code | 3,250 lines |
| Reuse percentage | **85%** |
| New files | 3 (concert_matcher.py, scheduled_scan.py, match_concerts.py) |
| Modified files | 3 (schemas + parse_concerts.py) |
| Duplicate functions | **0** |
| Cron jobs | 3 (scan at 2am, failsafe at 3am, metadata at 4am) |

---

**Conclusion**: This implementation adds global scanning functionality with minimal code changes by maximizing reuse of existing, battle-tested infrastructure.

---

**Last Updated**: 2025-12-08
