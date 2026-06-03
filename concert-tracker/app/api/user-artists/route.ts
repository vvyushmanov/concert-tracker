import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { followArtist, unfollowArtist } from '@/lib/userArtists';
import { enrichArtistMetadata } from '@/lib/metadataJobs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/user-artists  — follow an artist for the current user.
 * Body: { artistId: number } OR { name: string } (creates the Artist if new).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = await followArtist(userId, { artistId: body.artistId, name: body.name });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // Auto-enrich brand-new artists (MBID + image) so they don't sit metadata-less.
  if (result.created) {
    enrichArtistMetadata(result.artist.id);
  }
  return NextResponse.json({ following: true, artist: result.artist, created: result.created });
}

/**
 * DELETE /api/user-artists?artistId=123  — unfollow an artist.
 * (Also accepts { artistId } in a JSON body.)
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id);

  const { searchParams } = new URL(request.url);
  let artistId: number | null = searchParams.get('artistId') ? parseInt(searchParams.get('artistId')!) : null;
  if (!artistId) {
    try {
      const body = await request.json();
      if (body.artistId) artistId = parseInt(String(body.artistId));
    } catch {
      /* no body */
    }
  }
  if (!artistId || isNaN(artistId)) {
    return NextResponse.json({ error: 'artistId is required' }, { status: 400 });
  }

  await unfollowArtist(userId, artistId);
  return NextResponse.json({ following: false });
}
