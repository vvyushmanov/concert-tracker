'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CountriesTab from './CountriesTab';
import AuditLogTab from './AuditLogTab';
import PrivacyTab from './PrivacyTab';
import AdminSettingsTab from './AdminSettingsTab';

interface Setting {
  key: string;
  value: string;
  valueType: string;
}

type StatusMessage = { type: 'success' | 'error'; text: string } | null;

export default function SettingsClient({ isAdmin, userId }: { isAdmin: boolean; userId: string }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(null);
  const [activeTab, setActiveTab] = useState<'user' | 'global' | 'countries' | 'privacy' | 'audit'>('user');

  useEffect(() => {
    fetchSettings();
  }, [activeTab]);

  const fetchSettings = async () => {
    // Skip fetching for tabs that handle their own data fetching
    if (activeTab === 'countries' || activeTab === 'privacy' || activeTab === 'audit' || activeTab === 'global') {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const endpoint = '/api/settings/user';
      const response = await fetch(endpoint);
      
      if (response.status === 403) {
        setMessage({ type: 'error', text: 'Access denied' });
        setLoading(false);
        return;
      }
      
      if (!response.ok) throw new Error('Failed to fetch settings');
      const data = await response.json();
      setSettings(data);
    } catch (error) {
      console.error('Error fetching settings:', error);
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (key: string, newValue: string) => {
    setSettings((prev) =>
      prev.map((setting) =>
        setting.key === key ? { ...setting, value: newValue } : setting
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const endpoint = activeTab === 'global' ? '/api/settings/global' : '/api/settings/user';
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      if (!response.ok) throw new Error('Failed to save settings');

      setMessage({ type: 'success', text: 'Settings saved successfully.' });
      router.refresh();
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const renderInput = (setting: Setting) => {
    const commonClasses = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900';

    switch (setting.valueType) {
      case 'int':
        return (
          <input
            type="number"
            value={setting.value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            className={commonClasses}
          />
        );

      case 'bool':
        return (
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={setting.value === 'true'}
              onChange={(e) => handleChange(setting.key, e.target.checked ? 'true' : 'false')}
              className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              {setting.value === 'true' ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        );

      default:
        return (
          <input
            type="text"
            value={setting.value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            className={commonClasses}
            placeholder={setting.key === 'LASTFM_USER' ? 'Your Last.fm username' : 
                        setting.key === 'LASTFM_API_KEY' ? 'Your Last.fm API key' : ''}
          />
        );
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-gray-600">
          {activeTab === 'global' 
            ? 'Configure system-wide settings (admin only)' 
            : activeTab === 'countries'
            ? 'Manage countries for your concert scanner'
            : activeTab === 'privacy'
            ? 'Control who can see your concerts on the map'
            : activeTab === 'audit'
            ? 'View all changes to global settings'
            : 'Configure your personal settings'}
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('user')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'user'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            My Settings
          </button>
          <button
            onClick={() => setActiveTab('countries')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'countries'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Countries
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'privacy'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Privacy
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => setActiveTab('global')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'global'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Admin Settings
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'audit'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Audit Log
              </button>
            </>
          )}
        </nav>
      </div>

      {/* Admin Quick Actions */}
      {isAdmin && (
        <div className="mb-6 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-purple-900 dark:text-purple-100">Admin Tools</h3>
              <p className="text-sm text-purple-700 dark:text-purple-300">Manage users and system settings</p>
            </div>
            <button
              onClick={() => router.push('/admin/users')}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              👥 User Management
            </button>
          </div>
        </div>
      )}

      {/* Render Tab Content */}
      {activeTab === 'countries' ? (
        <CountriesTab isAdmin={isAdmin} />
      ) : activeTab === 'privacy' ? (
        <PrivacyTab />
      ) : activeTab === 'audit' ? (
        <AuditLogTab />
      ) : activeTab === 'global' ? (
        <AdminSettingsTab />
      ) : (
        <>
          {message && (
            <div
              className={`mb-6 p-4 rounded-md ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
            {settings.length === 0 ? (
              <div className="text-center text-gray-600 py-4">No settings found</div>
            ) : (
              settings.map((setting) => (
                <div key={setting.key} className="border-b border-gray-200 pb-6 last:border-b-0 last:pb-0">
                  <label className="block mb-2">
                    <span className="text-sm font-semibold text-gray-700">
                      {setting.key.replace(/_/g, ' ')}
                    </span>
                    <span className="block text-xs text-gray-500 mt-1">
                      {activeTab === 'user' && setting.key === 'MIN_PLAYCOUNT' && 'Minimum playcount to include artists'}
                      {activeTab === 'user' && setting.key === 'LASTFM_USER' && 'Your Last.fm username for tracking'}
                      {activeTab === 'user' && setting.key === 'LASTFM_API_KEY' && 'Your personal Last.fm API key'}
                      {activeTab === 'global' && setting.key === 'FANART_API_KEY' && 'API key for fetching artist images'}
                      {activeTab === 'global' && setting.key === 'WEBSHARE_PROXY_URL' && 'Proxy URL for web requests'}
                    </span>
                  </label>
                  {renderInput(setting)}
                </div>
              ))
            )}
          </div>

          <div className="mt-6 flex justify-end space-x-4">
            <button
              onClick={() => router.push('/')}
              className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
