/**
 * NavigationPanel — sidebar panel for indoor navigation.
 * Room selectors, route calculation, edit/navigate mode toggle.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Navigation, Pencil, Route, X, ArrowRight, Accessibility, Wand2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
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
  dijkstraWithOptions,
  mergeGraphs,
  navGraphToGeoJSON,
  type NavGraph,
  type RouteResult,
} from '@/lib/pathfinding';
import { useFloorData, type FloorInfo } from '@/hooks/useFloorData';
import { getXeokitViewerFromRef } from '@/hooks/useFloorVisibility';
import { generateFloorNavGraph, collectVerticalNodes, mergeGeneratedFloor } from '@/lib/nav-graph-autogen';
import { getFloorAabb } from '@/lib/indoor-route-3d';
import { formatRoomLabel } from '@/lib/utils';
import { logger } from '@/lib/logger';

function normalizeGuid(v?: string | null): string {
  return (v || '').toLowerCase().replace(/-/g, '');
}

interface NavigationPanelProps {
  buildingFmGuid: string;
  onRouteCalculated: (route: RouteResult | null) => void;
  onGraphLoaded: (graph: NavGraph) => void;
  onEditModeChange: (editing: boolean) => void;
  onGraphSave: (graph: NavGraph) => void;
  currentFloorFmGuid?: string | null;
  graph: NavGraph;
  onClose: () => void;
  /** xeokit viewer ref — needed to read live BIM geometry for "Generate suggestion". */
  viewerRef?: React.MutableRefObject<any>;
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
  viewerRef,
}) => {
  const { t } = useLanguage();
  const [fromRoom, setFromRoom] = useState<string>('');
  const [toRoom, setToRoom] = useState<string>('');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [preferElevator, setPreferElevator] = useState(false);
  const [roomSearch, setRoomSearch] = useState('');
  const { floors } = useFloorData(viewerRef ?? { current: null }, buildingFmGuid);

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

  const filteredRooms = useMemo(() => {
    if (!roomSearch.trim()) return rooms;
    const q = roomSearch.toLowerCase();
    return rooms.filter(r =>
      formatRoomLabel(r.name, r.common_name).toLowerCase().includes(q)
    );
  }, [rooms, roomSearch]);

  // Load graph from database on mount
  useEffect(() => {
    const loadGraph = async () => {
      const { data, error } = await supabase
        .from('navigation_graphs' as any)
        .select('*')
        .eq('building_fm_guid', buildingFmGuid);

      if (error) {
        logger.warn('[NavigationPanel] Failed to load graph:', error);
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
      logger.warn('[NavigationPanel] Could not find nodes for selected rooms');
      setRoute(null);
      onRouteCalculated(null);
      return;
    }

    const result = dijkstraWithOptions(graph, startNode.nodeId, endNode.nodeId, { preferElevator });
    setRoute(result);
    onRouteCalculated(result);
  }, [fromRoom, toRoom, graph, onRouteCalculated]);

  const handleClearRoute = useCallback(() => {
    setRoute(null);
    onRouteCalculated(null);
  }, [onRouteCalculated]);

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

  const handleEditToggle = useCallback((checked: boolean) => {
    setIsEditMode(checked);
    onEditModeChange(checked);
    if (!checked) {
      // Leaving edit mode — auto-save
      handleSave();
    }
  }, [onEditModeChange, handleSave]);

  // Auto-generate a starting graph for the current floor from the live BIM model
  // (room centroids + door connections + stair/elevator nodes) instead of requiring
  // every node to be placed by hand. The result is just loaded into the editor for
  // review — nothing is saved until the user hits "Save graph" as usual.
  const runGenerateSuggestion = useCallback((viewer: any, floor: FloorInfo) => {
    setIsGenerating(true);
    try {
      const roomFmGuidByOriginalId = new Map<string, string>(
        rooms.filter((r: any) => r.fm_guid).map((r: any) => [normalizeGuid(r.fm_guid), r.fm_guid])
      );
      const existingVerticalNodes = collectVerticalNodes(viewer, floors, graph);
      const generated = generateFloorNavGraph(viewer, floor, { roomFmGuidByOriginalId, existingVerticalNodes });

      if (generated.nodes.size === 0) {
        toast.warning(t('Hittade inga rum/dörrar att generera från på den här våningen', 'Found no rooms/doors to generate from on this floor'));
        return;
      }

      // Lets mergeGeneratedFloor convert any other floors' percent-space edges to real
      // meters too (instead of just warning about them) when this floor's AABB isn't the
      // one they need — matched by database level fm_guid, since one FloorInfo can span
      // several of those.
      const resolveOtherFloorAabb = (otherFloorFmGuid: string | null) => {
        if (!otherFloorFmGuid) return null;
        const otherFloor = floors.find(f =>
          f.databaseLevelFmGuids.some(g => normalizeGuid(g) === normalizeGuid(otherFloorFmGuid))
        );
        return otherFloor ? getFloorAabb(viewer, otherFloor) : null;
      };

      const merged = mergeGeneratedFloor(graph, currentFloorFmGuid ?? null, generated, resolveOtherFloorAabb);
      onGraphLoaded(merged);
      toast.success(t(`Genererade ${generated.nodes.size} noder`, `Generated ${generated.nodes.size} nodes`));
    } finally {
      setIsGenerating(false);
    }
  }, [floors, currentFloorFmGuid, graph, rooms, onGraphLoaded, t]);

  const handleGenerateSuggestion = useCallback(() => {
    const viewer = getXeokitViewerFromRef(viewerRef ?? { current: null });
    if (!viewer?.scene) {
      toast.error(t('3D-modellen är inte redo än', '3D model isn\'t ready yet'));
      return;
    }

    const floor = floors.find(f => f.databaseLevelFmGuids.some(g => normalizeGuid(g) === normalizeGuid(currentFloorFmGuid)));
    if (!floor) {
      toast.error(t('Välj en våning i planvyn först', 'Select a floor in the plan view first'));
      return;
    }

    const hasExistingFloorNodes = Array.from(graph.nodes.values())
      .some(n => normalizeGuid(n.floor_fm_guid) === normalizeGuid(currentFloorFmGuid));

    if (hasExistingFloorNodes) {
      toast(t('Den här våningen har redan noder', 'This floor already has nodes'), {
        description: t('Ersätta dem med ett auto-genererat förslag?', 'Replace them with an auto-generated suggestion?'),
        action: {
          label: t('Ersätt', 'Replace'),
          onClick: () => runGenerateSuggestion(viewer, floor),
        },
      });
      return;
    }

    runGenerateSuggestion(viewer, floor);
  }, [viewerRef, floors, currentFloorFmGuid, graph, t, runGenerateSuggestion]);

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Navigation className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{t('Navigation', 'Navigation')}</h3>
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
          <Label className="text-xs">{isEditMode ? t('Redigera graf', 'Edit graph') : t('Navigera', 'Navigate')}</Label>
        </div>
        <Switch checked={isEditMode} onCheckedChange={handleEditToggle} />
      </div>

      {isEditMode && (
        <div className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2">
          <p><strong>📍 {t('Nod', 'Node')}:</strong> {t('Klicka för att placera vägpunkter', 'Click to place waypoints')}</p>
          <p><strong>🔗 {t('Kant', 'Edge')}:</strong> {t('Klicka två noder för att koppla', 'Click two nodes to connect')}</p>
          <p><strong>🏠 {t('Rum', 'Room')}:</strong> {t('Koppla nod till närmaste rum', 'Link node to nearest room')}</p>
          <p><strong>🗑️ {t('Ta bort', 'Delete')}:</strong> {t('Klicka för att radera', 'Click to remove')}</p>
          <p className="mt-1">{t('Noder', 'Nodes')}: {graph.nodes.size} | {t('Kanter', 'Edges')}: {graph.edges.length}</p>
        </div>
      )}

      {isEditMode && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleGenerateSuggestion}
            disabled={isGenerating || floors.length === 0}
            className="text-xs flex-1 gap-1"
            title={t('Föreslå noder/kanter från BIM-modellen för aktuell våning', 'Suggest nodes/edges from the BIM model for the current floor')}
          >
            <Wand2 className="h-3.5 w-3.5" />
            {isGenerating ? t('Genererar…', 'Generating…') : t('Föreslå graf', 'Generate suggestion')}
          </Button>
          <Button size="sm" variant="outline" onClick={handleSave} disabled={isSaving} className="text-xs flex-1">
            {isSaving ? t('Sparar…', 'Saving…') : t('Spara graf', 'Save graph')}
          </Button>
        </div>
      )}

      {!isEditMode && (
        <>
          <Separator />

          {/* Room search */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('Sök rum', 'Search room')}</Label>
            <Input
              value={roomSearch}
              onChange={e => setRoomSearch(e.target.value)}
              placeholder={t('Filtrera rum…', 'Filter rooms…')}
              className="h-8 text-xs"
            />
          </div>

          {/* From room */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('Från rum', 'From room')}</Label>
            <Select value={fromRoom} onValueChange={setFromRoom}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={t('Välj startrum', 'Select start room')} />
              </SelectTrigger>
              <SelectContent>
                {filteredRooms.map((room: any) => (
                  <SelectItem key={room.fm_guid} value={room.fm_guid} className="text-xs">
                    {formatRoomLabel(room.name, room.common_name) || room.fm_guid?.slice(0, 8)}
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
            <Label className="text-xs text-muted-foreground">{t('Till rum', 'To room')}</Label>
            <Select value={toRoom} onValueChange={setToRoom}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={t('Välj målrum', 'Select destination room')} />
              </SelectTrigger>
              <SelectContent>
                {filteredRooms.map((room: any) => (
                  <SelectItem key={room.fm_guid} value={room.fm_guid} className="text-xs">
                    {formatRoomLabel(room.name, room.common_name) || room.fm_guid?.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Accessibility toggle */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <Accessibility className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs">{t('Undvik trappor (hiss)', 'Avoid stairs (elevator)')}</Label>
            </div>
            <Switch checked={preferElevator} onCheckedChange={setPreferElevator} />
          </div>

          {/* Find route button */}
          <Button
            size="sm"
            onClick={handleFindRoute}
            disabled={!fromRoom || !toRoom || graph.nodes.size === 0}
            className="text-xs"
          >
            <Route className="h-3.5 w-3.5 mr-1" />
            {t('Hitta rutt', 'Find route')}
          </Button>

          {graph.nodes.size === 0 && (
            <p className="text-[10px] text-muted-foreground text-center">
              {t('Ingen navigeringsgraf finns. Aktivera redigeringsläget för att skapa en.', 'No navigation graph exists. Enable edit mode to create one.')}
            </p>
          )}

          {/* Route result */}
          {route && (
            <div className="bg-muted/50 rounded p-2 space-y-1">
              <p className="text-xs font-medium text-foreground">{t('Rutt hittad!', 'Route found!')}</p>
              <p className="text-[10px] text-muted-foreground">
                {t('Avstånd', 'Distance')}: {route.totalDistance.toFixed(1)} {t('enheter', 'units')}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {t('Vägpunkter', 'Waypoints')}: {route.path.length}
              </p>
              {route.floorTransitions.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {t('Våningsövergångar', 'Floor transitions')}: {route.floorTransitions.length}
                </p>
              )}
              <Button size="sm" variant="outline" onClick={handleClearRoute} className="text-xs w-full mt-1">
                {t('Rensa rutt', 'Clear route')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default NavigationPanel;
