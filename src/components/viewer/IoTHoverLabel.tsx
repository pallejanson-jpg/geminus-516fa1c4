import React from 'react';
import { cn } from '@/lib/utils';
import { VisualizationType, VISUALIZATION_CONFIGS } from '@/lib/visualization-utils';

export interface IoTHoverLabelProps {
  visible: boolean;
  position: { x: number; y: number };
  roomName: string;
  value: number;
  visualizationType: VisualizationType;
  color: [number, number, number];
  className?: string;
}

/**
 * Floating label that displays sensor data when hovering over rooms in the 3D viewer.
 * Positioned relative to mouse cursor and styled with the visualization color.
 */
const IoTHoverLabel: React.FC<IoTHoverLabelProps> = ({
  visible,
  position,
  roomName,
  value,
  visualizationType,
  color,
  className,
}) => {
  if (!visible || visualizationType === 'none') return null;

  const config = VISUALIZATION_CONFIGS[visualizationType];
  if (!config) return null;

  const rgbColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

  // Get icon for visualization type
  const getIcon = () => {
    switch (visualizationType) {
      case 'temperature': return '🌡️';
      case 'co2': return '💨';
      case 'humidity': return '💧';
      case 'occupancy': return '👥';
      case 'area': return '📐';
      default: return '';
    }
  };

  return (
    <div
      className={cn(
        'fixed pointer-events-none z-[100]',
        'bg-card/95 backdrop-blur-sm border border-border/30 rounded-lg shadow-lg',
        'px-3 py-2 text-sm min-w-[140px]',
        'transition-opacity duration-100',
        className
      )}
      style={{
        left: Math.min(position.x + 16, window.innerWidth - 180),
        top: Math.max(position.y - 24, 10),
        borderLeftColor: rgbColor,
        borderLeftWidth: 4,
      }}
    >
      <div className="flex items-center gap-1.5 text-foreground font-medium text-xs truncate max-w-[150px]">
        <span>{getIcon()}</span>
        <span className="truncate">{roomName || 'Okänt rum'}</span>
      </div>
      <div 
        className="text-lg font-bold mt-0.5"
        style={{ color: rgbColor }}
      >
        {value.toFixed(1)}{config.unit}
      </div>
    </div>
  );
};

export default IoTHoverLabel;
