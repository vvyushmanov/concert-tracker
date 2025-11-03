import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { spawn } from 'child_process';

/**
 * GET /api/settings/countries
 * Get all countries with their active status
 */
export async function GET() {
  try {
    const countries = await prisma.country.findMany({
      orderBy: [
        { active: 'desc' }, // Active countries first
        { name: 'asc' }     // Then alphabetical
      ]
    });
    
    return NextResponse.json(countries);
  } catch (error) {
    console.error('Error fetching countries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch countries' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/settings/countries
 * Remove a country if it has no related records
 */
export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: 'Country id is required' },
        { status: 400 }
      );
    }

    const countryId = typeof id === 'string' ? parseInt(id, 10) : id;
    if (Number.isNaN(countryId)) {
      return NextResponse.json(
        { error: 'Invalid country id' },
        { status: 400 }
      );
    }

    const country = await prisma.country.findUnique({
      where: { id: countryId }
    });

    if (!country) {
      return NextResponse.json(
        { error: 'Country not found' },
        { status: 404 }
      );
    }

    const [concertCount, mappingCount] = await Promise.all([
      prisma.concert.count({ where: { countryId } }),
      prisma.cityMapping.count({ where: { countryId } })
    ]);

    if (concertCount > 0 || mappingCount > 0) {
      return NextResponse.json(
        {
          error: 'Country is in use by existing records. Mark it inactive instead of deleting.'
        },
        { status: 400 }
      );
    }

    await prisma.country.delete({ where: { id: countryId } });

    return NextResponse.json({
      success: true,
      message: `Country ${country.name} removed`
    });
  } catch (error) {
    console.error('Error deleting country:', error);
    return NextResponse.json(
      { error: 'Failed to delete country' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/countries
 * Add a new country by name or code using country_helper.py
 */
export async function POST(request: NextRequest) {
  try {
    const { input, active = true } = await request.json();
    
    if (!input || typeof input !== 'string') {
      return NextResponse.json(
        { error: 'Country name or code is required' },
        { status: 400 }
      );
    }
    
    // Use Python script to add country with country_helper.py
    const result = await addCountryViaPython(input.trim(), active);
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        country: result.country,
        message: result.message
      });
    } else {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error adding country:', error);
    return NextResponse.json(
      { error: 'Failed to add country' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/countries
 * Update active status of multiple countries
 */
export async function PATCH(request: NextRequest) {
  try {
    const { updates } = await request.json();
    
    if (!Array.isArray(updates)) {
      return NextResponse.json(
        { error: 'Expected array of country updates' },
        { status: 400 }
      );
    }
    
    // Update each country
    const results = [];
    for (const update of updates) {
      const { id, active } = update;
      
      if (!id || typeof active !== 'boolean') {
        continue;
      }
      
      const country = await prisma.country.update({
        where: { id: parseInt(id) },
        data: {
          active,
          updatedAt: Math.floor(Date.now() / 1000)
        }
      });
      
      results.push(country);
    }
    
    return NextResponse.json({
      success: true,
      updated: results.length,
      countries: results
    });
  } catch (error) {
    console.error('Error updating countries:', error);
    return NextResponse.json(
      { error: 'Failed to update countries' },
      { status: 500 }
    );
  }
}

/**
 * Helper function to add country using Python country_helper.py
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
      console.log(`add_country.py exited with code ${code}`);

      if (output.trim()) {
        console.log('add_country.py stdout:', output.trim());
      }

      if (errorOutput.trim()) {
        console.error('add_country.py stderr:', errorOutput.trim());
      }

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
      console.error('Failed to spawn add_country.py:', error);
      resolve({
        success: false,
        error: `Failed to spawn Python process: ${error.message}`
      });
    });
  });
}
