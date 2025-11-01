import { spawn } from 'child_process';
import { scannerState, broadcastLog } from './state';

export async function startScan() {
  if (scannerState.isScanning) {
    return;
  }
  
  scannerState.isScanning = true;
  
  try {
    const { prisma } = await import('@/lib/prisma');
    const beforeCount = await prisma.concert.count();
    
    broadcastLog(`Starting scan... Current concerts: ${beforeCount}`, 'log');
    
    // Path to Python script (inside Docker container)
    const pythonScript = '/app/scripts/country_concert_parser.py';
    
    // Execute Python parser with spawn for real-time output
    // -u flag for unbuffered output so we see logs in real-time
    // DATABASE_URL is set via environment variables, no --db-path needed
    const process = spawn('python3', ['-u', pythonScript, '--output', 'db', '--use-proxies', 'webshare'], {
      cwd: '/app/scripts',
    });
    
    scannerState.process = process;
    
    process.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log('🐍 Concert Parser:', output);
        broadcastLog(output, 'log');
      }
    });
    
    process.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.error('⚠️  Concert Parser stderr:', output);
        broadcastLog(`ERROR: ${output}`, 'log');
      }
    });
    
    process.on('close', async (code) => {
      console.log(`✅ Concert Parser process exited with code ${code}`);
      
      scannerState.isScanning = false;
      scannerState.process = null;
      
      // Get counts after scan
      const afterCount = await prisma.concert.count();
      const newConcerts = afterCount - beforeCount;
      
      console.log(`📊 New concert count: ${afterCount} (+${newConcerts})`);
      
      const stats = {
        before: beforeCount,
        after: afterCount,
        new: newConcerts,
      };
      
      if (code === 0) {
        broadcastLog(`Scan complete! Found ${newConcerts} new concerts.`, 'complete', stats);
      } else {
        broadcastLog(`Scan failed with exit code ${code}`, 'error', stats);
      }
    });
    
    process.on('error', (error) => {
      console.error('Failed to start scan process:', error);
      scannerState.isScanning = false;
      scannerState.process = null;
      broadcastLog(`Failed to start scan: ${error.message}`, 'error');
    });
    
  } catch (error) {
    console.error('Scan error:', error);
    scannerState.isScanning = false;
    scannerState.process = null;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    broadcastLog(`Scan error: ${errorMessage}`, 'error');
  }
}
