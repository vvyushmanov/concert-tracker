'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import NotificationPanel from './NotificationPanel';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [unreadCount, setUnreadCount] = useState(0);
  const [incomingRequestsCount, setIncomingRequestsCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  
  const navItems = [
    { href: '/', label: 'All Concerts', icon: '🎸' },
    { href: '/artists', label: 'By Artist', icon: '🎤' },
    { href: '/countries', label: 'By Country', icon: '🌍' },
    { href: '/calendar', label: 'Calendar', icon: '📅' },
    { href: '/friends', label: 'Friends', icon: '👥' },
  ];

  // Poll for notifications and friend requests every 30 seconds (only when authenticated)
  useEffect(() => {
    // Don't poll if not authenticated
    if (status !== 'authenticated') {
      return;
    }

    const fetchData = async () => {
      try {
        // Fetch notifications
        const notifRes = await fetch('/api/notifications');
        if (notifRes.ok) {
          const notifData = await notifRes.json();
          setUnreadCount(notifData.unreadCount);
        }

        // Fetch friend requests
        const friendsRes = await fetch('/api/friends/requests');
        if (friendsRes.ok) {
          const friendsData = await friendsRes.json();
          setIncomingRequestsCount(friendsData.incoming.length);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      }
    };

    fetchData(); // Initial fetch
    const interval = setInterval(fetchData, 30000); // Poll every 30 seconds

    return () => clearInterval(interval);
  }, [status]);
  
  const handleRescan = () => {
    router.push('/scanner');
  };
  
  const handleLogout = async () => {
    await signOut({ callbackUrl: '/login' });
  };
  
  return (
    <nav className="sticky top-0 z-50 bg-white dark:bg-gray-800 shadow-md border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-2">
              <span className="text-2xl">🎵</span>
              <span className="text-xl font-bold text-gray-900 dark:text-white">
                Concert Tracker
              </span>
            </Link>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex space-x-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const isFriendsPage = item.href === '/friends';
                const showBadge = isFriendsPage && incomingRequestsCount > 0;
                
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`
                      relative flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                      ${isActive 
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' 
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }
                    `}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                    {showBadge && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                        {incomingRequestsCount > 9 ? '9+' : incomingRequestsCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            
            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative flex items-center justify-center w-10 h-10 rounded-lg text-sm font-medium transition-colors bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                title="Notifications"
              >
                <span className="text-xl">🔔</span>
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifications && (
                <NotificationPanel
                  onClose={() => setShowNotifications(false)}
                  onUpdate={() => {
                    // Refresh notification count
                    fetch('/api/notifications')
                      .then(res => res.json())
                      .then(data => setUnreadCount(data.unreadCount))
                      .catch(console.error);
                  }}
                />
              )}
            </div>
            
            <button
              onClick={handleRescan}
              className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-800"
              title="Open concert scanner"
            >
              <span>🔍</span>
              <span className="hidden sm:inline">Scanner</span>
            </button>
            
            <Link
              href="/settings"
              className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
              title="Configure settings"
            >
              <span>⚙️</span>
              <span className="hidden sm:inline">Settings</span>
            </Link>
            
            <button
              onClick={handleLogout}
              className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-800"
              title="Logout"
            >
              <span>🚪</span>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
