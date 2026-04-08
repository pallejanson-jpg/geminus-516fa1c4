import React, { useContext, useState, useMemo } from 'react';
import { AppContext } from '@/context/AppContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Thermometer, Wind, Droplets, Users, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useSenslincBuildingData } from '@/hooks/useSenslincData';
import {
  getVisualizationColor, rgbToHex, generateMockSensorData, VISUALIZATION_CONFIGS,
  VisualizationType,
} from '@/lib/visualization-utils';
import { cn } from '@/lib/utils';
import RoomSensorDetailSheet from '@/components/insights/RoomSensorDetailSheet';

// ── Sensor metric types shown in this tab ──
const METRICS = [
  { key: 'temperature' as VisualizationType, label: 'Temperature', unit: '°C', icon: Thermometer, color: '#22c55e' },
  { key: 'co2'         as VisualizationType, label: 'CO₂',         unit: 'ppm', icon: Wind,        color: '#60a5fa' },
  { key: 'humidity'    as VisualizationType, label: 'Humidity',    unit: '%',   icon: Droplets,    color: '#a78bfa' },
  { key: 'occupancy'   as VisualizationType, label: 'Occupancy',  unit: '%',   icon: Users,       color: '#f97316' },
] as const;

// ── Status badge ──
const LiveBadge = ({ isLive, isLoading }: { isLive: boolean; isLoading: boolean }) => {
  if (isLoading) return (
    <Badge variant="outline" className="text-[9px] gap-1 border-muted-foreground/40 text-muted-foreground">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Loading…
    </Badge>
  );
  if (isLive) return (
    <Badge variant="outline" className="text-[9px] gap-1 border-green-500/50 text-green-400 bg-green-500/10">
      <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse inline-block" />LIVE
    </Badge>
  );
  return null;
};

// ── Room grid card — clickable ──
interface RoomCardProps {
  name: string;
  value: number | null;
  metric: VisualizationType;
  unit: string;
  onClick?: () => void;
}

const RoomCard: React.FC<RoomCardProps> = ({ name, value, metric, unit, onClick }) => {
  const rgb = value !== null ? getVisualizationColor(value, metric) : null;
  const hex = rgb ? rgbToHex(rgb) : undefined;
  return (
    <div
      className={cn(
        'rounded-lg border text-center p-2.5 transition-all duration-200',
        onClick ? 'cursor-pointer hover:scale-105 hover:shadow-md active:scale-95' : ''
      )}
      style={{
        backgroundColor: hex ? hex + '22' : undefined,
        borderColor: hex ? hex + '55' : undefined,
      }}
      onClick={onClick}
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

// ── Aggregate trend chart ──
interface BuildingTrendChartProps {
  rooms: Array<{ fmGuid: string; commonName?: string; name?: string }>;
  liveMachineMap: Map<string, any>;
  isLive: boolean;
  metric: VisualizationType;
}

const BuildingTrendChart: React.FC<BuildingTrendChartProps> = ({ rooms, liveMachineMap, isLive, metric }) => {
  const chartData = useMemo(() => {
    const days = 7;
    const now = new Date();
    const points: Array<{ date: string; value: number | null; count: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      points.push({ date: d.toISOString().substring(0, 10), value: null, count: 0 });
    }

    rooms.slice(0, 30).forEach(room => {
      const mockVal = generateMockSensorData(room.fmGuid, metric);
      if (mockVal === null) return;
      points.forEach((pt, idx) => {
        const seed = ((room.fmGuid.charCodeAt(idx % room.fmGuid.length) ?? 65) * (idx + 1) * 17) % 100 / 100;
        const variation = (seed - 0.5) * 2;
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
            formatter={(v: number) => [`${v} ${config.unit}`, `Avg ${config.label}`]}
          />
          <Line
            type="monotone"
            dataKey="avg"
            stroke={metricDef?.color ?? 'hsl(var(--primary))'}
            strokeWidth={isLive ? 2 : 1.5}
            strokeDasharray={isLive ? '0' : '4 2'}
            dot={false}
            connectNulls
            name={`Avg ${config.label}`}
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
  const [selectedBuildingGuid, setSelectedBuildingGuid] = useState<string | null>(null);

  // Room detail sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetRoom, setSheetRoom] = useState<{ fmGuid: string; name: string } | null>(null);

  // All available buildings
  const buildings = useMemo(() => navigatorTreeData.filter(
    (n: any) => n.category === 'Building' || !n.category
  ), [navigatorTreeData]);

  // Pick active building: explicit selection > selectedFacility > first
  const building = useMemo(() => {
    if (selectedBuildingGuid) {
      return buildings.find((b: any) => b.fmGuid === selectedBuildingGuid) ?? buildings[0] ?? null;
    }
    if (selectedFacility?.category === 'Building') return selectedFacility;
    return buildings[0] ?? null;
  }, [selectedBuildingGuid, selectedFacility, buildings]);

  const { data: buildingData, isLoading, isLive, error } = useSenslincBuildingData(
    building?.fmGuid ?? null
  );

  // Flatten rooms from tree
  const rooms = useMemo(() => {
    if (!building) return [];
    const result: Array<{ fmGuid: string; commonName?: string; name?: string }> = [];
    building.children?.forEach((storey: NavigatorNode) => {
      storey.children?.forEach((space: NavigatorNode) => {
        result.push({ fmGuid: space.fmGuid, commonName: space.commonName, name: space.name });
      });
    });
    return result.slice(0, 60);
  }, [building]);

  // Map machine code → latest_values (for live rooms)
  const liveMachineMap = useMemo(() => {
    const m = new Map<string, any>();
    buildingData?.machines.forEach(machine => {
      if (machine.code) m.set(machine.code, machine.latest_values);
    });
    return m;
  }, [buildingData]);

  const metricDef = METRICS.find(m => m.key === selectedMetric)!;

  const roomValues = useMemo(() => {
    return rooms.map(room => {
      const live = liveMachineMap.get(room.fmGuid);
      const value = live?.[selectedMetric] ?? generateMockSensorData(room.fmGuid, selectedMetric);
      return { ...room, value };
    });
  }, [rooms, liveMachineMap, selectedMetric]);

  // Building aggregate KPI
  const buildingAvg = useMemo(() => {
    const vals = roomValues.filter(r => r.value !== null).map(r => r.value as number);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }, [roomValues]);

  const avgRgb = buildingAvg !== null ? getVisualizationColor(buildingAvg, selectedMetric) : null;
  const avgHex = avgRgb ? rgbToHex(avgRgb) : undefined;

  const handleRoomClick = (room: { fmGuid: string; commonName?: string; name?: string }) => {
    setSheetRoom({ fmGuid: room.fmGuid, name: room.commonName || room.name || room.fmGuid });
    setSheetOpen(true);
    // Select only this room in the 3D viewer
    window.dispatchEvent(new CustomEvent('VIEWER_SELECT_ENTITY', { detail: { entityId: room.fmGuid, fmGuid: room.fmGuid, entityName: room.commonName || room.name || null } }));
  };

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Building selector (only when multiple buildings) */}
          {buildings.length > 1 ? (
            <Select
              value={building?.fmGuid ?? ''}
              onValueChange={val => setSelectedBuildingGuid(val)}
            >
              <SelectTrigger className="h-7 text-xs w-44">
                <SelectValue placeholder="Select building" />
              </SelectTrigger>
              <SelectContent>
                {buildings.map((b: any) => (
                  <SelectItem key={b.fmGuid} value={b.fmGuid} className="text-xs">
                    {b.commonName || b.name || b.fmGuid}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <h3 className="text-sm font-medium truncate">{building?.commonName || building?.name || 'Sensors'}</h3>
          )}
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
            title="Refresh"
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
            <span className="text-2xl font-bold" style={{ color: avgHex }}>{buildingAvg}</span>
            <span className="text-sm text-muted-foreground ml-1">{metricDef.unit}</span>
          </div>
           <div className="text-xs text-muted-foreground">
             Avg {metricDef.label} · {roomValues.length} rooms
          </div>
        </div>
      )}

      {/* Trend chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <metricDef.icon className="h-4 w-4" style={{ color: metricDef.color }} />
            Trend Chart – {metricDef.label}
          </CardTitle>
          <CardDescription>Daily average, last 7 days</CardDescription>
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

      {/* Room heatmap grid — klickbara rum */}
      <Card>
        <CardHeader className="pb-2">
           <CardTitle className="text-sm">Room Heatmap – {metricDef.label}</CardTitle>
           <CardDescription>
             {rooms.length} rooms · click a room for sensor details
           </CardDescription>
        </CardHeader>
        <CardContent>
          {rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No rooms found</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-1.5">
              {roomValues.map(room => (
                <RoomCard
                  key={room.fmGuid}
                  name={room.commonName || room.name || room.fmGuid.substring(0, 6)}
                  value={room.value}
                  metric={selectedMetric}
                  unit={metricDef.unit}
                  onClick={() => handleRoomClick(room)}
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
          <span>No live connection to Senslinc for this building.</span>
        </div>
      )}
      {!isLoading && isLive && buildingData && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border border-green-500/30 px-3 py-2 bg-green-500/5">
          <Wifi className="h-3.5 w-3.5 shrink-0 text-green-400" />
          <span>Live data from Senslinc · Site: {buildingData.siteName} · {buildingData.machines.length} sensors</span>
        </div>
      )}

      {/* Room detail sheet */}
      <RoomSensorDetailSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        roomFmGuid={sheetRoom?.fmGuid ?? null}
        roomName={sheetRoom?.name}
      />
    </div>
  );
}
