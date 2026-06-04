'use client';

import { useState, useEffect } from 'react';

interface Country {
  id: number;
  name: string;
  code: string;
  userActive: boolean;
  createdAt: number;
  updatedAt: number;
}

type StatusMessage = { type: 'success' | 'error'; text: string } | null;

export default function CountriesTab({ isAdmin }: { isAdmin: boolean }) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [filteredCountries, setFilteredCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<StatusMessage>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newCountryInput, setNewCountryInput] = useState('');
  const [addingCountry, setAddingCountry] = useState(false);
  const [updatingCountryId, setUpdatingCountryId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Country | null>(null);
  const [deletingCountryId, setDeletingCountryId] = useState<number | null>(null);

  useEffect(() => {
    fetchCountries();
  }, []);

  useEffect(() => {
    // Filter countries based on search query
    if (!searchQuery.trim()) {
      setFilteredCountries(countries);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = countries.filter(country =>
        country.name.toLowerCase().includes(query) ||
        country.code.toLowerCase().includes(query)
      );
      setFilteredCountries(filtered);
    }
  }, [searchQuery, countries]);

  const fetchCountries = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/user-countries');
      if (!response.ok) throw new Error('Failed to fetch countries');
      const data = await response.json();
      setCountries(data);
      setFilteredCountries(data);
    } catch (error) {
      console.error('Error fetching countries:', error);
      setMessage({ type: 'error', text: 'Failed to load countries' });
    } finally {
      setLoading(false);
    }
  };

  const handleAddCountry = async () => {
    const trimmed = newCountryInput.trim();
    if (!trimmed) {
      setMessage({ type: 'error', text: 'Please enter a country name or code' });
      return;
    }

    setAddingCountry(true);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/user-countries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: trimmed })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to add country');
      }

      setCountries(prev => {
        const filtered = prev.filter(c => c.id !== result.country.id);
        return [...filtered, result.country].sort((a, b) => a.name.localeCompare(b.name));
      });
      setNewCountryInput('');
      setMessage({ type: 'success', text: result.message || 'Country added and activated for you' });
    } catch (error: any) {
      console.error('Error adding country:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to add country' });
    } finally {
      setAddingCountry(false);
    }
  };

  const handleToggleUserActive = async (countryId: number, userActive: boolean) => {
    setUpdatingCountryId(countryId);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/user-countries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countryId, userActive })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to update country');
      }

      setCountries(prev =>
        prev.map(c => c.id === countryId ? { ...c, userActive } : c)
      );
      setMessage({ type: 'success', text: userActive ? 'Country activated' : 'Country deactivated' });
    } catch (error: any) {
      console.error('Error updating country:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to update country' });
    } finally {
      setUpdatingCountryId(null);
    }
  };

  const handleDeleteCountry = async () => {
    if (!deleteTarget) return;
    const countryId = deleteTarget.id;

    setDeletingCountryId(countryId);
    setMessage(null);

    try {
      const response = await fetch('/api/settings/user-countries', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: countryId })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to delete country');
      }

      setCountries(prev => prev.filter(c => c.id !== countryId));
      setMessage({ type: 'success', text: result.message || 'Country deleted' });
      setDeleteTarget(null);
    } catch (error: any) {
      console.error('Error deleting country:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to delete country' });
      setDeleteTarget(null);
    } finally {
      setDeletingCountryId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-600">Loading countries...</div>
      </div>
    );
  }

  // Sort: user's active countries first, then alphabetically
  const sortedCountries = [...filteredCountries].sort((a, b) => {
    if (a.userActive !== b.userActive) return a.userActive ? -1 : 1;
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

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Manage Countries</h2>
          <p className="text-sm text-gray-600">
            Add countries you want to track and activate the ones whose concerts you want to see.
            {isAdmin && ' As an admin, you can also delete unused countries.'}
          </p>
        </div>

        {/* Add Country Section */}
        <div className="mb-6 pb-6 border-b border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Add New Country
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={newCountryInput}
              onChange={(e) => setNewCountryInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCountry()}
              placeholder="Country name or ISO code (e.g., Germany or DE)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
            <button
              onClick={handleAddCountry}
              disabled={addingCountry}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {addingCountry ? 'Adding...' : 'Add Country'}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or code..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>

        {/* Countries List */}
        {sortedCountries.length === 0 ? (
          <div className="text-center text-gray-600 py-8">
            {searchQuery ? 'No countries match your search' : 'No countries found'}
          </div>
        ) : (
          <div className="space-y-2">
            {sortedCountries.map((country) => (
              <div
                key={country.id}
                className={`flex items-center justify-between p-3 rounded-md border ${
                  country.userActive
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{country.name}</div>
                    <div className="text-xs text-gray-500 uppercase">{country.code}</div>
                  </div>
                  {country.userActive && (
                    <span className="px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded">
                      Active
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleToggleUserActive(country.id, !country.userActive)}
                    disabled={updatingCountryId === country.id}
                    className={`px-3 py-1 text-sm rounded-md transition-colors ${
                      country.userActive
                        ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {updatingCountryId === country.id
                      ? 'Updating...'
                      : country.userActive
                      ? 'Deactivate'
                      : 'Activate'}
                  </button>

                  {isAdmin && (
                    <button
                      onClick={() => setDeleteTarget(country)}
                      disabled={deletingCountryId === country.id}
                      className="px-3 py-1 text-sm text-red-600 hover:text-red-800 disabled:text-gray-400"
                    >
                      {deletingCountryId === country.id ? 'Deleting...' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 text-sm text-gray-500">
          Showing {sortedCountries.length} of {countries.length} countries
          {searchQuery && ` matching "${searchQuery}"`}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 px-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Delete Country</h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong> ({deleteTarget.code.toUpperCase()})?
              This action cannot be undone and will only work if the country has no associated concerts.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deletingCountryId === deleteTarget.id}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCountry}
                disabled={deletingCountryId === deleteTarget.id}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {deletingCountryId === deleteTarget.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
