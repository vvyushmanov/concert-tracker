import { spawn } from 'child_process';
import { scannerState, broadcastLog, broadcastState } from './state';

export async function startScan(userId: number, debug: boolean = false) {
  // Check if user already has a scan running or stopping
  const existingState = scannerState.get(userId);
  if (existingState?.isScanning || existingState?.isStopping) {
    console.log(`⚠️  Cannot start scan for user ${userId}: ${existingState?.isStopping ? 'previous scan is stopping' : 'scan already running'}`);
    return;
  }
  
  // Initialize or update user's scanner state, preserving listeners
  if (existingState) {
    // Update existing state, keep listeners
    existingState.isScanning = true;
    existingState.isStopping = false;
    existingState.process = null;
    existingState.startTime = Date.now();
    existingState.lastStats = null;
  } else {
    // Create new state
    scannerState.set(userId, {
      isScanning: true,
      isStopping: false,
      process: null,
      listeners: [],
      startTime: Date.now(),
      lastStats: null
    });
  }
  
  // Broadcast initial state to connected clients
  broadcastState(userId);
  
  try {
    const { prisma } = await import('@/lib/prisma');
    
    // Count concerts associated with user via UserConcert
    const beforeCount = await prisma.userConcert.count({
      where: { userId }
    });
    
    broadcastLog(userId, `Starting scan${debug ? ' (DEBUG MODE)' : ''}... Current concerts: ${beforeCount}`, 'log');
    
    // Path to Python script (inside Docker container)
    const pythonScript = '/app/scripts/parse_concerts.py';
    
    // Build arguments array
    const args = [
      '-u', 
      pythonScript, 
      '--user-id', userId.toString(),
      '--output', 'db', 
      '--use-proxies', 'webshare'
    ];
    
    // Add debug flag if enabled
    if (debug) {
      args.push('--debug');
    }
    
    // Execute Python parser with user ID for per-user settings
    // -u flag for unbuffered output so we see logs in real-time
    const process = spawn('python3', args, {
      cwd: '/app/scripts',
    });
    
    const state = scannerState.get(userId);
    if (state) {
      state.process = process;
    }
    
    process.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`🐍 Concert Parser [User ${userId}]:`, output);
        broadcastLog(userId, output, 'log');
      }
    });
    
    process.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.error(`⚠️  Concert Parser stderr [User ${userId}]:`, output);
        broadcastLog(userId, `ERROR: ${output}`, 'log');
      }
    });
    
    process.on('close', async (code) => {
      console.log(`✅ Concert Parser [User ${userId}] exited with code ${code}`);
      
      // Get counts after scan - concerts associated with user via UserConcert
      const afterCount = await prisma.userConcert.count({
        where: { userId }
      });
      const newConcerts = afterCount - beforeCount;
      
      console.log(`📊 Concert count for user ${userId}: ${afterCount} (+${newConcerts})`);
      
      const stats = {
        before: beforeCount,
        after: afterCount,
        new: newConcerts,
      };
      
      // Update state with completion info
      const state = scannerState.get(userId);
      if (state) {
        state.isScanning = false;
        state.isStopping = false; // Clear stopping flag
        state.process = null;
        state.lastStats = stats; // Save stats for later retrieval
      }
      
      if (code === 0) {
        broadcastLog(userId, `Scan complete! Found ${newConcerts} new concerts.`, 'complete', stats);
      } else {
        broadcastLog(userId, `Scan failed with exit code ${code}`, 'error', stats);
      }
      
      // Broadcast final state to connected clients
      broadcastState(userId);
    });
    
    process.on('error', (error) => {
      console.error(`Failed to start scan process [User ${userId}]:`, error);
      const state = scannerState.get(userId);
      if (state) {
        state.isScanning = false;
        state.isStopping = false;
        state.process = null;
      }
      broadcastLog(userId, `Failed to start scan: ${error.message}`, 'error');
      broadcastState(userId); // Broadcast error state
    });
    
  } catch (error) {
    console.error(`Scan error [User ${userId}]:`, error);
    const state = scannerState.get(userId);
    if (state) {
      state.isScanning = false;
      state.isStopping = false;
      state.process = null;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    broadcastLog(userId, `Scan error: ${errorMessage}`, 'error');
    broadcastState(userId); // Broadcast error state
  }
}
