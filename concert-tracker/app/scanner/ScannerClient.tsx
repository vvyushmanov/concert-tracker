'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface ScannerClientProps {
  isAdmin: boolean;
  userSettings: {
    minPlaycount: number;
    lastfmUser: string | null;
  };
  activeCountries: string[];
}

interface ScannerStatus {
  isScanning: boolean;
  isStopping: boolean;
  stats: { before: number; after: number; new: number } | null;
}

export default function ScannerClient({ isAdmin, userSettings, activeCountries }: ScannerClientProps) {
  // Server state is the single source of truth
  const [serverStatus, setServerStatus] = useState<ScannerStatus>({ isScanning: false, isStopping: false, stats: null });
  const [debugMode, setDebugMode] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showStats, setShowStats] = useState(false); // Only show stats after scan completes in current session
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (logs.length > 0) {
      scrollToBottom();
    }
  }, [logs]);

  // Poll server status every 500ms - server is single source of truth
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/scanner/status');
        const data = await res.json();
        
        setServerStatus((prevStatus) => {
          const wasScanning = prevStatus.isScanning;
          const nowScanning = data.isScanning;
          
          // Handle state transitions
          if (nowScanning && !wasScanning) {
            // Scan just started - connect to logs
            if (!eventSourceRef.current) {
              connectToLogs();
            }
          } else if (!nowScanning && wasScanning) {
            // Scan just finished - close SSE and show completion
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
              eventSourceRef.current = null;
            }
            if (data.stats) {
              setShowStats(true); // Enable stats display for this session
              showToast(`Scan complete! Found ${data.stats.new} new concerts.`, 'success');
            }
          }
          
          return {
            isScanning: nowScanning,
            isStopping: data.isStopping || false,
            stats: data.stats || prevStatus.stats
          };
        });
      } catch (error) {
        console.error('Failed to check scan status:', error);
      }
    };
    
    checkStatus(); // Initial check
    statusIntervalRef.current = setInterval(checkStatus, 500);
    
    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const connectToLogs = () => {
    if (eventSourceRef.current) return;

    const eventSource = new EventSource('/api/scanner/logs');
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'log') {
        setLogs((prev) => [...prev, data.message]);
      }
      // Note: Don't handle 'complete' or 'error' here
      // Status polling will detect completion and handle it
    };

    eventSource.onerror = () => {
      console.log('SSE connection lost - status polling will handle state');
      eventSource.close();
      eventSourceRef.current = null;
      // Status polling continues and will reconnect SSE if scan still running
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
        showToast(currentDebugMode ? 'Scan started in DEBUG mode!' : 'Scan started!', 'success');
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
    <div className="min-h-screen bg-black text-green-400 font-mono p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2 text-green-300">
              {'>'} CONCERT SCANNER_
            </h1>
            <p className="text-green-600">Real-time concert data synchronization</p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-green-900/30 border border-green-700 hover:bg-green-900/50 transition-colors"
          >
            {'<'} BACK
          </button>
        </div>

        {/* User Settings Info */}
        <div className="mb-6 bg-green-950/20 border border-green-800 p-4">
          <div className="text-green-600 text-sm mb-2">SCANNER CONFIGURATION</div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-green-700">Last.fm User:</span>{' '}
              <span className="text-green-300">{userSettings.lastfmUser || 'Not configured'}</span>
            </div>
            <div>
              <span className="text-green-700">Min Playcount:</span>{' '}
              <span className="text-green-300">{userSettings.minPlaycount}</span>
            </div>
            <div className="col-span-2">
              <span className="text-green-700">Active Countries ({activeCountries.length}):</span>{' '}
              <span className="text-green-300">
                {activeCountries.length > 0 ? activeCountries.join(', ') : 'None configured'}
              </span>
            </div>
          </div>
          {(!userSettings.lastfmUser || activeCountries.length === 0) && (
            <div className="mt-3 text-yellow-500 text-sm">
              ⚠️ Configure your Last.fm credentials and activate countries in Settings before scanning
            </div>
          )}
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
          {isAdmin && !serverStatus.isScanning && (
            <label className="flex items-center gap-2 text-green-400 cursor-pointer">
              <input
                type="checkbox"
                checked={debugMode}
                onChange={(e) => setDebugMode(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Debug Mode (Admin)</span>
            </label>
          )}
          {!serverStatus.isScanning && !serverStatus.isStopping && (
            <div className="ml-auto text-green-700 text-sm">
              ℹ️ You can only run 1 scan at a time
            </div>
          )}
        </div>

        {/* Terminal/Logs */}
        <div className="bg-black border-2 border-green-700 p-4 h-[400px] overflow-y-auto shadow-[0_0_20px_rgba(34,197,94,0.3)]">
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

        {/* Info */}
        <div className="mt-4 text-green-700 text-sm">
          <p>• You can navigate away from this page - the scan will continue in the background</p>
          <p>• Return to this page to see progress and stop the scan if needed</p>
          <p>• Scanner uses your personal Last.fm credentials and active countries</p>
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
