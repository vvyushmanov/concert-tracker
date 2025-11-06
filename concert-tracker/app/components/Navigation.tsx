'use client';

import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function Navigation() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

  // Listen for sidebar expansion state changes
  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('sidebarExpanded');
      const isExpanded = saved === 'true';
      setIsSidebarExpanded(isExpanded);
      
      // Update main content margin
      const mainContent = document.getElementById('main-content');
      if (mainContent) {
        if (isExpanded) {
          mainContent.classList.remove('lg:ml-16');
          mainContent.classList.add('lg:ml-64');
        } else {
          mainContent.classList.remove('lg:ml-64');
          mainContent.classList.add('lg:ml-16');
        }
      }
    };

    // Initial load
    handleStorageChange();

    // Listen for changes
    window.addEventListener('storage', handleStorageChange);
    
    // Custom event for same-window updates
    window.addEventListener('sidebarExpandedChange', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('sidebarExpandedChange', handleStorageChange);
    };
  }, []);

  return (
    <>
      <Sidebar 
        isMobileMenuOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        onExpandedChange={setIsSidebarExpanded}
      />
      <TopBar 
        onMobileMenuToggle={() => setIsMobileMenuOpen(true)}
        isSidebarExpanded={isSidebarExpanded}
      />
    </>
  );
}
