'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';

interface User {
  id: number;
  username: string;
  role: 'USER' | 'ADMIN';
  createdAt: number;
  updatedAt: number;
  _count: {
    settings: number;
    concerts: number;
    artists: number;
    activeCountries: number;
  };
}

type StatusMessage = { type: 'success' | 'error'; text: string } | null;

export default function UsersManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<StatusMessage>(null);
  
  // Create user form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'USER' | 'ADMIN'>('USER');
  const [creating, setCreating] = useState(false);

  // Reset password state
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/users');
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error('Error fetching users:', error);
      setMessage({ type: 'error', text: 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      setMessage({ type: 'success', text: `User ${newUsername} created successfully` });
      setNewUsername('');
      setNewPassword('');
      setNewRole('USER');
      setShowCreateForm(false);
      fetchUsers();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (userId: number) => {
    if (!resetPassword || resetPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' });
      return;
    }

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPassword })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reset password');
      }

      setMessage({ type: 'success', text: 'Password reset successfully' });
      setResettingUserId(null);
      setResetPassword('');
      fetchUsers();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleChangeRole = async (userId: number, newRole: 'USER' | 'ADMIN') => {
    if (!confirm(`Change user role to ${newRole}?`)) return;

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to change role');
      }

      setMessage({ type: 'success', text: 'Role updated successfully' });
      fetchUsers();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleDeleteUser = async (userId: number, username: string) => {
    if (!confirm(`Delete user "${username}"? This action cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete user');
      }

      setMessage({ type: 'success', text: `User ${username} deleted` });
      fetchUsers();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading users...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Status Message */}
      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Create User Button */}
      <div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          {showCreateForm ? 'Cancel' : '+ Create New User'}
        </button>
      </div>

      {/* Create User Form */}
      {showCreateForm && (
        <form onSubmit={handleCreateUser} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
          <h3 className="text-lg font-semibold mb-4">Create New User</h3>
          
          <div>
            <label className="block text-sm font-medium mb-2">Username</label>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
              minLength={3}
              maxLength={100}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              placeholder="Enter username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              placeholder="Minimum 6 characters"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'USER' | 'ADMIN')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            >
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create User'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setNewUsername('');
                setNewPassword('');
                setNewRole('USER');
              }}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-600 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Stats
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="font-medium">{user.username}</div>
                  <div className="text-sm text-gray-500">ID: {user.id}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      user.role === 'ADMIN'
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                    }`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div>🎵 {user._count.artists} artists</div>
                  <div>🎪 {user._count.concerts} concerts</div>
                  <div>🌍 {user._count.activeCountries} countries</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {format(new Date(user.createdAt * 1000), 'MMM dd, yyyy')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm space-y-1">
                  {resettingUserId === user.id ? (
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="New password"
                        className="px-2 py-1 border rounded text-sm dark:bg-gray-700"
                      />
                      <button
                        onClick={() => handleResetPassword(user.id)}
                        className="px-2 py-1 bg-green-600 text-white rounded text-xs"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setResettingUserId(null);
                          setResetPassword('');
                        }}
                        className="px-2 py-1 bg-gray-300 dark:bg-gray-600 rounded text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setResettingUserId(user.id)}
                        className="block text-blue-600 hover:text-blue-800 dark:text-blue-400"
                      >
                        Reset Password
                      </button>
                      <button
                        onClick={() =>
                          handleChangeRole(user.id, user.role === 'ADMIN' ? 'USER' : 'ADMIN')
                        }
                        className="block text-purple-600 hover:text-purple-800 dark:text-purple-400"
                      >
                        Change to {user.role === 'ADMIN' ? 'User' : 'Admin'}
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id, user.username)}
                        className="block text-red-600 hover:text-red-800 dark:text-red-400"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {users.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No users found. Create your first user above.
        </div>
      )}
    </div>
  );
}
