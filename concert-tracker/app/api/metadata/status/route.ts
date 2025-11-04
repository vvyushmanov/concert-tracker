import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { metadataRefreshState } from '../../state';

export async function GET() {
  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const userState = metadataRefreshState.get(userId);

  return NextResponse.json({ 
    isRefreshing: userState?.isRefreshing ?? false
  });
}
