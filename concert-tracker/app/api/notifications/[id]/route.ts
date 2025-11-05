import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

// DELETE /api/notifications/[id] - Delete specific notification
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
  const notificationId = parseInt(id);
  
  // Find notification
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });
  
  if (!notification) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
  }
  
  // Security: only delete own notifications
  if (notification.userId !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  await prisma.notification.delete({
    where: { id: notificationId }
  });
  
  return NextResponse.json({ message: 'Notification deleted' });
}
