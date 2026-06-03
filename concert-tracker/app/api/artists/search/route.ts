import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { searchArtists } from '@/lib/userArtists';

export const dynamic = 'force-dynamic';

/**
 * GET /api/artists/search?q=...  — search global artists by name, annotated with
 * whether the current user already follows each (to render follow/unfollow state).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = parseInt(session.user.id);

  const { searchParams } = new URL(request.url);
  const artists = await searchArtists(userId, searchParams.get('q') || '');
  return NextResponse.json({ artists });
}
