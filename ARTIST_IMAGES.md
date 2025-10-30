# Artist Image Fetching

## Overview

Artist images are fetched in two stages to keep the concert parser fast:

1. **Concert Parsing**: Stores MusicBrainz IDs (mbid) from Last.fm
2. **Background Fetching**: Separate script fetches high-quality images from fanart.tv

## Setup

1. Get a free fanart.tv API key: https://fanart.tv/get-an-api-key/
2. Add it to your `.env` file:
   ```
   FANART_API_KEY=your_key_here
   ```

## Usage

### Fetch images for all artists without images:
```bash
python fetch_artist_images.py --db-path data/concerts.db
```

### Test with limited artists:
```bash
python fetch_artist_images.py --db-path data/concerts.db --limit 10
```

### Re-fetch all images (force mode):
```bash
python fetch_artist_images.py --db-path data/concerts.db --force
```

### Adjust rate limiting:
```bash
python fetch_artist_images.py --db-path data/concerts.db --delay 1.0
```

## How It Works

1. **Last.fm provides MusicBrainz IDs**: When fetching top artists, Last.fm returns `mbid` for each artist
2. **Parser stores mbids**: The concert parser stores these IDs in the database
3. **Background script fetches images**: Run `fetch_artist_images.py` to fetch high-quality artist thumbnails from fanart.tv
4. **Images are cached**: Once fetched, images are stored in the database and won't be re-fetched unless you use `--force`

## Database Schema

```sql
Artist {
  id: INTEGER PRIMARY KEY
  name: TEXT UNIQUE
  playcount: INTEGER
  recent: BOOLEAN
  mbid: TEXT          -- MusicBrainz ID from Last.fm
  imageUrl: TEXT      -- Image URL from fanart.tv
}
```

## Workflow

```
┌─────────────────┐
│ Run Parser      │
│ (stores mbids)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Run Image       │
│ Fetcher Script  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Images appear   │
│ in web app      │
└─────────────────┘
```

## Tips

- Run the image fetcher **after** parsing concerts
- Use `--limit` for testing
- The script saves progress after each artist, so you can interrupt and resume
- Images are fetched from fanart.tv's `artistthumb` endpoint
- Not all artists have images on fanart.tv (especially smaller/newer bands)

## Automation

You can run the image fetcher as a cron job:

```bash
# Fetch images daily at 3 AM
0 3 * * * cd /path/to/lastfm-parser && venv/bin/python fetch_artist_images.py --db-path data/concerts.db
```
