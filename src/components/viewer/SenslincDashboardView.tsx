import React, { useContext, useState } from 'react';
import { X, ExternalLink, Zap, RefreshCw, Loader2, Wifi, WifiOff, Thermometer, Wind, Droplets, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { AppContext } from '@/context/AppContext';
import { cn } from '@/lib/utils';
import { useSenslincData } from '@/hooks/useSenslincData';
import { VISUALIZATION_CONFIGS, getVisualizationColor, rgbToHex } from '@/lib/visualization-utils';

interface SenslincDashboardViewProps {
  onClose: () => void;
}

// ── Live / Demo status badge ──
const StatusBadge = ({ isLive, isLoading }: { isLive: boolean; isLoading: boolean }) => {
  if (isLoading) return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-muted-foreground/40 text-muted-foreground">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Laddar…
    </Badge>
  );
  if (isLive) return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-green-500/50 text-green-400 bg-green-500/10">
      <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />LIVE
    </Badge>
  );
  return null;
};

// ── Single sensor gauge card ──
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
    <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs">{label}</span>
        </div>
        {hexColor && (
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: hexColor }} />
        )}
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
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: hexColor ?? 'hsl(var(--primary))',
          }}
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
  const [activeLines, setActiveLines] = useState({
    temperature: true,
    co2: true,
    humidity: false,
  });

  const lines = [
    { key: 'temperature', label: 'Temp (°C)', color: '#22c55e', strokeDash: isLive ? '0' : '4 2' },
    { key: 'co2',         label: 'CO₂ (ppm)', color: '#60a5fa', strokeDash: isLive ? '0' : '4 2' },
    { key: 'humidity',    label: 'Fukt (%)',   color: '#a78bfa', strokeDash: isLive ? '0' : '4 2' },
  ] as const;

  return (
    <div className="space-y-2">
      {/* Toggle buttons */}
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

      <div className="h-40">
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
                  strokeWidth={isLive ? 2 : 1.5}
                  strokeDasharray={l.strokeDash}
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

// ── Main component ──
const SenslincDashboardView: React.FC<SenslincDashboardViewProps> = ({ onClose }) => {
  const { senslincDashboardContext } = useContext(AppContext);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('sensor');

  const facilityFmGuid = senslincDashboardContext?.facilityFmGuid ?? null;
  const facilityName = senslincDashboardContext?.facilityName || 'IoT Dashboard';

  const { data, isLoading, isLive, error } = useSenslincData(facilityFmGuid);

  // Prefer live dashboard URL from hook, fallback to context
  const dashboardUrl = data?.dashboardUrl || senslincDashboardContext?.dashboardUrl || '';

  const handleOpenExternal = () => {
    if (dashboardUrl) window.open(dashboardUrl, '_blank');
  };

  const handleRefreshIframe = () => {
    setIframeLoading(true);
    const iframe = document.getElementById('senslinc-iframe') as HTMLIFrameElement;
    if (iframe) iframe.src = iframe.src;
  };

  if (!facilityFmGuid && !senslincDashboardContext?.dashboardUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background p-8">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-6">
          <Zap className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Ingen IoT-dashboard</h2>
        <p className="text-muted-foreground text-center max-w-md mb-6">
          Det finns ingen sensor-dashboard konfigurerad för detta objekt. Kontrollera att
          sensorDashboard-attributet är satt i Asset+, eller att objektet är kopplat till Senslinc via FM GUID.
        </p>
        <Button onClick={onClose} variant="outline" className="gap-2">
          <X className="h-4 w-4" />Stäng
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* ── Header ── */}
      <div className={cn(
        'flex items-center justify-between px-4 py-3 border-b shrink-0',
        'bg-gradient-to-r from-card via-card to-primary/5'
      )}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-sm truncate">{data?.machineName || facilityName}</h2>
              <StatusBadge isLive={isLive} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground">Senslinc IoT</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {dashboardUrl && (
            <Button variant="ghost" size="icon" onClick={handleOpenExternal} title="Öppna i ny flik" className="h-8 w-8 hover:bg-primary/10">
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} title="Stäng" className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-3 shrink-0">
          <TabsList className="h-8 p-0.5 gap-0.5">
            <TabsTrigger value="sensor" className="text-xs px-3 py-1">Sensordata</TabsTrigger>
            {dashboardUrl && (
              <TabsTrigger value="dashboard" className="text-xs px-3 py-1">Dashboard</TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* ── Sensordata Tab ── */}
        <TabsContent value="sensor" className="flex-1 overflow-y-auto px-4 pb-4 mt-3 space-y-4">
          {/* Gauge cards */}
          <div className="grid grid-cols-2 gap-2">
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
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground">Senaste 7 dagarna</h3>
            </div>
            {isLoading ? (
              <div className="h-40 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : data ? (
              <SensorChart timeSeries={data.timeSeries} isLive={isLive} />
            ) : null}
          </div>

          {/* Info row */}
          {!isLoading && error && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border border-border px-3 py-2 bg-muted/30">
              <WifiOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>Ingen live-koppling till Senslinc.</span>
            </div>
          )}
          {!isLoading && isLive && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border border-green-500/30 px-3 py-2 bg-green-500/5">
              <Wifi className="h-3.5 w-3.5 shrink-0 text-green-400" />
              <span>Live-data från Senslinc · Maskin: {data?.machinePk}</span>
            </div>
          )}
        </TabsContent>

        {/* ── Dashboard (iframe) Tab ── */}
        {dashboardUrl && (
          <TabsContent value="dashboard" className="flex-1 relative mt-0 data-[state=inactive]:hidden">
            <div className="absolute inset-0">
              {iframeLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                  <span className="text-sm text-muted-foreground">Laddar Senslinc-dashboard…</span>
                </div>
              )}
              <div className="absolute top-2 right-2 z-20 flex gap-1">
                <Button variant="ghost" size="icon" onClick={handleRefreshIframe} title="Uppdatera" className="h-7 w-7 bg-card/80 hover:bg-card">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <iframe
                id="senslinc-iframe"
                src={dashboardUrl}
                className="w-full h-full border-0"
                title="Senslinc Dashboard"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                loading="lazy"
                onLoad={() => setIframeLoading(false)}
              />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default SenslincDashboardView;
