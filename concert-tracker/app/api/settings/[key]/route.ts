import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { spawn } from 'child_process';

/**
 * GET /api/settings/[key]
 * Get a single setting by key
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const setting = await prisma.setting.findUnique({
      where: { key }
    });
    
    if (!setting) {
      return NextResponse.json(
        { error: 'Setting not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(setting);
  } catch (error) {
    console.error('Error fetching setting:', error);
    return NextResponse.json(
      { error: 'Failed to fetch setting' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings/[key]
 * Update a single setting
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const body = await request.json();
    const { value, valueType } = body;
    
    if (value === undefined) {
      return NextResponse.json(
        { error: 'Value is required' },
        { status: 400 }
      );
    }
    
    // Convert value to string for storage
    let stringValue: string;
    if (valueType === 'json') {
      stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    } else {
      stringValue = String(value);
    }
    
    const setting = await prisma.setting.update({
      where: { key },
      data: {
        value: stringValue,
        valueType: valueType || 'string',
        updatedAt: Math.floor(Date.now() / 1000)
      }
    });
    
    // Invalidate Python cache for this specific key
    await invalidatePythonCache(key);
    
    return NextResponse.json({
      success: true,
      setting
    });
  } catch (error: any) {
    console.error('Error updating setting:', error);
    
    if (error.code === 'P2025') {
      return NextResponse.json(
        { error: 'Setting not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to update setting' },
      { status: 500 }
    );
  }
}

/**
 * Helper function to invalidate Python ConfigManager cache
 */
async function invalidatePythonCache(key?: string): Promise<void> {
  return new Promise((resolve) => {
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
      } else {
        console.error('Cache invalidation failed:', errorOutput);
      }
      resolve();
    });
    
    process.on('error', (error) => {
      console.error('Failed to spawn cache invalidation process:', error);
      resolve();
    });
  });
}
