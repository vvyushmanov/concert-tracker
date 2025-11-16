'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Setting {
  key: string;
  value: string;
  valueType: string;
}

interface Country {
  id: number;
  name: string;
  code: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

type StatusMessage = { type: 'success' | 'error'; text: string } | null;

export default function AdminSettingsTab() {
  const router = useRouter();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(null);
  const [updatingCountryId, setUpdatingCountryId] = useState<number | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch global settings
      const settingsResponse = await fetch('/api/settings/global');
      if (settingsResponse.status === 403) {
        setMessage({ type: 'error', text: 'Access denied' });
        setLoading(false);
        return;
      }
      if (!settingsResponse.ok) throw new Error('Failed to fetch settings');
      const settingsData = await settingsResponse.json();
      setSettings(settingsData);

      // Fetch countries
      const countriesResponse = await fetch('/api/settings/countries');
      if (!countriesResponse.ok) throw new Error('Failed to fetch countries');
      const countriesData = await countriesResponse.json();
      setCountries(countriesData);
    } catch (error) {
      console.error('Error fetching data:', error);
      setMessage({ type: 'error', text: 'Failed to load admin settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSettingChange = (key: string, newValue: string) => {
    setSettings((prev) =>
      prev.map((setting) =>
        setting.key === key ? { ...setting, value: newValue } : setting
      )
    );
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/global', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      if (!response.ok) throw new Error('Failed to save settings');

      setMessage({ type: 'success', text: 'Global settings saved successfully.' });
      router.refresh();
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCountryActive = async (countryId: number, active: boolean) => {
    setUpdatingCountryId(countryId);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/countries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ id: countryId, active }] })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to update country');
      }

      setCountries(prev =>
        prev.map(c => c.id === countryId ? { ...c, active } : c)
      );
      setMessage({ type: 'success', text: active ? 'Country activated globally' : 'Country deactivated globally' });
    } catch (error: any) {
      console.error('Error updating country:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to update country' });
    } finally {
      setUpdatingCountryId(null);
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
            onChange={(e) => handleSettingChange(setting.key, e.target.value)}
            className={commonClasses}
          />
        );

      case 'bool':
        return (
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={setting.value === 'true'}
              onChange={(e) => handleSettingChange(setting.key, e.target.checked ? 'true' : 'false')}
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
            onChange={(e) => handleSettingChange(setting.key, e.target.value)}
            className={commonClasses}
          />
        );
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-600">Loading admin settings...</div>
      </div>
    );
  }

  // Sort countries: active first, then alphabetically
  const sortedCountries = [...countries].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
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

      {/* Global Settings Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Global Settings</h2>
        <p className="text-sm text-gray-600 mb-6">
          Configure system-wide settings that apply to all users
        </p>

        <div className="space-y-6">
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
                    {setting.key === 'FANART_API_KEY' && 'API key for fetching artist images'}
                    {setting.key === 'WEBSHARE_PROXY_URL' && 'Proxy URL for web requests'}
                    {setting.key === 'LASTFM_API_KEY' && 'Global fallback Last.fm API key'}
                    {setting.key === 'MIN_PLAYCOUNT' && 'Default minimum playcount threshold'}
                    {setting.key === 'COUNTRY_CODES' && 'Fallback country codes (JSON array) - used when no active countries'}
                  </span>
                </label>
                {renderInput(setting)}
              </div>
            ))
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : 'Save Global Settings'}
          </button>
        </div>
      </div>

      {/* Global Country Management Section */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Global Country Management</h2>
        <p className="text-sm text-gray-600 mb-6">
          Control which countries are available globally for concert scanning.
          Inactive countries can still be activated by individual users, but won't be scanned in global mode.
        </p>

        <div className="space-y-2">
          {sortedCountries.length === 0 ? (
            <div className="text-center text-gray-600 py-8">No countries found</div>
          ) : (
            sortedCountries.map((country) => (
              <div
                key={country.id}
                className={`flex items-center justify-between p-3 rounded-md border ${
                  country.active
                    ? 'bg-green-50 border-green-200'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{country.name}</div>
                    <div className="text-xs text-gray-500 uppercase">{country.code}</div>
                  </div>
                  {country.active && (
                    <span className="px-2 py-1 text-xs font-medium bg-green-600 text-white rounded">
                      Active Globally
                    </span>
                  )}
                </div>

                <button
                  onClick={() => handleToggleCountryActive(country.id, !country.active)}
                  disabled={updatingCountryId === country.id}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    country.active
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {updatingCountryId === country.id
                    ? 'Updating...'
                    : country.active
                    ? 'Deactivate'
                    : 'Activate'}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 text-sm text-gray-500">
          Showing {sortedCountries.length} countries total
        </div>

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Note:</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Globally active countries are used when running scanners in global mode (no user ID)</li>
            <li>Individual users can still activate/deactivate countries for their personal scans</li>
            <li>Use the Countries tab to add new countries to the system</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
