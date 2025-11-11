'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import { MapConcert } from '@/app/types/map';
import { getUserColor } from '@/app/lib/mapColors';

// Fix for default marker icons in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface ConcertMapProps {
  concerts: MapConcert[];
  currentUserId: number;
  selectedFriendIds: number[];
  onMarkerClick?: (concertIds: number[]) => void;
  onViewportChange?: (visibleConcertIds: number[]) => void;
  sidebarMinimized?: boolean;
  triggerViewportUpdate?: number;
}

export default function ConcertMap({ concerts, currentUserId, selectedFriendIds, onMarkerClick, onViewportChange, sidebarMinimized, triggerViewportUpdate }: ConcertMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.MarkerClusterGroup | null>(null);

  // Store current values in refs so iconCreateFunction can access them
  const currentUserIdRef = useRef(currentUserId);
  const selectedFriendIdsRef = useRef(selectedFriendIds);
  const concertsRef = useRef(concerts);
  const onViewportChangeRef = useRef(onViewportChange);
  
  // Track if this is the initial load to only fit bounds once
  const hasInitializedBoundsRef = useRef(false);
  
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
    selectedFriendIdsRef.current = selectedFriendIds;
    concertsRef.current = concerts;
    onViewportChangeRef.current = onViewportChange;
  }, [currentUserId, selectedFriendIds, concerts, onViewportChange]);

  // Initialize map AND cluster layer together (only once)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mapRef.current) return; // Already initialized

    console.log('🗺️ Initializing map and cluster layer...');

    // Create map centered on Europe
    const map = L.map('concert-map').setView([48.8566, 2.3522], 5);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    // Clear selection when clicking on the map (not on a marker)
    map.on('click', () => {
      if (onMarkerClick) {
        onMarkerClick([]);
      }
    });

    // Track viewport changes only when user releases the map
    const updateVisibleConcerts = () => {
      const currentOnViewportChange = onViewportChangeRef.current;
      if (!currentOnViewportChange) return;
      
      try {
        const bounds = map.getBounds();
        const visibleIds: number[] = [];
        
        // Use ref to get current concerts array
        const currentConcerts = concertsRef.current;
        
        // Check which concerts are in the current viewport
        currentConcerts.forEach(concert => {
          if (concert.coordinates) {
            const { lat, lng } = concert.coordinates;
            if (bounds.contains([lat, lng])) {
              visibleIds.push(concert.id);
            }
          }
        });
        
        currentOnViewportChange(visibleIds);
      } catch (error) {
        // Map not fully initialized yet, skip this update
        console.log('Map not ready for viewport calculation');
      }
    };

    // Update visible concerts only when drag ends or zoom ends
    map.on('dragend', updateVisibleConcerts);  // Fires when user releases mouse after dragging
    map.on('zoomend', updateVisibleConcerts);  // Fires when zoom animation completes
    
    // Initial update after map is fully loaded
    map.whenReady(() => {
      updateVisibleConcerts();
    });

    mapRef.current = map;

    // Create marker cluster group with custom icon
    const markers = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 50,
      iconCreateFunction: (cluster) => {
        const childMarkers = cluster.getAllChildMarkers();
        const concerts = childMarkers.map((m: any) => m.options.concertData as MapConcert);
        
        // Collect all unique user IDs from concerts in this cluster
        const userIds = new Set<number>();
        concerts.forEach(concert => {
          concert.userInteractions.forEach(ui => userIds.add(ui.userId));
        });
        
        const userIdArray = Array.from(userIds);
        const hasCurrentUser = userIdArray.includes(currentUserIdRef.current);
        const friendIds = userIdArray.filter(id => id !== currentUserIdRef.current && selectedFriendIdsRef.current.includes(id));
        
        // Base color: current user's color if present, otherwise first friend's color
        const baseColor = hasCurrentUser 
          ? getUserColor(currentUserIdRef.current, currentUserIdRef.current, selectedFriendIdsRef.current)
          : getUserColor(friendIds[0] || currentUserIdRef.current, currentUserIdRef.current, selectedFriendIdsRef.current);
        
        // Build friend badge dots ONLY if current user has concerts AND friends are present
        let friendBadge = '';
        if (hasCurrentUser && friendIds.length > 0) {
          const friendColors = friendIds.slice(0, 3).map(id => 
            getUserColor(id, currentUserIdRef.current, selectedFriendIdsRef.current)
          );
          
          const dots = friendColors.map(color => 
            `<div style="
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background-color: ${color};
              border: 1px solid white;
              display: inline-block;
              margin-left: 1px;
            "></div>`
          ).join('');
          
          friendBadge = `
            <div style="
              position: absolute;
              top: -2px;
              right: -2px;
              display: flex;
              gap: 1px;
              background: rgba(0,0,0,0.3);
              padding: 2px;
              border-radius: 10px;
            ">
              ${dots}
            </div>
          `;
        }
        
        const count = childMarkers.length;
        
        return L.divIcon({
          html: `
            <div style="
              background-color: ${baseColor};
              width: 40px;
              height: 40px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: bold;
              font-size: 14px;
              color: white;
              text-shadow: 0 1px 2px rgba(0,0,0,0.3);
              position: relative;
            ">
              ${count}
              ${friendBadge}
            </div>
          `,
          className: 'custom-cluster-icon',
          iconSize: L.point(40, 40),
        });
      },
    });

    markersLayerRef.current = markers;
    map.addLayer(markers);

    console.log('✅ Map and cluster layer initialized');

    return () => {
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
    };
  }, []); // Only create once on mount

  // Track markers by concert ID for diffing
  const markerMapRef = useRef<Map<number, L.Marker>>(new Map());
  
  // Track concert data hash to detect changes in userInteractions
  const concertDataHashRef = useRef<Map<number, string>>(new Map());

  // Update markers when concerts change (with diffing for smooth transitions)
  useEffect(() => {
    console.log('🗺️ ConcertMap: concerts changed', { 
      count: concerts.length, 
      hasMap: !!mapRef.current, 
      hasClusterLayer: !!markersLayerRef.current 
    });
    
    if (!mapRef.current || !markersLayerRef.current) {
      console.log('⚠️ Map or cluster layer not ready yet');
      return;
    }

    const markers = markersLayerRef.current;
    const markerMap = markerMapRef.current;
    const dataHashMap = concertDataHashRef.current;
    
    // Create a set of current concert IDs
    const currentConcertIds = new Set(concerts.map(c => c.id));
    
    // Remove markers for concerts that are no longer in the list
    const markersToRemove: number[] = [];
    markerMap.forEach((marker, concertId) => {
      if (!currentConcertIds.has(concertId)) {
        markers.removeLayer(marker);
        markersToRemove.push(concertId);
        dataHashMap.delete(concertId);
      }
    });
    markersToRemove.forEach(id => markerMap.delete(id));
    console.log('🗑️ Removed markers:', markersToRemove.length);

    if (concerts.length === 0) {
      console.log('⚠️ No concerts to display');
      return;
    }

    const bounds: L.LatLngBoundsExpression[] = [];

    concerts.forEach((concert) => {
      if (!concert.coordinates) return;

      const { lat, lng } = concert.coordinates;
      bounds.push([lat, lng]);

      // Create a hash of the concert data to detect changes
      const dataHash = JSON.stringify({
        userInteractions: concert.userInteractions.map(ui => ({ userId: ui.userId, interested: ui.interested })),
        selectedFriendIds: selectedFriendIds.sort()
      });
      
      const existingHash = dataHashMap.get(concert.id);
      
      // Skip if marker exists AND data hasn't changed
      if (markerMap.has(concert.id) && existingHash === dataHash) {
        return;
      }
      
      // Remove old marker if it exists (data changed)
      if (markerMap.has(concert.id)) {
        console.log('🔄 Updating marker for concert:', concert.id, concert.eventName);
        markers.removeLayer(markerMap.get(concert.id)!);
        markerMap.delete(concert.id);
      }
      
      // Store the new hash
      dataHashMap.set(concert.id, dataHash);

      // Check if current user has this concert
      const hasCurrentUser = concert.userInteractions.some(ui => ui.userId === currentUserId);
      const friendUserIds = concert.userInteractions
        .map(ui => ui.userId)
        .filter(id => id !== currentUserId && selectedFriendIds.includes(id));
      
      // Determine marker color - use current user's color if they have it
      const primaryColor = hasCurrentUser
        ? getUserColor(currentUserId, currentUserId, selectedFriendIds)
        : getUserColor(concert.userInteractions[0].userId, currentUserId, selectedFriendIds);
      
      const isShared = concert.userInteractions.length > 1;

      // Build friend badge for single markers (only if current user has concert AND friends present)
      let friendBadge = '';
      if (hasCurrentUser && friendUserIds.length > 0) {
        const friendColors = friendUserIds.slice(0, 3).map(id => 
          getUserColor(id, currentUserId, selectedFriendIds)
        );
        
        const dots = friendColors.map(color => 
          `<div style="
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: ${color};
            border: 1px solid white;
            display: inline-block;
            margin-left: 1px;
          "></div>`
        ).join('');
        
        friendBadge = `
          <div style="
            position: absolute;
            top: -3px;
            right: -3px;
            display: flex;
            gap: 1px;
            background: rgba(0,0,0,0.4);
            padding: 1px 2px;
            border-radius: 8px;
          ">
            ${dots}
          </div>
        `;
      }

      // Create custom icon
      const iconHtml = `
        <div style="
          background-color: ${primaryColor};
          width: 30px;
          height: 30px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          position: relative;
        ">
          ${isShared ? '🔥' : '🎸'}
          ${concert.userInteractions.some(ui => ui.interested) ? '<div style="position: absolute; top: -5px; left: -5px; font-size: 12px;">⭐</div>' : ''}
          ${friendBadge}
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-concert-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      // Create marker with concert data attached
      const marker = L.marker([lat, lng], { 
        icon: customIcon,
        concertData: concert,
      } as any);

      // Build user list for popup
      let userList = '';
      if (concert.userInteractions.length > 0) {
        const currentUserInteraction = concert.userInteractions.find(ui => ui.userId === currentUserId);
        const friendInteractions = concert.userInteractions.filter(ui => ui.userId !== currentUserId);
        
        const names = [];
        if (currentUserInteraction) {
          names.push('You');
        }
        names.push(...friendInteractions.map(ui => ui.username));
        
        if (names.length > 1) {
          userList = `
            <div style="font-size: 11px; color: #666; padding-top: 4px; border-top: 1px solid #eee; margin-bottom: 4px;">
              ${names.join(', ')} ${names.length === 2 ? 'are' : 'are'} interested
            </div>
          `;
        }
      }

      // Create popup content
      const primaryArtist = concert.artists.find(a => a.isPrimary) || concert.artists[0];
      const artistNames = concert.artists.map(a => a.artist.name).join(', ');
      
      const popupContent = `
        <div style="min-width: 200px;">
          <h3 style="font-weight: bold; margin-bottom: 8px; font-size: 14px;">
            ${concert.eventName}
          </h3>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            <strong>${artistNames}</strong>
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            📍 ${concert.cityMapping?.originalCity || 'Unknown'}, ${concert.country.name}
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            📅 ${new Date(concert.dateStart * 1000).toLocaleDateString()}
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
            🎪 ${concert.venue}
          </div>
          ${userList}
          <a 
            href="/concerts/${concert.id}" 
            style="
              display: inline-block;
              margin-top: 8px;
              padding: 4px 12px;
              background-color: #3B82F6;
              color: white;
              text-decoration: none;
              border-radius: 4px;
              font-size: 12px;
            "
          >
            View Details →
          </a>
        </div>
      `;

      marker.bindPopup(popupContent);

      // Handle marker click - find all concerts at this location
      if (onMarkerClick) {
        marker.on('click', (e) => {
          // Stop propagation to prevent map click handler from firing
          L.DomEvent.stopPropagation(e);
          
          // Find all concerts at the same coordinates
          const concertsAtLocation = concerts.filter(c => 
            c.coordinates && 
            c.coordinates.lat === lat && 
            c.coordinates.lng === lng
          );
          onMarkerClick(concertsAtLocation.map(c => c.id));
        });

        // Clear selection when popup is closed
        marker.on('popupclose', () => {
          onMarkerClick([]);
        });
      }

      // Add marker to cluster layer and track it
      markers.addLayer(marker);
      markerMap.set(concert.id, marker);
      console.log('➕ Added marker for concert:', concert.id, concert.eventName);
    });

    console.log('📊 Marker summary:', {
      totalConcerts: concerts.length,
      markersInMap: markerMap.size,
      boundsCount: bounds.length
    });

    // Fit bounds only on very first load (never again after that)
    if (bounds.length > 0 && !hasInitializedBoundsRef.current && concerts.length > 0) {
      console.log('🎯 Fitting bounds to markers (initial load only)');
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
      hasInitializedBoundsRef.current = true;
    }
  }, [concerts, currentUserId, selectedFriendIds]);

  // Invalidate map size when sidebar is toggled
  useEffect(() => {
    if (!mapRef.current) return;
    
    // Wait for CSS transition to complete (300ms) before invalidating size
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
      console.log('🗺️ Map size invalidated after sidebar toggle');
    }, 350);
    
    return () => clearTimeout(timer);
  }, [sidebarMinimized]);

  // Recalculate viewport when triggered by filter changes
  useEffect(() => {
    if (!mapRef.current || !onViewportChangeRef.current || triggerViewportUpdate === 0) return;

    const updateVisibleConcerts = () => {
      try {
        const bounds = mapRef.current!.getBounds();
        const visibleIds: number[] = [];
        
        const currentConcerts = concertsRef.current;
        
        currentConcerts.forEach(concert => {
          if (concert.coordinates) {
            const { lat, lng } = concert.coordinates;
            if (bounds.contains([lat, lng])) {
              visibleIds.push(concert.id);
            }
          }
        });
        
        onViewportChangeRef.current!(visibleIds);
        console.log('🔄 Viewport recalculated after filter change');
      } catch (error) {
        console.log('Map not ready for viewport calculation');
      }
    };

    updateVisibleConcerts();
  }, [triggerViewportUpdate]);

  return (
    <>
      <style jsx global>{`
        .leaflet-marker-icon,
        .leaflet-marker-shadow {
          transition: opacity 0.3s ease-in-out !important;
        }
        
        .custom-cluster-icon {
          transition: all 0.3s ease-in-out !important;
        }
        
        .leaflet-marker-pane {
          will-change: transform;
        }
      `}</style>
      <div 
        id="concert-map" 
        className="absolute inset-0 z-0"
        style={{ background: '#f0f0f0' }}
      />
    </>
  );
}
