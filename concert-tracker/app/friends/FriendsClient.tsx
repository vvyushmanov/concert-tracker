'use client';

import { useState, useEffect } from 'react';

interface Friend {
  id: number;
  username: string;
  stats: {
    totalConcerts: number;
    totalArtists: number;
    upcomingConcerts: number;
  };
}

interface FriendRequest {
  id: number;
  from?: { id: number; username: string };
  to?: { id: number; username: string };
  createdAt: number;
}

type Tab = 'friends' | 'incoming' | 'outgoing';

export default function FriendsClient() {
  const [activeTab, setActiveTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [addFriendUsername, setAddFriendUsername] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [unfriendConfirm, setUnfriendConfirm] = useState<number | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        fetch('/api/friends'),
        fetch('/api/friends/requests')
      ]);

      if (friendsRes.ok) {
        const data = await friendsRes.json();
        setFriends(data.friends);
      }

      if (requestsRes.ok) {
        const data = await requestsRes.json();
        setIncomingRequests(data.incoming);
        setOutgoingRequests(data.outgoing);
      }
    } catch (error) {
      console.error('Failed to fetch friends data:', error);
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addFriendUsername.trim()) return;

    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: addFriendUsername })
      });

      const data = await res.json();

      if (res.ok) {
        showMessage('success', data.autoAccepted ? 'Friend request auto-accepted!' : 'Friend request sent!');
        setAddFriendUsername('');
        fetchData();
      } else {
        showMessage('error', data.error || 'Failed to send friend request');
      }
    } catch (error) {
      showMessage('error', 'Failed to send friend request');
    }
  };

  const handleAcceptRequest = async (requestId: number) => {
    try {
      const res = await fetch(`/api/friends/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' })
      });

      if (res.ok) {
        showMessage('success', 'Friend request accepted!');
        fetchData();
      } else {
        showMessage('error', 'Failed to accept request');
      }
    } catch (error) {
      showMessage('error', 'Failed to accept request');
    }
  };

  const handleDeclineRequest = async (requestId: number) => {
    try {
      const res = await fetch(`/api/friends/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline' })
      });

      if (res.ok) {
        showMessage('success', 'Friend request declined');
        fetchData();
      } else {
        showMessage('error', 'Failed to decline request');
      }
    } catch (error) {
      showMessage('error', 'Failed to decline request');
    }
  };

  const handleCancelRequest = async (requestId: number) => {
    try {
      const res = await fetch(`/api/friends/${requestId}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        showMessage('success', 'Friend request cancelled');
        fetchData();
      } else {
        showMessage('error', 'Failed to cancel request');
      }
    } catch (error) {
      showMessage('error', 'Failed to cancel request');
    }
  };

  const handleUnfriend = async (friendshipId: number) => {
    try {
      const res = await fetch(`/api/friends/${friendshipId}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        showMessage('success', 'Friend removed');
        setUnfriendConfirm(null);
        fetchData();
      } else {
        showMessage('error', 'Failed to remove friend');
      }
    } catch (error) {
      showMessage('error', 'Failed to remove friend');
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            👥 Friends
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Connect with friends and share your concert experiences
          </p>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200'
                : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Add Friend Form */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Add Friend
          </h2>
          <form onSubmit={handleAddFriend} className="flex gap-3">
            <input
              type="text"
              value={addFriendUsername}
              onChange={(e) => setAddFriendUsername(e.target.value)}
              placeholder="Enter username"
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              Send Request
            </button>
          </form>
        </div>

        {/* Tabs */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('friends')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'friends'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
                }`}
              >
                Friends ({friends.length})
              </button>
              <button
                onClick={() => setActiveTab('incoming')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'incoming'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
                }`}
              >
                Incoming Requests ({incomingRequests.length})
              </button>
              <button
                onClick={() => setActiveTab('outgoing')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'outgoing'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
                }`}
              >
                Sent Requests ({outgoingRequests.length})
              </button>
            </nav>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                Loading...
              </div>
            ) : (
              <>
                {/* Friends List Tab */}
                {activeTab === 'friends' && (
                  <div className="space-y-4">
                    {friends.length === 0 ? (
                      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                        No friends yet. Send a friend request to get started!
                      </div>
                    ) : (
                      friends.map((friend) => (
                        <div
                          key={friend.id}
                          className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg"
                        >
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                              {friend.username}
                            </h3>
                            <div className="flex gap-6 mt-2 text-sm text-gray-600 dark:text-gray-400">
                              <span>🎸 {friend.stats.totalConcerts} concerts</span>
                              <span>🎤 {friend.stats.totalArtists} artists</span>
                              <span>📅 {friend.stats.upcomingConcerts} upcoming</span>
                            </div>
                          </div>
                          {unfriendConfirm === friend.id ? (
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleUnfriend(friend.id)}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setUnfriendConfirm(null)}
                                className="px-4 py-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-900 dark:text-white text-sm font-medium rounded-lg transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setUnfriendConfirm(friend.id)}
                              className="px-4 py-2 bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 text-red-700 dark:text-red-200 text-sm font-medium rounded-lg transition-colors"
                            >
                              Unfriend
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Incoming Requests Tab */}
                {activeTab === 'incoming' && (
                  <div className="space-y-4">
                    {incomingRequests.length === 0 ? (
                      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                        No incoming friend requests
                      </div>
                    ) : (
                      incomingRequests.map((request) => (
                        <div
                          key={request.id}
                          className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg"
                        >
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                              {request.from?.username}
                            </h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                              Sent {formatDate(request.createdAt)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAcceptRequest(request.id)}
                              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => handleDeclineRequest(request.id)}
                              className="px-4 py-2 bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 text-red-700 dark:text-red-200 text-sm font-medium rounded-lg transition-colors"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Outgoing Requests Tab */}
                {activeTab === 'outgoing' && (
                  <div className="space-y-4">
                    {outgoingRequests.length === 0 ? (
                      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                        No sent friend requests
                      </div>
                    ) : (
                      outgoingRequests.map((request) => (
                        <div
                          key={request.id}
                          className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg"
                        >
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                              {request.to?.username}
                            </h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                              Sent {formatDate(request.createdAt)}
                            </p>
                          </div>
                          <button
                            onClick={() => handleCancelRequest(request.id)}
                            className="px-4 py-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-900 dark:text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
