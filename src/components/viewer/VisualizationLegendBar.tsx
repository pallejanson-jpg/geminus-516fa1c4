import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  VisualizationType,
  VISUALIZATION_CONFIGS,
  rgbToHex,
  extractSensorValue,
  generateMockSensorData,
} from '@/lib/visualization-utils';
import { useIsMobile } from '@/hooks/use-mobile';

/** Custom event name for legend-based room selection */
export const VISUALIZATION_LEGEND_SELECT_EVENT = 'VISUALIZATION_LEGEND_SELECT';

export interface LegendSelectDetail {
  rangeMin: number;
  rangeMax: number;
  type: VisualizationType;
}

interface RoomDataForLegend {
  fmGuid: string;
  name: string | null;
  attributes: Record<string, any> | null;
}

interface VisualizationLegendBarProps {
  visualizationType: VisualizationType;
  rooms: RoomDataForLegend[];
  useMockData: boolean;
  className?: string;
}

/**
 * Vertical color scale legend bar for room visualization.
 * Positioned on the LEFT side. Value labels are to the LEFT of the gradient bar.
 * Each label is clickable — clicking dispatches a custom event to select all rooms matching that value range.
 */
const VisualizationLegendBar: React.FC<VisualizationLegendBarProps> = ({
  visualizationType,
  rooms,
  useMockData,
  className,
}) => {
  const isMobile = useIsMobile();
  const [activeStop, setActiveStop] = useState<number | null>(null);

  const config = VISUALIZATION_CONFIGS[visualizationType];

  // Pre-compute room values for count display
  const roomValues = useMemo(() => {
    if (!rooms.length || visualizationType === 'none') return [];
    return rooms.map(room => ({
      fmGuid: room.fmGuid,
      value: useMockData
        ? generateMockSensorData(room.fmGuid, visualizationType)
        : extractSensorValue(room.attributes, visualizationType),
    })).filter(r => r.value !== null) as { fmGuid: string; value: number }[];
  }, [rooms, useMockData, visualizationType]);

  // Build gradient CSS (bottom = min, top = max)
  const gradientStyle = useMemo(() => {
    if (!config || config.colorStops.length === 0) return {};
    const stops = [...config.colorStops].sort((a, b) => a.value - b.value);
    const cssStops = stops.map(stop => {
      const pct = ((stop.value - config.min) / (config.max - config.min)) * 100;
      return `${rgbToHex(stop.color)} ${pct}%`;
    });
    return {
      background: `linear-gradient(to top, ${cssStops.join(', ')})`,
    };
  }, [config]);

  if (visualizationType === 'none' || !config || config.colorStops.length === 0) {
    return null;
  }

  const stops = [...config.colorStops].sort((a, b) => b.value - a.value); // top = max

  const handleStopClick = (stopIndex: number) => {
    const sortedAsc = [...config.colorStops].sort((a, b) => a.value - b.value);
    const stop = stops[stopIndex];
    const ascIdx = sortedAsc.findIndex(s => s.value === stop.value);

    // Range: halfway to previous and next stop
    const rangeMin = ascIdx > 0
      ? (sortedAsc[ascIdx - 1].value + stop.value) / 2
      : stop.value;
    const rangeMax = ascIdx < sortedAsc.length - 1
      ? (stop.value + sortedAsc[ascIdx + 1].value) / 2
      : stop.value;

    setActiveStop(prev => prev === stopIndex ? null : stopIndex);

    // Dispatch selection event
    window.dispatchEvent(
      new CustomEvent<LegendSelectDetail>(VISUALIZATION_LEGEND_SELECT_EVENT, {
        detail: { rangeMin, rangeMax, type: visualizationType },
      })
    );
  };

  // Compute actual min/max from real sensor data
  const actualMin = roomValues.length > 0
    ? Math.min(...roomValues.map(r => r.value))
    : null;
  const actualMax = roomValues.length > 0
    ? Math.max(...roomValues.map(r => r.value))
    : null;

  const barHeight = isMobile ? 180 : 260;

  return (
      <div
        className={cn(
          'absolute z-[52] flex gap-1.5',
          'pointer-events-auto',
          // LEFT side — value labels LEFT of gradient bar
          isMobile
            ? 'left-3 bottom-24'
            : 'left-3 top-1/2 -translate-y-1/2',
          className
        )}
      >
      {/* Value labels — LEFT of gradient bar (flex-row-reverse puts labels first) */}
      <div
        className="relative flex flex-col justify-between py-0.5"
        style={{ height: barHeight }}
      >
        {/* Actual max label */}
        {actualMax !== null && (
          <div className="text-[9px] text-white/60 font-medium px-1 -mt-1 mb-0.5 text-right">
            Max: {actualMax.toFixed(1)} {config.unit}
          </div>
        )}
        {stops.map((stop, idx) => {
          const isActive = activeStop === idx;
          // Count rooms in this stop's range
          const sortedAsc = [...config.colorStops].sort((a, b) => a.value - b.value);
          const ascIdx = sortedAsc.findIndex(s => s.value === stop.value);
          const rangeMin = ascIdx > 0 ? (sortedAsc[ascIdx - 1].value + stop.value) / 2 : stop.value;
          const rangeMax = ascIdx < sortedAsc.length - 1 ? (stop.value + sortedAsc[ascIdx + 1].value) / 2 : stop.value;
          const matchCount = roomValues.filter(r => r.value >= rangeMin && r.value <= rangeMax).length;

          return (
            <button
              key={stop.value}
              onClick={() => handleStopClick(idx)}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium leading-none',
                'transition-all duration-150 cursor-pointer select-none',
                'hover:bg-white/20',
                isActive
                  ? 'bg-white/30 text-white ring-1 ring-white/50'
                  : 'text-white/90'
              )}
              title={`${stop.value} ${config.unit} — ${matchCount} rum`}
            >
              <span>{stop.value}</span>
              <span
                className="inline-block rounded-full shrink-0"
                style={{
                  width: 8,
                  height: 8,
                  backgroundColor: rgbToHex(stop.color),
                  boxShadow: `0 0 4px ${rgbToHex(stop.color)}80`,
                }}
              />
              {matchCount > 0 && (
                <span className="text-[9px] text-white/60 ml-0.5">({matchCount})</span>
              )}
              {idx === 0 && (
                <span className="text-[9px] text-white/60 ml-0.5">{config.unit}</span>
              )}
            </button>
          );
        })}
        {/* Actual min label */}
        {actualMin !== null && (
          <div className="text-[9px] text-white/60 font-medium px-1 mt-0.5 -mb-1 text-right">
            Min: {actualMin.toFixed(1)} {config.unit}
          </div>
        )}
      </div>

      {/* Gradient bar — RIGHT of value labels */}
      <div
        className="rounded-md border border-white/20 shadow-lg"
        style={{
          ...gradientStyle,
          width: isMobile ? 14 : 18,
          height: barHeight,
        }}
      />
    </div>
  );
};

export default VisualizationLegendBar;
