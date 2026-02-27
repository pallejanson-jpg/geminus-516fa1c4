import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileQuestion, GripHorizontal, X, Minimize2, Maximize2, Move, Loader2, ExternalLink, Building2, Layers, DoorOpen, Thermometer, Wind, Droplets, Users, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getIleanSettings, saveIleanSettings } from '@/components/settings/IleanSettings';
import { useIleanData } from '@/hooks/useIleanData';
import { VISUALIZATION_CONFIGS, getVisualizationColor, rgbToHex } from '@/lib/visualization-utils';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from 'recharts';

const BUTTON_SIZE = 56;

// ── Gauge card (reused from SenslincDashboardView pattern) ──
interface GaugeProps {
  label: string;
  value: number | null;
  unit: string;
  icon: React.ElementType;
  type: 'temperature' | 'co2' | 'humidity' | 'occupancy';
}

const MiniGauge: React.FC<GaugeProps> = ({ label, value, unit, icon: Icon, type }) => {
  const config = VISUALIZATION_CONFIGS[type];
  const rgb = value !== null ? getVisualizationColor(value, type) : null;
  const hexColor = rgb ? rgbToHex(rgb) : undefined;
  const pct = value !== null
    ? Math.max(0, Math.min(100, ((value - config.min) / (config.max - config.min)) * 100))
    : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="text-[10px]">{label}</span>
      </div>
      <div className="text-lg font-bold tabular-nums leading-none" style={{ color: hexColor ?? 'hsl(var(--foreground))' }}>
        {value !== null ? (
          <>{type === 'occupancy' ? Math.round(value) : value.toFixed(1)}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">{unit}</span></>
        ) : <span className="text-muted-foreground text-sm">—</span>}
      </div>
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: hexColor ?? 'hsl(var(--primary))' }} />
      </div>
    </div>
  );
};

// ── Mini trend chart ──
const MiniChart: React.FC<{ timeSeries: any[]; isLive: boolean }> = ({ timeSeries, isLive }) => (
  <div className="h-28">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={timeSeries} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tickFormatter={d => d?.slice(5) ?? ''} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
        <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
        <RechartsTooltip
          contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: 11 }}
          labelStyle={{ color: 'hsl(var(--foreground))' }}
        />
        <Line type="monotone" dataKey="temperature" stroke="#22c55e" strokeWidth={isLive ? 2 : 1.5} strokeDasharray={isLive ? '0' : '4 2'} dot={false} connectNulls />
        <Line type="monotone" dataKey="co2" stroke="#60a5fa" strokeWidth={isLive ? 2 : 1.5} strokeDasharray={isLive ? '0' : '4 2'} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  </div>
);

/**
 * Floating Ilean AI assistant — native Geminus UI (no iframe).
 * Shows contextual sensor data from Senslinc, same pattern as SenslincDashboardView.
 */
export default function IleanButton() {
  const { data: ileanData, isLoading, contextLevel } = useIleanData();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Trigger button position (draggable)
  const [triggerPosition, setTriggerPosition] = useState<{ x: number; y: number } | null>(null);
  const [isTriggerDragging, setIsTriggerDragging] = useState(false);
  const triggerDragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const triggerDragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wasDraggedRef = useRef(false);

  // Panel drag state
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const panelWidth = isMobile ? window.innerWidth : 380;
  const panelHeight = isMobile ? window.innerHeight : (typeof window !== 'undefined' && window.innerHeight < 700 ? window.innerHeight - 100 : 520);

  // Load saved position
  useEffect(() => {
    const settings = getIleanSettings();
    if (settings.buttonPosition) {
      const maxX = window.innerWidth - BUTTON_SIZE;
      const maxY = window.innerHeight - BUTTON_SIZE;
      setTriggerPosition({
        x: Math.max(0, Math.min(settings.buttonPosition.x, maxX)),
        y: Math.max(0, Math.min(settings.buttonPosition.y, maxY)),
      });
    }
  }, []);

  // Initialize panel position
  useEffect(() => {
    if (isOpen && position.x === -1) {
      if (isMobile) setPosition({ x: 0, y: 0 });
      else {
        const y = typeof window !== 'undefined' ? window.innerHeight - panelHeight - 80 : 100;
        setPosition({ x: 16, y: Math.max(16, y) });
      }
    }
  }, [isOpen, position.x, panelHeight, isMobile]);

  // Panel drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (isMobile) return;
    e.preventDefault();
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragOffsetRef.current = { x: clientX - position.x, y: clientY - position.y };
  }, [position, isMobile]);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setPosition({
      x: Math.max(0, Math.min(clientX - dragOffsetRef.current.x, window.innerWidth - panelWidth)),
      y: Math.max(0, Math.min(clientY - dragOffsetRef.current.y, window.innerHeight - 50)),
    });
  }, [isDragging, panelWidth]);

  const handleDragEnd = useCallback(() => { setIsDragging(false); }, []);

  // Trigger drag handlers
  const handleTriggerDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const currentX = triggerPosition?.x ?? 16;
    const currentY = triggerPosition?.y ?? (window.innerHeight - 80);
    triggerDragOffsetRef.current = { x: clientX - currentX, y: clientY - currentY };
    triggerDragStartPosRef.current = { x: clientX, y: clientY };
    wasDraggedRef.current = false;
    setIsTriggerDragging(true);
  }, [triggerPosition]);

  const handleTriggerDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isTriggerDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    if (Math.abs(clientX - triggerDragStartPosRef.current.x) > 5 || Math.abs(clientY - triggerDragStartPosRef.current.y) > 5) wasDraggedRef.current = true;
    setTriggerPosition({
      x: Math.max(0, Math.min(clientX - triggerDragOffsetRef.current.x, window.innerWidth - BUTTON_SIZE)),
      y: Math.max(0, Math.min(clientY - triggerDragOffsetRef.current.y, window.innerHeight - BUTTON_SIZE)),
    });
  }, [isTriggerDragging]);

  const handleTriggerDragEnd = useCallback(() => {
    setIsTriggerDragging(false);
    if (wasDraggedRef.current && triggerPosition) saveIleanSettings({ buttonPosition: triggerPosition });
  }, [triggerPosition]);

  // Global listeners for trigger drag
  useEffect(() => {
    if (isTriggerDragging) {
      window.addEventListener('mousemove', handleTriggerDragMove);
      window.addEventListener('mouseup', handleTriggerDragEnd);
      window.addEventListener('touchmove', handleTriggerDragMove);
      window.addEventListener('touchend', handleTriggerDragEnd);
      return () => { window.removeEventListener('mousemove', handleTriggerDragMove); window.removeEventListener('mouseup', handleTriggerDragEnd); window.removeEventListener('touchmove', handleTriggerDragMove); window.removeEventListener('touchend', handleTriggerDragEnd); };
    }
  }, [isTriggerDragging, handleTriggerDragMove, handleTriggerDragEnd]);

  // Global listeners for panel drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove);
      window.addEventListener('touchend', handleDragEnd);
      return () => { window.removeEventListener('mousemove', handleDragMove); window.removeEventListener('mouseup', handleDragEnd); window.removeEventListener('touchmove', handleDragMove); window.removeEventListener('touchend', handleDragEnd); };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  const handleTriggerClick = () => {
    if (!wasDraggedRef.current) { setIsOpen(true); setIsMinimized(false); }
    wasDraggedRef.current = false;
  };

  const handleOpenExternal = () => {
    if (ileanData.dashboardUrl) window.open(ileanData.dashboardUrl, '_blank');
  };

  const triggerStyle = triggerPosition
    ? { left: triggerPosition.x, top: triggerPosition.y, bottom: 'auto', right: 'auto' }
    : {};

  const sensor = ileanData.sensorData;
  const current = sensor?.current;
  const timeSeries = sensor?.timeSeries || [];

  return (
    <TooltipProvider>
      {/* Floating trigger button */}
      <div
        className={cn("fixed z-50", !triggerPosition && "left-4 sm:bottom-6")}
        style={triggerPosition ? triggerStyle : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="relative">
              <Button
                onClick={handleTriggerClick}
                onMouseDown={handleTriggerDragStart}
                onTouchStart={handleTriggerDragStart}
                size="lg"
                className={cn(
                  "h-12 w-12 rounded-full shadow-lg",
                  "bg-gradient-to-br from-cyan-500 to-teal-600 hover:from-cyan-500/90 hover:to-teal-600/90",
                  "transition-all duration-300 hover:scale-105 hover:shadow-xl",
                  "sm:h-14 sm:w-14",
                  isOpen && "opacity-0 pointer-events-none",
                  isTriggerDragging && "cursor-grabbing scale-110"
                )}
              >
                <FileQuestion className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </Button>
              {!isOpen && (
                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-muted/80 rounded-full flex items-center justify-center pointer-events-none">
                  <Move className="h-2.5 w-2.5 text-muted-foreground" />
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">Open Ilean (drag to move)</TooltipContent>
        </Tooltip>
      </div>

      {/* Minimized bubble */}
      {isOpen && isMinimized && (
        <div
          className="fixed left-4 z-[60] cursor-pointer"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
          onClick={() => setIsMinimized(false)}
        >
          <div className={cn("bg-card/90 backdrop-blur-lg border rounded-full p-3 shadow-lg", "flex items-center gap-2 hover:bg-card transition-colors")}>
            <FileQuestion className="h-5 w-5 text-cyan-500" />
            <span className="text-sm font-medium max-w-32 truncate">Ilean</span>
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Native panel (no iframe) */}
      {isOpen && !isMinimized && (
        <div
          ref={panelRef}
          className={cn(
            "fixed z-[60] flex flex-col",
            "border rounded-lg shadow-xl",
            "bg-card/70 backdrop-blur-lg",
            isDragging && "cursor-grabbing select-none"
          )}
          style={isMobile ? { inset: 0, width: '100%', height: '100%', borderRadius: 0 } : { left: position.x, top: position.y, width: panelWidth, height: panelHeight }}
        >
          {/* Header */}
          <div
            className={cn(
              "flex items-center justify-between px-3 py-2",
              "border-b border-border/50",
              !isMobile && "rounded-t-lg cursor-grab",
              "bg-gradient-to-r from-cyan-500/10 to-teal-500/10",
              isDragging && "cursor-grabbing"
            )}
            onMouseDown={isMobile ? undefined : handleDragStart}
            onTouchStart={isMobile ? undefined : handleDragStart}
          >
            <div className="flex items-center gap-2">
              {!isMobile && <GripHorizontal className="h-4 w-4 text-muted-foreground" />}
              <div className="flex items-center gap-1.5">
                <FileQuestion className="h-4 w-4 text-cyan-500" />
                <span className="font-medium text-sm">Ilean AI</span>
                {ileanData.entityName && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1 ml-1">
                    {ileanData.entityType === 'building' && <Building2 className="h-3 w-3" />}
                    {ileanData.entityType === 'floor' && <Layers className="h-3 w-3" />}
                    {ileanData.entityType === 'room' && <DoorOpen className="h-3 w-3" />}
                    <span className="max-w-24 truncate">{ileanData.entityName}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {ileanData.dashboardUrl && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50" onClick={handleOpenExternal}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Open in Senslinc</TooltipContent>
                </Tooltip>
              )}
              {!isMobile && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50" onClick={() => setIsMinimized(true)}>
                      <Minimize2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Minimize</TooltipContent>
                </Tooltip>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content — native sensor data */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-500 mb-2" />
                <span className="text-sm text-muted-foreground">Loading Ilean data...</span>
              </div>
            ) : sensor ? (
              <>
                {/* Status */}
                <div className="flex items-center gap-2">
                  {ileanData.isLive ? (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-green-500/50 text-green-400 bg-green-500/10">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />LIVE
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1 border-muted-foreground/40 text-muted-foreground">
                      DEMO
                    </Badge>
                  )}
                  {sensor.machineName && (
                    <span className="text-xs text-muted-foreground truncate">{sensor.machineName}</span>
                  )}
                </div>

                {/* Gauge cards */}
                <div className="grid grid-cols-2 gap-2">
                  <MiniGauge label="Temperature" value={current?.temperature ?? null} unit="°C" icon={Thermometer} type="temperature" />
                  <MiniGauge label="CO₂" value={current?.co2 ?? null} unit="ppm" icon={Wind} type="co2" />
                  <MiniGauge label="Humidity" value={current?.humidity ?? null} unit="%" icon={Droplets} type="humidity" />
                  <MiniGauge label="Occupancy" value={current?.occupancy ?? null} unit="%" icon={Users} type="occupancy" />
                </div>

                {/* Trend chart */}
                {timeSeries.length > 0 && (
                  <div className="rounded-lg border border-border bg-card p-2.5">
                    <h3 className="text-[10px] font-medium text-muted-foreground mb-2">Last 7 days</h3>
                    <MiniChart timeSeries={timeSeries} isLive={ileanData.isLive} />
                  </div>
                )}

                {/* Connection status */}
                <div className={cn(
                  "flex items-center gap-2 text-xs text-muted-foreground rounded-md border px-3 py-2",
                  ileanData.isLive ? "border-green-500/30 bg-green-500/5" : "border-border bg-muted/30"
                )}>
                  {ileanData.isLive ? <Wifi className="h-3.5 w-3.5 text-green-400" /> : <WifiOff className="h-3.5 w-3.5" />}
                  <span>{ileanData.isLive ? `Live data from Senslinc · Machine: ${sensor.machinePk}` : 'No live connection to Senslinc.'}</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <FileQuestion className="h-16 w-16 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold mb-2">No sensor data available</h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  {contextLevel === 'building'
                    ? 'Select a room in the 3D viewer to see sensor data from Ilean.'
                    : 'No Senslinc equipment found for this entity. Verify the FM GUID mapping in Senslinc.'}
                </p>
                {ileanData.dashboardUrl && (
                  <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={handleOpenExternal}>
                    <ExternalLink className="h-4 w-4" /> Open in Senslinc
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}
