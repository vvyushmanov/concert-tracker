# Metadata Fetching Optimization

## Overview

The metadata fetching process has been optimized to be more **reliable**, **verbose**, and **safe** against data loss. This document describes the improvements made to the artist metadata enrichment system.

## What Was Changed

### 1. **Retry Logic with Exponential Backoff** ✨

Both MusicBrainz and Fanart.tv API calls now include automatic retry logic:

- **Max retries**: 3 attempts per request
- **Backoff strategy**: Exponential (2^attempt seconds)
- **Smart retry logic**:
  - ✅ Retries on: Network errors, timeouts, 5xx server errors
  - ❌ No retry on: 4xx client errors (bad requests)

#### Files Modified:
- [`musicbrainz_service.py`](../concert-tracker/scripts/services/musicbrainz_service.py)
- [`fanart_service.py`](../concert-tracker/scripts/services/fanart_service.py)

**Example**: If MusicBrainz times out on the first attempt, it will automatically retry after 1 second, then 2 seconds, then 4 seconds before giving up.

### 2. **Detailed Progress Reporting** 📊

The metadata fetch process now shows:
- Current artist being processed with counter (e.g., `[42/119] Metallica`)
- Result of each lookup:
  - `✓ MusicBrainz MBID: abc123...` (success)
  - `✗ No MBID found` (failure)
  - `⚠️ Timeout, retrying...` (retry in progress)
- Batch save confirmations (`💾 Saved progress (20 artists processed)`)

#### Files Modified:
- [`metadata.py`](../concert-tracker/scripts/services/metadata.py) - lines 176-244, 257-292

**Before**:
```
Repairing MBIDs for 114 artists...
✓ Repaired 100/114 MBIDs
```

**After**:
```
Repairing MBIDs for 114 artists...
  [1/114] Metallica
    ✓ MusicBrainz MBID: 65f4f0c5-ef9e-490c-aee3-909e7ae6b2ab
  [2/114] Iron Maiden
    ✓ MusicBrainz MBID: ca891d65-d9b0-4258-89f7-e6ba29d83767
  ...
  [20/114] Slayer
    ✓ MusicBrainz MBID: ...
  💾 Saved progress (20/114 artists processed)
```

### 3. **Batch Database Commits** 💾

Progress is now saved incrementally instead of all-at-once:

- **Batch size**: 20 artists (configurable)
- **Commit strategy**:
  - Save every 20 artists during MBID repair
  - Save every 20 artists during image fetching
  - Final commit at the end
- **Error handling**: If a batch commit fails, it rolls back and continues

#### Benefits:
- ✅ **Data loss prevention**: If the process crashes after 50 artists, you don't lose all 50
- ✅ **Early visibility**: Database shows partial results immediately
- ✅ **Memory efficiency**: Doesn't hold all changes in memory

#### Files Modified:
- [`metadata.py`](../concert-tracker/scripts/services/metadata.py) - Added `batch_size` parameter (default: 20)

**Usage**:
```python
# Use default batch size (20)
fetch_artist_metadata(user_id=1)

# Custom batch size (commit every 10 artists)
fetch_artist_metadata(user_id=1, batch_size=10)
```

### 4. **Improved Rate Limiting** ⏱️

Rate limiting has been adjusted for safer API usage:

| Service | Before | After | Reason |
|---------|--------|-------|--------|
| MusicBrainz | 1.1s | 1.1s ✓ | Already compliant (1 req/sec) |
| Fanart.tv | 0.25s | 0.5s ⬆️ | Increased for stability |
| Last.fm | None | None ⚠️ | Only 2 bulk calls total |

#### Files Modified:
- [`metadata.py`](../concert-tracker/scripts/services/metadata.py) - Line 272: Changed sleep from 0.25s to 0.5s

**Note**: Last.fm calls in `fetch_artist_metadata()` are minimal (only fallback for MBID repair), so no dedicated rate limiter was added.

### 5. **Verbose Mode Support** 🔊

All service methods now accept a `verbose` parameter:

```python
# Silent mode (default for backward compatibility)
mbid = mb_service.get_artist_mbid('Metallica')

# Verbose mode (shows retries and errors)
mbid = mb_service.get_artist_mbid('Metallica', verbose=True)
```

This allows the metadata fetcher to control logging granularity:
- `silent=False` (default): Shows all progress and errors
- `silent=True`: Minimal output (summary only)

## Testing

### Quick Verification

Run this command to verify all optimizations are loaded:

```bash
cd concert-tracker/scripts
~/lastfm-parser/venv/bin/python -c "
from services.musicbrainz_service import MusicBrainzService
from services.fanart_service import FanartService
from services.metadata import fetch_artist_metadata
import inspect

print('MusicBrainz:', MusicBrainzService.MAX_RETRIES, 'retries')
print('Fanart.tv:', FanartService.MAX_RETRIES, 'retries')
print('Batch size:', inspect.signature(fetch_artist_metadata).parameters['batch_size'].default)
"
```

Expected output:
```
MusicBrainz: 3 retries
Fanart.tv: 3 retries
Batch size: 20
```

### Full Integration Test

To test with real data (recommended with `--no-filter` to get many artists):

```bash
~/lastfm-parser/venv/bin/python concert-tracker/scripts/parse_concerts.py \
  --user-id 1 \
  --output db \
  --no-filter \
  --use-proxies webshare
```

**Expected behavior**:
- MBID repair shows detailed progress with artist names
- Batch saves every 20 artists
- Retries are shown if any API calls fail
- Final summary shows counts

## Performance Impact

### Processing Time

- **MBID Repair**: ~1.2s per artist (MusicBrainz rate limit)
  - 100 artists ≈ 2 minutes
- **Image Fetching**: ~0.6s per artist (0.5s sleep + request time)
  - 100 artists ≈ 1 minute

**Total for 100 artists**: ~3 minutes (same as before)

### Retry Overhead

- **Best case** (no failures): 0% overhead
- **Typical case** (1-2% failure rate): +2-5 seconds per 100 artists
- **Worst case** (high failure rate): Up to +20 seconds per 100 artists (if many retries needed)

### Database Load

- **Before**: 2 large commits (all MBIDs, then all images)
- **After**: ~10 small commits per 100 artists (every 20 artists + final)
- **Impact**: Negligible (commits are fast)

## Backward Compatibility

All changes are **100% backward compatible**:

- Default parameters unchanged
- Existing code continues to work without modifications
- New parameters are optional with sensible defaults

## Error Recovery

### Scenario 1: Process Interrupted (Ctrl+C)

**Before**: All progress lost
**After**: Last batch (up to 20 artists) may be lost, but previous batches are saved

### Scenario 2: API Timeout

**Before**: Artist skipped immediately
**After**: 3 retry attempts with backoff before skipping

### Scenario 3: Network Outage

**Before**: All subsequent artists fail
**After**: Retries for each artist, partial results saved in batches

## Configuration

### Adjusting Batch Size

Edit the call in [`parse_concerts.py`](../concert-tracker/scripts/parse_concerts.py) or wherever metadata fetch is called:

```python
# Smaller batches (more frequent saves, more DB overhead)
fetch_artist_metadata(user_id=user_id, batch_size=10)

# Larger batches (less frequent saves, less DB overhead)
fetch_artist_metadata(user_id=user_id, batch_size=50)

# Disable batching (save only at the end - not recommended)
fetch_artist_metadata(user_id=user_id, batch_size=999999)
```

### Adjusting Retry Settings

Edit the service classes directly:

```python
# In musicbrainz_service.py or fanart_service.py
MAX_RETRIES = 5  # More retries
RETRY_BACKOFF = 1.5  # Faster backoff
```

## Future Improvements

Potential enhancements (not yet implemented):

1. **Parallel Fetching**: Use threading for MBID lookups (respecting rate limits)
2. **Resume from Last**: Track last processed artist ID to resume after crash
3. **Rate Limiter Class**: Centralized rate limiting for all services
4. **Progress Bar**: Visual progress indicator (requires `tqdm` library)
5. **Metrics Logging**: Track retry counts, success rates, API performance

## Related Files

- [`musicbrainz_service.py`](../concert-tracker/scripts/services/musicbrainz_service.py) - MusicBrainz API client
- [`fanart_service.py`](../concert-tracker/scripts/services/fanart_service.py) - Fanart.tv API client
- [`metadata.py`](../concert-tracker/scripts/services/metadata.py) - Metadata orchestration
- [`parse_concerts.py`](../concert-tracker/scripts/parse_concerts.py) - Main parser (calls metadata fetch)

## Summary

| Improvement | Status | Impact |
|-------------|--------|--------|
| Retry logic | ✅ Done | High (reliability) |
| Progress reporting | ✅ Done | High (visibility) |
| Batch commits | ✅ Done | High (data safety) |
| Rate limiting | ✅ Done | Medium (API safety) |
| Verbose mode | ✅ Done | Medium (debugging) |

**Overall Result**: The metadata fetching process is now significantly more robust, transparent, and safe against data loss while maintaining the same performance characteristics.
