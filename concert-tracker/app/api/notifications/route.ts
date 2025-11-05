import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

// GET /api/notifications - List user's notifications
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  
  // Get unread count
  const unreadCount = await prisma.notification.count({
    where: { userId, read: false }
  });
  
  // Get recent notifications (last 20)
  const notifications = await prisma.notification.findMany({
    where: { userId },
    include: {
      fromUser: { select: { id: true, username: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  
  return NextResponse.json({
    unreadCount,
    notifications: notifications.map(n => ({
      id: n.id,
      type: n.type,
      message: n.message,
      read: n.read,
      createdAt: n.createdAt,
      fromUser: n.fromUser
    }))
  });
}

// PATCH /api/notifications - Mark notification(s) as read
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  const { notificationIds, markAllRead } = await request.json();
  
  if (markAllRead) {
    // Mark all as read
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true }
    });
    return NextResponse.json({ message: 'All notifications marked as read' });
  }
  
  if (!notificationIds || !Array.isArray(notificationIds)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  
  // Mark specific notifications as read
  await prisma.notification.updateMany({
    where: {
      id: { in: notificationIds },
      userId // Security: only mark user's own notifications
    },
    data: { read: true }
  });
  
  return NextResponse.json({ message: 'Notifications marked as read' });
}
