import React, { useState, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Zap, ExternalLink, Thermometer, Wind, Droplets, Users, Wifi, WifiOff, Sun, Info, Building2 } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useSenslincData } from '@/hooks/useSenslincData';
import { VISUALIZATION_CONFIGS, getVisualizationColor, rgbToHex, type VisualizationType } from '@/lib/visualization-utils';
import { cn } from '@/lib/utils';

interface RoomSensorDetailSheetProps {
  open: boolean;
  onClose: () => void;
  roomFmGuid: string | null;
  roomName?: string;
}

// ── Air Quality Score calculation ──
function calculateAirQualityScore(current: { temperature: number | null; co2: number | null; humidity: number | null }): { score: number; label: string; color: string } {
  let total = 0;
  let count = 0;

  // Temperature: ideal 20-22, acceptable 18-24
  if (current.temperature !== null) {
    const t = current.temperature;
    if (t >= 20 && t <= 22) total += 100;
    else if (t >= 18 && t <= 24) total += 70;
    else if (t >= 16 && t <= 26) total += 40;
    else total += 10;
    count++;
  }

  // CO2: ideal <600, acceptable <1000
  if (current.co2 !== null) {
    const c = current.co2;
    if (c <= 600) total += 100;
    else if (c <= 800) total += 80;
    else if (c <= 1000) total += 60;
    else if (c <= 1500) total += 30;
    else total += 10;
    count++;
  }

  // Humidity: ideal 40-60, acceptable 30-70
  if (current.humidity !== null) {
    const h = current.humidity;
    if (h >= 40 && h <= 60) total += 100;
    else if (h >= 30 && h <= 70) total += 70;
    else total += 30;
    count++;
  }

  if (count === 0) return { score: 0, label: 'Unknown', color: 'hsl(var(--muted-foreground))' };

  const score = Math.round(total / count);
  if (score >= 80) return { score, label: 'Excellent', color: 'hsl(var(--chart-3))' };
  if (score >= 60) return { score, label: 'Good', color: 'hsl(var(--chart-8))' };
  if (score >= 40) return { score, label: 'Acceptable', color: 'hsl(var(--chart-4))' };
  return { score, label: 'Poor', color: 'hsl(var(--chart-5))' };
}

// ── Comfort explanation ──
function getComfortExplanation(current: { temperature: number | null; co2: number | null; humidity: number | null; light: number | null }): string[] {
  const tips: string[] = [];
  if (current.temperature !== null) {
    if (current.temperature < 18) tips.push('🥶 Temperature is below the comfort threshold (18°C). Consider increasing heating.');
    else if (current.temperature > 24) tips.push('🌡️ Temperature is high (>24°C). Ventilation or cooling is recommended.');
    else tips.push('✅ Temperature is within the comfort zone (18–24°C).');
  }
  if (current.co2 !== null) {
    if (current.co2 > 1000) tips.push('⚠️ CO₂ level is high (>1000 ppm). Increase ventilation for better air quality.');
    else if (current.co2 > 800) tips.push('🔔 CO₂ level is getting high. Consider ventilating.');
    else tips.push('✅ CO₂ level is good (<800 ppm).');
  }
  if (current.humidity !== null) {
    if (current.humidity < 30) tips.push('💨 Humidity is low (<30%). May cause dryness.');
    else if (current.humidity > 70) tips.push('💧 Humidity is high (>70%). Risk of mold.');
    else tips.push('✅ Humidity is within the comfort zone (30–70%).');
  }
  if (current.light !== null) {
    if (current.light < 100) tips.push('🌙 Lighting is dim (<100 lux). May affect productivity.');
    else if (current.light > 1000) tips.push('☀️ Strong light (>1000 lux). Check for glare.');
    else tips.push('✅ Lighting is at a comfortable level.');
  }
  return tips;
}

// ── Status badge ──
const StatusBadge = ({ isLive, isLoading }: { isLive: boolean; isLoading: boolean }) => {
  if (isLoading) return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-muted-foreground/40 text-muted-foreground">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Loading…
    </Badge>
  );
  if (isLive) return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-green-500/50 text-green-400 bg-green-500/10">
      <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse inline-block" />LIVE
    </Badge>
  );
  return null;
};

// ── Gauge card ──
interface GaugeCardProps {
  label: string;
  value: number | null;
  unit: string;
  icon: React.ElementType;
  type: VisualizationType;
  isLoading?: boolean;
}

const GaugeCard: React.FC<GaugeCardProps> = ({ label, value, unit, icon: Icon, type, isLoading }) => {
  const config = VISUALIZATION_CONFIGS[type];
  if (!config || config.colorStops.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="text-lg text-muted-foreground">—</div>
      </div>
    );
  }
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
const SensorChart: React.FC<{
  timeSeries: Array<{ date: string; temperature: number | null; co2: number | null; humidity: number | null; occupancy: number | null; light: number | null }>;
  isLive: boolean;
  availableFields: string[];
}> = ({ timeSeries, isLive, availableFields }) => {
  const allLines = [
    { key: 'temperature' as const, label: 'Temp (°C)',    color: 'hsl(var(--chart-3))' },
    { key: 'co2'         as const, label: 'CO₂ (ppm)',   color: 'hsl(var(--chart-2))' },
    { key: 'humidity'    as const, label: 'Humidity (%)',  color: 'hsl(var(--chart-7))' },
    { key: 'light'       as const, label: 'Light (lux)',   color: 'hsl(var(--chart-4))' },
    { key: 'occupancy'   as const, label: 'Occup. (%)',   color: 'hsl(var(--chart-5))' },
  ];

  const lines = allLines.filter(l => availableFields.includes(l.key));
  const [activeLines, setActiveLines] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    lines.forEach((l, i) => { init[l.key] = i < 3; }); // show first 3 by default
    return init;
  });

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

  const displayName = roomName || data?.machineName || 'Room';
  const machineLabel = data?.machineLabel || data?.machineName;
  const dashboardUrl = data?.dashboardUrl || '';

  const airQuality = useMemo(() => {
    if (!data?.current) return null;
    return calculateAirQualityScore(data.current);
  }, [data?.current]);

  const comfortTips = useMemo(() => {
    if (!data?.current) return [];
    return getComfortExplanation(data.current);
  }, [data?.current]);

  return (
    <Sheet open={open} onOpenChange={open => !open && onClose()} modal={false}>
      <SheetContent
        side="left"
        className="w-full sm:max-w-md flex flex-col p-0 gap-0 shadow-2xl"
        onInteractOutside={(e) => e.preventDefault()}
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
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {machineLabel && machineLabel !== displayName && (
                  <span className="text-xs text-muted-foreground">{machineLabel}</span>
                )}
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
                title="Open in Senslinc"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Air Quality Score */}
          {!isLoading && airQuality && airQuality.score > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
              <div
                className="h-16 w-16 rounded-full flex items-center justify-center text-2xl font-bold shrink-0"
                style={{
                  background: `conic-gradient(${airQuality.color} ${airQuality.score * 3.6}deg, hsl(var(--muted)) 0deg)`,
                  color: airQuality.color,
                }}
              >
                <div className="h-12 w-12 rounded-full bg-card flex items-center justify-center">
                  {airQuality.score}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: airQuality.color }}>
                  {airQuality.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Air Quality Score based on temperature, CO₂ and humidity
                </p>
              </div>
            </div>
          )}

          {/* Gauge cards – 5 cards in responsive grid */}
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
              label="Belysning"
              value={data?.current.light ?? null}
              unit="lux"
              icon={Sun}
              type="light"
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
            <p className="text-xs font-medium text-muted-foreground mb-3">Last 7 days</p>
            {isLoading ? (
              <div className="h-44 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : data ? (
              <SensorChart
                timeSeries={data.timeSeries}
                isLive={isLive}
                availableFields={data.availableFields}
              />
            ) : null}
          </div>

          {/* Comfort Explanation */}
          {!isLoading && comfortTips.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                Comfort Explanation
              </div>
              <div className="space-y-1.5">
                {comfortTips.map((tip, i) => (
                  <p key={i} className="text-xs text-foreground/80 leading-relaxed">{tip}</p>
                ))}
              </div>
            </div>
          )}

          {/* Machine info */}
          {!isLoading && data && (data.siteName || data.lineName) && (
            <div className="rounded-xl border border-border bg-card p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                Maskininfo
              </div>
              {data.siteName && (
                <p className="text-xs text-foreground/70">Site: {data.siteName}</p>
              )}
              {data.lineName && (
                <p className="text-xs text-foreground/70">Linje: {data.lineName}</p>
              )}
              {data.machinePk > 0 && (
                <p className="text-xs text-foreground/70">Maskin PK: {data.machinePk}</p>
              )}
            </div>
          )}

          {/* Status row */}
          {!isLoading && isLive && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-green-500/20 px-3 py-2 bg-green-500/5">
              <Wifi className="h-3.5 w-3.5 shrink-0 text-green-400" />
              <span>Live data from Senslinc · Machine #{data?.machinePk}</span>
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
              Open full Senslinc dashboard
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default RoomSensorDetailSheet;
