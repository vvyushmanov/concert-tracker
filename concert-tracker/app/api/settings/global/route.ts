import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  const settings = await prisma.setting.findMany({
    orderBy: { key: 'asc' }
  });
  
  return Response.json(settings);
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  const updates = await request.json();
  const userId = parseInt(session.user.id);
  const now = Math.floor(Date.now() / 1000);

  for (const { key, value, valueType } of updates) {
    // Get old value for audit log
    const oldSetting = await prisma.setting.findUnique({ where: { key } });
    const newValue = String(value);
    const oldValue = oldSetting?.value || null;
    
    // Only update and log if value actually changed
    if (oldValue !== newValue) {
      // Update setting
      await prisma.setting.upsert({
        where: { key },
        update: { value: newValue, valueType, updatedAt: now },
        create: { key, value: newValue, valueType, createdAt: now, updatedAt: now }
      });

      // Create audit log entry only for actual changes
      await prisma.settingAuditLog.create({
        data: {
          userId,
          key,
          oldValue,
          newValue,
          createdAt: now
        }
      });
    }
  }

  return Response.json({ success: true });
}
