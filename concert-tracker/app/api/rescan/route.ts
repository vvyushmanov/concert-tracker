import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST() {
  try {
    // Get counts before scan
    const { prisma } = await import('@/lib/prisma');
    const beforeCount = await prisma.concert.count();
    
    // Path to Python script (inside Docker container)
    const pythonScript = '/app/scripts/parse_concerts.py';
    
    console.log('🔍 Starting concert scan...');
    console.log(`📊 Current concert count: ${beforeCount}`);
    
    // Execute Python parser with spawn for real-time output
    // -u flag for unbuffered output so we see logs in real-time
    // DATABASE_URL is set via environment variables, no --db-path needed
    return new Promise((resolve) => {
      const process = spawn('python3', ['-u', pythonScript, '--output', 'db', '--use-proxies', 'webshare'], {
        cwd: '/app/scripts',
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log('🐍 Concert Parser:', output.trim());
      });
      
      process.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.error('⚠️  Concert Parser stderr:', output.trim());
      });
      
      process.on('close', async (code) => {
        console.log(`✅ Concert Parser   process exited with code ${code}`);
        
        // Get counts after scan
        const afterCount = await prisma.concert.count();
        const newConcerts = afterCount - beforeCount;
        
        console.log(`📊 New concert count: ${afterCount} (+${newConcerts})`);
        
        if (code === 0) {
          resolve(NextResponse.json({
            success: true,
            message: 'Scan completed successfully',
            stats: {
              before: beforeCount,
              after: afterCount,
              new: newConcerts,
            },
            output: stdout,
          }));
        } else {
          resolve(NextResponse.json({
            success: false,
            error: 'Scan failed',
            details: stderr || stdout,
            stats: {
              before: beforeCount,
              after: afterCount,
              new: newConcerts,
            },
          }, { status: 500 }));
        }
      });
    });
  } catch (error) {
    console.error('Rescan error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to run concert scan',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
