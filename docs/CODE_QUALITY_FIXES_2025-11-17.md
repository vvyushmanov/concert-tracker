# Code Quality Fixes - Phase-Based Implementation Guide

**Date:** November 17, 2025
**Project:** Concert Tracker - Python Scripts
**Scope:** concert-tracker/scripts/ directory (excluding test files)

## Executive Summary

This document provides a phase-based, AI-friendly, testable guide to fix 21+ code quality, security, and reliability issues identified in the November 2025 code review.

**Total Issues:** 21+
**Estimated Effort:** 3-4 sprints
**Priority Breakdown:**
- Critical (2): Session cleanup, SSL security
- Major (5): Resource leaks, race conditions, performance
- Minor (14+): Code quality, maintainability

**Success Criteria:**
- ✅ All critical issues resolved
- ✅ No resource leaks or race conditions
- ✅ Proper logging infrastructure in place
- ✅ All tests passing
- ✅ Type hints on public APIs

---

## Implementation Status

**Last Updated:** November 19, 2025

### Phase 1: Critical Security & Reliability Fixes ✅ COMPLETE
- ✅ Task 1.1: Session cleanup in add_country.py - DONE
- ✅ Task 1.2: SSL verification warnings - DONE
- ✅ Task 1.3: ConfigManager session leak - DONE

### Phase 2: Exception Handling & Logging ✅ COMPLETE
- ✅ Task 2.1: Logging infrastructure created (logging_config.py)
- ✅ Task 2.2: parse_concerts.py - DONE (all 36 prints converted)
- ✅ Task 2.3: fetch_metadata.py - DONE (92 logger calls, 0 prints)
- ✅ Task 2.4: Silent exceptions fixed in country.py and writer.py

**Additional Completed Work:**
- ✅ country_parser.py - Fully converted to logging (all prints replaced)
- ✅ utils/logging.py - Updated as deprecated wrapper for backward compatibility

### Phase 3: Database & Concurrency Fixes ✅ COMPLETE
- ✅ Task 3.1: Race condition fix in city mapping - DONE (retry with backoff)
- ✅ Task 3.2: N+1 query optimization in artist concert linking - DONE (batch query)
- ✅ Task 3.3: Null checks added in artist_source_manager.py - DONE

### Phase 4: Code Organization & Architecture ✅ COMPLETE
- ✅ Task 4.1: Extract Metadata Phases into Methods - DONE
  - Created `MetadataProcessor` class with separate phase methods
  - Reduced main() from 393 lines to ~180 lines
  - Added type hints and comprehensive docstrings
- ✅ Task 4.2: Refactor CityNormalizer into Smaller Classes - DONE
  - Created `utils/geo_distance.py` - Haversine distance calculation
  - Created `services/city_text_normalizer.py` - Text normalization service
  - Refactored `city.py` to delegate to new services

### Phase 5: Documentation & Type Hints ✅ COMPLETE
- ✅ Task 5.1: Add Type Hints to Public APIs - DONE
  - Added comprehensive type hints to 5 priority files
  - database/writer.py - All public methods annotated
  - services/metadata_service.py - All public methods annotated
  - services/artist_source_manager.py - All methods annotated
  - parsers/country_parser.py - Parse methods annotated
  - config/manager.py - All public methods annotated
- ✅ Task 5.2: Add/Update Docstrings - DONE
  - config/manager.py - All methods now have complete docstrings with Args/Returns
- ✅ Task 5.3: Fix Misleading Documentation - DONE
  - database/writer.py - Fixed link_artists_to_concert() docstring
- ✅ Task 5.4: Fix Mypy Errors - DONE
  - Installed types-requests stub package
  - Fixed parse_date() to accept Optional[str]
  - Fixed get_session() to accept Optional[str]
  - All critical mypy errors resolved

### Phases 6-8: NOT STARTED

---

## Phase 1: Critical Security & Reliability Fixes

**Goal:** Fix critical issues that could cause data loss or security vulnerabilities
**Estimated Time:** 1-2 days
**Files Modified:** 3

### Task 1.1: Fix Session Cleanup in add_country.py

**File:** `concert-tracker/scripts/add_country.py`
**Lines:** 29, 129-131
**Severity:** CRITICAL
**Issue:** Unreliable session cleanup using `'session' in locals()` pattern

**Current Code:**
```python
# Line 29
session = get_session()

# Lines 129-131
finally:
    if 'session' in locals():
        session.close()
```

**Fix:**
```python
# At the top of main() function
session = None
try:
    session = get_session()
    # ... existing code ...
finally:
    if session:
        session.close()
```

**Steps:**
1. Locate the `main()` function in add_country.py
2. Add `session = None` before the try block (before line 29)
3. Replace the finally block (lines 129-131) with the new code above
4. Verify indentation matches existing code

**Testing:**
```bash
# Test 1: Normal execution
~/lastfm-parser/venv/bin/python concert-tracker/scripts/add_country.py --code tr --name Turkey

# Test 2: Trigger error before session creation (should not crash)
~/lastfm-parser/venv/bin/python concert-tracker/scripts/add_country.py --invalid-arg

# Test 3: Database connection error
# Temporarily set wrong DB_PATH in .env, verify cleanup still works
```

**Success Criteria:**
- [ ] Code runs without errors
- [ ] Session closes even on early errors
- [ ] No "session not defined" errors

---

### Task 1.2: Add SSL Verification Warnings

**Files:**
- `concert-tracker/scripts/parsers/country_parser.py` (line 77)
- `concert-tracker/scripts/services/http_client.py` (line 53)

**Severity:** CRITICAL
**Issue:** SSL verification disabled globally, vulnerable to MITM attacks

**Current Code (country_parser.py:77):**
```python
self.http_client = HTTPClient(
    verify_ssl=False,  # Issues with concerts-metal.com cert
)
```

**Fix:**
```python
# Add at top of file
import sys

# In __init__ method:
# Disable SSL only for concerts-metal.com with explicit warning
print("⚠️  WARNING: SSL verification disabled for concerts-metal.com", file=sys.stderr)
print("⚠️  Reason: Known certificate validation issues with source site", file=sys.stderr)
print("⚠️  Risk: Potential MITM attacks on concert data scraping", file=sys.stderr)

self.http_client = HTTPClient(
    verify_ssl=False,  # TODO: Investigate cert pinning for concerts-metal.com
)
```

**Steps:**
1. Add warning messages before HTTPClient initialization
2. Add TODO comment for future cert pinning implementation
3. Add similar warnings in http_client.py where SSL warnings are disabled (line 53)
4. Document in code why this is necessary

**Testing:**
```bash
# Test: Verify warnings appear in output
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output json 2>&1 | grep "WARNING.*SSL"

# Expected: Should see 3 warning lines in stderr
```

**Success Criteria:**
- [ ] Warning messages appear on stderr when scripts run
- [ ] Functionality unchanged
- [ ] Security risk documented in code
- [ ] TODO added for future cert pinning

---

### Task 1.3: Fix ConfigManager Session Leak

**File:** `concert-tracker/scripts/config/manager.py`
**Lines:** 90-141
**Severity:** MAJOR
**Issue:** Session cleanup doesn't guarantee execution on all error paths

**Current Code:**
```python
def _migrate_from_env(self):
    session = self._Session()
    try:
        # ... migration code ...
        session.commit()
    except Exception as e:
        session.rollback()
        raise
    finally:
        session.close()
```

**Fix:**
```python
def _migrate_from_env(self):
    session = None
    try:
        session = self._Session()
        # ... existing migration code ...
        if session:
            session.commit()
    except Exception as e:
        if session:
            session.rollback()
        raise
    finally:
        if session:
            session.close()
```

**Steps:**
1. Add `session = None` at start of `_migrate_from_env()` method
2. Wrap `session.commit()` in `if session:` check
3. Wrap `session.rollback()` in `if session:` check
4. Existing finally block already has proper check

**Testing:**
```bash
# Test 1: Normal migration (first run with new settings)
# Delete Setting table contents, restart, verify migration works

# Test 2: Force exception during migration
# Temporarily add `raise Exception("test")` after session creation
# Verify session cleanup happens and no warnings about unclosed sessions
```

**Success Criteria:**
- [ ] No resource warnings about unclosed sessions
- [ ] Migration still works correctly
- [ ] Exceptions properly handled without leaks

---

## Phase 2: Exception Handling & Logging

**Goal:** Replace silent exception swallowing and implement proper logging
**Estimated Time:** 2-3 days
**Files Modified:** 10+

### Task 2.1: Create Logging Infrastructure

**File:** `concert-tracker/scripts/utils/logging_config.py` (NEW)
**Severity:** MINOR
**Issue:** No centralized logging, 280+ print statements across codebase

**Create New File:**
```python
"""
Centralized logging configuration for concert tracker scripts.

Usage:
    from utils.logging_config import get_logger

    logger = get_logger(__name__)
    logger.info("Processing started")
    logger.warning("No artists found")
    logger.error("Database connection failed", exc_info=True)
"""

import logging
import sys
from typing import Optional

# Color codes for terminal output
class LogColors:
    RESET = '\033[0m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    GREEN = '\033[92m'
    BLUE = '\033[94m'
    GRAY = '\033[90m'

class ColoredFormatter(logging.Formatter):
    """Custom formatter with colors for terminal output"""

    COLORS = {
        logging.DEBUG: LogColors.GRAY,
        logging.INFO: LogColors.BLUE,
        logging.WARNING: LogColors.YELLOW,
        logging.ERROR: LogColors.RED,
        logging.CRITICAL: LogColors.RED,
    }

    def format(self, record):
        color = self.COLORS.get(record.levelno, LogColors.RESET)
        record.levelname = f"{color}{record.levelname}{LogColors.RESET}"
        return super().format(record)

def setup_logging(
    level: int = logging.INFO,
    log_file: Optional[str] = None,
    verbose: bool = False
) -> None:
    """
    Configure logging for the application.

    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional file path to write logs to
        verbose: If True, set level to DEBUG
    """
    if verbose:
        level = logging.DEBUG

    # Create formatters
    console_formatter = ColoredFormatter(
        '%(levelname)s: %(message)s'
    )

    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # Remove existing handlers
    root_logger.handlers.clear()

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)

    # File handler (optional)
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(logging.DEBUG)  # Always log everything to file
        file_handler.setFormatter(file_formatter)
        root_logger.addHandler(file_handler)

def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for a module.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Logger instance
    """
    return logging.getLogger(name)

# Convenience functions for backward compatibility with print()
def info(msg: str) -> None:
    """Print info message (backward compatible with print())"""
    logging.getLogger().info(msg)

def warning(msg: str) -> None:
    """Print warning message"""
    logging.getLogger().warning(msg)

def error(msg: str) -> None:
    """Print error message"""
    logging.getLogger().error(msg)

def debug(msg: str) -> None:
    """Print debug message"""
    logging.getLogger().debug(msg)
```

**Steps:**
1. Create new file `concert-tracker/scripts/utils/logging_config.py`
2. Copy the code above
3. Add to git: `git add concert-tracker/scripts/utils/logging_config.py`

**Testing:**
```bash
# Test the logging module
~/lastfm-parser/venv/bin/python -c "
from concert_tracker.scripts.utils.logging_config import setup_logging, get_logger
setup_logging(verbose=True)
logger = get_logger(__name__)
logger.debug('Debug message')
logger.info('Info message')
logger.warning('Warning message')
logger.error('Error message')
"

# Expected: See colored output with all 4 levels
```

**Success Criteria:**
- [ ] File created and importable
- [ ] Colors work in terminal
- [ ] All log levels functional
- [ ] No import errors

---

### Task 2.2: Replace Print Statements in parse_concerts.py

**File:** `concert-tracker/scripts/parse_concerts.py`
**Lines:** Throughout file (~50 print statements)
**Severity:** MINOR

**Pattern to Replace:**
```python
# Old
print("Starting concert parsing...")
print(f"Processing {len(artists)} artists")

# New
logger.info("Starting concert parsing...")
logger.info(f"Processing {len(artists)} artists")
```

**Steps:**
1. Add imports at top of file:
```python
from utils.logging_config import setup_logging, get_logger

logger = get_logger(__name__)
```

2. Add logging setup in main():
```python
def main():
    args = parse_arguments()
    setup_logging(verbose=args.verbose if hasattr(args, 'verbose') else False)
    # ... rest of code
```

3. Replace print statements:
   - `print("...")` → `logger.info("...")`
   - `print(f"ERROR: ...")` → `logger.error("...")`
   - `print(f"WARNING: ...")` → `logger.warning("...")`
   - Debug info → `logger.debug("...")`

**Steps (detailed):**
```bash
# Use sed for bulk replacement (review carefully!)
# INFO level (most common)
sed -i 's/print("\([^"]*\)")/logger.info("\1")/g' concert-tracker/scripts/parse_concerts.py
sed -i "s/print('\([^']*\)')/logger.info('\1')/g" concert-tracker/scripts/parse_concerts.py

# ERROR level
sed -i 's/print("ERROR: /logger.error("/g' concert-tracker/scripts/parse_concerts.py
sed -i 's/print(f"ERROR: /logger.error(f"/g' concert-tracker/scripts/parse_concerts.py

# WARNING level
sed -i 's/print("WARNING: /logger.warning("/g' concert-tracker/scripts/parse_concerts.py
sed -i 's/print(f"WARNING: /logger.warning(f"/g' concert-tracker/scripts/parse_concerts.py
```

**Manual Review Required:**
- Check f-string conversions
- Verify multi-line prints
- Ensure sys.stderr redirects removed

**Testing:**
```bash
# Test normal run
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output json

# Test verbose mode
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output json --verbose

# Expected: Colored output, proper log levels, no print() statements visible
```

**Success Criteria:**
- [ ] No print() statements remain in parse_concerts.py
- [ ] All messages use appropriate log levels
- [ ] Script runs without errors
- [ ] Output is readable and colored

---

### Task 2.3: Replace Print Statements in fetch_metadata.py

**File:** `concert-tracker/scripts/fetch_metadata.py`
**Lines:** Throughout file (~60 print statements)
**Severity:** MINOR

**Follow same pattern as Task 2.2:**
1. Add logging imports
2. Add setup_logging() call in main()
3. Replace print statements with logger calls
4. Test thoroughly

**Additional Consideration:**
- Phase progress indicators should be INFO level
- Artist processing details should be DEBUG level
- Errors and warnings already marked

**Testing:**
```bash
# Test metadata fetching
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py --user-id 1 --limit 10

# Test verbose mode
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py --user-id 1 --limit 10 --verbose
```

**Success Criteria:**
- [ ] No print() statements remain
- [ ] Phase progress clearly visible
- [ ] Verbose mode shows artist-level details
- [ ] No functionality broken

---

### Task 2.4: Fix Silent Exception Swallowing

**Files:**
- `concert-tracker/scripts/database/normalizers/country.py` (lines 86, 116)
- `concert-tracker/scripts/database/writer.py` (line 82)

**Severity:** MAJOR
**Issue:** Bare `pass` in exception handlers hides errors

**Current Code (country.py:86):**
```python
except Exception as e:
    # Silently fail - we'll use fallback
    pass
```

**Fix:**
```python
except Exception as e:
    logger.debug(f"Geocoding failed for {city}, {country} (will use fallback): {e}")
    # Continue with fallback logic
```

**Steps:**
1. Add logger import to country.py: `from utils.logging_config import get_logger`
2. Add module logger: `logger = get_logger(__name__)`
3. Replace all `pass` statements in exception handlers with debug logging
4. Ensure exception message includes context (what was being processed)

**Locations to Fix:**
```python
# country.py:86 - Geocoding failure
except Exception as e:
    logger.debug(f"Geocoding failed for {city}, {country} (using fallback): {e}")

# country.py:116 - Database lookup failure
except IntegrityError as e:
    logger.debug(f"Concurrent city mapping creation for {city} (retrying): {e}")

# writer.py:82 - Artist creation race condition
except IntegrityError as e:
    logger.debug(f"Artist {artist_name} already exists (concurrent creation): {e}")
```

**Testing:**
```bash
# Test with --verbose to see debug messages
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db --verbose 2>&1 | grep -i "fallback\|concurrent"

# Expected: See debug messages when exceptions occur
```

**Success Criteria:**
- [ ] No bare `pass` statements in exception handlers
- [ ] All exceptions logged at appropriate level
- [ ] Context included in log messages
- [ ] Functionality unchanged

---

## Phase 3: Database & Concurrency Fixes

**Goal:** Fix race conditions, resource leaks, and performance issues
**Estimated Time:** 3-4 days
**Files Modified:** 3

### Task 3.1: Fix Race Condition in City Mapping

**File:** `concert-tracker/scripts/database/normalizers/city.py`
**Lines:** 663-679
**Severity:** MAJOR
**Issue:** Race condition between rollback and re-query allows duplicates

**Current Code:**
```python
if not city_normalized:
    city_normalized = CityNormalized(...)
    try:
        self.db.add(city_normalized)
        self.db.flush()  # Get ID without committing
    except IntegrityError:
        self.db.rollback()
        city_normalized = self.db.query(...).first()  # RACE: Another thread could create here
```

**Fix (Option 1 - Retry with Backoff):**
```python
def _get_or_create_city_normalized(self, normalized_city: str, country_obj):
    """Get or create CityNormalized with retry logic for race conditions."""
    max_retries = 3

    for attempt in range(max_retries):
        # Try to get existing
        city_normalized = self.db.query(CityNormalized).filter_by(
            normalizedCity=normalized_city,
            countryId=country_obj.id
        ).first()

        if city_normalized:
            return city_normalized

        # Try to create new
        city_normalized = CityNormalized(
            normalizedCity=normalized_city,
            countryId=country_obj.id
        )

        try:
            self.db.add(city_normalized)
            self.db.flush()
            return city_normalized
        except IntegrityError:
            self.db.rollback()
            logger.debug(f"Concurrent creation of normalized city {normalized_city}, attempt {attempt + 1}/{max_retries}")

            if attempt < max_retries - 1:
                # Small delay before retry to reduce contention
                import time
                time.sleep(0.01 * (attempt + 1))  # 10ms, 20ms, 30ms
            else:
                # Final attempt - just query
                city_normalized = self.db.query(CityNormalized).filter_by(
                    normalizedCity=normalized_city,
                    countryId=country_obj.id
                ).first()

                if not city_normalized:
                    raise RuntimeError(
                        f"Failed to create or retrieve normalized city {normalized_city} "
                        f"after {max_retries} attempts"
                    )

                return city_normalized
```

**Steps:**
1. Extract the city_normalized creation logic into a new method `_get_or_create_city_normalized()`
2. Add retry logic with exponential backoff
3. Add proper error handling for max retries exceeded
4. Replace inline code (lines 663-679) with call to new method
5. Add logging for concurrent creation attempts

**Testing:**
```bash
# Test 1: Normal operation
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db

# Test 2: Concurrent execution (simulate race condition)
# Run two parsers simultaneously for same country
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db &
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 2 --output db &
wait

# Check for errors or duplicate city entries
# Query database: SELECT normalizedCity, countryId, COUNT(*) FROM CityNormalized GROUP BY normalizedCity, countryId HAVING COUNT(*) > 1;
```

**Success Criteria:**
- [ ] No duplicate CityNormalized entries
- [ ] Retry logic works correctly
- [ ] Concurrent parsers don't crash
- [ ] Debug logs show retry attempts

---

### Task 3.2: Optimize N+1 Query in Artist Concert Linking

**File:** `concert-tracker/scripts/database/writer.py`
**Lines:** 255-290
**Severity:** MINOR
**Issue:** One query per artist when checking existing links (50+ queries for festivals)

**Current Code:**
```python
for idx, artist_name in enumerate(matched_artists):
    artist = self.get_or_create_artist(artist_name, mbid, playcount, playcount_12month)

    # Check if link already exists (ONE QUERY PER ARTIST)
    existing_link = self.session.query(ArtistConcert).filter_by(
        artistId=artist.id,
        concertId=concert.id
    ).first()

    if existing_link:
        # ... update logic
        continue

    # ... create new link
```

**Fix:**
```python
# Before the loop: Batch fetch all existing links
artist_objects = []
for idx, artist_name in enumerate(matched_artists):
    mbid = artist_mbids.get(artist_name) if artist_mbids else None
    playcount = artist_playcounts.get(artist_name, 0) if artist_playcounts else 0
    playcount_12month = artist_playcounts_12month.get(artist_name, 0) if artist_playcounts_12month else 0

    artist = self.get_or_create_artist(artist_name, mbid, playcount, playcount_12month)
    artist_objects.append((idx, artist_name, artist))

# Batch query: Get all existing links for this concert
artist_ids = [artist.id for _, _, artist in artist_objects]
existing_links = self.session.query(ArtistConcert).filter(
    ArtistConcert.artistId.in_(artist_ids),
    ArtistConcert.concertId == concert.id
).all()

# Create lookup dict
existing_links_dict = {link.artistId: link for link in existing_links}

# Now iterate with batch results
for idx, artist_name, artist in artist_objects:
    existing_link = existing_links_dict.get(artist.id)

    if existing_link:
        # ... update logic (unchanged)
        continue

    # ... create new link (unchanged)
```

**Steps:**
1. Locate the `link_artists_to_concert()` method in writer.py
2. Split into two phases:
   - Phase 1: Create all artist objects (lines 255-265)
   - Phase 2: Batch query existing links (new code)
   - Phase 3: Link artists using batch results (lines 270-290)
3. Replace per-artist query with dictionary lookup
4. Test performance improvement

**Testing:**
```bash
# Test 1: Parse concerts and measure query count
# Enable SQL logging in SQLAlchemy to count queries

# Test 2: Parse a festival with many artists (20+)
# Before: Should see 20+ individual SELECT queries
# After: Should see 1 batch SELECT with IN clause

# Test 3: Verify data integrity
# All artists should still be linked correctly
# Primary artist marking should still work
```

**Success Criteria:**
- [ ] Query count reduced from O(n) to O(1) per concert
- [ ] All artists still linked correctly
- [ ] Primary artist logic unchanged
- [ ] Performance measurably improved for large festivals

---

### Task 3.3: Add Missing Null Checks

**File:** `concert-tracker/scripts/services/artist_source_manager.py`
**Lines:** 134-135
**Severity:** MAJOR
**Issue:** Artist could theoretically be None, causing AttributeError

**Current Code:**
```python
for user_artist, artist in user_artists:
    all_artists.add(artist.name)  # If artist is None, crashes here
```

**Fix:**
```python
for user_artist, artist in user_artists:
    if artist and artist.name:
        all_artists.add(artist.name)
    else:
        logger.warning(
            f"Skipping UserArtist entry with missing Artist object "
            f"(user_id={self.user_id}, user_artist_id={user_artist.id if user_artist else 'unknown'})"
        )
```

**Steps:**
1. Add null checks for artist object
2. Add null check for artist.name
3. Log warning when skipping invalid entries
4. Consider adding database constraint to prevent this

**Additional Files to Check:**
Search for similar patterns:
```bash
cd concert-tracker/scripts
grep -rn "for.*artist in" --include="*.py" | grep -v "test_"
```

**Testing:**
```bash
# Test 1: Normal operation
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db

# Test 2: Force null artist (database manipulation)
# Temporarily remove foreign key constraint or set artistId to invalid value
# Verify warning appears and script doesn't crash

# Test 3: Check database integrity
# SELECT * FROM UserArtist WHERE artistId NOT IN (SELECT id FROM Artist);
# Should return 0 rows
```

**Success Criteria:**
- [ ] No AttributeError on artist.name
- [ ] Warning logged for invalid entries
- [ ] Script continues processing valid artists
- [ ] Database constraint added (optional)

---

## Phase 4: Code Organization & Architecture

**Goal:** Refactor complex classes and improve maintainability
**Estimated Time:** 5-7 days
**Files Modified:** 5+

### Task 4.1: Extract Metadata Phases into Methods

**File:** `concert-tracker/scripts/fetch_metadata.py`
**Lines:** Throughout file (434 lines total)
**Severity:** MINOR
**Issue:** Deeply nested logic, multiple overlapping responsibilities

**Current Structure:**
```python
def process_artists(self, all_artists, artists_without_mbid, ...):
    # 200+ lines of interleaved logic for all 4 phases
    # Phase 0: MBID repair (lines 172-201)
    # Phase 1: Process artists without MBID (lines 256-310)
    # Phase 2: Fetch images (lines 312-354)
    # Phase 3: Refresh playcounts (lines 356-414)
```

**Fix - Extract Methods:**
```python
def process_artists(self, all_artists, artists_without_mbid, ...):
    """Main orchestration method for all metadata phases."""
    logger.info("Starting metadata processing")

    # Phase 0: Repair existing MBIDs
    if self.args.repair_mbids:
        self._phase_0_repair_mbids(all_artists)

    # Phase 1: Fetch MBIDs for artists missing them
    if artists_without_mbid and not self.args.images_only:
        self._phase_1_fetch_mbids(artists_without_mbid)

    # Phase 2: Fetch images for artists with MBIDs
    if self.args.images_only or (self.args.fetch_images and artists_with_mbid):
        self._phase_2_fetch_images(artists_with_mbid)

    # Phase 3: Refresh playcounts
    if self.args.refresh_playcounts:
        self._phase_3_refresh_playcounts(artists_for_refresh)

    logger.info("Metadata processing complete")

def _phase_0_repair_mbids(self, all_artists: List[Artist]) -> None:
    """
    Phase 0: Repair MBIDs for artists that have incorrect/missing values.

    Args:
        all_artists: All artists from database
    """
    logger.info("Phase 0: Repairing MBIDs")
    # Extract lines 172-201 here
    # ...

def _phase_1_fetch_mbids(self, artists_without_mbid: List[Artist]) -> None:
    """
    Phase 1: Fetch MBIDs from MusicBrainz for artists missing them.

    Args:
        artists_without_mbid: Artists without MBID values
    """
    logger.info(f"Phase 1: Fetching MBIDs for {len(artists_without_mbid)} artists")
    # Extract lines 256-310 here
    # ...

def _phase_2_fetch_images(self, artists_with_mbid: List[Artist]) -> None:
    """
    Phase 2: Fetch high-resolution images from Fanart.tv.

    Args:
        artists_with_mbid: Artists with valid MBIDs
    """
    logger.info(f"Phase 2: Fetching images for {len(artists_with_mbid)} artists")
    # Extract lines 312-354 here
    # ...

def _phase_3_refresh_playcounts(self, artists: List[Artist]) -> None:
    """
    Phase 3: Refresh Last.fm playcount statistics.

    Args:
        artists: Artists to refresh playcounts for
    """
    logger.info(f"Phase 3: Refreshing playcounts for {len(artists)} artists")
    # Extract lines 356-414 here
    # ...
```

**Steps:**
1. Create four new private methods (prefixed with `_phase_*`)
2. Move phase-specific code from `process_artists()` to new methods
3. Update `process_artists()` to be orchestration only
4. Add docstrings to each phase method
5. Ensure phase logic is self-contained (pass all needed data as parameters)
6. Add logging at start/end of each phase

**Testing:**
```bash
# Test all phases individually
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py --user-id 1 --repair-mbids
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py --user-id 1 --limit 5
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py --user-id 1 --fetch-images --limit 5
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py --user-id 1 --refresh-playcounts

# Test combined
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py --user-id 1 --limit 10 --fetch-images
```

**Success Criteria:**
- [ ] `process_artists()` method < 50 lines
- [ ] Each phase in separate method
- [ ] All phases work independently
- [ ] All phases work in combination
- [ ] No functionality broken

---

### Task 4.2: Refactor CityNormalizer into Smaller Classes

**File:** `concert-tracker/scripts/database/normalizers/city.py`
**Lines:** Throughout file (761 lines)
**Severity:** MINOR
**Issue:** Too many responsibilities (text normalization, geocoding, clustering, API calls)

**Current Structure:**
```python
class CityNormalizer:
    # 761 lines doing everything
    def normalize_text(...)        # Lines 121-150
    def check_manual_mapping(...)  # Lines 101-119
    def geocode_with_nominatim(...) # Lines 268-352
    def cluster_results(...)       # Lines 401-462
    def query_overpass(...)        # Lines 464-609
    def haversine_distance(...)    # Lines 611-632
```

**Fix - New Structure:**

**File 1: `concert-tracker/scripts/database/normalizers/city_text.py` (NEW)**
```python
"""Text normalization utilities for city names."""

from unidecode import unidecode
import re

class CityTextNormalizer:
    """Handles text normalization for city names."""

    ABBREVIATIONS = {
        ' saint ': ' st ',
        ' sainte ': ' ste ',
        # ... rest of abbreviations
    }

    @classmethod
    def normalize(cls, city: str) -> str:
        """
        Normalize city name to lowercase, remove diacritics, standardize spacing.

        Args:
            city: Original city name

        Returns:
            Normalized city name
        """
        result = city.lower()

        # Apply abbreviations
        for abbr, full in cls.ABBREVIATIONS.items():
            result = result.replace(abbr, full)

        # Remove diacritics
        result = unidecode(result)

        # Normalize whitespace
        result = re.sub(r'\s+', ' ', result).strip()

        return result
```

**File 2: `concert-tracker/scripts/database/normalizers/city_geocode.py` (NEW)**
```python
"""Geocoding services for city names."""

from typing import Optional, Tuple, List, Dict
import time
import requests
from utils.logging_config import get_logger

logger = get_logger(__name__)

class GeocodeService:
    """Handles geocoding API calls to Nominatim."""

    def __init__(self, rate_limit_delay: float = 1.0):
        self.rate_limit_delay = rate_limit_delay
        self.last_request_time = 0

    def geocode_city(
        self,
        city: str,
        country_code: str
    ) -> Optional[Tuple[float, float, str]]:
        """
        Geocode a city using Nominatim API.

        Args:
            city: City name
            country_code: ISO country code

        Returns:
            (latitude, longitude, display_name) or None if not found
        """
        # Rate limiting
        elapsed = time.time() - self.last_request_time
        if elapsed < self.rate_limit_delay:
            time.sleep(self.rate_limit_delay - elapsed)

        try:
            # ... extract geocoding logic from lines 268-352
            pass
        finally:
            self.last_request_time = time.time()

class OverpassService:
    """Handles Overpass API queries for city boundaries."""

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.base_url = "https://overpass-api.de/api/interpreter"

    def query_city_boundary(
        self,
        city: str,
        country_code: str
    ) -> Optional[Dict]:
        """
        Query Overpass API for city boundary data.

        Args:
            city: City name
            country_code: ISO country code

        Returns:
            GeoJSON response or None
        """
        # ... extract from lines 464-609
        pass
```

**File 3: `concert-tracker/scripts/database/normalizers/city.py` (REFACTORED)**
```python
"""
City normalization and mapping management.

Coordinates text normalization, manual mappings, and geocoding services.
"""

from typing import Optional, Tuple
from sqlalchemy.orm import Session
from database.models import CityNormalized, CityMapping, Country
from .city_text import CityTextNormalizer
from .city_geocode import GeocodeService, OverpassService
from utils.logging_config import get_logger

logger = get_logger(__name__)

class CityNormalizer:
    """
    High-level orchestrator for city normalization.

    Coordinates:
    - Text normalization (via CityTextNormalizer)
    - Manual mapping lookups (database)
    - Geocoding (via GeocodeService/OverpassService)
    - Database persistence
    """

    def __init__(self, db: Session, verbose: bool = False):
        self.db = db
        self.verbose = verbose
        self.text_normalizer = CityTextNormalizer()
        self.geocode_service = GeocodeService()
        self.overpass_service = OverpassService()

    def normalize_city(
        self,
        original_city: str,
        country_obj: Country
    ) -> Tuple[CityNormalized, CityMapping]:
        """
        Main entry point for city normalization.

        Args:
            original_city: Original city name from source
            country_obj: Country object

        Returns:
            (CityNormalized, CityMapping) tuple
        """
        # Step 1: Check manual mapping
        manual_mapping = self._check_manual_mapping(original_city, country_obj)
        if manual_mapping:
            return manual_mapping.cityNormalized, manual_mapping

        # Step 2: Text normalization
        normalized_text = self.text_normalizer.normalize(original_city)

        # Step 3: Get or create normalized city
        city_normalized = self._get_or_create_city_normalized(
            normalized_text,
            country_obj
        )

        # Step 4: Get or create mapping
        city_mapping = self._get_or_create_city_mapping(
            original_city,
            city_normalized,
            country_obj
        )

        return city_normalized, city_mapping

    # ... rest of methods (simplified, delegating to services)
```

**Steps:**
1. Create `city_text.py` with `CityTextNormalizer` class
2. Create `city_geocode.py` with `GeocodeService` and `OverpassService` classes
3. Refactor `city.py` to orchestrate the services
4. Move text normalization logic to `CityTextNormalizer`
5. Move geocoding logic to `GeocodeService`
6. Move Overpass logic to `OverpassService`
7. Update imports in files that use `CityNormalizer`
8. Test each service independently

**Testing:**
```bash
# Test text normalization
~/lastfm-parser/venv/bin/python -c "
from concert_tracker.scripts.database.normalizers.city_text import CityTextNormalizer
assert CityTextNormalizer.normalize('İstanbul') == 'istanbul'
assert CityTextNormalizer.normalize('Saint Petersburg') == 'st petersburg'
print('Text normalization: PASS')
"

# Test geocoding service
~/lastfm-parser/venv/bin/python -c "
from concert_tracker.scripts.database.normalizers.city_geocode import GeocodeService
service = GeocodeService()
result = service.geocode_city('Istanbul', 'tr')
assert result is not None
assert len(result) == 3
print(f'Geocoding: PASS - {result}')
"

# Test full pipeline
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db
```

**Success Criteria:**
- [ ] `city.py` reduced to < 300 lines
- [ ] Each service class < 200 lines
- [ ] Services independently testable
- [ ] All existing functionality preserved
- [ ] No breaking changes to public API

---

## Phase 5: Documentation & Type Hints

**Goal:** Add comprehensive documentation and type hints
**Estimated Time:** 2-3 days
**Files Modified:** All Python files

### Task 5.1: Add Type Hints to Public APIs

**Files:** All `.py` files in `scripts/` directory
**Severity:** MINOR
**Issue:** Missing type annotations make code harder to understand and maintain

**Pattern:**
```python
# Before
def get_or_create_artist(self, name, mbid=None, playcount=0, playcount_12month=0):
    ...

# After
from typing import Optional

def get_or_create_artist(
    self,
    name: str,
    mbid: Optional[str] = None,
    playcount: int = 0,
    playcount_12month: int = 0
) -> Artist:
    ...
```

**Priority Files:**
1. `database/writer.py` - All public methods
2. `services/metadata_service.py` - All public methods
3. `services/artist_source_manager.py` - All methods
4. `parsers/country_parser.py` - Parse methods
5. `config/manager.py` - All public methods

**Steps (per file):**
1. Add imports: `from typing import Optional, List, Dict, Tuple, Set, Any`
2. Add parameter type hints
3. Add return type hints
4. Run mypy to check: `mypy concert-tracker/scripts/database/writer.py`
5. Fix any type errors found

**Testing:**
```bash
# Install mypy if not present
~/lastfm-parser/venv/bin/pip install mypy

# Check individual files
~/lastfm-parser/venv/bin/python -m mypy concert-tracker/scripts/database/writer.py
~/lastfm-parser/venv/bin/python -m mypy concert-tracker/scripts/services/metadata_service.py

# Check all scripts
~/lastfm-parser/venv/bin/python -m mypy concert-tracker/scripts/ --exclude 'tests/'
```

**Success Criteria:**
- [ ] All public methods have type hints
- [ ] Mypy passes with no errors on strict mode
- [ ] Documentation updated with types
- [ ] IDE autocomplete works better

---

### Task 5.2: Add/Update Docstrings

**Files:** All `.py` files lacking docstrings
**Severity:** MINOR
**Priority:**
1. `config/manager.py` - Methods missing docstrings
2. `database/writer.py` - Update misleading docstrings
3. `services/*` - Add missing docstrings
4. `parsers/*` - Add missing docstrings

**Pattern (Google Style):**
```python
def link_artists_to_concert(
    self,
    concert: Concert,
    matched_artists: List[str],
    artist_mbids: Optional[Dict[str, str]] = None,
    artist_playcounts: Optional[Dict[str, int]] = None,
    artist_playcounts_12month: Optional[Dict[str, int]] = None,
    recent_artists: Optional[Set[str]] = None
) -> None:
    """
    Create ArtistConcert links for all matched artists.

    Creates Artist records if they don't exist. Updates existing primary
    artist links if they already exist (not just first scan wins).
    Also creates/updates UserArtist records for all matched artists.

    Args:
        concert: Concert object to link artists to
        matched_artists: List of artist names to link
        artist_mbids: Optional dict of artist name -> MBID
        artist_playcounts: Optional dict of artist name -> playcount
        artist_playcounts_12month: Optional dict of artist name -> 12-month playcount
        recent_artists: Optional set of recently played artists (for priority)

    Returns:
        None

    Raises:
        IntegrityError: If database constraint violated

    Example:
        >>> writer.link_artists_to_concert(
        ...     concert=concert_obj,
        ...     matched_artists=['Metallica', 'Slayer'],
        ...     artist_mbids={'Metallica': '65f4f0c5-...'}
        ... )
    """
    # Implementation...
```

**Steps:**
1. Identify methods without docstrings:
```bash
cd concert-tracker/scripts
grep -rn "def " --include="*.py" -A 1 | grep -v '"""' | grep -v "test_"
```

2. Add docstrings following Google style guide
3. Update incorrect docstrings (like in writer.py:197)
4. Include examples for complex methods
5. Document all exceptions raised

**Testing:**
```bash
# Generate documentation with pydoc
~/lastfm-parser/venv/bin/python -m pydoc concert_tracker.scripts.database.writer

# Or use sphinx
# pip install sphinx
# sphinx-apidoc -o docs/api concert-tracker/scripts
```

**Success Criteria:**
- [ ] All public methods have docstrings
- [ ] All parameters documented
- [ ] Return values documented
- [ ] Exceptions documented
- [ ] Examples provided for complex APIs

---

### Task 5.3: Fix Misleading Documentation

**File:** `concert-tracker/scripts/database/writer.py`
**Lines:** 197-205
**Severity:** MINOR
**Issue:** Docstring says "only creates ONE primary" but code updates existing primaries

**Current Docstring:**
```python
def link_artists_to_concert(...):
    """Create ArtistConcert links for all matched artists

    Creates Artist records if they don't exist (for additional artists beyond primary).
    Also creates/updates UserArtist records for all matched artists.
    Only creates ONE primary artist link per concert (first scan wins).
    """
```

**Current Code Behavior (line 244):**
```python
existing_primary = self.session.query(ArtistConcert).filter_by(
    concertId=concert.id,
    isPrimary=True
).first()

if existing_primary is None:  # <- Actually updates if primary exists!
    is_primary = True
```

**Fix Documentation:**
```python
def link_artists_to_concert(...):
    """
    Create ArtistConcert links for all matched artists.

    Creates Artist records if they don't exist. Marks the first artist in
    matched_artists as primary if no primary exists yet. Subsequent scans
    will not override the existing primary artist.

    Also creates/updates UserArtist records for all matched artists with
    playcount statistics.

    Args:
        concert: Concert to link artists to
        matched_artists: List of artist names (first one considered headliner)
        artist_mbids: Optional MBID mappings
        artist_playcounts: Optional overall playcount mappings
        artist_playcounts_12month: Optional 12-month playcount mappings
        recent_artists: Optional set of recently played artists

    Behavior:
        - First artist in matched_artists becomes primary if none exists
        - Existing primary is never overridden
        - All artists linked via ArtistConcert junction table
        - UserArtist records updated with latest playcounts
    """
```

**Steps:**
1. Review code logic (lines 244-250)
2. Update docstring to match actual behavior
3. Add "Behavior" section to clarify primary artist logic
4. Document all side effects (UserArtist updates)

**Testing:**
```bash
# Test primary artist behavior
# 1. Parse concerts for user 1 (establishes primaries)
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db

# 2. Parse same concerts for user 2
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 2 --output db

# 3. Verify primaries unchanged
# Query: SELECT c.eventName, a.name, ac.isPrimary FROM Concert c JOIN ArtistConcert ac ON c.id = ac.concertId JOIN Artist a ON ac.artistId = a.id WHERE ac.isPrimary = 1;
```

**Success Criteria:**
- [ ] Docstring accurately describes code behavior
- [ ] Primary artist logic clearly documented
- [ ] Side effects documented
- [ ] Examples provided

---

## Phase 6: Cleanup & Dead Code Removal

**Goal:** Remove unused code, variables, and misleading comments
**Estimated Time:** 1-2 days
**Files Modified:** 5+

### Task 6.1: Remove Unused Function Parameters

**File:** `concert-tracker/scripts/parse_concerts.py`
**Lines:** 46-55
**Severity:** MINOR
**Issue:** Docstring mentions parameters not in function signature

**Current Code:**
```python
def finalize_and_cleanup(db_writer, args, data_to_save):
    """Finalize database writes and fetch metadata for artists

    Args:
        db_writer: Database writer instance (or None)
        args: Command line arguments
        data_to_save: Concerts to save
        all_concerts: All concerts (for --save-all)  # <- NOT IN SIGNATURE
        filtering_artists: filtered artists set     # <- NOT IN SIGNATURE
    """
```

**Fix:**
```python
def finalize_and_cleanup(
    db_writer: Optional[ConcertDatabaseWriter],
    args: argparse.Namespace,
    data_to_save: List[Dict]
) -> None:
    """
    Finalize database writes and optionally trigger metadata enrichment.

    Args:
        db_writer: Database writer instance (None if using JSON output)
        args: Command line arguments with user settings
        data_to_save: List of concert dictionaries to save

    Side Effects:
        - Commits database transaction (if db_writer provided)
        - May spawn metadata fetch subprocess
        - Prints summary statistics
    """
```

**Steps:**
1. Remove references to `all_concerts` and `filtering_artists` from docstring
2. Update docstring with accurate parameter list
3. Add type hints
4. Add "Side Effects" section to clarify what happens

**Testing:**
```bash
# Verify function still works
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output json
```

**Success Criteria:**
- [ ] Docstring matches function signature
- [ ] Type hints added
- [ ] Function works unchanged
- [ ] No references to removed parameters

---

### Task 6.2: Remove Unused Variables

**File:** `concert-tracker/scripts/config/manager.py`
**Lines:** 306
**Severity:** MINOR
**Issue:** `default_value` unpacked but never used

**Current Code:**
```python
default_value, default_type, _ = self.DEFAULTS.get(key, (None, 'string', None))
return env_value, default_type  # <- default_value never used
```

**Fix:**
```python
_, default_type, _ = self.DEFAULTS.get(key, (None, 'string', None))
return env_value, default_type
```

**Steps:**
1. Replace `default_value` with `_` to indicate intentionally unused
2. Check if default_value was meant to be used (logic bug?)
3. If not a bug, simplify

**Alternative (if default_value should be used):**
```python
default_value, default_type, _ = self.DEFAULTS.get(key, (None, 'string', None))
# Use default_value if env_value is None?
final_value = env_value if env_value is not None else default_value
return final_value, default_type
```

**Investigation Required:**
Review the logic to determine if this is:
1. Dead code (variable not needed) → Remove it
2. Logic bug (should use default_value) → Fix it

**Testing:**
```bash
# Test config retrieval with various scenarios
~/lastfm-parser/venv/bin/python -c "
from concert_tracker.scripts.config.manager import ConfigManager
config = ConfigManager()
value, type_ = config._get_from_env('LASTFM_API_KEY')
print(f'Value: {value}, Type: {type_}')
"
```

**Success Criteria:**
- [ ] No unused variable warnings
- [ ] Logic verified correct
- [ ] Functionality unchanged

---

### Task 6.3: Clean Up Commented Code

**Files:** Search all `.py` files
**Severity:** MINOR
**Issue:** Old commented code blocks confuse readers

**Search for Commented Code:**
```bash
cd concert-tracker/scripts
grep -rn "^[[:space:]]*#.*def \|^[[:space:]]*#.*class \|^[[:space:]]*#.*import " --include="*.py" | grep -v "test_"
```

**Steps:**
1. Review each commented code block
2. Determine if it's:
   - Dead code → Remove entirely
   - TODO for future → Convert to proper TODO comment
   - Important context → Convert to docstring or regular comment
3. Remove all dead commented code
4. Keep only meaningful comments

**Example Cleanup:**
```python
# Before
# def old_method(self):
#     # This was the old way
#     return None

# After (if truly dead code)
# Removed entirely

# After (if it's a TODO)
# TODO: Implement new method to replace old_method
#       Old implementation used X approach, but we need Y
```

**Testing:**
```bash
# Verify no functionality broken
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py --user-id 1 --limit 5
```

**Success Criteria:**
- [ ] No large blocks of commented code
- [ ] All comments serve a purpose
- [ ] TODOs properly marked
- [ ] Functionality unchanged

---

## Phase 7: Testing & Validation

**Goal:** Ensure all fixes work correctly and no regressions introduced
**Estimated Time:** 2-3 days
**Files Modified:** Test files

### Task 7.1: Run Existing Test Suite

**Directory:** `concert-tracker/scripts/tests/`
**Files:** All `test_*.py` files

**Steps:**
```bash
# Run all Phase 7 tests
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/run_phase7_tests.py

# Run individual integration tests
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_scenario_b_userartist_only.py
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_scenario_c_no_sources.py
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_scenario_d_no_filter.py
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_scenario_e_metadata_no_lastfm.py

# Run service tests
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_mb_service.py
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_artist_source_manager.py
```

**Expected Results:**
- All tests should pass
- No new errors introduced
- Performance not degraded

**Success Criteria:**
- [ ] All existing tests pass
- [ ] No new test failures
- [ ] No performance regressions

---

### Task 7.2: Integration Testing

**Goal:** Test complete workflows end-to-end

**Test Scenarios:**

**Scenario 1: Full Concert Parsing Flow**
```bash
# 1. Parse concerts for user 1
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py \
    --user-id 1 \
    --output db \
    --use-proxies webshare

# 2. Fetch metadata
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py \
    --user-id 1 \
    --limit 50 \
    --fetch-images

# 3. Verify data in database
# Query concerts, artists, user_concerts, artist_concerts

# 4. Check logs for any errors or warnings
```

**Scenario 2: Concurrent Parsing (Race Condition Test)**
```bash
# Run two parsers simultaneously
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db &
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 2 --output db &
wait

# Verify:
# 1. No duplicate city mappings
# 2. No database integrity errors
# 3. Both parsers completed successfully
```

**Scenario 3: Error Recovery**
```bash
# Test with invalid credentials (should fail gracefully)
# Temporarily modify .env to have wrong API key
~/lastfm-parser/venv/bin/python concert-tracker/scripts/fetch_metadata.py --user-id 1

# Expected: Clear error message, no stack trace, proper cleanup
```

**Scenario 4: Logging Verification**
```bash
# Test logging output
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output json 2>&1 | tee test_log.txt

# Verify:
# 1. Colors in terminal
# 2. Proper log levels (INFO, WARNING, ERROR)
# 3. No print() statements
# 4. Structured output
```

**Success Criteria:**
- [ ] All scenarios pass
- [ ] No database corruption
- [ ] No resource leaks
- [ ] Proper error handling
- [ ] Logs readable and useful

---

### Task 7.3: Performance Testing

**Goal:** Verify no performance regressions

**Benchmark Scripts:**

**Test 1: Artist Linking Performance**
```bash
# Before optimization (save baseline)
time ~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py \
    --user-id 1 \
    --output db

# After optimization
# Should be faster, especially for festivals with many artists
```

**Test 2: Database Query Counts**
```python
# Add to parse_concerts.py for testing:
from sqlalchemy import event
from sqlalchemy.engine import Engine
import logging

query_count = 0

@event.listens_for(Engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    global query_count
    query_count += 1

# Run and check query_count before/after optimization
```

**Expected Improvements:**
- Task 3.2 (N+1 fix): Query count should drop by ~50+ per concert for large festivals
- Logging: Minimal performance impact (< 5%)
- City normalization refactor: No performance change

**Success Criteria:**
- [ ] N+1 query fix shows measurable improvement
- [ ] No regressions in parse time
- [ ] Memory usage unchanged or improved

---

## Phase 8: Documentation Updates

**Goal:** Update all documentation to reflect changes
**Estimated Time:** 1 day
**Files Modified:** Documentation files

### Task 8.1: Update CLAUDE.md

**File:** `/home/vyushmanov/lastfm-parser/CLAUDE.md`
**Changes Required:**

1. Add logging section:
```markdown
### Logging

All Python scripts use centralized logging infrastructure:

```python
from utils.logging_config import setup_logging, get_logger

logger = get_logger(__name__)

def main():
    setup_logging(verbose=args.verbose)
    logger.info("Starting process")
```

**Log Levels:**
- DEBUG: Detailed diagnostic information (use --verbose)
- INFO: General progress messages
- WARNING: Non-critical issues (e.g., missing optional data)
- ERROR: Critical failures

**Configuration:**
- Console output: Colored, concise
- File output: Full detail with timestamps (if log_file specified)
```

2. Update error handling section:
```markdown
### Error Handling

**Patterns:**
- Use specific exception types (not bare `except:`)
- Always log exceptions with context
- Provide helpful error messages to users
- Clean up resources in finally blocks

**Example:**
```python
try:
    result = risky_operation()
except SpecificError as e:
    logger.error(f"Operation failed for {context}: {e}", exc_info=True)
    raise
finally:
    cleanup_resources()
```
```

3. Update city normalization section with new architecture

**Steps:**
1. Open CLAUDE.md
2. Add new "Logging" section under "Key Implementation Patterns"
3. Update "Error Handling" section
4. Update "City Normalization" with new multi-class structure
5. Add note about Phase 8 completion date

**Success Criteria:**
- [ ] CLAUDE.md reflects all major changes
- [ ] New patterns documented
- [ ] Examples provided
- [ ] Links to relevant code

---

### Task 8.2: Create Migration Guide

**File:** `docs/CODE_QUALITY_MIGRATION_GUIDE.md` (NEW)
**Purpose:** Help developers understand what changed and how to adapt

**Content:**
```markdown
# Code Quality Fixes - Migration Guide

**Date:** November 2025
**Related:** CODE_QUALITY_FIXES_2025-11-17.md

## Breaking Changes

### Logging (Phase 2)

**Before:**
```python
print("Processing artists...")
```

**After:**
```python
from utils.logging_config import get_logger
logger = get_logger(__name__)
logger.info("Processing artists...")
```

**Migration:**
1. Add logging imports to your script
2. Replace all `print()` with appropriate log level
3. Add `setup_logging()` call in main()

---

### City Normalizer (Phase 4)

**Before:**
```python
from database.normalizers.city import CityNormalizer
normalizer = CityNormalizer(db)
```

**After:**
```python
# Same interface, but now composed of smaller services
from database.normalizers.city import CityNormalizer
normalizer = CityNormalizer(db)  # Unchanged!

# Can also use services directly:
from database.normalizers.city_text import CityTextNormalizer
text_norm = CityTextNormalizer.normalize("İstanbul")
```

**Migration:**
- No changes required if using `CityNormalizer`
- New services available for unit testing

---

## New Features

### Type Hints (Phase 5)

All public APIs now have full type hints. Enable type checking:

```bash
pip install mypy
mypy your_script.py
```

### Better Error Messages (Phase 2)

Exceptions now logged with context. Use `--verbose` for debugging:

```bash
python parse_concerts.py --user-id 1 --output db --verbose
```

---

## Deprecations

None. All changes are backward compatible.

---

## Performance Improvements

1. **Artist Linking:** 50+ fewer queries per concert (Phase 3.2)
2. **City Normalization:** Retry logic prevents race conditions (Phase 3.1)

---

## Security Improvements

1. **SSL Warnings:** Now explicitly logs when SSL verification disabled (Phase 1.2)
2. **Session Cleanup:** Guaranteed cleanup on all error paths (Phase 1.1, 1.3)
```

**Steps:**
1. Create new file
2. Document all breaking changes (there shouldn't be any!)
3. Document new features
4. Provide migration examples
5. Link from main README

**Success Criteria:**
- [ ] Migration guide created
- [ ] All changes documented
- [ ] Examples provided
- [ ] Linked from README

---

### Task 8.3: Update README

**File:** `/home/vyushmanov/lastfm-parser/README.md`
**Changes:**

1. Add reference to code quality fixes:
```markdown
## Recent Updates

- **November 2025:** Major code quality improvements
  - Centralized logging infrastructure
  - Fixed resource leaks and race conditions
  - Comprehensive type hints
  - See [docs/CODE_QUALITY_FIXES_2025-11-17.md](docs/CODE_QUALITY_FIXES_2025-11-17.md) for details
```

2. Update Python scripts section with logging examples

3. Add troubleshooting section:
```markdown
## Troubleshooting

### Enable Verbose Logging

All scripts support `--verbose` flag for detailed output:

```bash
python scripts/parse_concerts.py --user-id 1 --output db --verbose
```

### Check Logs

Logs include:
- INFO: Normal progress
- WARNING: Non-critical issues
- ERROR: Critical failures

Use `2>&1 | tee log.txt` to save output.
```

**Steps:**
1. Open README.md
2. Add "Recent Updates" section
3. Update examples with logging
4. Add troubleshooting section
5. Test all code examples still work

**Success Criteria:**
- [ ] README updated
- [ ] All examples tested
- [ ] Links work
- [ ] Formatting correct

---

## Completion Checklist

### Phase 1: Critical Fixes ✅ COMPLETE
- [x] Task 1.1: Session cleanup fixed
- [x] Task 1.2: SSL warnings added
- [x] Task 1.3: ConfigManager leak fixed
- [x] All critical tests pass

### Phase 2: Logging ✅ COMPLETE
- [x] Task 2.1: Logging infrastructure created
- [x] Task 2.2: parse_concerts.py migrated
- [x] Task 2.3: fetch_metadata.py migrated
- [x] Task 2.4: Silent exceptions fixed
- [x] All print() statements replaced
- [x] country_parser.py fully converted (additional task)

### Phase 3: Database ✅ COMPLETE
- [x] Task 3.1: Race condition fixed
- [x] Task 3.2: N+1 query optimized
- [x] Task 3.3: Null checks added
- [x] Syntax checks pass

### Phase 4: Architecture ✅ COMPLETE
- [x] Task 4.1: Metadata phases extracted
- [x] Task 4.2: City normalizer refactored
- [x] All refactored code tested (syntax verified)

### Phase 5: Documentation ✅ COMPLETE
- [x] Task 5.1: Type hints added (5 priority files)
- [x] Task 5.2: Docstrings added/updated
- [x] Task 5.3: Misleading docs fixed
- [x] Critical mypy errors resolved

### Phase 6: Cleanup (NOT STARTED)
- [ ] Task 6.1: Unused parameters removed
- [ ] Task 6.2: Unused variables removed
- [ ] Task 6.3: Commented code cleaned
- [ ] Code quality verified

### Phase 7: Testing (NOT STARTED)
- [ ] Task 7.1: Existing tests pass
- [ ] Task 7.2: Integration tests pass
- [ ] Task 7.3: Performance tests pass
- [ ] No regressions found

### Phase 8: Documentation (NOT STARTED)
- [ ] Task 8.1: CLAUDE.md updated
- [ ] Task 8.2: Migration guide created
- [ ] Task 8.3: README updated
- [ ] All docs reviewed

---

## Appendix A: Testing Commands Reference

```bash
# Phase 1 Tests
~/lastfm-parser/venv/bin/python concert-tracker/scripts/add_country.py --code tr --name Turkey
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output json 2>&1 | grep SSL

# Phase 2 Tests
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db --verbose

# Phase 3 Tests
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 1 --output db &
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --user-id 2 --output db &
wait

# Phase 5 Tests
~/lastfm-parser/venv/bin/python -m mypy concert-tracker/scripts/ --exclude tests/

# Phase 7 Tests
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/run_phase7_tests.py
```

---

## Appendix B: Rollback Procedures

If issues are found after deployment:

### Rollback Phase 2 (Logging)
```bash
# Revert to previous commit
git revert <commit-hash>

# Or manually revert logging imports
# Replace logger.info() with print()
```

### Rollback Phase 3 (Database)
```bash
# Database changes are backward compatible
# No rollback needed unless data corruption occurs
```

### Rollback Phase 4 (Architecture)
```bash
# Restore original city.py from git history
git checkout <previous-commit> -- concert-tracker/scripts/database/normalizers/city.py
```

---

## Appendix C: Future Improvements

Issues deferred for future work:

1. **Context Managers for Sessions**
   - Replace try/finally with context managers
   - Requires: SQLAlchemy context manager wrapper

2. **Async/Await for API Calls**
   - Use aiohttp for parallel API requests
   - Requires: Python 3.9+, async refactor

3. **Prometheus Metrics**
   - Add metrics for monitoring
   - Requires: Prometheus client library

4. **Database Connection Pooling**
   - Improve concurrency handling
   - Requires: SQLAlchemy pool configuration

5. **Structured Logging (JSON)**
   - Machine-readable logs
   - Requires: python-json-logger

---

**Document Version:** 1.5
**Last Updated:** November 20, 2025
**Status:** Phases 1-5 Complete, Ready for Phase 6
**Estimated Remaining Time:** 4-7 days (1-2 sprints)
