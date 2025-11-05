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

// PATCH /api/friends/[id] - Accept or decline friend request
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const { id } = await params;
  const userId = parseInt(session.user.id);
  const friendshipId = parseInt(id);
  const { action } = await request.json(); // 'accept' or 'decline'
  
  // Get current user's username (fallback if not in session)
  let currentUsername = session.user.username;
  if (!currentUsername) {
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true }
    });
    currentUsername = currentUser?.username || 'Someone';
  }
  
  if (!['accept', 'decline'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
  
  // Find friendship
  const friendship = await prisma.friendship.findUnique({
    where: { id: friendshipId },
    include: {
      user: { select: { username: true } },
      friend: { select: { username: true } }
    }
  });
  
  if (!friendship) {
    return NextResponse.json({ error: 'Friend request not found' }, { status: 404 });
  }
  
  // Only the recipient (friendId) can accept/decline
  if (friendship.friendId !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  if (friendship.status !== 'PENDING') {
    return NextResponse.json({ error: 'Request already processed' }, { status: 400 });
  }
  
  const now = Math.floor(Date.now() / 1000);
  
  if (action === 'accept') {
    // Accept friend request
    await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'ACCEPTED', updatedAt: now }
    });
    
    // Create notification for requester
    await prisma.notification.create({
      data: {
        userId: friendship.userId,
        type: 'FRIEND_ACCEPTED',
        fromUserId: userId,
        message: `${currentUsername} accepted your friend request`,
        createdAt: now
      }
    });
    
    // Clean up old notifications
    await cleanupNotifications(friendship.userId);
    
    return NextResponse.json({ message: 'Friend request accepted' });
  } else {
    // Decline friend request (just delete it)
    await prisma.friendship.delete({
      where: { id: friendshipId }
    });
    
    return NextResponse.json({ message: 'Friend request declined' });
  }
}

// DELETE /api/friends/[id] - Unfriend or cancel request
// [id] can be either friendship ID or friend user ID
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const { id } = await params;
  const userId = parseInt(session.user.id);
  const targetId = parseInt(id);
  
  // Try to find friendship by ID first
  let friendship = await prisma.friendship.findUnique({
    where: { id: targetId }
  });
  
  // If not found by ID, try to find by user IDs (friend user ID was passed)
  if (!friendship) {
    friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId, friendId: targetId },
          { userId: targetId, friendId: userId }
        ]
      }
    });
  }
  
  if (!friendship) {
    return NextResponse.json({ error: 'Friendship not found' }, { status: 404 });
  }
  
  // User must be part of the friendship
  if (friendship.userId !== userId && friendship.friendId !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  // Delete friendship (instant unfriend or cancel request)
  await prisma.friendship.delete({
    where: { id: friendship.id }
  });
  
  const message = friendship.status === 'PENDING' 
    ? 'Friend request cancelled' 
    : 'Friend removed';
  
  return NextResponse.json({ message });
}
