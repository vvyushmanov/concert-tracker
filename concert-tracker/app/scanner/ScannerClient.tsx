'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface ScannerStatus {
  isScanning: boolean;
  isStopping: boolean;
  stats: { before: number; after: number; new: number } | null;
}

export default function ScannerClient() {
  // Server state received via SSE
  const [serverStatus, setServerStatus] = useState<ScannerStatus>({ isScanning: false, isStopping: false, stats: null });
  const [debugMode, setDebugMode] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showStats, setShowStats] = useState(false); // Only show stats after scan completes in current session
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();

  const scrollToBottom = () => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (logs.length > 0) {
      scrollToBottom();
    }
  }, [logs]);

  // Connect to SSE on mount for real-time state and log updates
  useEffect(() => {
    connectToSSE();
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []);

  const connectToSSE = () => {
    if (eventSourceRef.current) return;

    const eventSource = new EventSource('/api/scanner/logs');
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'log') {
        setLogs((prev) => [...prev, data.message]);
      } else if (data.type === 'state') {
        // Real-time state update from server
        setServerStatus((prevStatus) => {
          const wasScanning = prevStatus.isScanning;
          const nowScanning = data.isScanning;
          
          // Handle state transitions
          if (!nowScanning && wasScanning && data.stats) {
            setShowStats(true); // Show stats when scan completes
            showToast(`Scan complete! Found ${data.stats.new} new concerts.`, 'success');
          }
          
          return {
            isScanning: data.isScanning,
            isStopping: data.isStopping,
            stats: data.stats
          };
        });
      } else if (data.type === 'complete') {
        // Scan completed successfully
        if (data.stats) {
          setShowStats(true);
          showToast(`Scan complete! Found ${data.stats.new} new concerts.`, 'success');
        }
      } else if (data.type === 'error') {
        // Scan failed
        showToast(`Scan failed: ${data.message}`, 'error');
      }
    };

    eventSource.onerror = () => {
      console.log('SSE connection lost - attempting reconnect...');
      eventSource.close();
      eventSourceRef.current = null;
      
      // Attempt to reconnect after 2 seconds
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('Reconnecting to SSE...');
        connectToSSE();
      }, 2000);
    };
  };

  const startScan = async () => {
    try {
      setLogs([]);
      // Clear old stats when starting new scan
      setServerStatus(prev => ({ ...prev, stats: null }));
      setShowStats(false); // Hide stats panel until new scan completes

      const currentDebugMode = debugMode;
      setDebugMode(false);

      const res = await fetch('/api/scanner/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debug: currentDebugMode })
      });
      const data = await res.json();
      
      if (data.success) {
        showToast(data.message || 'Scan started!', 'success');
        // Status polling will detect the scan and connect to logs
      } else {
        showToast(data.error || 'Failed to start scan', 'error');
      }
    } catch (error) {
      showToast('Failed to start scan', 'error');
    }
  };

  const stopScan = async () => {
    try {
      const res = await fetch('/api/scanner/stop', { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        showToast('Scan stopped', 'success');
        // Status polling will detect the stop and update UI
      } else {
        showToast(data.error || 'Failed to stop scan', 'error');
      }
    } catch (error) {
      showToast('Failed to stop scan', 'error');
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  return (
    <div className="bg-black text-green-400 font-mono p-8" style={{ minHeight: 'calc(100vh - 3rem)' }}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2 text-green-300">
              {'>'} CONCERT SCANNER_
            </h1>
            <p className="text-green-600">Global concert population (admin maintenance)</p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-green-900/30 border border-green-700 hover:bg-green-900/50 transition-colors"
          >
            {'<'} BACK
          </button>
        </div>

        {/* Info */}
        <div className="mb-6 bg-green-950/20 border border-green-800 p-4 text-sm">
          <div className="text-green-600 mb-1">GLOBAL POPULATION</div>
          <p className="text-green-400">
            This scan fetches <span className="text-green-300">all</span> concerts for every active
            country and stores them globally — it does not filter by any user&apos;s artists. Users
            then see only what&apos;s relevant to them (their followed artists × active countries) at
            read time. No per-user data is written here.
          </p>
        </div>

        {/* Stats */}
        {showStats && serverStatus.stats && (
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="bg-green-950/30 border border-green-800 p-4">
              <div className="text-green-600 text-sm">BEFORE</div>
              <div className="text-2xl text-green-300">{serverStatus.stats.before}</div>
            </div>
            <div className="bg-green-950/30 border border-green-800 p-4">
              <div className="text-green-600 text-sm">AFTER</div>
              <div className="text-2xl text-green-300">{serverStatus.stats.after}</div>
            </div>
            <div className="bg-green-950/30 border border-green-800 p-4">
              <div className="text-green-600 text-sm">NEW</div>
              <div className="text-2xl text-green-300">+{serverStatus.stats.new}</div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="mb-6 flex gap-4 items-center">
          <button
            onClick={startScan}
            disabled={serverStatus.isScanning || serverStatus.isStopping}
            className={`px-6 py-3 border ${
              serverStatus.isScanning || serverStatus.isStopping
                ? 'bg-gray-900 border-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-green-950/30 border-green-700 hover:bg-green-900/50 text-green-300'
            } transition-colors`}
          >
            {serverStatus.isStopping ? '> STOPPING...' : serverStatus.isScanning ? '> SCANNING...' : '> START SCAN'}
          </button>
          {serverStatus.isScanning && !serverStatus.isStopping && (
            <button
              onClick={stopScan}
              className="px-6 py-3 bg-red-950/30 border border-red-700 hover:bg-red-900/50 text-red-300 transition-colors"
            >
              ■ STOP
            </button>
          )}
          {serverStatus.isStopping && (
            <div className="px-6 py-3 text-yellow-500 text-sm">
              ⏳ Graceful shutdown in progress...
            </div>
          )}
          {!serverStatus.isScanning && (
            <label className="flex items-center gap-2 text-green-400 cursor-pointer">
              <input
                type="checkbox"
                checked={debugMode}
                onChange={(e) => setDebugMode(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Debug Mode (verbose logging)</span>
            </label>
          )}
          {!serverStatus.isScanning && !serverStatus.isStopping && (
            <div className="ml-auto text-green-700 text-sm">
              ℹ️ You can only run 1 scan at a time
            </div>
          )}
        </div>

        {/* Terminal/Logs */}
        <div ref={logsContainerRef} className="bg-black border-2 border-green-700 p-4 h-[400px] overflow-y-auto shadow-[0_0_20px_rgba(34,197,94,0.3)]">
          <div className="mb-2 text-green-600">
            === SYSTEM LOG ===
          </div>
          {logs.length === 0 && !serverStatus.isScanning && (
            <div className="text-green-700 animate-pulse">
              {'>'} Awaiting instructions...
            </div>
          )}
          {logs.map((log, index) => (
            <div key={index} className="mb-1 text-green-400 whitespace-pre-wrap break-words">
              <span className="text-green-600">{'>'}</span> {log}
            </div>
          ))}
          {serverStatus.isScanning && (
            <div className="text-green-500 animate-pulse">
              <span className="text-green-600">{'>'}</span> Processing...
            </div>
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-8 right-8 px-6 py-4 border-2 shadow-lg animate-slide-up ${
            toast.type === 'success'
              ? 'bg-green-950 border-green-500 text-green-300'
              : 'bg-red-950 border-red-500 text-red-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{toast.type === 'success' ? '✓' : '✗'}</span>
            <span className="font-mono">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
