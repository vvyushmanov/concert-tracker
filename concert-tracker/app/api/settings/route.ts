import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { spawn } from 'child_process';

/**
 * GET /api/settings
 * Get all settings
 */
export async function GET() {
  try {
    const settings = await prisma.setting.findMany({
      orderBy: { key: 'asc' }
    });
    
    return NextResponse.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings
 * Update multiple settings at once
 */
export async function PATCH(request: NextRequest) {
  try {
    const updates = await request.json();
    
    if (!Array.isArray(updates)) {
      return NextResponse.json(
        { error: 'Expected array of settings' },
        { status: 400 }
      );
    }
    
    // Update each setting
    const results = [];
    for (const update of updates) {
      const { key, value, valueType } = update;
      
      if (!key || value === undefined) {
        continue;
      }
      
      const setting = await prisma.setting.update({
        where: { key },
        data: {
          value: String(value),
          valueType: valueType || 'string',
          updatedAt: Math.floor(Date.now() / 1000)
        }
      });
      
      results.push(setting);
    }
    
    // Invalidate Python cache for all updated keys
    await invalidatePythonCache();
    
    return NextResponse.json({
      success: true,
      updated: results.length,
      settings: results
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}

/**
 * Helper function to invalidate Python ConfigManager cache
 */
async function invalidatePythonCache(key?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = key ? [key] : [];
    const process = spawn('python', [
      '/app/scripts/invalidate_cache.py',
      ...args
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
        console.log('Cache invalidation:', output.trim());
        resolve();
      } else {
        console.error('Cache invalidation failed:', errorOutput);
        // Don't reject - cache invalidation failure shouldn't break the update
        resolve();
      }
    });
    
    process.on('error', (error) => {
      console.error('Failed to spawn cache invalidation process:', error);
      // Don't reject - cache invalidation failure shouldn't break the update
      resolve();
    });
  });
}
