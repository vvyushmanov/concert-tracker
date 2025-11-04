import { ChildProcess } from 'child_process';

type LogListener = (message: string, type: 'log' | 'complete' | 'error', stats?: any) => void;

// Scanner state - per user
export const scannerState = new Map<number, {
  isScanning: boolean;
  process: ChildProcess | null;
  listeners: LogListener[];
  startTime: number;
  lastStats?: { before: number; after: number; new: number };
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

export function stopScan(userId: number) {
  const state = scannerState.get(userId);
  if (state && state.process) {
    state.process.kill('SIGTERM');
    state.process = null;
  }
  if (state) {
    state.isScanning = false;
    broadcastLog(userId, 'Scan stopped by user', 'error');
  }
}

// Metadata refresh state - per user
export const metadataRefreshState = new Map<number, {
  isRefreshing: boolean;
  process: ChildProcess | null;
  startTime: number;
}>();
