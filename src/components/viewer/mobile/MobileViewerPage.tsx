/**
 * MobileViewerPage — ACC/Dalux-inspired fullscreen mobile viewer.
 *
 * Layout:
 *  ┌─────────────────────────────┐
 *  │ × [Building] [modes] [☰]   │  ← Transparent gradient topbar
 *  │                             │
 *  │    NativeViewerShell        │  ← Real xeokit 3D canvas (edge-to-edge)
 *  │                             │
 *  │ ┄┄  Plan 1 │ Plan 2 │ …  ┄ │  ← Compact floor pills
 *  │ [🔄][✋][⬡][📐][✂️][⚡] [⚙] │  ← Compact bottom toolbar
 *  └─────────────────────────────┘
 */

import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import ViewerFilterPanel from '@/components/viewer/ViewerFilterPanel';
import {
  X, Menu, Orbit, Hand, Maximize, MousePointer, Ruler,
  Scissors, Square, Box, LayoutPanelLeft, View,
  Filter, SlidersHorizontal, BarChart2, AlertTriangle,
  Settings, ChevronRight, Eye, EyeOff, Loader2, Scan, User,
  Compass, PenTool, RotateCcw, Layers, ChevronUp, ChevronDown,
  Palette, Camera, Home, MessageSquare, MessageSquarePlus,
  Plus, Radio, Map as MapIcon, Type, Sun, Navigation,
} from 'lucide-react';
import NavigationPanel from '@/components/viewer/NavigationPanel';
import NavGraphEditorOverlay from '@/components/viewer/NavGraphEditorOverlay';
import RouteDisplayOverlay from '@/components/viewer/RouteDisplayOverlay';
import type { NavGraph, RouteResult } from '@/lib/pathfinding';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import NativeViewerShell from '@/components/viewer/NativeViewerShell';
import SplitPlanView from '@/components/viewer/SplitPlanView';
import InsightsDrawerPanel from '@/components/viewer/InsightsDrawerPanel';
import ModelVisibilitySelector from '@/components/viewer/ModelVisibilitySelector';
import AnnotationCategoryList from '@/components/viewer/AnnotationCategoryList';
import RoomVisualizationPanel from '@/components/viewer/RoomVisualizationPanel';
import ViewerThemeSelector from '@/components/viewer/ViewerThemeSelector';
import LightingControlsPanel from '@/components/viewer/LightingControlsPanel';
import CreateViewDialog from '@/components/viewer/CreateViewDialog';
import CreateIssueDialog from '@/components/viewer/CreateIssueDialog';
import { useFloorData, type FloorInfo } from '@/hooks/useFloorData';
import { getDescendantIds, calculateFloorBounds } from '@/hooks/useFloorVisibility';
import { useRoomLabelConfigs } from '@/hooks/useRoomLabelConfigs';
import { useBcfViewpoints } from '@/hooks/useBcfViewpoints';
import { useAuth } from '@/hooks/useAuth';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type { ViewMode } from '@/pages/UnifiedViewer';
import {
  VIEW_MODE_2D_TOGGLED_EVENT,
  VIEW_MODE_REQUESTED_EVENT,
  VIEWER_TOOL_CHANGED_EVENT,
  MINIMAP_TOGGLE_EVENT,
  SENSOR_ANNOTATIONS_TOGGLE_EVENT,
  ISSUE_ANNOTATIONS_TOGGLE_EVENT,
  ALARM_ANNOTATIONS_SHOW_EVENT,
  VIEWER_CREATE_ASSET_EVENT,
  type ViewerToolChangedDetail,
} from '@/lib/viewer-events';
import {
  FLOOR_SELECTION_CHANGED_EVENT,
  CLIP_HEIGHT_CHANGED_EVENT,
  type FloorSelectionEventDetail,
} from '@/hooks/useSectionPlaneClipping';
import { ROOM_LABELS_TOGGLE_EVENT, ROOM_LABELS_CONFIG_EVENT, type RoomLabelsConfigDetail } from '@/hooks/useRoomLabels';
import type { LocalCoords } from '@/context/ViewerSyncContext';
import type { IvionBimTransform } from '@/lib/ivion-bim-transform';
import type { useBuildingViewerData } from '@/hooks/useBuildingViewerData';

/* ── All available tools (configurable) ── */
const ALL_TOOLS: { id: string; Icon: React.FC<any>; label: string }[] = [
  { id: 'orbit', Icon: Orbit, label: 'Orbit' },
  { id: 'pan', Icon: Hand, label: 'Pan' },
  { id: 'fit', Icon: Maximize, label: 'Fit' },
  { id: 'resetView', Icon: RotateCcw, label: 'Reset View' },
  { id: 'select', Icon: MousePointer, label: 'Select' },
  { id: 'measure', Icon: Ruler, label: 'Measure' },
  { id: 'section', Icon: Scissors, label: 'Section' },
  { id: 'xray', Icon: Scan, label: 'X-Ray' },
  { id: 'firstPerson', Icon: User, label: 'First Person' },
  { id: 'navCube', Icon: Compass, label: 'Nav Cube' },
  { id: 'markup', Icon: PenTool, label: 'Markup' },
];

const DEFAULT_ENABLED = ['orbit', 'pan', 'fit', 'resetView', 'select', 'measure', 'section'];

/* ── Action Sheet menu items ── */
const MENU_ITEMS = [
  { id: 'viewMode', Icon: Box, label: 'View Mode', hasSubmenu: true },
  { id: 'filter', Icon: Filter, label: 'Filter', hasSubmenu: true },
  { id: 'display', Icon: Eye, label: 'Display', hasSubmenu: true },
  { id: 'colorFilter', Icon: Palette, label: 'Color filter', hasSubmenu: true },
  { id: 'actions', Icon: Camera, label: 'Actions', hasSubmenu: true },
  { id: 'navigation', Icon: Navigation, label: 'Navigation', hasSubmenu: true },
  { id: 'insights', Icon: BarChart2, label: 'Insights' },
  { id: 'settings', Icon: Settings, label: 'Settings', hasSubmenu: true },
];

type SubSheetId = 'viewMode' | 'toolbarConfig' | 'display' | 'filter' | 'colorFilter' | 'actions' | 'navigation' | 'settings' | null;

const getViewer = () => (window as any).__nativeXeokitViewer;

interface MobileViewerPageProps {
  buildingData: NonNullable<ReturnType<typeof useBuildingViewerData>['buildingData']>;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  sdkStatus: string;
  ivApiRef: React.MutableRefObject<any>;
  sdkContainerRef: React.RefObject<HTMLDivElement | null>;
  transform: IvionBimTransform;
  handle3DCameraChange: (pos: LocalCoords, heading: number, pitch: number) => void;
  sync3DPosition: LocalCoords | null;
  sync3DHeading: number;
  sync3DPitch: number;
  hasIvion: boolean;
  hasFmAccess: boolean;
  floorFmGuid: string | null;
  floorName: string;
  entityFmGuid: string | null;
  visualizationParam: import('@/lib/visualization-utils').VisualizationType | null;
  insightsMode: string | null;
  forceXray: boolean;
  onGoBack: () => void;
  viewerInstanceRef: React.MutableRefObject<any>;
  viewerReady: boolean;
  insightsPanelOpen: boolean;
  setInsightsPanelOpen: (v: boolean) => void;
}

const MobileViewerPage: React.FC<MobileViewerPageProps> = ({
  buildingData,
  viewMode,
  setViewMode,
  sdkContainerRef,
  hasIvion,
  onGoBack,
  viewerInstanceRef,
  viewerReady,
  insightsPanelOpen,
  setInsightsPanelOpen,
}) => {
  const { allData } = useContext(AppContext);
  const { user } = useAuth();
  const isSplit = viewMode === 'split2d3d';
  const [splitPlanReady, setSplitPlanReady] = useState(false);
  const [activeTool, setActiveTool] = useState('orbit');
  const [isXrayActive, setIsXrayActive] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [subSheet, setSubSheet] = useState<SubSheetId>(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [enabledTools, setEnabledTools] = useState<string[]>(DEFAULT_ENABLED);
  const [soloFloorId, setSoloFloorId] = useState<string | null>(null);

  // Display states
  const [showSpaces, setShowSpaces] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [annotationsExpanded, setAnnotationsExpanded] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [showAlarms, setShowAlarms] = useState(false);
  const [showSensors, setShowSensors] = useState(false);

  // Settings states
  const [clipHeight, setClipHeight] = useState(1.2);
  const [showRoomLabels, setShowRoomLabels] = useState(false);
  const [activeRoomLabelConfigId, setActiveRoomLabelConfigId] = useState<string | null>(null);

  // Actions states
  const [showCreateViewDialog, setShowCreateViewDialog] = useState(false);
  const [pendingViewState, setPendingViewState] = useState<any>(null);
  const [isSavingView, setIsSavingView] = useState(false);
  const [showCreateIssueDialog, setShowCreateIssueDialog] = useState(false);
  const [pendingIssueState, setPendingIssueState] = useState<{ screenshot: string; viewpoint: any; selectedObjects: string[] } | null>(null);
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);
  const [isSavingStartView, setIsSavingStartView] = useState(false);

  // Navigation graph state
  const [navPanelOpen, setNavPanelOpen] = useState(false);
  const [navEditMode, setNavEditMode] = useState(false);
  const [navGraph, setNavGraph] = useState<NavGraph>({ nodes: new globalThis.Map(), edges: [] });
  const [navRoute, setNavRoute] = useState<RouteResult | null>(null);
  const [navFloorFmGuid, setNavFloorFmGuid] = useState<string | null>(null);
  const [planRoomLabels, setPlanRoomLabels] = useState<Array<{ id: string; name: string; x: number; y: number }>>([]);

  // Floor data
  const { floors } = useFloorData(viewerInstanceRef, buildingData.fmGuid);
  const { configs: roomLabelConfigs, loading: loadingRoomLabelConfigs } = useRoomLabelConfigs();
  const { captureViewpoint, captureScreenshot, getSelectedObjectIds, restoreViewpoint } = useBcfViewpoints({ viewerRef: viewerInstanceRef });

  // Reset splitPlanReady when leaving split mode
  useEffect(() => {
    if (!isSplit) setSplitPlanReady(false);
  }, [isSplit]);

  useEffect(() => {
    if (!isSplit || !viewerReady) return;
    const timer = setTimeout(() => setSplitPlanReady(true), 400);
    return () => clearTimeout(timer);
  }, [isSplit, viewerReady]);

  const modes: { mode: ViewMode; label: string; Icon: React.FC<any> }[] = [
    { mode: '2d', label: '2D', Icon: Square },
    { mode: 'split2d3d', label: '2D/3D', Icon: LayoutPanelLeft },
    { mode: '3d', label: '3D', Icon: Box },
  ];
  if (hasIvion) modes.push({ mode: '360', label: '360°', Icon: View });

  const handleModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode === '2d') {
      window.dispatchEvent(new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: true } }));
      window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '2d' } }));
      const viewer = getViewer();
      if (viewer?.scene) {
        const targetFloor = soloFloorId
          ? floors.find(f => f.id === soloFloorId)
          : floors.length > 0 ? floors[0] : null;
        if (targetFloor) {
          if (!soloFloorId) {
            setSoloFloorId(targetFloor.id);
            viewer.scene.setObjectsVisible(viewer.scene.objectIds, false);
            targetFloor.metaObjectIds.forEach(moId => {
              const descendants = getDescendantIds(viewer, moId);
              viewer.scene.setObjectsVisible(descendants, true);
            });
          }
          const bounds = calculateFloorBounds(viewer, targetFloor.id);
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
              detail: {
                floorId: targetFloor.id, floorName: targetFloor.name, bounds,
                visibleMetaFloorIds: targetFloor.metaObjectIds,
                visibleFloorFmGuids: targetFloor.databaseLevelFmGuids,
                isAllFloorsVisible: false, isSoloFloor: true, soloFloorName: targetFloor.name,
              } as FloorSelectionEventDetail,
            }));
          }, 100);
        }
      }
    } else if (mode === '3d') {
      window.dispatchEvent(new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: false } }));
      window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
    } else if (mode === 'split2d3d') {
      window.dispatchEvent(new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: false } }));
      window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
    }
  }, [setViewMode, soloFloorId, floors]);

  /* ── Real xeokit tool handlers ── */
  const handleToolClick = useCallback((toolId: string) => {
    const viewer = getViewer();

    if (toolId === 'fit') {
      if (viewer?.cameraFlight && viewer?.scene) {
        viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.5 });
      }
      return;
    }

    if (toolId === 'resetView') {
      if (viewer?.scene) {
        const selected = viewer.scene.selectedObjectIds || [];
        if (selected.length > 0) viewer.scene.setObjectsSelected(selected, false);
        const xrayed = viewer.scene.xrayedObjectIds || [];
        if (xrayed.length > 0) viewer.scene.setObjectsXRayed(xrayed, false);
        setIsXrayActive(false);
        viewer.scene.setObjectsVisible(viewer.scene.objectIds, true);
        if (viewer.cameraFlight) {
          viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.5 });
        }
        setSoloFloorId(null);
        window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
          detail: { floorId: null, isAllFloorsVisible: true, isSoloFloor: false } as FloorSelectionEventDetail,
        }));
      }
      if (viewer?.cameraControl) {
        viewer.cameraControl.navMode = 'orbit';
        viewer.cameraControl.followPointer = true;
      }
      setActiveTool('orbit');
      window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, {
        detail: { tool: null } as ViewerToolChangedDetail,
      }));
      return;
    }

    if (toolId === 'xray') {
      const next = !isXrayActive;
      setIsXrayActive(next);
      if (viewer?.scene) {
        const ids = viewer.scene.objectIds || [];
        if (next) {
          const xrayMaterial = viewer.scene.xrayMaterial;
          if (xrayMaterial) {
            xrayMaterial.fill = true;
            xrayMaterial.fillAlpha = 0.15;
            xrayMaterial.edges = true;
            xrayMaterial.edgeAlpha = 0.4;
          }
        }
        viewer.scene.setObjectsXRayed(ids, next);
      }
      return;
    }

    setActiveTool(toolId);

    switch (toolId) {
      case 'orbit':
        if (viewer?.cameraControl) { viewer.cameraControl.navMode = 'orbit'; viewer.cameraControl.followPointer = true; }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, { detail: { tool: null } as ViewerToolChangedDetail }));
        break;
      case 'pan':
        if (viewer?.cameraControl) { viewer.cameraControl.navMode = 'planView'; }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, { detail: { tool: null } as ViewerToolChangedDetail }));
        break;
      case 'select':
        if (viewer?.cameraControl) { viewer.cameraControl.navMode = 'orbit'; viewer.cameraControl.followPointer = true; }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, { detail: { tool: 'select' } as ViewerToolChangedDetail }));
        break;
      case 'measure':
        if (viewer?.cameraControl) { viewer.cameraControl.navMode = 'orbit'; viewer.cameraControl.followPointer = true; }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, { detail: { tool: 'measure' } as ViewerToolChangedDetail }));
        break;
      case 'section':
        if (viewer?.cameraControl) { viewer.cameraControl.navMode = 'orbit'; viewer.cameraControl.followPointer = true; }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, { detail: { tool: 'slicer' } as ViewerToolChangedDetail }));
        break;
      case 'firstPerson':
        if (viewer?.cameraControl) { viewer.cameraControl.navMode = 'firstPerson'; viewer.cameraControl.followPointer = true; viewer.cameraControl.constrainVertical = true; }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, { detail: { tool: null } as ViewerToolChangedDetail }));
        break;
    }
  }, [isXrayActive, soloFloorId]);

  /* ── Floor selection ── */
  const handleFloorClick = useCallback((floor: FloorInfo) => {
    const viewer = getViewer();
    const isSolo = soloFloorId === floor.id;

    if (isSolo) {
      setSoloFloorId(null);
      if (viewer?.scene) viewer.scene.setObjectsVisible(viewer.scene.objectIds, true);
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
        detail: { floorId: null, isAllFloorsVisible: true, isSoloFloor: false } as FloorSelectionEventDetail,
      }));
    } else {
      setSoloFloorId(floor.id);
      if (viewer?.scene) {
        viewer.scene.setObjectsVisible(viewer.scene.objectIds, false);
        floor.metaObjectIds.forEach(moId => {
          const descendants = getDescendantIds(viewer, moId);
          viewer.scene.setObjectsVisible(descendants, true);
        });
      }
      const bounds = calculateFloorBounds(viewer, floor.id);
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
        detail: {
          floorId: floor.id, floorName: floor.name, bounds,
          visibleMetaFloorIds: floor.metaObjectIds, visibleFloorFmGuids: floor.databaseLevelFmGuids,
          isAllFloorsVisible: false, isSoloFloor: true, soloFloorName: floor.name,
        } as FloorSelectionEventDetail,
      }));
    }
  }, [soloFloorId]);

  /* ── Display toggle handlers ── */
  const handleToggleSpaces = useCallback(() => {
    const newValue = !showSpaces;
    setShowSpaces(newValue);
    try { viewerInstanceRef.current?.assetViewer?.onShowSpacesChanged?.(newValue); } catch (e) { /* ignore */ }
  }, [showSpaces, viewerInstanceRef]);

  const handleToggleAnnotations = useCallback(() => {
    const newValue = !showAnnotations;
    setShowAnnotations(newValue);
    try { viewerInstanceRef.current?.assetViewer?.onToggleAnnotation?.(newValue); } catch (e) { /* ignore */ }
  }, [showAnnotations, viewerInstanceRef]);

  /* ── Clip height ── */
  const handleClipHeightChange = useCallback((value: number[]) => {
    const h = value[0];
    setClipHeight(h);
    window.dispatchEvent(new CustomEvent(CLIP_HEIGHT_CHANGED_EVENT, { detail: { height: h } }));
  }, []);

  /* ── Room labels ── */
  const handleRoomLabelConfigSelect = useCallback((configId: string) => {
    if (configId === 'off') {
      setShowRoomLabels(false);
      setActiveRoomLabelConfigId(null);
      window.dispatchEvent(new CustomEvent(ROOM_LABELS_TOGGLE_EVENT, { detail: { enabled: false } }));
    } else {
      setShowRoomLabels(true);
      setActiveRoomLabelConfigId(configId);
      const config = roomLabelConfigs.find(c => c.id === configId);
      if (config) {
        window.dispatchEvent(new CustomEvent(ROOM_LABELS_CONFIG_EVENT, {
          detail: {
            fields: config.fields, heightOffset: config.height_offset,
            fontSize: config.font_size, scaleWithDistance: config.scale_with_distance,
            clickAction: config.click_action, occlusionEnabled: config.occlusion_enabled,
            flatOnFloor: config.flat_on_floor,
          } as RoomLabelsConfigDetail,
        }));
      }
      window.dispatchEvent(new CustomEvent(ROOM_LABELS_TOGGLE_EVENT, { detail: { enabled: true } }));
    }
  }, [roomLabelConfigs]);

  /* ── Capture view state (for Create view) ── */
  const captureViewState = useCallback(async () => {
    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer || !buildingData.fmGuid) {
      toast({ title: "Cannot create view", description: "Viewer is not ready", variant: "destructive" });
      return;
    }
    try {
      const canvas = xeokitViewer.scene?.canvas?.canvas;
      if (!canvas) return;
      xeokitViewer.scene?.render?.(true);
      const screenshotDataUrl = canvas.toDataURL('image/png');
      const camera = xeokitViewer.camera;
      const building = allData.find((b: any) => b.fmGuid === buildingData.fmGuid && b.category === 'Building');
      const viewState = {
        buildingFmGuid: buildingData.fmGuid,
        buildingName: buildingData.name || building?.commonName || 'Unknown',
        screenshotDataUrl,
        cameraEye: [...camera.eye], cameraLook: [...camera.look], cameraUp: [...camera.up],
        cameraProjection: camera.projection,
        viewMode: viewMode === '2d' ? '2d' : '3d',
        clipHeight, visibleModelIds: [], visibleFloorIds: [],
        showSpaces, showAnnotations, visualizationType: 'none', visualizationMockData: false,
      };
      setPendingViewState(viewState);
      setShowCreateViewDialog(true);
    } catch (err) {
      console.error('Failed to capture view state:', err);
    }
  }, [viewerInstanceRef, buildingData, allData, viewMode, clipHeight, showSpaces, showAnnotations]);

  const handleSaveView = useCallback(async (name: string, description: string) => {
    if (!pendingViewState) return;
    setIsSavingView(true);
    try {
      const viewId = crypto.randomUUID();
      const base64Data = pendingViewState.screenshotDataUrl.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      await supabase.storage.from('saved-view-screenshots').upload(`${viewId}.png`, blob, { contentType: 'image/png' });
      const { data: urlData } = supabase.storage.from('saved-view-screenshots').getPublicUrl(`${viewId}.png`);
      const { error } = await supabase.from('saved_views').insert({
        id: viewId, name, description: description || null,
        building_fm_guid: pendingViewState.buildingFmGuid, building_name: pendingViewState.buildingName,
        screenshot_url: urlData?.publicUrl || null,
        camera_eye: pendingViewState.cameraEye, camera_look: pendingViewState.cameraLook,
        camera_up: pendingViewState.cameraUp, camera_projection: pendingViewState.cameraProjection,
        view_mode: pendingViewState.viewMode, clip_height: pendingViewState.clipHeight,
        visible_model_ids: pendingViewState.visibleModelIds, visible_floor_ids: pendingViewState.visibleFloorIds,
        show_spaces: pendingViewState.showSpaces, show_annotations: pendingViewState.showAnnotations,
        visualization_type: pendingViewState.visualizationType, visualization_mock_data: pendingViewState.visualizationMockData,
      });
      if (error) throw error;
      toast({ title: "View saved!", description: `"${name}" has been saved` });
      setShowCreateViewDialog(false);
      setPendingViewState(null);
    } catch (err) {
      console.error('Failed to save view:', err);
      toast({ title: "Error", description: "Could not save view", variant: "destructive" });
      throw err;
    } finally { setIsSavingView(false); }
  }, [pendingViewState]);

  /* ── Set start view ── */
  const handleSetStartView = useCallback(async () => {
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer || !buildingData.fmGuid) return;
    setIsSavingStartView(true);
    try {
      const camera = xeokitViewer.camera;
      const viewId = crypto.randomUUID();
      const building = allData.find((b: any) => b.fmGuid === buildingData.fmGuid && b.category === 'Building');
      const { error: insertError } = await supabase.from('saved_views').insert({
        id: viewId, name: `Start view – ${buildingData.name || building?.commonName || 'Unknown'}`,
        building_fm_guid: buildingData.fmGuid, building_name: buildingData.name,
        camera_eye: [...camera.eye], camera_look: [...camera.look], camera_up: [...camera.up],
        camera_projection: camera.projection, view_mode: viewMode === '2d' ? '2d' : '3d', clip_height: clipHeight,
        visible_model_ids: [], visible_floor_ids: [], show_spaces: showSpaces, show_annotations: showAnnotations,
      });
      if (insertError) throw insertError;
      await supabase.from('building_settings').update({ start_view_id: viewId }).eq('fm_guid', buildingData.fmGuid);
      toast({ title: "Start view saved!", description: "This view will now be used as default on open" });
    } catch (err) {
      console.error('Failed to set start view:', err);
      toast({ title: "Error", description: "Could not save start view", variant: "destructive" });
    } finally { setIsSavingStartView(false); }
  }, [viewerInstanceRef, buildingData, allData, viewMode, clipHeight, showSpaces, showAnnotations]);

  /* ── Issue creation ── */
  const captureIssueState = useCallback(() => {
    const screenshot = captureScreenshot();
    const viewpoint = captureViewpoint();
    const selectedObjects = getSelectedObjectIds();
    if (!screenshot) { toast({ title: "Could not capture screenshot", variant: "destructive" }); return; }
    setPendingIssueState({ screenshot, viewpoint, selectedObjects });
    setShowCreateIssueDialog(true);
  }, [captureScreenshot, captureViewpoint, getSelectedObjectIds]);

  const handleSubmitIssue = useCallback(async (data: { title: string; description: string; issueType: string; priority: string }) => {
    if (!pendingIssueState || !user || !buildingData.fmGuid) return;
    setIsSubmittingIssue(true);
    try {
      const issueId = crypto.randomUUID();
      const base64Data = pendingIssueState.screenshot.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      await supabase.storage.from('issue-screenshots').upload(`${issueId}.png`, blob, { contentType: 'image/png' });
      const { data: urlData } = supabase.storage.from('issue-screenshots').getPublicUrl(`${issueId}.png`);
      const { error } = await supabase.from('bcf_issues').insert({
        id: issueId, title: data.title, description: data.description || null,
        issue_type: data.issueType, priority: data.priority, status: 'open',
        viewpoint_json: pendingIssueState.viewpoint, screenshot_url: urlData?.publicUrl || null,
        building_fm_guid: buildingData.fmGuid, building_name: buildingData.name,
        selected_object_ids: pendingIssueState.selectedObjects, reported_by: user.id,
      });
      if (error) throw error;
      toast({ title: "Issue created!", description: `"${data.title}" has been submitted` });
      setShowCreateIssueDialog(false);
      setPendingIssueState(null);
    } catch (err) {
      console.error('Failed to create issue:', err);
      toast({ title: "Could not create issue", variant: "destructive" });
    } finally { setIsSubmittingIssue(false); }
  }, [pendingIssueState, user, buildingData]);

  /* ── Menu item handlers ── */
  const handleMenuItem = useCallback((id: string) => {
    switch (id) {
      case 'viewMode': setSubSheet('viewMode'); break;
      case 'filter': setSheetOpen(false); setTimeout(() => setShowFilterPanel(true), 200); break;
      case 'display': setSubSheet('display'); break;
      case 'colorFilter': setSubSheet('colorFilter'); break;
      case 'actions': setSubSheet('actions'); break;
      case 'settings': setSubSheet('settings'); break;
      case 'insights':
        setSheetOpen(false);
        setTimeout(() => setInsightsPanelOpen(true), 200);
        break;
    }
  }, [setInsightsPanelOpen]);

  const visibleTools = ALL_TOOLS.filter((t) => enabledTools.includes(t.id));
  const modeLabel = modes.find(m => m.mode === viewMode)?.label ?? '3D';

  /* ── Sub-sheet back button ── */
  const BackButton = () => (
    <Button variant="ghost" size="sm" onClick={() => setSubSheet(null)} className="h-7 px-2">← Back</Button>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-black"
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
    >
      {/* ── 3D Canvas (edge-to-edge, behind overlays) ── */}
      <div className="absolute inset-0">
        {isSplit ? (
          <>
            <div className="absolute top-0 left-0 right-0 overflow-hidden" style={{ height: '50%' }}>
              <div className="h-full w-full" style={{ visibility: splitPlanReady ? 'visible' : 'hidden' }}>
                <SplitPlanView viewerRef={viewerInstanceRef} buildingFmGuid={buildingData.fmGuid} className="h-full" syncFloorSelection lockCameraToFloor monochrome />
              </div>
              {!splitPlanReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="absolute left-0 right-0 z-30 h-1 bg-border" style={{ top: '50%', transform: 'translateY(-50%)' }} />
            <div className="absolute left-0 right-0 bottom-0 overflow-hidden" style={{ height: '50%' }}>
              <NativeViewerShell buildingFmGuid={buildingData.fmGuid} onClose={onGoBack} hideBackButton hideMobileOverlay hideToolbar hideFloorSwitcher showGeminusMenu={false} />
            </div>
          </>
        ) : viewMode === '360' && hasIvion ? (
          <div ref={sdkContainerRef} className="h-full w-full" />
        ) : (
          <NativeViewerShell buildingFmGuid={buildingData.fmGuid} onClose={onGoBack} hideBackButton hideMobileOverlay hideToolbar hideFloorSwitcher showGeminusMenu={viewMode === '3d'} />
        )}
      </div>

      {/* ── Transparent top bar ── */}
      <div
        className="relative z-50 flex items-center justify-between px-3 pointer-events-none"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)', paddingBottom: '6px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 100%)' }}
      >
        <Button variant="ghost" size="icon" onClick={onGoBack} className="h-8 w-8 text-white hover:bg-white/20 pointer-events-auto">
          <X className="h-5 w-5" />
        </Button>
        <span className="text-white text-xs font-medium truncate max-w-[50vw] pointer-events-none">{buildingData.name}</span>
        <Button variant="ghost" size="icon" onClick={() => { setSubSheet(null); setSheetOpen(true); }} className="h-8 w-8 text-white hover:bg-white/20 pointer-events-auto">
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Floor popover pill ── */}
      {floors.length > 1 && !isSplit && (
        <div className="relative z-50 flex justify-center pb-1 pointer-events-none">
          <Popover>
            <PopoverTrigger asChild>
              <button className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-medium hover:bg-black/70 transition-colors">
                <Layers className="h-3.5 w-3.5" />
                {soloFloorId ? floors.find(f => f.id === soloFloorId)?.shortName || 'All' : 'All'}
                <ChevronUp className="h-3 w-3 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" sideOffset={8} className="w-auto min-w-[120px] max-w-[200px] p-1.5 bg-popover/95 backdrop-blur-md">
              <div className="flex flex-col gap-0.5 max-h-[40dvh] overflow-y-auto">
                {floors.map((floor) => (
                  <button
                    key={floor.id}
                    onClick={() => handleFloorClick(floor)}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-colors ${soloFloorId === floor.id ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}
                  >
                    {floor.name}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* ── Compact bottom toolbar ── */}
      <div
        className="relative z-50 flex items-center justify-around pointer-events-none"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)', paddingTop: '12px',
          paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)',
          background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)',
        }}
      >
        {visibleTools.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => handleToolClick(id)}
            className={`pointer-events-auto flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-colors ${
              activeTool === id ? 'text-primary' : id === 'xray' && isXrayActive ? 'text-primary' : 'text-white/70 hover:text-white'
            }`}
            title={label}
          >
            <Icon className="h-5 w-5" />
          </button>
        ))}
        <button
          onClick={() => { setSubSheet('toolbarConfig'); setSheetOpen(true); }}
          className="pointer-events-auto flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-colors text-white/50 hover:text-white"
          title="Toolbar Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* ── Action Sheet (Drawer) ── */}
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[92dvh]">
          <ScrollArea className="max-h-[88dvh]">

          {/* ── Main menu ── */}
          {subSheet === null && (
            <>
              <DrawerHeader className="pb-2">
                <DrawerTitle className="text-base">Menu</DrawerTitle>
              </DrawerHeader>
              <div className="px-2 pb-6 space-y-0.5">
                {MENU_ITEMS.map(({ id, Icon, label, hasSubmenu }) => (
                  <button
                    key={id}
                    onClick={() => handleMenuItem(id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg hover:bg-muted/60 transition-colors"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground flex-1 text-left">{label}</span>
                    {id === 'viewMode' && <span className="text-xs text-muted-foreground">{modeLabel}</span>}
                    {hasSubmenu && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── View Mode sub-sheet ── */}
          {subSheet === 'viewMode' && (
            <>
              <DrawerHeader className="pb-2">
                <div className="flex items-center gap-2"><BackButton /><DrawerTitle className="text-base">View Mode</DrawerTitle></div>
              </DrawerHeader>
              <div className="px-2 pb-6 space-y-0.5">
                {modes.map(({ mode, label, Icon }) => (
                  <button
                    key={mode}
                    onClick={() => { handleModeChange(mode); setSubSheet(null); setSheetOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-4 rounded-lg transition-colors ${viewMode === mode ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60 text-foreground'}`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium flex-1 text-left">{label}</span>
                    {viewMode === mode && <Eye className="h-4 w-4 text-primary" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Display sub-sheet ── */}
          {subSheet === 'display' && (
            <>
              <DrawerHeader className="pb-2">
                <div className="flex items-center gap-2"><BackButton /><DrawerTitle className="text-base">Display</DrawerTitle></div>
              </DrawerHeader>
              <div className="px-4 pb-6 space-y-4">
                {/* BIM Models */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Box className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">BIM Models</span>
                  </div>
                  <div className="pl-6">
                    <ModelVisibilitySelector viewerRef={viewerInstanceRef} buildingFmGuid={buildingData.fmGuid} listOnly />
                  </div>
                </div>

                <Separator />

                {/* Show spaces */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn("p-1.5 rounded-md", showSpaces ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                      {showSpaces ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </div>
                    <span className="text-sm">Show spaces</span>
                  </div>
                  <Switch checked={showSpaces} onCheckedChange={handleToggleSpaces} />
                </div>

                {/* Minimap */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-muted text-muted-foreground"><Map className="h-4 w-4" /></div>
                    <span className="text-sm">Minimap</span>
                  </div>
                  <Switch checked={showMinimap} onCheckedChange={(checked) => { setShowMinimap(checked); window.dispatchEvent(new CustomEvent(MINIMAP_TOGGLE_EVENT, { detail: { visible: checked } })); }} />
                </div>

                {/* Annotations */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn("p-1.5 rounded-md", showAnnotations ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                        <MessageSquare className="h-4 w-4" />
                      </div>
                      <span className="text-sm">Annotations</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch checked={showAnnotations} onCheckedChange={handleToggleAnnotations} />
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setAnnotationsExpanded(!annotationsExpanded)}>
                        <ChevronDown className={cn("h-3 w-3 transition-transform", annotationsExpanded && "rotate-180")} />
                      </Button>
                    </div>
                  </div>
                  {annotationsExpanded && (
                    <div className="pl-8 pt-2">
                      <AnnotationCategoryList viewerRef={viewerInstanceRef} buildingFmGuid={buildingData.fmGuid} />
                    </div>
                  )}
                </div>

                <Separator />

                {/* Show Issues */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn("p-1.5 rounded-md", showIssues ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                      <MessageSquare className="h-4 w-4" />
                    </div>
                    <span className="text-sm">Show Issues</span>
                  </div>
                  <Switch checked={showIssues} onCheckedChange={(checked) => { setShowIssues(checked); window.dispatchEvent(new CustomEvent(ISSUE_ANNOTATIONS_TOGGLE_EVENT, { detail: { visible: checked } })); }} />
                </div>

                {/* Show Alarms */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn("p-1.5 rounded-md", showAlarms ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <span className="text-sm">Show Alarms</span>
                  </div>
                  <Switch checked={showAlarms} onCheckedChange={(checked) => { setShowAlarms(checked); window.dispatchEvent(new CustomEvent(ALARM_ANNOTATIONS_SHOW_EVENT, { detail: { alarms: [], flyTo: false, visible: checked } })); }} />
                </div>

                {/* Show Sensors */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn("p-1.5 rounded-md", showSensors ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                      <Radio className="h-4 w-4" />
                    </div>
                    <span className="text-sm">Show Sensors</span>
                  </div>
                  <Switch checked={showSensors} onCheckedChange={(checked) => { setShowSensors(checked); window.dispatchEvent(new CustomEvent(SENSOR_ANNOTATIONS_TOGGLE_EVENT, { detail: { visible: checked } })); }} />
                </div>
              </div>
            </>
          )}

          {/* ── Color filter sub-sheet ── */}
          {subSheet === 'colorFilter' && (
            <>
              <DrawerHeader className="pb-2">
                <div className="flex items-center gap-2"><BackButton /><DrawerTitle className="text-base">Color filter</DrawerTitle></div>
              </DrawerHeader>
              <div className="px-4 pb-6">
                <RoomVisualizationPanel
                  viewerRef={viewerInstanceRef}
                  buildingFmGuid={buildingData.fmGuid}
                  onShowSpaces={(show) => { setShowSpaces(show); try { viewerInstanceRef.current?.assetViewer?.onShowSpacesChanged?.(show); } catch (e) {} }}
                  embedded
                />
              </div>
            </>
          )}

          {/* ── Actions sub-sheet ── */}
          {subSheet === 'actions' && (
            <>
              <DrawerHeader className="pb-2">
                <div className="flex items-center gap-2"><BackButton /><DrawerTitle className="text-base">Actions</DrawerTitle></div>
              </DrawerHeader>
              <div className="px-4 pb-6 space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2 h-11" onClick={() => { setSheetOpen(false); setTimeout(captureViewState, 300); }} disabled={!viewerReady}>
                  <div className="p-1.5 rounded-md bg-primary/10 text-primary"><Camera className="h-4 w-4" /></div>
                  <span className="text-sm">Create view</span>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 h-11" onClick={() => { setSheetOpen(false); setTimeout(handleSetStartView, 300); }} disabled={!viewerReady || isSavingStartView}>
                  <div className="p-1.5 rounded-md bg-primary/10 text-primary"><Home className="h-4 w-4" /></div>
                  <span className="text-sm">{isSavingStartView ? 'Saving…' : 'Set as start view'}</span>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 h-11" onClick={() => { setSheetOpen(false); setTimeout(captureIssueState, 300); }} disabled={!viewerReady}>
                  <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-600"><MessageSquarePlus className="h-4 w-4" /></div>
                  <span className="text-sm">Create issue</span>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 h-11" onClick={() => { setSheetOpen(false); window.dispatchEvent(new CustomEvent(VIEWER_CREATE_ASSET_EVENT)); }}>
                  <div className="p-1.5 rounded-md bg-primary/10 text-primary"><Plus className="h-4 w-4" /></div>
                  <span className="text-sm">Register asset</span>
                </Button>
              </div>
            </>
          )}

          {/* ── Settings sub-sheet ── */}
          {subSheet === 'settings' && (
            <>
              <DrawerHeader className="pb-2">
                <div className="flex items-center gap-2"><BackButton /><DrawerTitle className="text-base">Settings</DrawerTitle></div>
              </DrawerHeader>
              <div className="px-4 pb-6 space-y-5">
                {/* Clip height */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-muted text-muted-foreground"><Scissors className="h-4 w-4" /></div>
                    <span className="text-sm">Clip height (2D view)</span>
                    <span className="text-xs font-medium ml-auto">{clipHeight.toFixed(1)}m</span>
                  </div>
                  <div className="pl-10">
                    <Slider value={[clipHeight]} onValueChange={handleClipHeightChange} min={0.5} max={2.5} step={0.1} className="w-full" />
                    <p className="text-xs text-muted-foreground mt-1">Height above floor</p>
                  </div>
                </div>

                <Separator />

                {/* Room labels */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={cn("p-1.5 rounded-md", showRoomLabels ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                      <Type className="h-4 w-4" />
                    </div>
                    <span className="text-sm">Room labels</span>
                  </div>
                  <div className="pl-10 space-y-1">
                    {loadingRoomLabelConfigs ? (
                      <div className="text-xs text-muted-foreground">Loading...</div>
                    ) : (
                      <>
                        <button
                          className={cn("w-full text-left px-2 py-1.5 rounded text-xs transition-colors", !showRoomLabels ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50")}
                          onClick={() => handleRoomLabelConfigSelect('off')}
                        >Off</button>
                        {roomLabelConfigs.map((config) => (
                          <button
                            key={config.id}
                            className={cn("w-full text-left px-2 py-1.5 rounded text-xs transition-colors", activeRoomLabelConfigId === config.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50")}
                            onClick={() => handleRoomLabelConfigSelect(config.id)}
                          >
                            {config.name}
                            {config.is_default && <span className="ml-1 text-[10px] text-muted-foreground">(standard)</span>}
                          </button>
                        ))}
                        {roomLabelConfigs.length === 0 && <div className="text-xs text-muted-foreground py-1">No configurations. Create in Settings.</div>}
                      </>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Viewer theme */}
                <ViewerThemeSelector viewerRef={viewerInstanceRef} disabled={!viewerReady} />

                <Separator />

                {/* Lighting */}
                <LightingControlsPanel viewerRef={viewerInstanceRef} isViewerReady={viewerReady} />
              </div>
            </>
          )}

          {/* ── Toolbar config sub-sheet ── */}
          {subSheet === 'toolbarConfig' && (
            <>
              <DrawerHeader className="pb-2">
                <div className="flex items-center gap-2"><BackButton /><DrawerTitle className="text-base">Toolbar</DrawerTitle></div>
              </DrawerHeader>
              <div className="px-2 pb-6 space-y-0.5">
                {ALL_TOOLS.map(({ id, Icon, label }) => (
                  <div key={id} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg">
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground flex-1 text-left">{label}</span>
                    <Switch
                      checked={enabledTools.includes(id)}
                      onCheckedChange={() => setEnabledTools(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          </ScrollArea>
        </DrawerContent>
      </Drawer>

      {/* ── Filter panel (opens as fixed overlay) ── */}
      <ViewerFilterPanel
        viewerRef={viewerInstanceRef}
        buildingFmGuid={buildingData.fmGuid}
        isVisible={showFilterPanel}
        onClose={() => setShowFilterPanel(false)}
      />

      {/* ── Insights panel ── */}
      {insightsPanelOpen && (
        <InsightsDrawerPanel
          buildingFmGuid={buildingData.fmGuid}
          buildingName={buildingData.name}
          open={insightsPanelOpen}
          onClose={() => setInsightsPanelOpen(false)}
        />
      )}

      {/* ── Dialogs ── */}
      <CreateViewDialog
        open={showCreateViewDialog}
        onClose={() => { setShowCreateViewDialog(false); setPendingViewState(null); }}
        onSave={handleSaveView}
        viewState={pendingViewState}
        isSaving={isSavingView}
      />
      <CreateIssueDialog
        open={showCreateIssueDialog}
        onClose={() => { setShowCreateIssueDialog(false); setPendingIssueState(null); }}
        onSubmit={handleSubmitIssue}
        screenshotUrl={pendingIssueState?.screenshot}
        buildingName={buildingData.name}
        isSubmitting={isSubmittingIssue}
        selectedObjectIds={pendingIssueState?.selectedObjects}
      />
    </div>
  );
};

export default MobileViewerPage;
