import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { metadataState } from '../../state';

export async function POST() {
  if (metadataState.isRefreshing) {
    return NextResponse.json({ error: 'Metadata refresh already in progress' }, { status: 409 });
  }

  metadataState.isRefreshing = true;

  try {
    const pythonScript = '/app/scripts/fetch_artist_metadata.py';
    
    // Execute with --refresh-playcounts flag
    const process = spawn('python3', ['-u', pythonScript, '--refresh-playcounts'], {
      cwd: '/app/scripts',
    });

    metadataState.process = process;

    // Capture stdout and log to container logs
    process.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log('🔄 Metadata Refresh:', output);
      }
    });

    // Capture stderr and log to container logs
    process.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.error('⚠️  Metadata Refresh stderr:', output);
      }
    });

    // Handle process completion
    process.on('close', (code: number) => {
      console.log(`✅ Metadata refresh process exited with code ${code}`);
      metadataState.isRefreshing = false;
      metadataState.process = null;
    });

    process.on('error', (error: Error) => {
      console.error('❌ Failed to start metadata refresh:', error);
      metadataState.isRefreshing = false;
      metadataState.process = null;
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Metadata refresh started' 
    });

  } catch (error) {
    console.error('Metadata refresh error:', error);
    metadataState.isRefreshing = false;
    metadataState.process = null;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
