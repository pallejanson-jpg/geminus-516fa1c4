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
}

const ClusterMarker: React.FC<ClusterMarkerProps> = ({
  longitude,
  latitude,
  pointCount,
  totalPoints,
  onClick,
  isSelected,
}) => {
  // Scale the marker size based on point count
  const size = Math.min(60, Math.max(36, 36 + (pointCount / totalPoints) * 40));

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
          fontSize: size > 40 ? 14 : 12,
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
}

const SingleMarker: React.FC<SingleMarkerProps> = ({
  longitude,
  latitude,
  name,
  onClick,
  isSelected,
}) => {
  return (
    <Marker longitude={longitude} latitude={latitude} anchor="bottom">
      <div
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "p-2 rounded-full cursor-pointer transition-all shadow-lg",
          isSelected
            ? "bg-primary scale-125"
            : "bg-primary/80 hover:bg-primary hover:scale-110"
        )}
        title={name}
      >
        <Building2 size={16} className="text-primary-foreground" />
      </div>
    </Marker>
  );
};

export { ClusterMarker, SingleMarker };
