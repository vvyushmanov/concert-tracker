import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

// GET /api/friends/requests - List pending incoming/outgoing requests
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  
  // Incoming requests (where current user is friendId)
  const incoming = await prisma.friendship.findMany({
    where: {
      friendId: userId,
      status: 'PENDING'
    },
    include: {
      user: { select: { id: true, username: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  // Outgoing requests (where current user is userId)
  const outgoing = await prisma.friendship.findMany({
    where: {
      userId,
      status: 'PENDING'
    },
    include: {
      friend: { select: { id: true, username: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  return NextResponse.json({
    incoming: incoming.map(r => ({
      id: r.id,
      from: r.user,
      createdAt: r.createdAt
    })),
    outgoing: outgoing.map(r => ({
      id: r.id,
      to: r.friend,
      createdAt: r.createdAt
    }))
  });
}
