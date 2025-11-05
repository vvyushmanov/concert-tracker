'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  
  const navItems = [
    { href: '/', label: 'All Concerts', icon: '🎸' },
    { href: '/artists', label: 'By Artist', icon: '🎤' },
    { href: '/countries', label: 'By Country', icon: '🌍' },
    { href: '/calendar', label: 'Calendar', icon: '📅' },
  ];
  
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
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`
                      flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                      ${isActive 
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200' 
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }
                    `}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
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
