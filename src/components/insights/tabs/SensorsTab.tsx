import React, { useContext, useState, useMemo } from 'react';
import { AppContext } from '@/context/AppContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Thermometer, Wind, Droplets, Users, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useSenslincBuildingData } from '@/hooks/useSenslincData';
import {
  getVisualizationColor, rgbToHex, generateMockSensorData, VISUALIZATION_CONFIGS,
  VisualizationType,
} from '@/lib/visualization-utils';
import { cn } from '@/lib/utils';

// ── Sensor metric types shown in this tab ──
const METRICS = [
  { key: 'temperature' as VisualizationType, label: 'Temperatur', unit: '°C', icon: Thermometer, color: '#22c55e' },
  { key: 'co2'         as VisualizationType, label: 'CO₂',        unit: 'ppm', icon: Wind,        color: '#60a5fa' },
  { key: 'humidity'    as VisualizationType, label: 'Luftfukt',   unit: '%',   icon: Droplets,    color: '#a78bfa' },
  { key: 'occupancy'   as VisualizationType, label: 'Beläggning', unit: '%',   icon: Users,       color: '#f97316' },
] as const;

// ── Status badge ──
const LiveBadge = ({ isLive, isLoading }: { isLive: boolean; isLoading: boolean }) => {
  if (isLoading) return (
    <Badge variant="outline" className="text-[9px] gap-1 border-muted-foreground/40 text-muted-foreground">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Laddar…
    </Badge>
  );
  if (isLive) return (
    <Badge variant="outline" className="text-[9px] gap-1 border-green-500/50 text-green-400 bg-green-500/10">
      <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse inline-block" />LIVE
    </Badge>
  );
  return null;
};

// ── Room grid card ──
interface RoomCardProps {
  name: string;
  value: number | null;
  metric: VisualizationType;
  unit: string;
}

const RoomCard: React.FC<RoomCardProps> = ({ name, value, metric, unit }) => {
  const rgb = value !== null ? getVisualizationColor(value, metric) : null;
  const hex = rgb ? rgbToHex(rgb) : undefined;
  return (
    <div
      className="rounded border border-border text-center p-2 transition-all duration-300"
      style={{ backgroundColor: hex ? hex + '22' : undefined, borderColor: hex ? hex + '55' : undefined }}
    >
      <div className="text-[10px] text-muted-foreground truncate mb-0.5">{name}</div>
      <div
        className="text-base font-bold leading-none"
        style={{ color: hex ?? 'hsl(var(--foreground))' }}
      >
        {value !== null ? value.toFixed(1) : '—'}
      </div>
      <div className="text-[9px] text-muted-foreground">{unit}</div>
    </div>
  );
};

// ── Aggregate trend chart for whole building ──
interface BuildingTrendChartProps {
  rooms: Array<{ fmGuid: string; commonName?: string; name?: string }>;
  liveMachineMap: Map<string, any>;
  isLive: boolean;
  metric: VisualizationType;
}

const BuildingTrendChart: React.FC<BuildingTrendChartProps> = ({ rooms, liveMachineMap, isLive, metric }) => {
  // Build a 7-day average across all machines (if live) or mock rooms
  const chartData = useMemo(() => {
    const days = 7;
    const now = new Date();
    const points: Array<{ date: string; value: number | null; count: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      points.push({ date: d.toISOString().substring(0, 10), value: null, count: 0 });
    }

    // Aggregate mock sensor values per room per day
    rooms.slice(0, 30).forEach(room => {
      const mockVal = generateMockSensorData(room.fmGuid, metric);
      if (mockVal === null) return;
      points.forEach((pt, idx) => {
        // Add slight daily variation
        const seed = ((room.fmGuid.charCodeAt(idx % room.fmGuid.length) ?? 65) * (idx + 1) * 17) % 100 / 100;
        const variation = (seed - 0.5) * 2; // -1 to +1
        pt.value = (pt.value ?? 0) + mockVal + variation;
        pt.count++;
      });
    });

    return points.map(pt => ({
      date: pt.date.slice(5),
      avg: pt.count > 0 ? Math.round((pt.value! / pt.count) * 10) / 10 : null,
    }));
  }, [rooms, metric]);

  const config = VISUALIZATION_CONFIGS[metric];
  const metricDef = METRICS.find(m => m.key === metric);

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis
            domain={[config.min, config.max]}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: 12,
            }}
            formatter={(v: number) => [`${v} ${config.unit}`, `Snitt ${config.label}`]}
          />
          <Line
            type="monotone"
            dataKey="avg"
            stroke={metricDef?.color ?? 'hsl(var(--primary))'}
            strokeWidth={isLive ? 2 : 1.5}
            strokeDasharray={isLive ? '0' : '4 2'}
            dot={false}
            connectNulls
            name={`Snitt ${config.label}`}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

// ── Main tab component ──
export default function SensorsTab() {
  const { navigatorTreeData, selectedFacility } = useContext(AppContext);
  const [selectedMetric, setSelectedMetric] = useState<VisualizationType>('temperature');
  const [refreshKey, setRefreshKey] = useState(0);

  // Pick building: selectedFacility or first in tree
  const building = useMemo(() => {
    if (selectedFacility?.category === 'Building') return selectedFacility;
    return navigatorTreeData[0] ?? null;
  }, [selectedFacility, navigatorTreeData]);

  const { data: buildingData, isLoading, isLive, error } = useSenslincBuildingData(
    building?.fmGuid ?? null
  );

  // Flatten rooms from tree
  const rooms = useMemo(() => {
    if (!building) return [];
    const result: Array<{ fmGuid: string; commonName?: string; name?: string }> = [];
    building.children?.forEach((storey: any) => {
      storey.children?.forEach((space: any) => {
        result.push({ fmGuid: space.fmGuid, commonName: space.commonName, name: space.name });
      });
    });
    return result.slice(0, 60); // cap for perf
  }, [building]);

  // Map machine code → latest_values (for live rooms)
  const liveMachineMap = useMemo(() => {
    const m = new Map<string, any>();
    buildingData?.machines.forEach(machine => {
      if (machine.code) m.set(machine.code, machine.latest_values);
    });
    return m;
  }, [buildingData]);

  // Get value per room (live if available, else mock)
  const metricDef = METRICS.find(m => m.key === selectedMetric)!;

  const roomValues = useMemo(() => {
    return rooms.map(room => {
      const live = liveMachineMap.get(room.fmGuid);
      const value = live?.[selectedMetric] ?? generateMockSensorData(room.fmGuid, selectedMetric);
      return { ...room, value };
    });
  }, [rooms, liveMachineMap, selectedMetric]);

  // Building aggregate
  const buildingAvg = useMemo(() => {
    const vals = roomValues.filter(r => r.value !== null).map(r => r.value as number);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }, [roomValues]);

  const avgRgb = buildingAvg !== null ? getVisualizationColor(buildingAvg, selectedMetric) : null;
  const avgHex = avgRgb ? rgbToHex(avgRgb) : undefined;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{building?.commonName || building?.name || 'Sensorer'}</h3>
          <LiveBadge isLive={isLive} isLoading={isLoading} />
        </div>
        <div className="flex items-center gap-2">
          {/* Metric selector */}
          <div className="flex gap-1">
            {METRICS.map(m => (
              <Button
                key={m.key}
                size="sm"
                variant={selectedMetric === m.key ? 'default' : 'outline'}
                className="h-7 px-2 text-[10px] gap-1"
                onClick={() => setSelectedMetric(m.key)}
              >
                <m.icon className="h-3 w-3" />
                {m.label}
              </Button>
            ))}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setRefreshKey(k => k + 1)}
            title="Uppdatera"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Building KPI */}
      {buildingAvg !== null && (
        <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-2 bg-card">
          <metricDef.icon className="h-5 w-5" style={{ color: avgHex }} />
          <div>
            <span className="text-2xl font-bold" style={{ color: avgHex }}>
              {buildingAvg}
            </span>
            <span className="text-sm text-muted-foreground ml-1">{metricDef.unit}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Snitt {metricDef.label} · {roomValues.length} rum
          </div>
        </div>
      )}

      {/* Trend chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <metricDef.icon className="h-4 w-4" style={{ color: metricDef.color }} />
            Trendgraf – {metricDef.label}
          </CardTitle>
          <CardDescription>Dagligt snitt, senaste 7 dagar</CardDescription>
        </CardHeader>
        <CardContent>
          <BuildingTrendChart
            rooms={rooms}
            liveMachineMap={liveMachineMap}
            isLive={isLive}
            metric={selectedMetric}
          />
        </CardContent>
      </Card>

      {/* Room heatmap grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Rumsheatmap – {metricDef.label}
          </CardTitle>
          <CardDescription>
            {rooms.length} rum · färgas efter sensor-värde
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Inga rum hittades</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-1.5">
              {roomValues.map(room => (
                <RoomCard
                  key={room.fmGuid}
                  name={room.commonName || room.name || room.fmGuid.substring(0, 6)}
                  value={room.value}
                  metric={selectedMetric}
                  unit={metricDef.unit}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status info */}
      {!isLoading && error && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border border-border px-3 py-2 bg-muted/30">
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-destructive" />
          <span>Ingen live-koppling till Senslinc för denna byggnad.</span>
        </div>
      )}
      {!isLoading && isLive && buildingData && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border border-green-500/30 px-3 py-2 bg-green-500/5">
          <Wifi className="h-3.5 w-3.5 shrink-0 text-green-400" />
          <span>Live-data från Senslinc · Site: {buildingData.siteName} · {buildingData.machines.length} sensorer</span>
        </div>
      )}
    </div>
  );
}
