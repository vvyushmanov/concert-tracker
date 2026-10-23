# concert-tracker

Tracks upcoming concerts for the artists you care about: date, city, venue, and
where each one sits on a map.

Give it a list of artists, or connect a Last.fm account and let it import
everything you play above a threshold (default: 40 plays). Either source is
enough on its own, and Last.fm is optional. A desktop agent then scrapes concert
listings for the countries you select and pushes them into the app, which fills
in artist metadata from MusicBrainz, images from fanart.tv, and plots what it
finds. Cities within 35 km of one another are
folded into a single metro area by great-circle distance, so a venue one town
over still reads as nearby. A timeline slider sets the date window, which
defaults to the next 90 days.

Self-hosted: one `docker compose up`, no account anywhere except your own.

## Run it

```bash
cp .env.example .env      # DB credentials; Last.fm key only if you use it
docker compose -f docker-compose.dev.yml up
```

Then open http://localhost:3000. The first run takes two to three minutes.

For production, on the machine that will run it:

```bash
cp .env.example .env      # fill in AUTH_SECRET and INGEST_TOKEN as well
./deploy.sh               # build, start, then prune all build cache
```

To try the production image locally next to the dev stack (its own database,
port 3001): `WEB_PORT=3001 docker compose up -d --build`.

The production stack is sized for a small always-on box. Measured with real
data, the web container peaks around 180 MB (plus ~55 MB while a Python ingest
runs) and MariaDB sits near 110 MB; the images are about 360 MB (web) and
460 MB (MariaDB). Each container also has a hard `mem_limit`.

## Database

MariaDB 11.8 through Prisma's `mysql` provider, with a low-memory profile in
`concert-tracker/scripts/mariadb.cnf` (16 MB buffer pool; raise it first if the
data ever outgrows it). Migrations and the seed run on every start of the web
container and are idempotent.

Back up and restore with a logical dump:

The database has no host port; reach it through the container:

```bash
docker compose exec -T db sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" concerts' > backup.sql
docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" concerts' < backup.sql
```

Dev databases from before the MariaDB switch live in `data/db` (MySQL 8.0),
which MariaDB cannot open. The dev stack now uses `data/mariadb`; to carry the
data over, dump it once with a throwaway `mysql:8.0` container started on
`data/db`, then load the dump into the new database. `data/db` is never touched.

## What is in it

| Layer | Built with |
|---|---|
| Web | Next.js 15 (App Router), TypeScript, Tailwind, NextAuth v5 |
| Data | Prisma and MariaDB 11.8: 16 models, 15 migrations |
| Map | Leaflet with marker clustering |
| Ingest | Python 3.12 against concerts-metal, MusicBrainz, fanart.tv, optionally Last.fm |
| Agent | Electron desktop scraper, 12 modules, pushing to `POST /api/ingest` |
| API | 31 route handlers under `app/api` |

## The parts worth reading

`concert-tracker/scripts/startup.sh` (dev) waits for the database, applies
migrations only when `_prisma_migrations` says they are needed, seeds an admin
user, and then starts the server. Running it again never destroys data.

Both compose files pair a database healthcheck with
`depends_on: condition: service_healthy`, so the app cannot race the database
on a cold start.

`concert-tracker/Dockerfile` builds in three stages (builder, Prisma CLI,
runner). The runner is plain Alpine 3.23 with its own `nodejs` package (Node 24)
and Python 3.12 without pip, which is about 80 MB lighter than the official Node
image. It drops to a non-root `nextjs` user and carries the Python ingest scripts
alongside the standalone Next.js build.

`.env.example` is the configuration contract: nothing in the app reads a value
that is not listed there.

`agent/` exists because the server-side scraper stopped working. concerts-metal
put Cloudflare Turnstile in front of its listings, and no amount of header
juggling gets past that. So the scraper moved to the desktop: an Electron app
that drives a real Chromium window against a persistent profile, which keeps the
clearance cookie between runs, so a challenge is solved once rather than every
crawl. It reads listings out of the rendered DOM as microdata and pushes them to
`POST /api/ingest` over bearer-authenticated HTTPS. `agent/README.md` documents
the two ways to break it, both of which throw the profile away.

## Status

A personal project running on my own hardware. There is no CI and no hosted
instance. 26 Python test modules and 6 TypeScript suites cover the parsers, the
services, the ingest route, the multi-user paths and the agent.

Planned, not built: Spotify as a third artist source (OAuth, followed artists,
top tracks). The design is in `docs/SPOTIFY_INTEGRATION.md`; none of it is
implemented yet.
