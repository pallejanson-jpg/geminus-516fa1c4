import React, { useState, useEffect } from 'react';
import { Thermometer, Wind, Droplets, Users, Ruler } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VisualizationType, VISUALIZATION_CONFIGS, rgbToHex } from '@/lib/visualization-utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { emit, on } from '@/lib/event-bus';

/** @deprecated Use emit('VISUALIZATION_QUICK_SELECT', ...) from event-bus */
export const VISUALIZATION_QUICK_SELECT_EVENT = 'VISUALIZATION_QUICK_SELECT';

const VIZ_ITEMS: { type: VisualizationType; icon: React.ElementType; label: string }[] = [
  { type: 'temperature', icon: Thermometer, label: 'Temp' },
  { type: 'co2', icon: Wind, label: 'CO₂' },
  { type: 'humidity', icon: Droplets, label: 'Humid.' },
  { type: 'occupancy', icon: Users, label: 'Occup.' },
  { type: 'area', icon: Ruler, label: 'Area' },
];

const VisualizationQuickBar: React.FC<{ className?: string }> = ({ className }) => {
  const isMobile = useIsMobile();
  const [active, setActive] = useState<VisualizationType>('none');

  // Listen for state changes from the panel so we stay in sync
  useEffect(() => {
    return on('VISUALIZATION_STATE_CHANGED', (detail) => {
      setActive(detail?.visualizationType ?? 'none');
    });
  }, []);

  const toggle = (type: VisualizationType) => {
    const next = active === type ? 'none' : type;
    setActive(next);
    emit('VISUALIZATION_QUICK_SELECT', { type: next });
  };

  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-lg px-1.5 py-1 bg-black/50 backdrop-blur-md border border-white/10',
        isMobile ? 'gap-0.5' : 'gap-1',
        className,
      )}
    >
      {VIZ_ITEMS.map(({ type, icon: Icon, label }) => {
        const isActive = active === type;
        const config = VISUALIZATION_CONFIGS[type];
        const accentColor = config?.colorStops?.[Math.floor(config.colorStops.length / 2)]?.color;
        const accentHex = accentColor ? rgbToHex(accentColor) : undefined;

        return (
          <button
            key={type}
            onClick={() => toggle(type)}
            title={config?.label ?? label}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all duration-150 select-none',
              'hover:bg-white/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40',
              isActive
                ? 'text-white ring-1 ring-white/30'
                : 'text-white/70',
              isMobile && 'px-1.5 py-1',
            )}
            style={isActive && accentHex ? {
              background: `linear-gradient(135deg, ${accentHex}40, ${accentHex}20)`,
              boxShadow: `0 0 8px ${accentHex}50`,
            } : undefined}
          >
            <Icon size={isMobile ? 14 : 16} />
            {!isMobile && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default VisualizationQuickBar;
