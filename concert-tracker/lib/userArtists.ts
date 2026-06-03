import { prisma } from '@/lib/prisma';

/**
 * Followed-artist management (M1.4). The `UserArtist` table is a user's followed
 * set, which (together with active countries) drives read-time personalization.
 * These helpers back the manual follow/unfollow + search routes; the Last.fm
 * sync (scripts/sync_user_artists.py) is the other way rows get created.
 *
 * Extracted from the routes so the logic is unit-testable without HTTP/auth.
 */

export type FollowResult =
  | { ok: true; artist: { id: number; name: string }; created: boolean }
  | { ok: false; status: number; error: string };

/**
 * Follow an artist by id, or by name (creating the global Artist if new).
 * `created` is true when a brand-new Artist row was created (the caller should
 * then enrich its metadata — MBID/image — since it has none yet).
 */
export async function followArtist(
  userId: number,
  input: { artistId?: number | string | null; name?: string | null }
): Promise<FollowResult> {
  const now = Math.floor(Date.now() / 1000);
  let artistId: number | null = input.artistId != null ? parseInt(String(input.artistId)) : null;
  let created = false;

  if (!artistId && input.name) {
    const name = String(input.name).trim();
    if (!name) return { ok: false, status: 400, error: 'Artist name cannot be empty' };
    let artist = await prisma.artist.findUnique({ where: { name } });
    if (!artist) {
      artist = await prisma.artist.create({ data: { name, createdAt: now, updatedAt: now } });
      created = true;
    }
    artistId = artist.id;
  }

  if (!artistId || isNaN(artistId)) {
    return { ok: false, status: 400, error: 'artistId or name is required' };
  }

  const artist = await prisma.artist.findUnique({ where: { id: artistId } });
  if (!artist) return { ok: false, status: 404, error: 'Artist not found' };

  await prisma.userArtist.upsert({
    where: { userId_artistId: { userId, artistId } },
    update: { updatedAt: now },
    create: { userId, artistId, playcount: 0, playcount12month: 0, recent: false, createdAt: now, updatedAt: now },
  });

  return { ok: true, artist: { id: artist.id, name: artist.name }, created };
}

/** Unfollow an artist (idempotent). */
export async function unfollowArtist(userId: number, artistId: number): Promise<void> {
  await prisma.userArtist.deleteMany({ where: { userId, artistId } });
}

export interface ArtistSearchResult {
  id: number;
  name: string;
  imageUrl: string | null;
  following: boolean;
}

/** Search global artists by name, annotated with whether the user follows each. */
export async function searchArtists(userId: number, q: string): Promise<ArtistSearchResult[]> {
  const query = (q || '').trim();
  if (query.length < 2) return [];

  const artists = await prisma.artist.findMany({
    where: { name: { contains: query } },
    take: 20,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, imageUrl: true },
  });

  const followed = new Set(
    (
      await prisma.userArtist.findMany({
        where: { userId, artistId: { in: artists.map((a) => a.id) } },
        select: { artistId: true },
      })
    ).map((x) => x.artistId)
  );

  return artists.map((a) => ({ ...a, following: followed.has(a.id) }));
}
