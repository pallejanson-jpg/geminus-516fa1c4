import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Palette, X, RefreshCw, AlertCircle, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import {
  VisualizationType,
  VISUALIZATION_CONFIGS,
  getVisualizationColor,
  rgbToFloat,
  rgbToHex,
  extractSensorValue,
  generateMockSensorData,
} from '@/lib/visualization-utils';
import { cn } from '@/lib/utils';

export interface FloorInfo {
  id: string;
  fmGuid: string;
  name: string;
  shortName: string;
}

interface RoomVisualizationPanelProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;
  onClose: () => void;
  onShowSpaces?: (show: boolean) => void;
  selectedFloorFmGuid?: string | null;
  className?: string;
}

interface RoomData {
  fmGuid: string;
  name: string | null;
  levelFmGuid: string | null;
  attributes: Record<string, any> | null;
}

/**
 * Floating, draggable panel for visualizing rooms with color-coding based on sensor data.
 * Auto-activates "Visa Rum" on mount and supports floor filtering for performance.
 */
const RoomVisualizationPanel: React.FC<RoomVisualizationPanelProps> = ({
  viewerRef,
  buildingFmGuid,
  onClose,
  onShowSpaces,
  selectedFloorFmGuid,
  className,
}) => {
  const [visualizationType, setVisualizationType] = useState<VisualizationType>('none');
  const [useMockData, setUseMockData] = useState(false);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [floors, setFloors] = useState<FloorInfo[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<string | null>(selectedFloorFmGuid || null);
  const [isLoading, setIsLoading] = useState(false);
  const [colorizedCount, setColorizedCount] = useState(0);
  const [hasRealData, setHasRealData] = useState(false);

  // Draggable panel state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const config = VISUALIZATION_CONFIGS[visualizationType];

  // Initialize position when panel opens
  useEffect(() => {
    if (position.x === 0 && position.y === 0) {
      const initialX = typeof window !== 'undefined' ? window.innerWidth - 320 : 200;
      setPosition({ x: initialX, y: 80 });
    }
  }, [position.x, position.y]);

  // Auto-activate "Visa Rum" on mount
  useEffect(() => {
    if (onShowSpaces) {
      onShowSpaces(true);
    }
    // Also try to set directly on the viewer
    try {
      const assetViewer = viewerRef.current?.assetViewer;
      assetViewer?.onShowSpacesChanged?.(true);
    } catch (e) {
      console.debug('Could not auto-activate spaces:', e);
    }
  }, [onShowSpaces, viewerRef]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select, [role="switch"], [role="combobox"]')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 300, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 300, e.clientY - dragOffset.y)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Fetch floors for the building from viewer metaScene
  const fetchFloorsFromViewer = useCallback(() => {
    try {
      const viewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (!viewer?.metaScene?.metaObjects) return;

      const metaObjects = viewer.metaScene.metaObjects;
      const extractedFloors: FloorInfo[] = [];

      Object.values(metaObjects).forEach((metaObject: any) => {
        const type = metaObject?.type?.toLowerCase();
        if (type === 'ifcbuildingstorey') {
          const name = metaObject.name || 'Unknown Floor';
          const shortMatch = name.match(/(\d+)/);
          const shortName = shortMatch ? shortMatch[1] : name.substring(0, 4);
          
          extractedFloors.push({
            id: metaObject.id,
            fmGuid: metaObject.id,
            name,
            shortName,
          });
        }
      });

      extractedFloors.sort((a, b) => {
        const numA = parseInt(a.shortName) || 0;
        const numB = parseInt(b.shortName) || 0;
        return numA - numB;
      });

      if (extractedFloors.length > 0) {
        setFloors(extractedFloors);
      }
    } catch (e) {
      console.debug('Could not extract floors from viewer:', e);
    }
  }, [viewerRef]);

  useEffect(() => {
    fetchFloorsFromViewer();
    // Try again after a short delay in case viewer wasn't ready
    const timer = setTimeout(fetchFloorsFromViewer, 1000);
    return () => clearTimeout(timer);
  }, [fetchFloorsFromViewer]);

  // Fetch rooms for the building, optionally filtered by floor
  const fetchRooms = useCallback(async () => {
    if (!buildingFmGuid) return;
    
    setIsLoading(true);
    try {
      let query = supabase
        .from('assets')
        .select('fm_guid, name, level_fm_guid, attributes')
        .eq('category', 'Space')
        .or(`building_fm_guid.eq.${buildingFmGuid},building_fm_guid.eq.${buildingFmGuid.toLowerCase()},building_fm_guid.eq.${buildingFmGuid.toUpperCase()}`);

      // Apply floor filter if selected
      if (selectedFloor) {
        query = query.or(`level_fm_guid.eq.${selectedFloor},level_fm_guid.eq.${selectedFloor.toLowerCase()},level_fm_guid.eq.${selectedFloor.toUpperCase()}`);
      }

      const { data, error } = await query;

      if (error) throw error;

      const roomData: RoomData[] = (data || []).map((r) => ({
        fmGuid: r.fm_guid,
        name: r.name,
        levelFmGuid: r.level_fm_guid,
        attributes: r.attributes as Record<string, any> | null,
      }));

      setRooms(roomData);

      // Check if any rooms have real sensor data
      const hasReal = roomData.some((room) => {
        const attrs = room.attributes;
        if (!attrs) return false;
        const keys = Object.keys(attrs);
        return keys.some(
          (k) =>
            k.toLowerCase().includes('sensortemperature') ||
            k.toLowerCase().includes('sensorco2') ||
            k.toLowerCase().includes('sensorhum') ||
            k.toLowerCase().includes('sensoroccupancy')
        );
      });
      setHasRealData(hasReal);

      console.log(`Fetched ${roomData.length} rooms for visualization (floor: ${selectedFloor || 'all'})`);
    } catch (error) {
      console.error('Failed to fetch rooms:', error);
    } finally {
      setIsLoading(false);
    }
  }, [buildingFmGuid, selectedFloor]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  // Get item IDs by FmGuid from viewer
  const getItemIdsByFmGuid = useCallback((fmGuidToFind: string) => {
    const viewer = viewerRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;

    if (assetView) {
      const itemIds = assetView.getItemsByPropertyValue('fmguid', fmGuidToFind.toUpperCase());
      return itemIds || [];
    }
    return [];
  }, [viewerRef]);

  // Colorize a single space in the viewer
  const colorizeSpace = useCallback(
    (fmGuid: string, color: [number, number, number] | null) => {
      const viewer = viewerRef.current;
      const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
      const xeokitViewer = assetView?.viewer;

      if (!xeokitViewer?.scene) return false;

      const itemIds = getItemIdsByFmGuid(fmGuid);
      if (itemIds.length === 0) return false;

      const scene = xeokitViewer.scene;
      itemIds.forEach((id: string) => {
        const entity = scene.objects?.[id];
        if (entity) {
          if (color) {
            entity.colorize = rgbToFloat(color);
          } else {
            entity.colorize = null; // Reset to default
          }
        }
      });

      return true;
    },
    [viewerRef, getItemIdsByFmGuid]
  );

  // Reset all room colors
  const resetColors = useCallback(() => {
    rooms.forEach((room) => {
      colorizeSpace(room.fmGuid, null);
    });
    setColorizedCount(0);
  }, [rooms, colorizeSpace]);

  // Apply visualization colors
  const applyVisualization = useCallback(() => {
    if (visualizationType === 'none') {
      resetColors();
      return;
    }

    let count = 0;
    rooms.forEach((room) => {
      let value: number | null = null;

      if (useMockData) {
        value = generateMockSensorData(room.fmGuid, visualizationType);
      } else {
        value = extractSensorValue(room.attributes, visualizationType);
      }

      if (value !== null) {
        const color = getVisualizationColor(value, visualizationType);
        if (color && colorizeSpace(room.fmGuid, color)) {
          count++;
        }
      }
    });

    setColorizedCount(count);
    console.log(`Applied ${visualizationType} visualization to ${count} rooms`);
  }, [visualizationType, rooms, useMockData, colorizeSpace, resetColors]);

  // Apply visualization when type or mock data changes
  useEffect(() => {
    if (rooms.length > 0) {
      applyVisualization();
    }
  }, [visualizationType, useMockData, rooms.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resetColors();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate legend gradient
  const legendGradient = useMemo(() => {
    if (!config || config.colorStops.length === 0) return '';

    const stops = config.colorStops.map((stop) => {
      const percent = ((stop.value - config.min) / (config.max - config.min)) * 100;
      return `${rgbToHex(stop.color)} ${percent}%`;
    });

    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [config]);

  return (
    <div
      ref={panelRef}
      className={cn(
        'fixed z-[55] w-72',
        'bg-card/95 backdrop-blur-sm border rounded-lg shadow-xl',
        isDragging && 'cursor-grabbing opacity-90',
        className
      )}
      style={{ left: position.x, top: position.y }}
    >
      {/* Header - Draggable */}
      <div
        className="flex items-center justify-between p-3 border-b cursor-grab select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <Palette className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Rumsvisualisering</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="p-3 space-y-4">
        {/* Floor filter selector */}
        {floors.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Våningsplan</Label>
            <Select
              value={selectedFloor || 'all'}
              onValueChange={(v) => setSelectedFloor(v === 'all' ? null : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Välj våning..." />
              </SelectTrigger>
              <SelectContent className="bg-card border shadow-lg z-[60]">
                <SelectItem value="all">Alla våningar</SelectItem>
                {floors.map((floor) => (
                  <SelectItem key={floor.id} value={floor.fmGuid}>
                    {floor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Visualization type selector */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Visualiseringstyp</Label>
          <Select
            value={visualizationType}
            onValueChange={(v) => setVisualizationType(v as VisualizationType)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Välj typ..." />
            </SelectTrigger>
            <SelectContent className="bg-card border shadow-lg z-[60]">
              <SelectItem value="none">Ingen</SelectItem>
              <SelectItem value="temperature">🌡️ Temperatur</SelectItem>
              <SelectItem value="co2">💨 CO₂</SelectItem>
              <SelectItem value="humidity">💧 Luftfuktighet</SelectItem>
              <SelectItem value="occupancy">👥 Beläggning</SelectItem>
              <SelectItem value="area">📐 Yta (NTA)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Mock data toggle */}
        {!hasRealData && visualizationType !== 'none' && (
          <div className="flex items-center justify-between">
            <Label className="text-xs flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-amber-500" />
              Simulerad data
            </Label>
            <Switch checked={useMockData} onCheckedChange={setUseMockData} />
          </div>
        )}

        {hasRealData && visualizationType !== 'none' && (
          <p className="text-xs text-green-600">✓ Riktig sensordata tillgänglig</p>
        )}

        {/* Legend */}
        {visualizationType !== 'none' && config && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Färgskala ({config.unit})
            </Label>
            <div
              className="h-4 rounded-sm"
              style={{ background: legendGradient }}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>
                {config.min} {config.unit}
              </span>
              <span>
                {config.max} {config.unit}
              </span>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <span>
            {isLoading ? 'Laddar...' : `${rooms.length} rum hittade`}
          </span>
          {colorizedCount > 0 && (
            <span className="text-primary">{colorizedCount} färglagda</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={resetColors}
            disabled={colorizedCount === 0}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Återställ
          </Button>
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onClick={applyVisualization}
            disabled={visualizationType === 'none' || isLoading}
          >
            Uppdatera
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RoomVisualizationPanel;
