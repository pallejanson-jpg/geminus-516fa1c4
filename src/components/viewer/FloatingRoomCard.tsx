import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Move, Maximize2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface RoomData {
  fmGuid: string;
  name?: string;
  number?: string;
  longName?: string;
  area?: number;
  function?: string;
  department?: string;
  floorName?: string;
  [key: string]: any;
}

interface FloatingRoomCardProps {
  room: RoomData;
  position?: { x: number; y: number };
  onClose: () => void;
  onExpandToFull?: () => void;
}

/**
 * A smaller, floating room info card that doesn't block 3D interaction.
 * Can be dragged around the viewport.
 */
const FloatingRoomCard: React.FC<FloatingRoomCardProps> = ({
  room,
  position: initialPosition,
  onClose,
  onExpandToFull,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(initialPosition || { x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Mouse down on drag handle
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  }, []);

  // Mouse move
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Format area
  const formatArea = (area?: number) => {
    if (!area) return null;
    return `${area.toFixed(1)} m²`;
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        "fixed z-50 w-64 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg",
        "pointer-events-auto",
        isDragging && "cursor-grabbing"
      )}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {/* Header with drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <Move className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm font-medium truncate max-w-[140px]">
            {room.name || room.number || 'Rum'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onExpandToFull && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onExpandToFull}>
              <Maximize2 className="h-3 w-3" />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Room number and name */}
        {room.number && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {room.number}
            </Badge>
            {room.name && room.name !== room.number && (
              <span className="text-sm text-muted-foreground truncate">{room.name}</span>
            )}
          </div>
        )}

        {/* Long name if different */}
        {room.longName && room.longName !== room.name && (
          <p className="text-xs text-muted-foreground">{room.longName}</p>
        )}

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {room.area && (
            <div>
              <span className="text-muted-foreground">Area:</span>
              <span className="ml-1 font-medium">{formatArea(room.area)}</span>
            </div>
          )}
          {room.function && (
            <div>
              <span className="text-muted-foreground">Funktion:</span>
              <span className="ml-1">{room.function}</span>
            </div>
          )}
          {room.floorName && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Våning:</span>
              <span className="ml-1">{room.floorName}</span>
            </div>
          )}
        </div>

        {/* FM GUID (truncated) */}
        <div className="pt-1 border-t">
          <code className="text-[10px] text-muted-foreground/70 truncate block">
            {room.fmGuid}
          </code>
        </div>
      </div>
    </div>
  );
};

export default FloatingRoomCard;
