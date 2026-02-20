import React from 'react';
import { Marker } from 'react-map-gl';
import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ClusterMarkerProps {
  longitude: number;
  latitude: number;
  pointCount: number;
  totalPoints: number;
  onClick: () => void;
  isSelected?: boolean;
  compact?: boolean;
}

const ClusterMarker: React.FC<ClusterMarkerProps> = ({
  longitude,
  latitude,
  pointCount,
  totalPoints,
  onClick,
  isSelected,
  compact,
}) => {
  // Scale the marker size based on point count — smaller in compact mode
  const baseMin = compact ? 24 : 36;
  const baseMax = compact ? 40 : 60;
  const size = Math.min(baseMax, Math.max(baseMin, baseMin + (pointCount / totalPoints) * (compact ? 20 : 40)));

  return (
    <Marker longitude={longitude} latitude={latitude} anchor="center">
      <div
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "flex items-center justify-center rounded-full cursor-pointer transition-all",
          "bg-primary text-primary-foreground font-bold shadow-lg",
          "hover:scale-110 hover:shadow-xl",
          isSelected && "ring-2 ring-white ring-offset-2 ring-offset-background"
        )}
        style={{
          width: size,
          height: size,
          fontSize: compact ? 10 : (size > 40 ? 14 : 12),
        }}
      >
        {pointCount}
      </div>
    </Marker>
  );
};

interface SingleMarkerProps {
  longitude: number;
  latitude: number;
  name: string;
  onClick: () => void;
  isSelected?: boolean;
  color?: string;
  compact?: boolean;
}

const SingleMarker: React.FC<SingleMarkerProps> = ({
  longitude,
  latitude,
  name,
  onClick,
  isSelected,
  color,
  compact,
}) => {
  const iconSize = compact ? 12 : 16;
  return (
    <Marker longitude={longitude} latitude={latitude} anchor="bottom">
      <div
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "rounded-full cursor-pointer transition-all shadow-lg",
          compact ? "p-1" : "p-2",
          !color && (isSelected
            ? "bg-primary scale-125"
            : "bg-primary/80 hover:bg-primary hover:scale-110"),
          color && isSelected && "scale-125 ring-2 ring-white"
        )}
        style={color ? { backgroundColor: color } : undefined}
        title={name}
      >
        <Building2 size={iconSize} className="text-white" />
      </div>
    </Marker>
  );
};

export { ClusterMarker, SingleMarker };
