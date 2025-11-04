import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

/**
 * GET /api/admin/users
 * List all users (admin only)
 */
export async function GET() {
  const session = await auth();
  
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        // Don't send hashed password
        _count: {
          select: {
            settings: true,
            concerts: true,
            artists: true,
            activeCountries: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return Response.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * POST /api/admin/users
 * Create a new user (admin only)
 */
export async function POST(request: Request) {
  const session = await auth();
  
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const { username, password, role } = await request.json();

    // Validation
    if (!username || !password) {
      return Response.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 100) {
      return Response.json(
        { error: 'Username must be between 3 and 100 characters' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return Response.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    if (role && role !== 'USER' && role !== 'ADMIN') {
      return Response.json(
        { error: 'Role must be USER or ADMIN' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existingUser = await prisma.user.findUnique({
      where: { username }
    });

    if (existingUser) {
      return Response.json(
        { error: 'Username already exists' },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const now = Math.floor(Date.now() / 1000);
    const newUser = await prisma.user.create({
      data: {
        username,
        hashedPassword,
        role: role || 'USER',
        createdAt: now,
        updatedAt: now,
      },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    // Create default user settings
    await prisma.userSetting.createMany({
      data: [
        {
          userId: newUser.id,
          key: 'MIN_PLAYCOUNT',
          value: '1',
          valueType: 'int',
          createdAt: now,
          updatedAt: now
        },
        {
          userId: newUser.id,
          key: 'LASTFM_USER',
          value: '',
          valueType: 'string',
          createdAt: now,
          updatedAt: now
        },
        {
          userId: newUser.id,
          key: 'LASTFM_API_KEY',
          value: '',
          valueType: 'string',
          createdAt: now,
          updatedAt: now
        }
      ]
    });

    // Log the creation
    await prisma.settingAuditLog.create({
      data: {
        userId: parseInt(session.user.id),
        key: 'USER_MANAGEMENT',
        oldValue: null,
        newValue: `Created user: ${username} with role: ${role || 'USER'}`,
        createdAt: now
      }
    });

    return Response.json(newUser, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
