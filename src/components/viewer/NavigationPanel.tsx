/**
 * NavigationPanel — sidebar panel for indoor navigation.
 * Room selectors, route calculation, edit/navigate mode toggle.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Navigation, Pencil, Route, X, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  parseNavGraph,
  findNodeByRoom,
  dijkstra,
  mergeGraphs,
  navGraphToGeoJSON,
  type NavGraph,
  type RouteResult,
} from '@/lib/pathfinding';

interface NavigationPanelProps {
  buildingFmGuid: string;
  onRouteCalculated: (route: RouteResult | null) => void;
  onGraphLoaded: (graph: NavGraph) => void;
  onEditModeChange: (editing: boolean) => void;
  onGraphSave: (graph: NavGraph) => void;
  currentFloorFmGuid?: string | null;
  graph: NavGraph;
  onClose: () => void;
}

const NavigationPanel: React.FC<NavigationPanelProps> = ({
  buildingFmGuid,
  onRouteCalculated,
  onGraphLoaded,
  onEditModeChange,
  onGraphSave,
  currentFloorFmGuid,
  graph,
  onClose,
}) => {
  const [fromRoom, setFromRoom] = useState<string>('');
  const [toRoom, setToRoom] = useState<string>('');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch rooms (Space category) from database
  const [rooms, setRooms] = useState<any[]>([]);
  useEffect(() => {
    const fetchRooms = async () => {
      const { data } = await supabase
        .from('assets')
        .select('fm_guid, name, common_name, level_fm_guid')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('category', 'Space')
        .order('name');
      setRooms(data || []);
    };
    fetchRooms();
  }, [buildingFmGuid]);

  // Load graph from database on mount
  useEffect(() => {
    const loadGraph = async () => {
      const { data, error } = await supabase
        .from('navigation_graphs' as any)
        .select('*')
        .eq('building_fm_guid', buildingFmGuid);

      if (error) {
        console.warn('[NavigationPanel] Failed to load graph:', error);
        return;
      }

      if (data && data.length > 0) {
        const graphs = (data as any[]).map((row: any) => parseNavGraph(row.graph_data));
        const merged = mergeGraphs(graphs);
        onGraphLoaded(merged);
      }
    };

    loadGraph();
  }, [buildingFmGuid, onGraphLoaded]);

  const handleFindRoute = useCallback(() => {
    if (!fromRoom || !toRoom || graph.nodes.size === 0) return;

    const startNode = findNodeByRoom(graph, fromRoom);
    const endNode = findNodeByRoom(graph, toRoom);

    if (!startNode || !endNode) {
      console.warn('[NavigationPanel] Could not find nodes for selected rooms');
      setRoute(null);
      onRouteCalculated(null);
      return;
    }

    const result = dijkstra(graph, startNode.nodeId, endNode.nodeId);
    setRoute(result);
    onRouteCalculated(result);
  }, [fromRoom, toRoom, graph, onRouteCalculated]);

  const handleClearRoute = useCallback(() => {
    setRoute(null);
    onRouteCalculated(null);
  }, [onRouteCalculated]);

  const handleEditToggle = useCallback((checked: boolean) => {
    setIsEditMode(checked);
    onEditModeChange(checked);
    if (!checked) {
      // Leaving edit mode — auto-save
      handleSave();
    }
  }, [onEditModeChange]);

  const handleSave = useCallback(async () => {
    if (graph.nodes.size === 0) return;
    setIsSaving(true);

    const geojson = navGraphToGeoJSON(graph);

    // Upsert per-floor or whole-building graph
    const floorGuid = currentFloorFmGuid || null;

    const { data: existing } = await supabase
      .from('navigation_graphs' as any)
      .select('id')
      .eq('building_fm_guid', buildingFmGuid)
      .eq('floor_fm_guid', floorGuid || '')
      .maybeSingle();

    if (existing) {
      await supabase
        .from('navigation_graphs' as any)
        .update({ graph_data: geojson } as any)
        .eq('id', (existing as any).id);
    } else {
      await supabase
        .from('navigation_graphs' as any)
        .insert({
          building_fm_guid: buildingFmGuid,
          floor_fm_guid: floorGuid,
          graph_data: geojson,
        } as any);
    }

    onGraphSave(graph);
    setIsSaving(false);
  }, [graph, buildingFmGuid, currentFloorFmGuid, onGraphSave]);

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Navigation className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Navigation</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Separator />

      {/* Edit/Navigate toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isEditMode ? <Pencil className="h-3.5 w-3.5 text-muted-foreground" /> : <Route className="h-3.5 w-3.5 text-muted-foreground" />}
          <Label className="text-xs">{isEditMode ? 'Edit graph' : 'Navigate'}</Label>
        </div>
        <Switch checked={isEditMode} onCheckedChange={handleEditToggle} />
      </div>

      {isEditMode && (
        <div className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2">
          <p><strong>📍 Node:</strong> Click to place waypoints</p>
          <p><strong>🔗 Edge:</strong> Click two nodes to connect</p>
          <p><strong>🏠 Room:</strong> Link node to nearest room</p>
          <p><strong>🗑️ Delete:</strong> Click to remove</p>
          <p className="mt-1">Nodes: {graph.nodes.size} | Edges: {graph.edges.length}</p>
        </div>
      )}

      {isEditMode && (
        <Button size="sm" variant="outline" onClick={handleSave} disabled={isSaving} className="text-xs">
          {isSaving ? 'Sparar…' : 'Spara graf'}
        </Button>
      )}

      {!isEditMode && (
        <>
          <Separator />

          {/* From room */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Från rum</Label>
            <Select value={fromRoom} onValueChange={setFromRoom}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Välj startrum" />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((room: any) => (
                  <SelectItem key={room.fm_guid} value={room.fm_guid} className="text-xs">
                    {room.common_name || room.name || room.fm_guid?.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
          </div>

          {/* To room */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Till rum</Label>
            <Select value={toRoom} onValueChange={setToRoom}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Välj målrum" />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((room: any) => (
                  <SelectItem key={room.fm_guid} value={room.fm_guid} className="text-xs">
                    {room.common_name || room.name || room.fm_guid?.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Find route button */}
          <Button
            size="sm"
            onClick={handleFindRoute}
            disabled={!fromRoom || !toRoom || graph.nodes.size === 0}
            className="text-xs"
          >
            <Route className="h-3.5 w-3.5 mr-1" />
            Hitta väg
          </Button>

          {graph.nodes.size === 0 && (
            <p className="text-[10px] text-muted-foreground text-center">
              Ingen navigeringsgraf finns. Aktivera redigeringsläge för att skapa en.
            </p>
          )}

          {/* Route result */}
          {route && (
            <div className="bg-muted/50 rounded p-2 space-y-1">
              <p className="text-xs font-medium text-foreground">Rutt hittad!</p>
              <p className="text-[10px] text-muted-foreground">
                Avstånd: {route.totalDistance.toFixed(1)} enheter
              </p>
              <p className="text-[10px] text-muted-foreground">
                Waypoints: {route.path.length}
              </p>
              {route.floorTransitions.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Våningsbyten: {route.floorTransitions.length}
                </p>
              )}
              <Button size="sm" variant="outline" onClick={handleClearRoute} className="text-xs w-full mt-1">
                Rensa rutt
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default NavigationPanel;
