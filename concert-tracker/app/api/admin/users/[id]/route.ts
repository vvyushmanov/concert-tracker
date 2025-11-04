import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

/**
 * GET /api/admin/users/[id]
 * Get a specific user (admin only)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return Response.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            settings: true,
            concerts: true,
            artists: true,
            activeCountries: true,
          }
        }
      }
    });

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    return Response.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * PATCH /api/admin/users/[id]
 * Update user (reset password, change role) - admin only
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return Response.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const { password, role } = await request.json();

    // Validate inputs
    if (password && password.length < 6) {
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

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Prepare update data
    const updateData: any = {
      updatedAt: Math.floor(Date.now() / 1000)
    };

    if (password) {
      updateData.hashedPassword = await bcrypt.hash(password, 10);
    }

    if (role) {
      updateData.role = role;
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    // Log the action
    const now = Math.floor(Date.now() / 1000);
    const actions = [];
    if (password) actions.push('reset password');
    if (role) actions.push(`changed role to ${role}`);

    await prisma.settingAuditLog.create({
      data: {
        userId: parseInt(session.user.id),
        key: 'USER_MANAGEMENT',
        oldValue: `User: ${existingUser.username}, Role: ${existingUser.role}`,
        newValue: `Updated user ${existingUser.username}: ${actions.join(', ')}`,
        createdAt: now
      }
    });

    return Response.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * DELETE /api/admin/users/[id]
 * Delete a user (admin only)
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return Response.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    // Prevent deleting yourself
    if (userId === parseInt(session.user.id)) {
      return Response.json(
        { error: 'Cannot delete your own account' },
        { status: 400 }
      );
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Delete user and all related records
    // Note: Prisma schema doesn't have onDelete: Cascade, so we delete manually
    await prisma.$transaction([
      // Delete user-specific data
      prisma.userSetting.deleteMany({ where: { userId } }),
      prisma.userConcert.deleteMany({ where: { userId } }),
      prisma.userArtist.deleteMany({ where: { userId } }),
      prisma.userActiveCountry.deleteMany({ where: { userId } }),
      // Note: SettingAuditLog entries are kept for audit trail
      // Finally delete the user
      prisma.user.delete({ where: { id: userId } })
    ]);

    // Log the deletion
    const now = Math.floor(Date.now() / 1000);
    await prisma.settingAuditLog.create({
      data: {
        userId: parseInt(session.user.id),
        key: 'USER_MANAGEMENT',
        oldValue: `User: ${existingUser.username}, Role: ${existingUser.role}`,
        newValue: 'DELETED',
        createdAt: now
      }
    });

    return Response.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
