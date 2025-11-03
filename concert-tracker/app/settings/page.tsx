'use client';

import { useState, useEffect, ChangeEvent, type ReactNode } from 'react';
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

interface Country {
  id: number;
  name: string;
  code: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

type StatusMessage = { type: 'success' | 'error'; text: string } | null;

function sortCountries(countries: Country[]): Country[] {
  return [...countries].sort((a, b) => {
    if (a.active !== b.active) {
      return a.active ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [newCountryInput, setNewCountryInput] = useState('');
  const [addingCountry, setAddingCountry] = useState(false);
  const [updatingCountryId, setUpdatingCountryId] = useState<number | null>(null);
  const [deletingCountryId, setDeletingCountryId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Country | null>(null);
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
    fetchCountries();
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

  const fetchCountries = async () => {
    try {
      const response = await fetch('/api/settings/countries');
      if (!response.ok) throw new Error('Failed to fetch countries');
      const data: Country[] = await response.json();
      setCountries(sortCountries(data));
    } catch (error) {
      console.error('Error fetching countries:', error);
      setMessage({ type: 'error', text: 'Failed to load active countries' });
    } finally {
      setCountriesLoading(false);
    }
  };

  const handleChange = (key: string, newValue: string) => {
    setSettings((prev: Setting[]) =>
      prev.map((setting: Setting) =>
        setting.key === key ? { ...setting, value: newValue } : setting
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
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

      case 'json':
        if (setting.key === 'COUNTRY_CODES') {
          return (
            <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
              Country codes are now managed via the Active Countries section below. This setting is kept for fallback purposes.
            </div>
          );
        }
        return (
          <textarea
            value={setting.value}
            onChange={(e) => handleChange(setting.key, e.target.value)}
            rows={3}
            className={`${commonClasses} font-mono text-sm`}
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
        {settings.map((setting: Setting) => (
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

      <ActiveCountriesSection
        countries={countries}
        loading={countriesLoading}
        newCountryInput={newCountryInput}
        setNewCountryInput={setNewCountryInput}
        addingCountry={addingCountry}
        updatingCountryId={updatingCountryId}
        deletingCountryId={deletingCountryId}
        onAddCountry={async () => {
          const trimmed = newCountryInput.trim();
          if (!trimmed) {
            setMessage({ type: 'error', text: 'Please enter a country name or code' });
            return;
          }

          setAddingCountry(true);
          setMessage(null);

          try {
            const response = await fetch('/api/settings/countries', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ input: trimmed, active: true })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
              const errorText = result?.error || 'Failed to add country';
              throw new Error(errorText);
            }

            setCountries((prev: Country[]) => {
              const filtered = prev.filter((country: Country) => country.id !== result.country.id);
              return sortCountries([...filtered, result.country]);
            });
            setNewCountryInput('');
            setMessage({ type: 'success', text: result.message || 'Country added successfully' });
          } catch (error: any) {
            console.error('Error adding country:', error);
            setMessage({ type: 'error', text: error.message || 'Failed to add country' });
          } finally {
            setAddingCountry(false);
          }
        }}
        onToggleActive={async (countryId, active) => {
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
              const errorText = result?.error || 'Failed to update country';
              throw new Error(errorText);
            }

            setCountries((prev: Country[]) => {
              const updated = prev.map((country: Country) =>
                country.id === countryId ? { ...country, active } : country
              );
              return sortCountries(updated);
            });
            setMessage({ type: 'success', text: 'Country status updated' });
          } catch (error: any) {
            console.error('Error updating country:', error);
            setMessage({ type: 'error', text: error.message || 'Failed to update country' });
          } finally {
            setUpdatingCountryId(null);
          }
        }}
        onRequestDelete={(country) => {
          setDeleteTarget(country);
        }}
      />

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

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Remove country"
        description={deleteTarget ? `Remove ${deleteTarget.name} (${deleteTarget.code.toUpperCase()}) from the active list? This will not delete existing concerts.` : ''}
        confirmLabel={deletingCountryId === deleteTarget?.id ? 'Removing...' : 'Remove'}
        confirmDisabled={deletingCountryId === deleteTarget?.id}
        onCancel={() => {
          if (deletingCountryId) return;
          setDeleteTarget(null);
        }}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const countryId = deleteTarget.id;

          setDeletingCountryId(countryId);
          setMessage(null);

          try {
            const response = await fetch('/api/settings/countries', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: countryId })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
              const errorText = result?.error || 'Failed to delete country';
              throw new Error(errorText);
            }

            setCountries((prev: Country[]) => prev.filter((country) => country.id !== countryId));
            setMessage({ type: 'success', text: result.message || 'Country removed' });
            setDeleteTarget(null);
          } catch (error: any) {
            const errorText = error?.message || 'Failed to delete country';
            setDeleteTarget(null);
            setErrorModalMessage(errorText);
          } finally {
            setDeletingCountryId(null);
          }
        }}
      />

      <AlertModal
        open={Boolean(errorModalMessage)}
        title="Cannot remove country"
        message={errorModalMessage ?? ''}
        onClose={() => setErrorModalMessage(null)}
      />
    </div>
  );
}

function ActiveCountriesSection({
  countries,
  loading,
  newCountryInput,
  setNewCountryInput,
  addingCountry,
  updatingCountryId,
  deletingCountryId,
  onAddCountry,
  onToggleActive,
  onRequestDelete
}: {
  countries: Country[];
  loading: boolean;
  newCountryInput: string;
  setNewCountryInput: (value: string) => void;
  addingCountry: boolean;
  updatingCountryId: number | null;
  deletingCountryId: number | null;
  onAddCountry: () => Promise<void>;
  onToggleActive: (countryId: number, active: boolean) => Promise<void>;
  onRequestDelete: (country: Country) => void;
}) {
  return (
    <div className="mt-10 bg-white rounded-lg shadow-md p-6">
      <div className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Active Countries</h2>
            <p className="text-sm text-gray-600 mt-1">
              Manage which countries are scanned. Add new countries by name or ISO code (e.g., "Germany" or "DE").
            </p>
          </div>
          <div className="flex flex-col md:flex-row md:items-center gap-3 w-full md:w-auto">
            <input
              type="text"
              value={newCountryInput}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewCountryInput(e.target.value)}
              placeholder="Country name or code"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
            <button
              onClick={onAddCountry}
              disabled={addingCountry}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              {addingCountry ? 'Adding...' : 'Add Country'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-600 py-4">Loading countries...</div>
      ) : countries.length === 0 ? (
        <div className="text-center text-gray-600 py-4">No countries found.</div>
      ) : (
        <div className="divide-y divide-gray-200">
          {countries.map((country: Country) => (
            <div key={country.id} className="py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">{country.name}</div>
                <div className="text-xs text-gray-500 uppercase">{country.code}</div>
              </div>
              <div className="flex items-center space-x-4">
                <label className="inline-flex items-center cursor-pointer">
                  <span className="mr-3 text-sm text-gray-600">
                    {country.active ? 'Active' : 'Inactive'}
                  </span>
                  <input
                    type="checkbox"
                    checked={country.active}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => onToggleActive(country.id, e.target.checked)}
                    disabled={updatingCountryId === country.id || deletingCountryId === country.id}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onRequestDelete(country)}
                  disabled={deletingCountryId === country.id}
                  className="text-sm text-red-600 hover:text-red-800 disabled:text-gray-400"
                >
                  {deletingCountryId === country.id ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ModalProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  onClose: () => void;
}

function ModalContainer({ open, title, onClose, children }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 px-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmDisabled = false,
  onCancel,
  onConfirm
}: ConfirmModalProps) {
  return (
    <ModalContainer open={open} title={title} onClose={onCancel}>
      <p className="text-sm text-gray-600 mb-6">{description}</p>
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {confirmLabel}
        </button>
      </div>
    </ModalContainer>
  );
}

interface AlertModalProps {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

function AlertModal({ open, title, message, onClose }: AlertModalProps) {
  return (
    <ModalContainer open={open} title={title} onClose={onClose}>
      <p className="text-sm text-gray-600 mb-6 whitespace-pre-line">{message}</p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Close
        </button>
      </div>
    </ModalContainer>
  );
}
