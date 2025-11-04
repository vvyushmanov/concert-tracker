# Phase 6: Metadata Refresh - Current State Analysis

## Executive Summary

The "Refresh Metadata" button already exists on the Artists page, but it needs to be updated to work with the new user-based system. The Python script is already user-aware, but the API routes are not.

---

## Current Implementation

### Frontend (`app/artists/ArtistsList.tsx`)
- ✅ Button exists with proper UI states (refreshing/idle)
- ✅ Polls `/api/metadata/status` every 2 seconds during refresh
- ✅ Auto-refreshes page data when complete
- ✅ Shows spinner and "Refreshing..." state
- **No changes needed** - UI is already correct

### API Routes

**`/api/metadata/refresh/route.ts`:**
```typescript
// Current implementation (line 16):
const process = spawn('python3', ['-u', pythonScript, '--refresh-playcounts'], {
  cwd: '/app/scripts',
});
```
**Issues:**
- ❌ No authentication check
- ❌ Doesn't pass `--user-id` parameter
- ❌ Uses global state lock (single `metadataState` object)
- ❌ Only one user can refresh at a time globally

**`/api/metadata/status/route.ts`:**
```typescript
// Current implementation:
return NextResponse.json({ 
  isRefreshing: metadataState.isRefreshing 
});
```
**Issues:**
- ❌ No authentication check
- ❌ Returns global state, not user-specific

**`/api/state.ts`:**
```typescript
// Current implementation (lines 41-45):
export const metadataState = {
  isRefreshing: false,
  process: null as ChildProcess | null,
};
```
**Issues:**
- ❌ Single global object prevents multi-user refresh
- ❌ Should be `Map<userId, state>` instead

### Python Script (`scripts/fetch_artist_metadata.py`)

**Good News - Already User-Aware!**
- ✅ Supports `--user-id` parameter (line 252-254)
- ✅ Loads user-specific Last.fm credentials from DB (lines 281-292)
- ✅ Updates `UserArtist` table with per-user playcounts (lines 40-69)
- ✅ Uses global `FANART_API_KEY` for images (correct - shared resource)
- ✅ Supports `--refresh-playcounts` flag (line 267-269)

**Current behavior when `--user-id` provided:**
```python
# Lines 281-289
user_config_data = load_user_config(args.user_id, args.db_path)
user_settings = user_config_data['settings']
lastfm_api_key = user_settings.get('LASTFM_API_KEY')
lastfm_user = user_settings.get('LASTFM_USER')
log(f"User-specific mode: {user_config_data['user'].username} (ID: {args.user_id})")
```

**What it does:**
1. Fetches all user's artists from Last.fm
2. Updates playcounts in `UserArtist` table
3. Repairs missing MBIDs
4. Fetches missing artist images from fanart.tv

---

## Required Changes

### 1. Update `/api/state.ts`
Add per-user metadata refresh tracking:
```typescript
export const metadataRefreshState = new Map<number, {
  isRefreshing: boolean;
  process: ChildProcess | null;
  startTime: number;
}>();
```

### 2. Update `/api/metadata/refresh/route.ts`
- Add `auth()` check
- Pass `--user-id` to Python script
- Use per-user state tracking
- Allow multiple users to refresh simultaneously

### 3. Update `/api/metadata/status/route.ts`
- Add `auth()` check
- Return user-specific refresh status

### 4. No Frontend Changes
The UI already works correctly - it just needs the backend to be user-aware.

---

## Benefits After Update

1. **Multi-user support**: Multiple users can refresh metadata simultaneously
2. **User-specific data**: Each user gets their own playcounts from their Last.fm account
3. **Proper isolation**: User A's refresh doesn't block User B
4. **Security**: Authentication required for all operations
5. **Audit trail**: Console logs show which user is refreshing
6. **Efficient filtering**: Only processes artists associated with the user (via UserArtist table)

---

## Testing Plan

After implementing changes:
1. Login as User A, click "Refresh Metadata"
2. While User A's refresh is running, login as User B in another browser
3. User B should be able to start their own refresh
4. Both refreshes should complete independently
5. Each user should see their own playcounts updated
6. Check console logs for proper user identification

---

## Implementation Priority

This is part of **Phase 6: Scanner Enhancements** and should be implemented alongside the scanner user-awareness updates, as they follow the same pattern:
- Per-user process tracking
- Authentication checks
- User-specific data loading
- Multi-user support
