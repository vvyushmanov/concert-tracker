'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Setting {
  id: number;
  key: string;
  value: string;
  valueType: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch settings on mount
  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings');
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
    setSettings(prev =>
      prev.map(setting =>
        setting.key === key ? { ...setting, value: newValue } : setting
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      // Update each setting individually
      for (const setting of settings) {
        await fetch(`/api/settings/${setting.key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            value: setting.value,
            valueType: setting.valueType
          })
        });
      }

      setMessage({ type: 'success', text: '✅ Settings saved successfully!' });
      
      // Revalidate the page data
      router.refresh();
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage({ type: 'error', text: '❌ Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const renderInput = (setting: Setting) => {
    const commonClasses = "w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900";

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
      
      case 'json':
        if (setting.key === 'COUNTRY_CODES') {
          return <CountryCodeEditor setting={setting} onChange={handleChange} />;
        }
        return (
          <textarea
            value={setting.value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            rows={3}
            className={commonClasses + " font-mono text-sm"}
          />
        );
      
      default:
        return (
          <input
            type="text"
            value={setting.value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            className={commonClasses}
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
          Configure your concert tracker settings. Changes will be applied to the scanner on next run.
        </p>
      </div>

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
        {settings.map((setting) => (
          <div key={setting.key} className="border-b border-gray-200 pb-6 last:border-b-0 last:pb-0">
            <label className="block mb-2">
              <span className="text-sm font-semibold text-gray-700">
                {setting.key.replace(/_/g, ' ')}
              </span>
              {setting.description && (
                <span className="block text-xs text-gray-500 mt-1">
                  {setting.description}
                </span>
              )}
            </label>
            {renderInput(setting)}
          </div>
        ))}
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
    </div>
  );
}

/**
 * Country Code Editor Component
 * Tag-style editor for adding/removing country codes
 */
function CountryCodeEditor({
  setting,
  onChange
}: {
  setting: Setting;
  onChange: (key: string, value: string) => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const codes = JSON.parse(setting.value) as string[];

  const addCode = (code: string) => {
    const trimmedCode = code.trim().toLowerCase();
    if (trimmedCode && !codes.includes(trimmedCode)) {
      const newCodes = [...codes, trimmedCode];
      onChange(setting.key, JSON.stringify(newCodes));
      setInputValue('');
    }
  };

  const removeCode = (index: number) => {
    const newCodes = codes.filter((_, i) => i !== index);
    onChange(setting.key, JSON.stringify(newCodes));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCode(inputValue);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {codes.map((code, index) => (
          <span
            key={index}
            className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
          >
            {code.toUpperCase()}
            <button
              onClick={() => removeCode(index)}
              className="ml-2 text-blue-600 hover:text-blue-800 focus:outline-none"
              type="button"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add country code (e.g., 'us') and press Enter"
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
      />
      <p className="text-xs text-gray-500">
        Press Enter to add a country code. Click × to remove.
      </p>
    </div>
  );
}
