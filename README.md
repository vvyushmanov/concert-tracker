# lastfm-parser

Tracks upcoming concerts for the artists you care about: date, city, venue, and
where each one sits on a map. The app is called concert-tracker; the repository
kept the name it started with, from when Last.fm was the only way to get artists
into it.

Give it a list of artists, or connect a Last.fm account and let it import
everything you play above a threshold (default: 40 plays). Either source is
enough on its own, and Last.fm is optional. It then scrapes concert listings for
the countries you select, fills in artist metadata from MusicBrainz and images
from fanart.tv, and plots what it finds. Cities within 35 km of one another are
folded into a single metro area by great-circle distance, so a venue one town
over still reads as nearby. A timeline slider sets the date window, which
defaults to the next 90 days.

Self-hosted: one `docker compose up`, no account anywhere except your own.

## Run it

```bash
cp .env.example .env      # MySQL credentials; Last.fm key only if you use it
docker compose -f docker-compose.dev.yml up
```

Then open http://localhost:3000. The first run takes two to three minutes.

## What is in it

| Layer | Built with |
|---|---|
| Web | Next.js 15 (App Router), TypeScript, Tailwind, NextAuth v5 |
| Data | Prisma and MySQL 8: 15 models, 12 migrations. SQLite via `DB_TYPE` |
| Map | Leaflet with marker clustering |
| Scanners | Python 3.12 against concerts-metal, MusicBrainz, fanart.tv, optionally Last.fm |
| API | 26 route handlers under `app/api` |

## The parts worth reading

`concert-tracker/scripts/startup.sh` selects the Prisma schema from `DB_TYPE`,
waits for MySQL, applies migrations only when `_prisma_migrations` says they
are needed, seeds an admin user, and then starts the server. Running it again
never destroys data.

`docker-compose.dev.yml` pairs a MySQL healthcheck with
`depends_on: condition: service_healthy`, so the app cannot race the database
on a cold start.

`concert-tracker/Dockerfile` builds in three stages (deps, builder, runner) on
`node:20-alpine`. The runner drops to a non-root `nextjs` user and carries the
Python scanner alongside the standalone Next.js build.

`.env.example` is the configuration contract: nothing in the app reads a value
that is not listed there.

## Status

A personal project running on my own hardware. There is no CI and no hosted
instance. 19 Python test modules cover the parsers, the services and the
database writer.

Planned, not built: Spotify as a third artist source (OAuth, followed artists,
top tracks). The design is in `docs/SPOTIFY_INTEGRATION.md`; none of it is
implemented yet.
