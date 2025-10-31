'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function ScannerPage() {
  const [isScanning, setIsScanning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState<{ before: number; after: number; new: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const router = useRouter();

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (logs.length > 0) {
      scrollToBottom();
    }
  }, [logs]);

  useEffect(() => {
    // Check if there's an active scan on mount
    checkScanStatus();
  }, []);

  const checkScanStatus = async () => {
    try {
      const res = await fetch('/api/scanner/status');
      const data = await res.json();
      if (data.isScanning) {
        setIsScanning(true);
        connectToLogs();
      }
    } catch (error) {
      console.error('Failed to check scan status:', error);
    }
  };

  const connectToLogs = () => {
    if (eventSourceRef.current) return;

    const eventSource = new EventSource('/api/scanner/logs');
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'log') {
        setLogs((prev) => [...prev, data.message]);
      } else if (data.type === 'complete') {
        setIsScanning(false);
        setStats(data.stats);
        showToast(`Scan complete! Found ${data.stats.new} new concerts.`, 'success');
        eventSource.close();
        eventSourceRef.current = null;
      } else if (data.type === 'error') {
        setIsScanning(false);
        showToast(`Scan failed: ${data.message}`, 'error');
        eventSource.close();
        eventSourceRef.current = null;
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  };

  const startScan = async () => {
    try {
      setLogs([]);
      setStats(null);
      setIsScanning(true);
      
      const res = await fetch('/api/scanner/start', { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        connectToLogs();
        showToast('Scan started!', 'success');
      } else {
        setIsScanning(false);
        showToast(data.error || 'Failed to start scan', 'error');
      }
    } catch (error) {
      setIsScanning(false);
      showToast('Failed to start scan', 'error');
    }
  };

  const stopScan = async () => {
    try {
      const res = await fetch('/api/scanner/stop', { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        setIsScanning(false);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        showToast('Scan stopped', 'success');
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

        {/* Stats */}
        {stats && (
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="bg-green-950/30 border border-green-800 p-4">
              <div className="text-green-600 text-sm">BEFORE</div>
              <div className="text-2xl text-green-300">{stats.before}</div>
            </div>
            <div className="bg-green-950/30 border border-green-800 p-4">
              <div className="text-green-600 text-sm">AFTER</div>
              <div className="text-2xl text-green-300">{stats.after}</div>
            </div>
            <div className="bg-green-950/30 border border-green-800 p-4">
              <div className="text-green-600 text-sm">NEW</div>
              <div className="text-2xl text-green-300">+{stats.new}</div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="mb-6 flex gap-4">
          <button
            onClick={startScan}
            disabled={isScanning}
            className={`px-6 py-3 border ${
              isScanning
                ? 'bg-gray-900 border-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-green-950/30 border-green-700 hover:bg-green-900/50 text-green-300'
            } transition-colors`}
          >
            {isScanning ? '> SCANNING...' : '> START SCAN'}
          </button>
          {isScanning && (
            <button
              onClick={stopScan}
              className="px-6 py-3 bg-red-950/30 border border-red-700 hover:bg-red-900/50 text-red-300 transition-colors"
            >
              ■ STOP
            </button>
          )}
        </div>

        {/* Terminal/Logs */}
        <div className="bg-black border-2 border-green-700 p-4 h-[600px] overflow-y-auto shadow-[0_0_20px_rgba(34,197,94,0.3)]">
          <div className="mb-2 text-green-600">
            === SYSTEM LOG ===
          </div>
          {logs.length === 0 && !isScanning && (
            <div className="text-green-700 animate-pulse">
              {'>'} Awaiting instructions...
            </div>
          )}
          {logs.map((log, index) => (
            <div key={index} className="mb-1 text-green-400 whitespace-pre-wrap break-words">
              <span className="text-green-600">{'>'}</span> {log}
            </div>
          ))}
          {isScanning && (
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
