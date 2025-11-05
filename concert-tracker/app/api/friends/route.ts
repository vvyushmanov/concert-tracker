import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

// Helper: Keep only last 100 notifications per user
async function cleanupNotifications(userId: number) {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  });
  
  if (notifications.length > 100) {
    const toDelete = notifications.slice(100).map(n => n.id);
    await prisma.notification.deleteMany({
      where: { id: { in: toDelete } }
    });
  }
}

// GET /api/friends - List all accepted friends with stats
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  
  // Get friendships where status is ACCEPTED
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { userId, status: 'ACCEPTED' },
        { friendId: userId, status: 'ACCEPTED' }
      ]
    },
    include: {
      user: { select: { id: true, username: true } },
      friend: { select: { id: true, username: true } }
    }
  });
  
  // Extract friend user objects
  const friendUsers = friendships.map(f => 
    f.userId === userId ? f.friend : f.user
  );
  
  // Get stats for each friend
  const friendsWithStats = await Promise.all(
    friendUsers.map(async (friend) => {
      const now = Math.floor(Date.now() / 1000);
      
      const [totalConcerts, totalArtists, upcomingConcerts] = await Promise.all([
        prisma.userConcert.count({ where: { userId: friend.id } }),
        prisma.userArtist.count({ where: { userId: friend.id } }),
        prisma.userConcert.count({
          where: {
            userId: friend.id,
            concert: { dateStart: { gte: now } }
          }
        })
      ]);
      
      return {
        id: friend.id,
        username: friend.username,
        stats: {
          totalConcerts,
          totalArtists,
          upcomingConcerts
        }
      };
    })
  );
  
  // Sort alphabetically by username
  friendsWithStats.sort((a, b) => a.username.localeCompare(b.username));
  
  return NextResponse.json({ friends: friendsWithStats });
}

// POST /api/friends - Send friend request by username
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  const { username } = await request.json();
  
  // Get current user's username (fallback if not in session)
  let currentUsername = session.user.username;
  if (!currentUsername) {
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true }
    });
    currentUsername = currentUser?.username || 'Someone';
  }
  
  if (!username) {
    return NextResponse.json({ error: 'Username required' }, { status: 400 });
  }
  
  // Find target user
  const targetUser = await prisma.user.findUnique({
    where: { username }
  });
  
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  
  if (targetUser.id === userId) {
    return NextResponse.json({ error: 'Cannot friend yourself' }, { status: 400 });
  }
  
  // Check friend limit (500)
  const friendCount = await prisma.friendship.count({
    where: {
      OR: [
        { userId, status: 'ACCEPTED' },
        { friendId: userId, status: 'ACCEPTED' }
      ]
    }
  });
  
  if (friendCount >= 500) {
    return NextResponse.json({ error: 'Friend limit reached (500)' }, { status: 400 });
  }
  
  // Check if friendship already exists
  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { userId, friendId: targetUser.id },
        { userId: targetUser.id, friendId: userId }
      ]
    }
  });
  
  if (existing) {
    if (existing.status === 'ACCEPTED') {
      return NextResponse.json({ error: 'Already friends' }, { status: 400 });
    }
    if (existing.status === 'PENDING') {
      // Auto-accept if both users have pending requests
      if (existing.userId === targetUser.id && existing.friendId === userId) {
        // Target user already sent request to current user - auto-accept both
        await prisma.friendship.update({
          where: { id: existing.id },
          data: { status: 'ACCEPTED', updatedAt: Math.floor(Date.now() / 1000) }
        });
        
        // Create notification for both users
        const now = Math.floor(Date.now() / 1000);
        await prisma.notification.createMany({
          data: [
            {
              userId,
              type: 'FRIEND_ACCEPTED',
              fromUserId: targetUser.id,
              message: `${targetUser.username} accepted your friend request`,
              createdAt: now
            },
            {
              userId: targetUser.id,
              type: 'FRIEND_ACCEPTED',
              fromUserId: userId,
              message: `${currentUsername} accepted your friend request`,
              createdAt: now
            }
          ]
        });
        
        // Clean up old notifications (keep last 100 per user)
        await cleanupNotifications(userId);
        await cleanupNotifications(targetUser.id);
        
        return NextResponse.json({ 
          message: 'Friend request auto-accepted',
          autoAccepted: true 
        });
      }
      return NextResponse.json({ error: 'Friend request already sent' }, { status: 400 });
    }
  }
  
  // Create new friend request
  const now = Math.floor(Date.now() / 1000);
  await prisma.friendship.create({
    data: {
      userId,
      friendId: targetUser.id,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now
    }
  });
  
  // Create notification for target user
  await prisma.notification.create({
    data: {
      userId: targetUser.id,
      type: 'FRIEND_REQUEST',
      fromUserId: userId,
      message: `${currentUsername} sent you a friend request`,
      createdAt: now
    }
  });
  
  // Clean up old notifications
  await cleanupNotifications(targetUser.id);
  
  return NextResponse.json({ message: 'Friend request sent' });
}
