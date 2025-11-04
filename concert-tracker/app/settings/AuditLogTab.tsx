'use client';

import { useState, useEffect } from 'react';

interface AuditLogEntry {
  id: number;
  userId: number;
  key: string;
  oldValue: string | null;
  newValue: string;
  createdAt: number;
  user: {
    username: string;
  };
}

export default function AuditLogTab() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterKey, setFilterKey] = useState('');
  const [limit, setLimit] = useState(50);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    fetchLogs();
  }, [filterKey, limit]);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterKey) params.append('key', filterKey);
      params.append('limit', limit.toString());

      const response = await fetch(`/api/settings/audit?${params}`);
      
      if (response.status === 403) {
        setError('Access denied. Audit log is only available to administrators.');
        setLogs([]);
        return;
      }
      
      if (!response.ok) {
        throw new Error('Failed to fetch audit logs');
      }
      
      const data = await response.json();
      
      // Handle both array response and object with logs array
      if (Array.isArray(data)) {
        setLogs(data);
      } else if (data && Array.isArray(data.logs)) {
        setLogs(data.logs);
      } else {
        console.error('Invalid response format:', data);
        setError('Invalid response format from server');
        setLogs([]);
      }
    } catch (err: any) {
      console.error('Error fetching audit logs:', err);
      setError(err.message || 'Failed to load audit logs');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatValue = (value: string | null) => {
    if (value === null) return <span className="text-gray-400 italic">empty</span>;
    if (value === '') return <span className="text-gray-400 italic">empty</span>;
    return value;
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-600">Loading audit logs...</div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-6 p-4 rounded-md bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Audit Log</h2>
          <p className="text-sm text-gray-600">
            Track all changes to global settings. Shows who changed what and when.
          </p>
        </div>

        {/* Filters */}
        <div className="mb-6 flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter by Setting Key
            </label>
            <input
              type="text"
              value={filterKey}
              onChange={(e) => setFilterKey(e.target.value)}
              placeholder="e.g., FANART_API_KEY"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
          </div>
          <div className="w-48">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Show Last
            </label>
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            >
              <option value="25">25 entries</option>
              <option value="50">50 entries</option>
              <option value="100">100 entries</option>
              <option value="200">200 entries</option>
            </select>
          </div>
        </div>

        {/* Audit Log Table */}
        {logs.length === 0 ? (
          <div className="text-center text-gray-600 py-8">
            {filterKey ? 'No audit logs match your filter' : 'No audit logs found'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date & Time
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Setting Key
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Old Value
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    New Value
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {logs.map((log) => (
                  <tr 
                    key={log.id} 
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {log.user.username}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {log.key}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                      {formatValue(log.oldValue)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate">
                      {formatValue(log.newValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-sm text-gray-500">
          Showing {logs.length} {logs.length === 1 ? 'entry' : 'entries'}
        </div>
      </div>

      {/* Modal for full log details */}
      {selectedLog && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedLog(null)}
        >
          <div 
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  Audit Log Details
                </h3>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Date & Time
                  </label>
                  <div className="text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700 p-3 rounded">
                    {formatDate(selectedLog.createdAt)}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    User
                  </label>
                  <div className="text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700 p-3 rounded">
                    {selectedLog.user.username} (ID: {selectedLog.userId})
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Setting Key
                  </label>
                  <div className="text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700 p-3 rounded font-mono">
                    {selectedLog.key}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Old Value
                  </label>
                  <div className="text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700 p-3 rounded whitespace-pre-wrap break-words font-mono text-sm">
                    {selectedLog.oldValue || <span className="text-gray-400 italic">empty</span>}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    New Value
                  </label>
                  <div className="text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700 p-3 rounded whitespace-pre-wrap break-words font-mono text-sm">
                    {selectedLog.newValue}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Entry ID
                  </label>
                  <div className="text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700 p-3 rounded font-mono text-sm">
                    #{selectedLog.id}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setSelectedLog(null)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
