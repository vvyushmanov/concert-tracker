# Python Backend Refactoring Plan

## Overview

Refactoring the Python backend scripts to improve modularity, testability, and maintainability by extracting services, creating clear separation of concerns, and organizing code into a proper module structure.

## Problems Identified

1. **Monolithic scripts** - `country_concert_parser.py` (1128 lines) and `fetch_artist_metadata.py` (641 lines) are too large
2. **Mixed concerns** - Parser classes contain HTTP logic, business logic, CLI handling, and data processing
3. **Tight coupling** - Hard to test individual components
4. **Duplicated patterns** - HTTP session management, logging, rate limiting appear in multiple places
5. **Unclear boundaries** - Some utilities are in `concert_utils.py`, others embedded in main scripts

## New Module Structure

```
concert-tracker/scripts/
├── core/                          # Core business logic
│   ├── __init__.py
│   ├── models.py                  # Data classes/types
│   └── exceptions.py              # Custom exceptions
│
├── parsers/                       # Parsing logic
│   ├── __init__.py
│   ├── base_parser.py            # Abstract base parser
│   ├── concert_parser.py         # Concert parsing logic
│   └── html_extractor.py         # HTML extraction methods
│
├── services/                      # External service integrations
│   ├── __init__.py
│   ├── http_client.py            # ✅ Shared HTTP session management
│   ├── lastfm_service.py         # ✅ Last.fm API client
│   ├── fanart_service.py         # ✅ Fanart.tv API client
│   └── geocoding_service.py      # Geocoding API client
│
├── database/                      # Database layer
│   ├── __init__.py
│   ├── models.py                 # (rename db_models.py)
│   ├── writer.py                 # (rename db_writer.py)
│   ├── config.py                 # (rename db_config.py)
│   └── normalizers/
│       ├── __init__.py
│       ├── city.py               # (rename city_normalizer.py)
│       └── country.py            # (rename country_helper.py)
│
├── config/                        # Configuration management
│   ├── __init__.py
│   ├── manager.py                # (rename config_manager.py)
│   └── user.py                   # (rename user_config.py)
│
├── utils/                         # Shared utilities
│   ├── __init__.py
│   ├── logging.py                # ✅ Centralized logging
│   ├── rate_limiter.py           # ✅ Rate limiting logic
│   └── data_transform.py         # ✅ Data transformation
│
├── cli/                           # CLI entry points
│   ├── __init__.py
│   ├── parse_concerts.py         # Main concert parser CLI
│   ├── fetch_metadata.py         # Metadata fetcher CLI
│   └── manage_countries.py       # Country management CLI
│
└── [existing utility scripts]     # Keep as-is for now
    ├── proxy_manager.py
    ├── concert_utils.py          # ✅ Backward-compatible wrappers
    ├── add_country.py
    ├── invalidate_cache.py
    └── startup.sh
```

## Implementation Phases

### Phase 1: Extract Services ✅ COMPLETE

**Status:** ✅ Complete  
**Date:** Nov 5, 2025

**Completed:**
- ✅ Created new directory structure
- ✅ Extracted `HTTPClient` service from parser
  - Session management with connection pooling
  - Proxy rotation support
  - User agent rotation
  - Retry logic
  - SSL handling
- ✅ Extracted `LastFMService` from `concert_utils.py`
  - `fetch_top_artists()` - Get user's top artists with filtering
  - `fetch_all_user_artists()` - Bulk fetch for efficiency
  - `lookup_artist_playcounts()` - Lookup from pre-fetched data
  - `get_artist_info()` - Individual artist lookup
- ✅ Extracted `FanartService` from `fetch_artist_metadata.py`
  - `fetch_artist_image()` - Get artist images with priority fallback
- ✅ Created utility modules
  - `utils/logging.py` - Centralized logging functions
  - `utils/rate_limiter.py` - Rate limiting with randomization
  - `utils/data_transform.py` - Data transformation utilities
- ✅ Updated `concert_utils.py` with backward-compatible wrappers
- ✅ Updated `fetch_artist_metadata.py` to use new services
- ✅ Verified all existing scripts still work

**Files Created:**
- `services/http_client.py` (186 lines)
- `services/lastfm_service.py` (263 lines)
- `services/fanart_service.py` (73 lines)
- `utils/logging.py` (20 lines)
- `utils/rate_limiter.py` (40 lines)
- `utils/data_transform.py` (62 lines)

**Files Modified:**
- `concert_utils.py` - Now provides backward-compatible wrappers
- `fetch_artist_metadata.py` - Uses new services

**Testing:**
- ✅ All imports successful
- ✅ Backward compatibility verified
- ✅ Existing scripts work without modification

### Phase 2: Reorganize Database Modules ✅ COMPLETE

**Status:** ✅ Complete (Nov 5, 2025)

**Completed:**
- ✅ Moved `db_models.py` → `database/models.py`
- ✅ Moved `db_writer.py` → `database/writer.py`
- ✅ Moved `db_config.py` → `database/config.py`
- ✅ Moved `city_normalizer.py` → `database/normalizers/city.py`
- ✅ Moved `country_helper.py` → `database/normalizers/country.py`
- ✅ Updated all imports across the codebase
- ✅ Created `database/__init__.py` with convenience imports
- ✅ Created `database/normalizers/__init__.py`
- ✅ Created backward-compatible wrappers in old locations
- ✅ Tested database operations

**Files Created:**
- `database/models.py` (from `db_models.py`)
- `database/writer.py` (from `db_writer.py`)
- `database/config.py` (from `db_config.py`)
- `database/normalizers/city.py` (from `city_normalizer.py`)
- `database/normalizers/country.py` (from `country_helper.py`)
- `database/__init__.py` (55 lines)
- `database/normalizers/__init__.py` (12 lines)

**Files Modified (Backward-Compatible Wrappers):**
- `db_models.py` - Now imports from `database.models`
- `db_writer.py` - Now imports from `database.writer`
- `db_config.py` - Now imports from `database.config`
- `city_normalizer.py` - Now imports from `database.normalizers.city`
- `country_helper.py` - Now imports from `database.normalizers.country`

**Testing:**
- ✅ Old imports work: `from db_models import Artist`
- ✅ New imports work: `from database import Artist`
- ✅ All existing scripts work without modification

**Benefits Achieved:**
- ✅ Clear database layer separation
- ✅ Easier to find database-related code
- ✅ Better organization of normalizers
- ✅ Backward compatibility maintained

### Phase 3: Split Concert Parser ✅ COMPLETE

**Status:** ✅ Complete (Nov 5, 2025)

**Completed:**
- ✅ Extracted HTML parsing logic → `parsers/html_extractor.py`
  - `ConcertHTMLExtractor` class with methods:
  - `extract_event_details()` - Extract all event data from HTML
  - `extract_venue_info()` - Extract venue, city, country, postal code
  - `extract_performers()` - Extract performer list
  - `extract_events_from_page()` - Extract all events from a page
- ✅ Created `parsers/concert_parser.py` for core parsing logic
  - `ConcertParser` class with artist matching
  - `matches_lastfm_artists()` - O(1) artist matching
  - `filter_concerts()` - Filter by Last.fm artists
  - `parse_and_filter_page()` - Complete page processing
- ✅ Updated `country_concert_parser.py` to use new modules
  - Removed 150+ lines of duplicated HTML extraction code
  - Now uses `ConcertParser` internally
  - Maintains backward compatibility
- ✅ Tested parser functionality

**Files Created:**
- `parsers/html_extractor.py` (185 lines)
- `parsers/concert_parser.py` (95 lines)
- `parsers/__init__.py` (convenience imports)

**Files Modified:**
- `country_concert_parser.py` - Reduced from 1128 → ~980 lines

**Benefits Achieved:**
- ✅ Testable parsing logic (can unit test HTML extraction)
- ✅ Reusable HTML extraction (can be used by other parsers)
- ✅ Smaller, focused modules
- ✅ Easier to add new parsers

### Phase 4: Refactor Metadata Fetcher

**Status:** 🔄 Pending

**Tasks:**
- [ ] Split `fetch_artist_metadata.py` into smaller modules
- [ ] Extract metadata fetching logic from CLI
- [ ] Create orchestrator for metadata workflow
- [ ] Reuse services from Phase 1
- [ ] Add progress tracking

**Benefits:**
- Cleaner separation of CLI and logic
- Reusable metadata fetching
- Better error handling

### Phase 5: Create CLI Entry Points

**Status:** 🔄 Pending

**Tasks:**
- [ ] Create `cli/parse_concerts.py` - Thin wrapper for concert parser
- [ ] Create `cli/fetch_metadata.py` - Thin wrapper for metadata fetcher
- [ ] Create `cli/manage_countries.py` - Country management utilities
- [ ] Move argument parsing to CLI layer
- [ ] Create orchestration logic separate from business logic

**Benefits:**
- Clear entry points
- Business logic separate from CLI
- Easier to create web API endpoints
- Better testability

### Phase 6: Reorganize Config Modules

**Status:** 🔄 Pending

**Tasks:**
- [ ] Move `config_manager.py` → `config/manager.py`
- [ ] Move `user_config.py` → `config/user.py`
- [ ] Update imports
- [ ] Create `config/__init__.py` with convenience imports

**Benefits:**
- Clear configuration layer
- Easier to find config-related code

### Phase 7: Add Core Models & Exceptions

**Status:** 🔄 Pending

**Tasks:**
- [ ] Create `core/models.py` for data classes
  - Concert data model
  - Artist data model
  - Venue data model
- [ ] Create `core/exceptions.py` for custom exceptions
  - ParsingError
  - APIError
  - DatabaseError
- [ ] Update code to use typed models

**Benefits:**
- Type safety
- Better error handling
- Clear data contracts

### Phase 8: Cleanup & Documentation

**Status:** 🔄 Pending

**Tasks:**
- [ ] Remove old files (if fully migrated)
- [ ] Update all imports across project
- [ ] Add docstrings to all modules
- [ ] Create usage examples
- [ ] Update README with new structure

## Migration Strategy

### Backward Compatibility

✅ **Maintained throughout refactoring**
- Old imports continue to work via wrapper functions
- Existing scripts don't break
- Gradual migration path

### Testing Approach

- Import tests after each phase
- Functional tests for critical paths
- Integration tests for end-to-end workflows

## Benefits Summary

### Achieved (Phase 1)
- ✅ **Testability**: Services can be unit tested independently
- ✅ **Reusability**: Services can be used by web API routes
- ✅ **Maintainability**: Clear boundaries, easier to find code
- ✅ **No Breaking Changes**: Existing scripts continue to work

### Expected (Future Phases)
- **Smaller Files**: No file over 300 lines
- **Clear Responsibilities**: Each module has one job
- **Easy to Extend**: Add new parsers or services easily
- **Better Performance**: Shared HTTP client, connection pooling
- **Type Safety**: Typed models and clear contracts

## Current Status

**Phase 1:** ✅ Complete (Nov 5, 2025)  
**Phase 2:** ✅ Complete (Nov 5, 2025)  
**Phase 3:** ✅ Complete (Nov 5, 2025)  
**Phase 4-8:** 🔄 Pending

**Progress Summary:**
- ✅ Services extracted and modularized
- ✅ Database layer reorganized
- ✅ Parser logic split into reusable modules
- ✅ All changes backward-compatible
- ✅ ~400 lines of code deduplicated

**Next Recommended Step:** Phase 4 - Refactor Metadata Fetcher

This will continue improving the codebase by splitting `fetch_artist_metadata.py` into smaller, focused modules.
