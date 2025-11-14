# Spotify Integration Guide

## Overview

This document outlines the Spotify Web API integration for the concert tracker project. The integration will supplement/replace Last.fm for artist tracking and enable playlist creation features.

## Priority Features (from FEATURE_LIST_2.0.md)

### Phase 1: Core Authentication & Artist Tracking
1. **Connect Spotify account** - OAuth flow in user settings
2. **Retrieve followed artists** - Primary artist discovery method
3. **Retrieve top tracks** - Additional listening data
4. **Retrieve artist metadata** - Genres, popularity, images
5. **Retrieve artist playcounts** - User listening statistics

### Phase 2: Playlist Features
6. **Create Spotify playlist** - Generate playlists from concerts
7. **Listen to the playlist** - Direct playback links

### Phase 3: Setlist.fm Integration
8. **Retrieve setlists** - Average and latest setlists per concert
9. **Create setlist playlist** - Spotify playlist from setlist data

## Security & Token Storage

### Token Types
- **Access Token**: Expires in ~1 hour, used for API calls
- **Refresh Token**: Never expires (until revoked), used to get new access tokens

### Storage Strategy
```typescript
// UserSetting table (existing pattern)
SPOTIFY_REFRESH_TOKEN   // Encrypted refresh token
SPOTIFY_TOKEN_EXPIRES   // Unix timestamp for access token expiry
SPOTIFY_CONNECTED_AT    // When user authorized (audit trail)
```

### Encryption
```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.SPOTIFY_ENCRYPTION_KEY!, 'hex'); // 32 bytes

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(encrypted: string): string {
  const [ivHex, authTagHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encryptedData = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encryptedData) + decipher.final('utf8');
}
```

### Required Scopes
```typescript
const SPOTIFY_SCOPES = [
  'user-top-read',              // Phase 1: Top artists/tracks
  'user-follow-read',           // Phase 1: Followed artists
  'playlist-modify-public',     // Phase 2: Create playlists
  'playlist-modify-private',    // Phase 2: Create private playlists
];
```

## Authentication Flow

### 1. OAuth Setup (One-Time per User)

**Environment Variables:**
```bash
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/spotify/callback
SPOTIFY_ENCRYPTION_KEY=generate_with_crypto_randomBytes_32_hex
```

**User Flow:**
1. User clicks "Connect Spotify" in Settings
2. Redirect to Spotify authorization page
3. User approves permissions
4. Spotify redirects back with authorization code
5. Exchange code for tokens
6. Store encrypted refresh token in database
7. User never needs to reconnect (unless they revoke)

### 2. API Route: Start OAuth

```typescript
// app/api/spotify/authorize/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    scope: SPOTIFY_SCOPES.join(' '),
    state: session.user.id, // Verify on callback
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params}`;
  return NextResponse.redirect(authUrl);
}
```

### 3. API Route: OAuth Callback

```typescript
// app/api/spotify/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // userId
  const error = searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect('/settings?spotify_error=1');
  }

  // Exchange code for tokens
  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
  });

  const { access_token, refresh_token, expires_in } = await tokenResponse.json();

  // Store encrypted refresh token
  const userId = parseInt(state);
  const encryptedToken = encrypt(refresh_token);
  const expiresAt = Math.floor(Date.now() / 1000) + expires_in;

  await prisma.userSetting.upsert({
    where: { userId_key: { userId, key: 'SPOTIFY_REFRESH_TOKEN' } },
    update: { value: encryptedToken },
    create: { userId, key: 'SPOTIFY_REFRESH_TOKEN', value: encryptedToken },
  });

  await prisma.userSetting.upsert({
    where: { userId_key: { userId, key: 'SPOTIFY_CONNECTED_AT' } },
    update: { value: Date.now().toString() },
    create: { userId, key: 'SPOTIFY_CONNECTED_AT', value: Date.now().toString() },
  });

  return NextResponse.redirect('/settings?spotify_connected=1');
}
```

### 4. Token Refresh Helper

```typescript
// app/lib/spotify.ts
import { prisma } from '@/lib/prisma';

export async function getSpotifyAccessToken(userId: number): Promise<string | null> {
  // Get encrypted refresh token
  const setting = await prisma.userSetting.findUnique({
    where: { userId_key: { userId, key: 'SPOTIFY_REFRESH_TOKEN' } },
  });

  if (!setting) return null;

  const refreshToken = decrypt(setting.value);

  // Exchange refresh token for new access token
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
  });

  if (!response.ok) {
    console.error('Failed to refresh Spotify token:', await response.text());
    return null;
  }

  const { access_token } = await response.json();
  return access_token;
}

export async function spotifyFetch(
  userId: number,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const accessToken = await getSpotifyAccessToken(userId);
  if (!accessToken) {
    throw new Error('No Spotify access token available');
  }

  return fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
```

## Phase 1: Artist Tracking Implementation

### Database Schema Additions

```prisma
// Add to Artist model
model Artist {
  id                Int      @id @default(autoincrement())
  name              String
  mbid              String?  @unique
  spotifyId         String?  @unique  // NEW: Spotify artist ID
  spotifyImage      String?  @db.Text // NEW: Spotify image URL
  spotifyPopularity Int?              // NEW: Spotify popularity (0-100)
  spotifyGenres     String?  @db.Text // NEW: JSON array of genres
  // ... existing fields
}
```

### API Route: Get User's Top Artists

```typescript
// app/api/spotify/top-artists/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { spotifyFetch } from '@/lib/spotify';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  try {
    // Get top artists (long_term = ~1 year)
    const response = await spotifyFetch(
      userId,
      '/me/top/artists?time_range=long_term&limit=50'
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch top artists' },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    return NextResponse.json({
      artists: data.items.map((artist: any) => ({
        spotifyId: artist.id,
        name: artist.name,
        image: artist.images[0]?.url,
        popularity: artist.popularity,
        genres: artist.genres,
      })),
    });
  } catch (error) {
    console.error('Spotify API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### API Route: Get Followed Artists

```typescript
// app/api/spotify/following/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { spotifyFetch } from '@/lib/spotify';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const allArtists: any[] = [];
  let after: string | null = null;

  try {
    // Paginate through all followed artists (50 per page)
    do {
      const url = `/me/following?type=artist&limit=50${after ? `&after=${after}` : ''}`;
      const response = await spotifyFetch(userId, url);

      if (!response.ok) {
        return NextResponse.json(
          { error: 'Failed to fetch followed artists' },
          { status: response.status }
        );
      }

      const data = await response.json();
      allArtists.push(...data.artists.items);
      after = data.artists.cursors?.after || null;
    } while (after);

    return NextResponse.json({
      artists: allArtists.map((artist: any) => ({
        spotifyId: artist.id,
        name: artist.name,
        image: artist.images[0]?.url,
        popularity: artist.popularity,
        genres: artist.genres,
      })),
    });
  } catch (error) {
    console.error('Spotify API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Python Script: Sync Spotify Artists

```python
# scripts/sync_spotify_artists.py
"""
Sync Spotify artist data to database.
Matches artists by name, updates Spotify metadata.
"""
import argparse
import requests
from database import get_engine
from database.models import Artist
from sqlalchemy.orm import Session

def sync_spotify_artists(user_id: int, spotify_artists: list):
    """
    Match Spotify artists to database artists and update metadata.
    
    Args:
        user_id: User ID for logging
        spotify_artists: List of dicts with spotifyId, name, image, popularity, genres
    """
    engine = get_engine()
    
    with Session(engine) as session:
        matched = 0
        updated = 0
        
        for spotify_artist in spotify_artists:
            # Try to find artist by name (case-insensitive)
            artist = session.query(Artist).filter(
                Artist.name.ilike(spotify_artist['name'])
            ).first()
            
            if artist:
                matched += 1
                
                # Update Spotify metadata if changed
                needs_update = False
                if artist.spotifyId != spotify_artist['spotifyId']:
                    artist.spotifyId = spotify_artist['spotifyId']
                    needs_update = True
                if artist.spotifyImage != spotify_artist['image']:
                    artist.spotifyImage = spotify_artist['image']
                    needs_update = True
                if artist.spotifyPopularity != spotify_artist['popularity']:
                    artist.spotifyPopularity = spotify_artist['popularity']
                    needs_update = True
                if artist.spotifyGenres != str(spotify_artist['genres']):
                    artist.spotifyGenres = str(spotify_artist['genres'])
                    needs_update = True
                
                if needs_update:
                    updated += 1
        
        session.commit()
        print(f"Matched {matched} artists, updated {updated}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--user-id', type=int, required=True)
    parser.add_argument('--artists-json', required=True, help='JSON file with Spotify artists')
    args = parser.parse_args()
    
    import json
    with open(args.artists_json) as f:
        artists = json.load(f)
    
    sync_spotify_artists(args.user_id, artists)
```

## Phase 2: Playlist Creation

### API Route: Create Playlist from Concerts

```typescript
// app/api/spotify/playlists/create/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { spotifyFetch } from '@/lib/spotify';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const { concertIds, playlistName } = await request.json();

  if (!concertIds?.length || !playlistName) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    // Get user's Spotify ID
    const meResponse = await spotifyFetch(userId, '/me');
    const { id: spotifyUserId } = await meResponse.json();

    // Create playlist
    const createResponse = await spotifyFetch(
      userId,
      `/users/${spotifyUserId}/playlists`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: playlistName,
          description: `Concert playlist created by Last.fm Concert Tracker`,
          public: false,
        }),
      }
    );

    const playlist = await createResponse.json();

    // Get concerts with artists
    const concerts = await prisma.concert.findMany({
      where: { id: { in: concertIds } },
      include: {
        artistConcerts: {
          include: { artist: true },
        },
      },
    });

    // Get top tracks for each artist
    const trackUris: string[] = [];
    for (const concert of concerts) {
      for (const ac of concert.artistConcerts) {
        if (ac.artist.spotifyId) {
          const tracksResponse = await spotifyFetch(
            userId,
            `/artists/${ac.artist.spotifyId}/top-tracks?market=US`
          );
          const { tracks } = await tracksResponse.json();
          trackUris.push(...tracks.slice(0, 5).map((t: any) => t.uri));
        }
      }
    }

    // Add tracks to playlist (max 100 per request)
    if (trackUris.length > 0) {
      for (let i = 0; i < trackUris.length; i += 100) {
        await spotifyFetch(
          userId,
          `/playlists/${playlist.id}/tracks`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uris: trackUris.slice(i, i + 100),
            }),
          }
        );
      }
    }

    return NextResponse.json({
      playlistId: playlist.id,
      playlistUrl: playlist.external_urls.spotify,
      trackCount: trackUris.length,
    });
  } catch (error) {
    console.error('Playlist creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create playlist' },
      { status: 500 }
    );
  }
}
```

## Settings UI Integration

### Add Spotify Connection Section

```tsx
// app/settings/SpotifyTab.tsx
'use client';

import { useState, useEffect } from 'react';

export default function SpotifyTab() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    checkConnection();
  }, []);

  async function checkConnection() {
    const res = await fetch('/api/spotify/status');
    const data = await res.json();
    setConnected(data.connected);
    setLoading(false);
  }

  async function connectSpotify() {
    window.location.href = '/api/spotify/authorize';
  }

  async function disconnectSpotify() {
    if (!confirm('Disconnect Spotify account?')) return;
    await fetch('/api/spotify/disconnect', { method: 'POST' });
    setConnected(false);
  }

  async function syncArtists() {
    setSyncing(true);
    try {
      const res = await fetch('/api/spotify/sync-artists', { method: 'POST' });
      const data = await res.json();
      alert(`Synced ${data.matched} artists, updated ${data.updated}`);
    } catch (error) {
      alert('Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Spotify Connection</h3>
        {connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-green-600">✅ Connected</span>
              <button
                onClick={disconnectSpotify}
                className="text-sm text-red-600 hover:underline"
              >
                Disconnect
              </button>
            </div>
            <button
              onClick={syncArtists}
              disabled={syncing}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Sync Artists from Spotify'}
            </button>
          </div>
        ) : (
          <button
            onClick={connectSpotify}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Connect Spotify
          </button>
        )}
      </div>

      <div className="text-sm text-gray-600">
        <p className="font-semibold mb-2">What we access:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Your followed artists</li>
          <li>Your top artists and tracks</li>
          <li>Create playlists (when you request)</li>
        </ul>
        <p className="mt-2">
          Your tokens are encrypted and stored securely. You can disconnect anytime.
        </p>
      </div>
    </div>
  );
}
```

## Implementation Checklist

### Phase 1: Core Setup (Priority)
- [ ] Add `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `SPOTIFY_ENCRYPTION_KEY` to `.env`
- [ ] Create encryption helper functions (`encrypt`, `decrypt`)
- [ ] Add Spotify fields to `Artist` model in Prisma schema
- [ ] Run Prisma migration
- [ ] Create `/api/spotify/authorize` route
- [ ] Create `/api/spotify/callback` route
- [ ] Create `/api/spotify/status` route
- [ ] Create `/api/spotify/disconnect` route
- [ ] Create `getSpotifyAccessToken` helper
- [ ] Create `spotifyFetch` helper
- [ ] Add Spotify tab to Settings page
- [ ] Test OAuth flow end-to-end

### Phase 1: Artist Tracking
- [ ] Create `/api/spotify/top-artists` route
- [ ] Create `/api/spotify/following` route
- [ ] Create `/api/spotify/sync-artists` route (calls Python script)
- [ ] Create `sync_spotify_artists.py` script
- [ ] Add "Sync Artists" button to Settings
- [ ] Test artist matching and metadata updates

### Phase 2: Playlist Features
- [ ] Create `/api/spotify/playlists/create` route
- [ ] Add "Create Playlist" button to concert list pages
- [ ] Add playlist creation modal (select concerts, name playlist)
- [ ] Test playlist creation with multiple concerts

### Phase 3: Setlist.fm Integration
- [ ] Research Setlist.fm API (separate documentation)
- [ ] Create setlist fetching service
- [ ] Integrate with Spotify playlist creation
- [ ] Add setlist display to concert detail page

## Rate Limits & Best Practices

**Spotify API Rate Limits:**
- No official limit published
- Recommended: Max 10 requests/second per user
- Use exponential backoff on 429 responses

**Caching Strategy:**
- Cache artist metadata for 7 days
- Cache top artists for 1 day
- Refresh tokens have no expiry (cache indefinitely)

**Error Handling:**
- 401: Token expired → auto-refresh
- 403: Insufficient scope → prompt re-authorization
- 429: Rate limited → exponential backoff
- 500: Spotify error → retry with backoff

## Security Checklist

- [x] Tokens encrypted at rest (AES-256-GCM)
- [x] Minimal scopes requested
- [x] User can disconnect anytime
- [x] Refresh tokens stored, not access tokens
- [x] Client secret never exposed to frontend
- [x] State parameter validates OAuth callback
- [ ] Add audit logging for Spotify connections
- [ ] Add rate limiting to Spotify API routes
- [ ] Document privacy policy updates

## References

- [Spotify Web API Documentation](https://developer.spotify.com/documentation/web-api)
- [Authorization Guide](https://developer.spotify.com/documentation/web-api/concepts/authorization)
- [Get User's Top Items](https://developer.spotify.com/documentation/web-api/reference/get-users-top-artists-and-tracks)
- [Search API](https://developer.spotify.com/documentation/web-api/reference/search)
- [Create Playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist)
