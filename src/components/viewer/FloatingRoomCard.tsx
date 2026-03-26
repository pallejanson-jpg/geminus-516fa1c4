import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Move, Maximize2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

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
  const isMobile = useIsMobile();
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(initialPosition || { x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Mouse down on drag handle (desktop only)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    setIsDragging(true);
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  }, [isMobile]);

  // Mouse move (desktop only)
  useEffect(() => {
    if (!isDragging || isMobile) return;

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
  }, [isDragging, dragOffset, isMobile]);

  // Format area
  const formatArea = (area?: number) => {
    if (!area) return null;
    return `${area.toFixed(1)} m²`;
  };

  // Shared room content
  const roomContent = (
    <div className="space-y-2">
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
  );

  // Mobile: Fixed bottom-sheet layout
  if (isMobile) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t rounded-t-xl shadow-2xl pointer-events-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          {/* Drag handle visual indicator */}
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-muted-foreground/30" />
          <span className="text-sm font-medium truncate max-w-[200px]">
            {room.name || room.number || 'Rum'}
          </span>
          <div className="flex items-center gap-1">
            {onExpandToFull && (
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onExpandToFull}>
                <Maximize2 className="h-4 w-4" />
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          {roomContent}
        </div>
      </div>
    );
  }

  // Desktop: Floating draggable card
  return (
    <div
      ref={cardRef}
      className={cn(
        "fixed z-50 w-64 bg-background/95 backdrop-blur-sm border border-border/30 rounded-lg shadow-lg",
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
      <div className="p-3">
        {roomContent}
      </div>
    </div>
  );
};

export default FloatingRoomCard;
