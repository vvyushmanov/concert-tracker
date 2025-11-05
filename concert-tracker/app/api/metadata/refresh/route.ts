import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { auth } from '@/auth';
import { metadataRefreshState } from '../../state';

export async function POST() {
  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = parseInt(session.user.id);

  // Check if user already has a refresh running
  if (metadataRefreshState.has(userId)) {
    return NextResponse.json({ 
      error: 'You already have a metadata refresh in progress' 
    }, { status: 409 });
  }

  try {
    const pythonScript = '/app/scripts/fetch_metadata.py';
    
    // Execute with user ID and refresh-playcounts flag
    const process = spawn('python3', [
      '-u', 
      pythonScript, 
      '--user-id', userId.toString(),
      '--refresh-playcounts'
    ], {
      cwd: '/app/scripts',
    });

    // Track user's refresh
    metadataRefreshState.set(userId, {
      isRefreshing: true,
      process,
      startTime: Date.now()
    });

    // Capture stdout and log to container logs
    process.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`🔄 Metadata Refresh [User ${userId}]:`, output);
      }
    });

    // Capture stderr and log to container logs
    process.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.error(`⚠️  Metadata Refresh stderr [User ${userId}]:`, output);
      }
    });

    // Handle process completion
    process.on('close', (code: number) => {
      console.log(`✅ Metadata refresh [User ${userId}] exited with code ${code}`);
      metadataRefreshState.delete(userId);
    });

    process.on('error', (error: Error) => {
      console.error(`❌ Metadata refresh [User ${userId}] error:`, error);
      metadataRefreshState.delete(userId);
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Metadata refresh started with your Last.fm credentials'
    });

  } catch (error) {
    console.error('Metadata refresh error:', error);
    metadataRefreshState.delete(userId);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
