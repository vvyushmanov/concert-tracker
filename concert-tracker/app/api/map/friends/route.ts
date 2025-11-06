import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = parseInt(session.user.id);

    // Get accepted friendships where user is either sender or receiver
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { userId: userId, status: 'ACCEPTED' },
          { friendId: userId, status: 'ACCEPTED' }
        ]
      },
      include: {
        user: {
          select: {
            id: true,
            username: true
          }
        },
        friend: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

    // Extract friend data (the other person in each friendship)
    const friends = friendships.map(friendship => {
      const isUser = friendship.userId === userId;
      const friendData = isUser ? friendship.friend : friendship.user;
      return {
        id: friendData.id,
        username: friendData.username
      };
    });

    return NextResponse.json({ friends });
  } catch (error) {
    console.error('Error fetching friends:', error);
    return NextResponse.json(
      { error: 'Failed to fetch friends' },
      { status: 500 }
    );
  }
}
