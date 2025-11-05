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

### Phase 2: Reorganize Database Modules

**Status:** 🔄 Pending  

**Tasks:**
- [ ] Move `db_models.py` → `database/models.py`
- [ ] Move `db_writer.py` → `database/writer.py`
- [ ] Move `db_config.py` → `database/config.py`
- [ ] Move `city_normalizer.py` → `database/normalizers/city.py`
- [ ] Move `country_helper.py` → `database/normalizers/country.py`
- [ ] Update all imports across the codebase
- [ ] Create `database/__init__.py` with convenience imports
- [ ] Test database operations

**Benefits:**
- Clear database layer separation
- Easier to find database-related code
- Better organization of normalizers

### Phase 3: Split Concert Parser

**Status:** 🔄 Pending

**Tasks:**
- [ ] Extract HTML parsing logic → `parsers/html_extractor.py`
  - `extract_event_details()`
  - `extract_venue_info()`
  - `extract_performers()`
- [ ] Create `parsers/concert_parser.py` for core parsing logic
  - Pure parsing logic (no HTTP, no CLI)
  - Artist matching logic
  - Data validation
- [ ] Create `parsers/base_parser.py` for shared parser functionality
- [ ] Update `country_concert_parser.py` to use new modules
- [ ] Add unit tests for parsers

**Benefits:**
- Testable parsing logic
- Reusable HTML extraction
- Smaller, focused modules
- Easier to add new parsers

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
**Phase 2-8:** 🔄 Pending

**Next Recommended Step:** Phase 2 - Reorganize Database Modules

This will continue the pattern of non-breaking refactoring while improving code organization.
