'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
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
  onConcertClick?: (concert: MapConcert) => void;
}

export default function ConcertMap({ concerts, currentUserId, selectedFriendIds, onConcertClick }: ConcertMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.MarkerClusterGroup | null>(null);

  // Initialize map
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mapRef.current) return; // Already initialized

    // Create map centered on Europe
    const map = L.map('concert-map').setView([48.8566, 2.3522], 5);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    // Create marker cluster group
    const markers = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 50,
    });

    markersLayerRef.current = markers;
    map.addLayer(markers);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers when concerts change
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current) return;

    const markers = markersLayerRef.current;
    markers.clearLayers();

    if (concerts.length === 0) return;

    const bounds: L.LatLngBoundsExpression[] = [];

    concerts.forEach((concert) => {
      if (!concert.coordinates) return;

      const { lat, lng } = concert.coordinates;
      bounds.push([lat, lng]);

      // Determine marker color based on users
      const userColors = concert.userInteractions.map(ui =>
        getUserColor(ui.userId, currentUserId, selectedFriendIds)
      );
      const primaryColor = userColors[0] || '#3B82F6';
      const isShared = concert.userInteractions.length > 1;

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
          ${concert.userInteractions.some(ui => ui.interested) ? '<div style="position: absolute; top: -5px; right: -5px; font-size: 12px;">⭐</div>' : ''}
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-concert-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      // Create marker
      const marker = L.marker([lat, lng], { icon: customIcon });

      // Create popup content
      const popupContent = `
        <div style="min-width: 200px;">
          <h3 style="font-weight: bold; margin-bottom: 8px; font-size: 14px;">
            ${concert.eventName}
          </h3>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            <strong>${concert.artist.name}</strong>
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            📍 ${concert.city}, ${concert.country.name}
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            📅 ${new Date(concert.dateStart * 1000).toLocaleDateString()}
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
            🎪 ${concert.venue}
          </div>
          ${concert.userInteractions.length > 1 ? `
            <div style="font-size: 11px; color: #666; padding-top: 4px; border-top: 1px solid #eee;">
              ${concert.userInteractions.length} people interested
            </div>
          ` : ''}
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

      if (onConcertClick) {
        marker.on('click', () => onConcertClick(concert));
      }

      markers.addLayer(marker);
    });

    // Fit map to markers bounds
    if (bounds.length > 0) {
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    }
  }, [concerts, currentUserId, selectedFriendIds, onConcertClick]);

  return (
    <div 
      id="concert-map" 
      className="absolute inset-0 z-0"
      style={{ background: '#f0f0f0' }}
    />
  );
}
