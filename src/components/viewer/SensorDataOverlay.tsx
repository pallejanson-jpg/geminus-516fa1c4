/**
 * SensorDataOverlay — floating panel showing live sensor readings
 * next to highlighted assets in the 3D viewer. Listens for AI_SENSOR_DATA events.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { X, Thermometer, Droplets, Wind, Activity, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export const AI_SENSOR_DATA_EVENT = 'AI_SENSOR_DATA';

export interface SensorReading {
  entity_id: string;
  value: number;
  type: string;
  unit?: string;
  status: 'normal' | 'warning' | 'critical';
}

interface SensorDataOverlayProps {
  className?: string;
}

function getSensorIcon(type: string) {
  switch (type.toLowerCase()) {
    case 'temperature': return Thermometer;
    case 'humidity': return Droplets;
    case 'co2': return Wind;
    default: return Activity;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'critical': return 'text-red-500 bg-red-500/10 border-red-500/30';
    case 'warning': return 'text-amber-500 bg-amber-500/10 border-amber-500/30';
    default: return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
  }
}

function getStatusDot(status: string) {
  switch (status) {
    case 'critical': return 'bg-red-500';
    case 'warning': return 'bg-amber-500';
    default: return 'bg-emerald-500';
  }
}

function formatValue(value: number, type: string, unit?: string): string {
  if (unit) return `${value}${unit}`;
  switch (type.toLowerCase()) {
    case 'temperature': return `${value.toFixed(1)}°C`;
    case 'co2': return `${Math.round(value)} ppm`;
    case 'humidity': return `${value.toFixed(0)}%`;
    default: return `${value}`;
  }
}

function getTypeName(type: string): string {
  switch (type.toLowerCase()) {
    case 'temperature': return 'Temperature';
    case 'co2': return 'CO₂';
    case 'humidity': return 'Humidity';
    default: return type;
  }
}

const SensorDataOverlay: React.FC<SensorDataOverlayProps> = ({ className }) => {
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent<SensorReading[]>).detail;
      if (data?.length) {
        setReadings(data);
        setVisible(true);
      } else {
        setReadings([]);
        setVisible(false);
      }
    };

    window.addEventListener(AI_SENSOR_DATA_EVENT, handler);
    return () => window.removeEventListener(AI_SENSOR_DATA_EVENT, handler);
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setReadings([]);
  }, []);

  if (!visible || readings.length === 0) return null;

  // Group by type
  const grouped = readings.reduce<Record<string, SensorReading[]>>((acc, r) => {
    const key = r.type.toLowerCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const warningCount = readings.filter(r => r.status === 'warning' || r.status === 'critical').length;

  return (
    <div className={cn(
      "absolute top-14 right-3 z-[60] w-72 max-h-[50vh] flex flex-col",
      "rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-xl",
      "animate-in slide-in-from-right-4 fade-in duration-300",
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground leading-tight">Sensor Data</h3>
            <p className="text-[10px] text-muted-foreground">
              {readings.length} reading{readings.length !== 1 ? 's' : ''}
              {warningCount > 0 && (
                <span className="text-amber-500 ml-1">• {warningCount} alert{warningCount !== 1 ? 's' : ''}</span>
              )}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Readings */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {Object.entries(grouped).map(([type, items]) => {
            const Icon = getSensorIcon(type);
            const avg = items.reduce((sum, r) => sum + r.value, 0) / items.length;
            const worstStatus = items.some(r => r.status === 'critical') ? 'critical'
              : items.some(r => r.status === 'warning') ? 'warning' : 'normal';

            return (
              <div key={type} className="space-y-1">
                {/* Type header with average */}
                <div className={cn(
                  "flex items-center justify-between px-2.5 py-2 rounded-lg border",
                  getStatusColor(worstStatus)
                )}>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="text-xs font-medium">{getTypeName(type)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {worstStatus !== 'normal' && <AlertTriangle className="h-3 w-3" />}
                    <span className="text-sm font-bold tabular-nums">
                      {formatValue(avg, type, items[0]?.unit)}
                    </span>
                  </div>
                </div>

                {/* Individual readings (if more than 1) */}
                {items.length > 1 && (
                  <div className="pl-2 space-y-0.5">
                    {items.map((reading, i) => (
                      <div
                        key={`${reading.entity_id}-${i}`}
                        className="flex items-center justify-between px-2 py-1 rounded text-xs"
                      >
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", getStatusDot(reading.status))} />
                          <span className="truncate max-w-[120px]">
                            Sensor {i + 1}
                          </span>
                        </div>
                        <span className={cn(
                          "font-medium tabular-nums",
                          reading.status === 'critical' ? 'text-red-500' :
                          reading.status === 'warning' ? 'text-amber-500' : 'text-foreground'
                        )}>
                          {formatValue(reading.value, reading.type, reading.unit)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Legend footer */}
      <div className="px-3 py-1.5 border-t border-border flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-[10px] text-muted-foreground">Normal</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          <span className="text-[10px] text-muted-foreground">Warning</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-[10px] text-muted-foreground">Critical</span>
        </div>
      </div>
    </div>
  );
};

export default SensorDataOverlay;
