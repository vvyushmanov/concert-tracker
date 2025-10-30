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

## Current Status (Oct 30, 2025)
✅ **Completed:**
- Python parser with dual-mode output (JSON + Database)
- SQLAlchemy and Prisma schemas using Unix timestamps (Int) for dates
- Next.js app with Docker setup
- Basic concert grid view with images, dates, locations, artist info
- Database with 272 concerts from 62 artists

## Next Steps - Priority: Multiple View Types

### Implement Three Main Views:

#### 1. **By Artist View** (`/artists` or `/by-artist`)
- List all artists with concert counts
- Click artist to see all their concerts
- Sort by: playcount, name, concert count
- Show artist stats (total concerts, countries)

#### 2. **By Country View** (`/countries` or `/by-country`)
- Group concerts by country
- Show concert count per country
- Click country to see all concerts in that country
- Map visualization (optional enhancement)

#### 3. **Calendar View** (`/calendar`)
- Month/week view of concerts
- Visual calendar with concert markers
- Click date to see concerts on that day
- Filter by artist/country within calendar
- Highlight upcoming concerts

### Implementation Plan:
1. Create navigation bar with view switchers
2. Build `/app/artists/page.tsx` - Artist list and detail views
3. Build `/app/countries/page.tsx` - Country-based grouping
4. Build `/app/calendar/page.tsx` - Calendar interface
5. Add shared filtering/sorting components
6. Enhance existing grid view with filters

These views will provide different ways to explore the concert data based on user preferences.
