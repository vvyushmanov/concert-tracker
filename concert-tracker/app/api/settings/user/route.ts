import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId = parseInt(session.user.id);
  const userSettings = await prisma.userSetting.findMany({
    where: { userId },
    orderBy: { key: 'asc' }
  });

  // Define defaults for per-user settings
  const defaults = [
    { key: 'MIN_PLAYCOUNT', value: '1', valueType: 'int' },
    { key: 'LASTFM_USER', value: '', valueType: 'string' },
    { key: 'LASTFM_API_KEY', value: '', valueType: 'string' },
  ];

  // Merge with user's actual settings
  const merged = defaults.map(def => {
    const userSetting = userSettings.find(s => s.key === def.key);
    return userSetting || { ...def, userId };
  });

  return Response.json(merged);
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId = parseInt(session.user.id);
  const updates = await request.json();
  const now = Math.floor(Date.now() / 1000);

  for (const { key, value, valueType } of updates) {
    await prisma.userSetting.upsert({
      where: { userId_key: { userId, key } },
      update: { value: String(value), valueType, updatedAt: now },
      create: { userId, key, value: String(value), valueType, createdAt: now, updatedAt: now }
    });
  }

  return Response.json({ success: true });
}
