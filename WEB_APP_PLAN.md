# Concert Tracker Web Application - Implementation Plan

## Tech Stack
- **Frontend**: Next.js 14+ (App Router), React, TypeScript
- **Styling**: Tailwind CSS + shadcn/ui components
- **Database**: SQLite with Prisma ORM (Next.js) + SQLAlchemy (Python)
- **Backend**: Next.js API routes
- **Deployment**: Docker + docker-compose (local → self-hosted)
- **Python Integration**: Enhanced parsers with dual-mode output (JSON + Database)

## Data Structure (from my_concerts.json)
```
{
  "Country": {
    "Artist": {
      "playcount": number,
      "recent": boolean,
      "concerts": [
        {
          "event_name": string,
          "event_url": string,
          "date_start": "YYYY-MM-DD",
          "date_end": "YYYY-MM-DD",
          "venue": string,
          "city": string,
          "postal_code": string,
          "performers": string[],
          "image_url": string,
          "organizer": string,
          "organizer_url": string,
          "ticket_links": string[]
        }
      ]
    }
  }
}
```

## Database Schema (Prisma)
```prisma
model Artist {
  id        Int       @id @default(autoincrement())
  name      String    @unique
  playcount Int
  recent    Boolean
  concerts  Concert[]
}

model Concert {
  id            Int      @id @default(autoincrement())
  eventName     String
  eventUrl      String
  dateStart     DateTime
  dateEnd       DateTime
  venue         String
  city          String
  country       String
  postalCode    String?
  performers    String   // JSON array
  imageUrl      String?
  organizer     String?
  organizerUrl  String?
  ticketLinks   String   // JSON array
  artistId      Int
  artist        Artist   @relation(fields: [artistId], references: [id])
  
  // User interaction fields
  interested    Boolean  @default(false)
  notes         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

## Python Parser Architecture (Dual-Mode)

### Output Modes
1. **JSON Mode** (default, backward compatible)
   - `python country_concert_parser.py --output json`
   - Outputs to `my_concerts.json` as it does now
   - Use for backups, exports, or standalone operation

2. **Database Mode** (for web app integration)
   - `python country_concert_parser.py --output db --db-path /path/to/concerts.db`
   - Writes directly to SQLite database
   - Uses SQLAlchemy ORM with same schema as Prisma
   - Handles upserts (no duplicates based on event_url)

### Shared Database Schema
Both Prisma (Next.js) and SQLAlchemy (Python) use the same SQLite file and schema.

## Implementation Steps

### 1. Enhance Python Parser for Database Support
- Add SQLAlchemy to `requirements.txt`
- Create `db_models.py` with SQLAlchemy models matching Prisma schema
- Add `db_writer.py` module for database operations
- Modify `country_concert_parser.py` to accept `--output` and `--db-path` arguments
- Implement dual-mode: write to JSON OR database based on parameter
- Add upsert logic (check event_url uniqueness)

### 2. Project Setup (Next.js)
- Initialize Next.js with TypeScript: `npx create-next-app@latest concert-tracker --typescript --tailwind --app`
- Install dependencies: `prisma`, `@prisma/client`, `shadcn/ui`
- Configure shadcn/ui: `npx shadcn-ui@latest init`

### 3. Database Setup (Next.js)
- Initialize Prisma: `npx prisma init --datasource-provider sqlite`
- Create schema in `prisma/schema.prisma` (matching Python SQLAlchemy models)
- Run migration: `npx prisma migrate dev --name init`
- **One-time**: Import existing `my_concerts.json` using Python parser in DB mode

### 4. API Routes (`app/api/`)
- `GET /api/concerts` - List all concerts (with filters: country, artist, date range)
- `GET /api/concerts/[id]` - Get single concert
- `PATCH /api/concerts/[id]` - Update concert (interested, notes)
- `POST /api/rescan` - Trigger Python parser in DB mode, return stats
- `GET /api/artists` - List all artists with concert counts
- `GET /api/export` - Export current database to JSON format

### 5. Main UI Pages
- **`app/page.tsx`** - Concert listing with:
  - Card grid layout (concert image, name, date, venue, artist)
  - Filters: country, artist, date range, interested-only
  - Sort: date, artist playcount, recently added
  - Search bar
- **`app/concerts/[id]/page.tsx`** - Concert detail view
- **Components**: ConcertCard, FilterBar, RescanButton, ExportButton

### 6. Re-scan Feature
- API endpoint executes: `python country_concert_parser.py --output db --db-path ./data/concerts.db`
- Python writes directly to database (no intermediate JSON)
- Return status: new concerts added, existing updated
- Frontend refreshes concert list automatically

### 7. Docker Setup
```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
services:
  web:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./my_concerts.json:/app/my_concerts.json
    environment:
      - DATABASE_URL=file:./data/concerts.db
```

## Key Features
1. **View**: Paginated concert grid with images and key info
2. **Filter**: By country, artist, date range, interested status
3. **Sort**: By date, artist popularity, recently added
4. **Interact**: Mark interested, add personal notes
5. **Re-scan**: Button to run Python parser in DB mode, direct database updates
6. **Export**: Download current database as JSON backup
7. **Incremental**: New concerts added, existing ones updated (no duplicates via event_url)

## File Structure
```
lastfm-parser/
├── country_concert_parser.py      # Enhanced with --output flag
├── db_models.py                   # NEW: SQLAlchemy models
├── db_writer.py                   # NEW: Database operations
├── requirements.txt               # Add: sqlalchemy
├── my_concerts.json               # Legacy/backup format
└── concert-tracker/               # NEW: Next.js app
    ├── app/
    │   ├── api/
    │   │   ├── concerts/
    │   │   ├── artists/
    │   │   ├── rescan/
    │   │   └── export/
    │   ├── concerts/[id]/
    │   ├── components/
    │   ├── layout.tsx
    │   └── page.tsx
    ├── prisma/
    │   └── schema.prisma
    ├── lib/
    │   └── prisma.ts
    ├── data/
    │   └── concerts.db            # Shared SQLite database
    ├── Dockerfile
    ├── docker-compose.yml
    └── package.json
```

## Data Flow
```
┌─────────────────────────────────────────────────────────┐
│  Python Parser (country_concert_parser.py)              │
│  - Scrapes concert data                                 │
│  - Last.fm artist data                                  │
└────────────┬────────────────────────────┬───────────────┘
             │                            │
             ▼                            ▼
      ┌──────────┐                 ┌─────────────┐
      │   JSON   │                 │   SQLite    │
      │  Output  │                 │  Database   │
      │ (backup) │                 │  (primary)  │
      └──────────┘                 └──────┬──────┘
                                          │
                                          ▼
                                   ┌─────────────┐
                                   │  Next.js    │
                                   │  Web App    │
                                   │  (Prisma)   │
                                   └─────────────┘
```

## Current Status (Oct 31, 2025) - ✅ ALL CORE FEATURES COMPLETE

### ✅ Fully Implemented Features

#### Core Views (All Complete)
1. **Main Page (/)** - Concert grid with advanced filtering, sorting, and search
2. **Artists Page (/artists)** - Artist cards with search, sorting (popularity/concerts/name)
3. **Artist Detail (/artists/[id])** - Concerts grouped by country
4. **Countries Page (/countries)** - Country list with concert counts
5. **Country Detail (/countries/[country])** - Concerts grouped by city
6. **Calendar View (/calendar)** - Two-column layout (calendar + concerts list)
7. **Concert Detail (/concerts/[id])** - Full concert info with interactions
8. **Scanner Page (/scanner)** - Real-time Python parser execution with SSE logs

#### Main Page Features ✅
- Search by concert name, artist, venue, city
- Filters: Artist dropdown, Country dropdown, Interested-only checkbox
- Sort: Date, Artist Name, Artist Popularity, Recently Added
- Results counter and "Clear All" button
- Interested concerts always shown first

#### Artists Page Features ✅
- Search by artist name with clear button
- Sort by: Artist Popularity, Upcoming Concerts, Artist Name
- Shows only artists with upcoming concerts
- Concert/country counts based on upcoming concerts only
- Enhanced stats panel with bold numbers

#### Calendar View Features ✅
- Two-column layout: calendar (left) + concerts list (right)
- Month navigation with prev/next buttons
- Filters: Artist, Country, Interested-only
- Click day to see concerts on that date
- Scrollable concerts list (max 800px) with sticky headers
- Compact calendar cells optimized for space

#### Past Events Management ✅
- **All views** hide past concerts by default
- "Show Past Events" toggle button
- Past events in separate sections with:
  - Grayscale images
  - Reduced opacity (75%)
  - Gray headings
  - Clear visual separation

#### Concert Interactions ✅
- Mark concerts as "interested" (⭐ Pinned)
- Add personal notes
- View full concert details
- External links to event pages
- Export database to JSON

#### Scanner Features ✅
- Start/Stop Python parser from UI
- Real-time log streaming via SSE
- Process status monitoring
- Error handling and recovery

#### Technical Implementation ✅
- Server components for data fetching
- Client components for interactivity
- Unix timestamps (Int) for all dates
- Prisma ORM with SQLite
- Real-time SSE for scanner logs
- Docker setup with dev environment
- No nested anchor tags (proper hydration)

### API Routes Implemented ✅
- `GET /api/concerts/[id]` - Concert details
- `PATCH /api/concerts/[id]` - Update interested/notes
- `POST /api/scanner/start` - Start Python parser
- `POST /api/scanner/stop` - Stop parser
- `GET /api/scanner/logs` - SSE log stream
- `GET /api/export` - Export to JSON

### Bug Fixes Applied ✅
- Fixed SSE controller closed error with isClosed flag
- Fixed nested anchor tag hydration errors
- Optimized calendar two-column layout
- Improved search panel alignment

## Potential Future Enhancements

### Optional Features (Not Yet Implemented)
1. **Statistics Dashboard** - Charts showing concerts by country, timeline, artist frequency
2. **Map Visualization** - Interactive map with concert locations
3. **Advanced Search** - Full-text search across all fields
4. **Concert Notifications** - Reminders for upcoming concerts
5. **Mobile Optimization** - Enhanced mobile-specific layouts
6. **Date Range Picker** - Custom date range filtering
7. **Multi-select Filters** - Select multiple artists/countries at once
8. **User Preferences** - Save filter/sort preferences
9. **Concert Sharing** - Share concert links with others
10. **Import/Export** - Import concerts from other sources

### Technical Improvements
- Add pagination for large concert lists
- Implement caching for faster page loads
- Add loading skeletons for better UX
- Optimize image loading with blur placeholders
- Add error boundaries for better error handling

# Future Improvements and Features

## Features

1. Get latest setlist from setlist.fm and update concert details
2. Add user authentication and profiles (including LastFM user)
3. Add map visualization of concerts, including grouping of concerts within a timerange for multiple users
4. Add Spotify integration for:
- Play artist
- Add setlist as playlist
- Load recommended artists/concerts
5. Regular background scans
6. 

## Technical Improvements

1. Add pagination for large concert lists
2. Implement caching for faster page loads
3. Add loading skeletons for better UX
4. Optimize image loading with blur placeholders
5. Add error boundaries for better error handling



