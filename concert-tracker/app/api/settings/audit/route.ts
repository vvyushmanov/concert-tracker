import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const session = await auth();
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  const logs = await prisma.settingAuditLog.findMany({
    take: limit,
    skip: offset,
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { username: true, role: true }
      }
    }
  });

  const total = await prisma.settingAuditLog.count();

  return Response.json({
    logs,
    total,
    limit,
    offset
  });
}
