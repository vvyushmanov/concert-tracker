'use client';

import { useState, useEffect } from 'react';

type StatusMessage = { type: 'success' | 'error'; text: string } | null;

export default function PrivacyTab() {
  const [globalPrivacy, setGlobalPrivacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(null);

  useEffect(() => {
    fetchPrivacySetting();
  }, []);

  const fetchPrivacySetting = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/user');
      if (!response.ok) throw new Error('Failed to fetch settings');
      
      const settings = await response.json();
      const privacySetting = settings.find((s: any) => s.key === 'MAP_PRIVACY_GLOBAL');
      
      if (privacySetting) {
        setGlobalPrivacy(privacySetting.value === 'true');
      }
    } catch (error) {
      console.error('Error fetching privacy setting:', error);
      setMessage({ type: 'error', text: 'Failed to load privacy settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            key: 'MAP_PRIVACY_GLOBAL',
            value: globalPrivacy ? 'true' : 'false',
            valueType: 'bool'
          }
        ])
      });

      if (!response.ok) throw new Error('Failed to save privacy settings');

      setMessage({ type: 'success', text: 'Privacy settings saved successfully.' });
    } catch (error) {
      console.error('Error saving privacy settings:', error);
      setMessage({ type: 'error', text: 'Failed to save privacy settings' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-600">Loading privacy settings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`p-4 rounded-md ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Map Privacy Settings</h3>
          <p className="text-sm text-gray-600 mb-4">
            Control who can see your concerts on the interactive map feature.
          </p>
        </div>

        <div className="border-t border-gray-200 pt-6">
          <div className="flex items-start space-x-4">
            <div className="flex-shrink-0 pt-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={globalPrivacy}
                  onChange={(e) => setGlobalPrivacy(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-medium text-gray-900 mb-1">
                Hide all my concerts from friends on map
              </h4>
              <p className="text-sm text-gray-600">
                When enabled, none of your concerts will be visible to your friends on the concert map.
                You can still see your friends' concerts if they haven't hidden theirs.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <h5 className="text-sm font-medium text-blue-900 mb-1">Additional Privacy Options</h5>
              <p className="text-sm text-blue-800">
                You can also hide individual concerts from the map by visiting the concert detail page
                and toggling the privacy setting for that specific concert.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end space-x-4">
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save Privacy Settings'}
        </button>
      </div>
    </div>
  );
}
