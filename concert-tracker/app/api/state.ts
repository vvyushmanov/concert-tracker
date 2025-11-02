import { ChildProcess } from 'child_process';

type LogListener = (message: string, type: 'log' | 'complete' | 'error', stats?: any) => void;

export const scannerState = {
  isScanning: false,
  process: null as ChildProcess | null,
  listeners: [] as LogListener[],
};

export function addLogListener(listener: LogListener) {
  scannerState.listeners.push(listener);
}

export function removeLogListener(listener: LogListener) {
  const index = scannerState.listeners.indexOf(listener);
  if (index > -1) {
    scannerState.listeners.splice(index, 1);
  }
}

export function broadcastLog(message: string, type: 'log' | 'complete' | 'error' = 'log', stats?: any) {
  scannerState.listeners.forEach(listener => {
    try {
      listener(message, type, stats);
    } catch (error) {
      console.error('Error in log listener:', error);
    }
  });
}

export function stopScan() {
  if (scannerState.process) {
    scannerState.process.kill('SIGTERM');
    scannerState.process = null;
  }
  scannerState.isScanning = false;
  broadcastLog('Scan stopped by user', 'error');
}

// Metadata refresh state
export const metadataState = {
  isRefreshing: false,
  process: null as ChildProcess | null,
};
