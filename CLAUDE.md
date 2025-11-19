# Concert Tracker - Architecture Guide for Claude Code

A full-stack concert tracking application that discovers upcoming concerts based on Last.fm music taste, with social features, interactive maps, and metadata enrichment.

## ⚠️ IMPORTANT: Python Environment

**ALWAYS use the project's virtual environment when executing Python scripts:**

```bash
# Correct way to run Python scripts:
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py --args

# Correct way to run tests:
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_mb_service.py

# NEVER use system python3 directly for project scripts
```

**Virtual Environment Location:** `venv/` (in project root)

## Project Overview

**Purpose**: Monitor upcoming metal/rock concerts for artists you listen to across specified countries.

**Key Features**:
- **Flexible artist sources**: Last.fm integration (optional), UserArtist table, or both
- **Multiple filtering modes**: Filter by your artists, or fetch all concerts (--no-filter)
- Web scraping of concerts-metal.com for event data
- Interactive concert map with friend features
- User authentication and multi-user support
- Concert metadata enrichment (MBID via MusicBrainz/Last.fm, images, playcounts)
- Friend network for sharing concert interests
- Per-user concert tracking and interest management

## Project Structure

```
lastfm-parser/
├── concert-tracker/                # Main Next.js application
│   ├── app/                        # Next.js App Router
│   │   ├── api/                    # API routes
│   │   │   ├── concerts/           # Concert CRUD operations
│   │   │   ├── friends/            # Friend management & requests
│   │   │   ├── auth/               # NextAuth handlers
│   │   │   ├── settings/           # User settings & config
│   │   │   ├── map/                # Map data endpoints
│   │   │   ├── stats/              # User statistics
│   │   │   ├── admin/              # Admin panel endpoints
│   │   │   └── scanner/            # Background job control (start/stop/status)
│   │   ├── components/             # Shared React components
│   │   │   ├── ConcertDetailSidebar.tsx
│   │   │   ├── NotificationPanel.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── TopBar.tsx
│   │   ├── [page routes]/          # Feature pages
│   │   │   ├── page.tsx            # Home/concerts list
│   │   │   ├── scanner/            # Concert scanner UI
│   │   │   ├── map/                # Interactive map
│   │   │   ├── concerts/[id]/      # Concert detail page
│   │   │   ├── artists/            # Artist browse pages
│   │   │   ├── calendar/           # Calendar view
│   │   │   ├── countries/          # Country filters
│   │   │   ├── friends/            # Friend management UI
│   │   │   ├── notifications/      # Notification center
│   │   │   ├── settings/           # User settings
│   │   │   ├── admin/              # Admin panel
│   │   │   └── login/              # Authentication
│   │   └── types/                  # TypeScript interfaces
│   ├── scripts/                    # Python CLI tools
│   │   ├── parse_concerts.py       # Main concert parser (CLI)
│   │   ├── fetch_metadata.py       # Metadata enrichment (CLI)
│   │   ├── add_country.py          # Add countries to DB
│   │   ├── invalidate_cache.py     # Cache management
│   │   ├── config/                 # Configuration management
│   │   │   ├── manager.py          # DB-first config (singleton)
│   │   │   └── user.py             # User-specific config
│   │   ├── database/               # Database layer
│   │   │   ├── models.py           # SQLAlchemy ORM models
│   │   │   ├── writer.py           # Concert data insertion
│   │   │   ├── config.py           # DB engine setup
│   │   │   └── normalizers/        # Data normalization
│   │   ├── parsers/                # HTML parsing
│   │   │   ├── country_parser.py   # concerts-metal.com parser
│   │   │   ├── concert_parser.py   # Concert data extraction
│   │   │   └── html_extractor.py   # DOM utilities
│   │   ├── services/               # External API integrations
│   │   │   ├── lastfm_service.py   # Last.fm API client
│   │   │   ├── metadata_service.py # Artist metadata fetcher
│   │   │   ├── musicbrainz_service.py # MBID lookups
│   │   │   ├── fanart_service.py   # Artist images
│   │   │   ├── proxy.py            # Proxy rotation
│   │   │   └── http_client.py      # Rate-limited HTTP
│   │   ├── utils/                  # Shared utilities
│   │   │   ├── credentials.py      # Centralized credential loading
│   │   │   ├── validation.py       # Validation utilities
│   │   │   ├── logging_config.py   # Structured logging setup
│   │   │   └── rate_limiter.py     # Rate limiting with graceful shutdown
│   │   ├── tests/                  # Integration tests
│   │   ├── requirements.txt        # Python dependencies
│   │   ├── startup.sh              # Docker initialization
│   │   └── switch_db.sh            # Database switching utility
│   ├── prisma/                     # Database ORM
│   │   ├── schema.prisma           # Prisma schema
│   │   └── migrations/             # Database migrations
│   ├── lib/                        # Shared utilities
│   │   └── prisma.ts               # Prisma client singleton
│   ├── auth.ts                     # NextAuth configuration
│   ├── middleware.ts               # Request authentication
│   ├── Dockerfile                  # Production container
│   ├── Dockerfile.dev              # Development container
│   ├── package.json                # Node dependencies
│   └── tsconfig.json               # TypeScript config
├── docker-compose.yml              # Production compose
├── docker-compose.dev.yml          # Development compose
├── .env.example                    # Configuration template
├── docs/                           # Architecture documentation
└── README.md                       # Getting started
```

## Technology Stack

### Frontend
- **Next.js 15**: React framework with App Router, Server Components
- **React 18.3**: UI component library
- **TypeScript 5.6**: Type-safe development
- **TailwindCSS 3.4**: Utility-first CSS
- **NextAuth 5.0-beta**: Authentication & session management
- **Leaflet 1.9.4**: Interactive maps
- **date-fns 3.0**: Date utilities

### Backend
- **Next.js API Routes**: TypeScript-based REST API
- **Prisma 5.22**: ORM with automatic migrations
- **MySQL 8.0** or **SQLite**: Dual-database support
- **NextAuth**: Credential-based authentication

### Python Scripts
- **SQLAlchemy 2.0**: ORM for Python
- **BeautifulSoup4**: HTML parsing
- **Requests**: HTTP client
- **python-dotenv**: Environment configuration
- **mysqlclient**: MySQL connector
- **musicbrainzngs**: MusicBrainz API client (MBID lookups)

### DevOps
- **Docker & Docker Compose**: Containerization
- **Alpine Linux**: Lightweight base images
- **Prisma Migrations**: Database versioning

## Database Schema

### Core Models (15 tables)

```
User
├── id (PK)
├── username (unique)
├── hashedPassword
├── role (USER | ADMIN)
└── relationships: concerts, artists, settings, friends, notifications

Artist
├── id (PK)
├── name (unique)
├── mbid (MusicBrainz ID)
├── imageUrl
└── relationships: concerts (via ArtistConcert junction)

Concert
├── id (PK)
├── eventName
├── eventUrl (unique)
├── dateStart / dateEnd (Unix timestamps)
├── venue, postalCode
├── cityMappingId (FK)
├── countryId (FK)
├── performers (JSON array)
├── ticketLinks (JSON array)
├── imageUrl
└── relationships: artists (via ArtistConcert junction), users (via UserConcert)

ArtistConcert (Junction)
├── id (PK)
├── artistId (FK)
├── concertId (FK)
├── isPrimary (Boolean - marks headliner)
└── unique constraint: (artistId, concertId)

UserConcert
├── userId (FK)
├── concertId (FK)
├── interested (Boolean)
├── notes (Text)
├── isPrivate (Boolean)
└── tracks user interest in concerts

UserArtist
├── userId (FK)
├── artistId (FK)
├── playcount (user's Last.fm playcount)
├── playcount12month (12-month playcount)
└── tracks user's artist listening stats

Country
├── id (PK)
├── name (unique, e.g., "Turkey")
├── code (unique, ISO 3166-1 alpha-2, e.g., "tr")
└── relationships: concerts, cities

CityNormalized
├── id (PK)
├── normalizedCity (e.g., "istanbul")
├── countryId (FK)
└── unique: (normalizedCity, countryId)

CityMapping
├── id (PK)
├── originalCity (e.g., "Istanbul", "İstanbul")
├── normalizedCity relation
├── countryId (FK)
├── latitude, longitude (geocoded coordinates)
├── source (manual | geocoded | text_normalized)
└── Note: uses binary collation in MySQL to preserve diacritics

Friendship
├── id (PK)
├── userId (requester)
├── friendId (recipient)
├── status (PENDING | ACCEPTED | DECLINED)
└── relationships: both directions to User

Notification
├── id (PK)
├── userId (recipient)
├── type (FRIEND_REQUEST | FRIEND_ACCEPTED)
├── fromUserId (FK - who triggered it)
├── message (Text)
├── read (Boolean)
└── auto-trims to 100 per user

Setting (Global config)
├── key (unique)
├── value (JSON-compatible)
├── valueType (string | int | bool | json)

UserSetting (Per-user config)
├── userId, key (unique pair)
├── value, valueType
└── includes: MAP_PRIVACY_GLOBAL, active countries

UserActiveCountry
├── userId, countryId (unique pair)
└── tracks countries user is monitoring
```

### Key Relationships
- **Many-to-Many**: Artist ↔ Concert (via `ArtistConcert`)
- **One-to-Many**: Country ↔ CityNormalized ↔ CityMapping ↔ Concert
- **User-Concert**: Per-user interest tracking (UserConcert, UserArtist)
- **Social**: Friendship (bidirectional with status), Notification

## Data Flow Architecture

### Concert Discovery & Storage

```
1. SCRAPING PHASE
   parse_concerts.py
   ├── CountryConcertParser
   │   ├── Fetches concerts-metal.com (with proxy rotation)
   │   ├── Parses HTML with BeautifulSoup
   │   └── Extracts: event name, date, venue, performers
   │
   ├── Artist Source Management (ArtistSourceManager)
   │   ├── Fetches artists from UserArtist table (always)
   │   ├── Optionally fetches from Last.fm API (if configured)
   │   ├── Returns union of both sources
   │   ├── Validation: ensures at least one source available (or --no-filter)
   │   └── Filter modes:
   │       - Filter mode: Only concerts with matched artists
   │       - No-filter mode (--no-filter): All concerts, all performers
   │
   └── ConcertDatabaseWriter
       ├── Normalizes cities (original → normalized mapping)
       ├── Links artists via ArtistConcert junction
       ├── Creates/updates Concert, Artist, UserConcert records
       ├── Handles missing playcounts gracefully (defaults to 0)
       ├── Auto-triggers metadata fetch after parsing completion
       └── Outputs: database (SQLite or MySQL)

2. METADATA ENRICHMENT PHASE
   fetch_metadata.py
   ├── Phase 0: MBID Auto-Repair (ALWAYS RUNS)
   │   ├── Finds artists without MBID
   │   ├── MusicBrainz first, Last.fm fallback if configured
   │   ├── Bulk repair before other phases
   │   └── Re-evaluates artists for image fetching after repair
   │
   ├── MusicBrainz lookups (PRIMARY)
   │   ├── Queries for artist MBIDs (rate-limited: 1.1s/request)
   │   ├── Updates Artist.mbid
   │   └── Works independently of Last.fm
   │
   ├── Last.fm lookups (OPTIONAL - fallback for MBIDs)
   │   ├── Fetches artist playcounts (global & per-user)
   │   ├── Updates UserArtist stats
   │   ├── Fallback MBID source if MusicBrainz fails
   │   └── Skipped entirely if not configured
   │
   └── Fanart.tv lookups (OPTIONAL)
       ├── Fetches high-res artist images
       └── Updates Artist.imageUrl

3. PRESENTATION PHASE
   Frontend (Next.js)
   ├── API routes fetch from Prisma
   ├── Components render concerts with enriched data
   └── User interactions stored in UserConcert
```

### User-Specific Data Flow

```
Scanner Initiation (User clicks "Scan")
└── POST /api/scanner/start
    ├── Validates session + user
    ├── Spawns Python subprocess: parse_concerts.py --user-id {userId}
    ├── Maintains in-memory state (isScanning, process reference)
    └── Streams output via WebSocket (/api/scanner/ws)

Scan Execution (Background)
└── parse_concerts.py --user-id {userId}
    ├── ArtistSourceManager fetches artists from:
    │   ├── UserArtist table (per-user saved artists)
    │   └── Last.fm API (optional, if configured)
    ├── Filters concerts by union of sources (or all if --no-filter)
    ├── Creates UserConcert entries (interested=false by default)
    ├── Stores user-specific stats in UserArtist
    └── Triggers metadata enrichment (MusicBrainz → Last.fm)

User Views Concerts
└── GET / (or /api/concerts)
    ├── Fetches UserConcert records for current user
    ├── Includes Concert + Artist data (via ArtistConcert)
    ├── Loads UserArtist playcount stats
    └── Renders in concert grid/map

User Marks Interest
└── PATCH /api/concerts/{id}
    ├── Updates UserConcert.interested = true
    └── Triggers friend notifications (if public)
```

### Social Features Flow

```
Friend Discovery
└── GET /api/friends
    ├── Finds accepted Friendship records
    ├── Loads friend stats: concert count, upcoming concerts
    └── Returns friend list with stats

Concert Sharing
└── Map Filter: Select friends
    ├── GET /api/map/concerts?friendIds=[1,2,3]
    ├── Fetches concerts attended by selected friends
    ├── Respects MAP_PRIVACY_GLOBAL user setting
    ├── Returns union of concerts
    └── Shows on interactive Leaflet map with markers

Notifications
└── Friendship state changes
    ├── POST /api/friends/requests (create request)
    ├── PATCH /api/friends/{id} (accept/decline)
    ├── Creates Notification record
    ├── Capped at 100 per user
    └── WebSocket broadcasts to connected clients
```

## API Endpoints

### Concert Management
- `GET /api/concerts` - List concerts with filters (country, city, pagination)
- `GET /api/concerts/{id}` - Concert detail
- `PATCH /api/concerts/{id}` - Update user interest/notes

### Map & Visualization
- `GET /api/map/concerts` - Filtered concerts for map (with friend overlays)
- `GET /api/map/friends` - List friends for map filtering

### Friend System
- `GET /api/friends` - List accepted friends with stats
- `POST /api/friends` - Create friend request
- `GET /api/friends/requests` - List pending requests
- `PATCH /api/friends/{id}` - Accept/decline request

### Settings & Configuration
- `GET /api/settings/user` - User settings
- `PATCH /api/settings/user` - Update user settings
- `GET /api/settings/countries` - Available countries
- `POST /api/settings/user-countries` - Set active countries
- `GET /api/settings/audit` - Audit log (admin)
- `GET /api/settings/global` - Global settings (admin)

### Scanner Control
- `POST /api/scanner/start` - Start concert scan
- `GET /api/scanner/status` - Current scan status
- `POST /api/scanner/stop` - Stop active scan
- `GET /api/scanner/logs` - Scan output logs
- `WS /api/scanner/ws` - WebSocket for real-time updates

### Statistics
- `GET /api/stats` - User statistics

### Admin
- `GET /api/admin/users` - List all users
- `PATCH /api/admin/users/{id}` - Manage user roles

## Key Implementation Patterns

### 1. Database Switching
- Prisma schema dynamically switches between MySQL and SQLite
- `startup.sh` runs `switch_db.sh` before app starts
- Environment variable: `DB_TYPE` (mysql | sqlite)
- `DATABASE_URL` auto-generated or read from env

### 2. Configuration Management (Python)
```
Priority: Database Setting table > .env > Hardcoded defaults

ConfigManager (Singleton)
├── Caches settings (60s TTL)
├── Thread-safe
├── Auto-migrates ENV → DB on first run
└── Used for global settings

Available Settings (DEFAULTS):
├── LASTFM_API_KEY (string) - Last.fm API key for metadata
├── LASTFM_USER (string) - Last.fm username for playcounts
├── COUNTRY_CODES (json) - Active country codes ["tr","fr","de"]
├── MIN_PLAYCOUNT (int) - Minimum playcount threshold (default: 40)
├── FANART_API_KEY (string) - Fanart.tv API key for images
└── WEBSHARE_PROXY_URL (string) - Webshare.io proxy download URL

Credential Loading (utils/credentials.py)
├── load_credentials(user_id=None, db_path, require_lastfm, require_countries)
├── Returns: (UserCredentials, ValidationResult)
├── Supports both user-specific and global modes
│   ├── With user_id: Per-user credentials (for user-specific filtering)
│   └── Without user_id: Global credentials (for all concerts/artists, admin tasks)
├── Configuration Hierarchy:
│   ├── LASTFM_USER: ALWAYS user-specific (never global)
│   ├── MIN_PLAYCOUNT: ONLY user-specific
│   ├── LASTFM_API_KEY: Can be user-specific (overrides global if set)
│   └── FANART_API_KEY: ALWAYS global (shared resource)
├── Validates credentials with helpful error messages
├── Use validation.log(logger) to auto-log at appropriate level
└── Used by: parse_concerts.py, fetch_metadata.py, services/metadata.py
```

### 3. City Normalization
```
Concerts-metal.com provides: "Istanbul", "İstanbul", "ISTANBUL"
└── CityNormalizer
    ├── Converts to lowercase + diacritics removed: "istanbul"
    ├── Creates CityNormalized record (once per country)
    ├── Creates CityMapping for each variation
    ├── Stores original+normalized in DB
    └── Enables finding all concerts in a city despite spelling variations
```

### 4. Scanner State Management (Node.js)
```
In-memory Map<userId, ScannerState>
├── isScanning: boolean
├── isStopping: boolean (graceful shutdown flag)
├── process: ChildProcess | null
├── listeners: LogListener[] (WebSocket connections)
├── lastStats: { before, after, new } or null
└── Graceful shutdown: sends SIGTERM to Python subprocess
```

### 5. Authentication (NextAuth)
```
Credentials Provider
├── Username/password
├── bcryptjs hashing
├── JWT tokens in session
├── Role-based access (USER | ADMIN)
└── Middleware: requires auth for all routes except /login, /api/auth
```

### 6. Many-to-Many Artist-Concert
```
Before: Concert.artistId (single artist - outdated)
After: ArtistConcert junction table
├── Supports multiple artists per concert
├── isPrimary flag marks headliner
├── Unique constraint: (artistId, concertId)
└── Replaced by: Concert.artists[] with full metadata
```

### 7. Structured Logging (Python)
```
All Python scripts use centralized logging via utils/logging_config.py:

Setup:
from utils import get_logger, setup_logging
setup_logging(verbose=args.verbose)    # Call at script startup
logger = get_logger(__name__)          # Get logger for module

Features:
├── Color-coded terminal output (red=error, yellow=warning, blue=info)
├── Module name display for context
├── Configurable log levels (DEBUG, INFO, WARNING, ERROR, CRITICAL)
├── Optional file logging support
└── Thread-safe

Usage:
logger.info("Processing started")
logger.warning("No artists found")
logger.error("Database connection failed", exc_info=True)
logger.debug("Detailed debug info")
```

### 8. Graceful Shutdown with Interruptible Waits
```
GracefulShutdown context manager enables clean termination:

from parsers.country_parser import GracefulShutdown

with GracefulShutdown() as shutdown:
    for page in pages:
        if shutdown.interrupted:
            logger.info("Shutdown requested - saving progress...")
            break
        # Process page...

RateLimiter supports interruptible waits:
from utils import RateLimiter

rate_limiter = RateLimiter(
    base_delay=1.0,
    randomness=0.5,
    shutdown_flag=shutdown  # Enables interruptible waits
)
completed = rate_limiter.wait()  # Returns False if interrupted

Also available:
from utils import interruptible_sleep
completed = interruptible_sleep(duration=10, shutdown_flag=shutdown)
```

### 9. Validation Result Logging
```
ValidationResult.log() auto-selects appropriate log level:

from utils.credentials import load_credentials

credentials, validation = load_credentials(user_id=1, db_path=db)
if validation.is_error():
    validation.log(logger)  # Logs at ERROR level
    return 1
validation.log(logger)      # Logs at INFO level for success

Log levels:
├── ERROR: Validation failures
├── WARNING: Degraded conditions
└── INFO: Successful validations
```

### 10. HTTPClient with Retry Logic
```
Enhanced HTTP client with structured logging and error handling:

from services.http_client import HTTPClient

http_client = HTTPClient(
    timeout=15,
    use_system_ca=True,      # Use system certs (fixes Cloudflare issues)
    proxy_manager=proxy_mgr, # Optional proxy rotation
    pool_connections=1,
    pool_maxsize=1
)
response = http_client.get(url, max_retries=3)

Features:
├── Configurable retries with exponential backoff (1s, 2s, 3s)
├── Detailed error logging (HTTP status, timeouts, connection errors)
├── User-Agent rotation from 5 browser profiles
├── System CA bundle support
├── Session management with connection pooling
└── Proxy integration with success/failure tracking
```

### 11. ProxyManager for Request Rotation
```
Manages proxy rotation to avoid IP bans during scraping:

from services import ProxyManager

# Load from Webshare.io (recommended)
proxy_manager = ProxyManager(
    webshare_url=webshare_url,
    validate_on_load=True,
    validation_workers=50
)

# Or load from file
proxy_manager = ProxyManager(
    proxy_file='proxies.txt',
    validate_on_load=True
)

Features:
├── Parallel proxy validation with ThreadPoolExecutor
├── Failure tracking with cooldown (300s after 3 failures)
├── Round-robin selection via get_next_proxy()
├── Automatic reactivation after cooldown
└── Statistics: print_stats()

Constants:
├── MAX_FAILURES = 3
├── FAILURE_COOLDOWN = 300 seconds
├── VALIDATION_TIMEOUT = 5 seconds
└── VALIDATION_WORKERS = 50
```

### 12. Database Retry Logic for Concurrent Operations
```
CityNormalizer handles race conditions during concurrent city creation:

Retry mechanism (transparent to callers):
├── Attempts up to 3 times to create CityNormalized record
├── Incremental backoff: 10ms, 20ms, 30ms between attempts
├── Catches IntegrityError from duplicate unique constraint
├── Falls back to querying existing record on final attempt
└── Prevents PendingRollbackError from corrupting session

This is handled automatically - just call normalize() normally.
```

## Development Workflow

### Local Development
```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with API keys and passwords

# 2. Start containers
docker compose -f docker-compose.dev.yml up

# 3. What happens automatically:
#    - Switch database schema (MySQL/SQLite)
#    - Install npm dependencies
#    - Generate Prisma client
#    - Wait for MySQL health
#    - Apply migrations
#    - Start Next.js dev server (port 3000)
#    - Hot reload on file changes

# 4. Access application
# http://localhost:3000
```

### First-Time Setup
1. Database initializes via `startup.sh` → migrations
2. Create first user via signup (if enabled) or directly in DB
3. Run scanner to fetch concerts
4. Scanner fetches your Last.fm top artists
5. Concerts filtered by those artists stored in database

### Python Script Usage
```bash
# Inside container or with venv
cd concert-tracker/scripts

# === parse_concerts.py ===
# Basic usage with proxies
python parse_concerts.py --user-id 1 --use-proxies webshare

# All available options:
python parse_concerts.py \
  --user-id 1 \              # User ID for per-user data (UserArtist, UserConcert)
  --use-proxies webshare \   # Proxy mode: webshare (from env) or custom (proxies.txt)
  --max-pages 10 \           # Limit pages per country (default: no limit)
  --delay 3.0 \              # Delay between requests (default: 3.0s)
  --save-frequency auto \    # Save progress: page, country, or auto (every 5 pages)
  --debug \                  # Enable verbose logging
  --dry-run \                # Parse but don't save (test proxies/parsing)
  --no-filter \              # Fetch all concerts without artist filtering
  --no-page-detection \      # Disable automatic page count detection
  --no-proxy-validation \    # Skip proxy validation (faster startup)
  --proxy-workers 50         # Parallel workers for proxy validation

# === fetch_metadata.py ===
# Basic usage
python fetch_metadata.py --user-id 1

# All available options:
python fetch_metadata.py \
  --user-id 1 \              # User ID for per-user playcounts
  --limit 100 \              # Limit artists to process (for testing)
  --force \                  # Re-fetch images even if present
  --refresh-playcounts \     # Refresh playcounts for ALL artists
  --delay 0.25 \             # Delay between API calls (default: 0.25s)
  --db-path /path/to/db      # SQLite path (optional if DATABASE_URL set)

# === add_country.py ===
python add_country.py tr                    # Add by ISO code
python add_country.py "Turkey"              # Add by name
python add_country.py "Germany" true        # Set active status

# === invalidate_cache.py ===
python invalidate_cache.py                  # Invalidate all cache
python invalidate_cache.py LASTFM_API_KEY   # Invalidate specific key
```

**Parser Constants:**
- `DEFAULT_DELAY = 3.0` - Base delay between requests
- `COUNTRY_DELAY_MULTIPLIER = 3` - Longer delay between countries
- `PAGES_PER_SAVE = 5` - Auto-save frequency

### Database Switching
```bash
# Edit .env
DB_TYPE=mysql  # or sqlite

# Restart web container
docker compose -f docker-compose.dev.yml restart web
```

## Build & Production

### Production Build
```bash
docker compose -f docker-compose.yml up -d
```

**Key differences from dev**:
- Single `Dockerfile` (optimized)
- No hot reload or debug tools
- Health checks for both services
- SQLite or persistent MySQL volume
- Environment variables from `.env`

### Database Persistence
- **MySQL**: Volumes map to `./data/db/`
- **SQLite**: Database file at `./data/concerts.db` (or custom path)
- **Backups**: Copy volume contents or export database

### Environment Variables
See `.env.example` for all options:
- Database credentials (MySQL) or path (SQLite)
- Last.fm API key & username
- Fanart.tv API key (optional)
- Proxy configuration (optional)
- Country codes & playcount filter

## Important Architecture Decisions

### 1. Dual Database Support
- Allows single SQLite for quick testing
- Scales to MySQL for production
- Single ORM (Prisma) for both
- Python scripts use SQLAlchemy (mirrors schema)

### 2. Per-User Concert Tracking
- Each user has independent scanner session
- Concerts shared globally, interest/notes per-user
- UserConcert junction table enables flexible filtering
- UserArtist stores per-user playcount stats

### 3. Graceful Shutdown
- Scanner sends SIGTERM to Python subprocess
- `isStopping` flag prevents race conditions
- Python subprocess uses `GracefulShutdown` context manager
- Interruptible rate limiting via `RateLimiter` with shutdown flag
- Allows cleanup of database transactions
- Prevents data corruption on concurrent scans

### 4. WebSocket for Real-Time Feedback
- Scanner logs streamed to browser immediately
- State changes (isScanning, lastStats) broadcast
- Multiple concurrent connections per user
- Listeners cleaned up on disconnect

### 5. City Normalization Strategy
- Solves diacritics problem (Düsseldorf vs Dusseldorf)
- Preserves original venue names
- Single normalized entry per country
- Multiple mappings point to same normalized city

### 6. Configuration DB-First
- Settings stored in Setting table (per-app)
- UserSetting for per-user overrides
- ENV fallback for missing keys
- ConfigManager singleton caches (60s)

### 7. Last.fm Optional Architecture
- **Last.fm is optional** - system works with UserArtist table alone
- **MusicBrainz priority** - MBIDs fetched from MusicBrainz first, Last.fm fallback
- **Artist source union** - UserArtist ∪ Last.fm artists (when both available)
- **Graceful degradation** - clear error messages when no sources configured
- **No-filter mode** - fetch all concerts without any artist filtering

## Testing

### Unit/Integration Tests (Python)
Located in: `concert-tracker/scripts/tests/`

**Service Tests:**
- `test_mb_service.py` - MusicBrainz API integration
- `test_lastfm_api_raw.py` - Last.fm API raw responses
- `test_lastfm_duplicates.py` - Duplicate detection

**Artist Source Tests:**
- `test_artist_source_manager.py` - ArtistSourceManager unit tests
- `test_artist_source_integration.py` - Concert filtering integration
- `test_12month_playcount.py` - 12-month playcount accuracy
- `test_hyphen_artists.py` - Hyphenated artist name detection

**Last.fm Optional Integration Tests (Phase 7):**
- `test_scenario_b_userartist_only.py` - UserArtist only (no Last.fm)
- `test_scenario_c_no_sources.py` - No sources error handling
- `test_scenario_d_no_filter.py` - --no-filter mode validation
- `test_scenario_e_metadata_no_lastfm.py` - Metadata script without Last.fm

**Master Test Runner:**
- `run_phase7_tests.py` - Runs all Phase 7 integration tests

**Running Tests:**
```bash
# Run individual test
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_scenario_b_userartist_only.py

# Run all Phase 7 tests
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/run_phase7_tests.py

# Verbose mode
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/run_phase7_tests.py --verbose
```

**End-to-End Tests:**
- `test_city_e2e.py` - City normalization with diacritics (root `/tests/`)
- `test_artist_concert_links.py` - Artist-Concert M2M relationships
- `test_phase3_database_fixes.py` - Concurrency, N+1 optimization, null checks

### End-to-End Testing Patterns

All e2e tests follow consistent patterns for working with the real database:

**Setup and Logging:**
```python
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import get_logger, setup_logging
from database.config import get_engine
from database.models import Concert, Artist, ...
from database.writer import ConcertDatabaseWriter
from sqlalchemy.orm import sessionmaker

logger = get_logger(__name__)
setup_logging(verbose=True)  # Always enable verbose for tests
```

**Database Session Management:**
```python
class TestSuite:
    def __init__(self):
        self.engine = get_engine()
        self.Session = sessionmaker(bind=self.engine)
        self.session = self.Session()
        self.test_results = []

    def refresh_session(self):
        """Refresh session after writer operations to see committed changes"""
        self.session.close()
        self.session = self.Session()
```

**Test Data Isolation:**
```python
# Use unique identifiers for test data
test_urls = [
    'https://test-phase3.com/concert-1',
    'https://test-phase3.com/concert-2'
]
test_artists = ['Phase3 Test Artist A', 'Phase3 Test Artist B']

# Track created IDs for cleanup
self.cleanup_ids = {
    'concerts': [],
    'artists': [],
    'city_mappings': []
}
```

**Cleanup Pattern (respecting foreign keys):**
```python
def cleanup_test_data(self):
    # Delete in order: links first, then main records
    # 1. ArtistConcert links
    # 2. UserConcert links
    # 3. UserArtist links
    # 4. Concerts
    # 5. Artists
    # 6. CityMappings
    # 7. CityNormalized
    self.session.commit()
```

**Assertion Tracking:**
```python
def assert_equal(self, actual, expected, message):
    if actual == expected:
        self.test_results.append(('PASS', message))
        logger.info(f"  ✅ {message}")
        return True
    else:
        self.test_results.append(('FAIL', f"{message} - Expected: {expected}, Got: {actual}"))
        logger.error(f"  ❌ {message}")
        return False

def print_summary(self):
    passed = sum(1 for result, _ in self.test_results if result == 'PASS')
    failed = len(self.test_results) - passed
    logger.info(f"Total: {len(self.test_results)}, Passed: {passed}, Failed: {failed}")
```

**Writer Session Pattern:**
```python
# Writer creates its own session - refresh test session after
writer = ConcertDatabaseWriter(user_id=self.test_user_id, debug=True)
writer.write_concerts([concert_data], ...)
writer.session.close()

# IMPORTANT: Refresh to see committed changes
self.refresh_session()

# Now query to verify
concert = self.session.query(Concert).filter_by(eventUrl=url).first()
```

**Test Runner Pattern (for multiple test files):**
```python
# See run_phase7_tests.py for example
result = subprocess.run(
    [sys.executable, test_path],
    capture_output=not verbose,
    timeout=300  # 5 minute timeout
)
```

### Manual Testing
1. Scanner: Fetch concerts via UI
2. Map: Add friends, filter by interests
3. Settings: Toggle countries & privacy
4. Admin: Create users, view audit logs

## Common Development Tasks

### Add New API Endpoint
1. Create `app/api/feature/route.ts`
2. Import Prisma: `import { prisma } from '@/lib/prisma'`
3. Use auth: `const session = await auth()`
4. Return JSON: `NextResponse.json(data)`

### Add Frontend Page
1. Create `app/feature/page.tsx` (Server Component)
2. Create `app/feature/FeatureClient.tsx` (Client Component if interactive)
3. Use `app/page.tsx` pattern for authentication
4. Fetch API within component or server functions

### Add Python Script Feature
1. Create in `scripts/feature.py`
2. Import from library modules: `from config import ConfigManager`, `from database import ...`
3. For user-specific scripts:
   - Use `from utils.credentials import load_credentials`
   - Call `credentials, validation = load_credentials(user_id, db_path, ...)`
   - Check validation errors before proceeding
4. For global settings: Use ConfigManager
5. Return exit code 0 (success) or 1 (failure)

### Schema Changes
1. Edit `prisma/schema.prisma`
2. Run: `npx prisma migrate dev --name description`
3. Review generated migration
4. Test with `docker compose -f docker-compose.dev.yml restart web`

### Debugging
- Frontend: Browser DevTools + React DevTools
- Backend: Check logs in Docker: `docker logs concert-tracker-web-1`
- Python: Add `print()` statements, run scripts directly
- Database: Use MySQL Workbench or `sqlite3 cli`

## Documentation Files

Key docs in `/docs/`:
- `LASTFM_OPTIONAL_REFACTORING_PLAN.md` - Last.fm optional refactoring plan (10 phases)
- `LASTFM_OPTIONAL_STATUS.md` - Implementation status & progress tracking
- `BACKEND_CHANGES_SUMMARY.md` - Artist-Concert M2M implementation
- `CITY_RESTRUCTURING_SUMMARY.md` - City normalization design
- `FRIENDS_FEATURE_PLAN.md` - Social features architecture
- `ARTIST_CONCERT_MANY_TO_MANY_GUIDE.md` - M2M detailed guide
- `DEPLOYMENT_DATABASE.md` - Production setup

## Git Workflow

Main branch: `main`
- Uses conventional commits
- Test before pushing
- Deploy via docker-compose

Recent commits show:
- Structured logging migration across all Python scripts
- Graceful shutdown with interruptible waits
- Database retry logic for concurrent operations
- HTTPClient improvements with better error handling
- Last.fm optional refactoring (Phases 1-7 complete)
- ArtistSourceManager for flexible artist filtering
- MusicBrainz priority for MBID lookups
- Comprehensive test suite (8 test files, 5 scenarios)
- Concert card improvements
- Friends feature

---

## Last.fm Optional Feature

**Status**: ✅ Complete (Phases 1-7 of 10)

The system now supports flexible artist sources:

1. **UserArtist table only** - Works without Last.fm configuration
2. **Last.fm API only** - Traditional behavior (requires API key)
3. **Both sources** - Union of UserArtist + Last.fm artists
4. **No filter mode** - Fetch all concerts without filtering (`--no-filter`)

**Key Components:**
- `ArtistSourceManager` - Unified artist source management
- `MusicBrainzService` - Primary MBID source (rate-limited)
- `ArtistMetadataService` - Optional Last.fm integration
- Database writer - Handles missing playcount data gracefully

**Error Handling:**
- Clear validation messages when no artist sources available
- Helpful suggestions with 3 solutions
- Graceful degradation when services unavailable

**Testing:**
- 8 test files covering all scenarios
- Integration tests with full database flow
- All tests passing ✅

See [docs/LASTFM_OPTIONAL_STATUS.md](docs/LASTFM_OPTIONAL_STATUS.md) for detailed progress.

---

**Last Updated**: November 2025
**Technology Version**: Next.js 15, Prisma 5.22, MySQL 8.0, Python 3.12
