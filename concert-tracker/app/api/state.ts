import { ChildProcess } from 'child_process';

type LogListener = (message: string, type: 'log' | 'complete' | 'error' | 'state', stats?: any) => void;

// Scanner state - per user
export const scannerState = new Map<number, {
  isScanning: boolean;
  isStopping: boolean; // Track graceful shutdown period
  process: ChildProcess | null;
  listeners: Array<LogListener>;
  startTime: number;
  lastStats: { before: number; after: number; new: number } | null;
}>();

export function addLogListener(userId: number, listener: LogListener) {
  const state = scannerState.get(userId);
  if (state) {
    state.listeners.push(listener);
  }
}

export function removeLogListener(userId: number, listener: LogListener) {
  const state = scannerState.get(userId);
  if (state) {
    const index = state.listeners.indexOf(listener);
    if (index > -1) {
      state.listeners.splice(index, 1);
    }
  }
}

export function broadcastLog(userId: number, message: string, type: 'log' | 'complete' | 'error' = 'log', stats?: any) {
  const state = scannerState.get(userId);
  if (state) {
    state.listeners.forEach(listener => {
      try {
        listener(message, type, stats);
      } catch (error) {
        console.error('Error in log listener:', error);
      }
    });
  }
}

// Broadcast state changes to all connected clients for a user
export function broadcastState(userId: number) {
  const state = scannerState.get(userId);
  if (state) {
    const stateData = {
      isScanning: state.isScanning,
      isStopping: state.isStopping,
      stats: state.lastStats
    };
    
    state.listeners.forEach(listener => {
      try {
        // Pass empty string as message, state data in stats parameter
        listener('', 'state', stateData);
      } catch (error) {
        console.error('Error broadcasting state:', error);
      }
    });
  }
}

export function stopScan(userId: number) {
  const state = scannerState.get(userId);
  if (state && state.process) {
    console.log(`🛑 Stopping scan for user ${userId} (graceful shutdown)...`);
    state.process.kill('SIGTERM'); // Send graceful shutdown signal
    state.isStopping = true; // Mark as stopping (prevents new scans)
    // Note: isScanning stays true until process actually exits
    // This prevents race condition where new scan starts during shutdown
    broadcastLog(userId, 'Stopping scan (graceful shutdown)...', 'log');
    broadcastState(userId); // Broadcast state change to clients
  }
}

// Metadata refresh state - per user
export const metadataRefreshState = new Map<number, {
  isRefreshing: boolean;
  process: ChildProcess | null;
  startTime: number;
}>();
