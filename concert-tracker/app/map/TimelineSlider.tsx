'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TimelineSliderProps {
  startDate: number; // Unix timestamp
  endDate: number; // Unix timestamp
  minDate: number; // Absolute minimum date (e.g., today)
  maxDate: number; // Absolute maximum date (e.g., today + 90 days)
  onChange: (startDate: number, endDate: number) => void;
}

export default function TimelineSlider({
  startDate,
  endDate,
  minDate,
  maxDate,
  onChange,
}: TimelineSliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'range' | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [tempStartDate, setTempStartDate] = useState(startDate);
  const [tempEndDate, setTempEndDate] = useState(endDate);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Use temp values while dragging, actual values when not dragging
  const displayStartDate = isDragging ? tempStartDate : startDate;
  const displayEndDate = isDragging ? tempEndDate : endDate;

  // Viewport: shows a wider range than the selection (like a film strip)
  // The viewport is 20x the selection size, centered on the selection
  const selectionSize = displayEndDate - displayStartDate;
  const viewportSize = selectionSize * 20; // Show 20x the selection (wider viewport = narrower visual selection)
  const selectionCenter = displayStartDate + selectionSize / 2;
  
  // Calculate viewport bounds (with limits)
  const viewportStart = Math.max(minDate, selectionCenter - viewportSize / 2);
  const viewportEnd = Math.min(maxDate, selectionCenter + viewportSize / 2);
  const viewportRange = viewportEnd - viewportStart;
  
  // Calculate percentages relative to viewport (not absolute min/max)
  const startPercent = ((displayStartDate - viewportStart) / viewportRange) * 100;
  const endPercent = ((displayEndDate - viewportStart) / viewportRange) * 100;

  // Generate timeline ticks (adaptive based on viewport range)
  const generateTicks = () => {
    const ticks: { date: number; label: string }[] = [];
    const rangeInDays = viewportRange / (24 * 60 * 60);
    
    if (rangeInDays <= 30) {
      // Show weekly ticks
      const current = new Date(viewportStart * 1000);
      current.setHours(0, 0, 0, 0);
      
      while (current.getTime() / 1000 <= viewportEnd) {
        ticks.push({
          date: current.getTime() / 1000,
          label: `${current.getDate()} ${current.toLocaleDateString('en-US', { month: 'short' })}`,
        });
        current.setDate(current.getDate() + 7);
      }
    } else {
      // Show monthly ticks
      const current = new Date(viewportStart * 1000);
      current.setDate(1);
      current.setHours(0, 0, 0, 0);
      
      while (current.getTime() / 1000 <= viewportEnd) {
        ticks.push({
          date: current.getTime() / 1000,
          label: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        });
        current.setMonth(current.getMonth() + 1);
      }
    }
    
    return ticks;
  };

  const ticks = generateTicks();

  const handleMouseDown = (e: React.MouseEvent, handle: 'start' | 'end' | 'range') => {
    e.preventDefault();
    setIsDragging(handle);
    
    if (handle === 'range' && sliderRef.current) {
      const rect = sliderRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickPercent = (clickX / rect.width) * 100;
      setDragOffset(clickPercent - startPercent);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const newDate = viewportStart + (percent / 100) * viewportRange;
    
    // Update tooltip position
    setTooltipPos({ x: e.clientX, y: rect.top - 10 });

    if (isDragging === 'start') {
      const newStartDate = Math.max(minDate, Math.min(newDate, tempEndDate - 24 * 60 * 60)); // At least 1 day range
      setTempStartDate(Math.floor(newStartDate));
    } else if (isDragging === 'end') {
      const newEndDate = Math.max(tempStartDate + 24 * 60 * 60, Math.min(newDate, maxDate));
      setTempEndDate(Math.floor(newEndDate));
    } else if (isDragging === 'range') {
      const rangeSize = tempEndDate - tempStartDate;
      const newStartPercent = percent - dragOffset;
      const newEndPercent = newStartPercent + ((tempEndDate - viewportStart) / viewportRange * 100 - (tempStartDate - viewportStart) / viewportRange * 100);
      
      if (newStartPercent >= 0 && newEndPercent <= 100) {
        const newStart = viewportStart + (newStartPercent / 100) * viewportRange;
        const newEnd = newStart + rangeSize;
        
        if (newStart >= minDate && newEnd <= maxDate) {
          setTempStartDate(Math.floor(newStart));
          setTempEndDate(Math.floor(newEnd));
        }
      }
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      // Only call onChange when dragging ends
      onChange(tempStartDate, tempEndDate);
    }
    setIsDragging(null);
    setDragOffset(0);
    setTooltipPos(null); // Hide tooltip
  };

  // Sync temp values when props change (e.g., from preset buttons)
  useEffect(() => {
    if (!isDragging) {
      setTempStartDate(startDate);
      setTempEndDate(endDate);
    }
  }, [startDate, endDate, isDragging]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, tempStartDate, tempEndDate, minDate, maxDate, dragOffset]);

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-300 dark:border-gray-600 py-4 z-[1000] overflow-x-hidden">
      {/* Timeline slider */}
      <div className="px-4">
        <div className="relative" ref={sliderRef}>
          {/* Timeline track */}
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full relative">
            {/* Selected range */}
            <div
              className="absolute h-full bg-blue-500 dark:bg-blue-600 rounded-full cursor-move"
              style={{
                left: `${startPercent}%`,
                width: `${endPercent - startPercent}%`,
              }}
              onMouseDown={(e) => handleMouseDown(e, 'range')}
            />
            
            {/* Start handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white dark:bg-gray-200 border-2 border-blue-500 dark:border-blue-600 rounded-full cursor-ew-resize shadow-md hover:scale-110 transition-transform"
              style={{ left: `${startPercent}%`, marginLeft: '-8px' }}
              onMouseDown={(e) => handleMouseDown(e, 'start')}
            />
            
            {/* End handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white dark:bg-gray-200 border-2 border-blue-500 dark:border-blue-600 rounded-full cursor-ew-resize shadow-md hover:scale-110 transition-transform"
              style={{ left: `${endPercent}%`, marginLeft: '-8px' }}
              onMouseDown={(e) => handleMouseDown(e, 'end')}
            />
          </div>

          {/* Timeline ticks */}
          <div className="relative mt-2 h-8">
            {ticks.map((tick, index) => {
              const tickPercent = ((tick.date - viewportStart) / viewportRange) * 100;
              return (
                <div
                  key={index}
                  className="absolute"
                  style={{ left: `${tickPercent}%` }}
                >
                  <div className="w-px h-2 bg-gray-400 dark:bg-gray-500 -translate-x-1/2" />
                  <div className="text-xs text-gray-600 dark:text-gray-400 -translate-x-1/2 mt-1 whitespace-nowrap">
                    {tick.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected range display */}
        <div className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">
          <span className="font-medium">
            {new Date(startDate * 1000).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              year: 'numeric' 
            })}
          </span>
          {' → '}
          <span className="font-medium">
            {new Date(endDate * 1000).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              year: 'numeric' 
            })}
          </span>
          <span className="ml-2 text-gray-500 dark:text-gray-400">
            ({Math.ceil((endDate - startDate) / (24 * 60 * 60))} days)
          </span>
        </div>
      </div>
      
      {/* Tooltip via portal - renders in body above everything */}
      {isDragging && tooltipPos && typeof window !== 'undefined' && createPortal(
        <div 
          className="fixed px-4 py-2 bg-gray-900 text-white text-sm font-bold rounded-lg shadow-2xl pointer-events-none"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 99999,
          }}
        >
          {isDragging === 'start' && new Date(displayStartDate * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {isDragging === 'end' && new Date(displayEndDate * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {isDragging === 'range' && `${new Date(displayStartDate * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → ${new Date(displayEndDate * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
        </div>,
        document.body
      )}
    </div>
  );
}
