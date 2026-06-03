'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

interface SidebarProps {
  isMobileMenuOpen?: boolean;
  onClose?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
}

export default function Sidebar({ isMobileMenuOpen = false, onClose, onExpandedChange }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [incomingRequestsCount, setIncomingRequestsCount] = useState(0);

  // Load saved state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebarExpanded');
    if (saved !== null) {
      setIsExpanded(saved === 'true');
    }
  }, []);

  // Save state to localStorage and notify parent
  const toggleExpanded = () => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    localStorage.setItem('sidebarExpanded', String(newState));
    onExpandedChange?.(newState);
    
    // Dispatch custom event for same-window updates
    window.dispatchEvent(new Event('sidebarExpandedChange'));
  };

  // Poll for friend requests every 30 seconds
  useEffect(() => {
    if (session?.user) {
      const fetchRequests = async () => {
        try {
          const res = await fetch('/api/friends/requests');
          if (res.ok) {
            const data = await res.json();
            setIncomingRequestsCount(data.incoming.length);
          }
        } catch (error) {
          console.error('Failed to fetch friend requests:', error);
        }
      };

      fetchRequests();
      const interval = setInterval(fetchRequests, 30000);
      return () => clearInterval(interval);
    }
  }, [session]);

  const isAdmin = session?.user?.role === 'ADMIN';

  const navItems: NavItem[] = [
    { href: '/', label: 'Concerts', icon: '🎸' },
    { href: '/artists', label: 'Artists', icon: '🎤' },
    { href: '/countries', label: 'Countries', icon: '🌍' },
    { href: '/calendar', label: 'Calendar', icon: '📅' },
    { href: '/map', label: 'Map', icon: '🗺️' },
    { href: '/friends', label: 'Friends', icon: '👥' },
    { href: '/settings', label: 'Settings', icon: '⚙️' },
  ];

  // Admin-only items (scanning now populates the global concert table — a
  // maintenance action, not a per-user one).
  if (isAdmin) {
    navItems.splice(6, 0, { href: '/scanner', label: 'Scanner', icon: '🔍', adminOnly: true });
    navItems.push({
      href: '/admin/users',
      label: 'User Management',
      icon: '👤',
      adminOnly: true,
    });
  }

  const showExpanded = isExpanded || isHovering;
  const sidebarWidth = showExpanded ? 'w-64' : 'w-16';
  const shouldOverlay = isHovering && !isExpanded;

  // Close mobile menu on navigation
  const handleNavClick = () => {
    onClose?.();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 h-screen bg-gray-900 text-white transition-all duration-300 ease-in-out z-40 overflow-hidden
          ${sidebarWidth}
          ${shouldOverlay ? 'shadow-2xl' : ''}
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        onMouseEnter={() => !isMobileMenuOpen && setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Header with toggle button */}
        <div className="h-12 flex items-center px-4 border-b border-gray-700">
          <button
            onClick={toggleExpanded}
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors flex-shrink-0"
            title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg
              className={`w-5 h-5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
          <ul className="space-y-1 px-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const isFriendsPage = item.href === '/friends';
              const showBadge = isFriendsPage && incomingRequestsCount > 0;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={handleNavClick}
                    className={`
                      relative flex items-center h-12 rounded-lg transition-all duration-200 px-3
                      ${isActive
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }
                    `}
                    title={!showExpanded ? item.label : undefined}
                  >
                    <span className="text-xl flex-shrink-0">{item.icon}</span>
                    
                    {showExpanded && (
                      <span className="ml-3 text-sm font-medium animate-fade-in whitespace-nowrap">
                        {item.label}
                      </span>
                    )}

                    {showBadge && (
                      <span className={`
                        absolute bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center
                        ${showExpanded ? 'right-2 w-5 h-5' : '-top-1 -right-1 w-4 h-4'}
                      `}>
                        {incomingRequestsCount > 9 ? '9+' : incomingRequestsCount}
                      </span>
                    )}

                    {item.adminOnly && showExpanded && (
                      <span className="ml-auto text-xs bg-purple-600 px-2 py-0.5 rounded">
                        Admin
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer with user info */}
        {session?.user && showExpanded && (
          <div className="border-t border-gray-700 p-4 animate-fade-in">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold">
                {session.user.username?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {session.user.username}
                </p>
                <p className="text-xs text-gray-400">
                  {session.user.role}
                </p>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
