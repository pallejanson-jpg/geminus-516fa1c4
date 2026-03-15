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
import { Thermometer, Wind, Droplets, Users, Ruler, Sun, AlertTriangle } from 'lucide-react';

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

const TYPE_ICONS: Record<string, React.ElementType> = {
  temperature: Thermometer,
  co2: Wind,
  humidity: Droplets,
  occupancy: Users,
  area: Ruler,
  light: Sun,
  anomaly: AlertTriangle,
};

/**
 * Vertical color scale legend bar for room visualization.
 * Enhanced: dark background, header with icon, mean-value marker.
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

  // Pre-compute room values
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

  // Compute stats
  const actualMin = roomValues.length > 0 ? Math.min(...roomValues.map(r => r.value)) : null;
  const actualMax = roomValues.length > 0 ? Math.max(...roomValues.map(r => r.value)) : null;
  const actualMean = roomValues.length > 0
    ? roomValues.reduce((s, r) => s + r.value, 0) / roomValues.length
    : null;

  if (visualizationType === 'none' || !config || config.colorStops.length === 0) {
    return null;
  }

  const stops = [...config.colorStops].sort((a, b) => b.value - a.value); // top = max
  const IconComp = TYPE_ICONS[visualizationType];
  const barHeight = isMobile ? 180 : 260;

  const handleStopClick = (stopIndex: number) => {
    const sortedAsc = [...config.colorStops].sort((a, b) => a.value - b.value);
    const stop = stops[stopIndex];
    const ascIdx = sortedAsc.findIndex(s => s.value === stop.value);

    const rangeMin = ascIdx > 0
      ? (sortedAsc[ascIdx - 1].value + stop.value) / 2
      : stop.value;
    const rangeMax = ascIdx < sortedAsc.length - 1
      ? (stop.value + sortedAsc[ascIdx + 1].value) / 2
      : stop.value;

    setActiveStop(prev => prev === stopIndex ? null : stopIndex);

    window.dispatchEvent(
      new CustomEvent<LegendSelectDetail>(VISUALIZATION_LEGEND_SELECT_EVENT, {
        detail: { rangeMin, rangeMax, type: visualizationType },
      })
    );
  };

  // Mean marker position (percentage from bottom)
  const meanPct = actualMean !== null
    ? ((actualMean - config.min) / (config.max - config.min)) * 100
    : null;

  return (
    <div
      className={cn(
        'absolute z-[52] pointer-events-auto',
        isMobile
          ? 'left-3 bottom-24'
          : 'left-3 top-1/2 -translate-y-1/2',
        className,
      )}
    >
      {/* Dark backdrop panel */}
      <div className="rounded-xl bg-black/60 backdrop-blur-lg border border-white/10 p-2.5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-2 px-0.5">
          {IconComp && <IconComp size={14} className="text-white/80" />}
          <span className="text-[11px] font-semibold text-white/90 leading-none">
            {config.label}
          </span>
          <span className="text-[10px] text-white/50 leading-none">({config.unit})</span>
        </div>

        <div className="flex gap-1.5">
          {/* Gradient bar */}
          <div className="relative">
            <div
              className="rounded-md border border-white/20 shadow-lg"
              style={{
                ...gradientStyle,
                width: isMobile ? 18 : 24,
                height: barHeight,
              }}
            />
            {/* Mean marker */}
            {meanPct !== null && (
              <div
                className="absolute -right-1 w-0 h-0"
                style={{
                  bottom: `${meanPct}%`,
                  borderTop: '5px solid transparent',
                  borderBottom: '5px solid transparent',
                  borderRight: '6px solid white',
                  filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))',
                  transform: 'translateY(50%)',
                }}
                title={`Medel: ${actualMean!.toFixed(1)} ${config.unit}`}
              />
            )}
          </div>

          {/* Value labels */}
          <div
            className="relative flex flex-col justify-between py-0.5"
            style={{ height: barHeight }}
          >
            {/* Actual max */}
            {actualMax !== null && (
              <div className="text-[9px] text-white/50 font-medium px-1 -mt-1 mb-0.5">
                ▲ {actualMax.toFixed(1)}
              </div>
            )}
            {stops.map((stop, idx) => {
              const isActive = activeStop === idx;
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
                    'hover:bg-white/15',
                    isActive
                      ? 'bg-white/25 text-white ring-1 ring-white/40'
                      : 'text-white/80',
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
                    <span className="text-[9px] text-white/50 ml-0.5">({matchCount})</span>
                  )}
                  {idx === 0 && (
                    <span className="text-[9px] text-white/50 ml-0.5">{config.unit}</span>
                  )}
                </button>
              );
            })}
            {/* Actual min */}
            {actualMin !== null && (
              <div className="text-[9px] text-white/50 font-medium px-1 mt-0.5 -mb-1">
                ▼ {actualMin.toFixed(1)}
              </div>
            )}
          </div>
        </div>

        {/* Mean summary */}
        {actualMean !== null && (
          <div className="text-[9px] text-white/60 text-center mt-1.5 border-t border-white/10 pt-1">
            Medel: {actualMean.toFixed(1)} {config.unit} · {roomValues.length} rum
          </div>
        )}
      </div>
    </div>
  );
};

export default VisualizationLegendBar;
