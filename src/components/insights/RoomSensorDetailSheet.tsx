import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Zap, ExternalLink, Thermometer, Wind, Droplets, Users, Wifi, WifiOff } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useSenslincData } from '@/hooks/useSenslincData';
import { VISUALIZATION_CONFIGS, getVisualizationColor, rgbToHex } from '@/lib/visualization-utils';
import { cn } from '@/lib/utils';

interface RoomSensorDetailSheetProps {
  open: boolean;
  onClose: () => void;
  roomFmGuid: string | null;
  roomName?: string;
}

// ── Status badge ──
const StatusBadge = ({ isLive, isLoading }: { isLive: boolean; isLoading: boolean }) => {
  if (isLoading) return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-muted-foreground/40 text-muted-foreground">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Laddar…
    </Badge>
  );
  if (isLive) return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-green-500/50 text-green-400 bg-green-500/10">
      <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse inline-block" />LIVE
    </Badge>
  );
  return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-purple-500/50 text-purple-400 bg-purple-500/10">
      Demo
    </Badge>
  );
};

// ── Gauge card ──
interface GaugeCardProps {
  label: string;
  value: number | null;
  unit: string;
  icon: React.ElementType;
  type: 'temperature' | 'co2' | 'humidity' | 'occupancy';
  isLoading?: boolean;
}

const GaugeCard: React.FC<GaugeCardProps> = ({ label, value, unit, icon: Icon, type, isLoading }) => {
  const config = VISUALIZATION_CONFIGS[type];
  const rgb = value !== null ? getVisualizationColor(value, type) : null;
  const hexColor = rgb ? rgbToHex(rgb) : undefined;
  const pct = value !== null
    ? Math.max(0, Math.min(100, ((value - config.min) / (config.max - config.min)) * 100))
    : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        {hexColor && <div className="h-2 w-2 rounded-full" style={{ backgroundColor: hexColor }} />}
      </div>

      {isLoading ? (
        <div className="h-8 flex items-center">
          <div className="h-3 w-16 bg-muted animate-pulse rounded" />
        </div>
      ) : (
        <div
          className="text-2xl font-bold tabular-nums leading-none"
          style={{ color: hexColor ?? 'hsl(var(--foreground))' }}
        >
          {value !== null ? (
            <>
              {type === 'occupancy' ? Math.round(value) : value.toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>
            </>
          ) : (
            <span className="text-muted-foreground text-lg">—</span>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: hexColor ?? 'hsl(var(--primary))' }}
        />
      </div>
    </div>
  );
};

// ── Sensor sparkline chart ──
interface SensorChartProps {
  timeSeries: Array<{ date: string; temperature: number | null; co2: number | null; humidity: number | null; occupancy: number | null }>;
  isLive: boolean;
}

const SensorChart: React.FC<SensorChartProps> = ({ timeSeries, isLive }) => {
  const [activeLines, setActiveLines] = useState({ temperature: true, co2: true, humidity: false });

  const lines = [
    { key: 'temperature' as const, label: 'Temp (°C)',  color: '#22c55e' },
    { key: 'co2'         as const, label: 'CO₂ (ppm)', color: '#60a5fa' },
    { key: 'humidity'    as const, label: 'Fukt (%)',   color: '#a78bfa' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {lines.map(l => (
          <button
            key={l.key}
            onClick={() => setActiveLines(prev => ({ ...prev, [l.key]: !prev[l.key] }))}
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
              activeLines[l.key]
                ? 'border-transparent text-background'
                : 'border-border text-muted-foreground bg-transparent'
            )}
            style={activeLines[l.key] ? { backgroundColor: l.color } : {}}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={timeSeries} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tickFormatter={d => d?.slice(5) ?? ''}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: 12,
              }}
              labelStyle={{ color: 'hsl(var(--foreground))' }}
            />
            {lines.map(l =>
              activeLines[l.key] ? (
                <Line
                  key={l.key}
                  type="monotone"
                  dataKey={l.key}
                  stroke={l.color}
                  strokeWidth={isLive ? 2.5 : 1.5}
                  strokeDasharray={isLive ? '0' : '4 2'}
                  dot={false}
                  connectNulls
                />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ── Main Sheet component ──
const RoomSensorDetailSheet: React.FC<RoomSensorDetailSheetProps> = ({
  open, onClose, roomFmGuid, roomName,
}) => {
  const { data, isLoading, isLive, error } = useSenslincData(open ? roomFmGuid : null);

  const displayName = data?.machineName || roomName || 'Rum';
  const dashboardUrl = data?.dashboardUrl || '';

  return (
    <Sheet open={open} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col p-0 gap-0"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gradient-to-r from-card via-card to-primary/5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="text-sm font-semibold truncate leading-tight">{displayName}</SheetTitle>
              </SheetHeader>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-muted-foreground">Senslinc IoT</span>
                {data?.machinePk ? (
                  <span className="text-xs text-muted-foreground">· #{data.machinePk}</span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <StatusBadge isLive={isLive} isLoading={isLoading} />
            {dashboardUrl && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-primary/10"
                onClick={() => window.open(dashboardUrl, '_blank')}
                title="Öppna i Senslinc"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Gauge cards 2×2 */}
          <div className="grid grid-cols-2 gap-2.5">
            <GaugeCard
              label="Temperatur"
              value={data?.current.temperature ?? null}
              unit="°C"
              icon={Thermometer}
              type="temperature"
              isLoading={isLoading}
            />
            <GaugeCard
              label="CO₂"
              value={data?.current.co2 ?? null}
              unit="ppm"
              icon={Wind}
              type="co2"
              isLoading={isLoading}
            />
            <GaugeCard
              label="Luftfuktighet"
              value={data?.current.humidity ?? null}
              unit="%"
              icon={Droplets}
              type="humidity"
              isLoading={isLoading}
            />
            <GaugeCard
              label="Beläggning"
              value={data?.current.occupancy ?? null}
              unit="%"
              icon={Users}
              type="occupancy"
              isLoading={isLoading}
            />
          </div>

          {/* 7-day trend */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground mb-3">Senaste 7 dagarna</p>
            {isLoading ? (
              <div className="h-44 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : data ? (
              <SensorChart timeSeries={data.timeSeries} isLive={isLive} />
            ) : null}
          </div>

          {/* Status row */}
          {!isLoading && error && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-purple-500/20 px-3 py-2 bg-purple-500/5">
              <WifiOff className="h-3.5 w-3.5 shrink-0 text-purple-400" />
              <span>Ingen live-koppling – visar demodata.</span>
            </div>
          )}
          {!isLoading && isLive && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-green-500/20 px-3 py-2 bg-green-500/5">
              <Wifi className="h-3.5 w-3.5 shrink-0 text-green-400" />
              <span>Live-data från Senslinc · Maskin #{data?.machinePk}</span>
            </div>
          )}

          {/* External link footer */}
          {dashboardUrl && (
            <Button
              variant="outline"
              className="w-full gap-2 text-xs"
              onClick={() => window.open(dashboardUrl, '_blank')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Öppna fullständig Senslinc-dashboard
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default RoomSensorDetailSheet;
