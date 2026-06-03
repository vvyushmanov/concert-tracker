import { spawn } from 'child_process';
import { scannerState, broadcastLog, broadcastState } from './state';

// Scanning always populates the GLOBAL concert table (--no-filter, user_id=None).
// `userId` here is just the admin who triggered it — used only to key scanner
// session state (logs/SSE), never to materialize per-user rows.
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

    // Count GLOBAL concerts (the table this scan populates). UserConcert is
    // user-state now and is never created by scanning.
    const beforeCount = await prisma.concert.count();

    const scanMode = debug ? ' (GLOBAL SCAN - DEBUG)' : ' (GLOBAL SCAN - NO FILTER)';
    broadcastLog(userId, `Starting scan${scanMode}... Current concerts: ${beforeCount}`, 'log');

    // Path to Python script (inside Docker container)
    const pythonScript = '/app/scripts/parse_concerts.py';

    // Always a global, unfiltered population (user_id=None → writer skips
    // UserConcert/UserArtist).
    const args = [
      '-u',
      pythonScript,
      '--output', 'db',
      '--use-proxies', 'webshare',
      '--no-color-log',
      '--no-filter',
    ];

    // Add debug flag if enabled
    if (debug) {
      args.push('--debug');
    }
    
    // Execute Python parser in global (--no-filter) mode.
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
      
      // Get counts after scan - global Concert table
      const afterCount = await prisma.concert.count();
      const newConcerts = afterCount - beforeCount;

      console.log(`📊 Global concert count: ${afterCount} (+${newConcerts})`);
      
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
