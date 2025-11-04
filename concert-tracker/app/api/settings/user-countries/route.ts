import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { spawn } from 'child_process';

/**
 * GET /api/settings/user-countries
 * Get all countries with user's active status
 */
export async function GET() {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId = parseInt(session.user.id);

  try {
    // Get all countries with user's active status
    const countries = await prisma.country.findMany({
      include: {
        userActiveCountries: {
          where: { userId },
          select: { id: true }
        }
      },
      orderBy: [
        { name: 'asc' }
      ]
    });

    // Transform to include userActive flag
    const countriesWithUserStatus = countries.map(country => ({
      id: country.id,
      name: country.name,
      code: country.code,
      userActive: country.userActiveCountries.length > 0,
      createdAt: country.createdAt,
      updatedAt: country.updatedAt
    }));

    return Response.json(countriesWithUserStatus);
  } catch (error) {
    console.error('Error fetching user countries:', error);
    return Response.json({ error: 'Failed to fetch countries' }, { status: 500 });
  }
}

/**
 * POST /api/settings/user-countries
 * Add a new country (any user can add)
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId = parseInt(session.user.id);

  try {
    const { input } = await request.json();
    
    if (!input || typeof input !== 'string') {
      return Response.json({ error: 'Country name or code is required' }, { status: 400 });
    }
    
    // Use Python script to add country
    const result = await addCountryViaPython(input.trim(), false); // Start as inactive globally
    
    if (result.success && result.country) {
      // Automatically activate for this user
      const now = Math.floor(Date.now() / 1000);
      await prisma.userActiveCountry.upsert({
        where: {
          userId_countryId: { userId, countryId: result.country.id }
        },
        create: {
          userId,
          countryId: result.country.id,
          createdAt: now
        },
        update: {} // Already exists, no change needed
      });

      return Response.json({
        success: true,
        country: { ...result.country, userActive: true },
        message: result.message
      });
    } else {
      return Response.json({ error: result.error }, { status: 400 });
    }
  } catch (error) {
    console.error('Error adding country:', error);
    return Response.json({ error: 'Failed to add country' }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/user-countries
 * Toggle user's active status for a country
 */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId = parseInt(session.user.id);

  try {
    const { countryId, userActive } = await request.json();
    
    if (!countryId || typeof userActive !== 'boolean') {
      return Response.json({ error: 'countryId and userActive are required' }, { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);

    if (userActive) {
      // Add to user's active countries
      await prisma.userActiveCountry.upsert({
        where: {
          userId_countryId: { userId, countryId: parseInt(countryId) }
        },
        create: {
          userId,
          countryId: parseInt(countryId),
          createdAt: now
        },
        update: {} // Already exists
      });
    } else {
      // Remove from user's active countries
      await prisma.userActiveCountry.deleteMany({
        where: {
          userId,
          countryId: parseInt(countryId)
        }
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error updating user country:', error);
    return Response.json({ error: 'Failed to update country' }, { status: 500 });
  }
}

/**
 * DELETE /api/settings/user-countries
 * Delete a country (admin only)
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const { id } = await request.json();

    if (!id) {
      return Response.json({ error: 'Country id is required' }, { status: 400 });
    }

    const countryId = typeof id === 'string' ? parseInt(id, 10) : id;
    if (Number.isNaN(countryId)) {
      return Response.json({ error: 'Invalid country id' }, { status: 400 });
    }

    const country = await prisma.country.findUnique({
      where: { id: countryId }
    });

    if (!country) {
      return Response.json({ error: 'Country not found' }, { status: 404 });
    }

    const [concertCount, mappingCount, userActiveCount] = await Promise.all([
      prisma.concert.count({ where: { countryId } }),
      prisma.cityMapping.count({ where: { countryId } }),
      prisma.userActiveCountry.count({ where: { countryId } })
    ]);

    if (concertCount > 0 || mappingCount > 0) {
      return Response.json({
        error: 'Country is in use by existing records. Cannot delete.'
      }, { status: 400 });
    }

    // Delete user active country records first (if any)
    if (userActiveCount > 0) {
      await prisma.userActiveCountry.deleteMany({ where: { countryId } });
    }

    await prisma.country.delete({ where: { id: countryId } });

    return Response.json({
      success: true,
      message: `Country ${country.name} deleted`
    });
  } catch (error) {
    console.error('Error deleting country:', error);
    return Response.json({ error: 'Failed to delete country' }, { status: 500 });
  }
}

/**
 * Helper function to add country using Python add_country.py
 */
async function addCountryViaPython(input: string, active: boolean): Promise<{
  success: boolean;
  country?: any;
  message?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const process = spawn('python', [
      '/app/scripts/add_country.py',
      input,
      active ? 'true' : 'false'
    ]);
    
    let output = '';
    let errorOutput = '';
    
    process.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output.trim());
          resolve(result);
        } catch (e) {
          resolve({
            success: false,
            error: 'Failed to parse Python script output'
          });
        }
      } else {
        resolve({
          success: false,
          error: errorOutput || 'Python script failed'
        });
      }
    });
    
    process.on('error', (error) => {
      resolve({
        success: false,
        error: `Failed to spawn Python process: ${error.message}`
      });
    });
  });
}
