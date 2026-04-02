import React, { useEffect, useRef, useState, useCallback, useContext, useMemo } from 'react';
import { AlertCircle, X, Maximize2, Minimize2, TreeDeciduous, Menu, Filter } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ViewerToolbar from './ViewerToolbar';
import MinimapPanel from './MinimapPanel';
import FloorCarousel, { FloorInfo } from './FloorCarousel';
import FloatingFloorSwitcher from './FloatingFloorSwitcher';
import VisualizationLegendBarOverlay from './VisualizationLegendOverlay';
import VisualizationQuickBar from './VisualizationQuickBar';
// AnnotationToggleMenu removed - consolidated into VisualizationToolbar flyout
import AssetPropertiesDialog from './AssetPropertiesDialog';
import ViewerContextMenu from './ViewerContextMenu';
import CreateWorkOrderDialog from './CreateWorkOrderDialog';

import ViewerTreePanel from './ViewerTreePanel';
import ViewerFilterPanel from './ViewerFilterPanel';
import ViewerRightPanel from './ViewerRightPanel';
import InventoryFormSheet from '@/components/inventory/InventoryFormSheet';
import MobileViewerOverlay from './mobile/MobileViewerOverlay';
import { xktCacheService } from '@/services/xkt-cache-service';
import { isModelInMemory, getModelFromMemory, storeModelInMemory, getMemoryStats, clearBuildingFromMemory } from '@/hooks/useXktPreload';
import { useFlashHighlight } from '@/hooks/useFlashHighlight';
import { usePerformancePlugins } from '@/hooks/usePerformancePlugins';
import { useIsMobile } from '@/hooks/use-mobile';
import type { VisualizationType } from '@/lib/visualization-utils';
import { NavigatorNode } from '@/components/navigator/TreeNode';
import { LOAD_SAVED_VIEW_EVENT, LoadSavedViewDetail, VIEW_MODE_REQUESTED_EVENT, VIEWER_CONTEXT_CHANGED_EVENT, ViewerContextChangedDetail, INSIGHTS_COLOR_UPDATE_EVENT, InsightsColorUpdateDetail, ALARM_ANNOTATIONS_SHOW_EVENT, AlarmAnnotationsShowDetail, ANNOTATION_FILTER_EVENT, AnnotationFilterDetail, ISSUE_MARKER_CLICKED_EVENT, SENSOR_ANNOTATIONS_TOGGLE_EVENT, ISSUE_ANNOTATIONS_TOGGLE_EVENT, type SensorAnnotationsToggleDetail, type IssueAnnotationsToggleDetail } from '@/lib/viewer-events';
import { CLIP_HEIGHT_CHANGED_EVENT, VIEW_MODE_CHANGED_EVENT, FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { useArchitectViewMode, ARCHITECT_MODE_REQUESTED_EVENT, ARCHITECT_MODE_CHANGED_EVENT, ARCHITECT_BACKGROUND_CHANGED_EVENT, type BackgroundPresetId } from '@/hooks/useArchitectViewMode';
import { useRoomLabels, ROOM_LABELS_TOGGLE_EVENT, type RoomLabelsToggleDetail } from '@/hooks/useRoomLabels';
// import { useLevelLabels } from '@/hooks/useLevelLabels'; // disabled
import { useViewerCameraSync } from '@/hooks/useViewerCameraSync';
import { useModelNames } from '@/hooks/useModelNames';
import type { LocalCoords } from '@/context/ViewerSyncContext';
import { emit, on } from '@/lib/event-bus';
import {
  calculateHeadingFromCamera,
  calculatePitchFromCamera,
  calculateLookFromHeadingPitch,
} from '@/lib/coordinate-transform';

interface AssetPlusViewerProps {
  fmGuid: string;
  initialFmGuidToFocus?: string;  // Entity to focus on (floor/room) - uses fmGuid if not provided
  onClose?: () => void;
  // External pick mode control for asset registration flow
  pickModeEnabled?: boolean;
  onCoordinatePicked?: (
    coords: { x: number; y: number; z: number },
    parentNode: NavigatorNode | null
  ) => void;
  // Camera sync props for Split View
  syncEnabled?: boolean;
  onCameraChange?: (position: LocalCoords, heading: number, pitch: number) => void;
  syncPosition?: LocalCoords | null;
  syncHeading?: number;
  syncPitch?: number;
  // Virtual Twin overlay mode
  /** When true, canvas background is transparent and UI overlays are hidden */
  transparentBackground?: boolean;
  /** Ghost opacity for all objects (0-1). Only applied in transparent mode. */
  ghostOpacity?: number;
  /** When true, suppresses MobileViewerOverlay and desktop toolbar (used when embedded in Virtual Twin) */
  suppressOverlay?: boolean;
  /** When set, auto-activates room visualization of this type after model load */
  initialVisualization?: VisualizationType;
  /** Insights color mode — triggers X-Ray + colorization from sessionStorage color map */
  insightsColorMode?: string;
  /** Force X-Ray mode on (used with insightsColorMode) */
  forceXray?: boolean;
  /** Direct color map prop (for inline desktop viewer, avoids sessionStorage) */
  insightsColorMap?: Record<string, [number, number, number]>;
  /** When true, hides toolbar, NavCube, and floor switcher (used in small Insights panel) */
  compactMode?: boolean;
  /** Mobile mode switch — current mode */
  mobileViewMode?: '2d' | '3d' | '360';
  /** Mobile mode switch — callback */
  onMobileChangeViewMode?: (mode: '2d' | '3d' | '360') => void;
  /** Mobile mode switch — has Ivion (360°) */
  mobileHasIvion?: boolean;
}

/**
 * Manual world→canvas projection (replaces camera.project which doesn't exist in this xeokit build).
 * Returns [canvasX, canvasY, clipDepth] or null if behind camera.
 */
function projectWorldToCanvas(
  worldPos: number[],
  viewMatrix: Float64Array | number[],
  projMatrix: Float64Array | number[],
  canvasWidth: number,
  canvasHeight: number,
): [number, number, number] | null {
  // view transform
  const vx = viewMatrix[0] * worldPos[0] + viewMatrix[4] * worldPos[1] + viewMatrix[8] * worldPos[2] + viewMatrix[12];
  const vy = viewMatrix[1] * worldPos[0] + viewMatrix[5] * worldPos[1] + viewMatrix[9] * worldPos[2] + viewMatrix[13];
  const vz = viewMatrix[2] * worldPos[0] + viewMatrix[6] * worldPos[1] + viewMatrix[10] * worldPos[2] + viewMatrix[14];
  const vw = viewMatrix[3] * worldPos[0] + viewMatrix[7] * worldPos[1] + viewMatrix[11] * worldPos[2] + viewMatrix[15];
  // projection transform
  const px = projMatrix[0] * vx + projMatrix[4] * vy + projMatrix[8] * vz + projMatrix[12] * vw;
  const py = projMatrix[1] * vx + projMatrix[5] * vy + projMatrix[9] * vz + projMatrix[13] * vw;
  const pw = projMatrix[3] * vx + projMatrix[7] * vy + projMatrix[11] * vz + projMatrix[15] * vw;
  if (pw === 0) return null;
  const ndcX = px / pw;
  const ndcY = py / pw;
  const canvasX = (ndcX + 1) * 0.5 * canvasWidth;
  const canvasY = (1 - ndcY) * 0.5 * canvasHeight;
  return [canvasX, canvasY, -vz]; // positive depth = in front of camera
}

interface ViewerState {
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  modelInfo: {
    name?: string;
    type?: string;
    objectCount?: number;
    lastUpdated?: string;
  } | null;
}

type InitStep =
  | 'idle'
  | 'wait_dom'
  | 'fetch_token'
  | 'fetch_config'
  | 'check_script'
  | 'mount_viewer'
  | 'request_models'
  | 'ready'
  | 'error';

type ModelLoadState = 'idle' | 'requested' | 'loaded';

// Default camera settings from external_viewer.html
const defaultHeightAboveAABB = 1;
const defaultMinimumHeightAboveBase = 2.6;
const lookAtSpaceAndInstanceFlyToDuration = 1;

/**
 * Asset+ 3D Viewer Component
 * 
 * Integrates with the Asset+ 3D Viewer package to display BIM models.
 * Based on Asset+ external_viewer.html implementation pattern.
 */
const AssetPlusViewer: React.FC<AssetPlusViewerProps> = ({ 
  fmGuid, 
  initialFmGuidToFocus,
  onClose, 
  pickModeEnabled, 
  onCoordinatePicked,
  syncEnabled = false,
  onCameraChange,
  syncPosition,
  syncHeading,
  syncPitch,
  transparentBackground = false,
  ghostOpacity,
  suppressOverlay = false,
  initialVisualization,
  insightsColorMode,
  forceXray,
  insightsColorMap: insightsColorMapProp,
  compactMode = false,
  mobileViewMode,
  onMobileChangeViewMode,
  mobileHasIvion = false,
}) => {
  const { allData } = useContext(AppContext);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewportWrapperRef = useRef<HTMLDivElement>(null);
  const viewerInstanceRef = useRef<any>(null);
  const navCubeRef = useRef<any>(null);
  const accessTokenRef = useRef<string>('');
  const baseUrlRef = useRef<string>('');
  const originalFetchRef = useRef<typeof fetch | null>(null);
  // Prevent concurrent initializations (React Strict Mode double-mount protection)
  const initializingRef = useRef(false);
  
  // Mobile detection
  const isMobile = useIsMobile();
  
  // Deferred loading state (matching Asset+ pattern exactly)
  const deferCallsRef = useRef(true);
  const deferredFmGuidRef = useRef<string | undefined>(undefined);
  const deferredDisplayActionRef = useRef<any>(undefined);
  const deferredFmGuidForDisplayRef = useRef<string | undefined>(undefined);
  const deferredDisplayActionForDisplayRef = useRef<any>(undefined);
  const flashOnSelectEnabledRef = useRef(true);
  
  const [state, setState] = useState<ViewerState>({
    isLoading: true,
    isInitialized: false,
    error: null,
    modelInfo: null,
  });
  
  // Separate flag to suppress flashing error messages during initialization
  // The error is set internally but only displayed after a delay
  const [showError, setShowError] = useState(false);
  const showErrorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [initStep, setInitStep] = useState<InitStep>('idle');
  const [modelLoadState, setModelLoadState] = useState<ModelLoadState>('idle');
  const [cacheStatus, setCacheStatus] = useState<'checking' | 'hit' | 'miss' | 'stored' | null>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const [showNavCube, setShowNavCube] = useState(true);

  // Refs to track volatile state for stable callbacks (prevents re-init cascade)
  const cacheStatusRef = useRef(cacheStatus);
  const showNavCubeRef = useRef(showNavCube);
  const loadLocalAnnotationsRef = useRef<(() => Promise<void>) | null>(null);
  const loadSensorAnnotationsRef = useRef<(() => Promise<void>) | null>(null);
  const sensorAnnotationsLoadedRef = useRef(false);
  const loadIssueAnnotationsRef = useRef<(() => Promise<void>) | null>(null);
  const issueAnnotationsLoadedRef = useRef(false);
  const assetDataRef = useRef<any>(null);
  const allDataRef = useRef<any[]>(allData);
  const insightsColorModeRef = useRef(insightsColorMode);

  // Refs for callbacks used inside initializeViewer (stabilizes its dependency array)
  const handleAllModelsLoadedRef = useRef<() => void>(() => {});
  const changeXrayMaterialRef = useRef<() => void>(() => {});
  const processDeferredRef = useRef<() => void>(() => {});
  const displayFmGuidRef = useRef<(fmGuid: string, displayAction?: any) => void>(() => {});
  const setupCacheInterceptorRef = useRef<() => void>(() => {});

  // Keep refs in sync with state
  useEffect(() => { cacheStatusRef.current = cacheStatus; }, [cacheStatus]);
  useEffect(() => { showNavCubeRef.current = showNavCube; }, [showNavCube]);
  useEffect(() => { allDataRef.current = allData; }, [allData]);
  useEffect(() => { insightsColorModeRef.current = insightsColorMode; }, [insightsColorMode]);

  // Coordinate picker state
  const [isPickMode, setIsPickMode] = useState(false);
  const [pickedCoordinates, setPickedCoordinates] = useState<{ x: number; y: number; z: number } | null>(null);
  const [pendingPickCoords, setPendingPickCoords] = useState<{ x: number; y: number; z: number } | null>(null);
  const [tempMarkerElement, setTempMarkerElement] = useState<HTMLDivElement | null>(null);
  const [addAssetDialogOpen, setAddAssetDialogOpen] = useState(false);
  const [addAssetParentNode, setAddAssetParentNode] = useState<NavigatorNode | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [showFloorCarousel, setShowFloorCarousel] = useState(false);
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [selectedFmGuids, setSelectedFmGuids] = useState<string[]>([]);
  
  const [showTreePanel, setShowTreePanel] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [visibleFloorFmGuids, setVisibleFloorFmGuids] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const issueAnnotationsVisibleRef = useRef(true);
  const sensorAnnotationsVisibleRef = useRef(false);
  
  // Mobile floors state for visibility control (internal — no longer imported from overlay)
  const [mobileFloors, setMobileFloors] = useState<{ id: string; fmGuid: string; name: string; visible: boolean }[]>([]);
  
  // CENTRALIZED showSpaces state - ALWAYS starts OFF
  const [showSpaces, setShowSpaces] = useState(false);
  const [flashOnSelectEnabled, setFlashOnSelectEnabledState] = useState(true);
  const [hoverHighlightEnabled, setHoverHighlightEnabled] = useState(false);
  
  // Mobile overlay state for room labels and BIM models
  const [showRoomLabels, setShowRoomLabels] = useState(false);
  const [availableModels, setAvailableModels] = useState<{id: string; name: string; visible: boolean}[]>([]);
  const pickModeListenerRef = useRef<(() => void) | null>(null);
  const hoverListenerRef = useRef<(() => void) | null>(null);
  
  // Inventory form sheet state
  const [inventorySheetOpen, setInventorySheetOpen] = useState(false);
  const [inventoryPendingPosition, setInventoryPendingPosition] = useState<{x: number; y: number; z: number} | null>(null);
  const inventoryPickModeRef = useRef(false);
  
  // XKT sync status for visual feedback
  const [xktSyncStatus, setXktSyncStatus] = useState<'idle' | 'checking' | 'syncing' | 'done' | 'error'>('idle');
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    entityId: string | null;
    fmGuid: string | null;
    entityName: string | null;
  } | null>(null);
  const [workOrderDialogOpen, setWorkOrderDialogOpen] = useState(false);
  const [workOrderContext, setWorkOrderContext] = useState<{ objectName?: string; objectFmGuid?: string }>({});
  
  // Whitelist of model IDs allowed during initial load (null = allow all)
  const allowedModelIdsRef = useRef<Set<string> | null>(null);
  const [spacesCacheReady, setSpacesCacheReady] = useState(false);
  
  // Ref for local annotations plugin
  const localAnnotationsPluginRef = useRef<any>(null);
  
  // Keep ref in sync with state for callback access
  const setFlashOnSelectEnabled = useCallback((enabled: boolean) => {
    flashOnSelectEnabledRef.current = enabled;
    setFlashOnSelectEnabledState(enabled);
  }, []);
  
  // Flash highlighting hook
  const { flashEntityById, stopFlashing } = useFlashHighlight();
  
  // Architect view mode hook
  const { toggleArchitectMode, isActive: isArchitectModeActive, setBackgroundPreset, applyBackgroundPreset } = useArchitectViewMode();
  
  // Room labels hook
  const { setLabelsEnabled: setRoomLabelsEnabled, updateViewMode: updateLabelsViewMode, updateFloorFilter } = useRoomLabels(viewerInstanceRef);

  // Level (storey) labels hook — disabled for now
  // const { setLabelsEnabled: setLevelLabelsEnabled } = useLevelLabels(viewerInstanceRef, fmGuid);

  // Performance plugins (FastNav, ViewCull, LOD)
  usePerformancePlugins({
    viewerRef: viewerInstanceRef,
    ready: modelLoadState === 'loaded' && initStep === 'ready',
    isMobile: !!isMobile,
  });

  const initialVisAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialVisualization || initialVisualization === 'none') return;
    if (modelLoadState !== 'loaded' || initStep !== 'ready') return;
    if (initialVisAppliedRef.current) return;
    initialVisAppliedRef.current = true;

    // Dispatch event to activate room visualization via RoomVisualizationPanel
    console.log('[AssetPlusViewer] Auto-activating visualization:', initialVisualization);
    emit('INITIAL_VISUALIZATION_REQUESTED', { type: initialVisualization },);
  }, [initialVisualization, modelLoadState, initStep]);

  // ─── Insights color mode: apply visibility + colorization ───
  // Keep a ref to preserve sessionStorage data across re-renders
  const insightsColorMapCacheRef = useRef<{ mode: string; colorMap: Record<string, [number, number, number]> } | null>(null);

  // Read sessionStorage eagerly when insightsColorMode is set (before guards)
  useEffect(() => {
    if (!insightsColorMode) {
      insightsColorMapCacheRef.current = null;
      return;
    }
    if (insightsColorMapProp && Object.keys(insightsColorMapProp).length > 0) {
      insightsColorMapCacheRef.current = { mode: insightsColorMode, colorMap: insightsColorMapProp };
      return;
    }
    // Only read from sessionStorage if we don't already have a cached value
    if (insightsColorMapCacheRef.current) return;
    const raw = sessionStorage.getItem('insights_color_map');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        insightsColorMapCacheRef.current = { mode: parsed.mode || insightsColorMode, colorMap: parsed.colorMap || {} };
        sessionStorage.removeItem('insights_color_map');
        console.log('[AssetPlusViewer] Cached insights color map from sessionStorage:', Object.keys(insightsColorMapCacheRef.current.colorMap).length, 'entries');
      } catch { /* ignore */ }
    }
  }, [insightsColorMode, insightsColorMapProp]);

  useEffect(() => {
    if (!insightsColorMode) return;
    if (!spacesCacheReady) {
      console.log('[AssetPlusViewer] Insights waiting for spacesCacheReady...');
      return;
    }
    if (modelLoadState !== 'loaded' || initStep !== 'ready') {
      console.log('[AssetPlusViewer] Insights waiting for model:', modelLoadState, initStep);
      return;
    }

    // Determine color map from cache
    const cached = insightsColorMapCacheRef.current;
    if (!cached || Object.keys(cached.colorMap).length === 0) {
      console.warn('[AssetPlusViewer] insightsColorMode set but no color map available (cached:', !!cached, ')');
      return;
    }
    const colorMap = cached.colorMap;
    let mode = cached.mode;

    // Delay to ensure handleAllModelsLoaded callbacks have fully completed
    const timer = setTimeout(() => {
      const viewer = viewerInstanceRef.current;
      const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (!xeokitViewer?.scene) return;

      const scene = xeokitViewer.scene;
      const metaObjects = xeokitViewer.metaScene?.metaObjects || {};

      // Step 0: Activate the spaces layer in Asset+ BEFORE coloring
      setShowSpaces(true);
      try {
        const assetViewer = viewer?.assetViewer;
        assetViewer?.onShowSpacesChanged?.(true);
      } catch {}

      console.log('[AssetPlusViewer] Applying insights color mode:', mode, 'keys:', Object.keys(colorMap).length);

      // Step 1: X-ray ALL objects for transparent ghosting (issue #175)
      const allIds = scene.objectIds || [];
      ensureXrayConfig(scene);
      scene.setObjectsXRayed(allIds, true);

      if (mode === 'energy_floors' || mode === 'energy_floor') {
        Object.entries(colorMap).forEach(([floorGuid, rgb]) => {
          const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
          if (!assetView) return;

          // Step 1: Find the storey's xeokit entity ID via Asset+'s FM GUID lookup
          const storeyItemIds = assetView.getItemsByPropertyValue("fmguid", floorGuid.toUpperCase()) || [];
          console.log('[Insights] Floor', floorGuid, '-> storeyItemIds:', storeyItemIds.length);

          // Step 2: For each storey entity, find ALL children in the metaObject tree
          const allChildIds: string[] = [];
          storeyItemIds.forEach((itemId: string) => {
            const mo = metaObjects[itemId];
            if (!mo) return;
            const findChildren = (parent: any) => {
              if (!parent.children) return;
              parent.children.forEach((child: any) => {
                allChildIds.push(child.id);
                findChildren(child);
              });
            };
            findChildren(mo);
            allChildIds.push(itemId);
          });

          console.log('[Insights] Floor', floorGuid, '-> total children:', allChildIds.length);

          // Step 3: Un-xray and colorize all children
          allChildIds.forEach(id => {
            const entity = scene.objects?.[id];
            if (entity) {
              entity.xrayed = false;
              entity.visible = true;
              entity.colorize = rgb;
              entity.opacity = 0.85;
            }
          });
        });

      } else if (mode === 'asset_categories' || mode === 'asset_category') {
        const currentData = allDataRef.current;
        const buildingGuid = assetDataRef.current?.buildingFmGuid || assetDataRef.current?.fmGuid;
        
        Object.entries(colorMap).forEach(([assetType, rgb]) => {
          const matchingAssets = currentData.filter((a: any) => {
            if (a.buildingFmGuid !== buildingGuid) return false;
            const type = (a.assetType || a.category || '').replace('Ifc', '');
            return type === assetType;
          });
          
          matchingAssets.forEach((asset: any) => {
            const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
            if (!assetView) return;
            const itemIds = assetView.getItemsByPropertyValue("fmguid", asset.fmGuid.toUpperCase()) || [];
            itemIds.forEach((id: string) => {
              const entity = scene.objects?.[id];
              if (entity) {
                entity.xrayed = false;
                entity.visible = true;
                entity.colorize = rgb;
                entity.opacity = 0.9;
              }
            });
          });
        });

      } else if (mode === 'room_types' || mode === 'room_type') {
        const currentData = allDataRef.current;
        const buildingGuid = assetDataRef.current?.buildingFmGuid || assetDataRef.current?.fmGuid;
        
        const spaceTypeMap = new Map<string, string>();
        currentData.forEach((a: any) => {
          if (a.buildingFmGuid !== buildingGuid) return;
          if (a.category !== 'Space' && a.category !== 'IfcSpace') return;
          const attrs = a.attributes || {};
          const type = attrs.spaceType || attrs.roomType || 'Unknown';
          spaceTypeMap.set(a.fmGuid.toLowerCase(), type);
        });

        Object.values(metaObjects).forEach((mo: any) => {
          if (mo.type?.toLowerCase() !== 'ifcspace') return;
          const moGuid = (mo.originalSystemId || mo.id || '').toLowerCase();
          const roomType = spaceTypeMap.get(moGuid);
          if (!roomType) return;
          
          let rgb = colorMap[roomType];
          if (!rgb) {
            const truncated = roomType.length > 15 ? roomType.substring(0, 15) + '...' : roomType;
            rgb = colorMap[truncated];
          }
          if (!rgb) return;
          
          const entity = scene.objects?.[mo.id];
          if (entity) {
            entity.xrayed = false;
            entity.visible = true;
            entity.colorize = rgb;
            entity.opacity = 0.85;
          }
        });
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [insightsColorMode, spacesCacheReady, modelLoadState, initStep]);

  // ─── Listen for INSIGHTS_COLOR_UPDATE from InsightsDrawerPanel (drawerMode) ───
  useEffect(() => {
    const handler = (detail: InsightsColorUpdateDetail) => {
      if (!detail?.colorMap) return;

      const viewer = viewerInstanceRef.current;
      const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (!xeokitViewer?.scene) {
        insightsColorMapCacheRef.current = { mode: detail.mode, colorMap: detail.colorMap };
        console.log('[AssetPlusViewer] Queued INSIGHTS_COLOR_UPDATE until viewer is ready');
        return;
      }

      const scene = xeokitViewer.scene;
      const metaObjects = xeokitViewer.metaScene?.metaObjects || {};
      const mode = detail.mode;
      const colorMap = detail.colorMap;

      // Activate spaces
      setShowSpaces(true);
      try { viewer?.assetViewer?.onShowSpacesChanged?.(true); } catch {}

      // X-ray everything
      const allIds = scene.objectIds || [];
      ensureXrayConfig(scene);
      scene.setObjectsXRayed(allIds, true);

      if (mode === 'room_spaces' || mode === 'room_types' || mode === 'room_type') {
        // colorMap keys are fmGuids (for room_spaces) or type names (for room_types)
        if (mode === 'room_spaces') {
          // Per-room coloring: key = fmGuid
          Object.values(metaObjects).forEach((mo: any) => {
            if (mo.type?.toLowerCase() !== 'ifcspace') return;
            const moGuid = (mo.originalSystemId || mo.id || '').toLowerCase();
            const rgb = colorMap[moGuid] || colorMap[moGuid.toUpperCase()];
            if (!rgb) return;
            const entity = scene.objects?.[mo.id];
            if (entity) {
              entity.xrayed = false;
              entity.visible = true;
              entity.colorize = rgb;
              entity.opacity = 0.85;
            }
          });
        } else {
          // By type name — reuse existing room_types logic
          const currentData = allDataRef.current;
          const buildingGuid = assetDataRef.current?.buildingFmGuid || assetDataRef.current?.fmGuid;
          const spaceTypeMap = new Map<string, string>();
          currentData.forEach((a: any) => {
            if (a.buildingFmGuid !== buildingGuid) return;
            if (a.category !== 'Space' && a.category !== 'IfcSpace') return;
            const attrs = a.attributes || {};
            const type = attrs.spaceType || attrs.roomType || 'Unknown';
            spaceTypeMap.set(a.fmGuid.toLowerCase(), type);
          });
          Object.values(metaObjects).forEach((mo: any) => {
            if (mo.type?.toLowerCase() !== 'ifcspace') return;
            const moGuid = (mo.originalSystemId || mo.id || '').toLowerCase();
            const roomType = spaceTypeMap.get(moGuid);
            if (!roomType) return;
            let rgb = colorMap[roomType];
            if (!rgb) {
              const truncated = roomType.length > 15 ? roomType.substring(0, 15) + '...' : roomType;
              rgb = colorMap[truncated];
            }
            if (!rgb) return;
            const entity = scene.objects?.[mo.id];
            if (entity) {
              entity.xrayed = false;
              entity.visible = true;
              entity.colorize = rgb;
              entity.opacity = 0.85;
            }
          });
        }
      } else if (mode === 'energy_floors' || mode === 'energy_floor') {
        // colorMap keys are floor fmGuids — colorize all children of each IfcBuildingStorey
        // Use xeokit's metaObject tree traversal (children array) instead of flat scan
        const colorizeDescendants = (metaObj: any, rgb: [number, number, number]) => {
          if (!metaObj) return;
          const entity = scene.objects?.[metaObj.id];
          if (entity) {
            entity.xrayed = false;
            entity.visible = true;
            entity.colorize = rgb;
            entity.opacity = 0.85;
          }
          if (metaObj.children) {
            metaObj.children.forEach((child: any) => colorizeDescendants(child, rgb));
          }
        };

        Object.values(metaObjects).forEach((mo: any) => {
          if (mo.type?.toLowerCase() !== 'ifcbuildingstorey') return;
          const moGuid = (mo.originalSystemId || mo.id || '').toLowerCase();
          const rgb = colorMap[moGuid] || colorMap[moGuid.toUpperCase()] || colorMap[mo.originalSystemId] || colorMap[mo.id];
          if (!rgb) return;
          colorizeDescendants(mo, rgb);
        });
      } else if (mode === 'asset_categories' || mode === 'asset_category') {
        // colorMap keys can be asset_type labels (e.g. "Alarm") or category labels.
        // Build a case-insensitive lookup and colorize via O(1) FMGUID → entity map.
        const currentData = allDataRef.current;
        const buildingGuid = assetDataRef.current?.buildingFmGuid || assetDataRef.current?.fmGuid;
        const normalizedColorMap = new Map<string, [number, number, number]>();
        Object.entries(colorMap).forEach(([key, value]) => normalizedColorMap.set(key.toLowerCase(), value));

        const entityByFmGuid = new Map<string, any>();
        Object.values(metaObjects).forEach((mo: any) => {
          const moGuid = (mo.originalSystemId || mo.id || '').toLowerCase();
          if (!moGuid) return;
          const entity = scene.objects?.[mo.id];
          if (entity) entityByFmGuid.set(moGuid, entity);
        });

        currentData.forEach((a: any) => {
          if (a.buildingFmGuid !== buildingGuid) return;

          const rawKeys = [a.assetType, a.asset_type, a.category]
            .filter((v): v is string => typeof v === 'string' && v.length > 0);

          let rgb: [number, number, number] | undefined;
          for (const rawKey of rawKeys) {
            const candidates = [
              rawKey,
              rawKey.replace(/^Ifc/i, ''),
              rawKey.length > 15 ? `${rawKey.substring(0, 15)}...` : rawKey,
            ];
            for (const candidate of candidates) {
              const match = normalizedColorMap.get(candidate.toLowerCase());
              if (match) {
                rgb = match;
                break;
              }
            }
            if (rgb) break;
          }

          if (!rgb) return;
          const fmGuidLower = (a.fmGuid || '').toLowerCase();
          if (!fmGuidLower) return;

          const entity = entityByFmGuid.get(fmGuidLower);
          if (!entity) return;

          entity.xrayed = false;
          entity.visible = true;
          entity.colorize = rgb;
          entity.opacity = 0.85;
        });
      } else {
        // Forward to existing insights logic — update cache and trigger re-render
        insightsColorMapCacheRef.current = { mode, colorMap };
        insightsColorModeRef.current = mode;
      }

      console.log('[AssetPlusViewer] Applied INSIGHTS_COLOR_UPDATE:', mode, Object.keys(colorMap).length, 'entries');
    };

    const off = on('INSIGHTS_COLOR_UPDATE', handler);
    return () => off();
  }, []);

  // Re-apply queued Insights coloring once viewer is ready
  useEffect(() => {
    if (modelLoadState !== 'loaded' || initStep !== 'ready') return;
    const pending = insightsColorMapCacheRef.current;
    if (!pending) return;
    insightsColorMapCacheRef.current = null;
    emit('INSIGHTS_COLOR_UPDATE', pending);
  }, [modelLoadState, initStep]);

  // ─── Listen for ALARM_ANNOTATIONS_SHOW from InsightsDrawerPanel / panel toggles ───
  useEffect(() => {
    const removeAlarmMarkerContainer = () => {
      const existingContainer = document.getElementById('alarm-annotation-markers');
      if (existingContainer) existingContainer.remove();
    };

    const handler = async (detail: AlarmAnnotationsShowDetail) => {
      const visible = detail?.visible ?? true;

      if (!visible) {
        removeAlarmMarkerContainer();
        return;
      }

      const viewer = viewerInstanceRef.current;
      const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
      const xeokitViewer = assetView?.viewer;
      if (!xeokitViewer?.scene) return;

      let alarmsToRender = detail?.alarms ?? [];

      // Toggle path from right panel: visible=true with empty alarms → fetch latest building alarms
      if (alarmsToRender.length === 0) {
        const resolvedBuildingGuid = assetDataRef.current?.buildingFmGuid || assetDataRef.current?.fmGuid || fmGuid;
        if (!resolvedBuildingGuid) return;

        const { data: fallbackAlarms, error } = await supabase
          .from('assets')
          .select('fm_guid, in_room_fm_guid')
          .eq('building_fm_guid', resolvedBuildingGuid)
          .eq('asset_type', 'IfcAlarm')
          .not('in_room_fm_guid', 'is', null)
          .limit(200);

        if (error) {
          console.warn('[AlarmAnnotations] Failed to load fallback alarms:', error);
          return;
        }

        alarmsToRender = (fallbackAlarms || []).map((alarm: any) => ({
          fmGuid: alarm.fm_guid,
          roomFmGuid: alarm.in_room_fm_guid,
        }));
      }

      if (alarmsToRender.length === 0) {
        removeAlarmMarkerContainer();
        return;
      }

      const allRoomEntityIds: string[] = [];

      removeAlarmMarkerContainer();
      const markerContainer = document.createElement('div');
      markerContainer.id = 'alarm-annotation-markers';
      markerContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:25;overflow:hidden;';
      const markerHost = viewerContainerRef.current || ((viewer?.$el instanceof HTMLElement) ? viewer.$el : null);
      if (!markerHost) return;
      markerHost.appendChild(markerContainer);

      for (const alarm of alarmsToRender) {
        const roomGuid = alarm.roomFmGuid;
        if (!roomGuid) continue;

        const roomItemIds = assetView.getItemsByPropertyValue?.('fmguid', roomGuid.toUpperCase()) || [];
        if (roomItemIds.length === 0) {
          console.debug('[AlarmAnnotations] No BIM entities for room:', roomGuid);
          continue;
        }

        allRoomEntityIds.push(...roomItemIds);
        flashEntityById(xeokitViewer.scene, roomItemIds[0]);

        const entity = xeokitViewer.scene.objects?.[roomItemIds[0]];
        if (!entity?.aabb) continue;

        const aabb = entity.aabb;
        const worldPos: [number, number, number] = [
          (aabb[0] + aabb[3]) / 2,
          (aabb[1] + aabb[4]) / 2 + 0.5,
          (aabb[2] + aabb[5]) / 2,
        ];

        const marker = document.createElement('div');
        marker.className = 'alarm-annotation-marker';
        marker.style.cssText = `
          position:absolute;width:24px;height:24px;border-radius:50%;
          background:hsl(var(--destructive));border:2px solid white;
          box-shadow:0 2px 8px rgba(0,0,0,0.4);pointer-events:auto;cursor:pointer;
          display:flex;align-items:center;justify-content:center;
          font-size:10px;color:white;font-weight:bold;
          transform:translate(-50%,-50%);transition:opacity 0.3s;
        `;
        marker.innerHTML = '🔔';
        marker.title = `Alarm in room ${roomGuid.substring(0, 8)}…`;
        markerContainer.appendChild(marker);

        const updatePos = () => {
          const canvas = xeokitViewer.scene?.canvas?.canvas;
          const camera = xeokitViewer.scene?.camera;
          if (!canvas || !camera) return;

          const canvasPos = projectWorldToCanvas(worldPos, camera.viewMatrix, camera.projMatrix, canvas.clientWidth, canvas.clientHeight);
          if (!canvasPos) {
            marker.style.display = 'none';
            return;
          }

          const canvasRect = canvas.getBoundingClientRect();
          const containerRect = markerContainer.getBoundingClientRect();
          marker.style.left = `${canvasRect.left - containerRect.left + canvasPos[0]}px`;
          marker.style.top = `${canvasRect.top - containerRect.top + canvasPos[1]}px`;
          marker.style.display = canvasPos[2] > 0 ? 'flex' : 'none';
          marker.style.opacity = canvasPos[2] > 0 ? '1' : '0';
        };

        updatePos();
        const onView = xeokitViewer.scene.camera?.on?.('viewMatrix', updatePos);
        const onProj = xeokitViewer.scene.camera?.on?.('projMatrix', updatePos);

        setTimeout(() => {
          marker.remove();
          if (onView !== undefined) xeokitViewer.scene.camera?.off?.(onView);
          if (onProj !== undefined) xeokitViewer.scene.camera?.off?.(onProj);
        }, 30000);
      }

      if (detail?.flyTo && allRoomEntityIds.length > 0) {
        try {
          xeokitViewer.cameraFlight?.flyTo({
            aabb: xeokitViewer.scene.getAABB(allRoomEntityIds),
            duration: 1,
          });
        } catch (err) {
          console.warn('[AlarmAnnotations] flyTo failed:', err);
        }
      }

      console.log('[AssetPlusViewer] ALARM_ANNOTATIONS_SHOW:', alarmsToRender.length, 'alarms, rooms found:', allRoomEntityIds.length);
    };

    const offHandler = on('ALARM_ANNOTATIONS_SHOW', handler);
    return () => {
      offHandler();
      removeAlarmMarkerContainer();
    };
  }, [flashEntityById, fmGuid]);

  // Read pending alarm annotations from sessionStorage (set by Insights on mobile before navigation)
  useEffect(() => {
    if (modelLoadState !== 'loaded' || initStep !== 'ready') return;
    const raw = sessionStorage.getItem('pending_alarm_annotations');
    if (!raw) return;
    sessionStorage.removeItem('pending_alarm_annotations');
    try {
      const parsed = JSON.parse(raw);
      // Dispatch the event with a small delay to ensure listeners are ready
      setTimeout(() => {
        emit('ALARM_ANNOTATIONS_SHOW', parsed);
      }, 500);
    } catch { /* ignore */ }
  }, [modelLoadState, initStep]);

  const { broadcastCamera } = useViewerCameraSync({
    viewerRef: viewerInstanceRef,
    enabled: syncEnabled,
    onSyncReceived: (position, heading, pitch) => {
      // Fly to received position from Ivion 360
      const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (!xeokitViewer?.cameraFlight) return;

      const eye = [position.x, position.y, position.z];
      const look = calculateLookFromHeadingPitch(eye, heading, pitch);
      
      xeokitViewer.cameraFlight.flyTo({
        eye,
        look,
        up: [0, 1, 0],
        duration: 0.5,
      });
    },
  });

  // Broadcast camera changes to parent when enabled
  useEffect(() => {
    if (!syncEnabled || !onCameraChange) return;
    
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene?.camera) return;
    
    const camera = xeokitViewer.scene.camera;
    let lastBroadcast = 0;
    const THROTTLE_MS = 200;
    
    const handleCameraChange = () => {
      const now = Date.now();
      if (now - lastBroadcast < THROTTLE_MS) return;
      lastBroadcast = now;
      
      const eye = camera.eye;
      const look = camera.look;

      const position: LocalCoords = { x: eye[0], y: eye[1], z: eye[2] };
      const heading = calculateHeadingFromCamera(eye, look);
      const pitch = calculatePitchFromCamera(eye, look);
      
      onCameraChange(position, heading, pitch);
    };
    
    const viewMatrixSub = camera.on('viewMatrix', handleCameraChange);
    
    return () => {
      camera.off(viewMatrixSub);
    };
  }, [syncEnabled, onCameraChange]);

  // Find the asset data for the given fmGuid
  const assetData = allData.find((a: any) => a.fmGuid === fmGuid);
  useEffect(() => { assetDataRef.current = assetData; }, [assetData]);
  
  // Get the building fmGuid for cache organization
  // fmGuid prop is always the building GUID when passed from UnifiedViewer.
  // Fall back to assetData lookup only for room/floor deep-links.
  const buildingFmGuid = fmGuid || assetData?.buildingFmGuid || assetData?.fmGuid;

  // Shared model names hook (used by extractModels for mobile + ModelVisibilitySelector)
  const { modelNamesMap } = useModelNames(buildingFmGuid);

  // On-demand XKT sync: ensure models are cached for this building with visual feedback
  const modelLoadStateRef = useRef<string>(modelLoadState);
  useEffect(() => { modelLoadStateRef.current = modelLoadState; }, [modelLoadState]);
  
  useEffect(() => {
    if (!buildingFmGuid) return;
    
    const ensureModels = async () => {
      // Don't run sync check if models are already loaded in the viewer
      // Use ref to avoid stale closure (modelLoadState captured at effect creation)
      if (modelLoadStateRef.current === 'loaded') return;
      setXktSyncStatus('checking');
      
      try {
        const result = await xktCacheService.ensureBuildingModels(buildingFmGuid);
        
        // After async, re-check if models loaded while we were waiting
        if (modelLoadStateRef.current === 'loaded') {
          setXktSyncStatus('done');
          return;
        }
        
        if (result.syncing) {
          console.log('On-demand XKT sync triggered for building:', buildingFmGuid);
          setXktSyncStatus('syncing');
          // Keep syncing status - it will naturally resolve when models are loaded
        } else if (result.cached && result.count > 0) {
          console.log(`Building ${buildingFmGuid} has ${result.count} cached XKT models`);
          setXktSyncStatus('done');
        } else {
          // No models cached and not syncing - either no models exist or sync will happen later
          setXktSyncStatus('idle');
        }
      } catch (error) {
        console.error('XKT sync error:', error);
        setXktSyncStatus('error');
      }
    };
    
    ensureModels();
  }, [buildingFmGuid]);

  // Track if all floors are visible (to avoid showing all spaces when filter is empty but not "all")
  const isAllFloorsVisibleRef = useRef(true);

  // Cache: IfcSpace entity IDs grouped by parent storey fmGuid (built once when model loads)
  const spacesByFloorCacheRef = useRef<Map<string, string[]>>(new Map());
  const allSpaceIdsRef = useRef<string[]>([]);

  // Build the spacesByFloor cache once when model is loaded
  useEffect(() => {
    if (modelLoadState !== 'loaded') return;
    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.metaScene?.metaObjects) return;

    const metaObjects = xeokitViewer.metaScene.metaObjects;
    const cache = new Map<string, string[]>();
    const allIds: string[] = [];

    Object.values(metaObjects).forEach((metaObj: any) => {
      if (metaObj.type?.toLowerCase() !== 'ifcspace') return;
      allIds.push(metaObj.id);

      let current = metaObj;
      while (current?.parent) {
        current = current.parent;
        if (current?.type?.toLowerCase() === 'ifcbuildingstorey') {
          const storeyGuid = (current.originalSystemId || current.id || '').toLowerCase();
          if (!cache.has(storeyGuid)) cache.set(storeyGuid, []);
          cache.get(storeyGuid)!.push(metaObj.id);
          break;
        }
      }
    });

    spacesByFloorCacheRef.current = cache;
    allSpaceIdsRef.current = allIds;
    console.debug(`[spacesByFloor] Cache built: ${cache.size} floors, ${allIds.length} spaces`);
    setSpacesCacheReady(true);
  }, [modelLoadState]);

  // Core space-filtering logic (uses cache, no metaObjects iteration)
  const filterSpacesToVisibleFloorsCore = useCallback((visibleFloorGuids: string[], forceShow: boolean, isAllVisible?: boolean) => {
    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) {
      console.debug('filterSpacesToVisibleFloors: No viewer available');
      return;
    }

    const scene = xeokitViewer.scene;
    const effectiveIsAllVisible = isAllVisible ?? isAllFloorsVisibleRef.current;
    
    console.debug(`Filtering spaces - showSpaces: ${forceShow}, visibleFloors: ${visibleFloorGuids.length}, isAllVisible: ${effectiveIsAllVisible}`);
    
    const allSpaceIds = allSpaceIdsRef.current;
    
    // If showSpaces is OFF, hide ALL IfcSpace entities
    if (!forceShow) {
      allSpaceIds.forEach(id => { const e = scene.objects?.[id]; if (e && e.visible) e.visible = false; });
      console.debug(`Spaces hidden: ${allSpaceIds.length} (showSpaces is OFF)`);
      return;
    }
    
    // All floors visible → show all spaces
    if (effectiveIsAllVisible) {
      allSpaceIds.forEach(id => { const e = scene.objects?.[id]; if (e && !e.visible) e.visible = true; });
      console.debug(`All spaces shown (all floors visible)`);
      return;
    }
    
    // No floor filter and not all-visible → hide all
    if (visibleFloorGuids.length === 0) {
      allSpaceIds.forEach(id => { const e = scene.objects?.[id]; if (e && e.visible) e.visible = false; });
      console.debug(`Spaces hidden (empty filter, not all-visible)`);
      return;
    }

    // Filter: show only spaces on visible floors using cache
    const visibleGuidsLower = new Set(visibleFloorGuids.map((g: string) => g.toLowerCase()));
    const visibleSpaceIds = new Set<string>();

    for (const guid of visibleGuidsLower) {
      const ids = spacesByFloorCacheRef.current.get(guid);
      if (ids) ids.forEach(id => visibleSpaceIds.add(id));
    }

    allSpaceIds.forEach(id => {
      const e = scene.objects?.[id];
      if (e) e.visible = visibleSpaceIds.has(id);
    });
    
    console.debug(`Spaces filtered - shown: ${visibleSpaceIds.size}, hidden: ${allSpaceIds.length - visibleSpaceIds.size}`);
  }, []);

  // Debounced version to avoid 6+ calls per floor toggle
  const filterDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterSpacesToVisibleFloors = useCallback((visibleFloorGuids: string[], forceShow: boolean, isAllVisible?: boolean) => {
    if (filterDebounceTimerRef.current) clearTimeout(filterDebounceTimerRef.current);
    filterDebounceTimerRef.current = setTimeout(() => {
      filterSpacesToVisibleFloorsCore(visibleFloorGuids, forceShow, isAllVisible);
    }, 100);
  }, [filterSpacesToVisibleFloorsCore]);

  // Centralized handler for showSpaces changes
  const handleShowSpacesChange = useCallback((show: boolean) => {
    setShowSpaces(show);
    
    // Call Asset+ viewer API
    try {
      const assetViewer = viewerInstanceRef.current?.assetViewer;
      assetViewer?.onShowSpacesChanged?.(show);
    } catch (e) {
      console.debug('onShowSpacesChanged failed:', e);
    }
    
    // Apply floor filtering with current isAllFloorsVisible state
    filterSpacesToVisibleFloors(visibleFloorFmGuids, show, isAllFloorsVisibleRef.current);
  }, [visibleFloorFmGuids, filterSpacesToVisibleFloors]);

  // Handler for visible floors change - also filters spaces and room labels
  const handleVisibleFloorsChange = useCallback((floorIds: string[], isAllVisible?: boolean) => {
    setVisibleFloorFmGuids(floorIds);
    
    // Update ref if provided
    if (isAllVisible !== undefined) {
      isAllFloorsVisibleRef.current = isAllVisible;
    }
    
    // ALWAYS call filterSpacesToVisibleFloors to ensure rooms are hidden when showSpaces is false
    filterSpacesToVisibleFloors(floorIds, showSpaces, isAllVisible);
    
    // Update room labels floor filter
    if (updateFloorFilter) {
      updateFloorFilter(floorIds);
    }
  }, [showSpaces, filterSpacesToVisibleFloors, updateFloorFilter]);

  // Handler for 2D mode toggle from mobile overlay
  const handleToggle2DMode = useCallback((is2D: boolean) => {
    const mode = is2D ? '2d' : '3d';
    emit('VIEW_MODE_REQUESTED', { mode });
  }, []);

  // Handler for room labels toggle
  const handleRoomLabelsToggle = useCallback((enabled: boolean) => {
    setShowRoomLabels(enabled);
    setRoomLabelsEnabled(enabled);
  }, [setRoomLabelsEnabled]);

  // Listen for minimap toggle from ViewerRightPanel
  useEffect(() => {
    const handleMinimapToggle = () => {
      setShowMinimap(prev => !prev);
    };
    const off = on('MINIMAP_TOGGLE', handleMinimapToggle);
    return () => off();
  }, []);

  // Listen for view mode changes to update room label heights
  useEffect(() => {
    const handleViewModeChange = (detail: ViewModeEventDetail) => {
      const mode = detail?.mode as '2d' | '3d';
      if (mode && updateLabelsViewMode) {
        console.log('AssetPlusViewer: View mode changed to', mode, '- updating room labels');
        updateLabelsViewMode(mode);
      }
    };
    
    const offHandleViewModeChange = on('VIEW_MODE_CHANGED', handleViewModeChange);
    return () => {
      offHandleViewModeChange();
    };
  }, [updateLabelsViewMode]);

  // Listen for floor selection changes to update spaces, room labels, and visualization
  useEffect(() => {
    const handleFloorSelectionChange = (detail: FloorSelectionEventDetail) => {
      const { visibleFloorFmGuids: newGuids, isAllFloorsVisible } = detail;
      
      console.log('AssetPlusViewer: Floor selection changed', {
        guids: newGuids?.length,
        isAllVisible: isAllFloorsVisible,
      });
      
      // Update isAllFloorsVisible ref
      if (isAllFloorsVisible !== undefined) {
        isAllFloorsVisibleRef.current = isAllFloorsVisible;
      }
      
      // Update state and apply filtering if we have new guids
      if (newGuids && newGuids.length > 0) {
        setVisibleFloorFmGuids(newGuids);
        
        // Filter spaces to visible floors
        filterSpacesToVisibleFloors(newGuids, showSpaces, isAllFloorsVisible);
        
        // Update room labels floor filter
        if (updateFloorFilter) {
          updateFloorFilter(newGuids);
        }
      } else if (isAllFloorsVisible) {
        // All floors visible - clear filter but keep spaces shown if enabled
        filterSpacesToVisibleFloors([], showSpaces, true);
        
        if (updateFloorFilter) {
          updateFloorFilter([]);
        }
      }
    };
    
    const offHandleFloorSelectionChange = on('FLOOR_SELECTION_CHANGED', handleFloorSelectionChange);
    return () => {
      offHandleFloorSelectionChange();
    };
  }, [updateFloorFilter, showSpaces, filterSpacesToVisibleFloors]);

  // Handler for annotations toggle from mobile overlay and ViewerRightPanel
  const handleAnnotationsChange = useCallback((show: boolean) => {
    setShowAnnotations(show);
    // Update local annotation markers (DOM-based icons for inventoried assets, alarms, etc.)
    const plugin = localAnnotationsPluginRef.current;
    if (plugin?.annotations) {
      Object.values(plugin.annotations).forEach((ann: any) => {
        const category = ann.category || ann.markerElement?.dataset?.category || '';
        const isIndependent = category === 'Issues' || category === 'Sensor';
        if (isIndependent) return;
        ann.markerShown = show;
        if (ann.markerElement) {
          ann.markerElement.style.display = show ? 'flex' : 'none';
        }
      });
    }
    // Trigger Asset+ built-in annotation visibility update
    try {
      const viewer = viewerInstanceRef.current?.assetViewer;
      if (viewer && typeof viewer.onToggleAnnotation === 'function') {
        viewer.onToggleAnnotation(show);
      }
    } catch (e) {
      console.debug('Could not toggle annotations:', e);
    }
  }, []);

  // ─── Right-click context menu handler ───
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) {
      setContextMenu({ position: { x: e.clientX, y: e.clientY }, entityId: null, fmGuid: null, entityName: null });
      return;
    }

    // Pick entity at mouse position
    const canvasRect = xeokitViewer.scene.canvas.canvas.getBoundingClientRect();
    const canvasPos = [e.clientX - canvasRect.left, e.clientY - canvasRect.top];
    const hit = xeokitViewer.scene.pick({ canvasPos });

    let entityId: string | null = null;
    let fmGuid: string | null = null;
    let entityName: string | null = null;

    if (hit?.entity) {
      entityId = hit.entity.id;
      // Resolve FM GUID from metaScene
      const metaObj = xeokitViewer.metaScene?.metaObjects?.[entityId];
      if (metaObj) {
        fmGuid = metaObj.originalSystemId || null;
        entityName = metaObj.name || null;
      }
    }

    setContextMenu({ position: { x: e.clientX, y: e.clientY }, entityId, fmGuid, entityName });
  }, []);

  // Sync local annotation marker visibility when showAnnotations state changes
  useEffect(() => {
    const plugin = localAnnotationsPluginRef.current;
    if (!plugin?.annotations) return;
    Object.values(plugin.annotations).forEach((ann: any) => {
      const category = ann.category || ann.markerElement?.dataset?.category || '';
      const isIndependent = category === 'Issues' || category === 'Sensor';
      if (isIndependent) return;
      ann.markerShown = showAnnotations;
      if (ann.markerElement) {
        ann.markerElement.style.display = showAnnotations ? 'flex' : 'none';
      }
    });
    // Force position recalculation so markers appear at correct screen coords (not 0,0)
    if (showAnnotations && plugin.updatePositions) {
      plugin.updatePositions();
    }
  }, [showAnnotations]);

  // Floor-aware annotation filtering: hide markers not on visible floor(s)
  useEffect(() => {
    const handler = (evDetail: FloorSelectionEventDetail) => {
      const plugin = localAnnotationsPluginRef.current;
      if (!plugin?.annotations) return;
      const isAll = evDetail.isAllFloorsVisible;
      const visibleGuids = evDetail.visibleFloorFmGuids || [];
      const singleFloor = evDetail.floorId;

      Object.values(plugin.annotations).forEach((ann: any) => {
        if (!ann.markerElement) return;
        const category = ann.category || ann.markerElement?.dataset?.category || '';
        const levelGuid = ann.levelFmGuid || ann.markerElement?.dataset?.levelFmGuid || '';
        const isIssue = category === 'Issues';

        if (isAll || isIssue || !levelGuid) {
          ann.markerElement.style.display = ann.markerShown ? 'flex' : 'none';
        } else {
          const isOnFloor = (singleFloor && levelGuid === singleFloor) ||
                            (visibleGuids.length > 0 && visibleGuids.includes(levelGuid));
          ann.markerElement.style.display = (ann.markerShown && isOnFloor) ? 'flex' : 'none';
        }
      });
      if (plugin.updatePositions) plugin.updatePositions();
    };
    const off = on('FLOOR_SELECTION_CHANGED', handler);
    return () => off();
  }, []);

  // Annotation category filtering from ViewerFilterPanel
  useEffect(() => {
    const handler = (detail: AnnotationFilterDetail) => {
      const plugin = localAnnotationsPluginRef.current;
      if (!plugin?.annotations) return;
      const visibleCats = new Set(detail.visibleCategories);

      Object.values(plugin.annotations).forEach((ann: any) => {
        if (!ann.markerElement) return;
        const category = ann.category || ann.markerElement?.dataset?.category || '';
        if (visibleCats.size > 0) {
          const catVisible = visibleCats.has(category);
          ann.markerShown = catVisible;
          ann.markerElement.style.display = catVisible ? 'flex' : 'none';
        } else {
          ann.markerElement.style.display = ann.markerShown ? 'flex' : 'none';
        }
      });
      if (plugin.updatePositions) plugin.updatePositions();
    };
    const off = on('ANNOTATION_FILTER', handler);
    return () => off();
  }, []);

  // Handler for individual model visibility toggle from mobile overlay
  const handleModelToggle = useCallback((modelId: string, visible: boolean) => {
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) return;
    
    // Toggle model visibility in xeokit
    const model = xeokitViewer.scene.models[modelId];
    if (model) {
      model.visible = visible;
    }
    
    // Update state
    setAvailableModels(prev => 
      prev.map(m => m.id === modelId ? { ...m, visible } : m)
    );
  }, []);

  // Helper: Get item IDs by FmGuid
  const getItemIdsByFmGuid = useCallback((fmGuidToFind: string) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;

    if (assetView) {
      const itemIds = assetView.getItemsByPropertyValue("fmguid", fmGuidToFind.toUpperCase());
      const annotation = assetView.findAnnotation?.("fmguid", fmGuidToFind.toUpperCase());
      if (annotation) {
        itemIds.push(annotation.getField("bimObjectId"));
      }
      return itemIds;
    }
    return [];
  }, []);

  // Helper: Find closest ancestor by category
  const findClosestAncestorByItemIdAndIfcCategory = useCallback((itemId: string, category: string) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
    let metaObject = assetView?.viewer?.metaScene?.metaObjects?.[itemId];

    while (metaObject?.id) {
      if (metaObject.type?.toLowerCase() === category.toLowerCase()) {
        return metaObject.id;
      } else if (metaObject.parent) {
        metaObject = metaObject.parent;
      } else {
        break;
      }
    }
    return undefined;
  }, []);

  const findClosestAncestorByFmGuidAndIfcCategory = useCallback((fmGuidToFind: string, category: string) => {
    const itemIds = getItemIdsByFmGuid(fmGuidToFind);
    for (const id of itemIds) {
      const parentId = findClosestAncestorByItemIdAndIfcCategory(id, category);
      if (parentId) return parentId;
    }
    return undefined;
  }, [getItemIdsByFmGuid, findClosestAncestorByItemIdAndIfcCategory]);

  // Helper: Fly to coordinates
  const flyToCoordinates = useCallback((eye: number[], look: number[], duration: number) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;

    if (assetView && Array.isArray(eye) && eye.length > 2 && Array.isArray(look) && look.length > 2 && typeof duration === "number") {
      assetView.viewer.cameraFlight.flyTo({
        eye: eye,
        look: look,
        up: [0, 1, 0],
        duration: duration
      });
    }
  }, []);

  // Helper: Look at instance from angle (from external_viewer.html)
  const lookAtInstanceFromAngle = useCallback((fmGuidToView: string, minimumHeightAboveBase: number, heightAboveAABB: number) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;

    if (assetView && fmGuidToView) {
      const itemsIds = getItemIdsByFmGuid(fmGuidToView);
      const aabb = assetView.getAABB(itemsIds);

      if (aabb) {
        const horizontalAngle = assetView.horizontalAngle * (Math.PI / 180);
        const verticalAngle = assetView.verticalAngle * (Math.PI / 180);
        const look = [
          (aabb[0] + aabb[3]) / 2,
          (aabb[1] + aabb[4]) / 2,
          (aabb[2] + aabb[5]) / 2
        ];

        const diagonal = Math.sqrt(
          Math.pow(aabb[3] - aabb[0], 2) +
          Math.pow(aabb[4] - aabb[1], 2) +
          Math.pow(aabb[5] - aabb[2], 2)
        );
        
        const fov = assetView.viewer.cameraFlight.fitFOV * (Math.PI / 180);
        const distance = Math.abs(diagonal / (2 * Math.tan(fov / 2)));

        const eye = [
          look[0] + distance * Math.sin(horizontalAngle) * Math.cos(verticalAngle),
          look[1] + distance * Math.sin(verticalAngle),
          look[2] + distance * Math.cos(horizontalAngle) * Math.cos(verticalAngle)
        ];

        let largestHeight = Math.abs(aabb[4] - aabb[1]);
        let foundSpace = false;
        const containingSpaceId = findClosestAncestorByFmGuidAndIfcCategory(fmGuidToView, "IfcSpace");

        if (containingSpaceId) {
          const containingSpaceAABB = assetView.getAABB(containingSpaceId);
          if (containingSpaceAABB) {
            const baseToTopOfSpaceHeight = containingSpaceAABB[4] - aabb[1];
            largestHeight = Math.max(largestHeight, baseToTopOfSpaceHeight);
            foundSpace = true;
          }
        }

        if (!foundSpace && typeof minimumHeightAboveBase === "number") {
          largestHeight = Math.max(largestHeight, minimumHeightAboveBase);
        }

        if (typeof heightAboveAABB === "number") {
          largestHeight += heightAboveAABB;
        }

        const eyeHeight = eye[1] - aabb[1];
        if (eyeHeight < largestHeight) {
          const virtualDiagonal = Math.sqrt(
            Math.pow(aabb[3] - aabb[0], 2) +
            Math.pow(largestHeight, 2) +
            Math.pow(aabb[5] - aabb[2], 2)
          );
          const scale = virtualDiagonal / diagonal;
          eye[0] += (eye[0] - look[0]) * scale;
          eye[1] += (eye[1] - look[1]) * scale;
          eye[2] += (eye[2] - look[2]) * scale;
        }

        flyToCoordinates(eye, look, lookAtSpaceAndInstanceFlyToDuration);
      }
    }
  }, [getItemIdsByFmGuid, findClosestAncestorByFmGuidAndIfcCategory, flyToCoordinates]);

  // Helper: Look at space from angle (from external_viewer.html)
  const lookAtSpaceFromAngle = useCallback((fmGuidToView: string, heightAboveAABB: number) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;

    if (assetView && fmGuidToView) {
      const itemsIds = getItemIdsByFmGuid(fmGuidToView);
      const aabb = assetView.getAABB(itemsIds);

      if (aabb) {
        const horizontalAngle = assetView.horizontalAngle * (Math.PI / 180);
        const verticalAngle = assetView.verticalAngle * (Math.PI / 180);
        const look = [
          (aabb[0] + aabb[3]) / 2,
          (aabb[1] + aabb[4]) / 2,
          (aabb[2] + aabb[5]) / 2
        ];

        const diagonal = Math.sqrt(
          Math.pow(aabb[3] - aabb[0], 2) +
          Math.pow(aabb[4] - aabb[1], 2) +
          Math.pow(aabb[5] - aabb[2], 2)
        );
        
        const fov = assetView.viewer.cameraFlight.fitFOV * (Math.PI / 180);
        const distance = Math.abs(diagonal / (2 * Math.tan(fov / 2)));

        const eye = [
          look[0] + distance * Math.sin(horizontalAngle) * Math.cos(verticalAngle),
          look[1] + distance * Math.sin(verticalAngle),
          look[2] + distance * Math.cos(horizontalAngle) * Math.cos(verticalAngle)
        ];

        if (typeof heightAboveAABB === "number") {
          const minimumHeightAboveBase = aabb[4] - aabb[1] + heightAboveAABB;
          const eyeHeight = eye[1] - aabb[1];

          if (eyeHeight < minimumHeightAboveBase) {
            const virtualDiagonal = Math.sqrt(
              Math.pow(aabb[3] - aabb[0], 2) +
              Math.pow(minimumHeightAboveBase, 2) +
              Math.pow(aabb[5] - aabb[2], 2)
            );
            const scale = virtualDiagonal / diagonal;
            eye[0] += (eye[0] - look[0]) * scale;
            eye[1] += (eye[1] - look[1]) * scale;
            eye[2] += (eye[2] - look[2]) * scale;
          }
        }

        flyToCoordinates(eye, look, lookAtSpaceAndInstanceFlyToDuration);
      }
    }
  }, [getItemIdsByFmGuid, flyToCoordinates]);

  // Execute display action (updated from external_viewer-2.html)
  const executeDisplayAction = useCallback((displayAction: any) => {
    const viewer = viewerInstanceRef.current;
    if (!viewer) return;

    switch (displayAction?.action?.toLowerCase()) {
      case "cutoutfloor":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          console.log("Cutting out floor with FMGUID", displayAction.parameter.fmGuid, "includeRelatedFloors:", displayAction.parameter.includeRelatedFloors);
          viewer.cutOutFloorsByFmGuid(displayAction.parameter.fmGuid, displayAction.parameter.includeRelatedFloors);
        }
        break;
      case "cutoutfloor_and_lookatspace":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          // Use floorFmGuid if provided (for parent floor cutout), otherwise fall back to fmGuid
          const floorGuid = displayAction.parameter.floorFmGuid || displayAction.parameter.fmGuid;
          console.log("Cutting out floor (fmGuid:", floorGuid, ") & looking at Space with FMGUID", displayAction.parameter.fmGuid);
          viewer.cutOutFloorsByFmGuid(floorGuid, displayAction.parameter.includeRelatedFloors, { doViewFit: false });
          lookAtSpaceFromAngle(displayAction.parameter.fmGuid, displayAction.parameter.heightAboveAABB ?? defaultHeightAboveAABB);
        }
        break;
      case "cutoutfloor_and_lookatinstance":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          console.log("Cutting out floor & looking at Instance with FMGUID", displayAction.parameter.fmGuid);
          viewer.cutOutFloorsByFmGuid(displayAction.parameter.fmGuid, displayAction.parameter.includeRelatedFloors, { doViewFit: false });
          lookAtInstanceFromAngle(
            displayAction.parameter.fmGuid, 
            displayAction.parameter.minimumHeightAboveBase ?? defaultMinimumHeightAboveBase,
            displayAction.parameter.heightAboveAABB ?? defaultHeightAboveAABB
          );
        }
        break;
      case "viewall":
        console.log("Viewing all and adjusting camera.");
        viewer.assetViewer?.$refs?.assetView?.viewFit(undefined, true);
        break;
      case "viewfitfirstperson":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          const matches = viewer.assetViewer?.$refs?.assetView?.getItemsByPropertyValue("fmguid", displayAction.parameter.fmGuid.toUpperCase());
          if (matches?.length > 0) {
            console.log("ViewFit (First Person Mode) FMGUID", displayAction.parameter.fmGuid);
            viewer.assetViewer.$refs.assetView.viewFit(matches, false);
            viewer.assetViewer.$refs.assetView.setNavMode("firstPerson");
          }
        }
        break;
    }
  }, [lookAtSpaceFromAngle, lookAtInstanceFromAngle]);

  // Ensure xray material is configured for transparent ghosting (xeokit issue #175)
  const ensureXrayConfig = useCallback((scene: any) => {
    const xrayMaterial = scene?.xrayMaterial;
    if (xrayMaterial) {
      xrayMaterial.fill = true;
      xrayMaterial.fillAlpha = 0.1;
      xrayMaterial.fillColor = [0.5, 0.5, 0.5];
      xrayMaterial.edges = true;
      xrayMaterial.edgeAlpha = 0.2;
      xrayMaterial.edgeColor = [0.3, 0.3, 0.3];
    }
    if (scene) {
      scene.alphaDepthMask = false;
    }
  }, []);

  // Change X-ray material (from external_viewer-2.html)
  const changeXrayMaterial = useCallback(() => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
    const xeokitViewer = assetView?.viewer;
    const scene = xeokitViewer?.scene;
    ensureXrayConfig(scene);
  }, [ensureXrayConfig]);

  // Do display FMGUID (from Asset+ pattern - INTERNALS section)
  const doDisplayFmGuid = useCallback((fmGuidToShow: string, displayAction?: any) => {
    const viewer = viewerInstanceRef.current;
    if (!viewer) return;

    console.log("doDisplayFmGuid:", fmGuidToShow);

    setModelLoadState('requested');
    setInitStep('request_models');

    deferredFmGuidForDisplayRef.current = fmGuidToShow;
    deferredDisplayActionForDisplayRef.current = displayAction;

    viewer.setObjectDetailsVisibility(false);
    viewer.setAvailableModelsByFmGuid(fmGuidToShow);
  }, []);

  // Display FMGUID with deferred handling (PUBLIC API section from external_viewer.html)
  const displayFmGuid = useCallback((fmGuidToShow: string, displayAction?: any) => {
    deferredFmGuidRef.current = undefined;
    deferredDisplayActionRef.current = undefined;

    if (!deferCallsRef.current) {
      console.log("displayFmGuid: Not deferring calls, showing immediately");
      doDisplayFmGuid(fmGuidToShow, displayAction);
    } else {
      console.log("displayFmGuid: Deferring calls, will show later");
      if (fmGuidToShow) {
        deferredFmGuidRef.current = fmGuidToShow;
      }
      if (displayAction) {
        deferredDisplayActionRef.current = displayAction;
      }
    }
  }, [doDisplayFmGuid]);

  // Process deferred calls (from Asset+ pattern)
  const processDeferred = useCallback(() => {
    if (deferredFmGuidRef.current) {
      const fmGuidToShow = deferredFmGuidRef.current;
      const displayAction = deferredDisplayActionRef.current;

      deferredFmGuidRef.current = undefined;
      deferredDisplayActionRef.current = undefined;

      doDisplayFmGuid(fmGuidToShow, displayAction);
    }
  }, [doDisplayFmGuid]);

  // Helper to resolve building GUID for the current view
  const resolveBuildingFmGuid = useCallback((): string | null => {
    // If assetData is a Building, use its fmGuid
    if (assetData?.category === 'Building') {
      return assetData.fmGuid;
    }
    // Otherwise use the buildingFmGuid property
    if (assetData?.buildingFmGuid) {
      return assetData.buildingFmGuid;
    }
    // Fallback to fmGuid if nothing else
    return buildingFmGuid || null;
  }, [assetData, buildingFmGuid]);

  // Load local annotations from database (assets with annotation_placed=true)
  const loadLocalAnnotations = useCallback(async () => {
    const resolvedBuildingGuid = resolveBuildingFmGuid();
    if (!resolvedBuildingGuid) {
      console.debug('loadLocalAnnotations: No building GUID available');
      return;
    }

    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer) {
      console.debug('loadLocalAnnotations: xeokit viewer not ready');
      return;
    }

    try {
      // Fetch assets with placed annotations for this building
      const { data: assets, error: assetsError } = await supabase
        .from('assets')
        .select('fm_guid, name, asset_type, coordinate_x, coordinate_y, coordinate_z, symbol_id, level_fm_guid')
        .eq('building_fm_guid', resolvedBuildingGuid)
        .eq('annotation_placed', true)
        .not('coordinate_x', 'is', null);

      if (assetsError) {
        console.error('Failed to fetch local annotations:', assetsError);
        return;
      }

      if (!assets || assets.length === 0) {
        console.log('No local annotations found for building:', resolvedBuildingGuid);
        return;
      }

      // Fetch all symbols for icons and colors
      const { data: symbols } = await supabase
        .from('annotation_symbols')
        .select('id, name, category, color, icon_url');

      const symbolMap = new Map(symbols?.map(s => [s.id, s]) || []);

      // Create a simple annotation manager object
      const annotationsData: Array<{
        id: string;
        fmGuid: string;
        worldPos: [number, number, number];
        category: string;
        name: string;
        color: string;
        iconUrl: string;
        markerShown: boolean;
        levelFmGuid: string | null;
      }> = [];

      // Build annotation data array
      assets.forEach(asset => {
        const symbol = asset.symbol_id ? symbolMap.get(asset.symbol_id) : null;
        const iconUrl = symbol?.icon_url || '';
        const color = symbol?.color || '#3B82F6';

        annotationsData.push({
          id: `local-${asset.fm_guid}`,
          fmGuid: asset.fm_guid,
          worldPos: [
            Number(asset.coordinate_x),
            Number(asset.coordinate_y),
            Number(asset.coordinate_z)
          ],
          category: asset.asset_type || 'Other',
          name: asset.name || 'Unknown',
          color,
          iconUrl,
          markerShown: showAnnotations,
          levelFmGuid: asset.level_fm_guid,
        });
      });

      // Store the local annotations data in a simple object for category filtering
      const localAnnotationsManager = {
        annotations: {} as Record<string, typeof annotationsData[0] & { markerElement?: HTMLElement }>,
        container: null as HTMLElement | null,
        
        clear: () => {
          Object.keys(localAnnotationsManager.annotations).forEach(id => {
            const ann = localAnnotationsManager.annotations[id];
            if (ann.markerElement) {
              ann.markerElement.remove();
            }
          });
          localAnnotationsManager.annotations = {};
        },
        
        updatePositions: () => {
          const canvas = xeokitViewer.scene?.canvas?.canvas;
          const camera = xeokitViewer.scene?.camera;
          if (!canvas || !camera) return;
          
          const viewMatrix = camera.viewMatrix;
          const projMatrix = camera.projMatrix;
          if (!viewMatrix || !projMatrix) return;
          const cw = canvas.clientWidth;
          const ch = canvas.clientHeight;
          
          Object.values(localAnnotationsManager.annotations).forEach(ann => {
            if (!ann.markerElement || !ann.markerShown) return;
            
            const canvasPos = projectWorldToCanvas(ann.worldPos, viewMatrix, projMatrix, cw, ch);
            if (canvasPos &&
                canvasPos[0] >= -50 && canvasPos[0] <= cw + 50 &&
                canvasPos[1] >= -50 && canvasPos[1] <= ch + 50 &&
                canvasPos[2] > 0) {
              ann.markerElement.style.display = 'flex';
              ann.markerElement.style.left = `${canvasPos[0] - 14}px`;
              ann.markerElement.style.top = `${canvasPos[1] - 14}px`;
            } else {
              ann.markerElement.style.display = 'none';
            }
          });
        },
      };

      // Create container for markers if not exists
      let container = document.getElementById('local-annotations-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'local-annotations-container';
        container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:15;overflow:hidden;';
        viewerContainerRef.current?.appendChild(container);
      }
      localAnnotationsManager.container = container;
      
      // Clear existing markers
      container.innerHTML = '';

      // Create marker elements for each annotation
      annotationsData.forEach(ann => {
        const marker = document.createElement('div');
        marker.id = ann.id;
        marker.className = 'local-annotation-marker';
        marker.dataset.category = ann.category;
        marker.dataset.levelFmGuid = ann.levelFmGuid || '';
        marker.style.cssText = `
          position: absolute;
          width: 28px;
          height: 28px;
          background: ${ann.color};
          border-radius: 50%;
          border: 2px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          display: ${ann.markerShown ? 'flex' : 'none'};
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.15s;
          pointer-events: auto;
        `;
        
        if (ann.iconUrl) {
          const img = document.createElement('img');
          img.src = ann.iconUrl;
          img.alt = '';
          img.style.cssText = 'width: 18px; height: 18px; filter: brightness(0) invert(1);';
          img.onerror = () => { img.style.display = 'none'; };
          marker.appendChild(img);
        }
        
        marker.title = ann.name;
        
        // Click handler: fly to + open properties
        marker.addEventListener('click', (e) => {
          e.stopPropagation();
          const camera = xeokitViewer.scene?.camera;
          if (camera) {
            xeokitViewer.cameraFlight?.flyTo({
              eye: [ann.worldPos[0] - 3, ann.worldPos[1] + 2, ann.worldPos[2] + 3],
              look: ann.worldPos,
              duration: 0.6,
            });
          }
          setSelectedFmGuids([ann.fmGuid]);
          setPropertiesDialogOpen(true);
        });
        
        container.appendChild(marker);
        
        localAnnotationsManager.annotations[ann.id] = { ...ann, markerElement: marker };
      });

      // Store the manager for category filtering
      localAnnotationsPluginRef.current = localAnnotationsManager;
      if (viewerInstanceRef.current) {
        viewerInstanceRef.current.localAnnotationsPlugin = localAnnotationsManager;
      }

      // Set up camera update listener to reposition markers
      const updateHandler = () => localAnnotationsManager.updatePositions();
      xeokitViewer.scene.camera.on('viewMatrix', updateHandler);
      xeokitViewer.scene.camera.on('projMatrix', updateHandler);
      
      // Initial position update
      setTimeout(updateHandler, 100);

      console.log(`Created ${assets.length} local annotations for building:`, resolvedBuildingGuid);
    } catch (e) {
      console.error('Error loading local annotations:', e);
    }
  }, [resolveBuildingFmGuid, showAnnotations]);

  // Load sensor annotations from BIM geometry (assets with asset_type = 'IfcAlarm')
  // These are placed at their BIM object positions, not from coordinate_x/y/z
  // Uses the "Sensor" symbol from annotation_symbols (falls back to teal default)
  const loadSensorAnnotations = useCallback(async () => {
    const resolvedBuildingGuid = resolveBuildingFmGuid();
    if (!resolvedBuildingGuid) return;

    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.metaScene?.metaObjects || !xeokitViewer?.scene) {
      console.log('Cannot load sensor annotations - viewer not ready');
      return;
    }

    try {
      // Fetch Sensor symbol (fall back to Alarm, then defaults)
      let symbolResult = await supabase
        .from('annotation_symbols')
        .select('id, name, color, icon_url, marker_html')
        .eq('name', 'Sensor')
        .maybeSingle();

      if (!symbolResult.data) {
        symbolResult = await supabase
          .from('annotation_symbols')
          .select('id, name, color, icon_url, marker_html')
          .eq('name', 'Alarm')
          .maybeSingle();
      }

      const sensorSymbol = symbolResult.data;
      const symbolColor = sensorSymbol?.color || '#14B8A6';
      const symbolIcon = sensorSymbol?.icon_url || '';
      const symbolMarkerHtml = sensorSymbol?.marker_html || '';

      // Fetch all alarm assets for this building (limit to 1000 for performance)
      const { data: alarms, error } = await supabase
        .from('assets')
        .select('id, fm_guid, name, asset_type, level_fm_guid, in_room_fm_guid, symbol_id')
        .eq('building_fm_guid', resolvedBuildingGuid)
        .eq('asset_type', 'IfcAlarm')
        .limit(1000);

      if (error || !alarms || alarms.length === 0) {
        console.log('No alarms found for building:', resolvedBuildingGuid);
        return;
      }

      console.log(`Found ${alarms.length} alarm assets, looking up BIM positions...`);

      const metaObjects = xeokitViewer.metaScene.metaObjects;
      const scene = xeokitViewer.scene;

      // Build a lookup map ONCE instead of O(n*m) linear scan per alarm
      const metaLookup = new Map<string, any>();
      Object.values(metaObjects).forEach((m: any) => {
        const key = (m.originalSystemId || m.id)?.toUpperCase();
        if (key) metaLookup.set(key, m);
      });
      console.log(`Built metaObject lookup map with ${metaLookup.size} entries`);

      // Find alarms in BIM geometry and calculate their positions
      let foundCount = 0;
      const alarmAnnotations: Array<{
        id: string;
        worldPos: [number, number, number];
        category: string;
        name: string;
        color: string;
        iconUrl: string;
        markerShown: boolean;
        levelFmGuid: string | null;
      }> = [];

      alarms.forEach(alarm => {
        // O(1) lookup instead of O(m) linear scan
        const metaObj = metaLookup.get(alarm.fm_guid?.toUpperCase());

        if (!metaObj) return; // Not in loaded BIM model

        // Get entity and its bounding box
        const entity = scene.objects?.[(metaObj as any).id];
        if (!entity?.aabb) return;

        const aabb = entity.aabb;
        // Center of bounding box, slightly above
        const worldPos: [number, number, number] = [
          (aabb[0] + aabb[3]) / 2,
          (aabb[1] + aabb[4]) / 2 + 0.1,
          (aabb[2] + aabb[5]) / 2
        ];

        alarmAnnotations.push({
          id: `sensor-${alarm.fm_guid}`,
          worldPos,
          category: 'Sensor',
          name: alarm.name || 'Sensor',
          color: symbolColor,
          iconUrl: symbolIcon,
          markerShown: sensorAnnotationsVisibleRef.current,
          levelFmGuid: alarm.level_fm_guid,
        });

        foundCount++;
      });

      console.log(`Found ${foundCount} alarm annotations with BIM positions`);

      if (foundCount === 0) return;

      // Get or create a dedicated sensor annotations manager and container
      let sensorAnnotationsManager = (viewerInstanceRef.current as any)?._sensorAnnotationsManager;
      let container = document.getElementById('sensor-markers-container');

      if (!sensorAnnotationsManager) {
        // Initialize a basic annotations manager for sensors only
        sensorAnnotationsManager = {
          annotations: {} as Record<string, any>,
          container: null as HTMLElement | null,
          updatePositions: () => {
            const canvas = xeokitViewer.scene?.canvas?.canvas;
            const camera = xeokitViewer.scene?.camera;
            if (!canvas || !camera) return;
            const viewMatrix = camera.viewMatrix;
            const projMatrix = camera.projMatrix;
            if (!viewMatrix || !projMatrix) return;
            const cw = canvas.clientWidth;
            const ch = canvas.clientHeight;
            Object.values(sensorAnnotationsManager.annotations).forEach((ann: any) => {
              if (!ann.markerElement || !ann.markerShown) return;
              const canvasPos = projectWorldToCanvas(ann.worldPos, viewMatrix, projMatrix, cw, ch);
              if (canvasPos &&
                  canvasPos[0] >= -50 && canvasPos[0] <= cw + 50 &&
                  canvasPos[1] >= -50 && canvasPos[1] <= ch + 50 &&
                  canvasPos[2] > 0) {
                ann.markerElement.style.display = 'flex';
                ann.markerElement.style.left = `${canvasPos[0] - 14}px`;
                ann.markerElement.style.top = `${canvasPos[1] - 14}px`;
              } else {
                ann.markerElement.style.display = 'none';
              }
            });
          },
        };
        if (viewerInstanceRef.current) {
          (viewerInstanceRef.current as any)._sensorAnnotationsManager = sensorAnnotationsManager;
        }
      }

      if (!container) {
        container = document.createElement('div');
        container.id = 'sensor-markers-container';
        container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:15;overflow:hidden;';
        viewerContainerRef.current?.appendChild(container);
      }
      sensorAnnotationsManager.container = container;

      // Create marker elements for each alarm annotation
      alarmAnnotations.forEach(ann => {
        // Skip if already exists
        if (sensorAnnotationsManager.annotations[ann.id]) return;

        const marker = document.createElement('div');
        marker.id = ann.id;
        marker.className = 'local-annotation-marker sensor-marker';
        marker.dataset.category = ann.category;
        marker.dataset.levelFmGuid = ann.levelFmGuid || '';
        marker.style.cssText = `
          position: absolute;
          width: 28px;
          height: 28px;
          background: ${ann.color};
          border-radius: 50%;
          border: 2px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          display: ${ann.markerShown ? 'flex' : 'none'};
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.15s;
          pointer-events: auto;
        `;

        // Use marker_html if available, otherwise icon
        if (symbolMarkerHtml) {
          marker.innerHTML = symbolMarkerHtml;
        } else if (ann.iconUrl) {
          const img = document.createElement('img');
          img.src = ann.iconUrl;
          img.alt = '';
          img.style.cssText = 'width: 18px; height: 18px; filter: brightness(0) invert(1);';
          img.onerror = () => { img.style.display = 'none'; };
          marker.appendChild(img);
        }

        marker.title = ann.name;
        
        // Click handler: fly to + open properties
        const fmGuidForClick = ann.id.replace('sensor-', '');
        marker.addEventListener('click', (e) => {
          e.stopPropagation();
          xeokitViewer.cameraFlight?.flyTo({
            eye: [ann.worldPos[0] - 3, ann.worldPos[1] + 2, ann.worldPos[2] + 3],
            look: ann.worldPos,
            duration: 0.6,
          });
          setSelectedFmGuids([fmGuidForClick]);
          setPropertiesDialogOpen(true);
        });
        
        container!.appendChild(marker);

        sensorAnnotationsManager.annotations[ann.id] = { ...ann, markerElement: marker };
      });

      // Set up camera update listener (only once)
      if (!sensorAnnotationsManager._cameraListenerSet) {
        const updateHandler = () => sensorAnnotationsManager.updatePositions();
        xeokitViewer.scene.camera.on('viewMatrix', updateHandler);
        xeokitViewer.scene.camera.on('projMatrix', updateHandler);
        sensorAnnotationsManager._cameraListenerSet = true;

        // Initial position update
        setTimeout(updateHandler, 100);
      } else {
        // Just update positions for new markers
        setTimeout(() => sensorAnnotationsManager.updatePositions(), 100);
      }

      console.log(`Created ${foundCount} sensor annotations for building:`, resolvedBuildingGuid);
      sensorAnnotationsLoadedRef.current = true;

      // NOTE: Do NOT bulk-update symbol_id here — it triggers 100+ sequential DB requests
      // which hangs the UI for buildings with thousands of IfcAlarm assets (e.g. Småviken ~17k).
      // The sensor symbol is resolved at load-time above; saving it to DB is not required for functionality.
    } catch (e) {
      console.error('Error loading sensor annotations:', e);
    }
  }, [resolveBuildingFmGuid]);

  // Load issue annotations (BCF issues with viewpoints as 3D markers)
  const loadIssueAnnotations = useCallback(async () => {
    const resolvedBuildingGuid = resolveBuildingFmGuid();
    if (!resolvedBuildingGuid) return;

    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) {
      console.debug('loadIssueAnnotations: xeokit viewer not ready');
      return;
    }

    try {
      // Fetch open/in_progress BCF issues for this building that have viewpoints
      const { data: issues, error } = await supabase
        .from('bcf_issues')
        .select('id, title, issue_type, priority, status, viewpoint_json, selected_object_ids, screenshot_url')
        .eq('building_fm_guid', resolvedBuildingGuid)
        .in('status', ['open', 'in_progress'])
        .not('viewpoint_json', 'is', null);

      if (error || !issues || issues.length === 0) {
        console.log('No issue annotations to load for building:', resolvedBuildingGuid);
        return;
      }

      console.log(`Loading ${issues.length} issue annotations...`);

      // Get or create a dedicated issue annotations manager and container
      let issueAnnotationsManager = (viewerInstanceRef.current as any)?._issueAnnotationsManager;
      let container = document.getElementById('issue-markers-container');

      if (!issueAnnotationsManager) {
        issueAnnotationsManager = {
          annotations: {} as Record<string, any>,
          container: null as HTMLElement | null,
          updatePositions: () => {
            const canvas = xeokitViewer.scene?.canvas?.canvas;
            const camera = xeokitViewer.scene?.camera;
            if (!canvas || !camera) return;
            const viewMatrix = camera.viewMatrix;
            const projMatrix = camera.projMatrix;
            if (!viewMatrix || !projMatrix) return;
            const cw = canvas.clientWidth;
            const ch = canvas.clientHeight;
            Object.values(issueAnnotationsManager.annotations).forEach((ann: any) => {
              if (!ann.markerElement || !ann.markerShown) return;
              const canvasPos = projectWorldToCanvas(ann.worldPos, viewMatrix, projMatrix, cw, ch);
              if (canvasPos &&
                  canvasPos[0] >= -50 && canvasPos[0] <= cw + 50 &&
                  canvasPos[1] >= -50 && canvasPos[1] <= ch + 50 &&
                  canvasPos[2] > 0) {
                ann.markerElement.style.display = 'flex';
                ann.markerElement.style.left = `${canvasPos[0] - 14}px`;
                ann.markerElement.style.top = `${canvasPos[1] - 14}px`;
              } else {
                ann.markerElement.style.display = 'none';
              }
            });
          },
        };
        if (viewerInstanceRef.current) {
          (viewerInstanceRef.current as any)._issueAnnotationsManager = issueAnnotationsManager;
        }
      }

      if (!container) {
        container = document.createElement('div');
        container.id = 'issue-markers-container';
        container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:16;overflow:hidden;';
        viewerContainerRef.current?.appendChild(container);
      }
      issueAnnotationsManager.container = container;

      // Issue type color map
      const issueColors: Record<string, string> = {
        fault: '#EF4444',       // red
        improvement: '#F59E0B', // amber
        observation: '#6366F1', // indigo
        safety: '#DC2626',     // dark red
      };

      let createdCount = 0;

      issues.forEach(issue => {
        const markerId = `issue-${issue.id}`;
        // Skip if already exists
        if (issueAnnotationsManager.annotations[markerId]) return;

        // Extract world position from viewpoint_json
        const vp = issue.viewpoint_json as any;
        if (!vp) return;

        let worldPos: [number, number, number] | null = null;

        // Strategy 1: Use first selected object's bounding box center
        if (issue.selected_object_ids?.length) {
          const firstObjId = issue.selected_object_ids[0];
          const entity = xeokitViewer.scene.objects?.[firstObjId];
          if (entity?.aabb) {
            const aabb = entity.aabb;
            worldPos = [
              (aabb[0] + aabb[3]) / 2,
              (aabb[1] + aabb[4]) / 2 + 0.3,
              (aabb[2] + aabb[5]) / 2,
            ];
          }
        }

        // Strategy 2: Calculate look-at point from camera viewpoint + direction
        if (!worldPos) {
          const cam = vp.perspective_camera || vp.orthogonal_camera;
          if (cam?.camera_view_point && cam?.camera_direction) {
            const eye = cam.camera_view_point;
            const dir = cam.camera_direction;
            const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
            if (len > 0) {
              const dist = 5; // 5 meters along direction
              worldPos = [
                eye.x + (dir.x / len) * dist,
                eye.y + (dir.y / len) * dist,
                eye.z + (dir.z / len) * dist,
              ];
            }
          }
        }

        if (!worldPos) return;

        const color = issueColors[issue.issue_type] || '#EF4444';

        // Create marker DOM element
        const marker = document.createElement('div');
        marker.id = markerId;
        marker.className = 'local-annotation-marker issue-marker';
        marker.dataset.category = 'Issues';
        marker.style.cssText = `
          position: absolute;
          width: 28px;
          height: 28px;
          background: ${color};
          border-radius: 50%;
          border: 2px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5), 0 0 0 3px ${color}40;
          display: ${issueAnnotationsVisibleRef.current ? 'flex' : 'none'};
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.15s;
          pointer-events: auto;
          z-index: 1;
        `;

        // SVG exclamation icon (!) for issues
        marker.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="17" r="0.5" fill="white"/></svg>`;

        marker.title = `${issue.issue_type}: ${issue.title}`;

        // Click handler: dispatch event to open IssueDetailSheet
        marker.addEventListener('click', (e) => {
          e.stopPropagation();
          emit('ISSUE_MARKER_CLICKED', { issueId: issue.id },);
        });

        container!.appendChild(marker);

        issueAnnotationsManager.annotations[markerId] = {
          id: markerId,
          worldPos,
          category: 'Issues',
          name: issue.title,
          color,
          markerShown: issueAnnotationsVisibleRef.current,
          markerElement: marker,
          levelFmGuid: null, // Issues don't have floor context directly
        };

        createdCount++;
      });

      // Set up camera listener if not already
      if (!issueAnnotationsManager._cameraListenerSet) {
        const updateHandler = () => issueAnnotationsManager.updatePositions();
        xeokitViewer.scene.camera.on('viewMatrix', updateHandler);
        xeokitViewer.scene.camera.on('projMatrix', updateHandler);
        issueAnnotationsManager._cameraListenerSet = true;
        setTimeout(updateHandler, 100);
      } else {
        setTimeout(() => issueAnnotationsManager.updatePositions(), 100);
      }

      console.log(`Created ${createdCount} issue annotations for building:`, resolvedBuildingGuid);

      // Subscribe to realtime changes on bcf_issues for this building
      const channel = supabase
        .channel(`issue-annotations-${resolvedBuildingGuid}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'bcf_issues',
          filter: `building_fm_guid=eq.${resolvedBuildingGuid}`,
        }, (payload) => {
          console.log('[IssueAnnotations] Realtime update:', payload.eventType);
          // On any change, reload issue annotations
          loadIssueAnnotationsRef.current?.().catch(e => {
            console.debug('Issue annotations reload failed:', e);
          });
        })
        .subscribe();

      // Store channel ref for cleanup
      if (viewerInstanceRef.current) {
        viewerInstanceRef.current._issueAnnotationsChannel = channel;
      }
    } catch (e) {
      console.error('Error loading issue annotations:', e);
    }
  }, [resolveBuildingFmGuid]);

  // Keep annotation function refs in sync so handleAllModelsLoaded can call latest versions
  useEffect(() => { loadLocalAnnotationsRef.current = loadLocalAnnotations; }, [loadLocalAnnotations]);
  useEffect(() => { loadSensorAnnotationsRef.current = loadSensorAnnotations; }, [loadSensorAnnotations]);
  useEffect(() => { loadIssueAnnotationsRef.current = loadIssueAnnotations; }, [loadIssueAnnotations]);

  // Listen for SENSOR_ANNOTATIONS_TOGGLE_EVENT to lazy-load and show/hide sensor markers
  useEffect(() => {
    const handler = async (detail: SensorAnnotationsToggleDetail) => {
      const { visible } = detail;
      sensorAnnotationsVisibleRef.current = visible;

      // Lazy-load if not yet loaded and we're turning sensors on
      if (visible && !sensorAnnotationsLoadedRef.current) {
        await loadSensorAnnotationsRef.current?.();
      }

      // Use dedicated sensor annotations manager
      const mgr = (viewerInstanceRef.current as any)?._sensorAnnotationsManager;
      if (!mgr?.annotations) return;

      Object.values(mgr.annotations).forEach((ann: any) => {
        ann.markerShown = visible;
        if (ann.markerElement) {
          ann.markerElement.style.display = visible ? 'flex' : 'none';
        }
      });

      mgr.updatePositions?.();
    };
    const off = on('SENSOR_ANNOTATIONS_TOGGLE', handler);
    return () => off();
  }, []);

  // Listen for ISSUE_ANNOTATIONS_TOGGLE_EVENT to lazy-load and show/hide issue markers
  useEffect(() => {
    const handler = async (detail: IssueAnnotationsToggleDetail) => {
      const { visible } = detail;
      issueAnnotationsVisibleRef.current = visible;

      // Lazy-load if not yet loaded and we're turning issues on
      if (visible && !issueAnnotationsLoadedRef.current) {
        await loadIssueAnnotationsRef.current?.();
        issueAnnotationsLoadedRef.current = true;
      }

      // Use dedicated issue annotations manager
      const mgr = (viewerInstanceRef.current as any)?._issueAnnotationsManager;
      if (!mgr?.annotations) return;

      Object.values(mgr.annotations).forEach((ann: any) => {
        ann.markerShown = visible;
        if (ann.markerElement) {
          ann.markerElement.style.display = visible ? 'flex' : 'none';
        }
      });

      mgr.updatePositions?.();
    };

    const off = on('ISSUE_ANNOTATIONS_TOGGLE', handler);
    return () => off();
  }, []);


  const loadAccDirectModels = useCallback(async () => {
    const resolvedGuid = buildingFmGuid;
    if (!resolvedGuid) return;

    // Query for non-XKT models (GLB/OBJ from ACC pipeline)
    // Use raw filter since 'format' column is new and not in generated types yet
    const { data: accModels } = await (supabase
      .from('xkt_models')
      .select('model_id, storage_path, model_name') as any)
      .eq('building_fm_guid', resolvedGuid)
      .neq('format', 'xkt');

    if (!accModels || accModels.length === 0) return;

    console.log(`[ACC Direct] Found ${accModels.length} non-XKT models to load directly`);

    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer) {
      console.warn('[ACC Direct] xeokit viewer not available');
      return;
    }

    for (const model of accModels) {
      try {
        // Get signed URL
        const { data: urlData } = await supabase.storage
          .from('xkt-models')
          .createSignedUrl(model.storage_path, 3600);

        if (!urlData?.signedUrl) {
          console.warn(`[ACC Direct] No signed URL for ${model.model_id}`);
          continue;
        }

        const modelFormat = model.storage_path?.endsWith('.obj') ? 'obj' : 'glb';
        console.log(`[ACC Direct] Loading ${modelFormat.toUpperCase()} model: ${model.model_id}`);

        if (modelFormat === 'glb') {
          // Use GLTFLoaderPlugin
          let gltfLoader = (xeokitViewer as any).__gltfLoaderPlugin;
          if (!gltfLoader) {
            const GLTFLoaderPlugin = (xeokitViewer.constructor as any).GLTFLoaderPlugin || 
              (window as any).xeokit?.GLTFLoaderPlugin;
            if (!GLTFLoaderPlugin) {
              // Dynamic import of xeokit SDK for the loader plugin
              try {
                const sdk = await (Function('return import("https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js")')() as Promise<any>);
                if (sdk?.GLTFLoaderPlugin) {
                  gltfLoader = new sdk.GLTFLoaderPlugin(xeokitViewer);
                }
              } catch (e) {
                console.warn('[ACC Direct] Failed to load xeokit SDK for GLTFLoaderPlugin:', e);
              }
            } else {
              gltfLoader = new GLTFLoaderPlugin(xeokitViewer);
            }
            if (gltfLoader) {
              (xeokitViewer as any).__gltfLoaderPlugin = gltfLoader;
            }
          }
          
          if (gltfLoader) {
            gltfLoader.load({
              id: `acc-${model.model_id}`,
              src: urlData.signedUrl,
              edges: true,
            });
            console.log(`[ACC Direct] GLB model loaded: ${model.model_id}`);
          } else {
            console.warn('[ACC Direct] GLTFLoaderPlugin not available');
          }
        } else if (modelFormat === 'obj') {
          // Use OBJLoaderPlugin
          let objLoader = (xeokitViewer as any).__objLoaderPlugin;
          if (!objLoader) {
            const OBJLoaderPlugin = (xeokitViewer.constructor as any).OBJLoaderPlugin || 
              (window as any).xeokit?.OBJLoaderPlugin;
            if (!OBJLoaderPlugin) {
              try {
                const sdk = await (Function('return import("https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js")')() as Promise<any>);
                if (sdk?.OBJLoaderPlugin) {
                  objLoader = new sdk.OBJLoaderPlugin(xeokitViewer);
                }
              } catch (e) {
                console.warn('[ACC Direct] Failed to load xeokit SDK for OBJLoaderPlugin:', e);
              }
            } else {
              objLoader = new OBJLoaderPlugin(xeokitViewer);
            }
            if (objLoader) {
              (xeokitViewer as any).__objLoaderPlugin = objLoader;
            }
          }
          
          if (objLoader) {
            objLoader.load({
              id: `acc-${model.model_id}`,
              src: urlData.signedUrl,
              edges: true,
            });
            console.log(`[ACC Direct] OBJ model loaded: ${model.model_id}`);
          } else {
            console.warn('[ACC Direct] OBJLoaderPlugin not available');
          }
        }
      } catch (e) {
        console.warn(`[ACC Direct] Failed to load ${model.model_id}:`, e);
      }
    }
  }, [buildingFmGuid]);

  // allModelsLoadedCallback - executed when all models are loaded
  const handleAllModelsLoaded = useCallback(() => {
    try {
      console.log("allModelsLoadedCallback");

      // Cancel the model load fallback timer since models loaded successfully
      const fallbackTimer = (viewerInstanceRef.current as any)?.__modelFallbackTimer;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        (viewerInstanceRef.current as any).__modelFallbackTimer = null;
      }

      setModelLoadState('loaded');
      setInitStep('ready');

      // Load ACC models (GLB/OBJ) directly via xeokit loader plugins
      loadAccDirectModels().catch(e => {
        console.warn('[handleAllModelsLoaded] ACC direct model load failed:', e);
      });

      // ─── Deferred models are NOT auto-loaded ───
      // Non-A models (B, V, E etc.) are only loaded when the user explicitly
      // enables them via the model visibility selector in the right panel.
      // This prevents heavy fire/structural/electrical models from slowing initial load.
      if (allowedModelIdsRef.current) {
        console.log('[handleAllModelsLoaded] Non-A models deferred — user must enable manually via model selector');
      }

      // Virtual Twin: apply ghost opacity after all models load
      if (transparentBackground && ghostOpacity !== undefined) {
        try {
          const xv = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
          if (xv?.scene) {
            const ids = xv.scene.objectIds;
            if (ids?.length) {
              xv.scene.setObjectsOpacity(ids, ghostOpacity);
              // Make canvas background transparent
              const canvas = xv.scene.canvas?.canvas;
              if (canvas) canvas.style.background = 'transparent';
            }
          }
        } catch (e) {
          console.debug('Ghost opacity apply error:', e);
        }
      }
      
      // CRITICAL: Clear XKT sync status to hide the loading spinner
      setXktSyncStatus('done');
      
      // Update cache status if we had a cache interaction
      if (cacheStatusRef.current === 'checking') {
        setCacheStatus('stored');
      }

      // Enable annotations after models are loaded
      // Wrap in setTimeout (500ms) to allow Vue's internal model data to fully propagate.
      // DO NOT call getAnnotations() here — the SDK handles it internally via onToggleAnnotation.
      // Calling getAnnotations() manually causes "Model data or models array is not available" error.
      setTimeout(() => {
        try {
          const viewer = viewerInstanceRef.current;
          const assetViewer = viewer?.assetViewer;
          if (assetViewer?.onToggleAnnotation) {
            assetViewer.onToggleAnnotation(true);
            console.log("Annotations enabled");
            // NOTE: Do NOT call getAnnotations() here — SDK handles it internally
          }
        } catch (e) {
          console.warn("Could not enable annotations (models not ready):", e);
        }
      }, 500);

      // CRITICAL: Ensure spaces (rooms) are hidden by default
      // Skip when insightsColorMode is active — the insights effect will handle visibility
      if (!insightsColorModeRef.current) {
        try {
          const viewer = viewerInstanceRef.current;
          const assetViewer = viewer?.assetViewer;
          if (assetViewer?.onShowSpacesChanged) {
            assetViewer.onShowSpacesChanged(false);
            console.log("Spaces hidden by default via Asset+ API");
          }
          
          const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
          if (xeokitViewer?.metaScene?.metaObjects && xeokitViewer?.scene?.objects) {
            const metaObjects = xeokitViewer.metaScene.metaObjects;
            const sceneObjects = xeokitViewer.scene.objects;
            let hiddenCount = 0;
            Object.values(metaObjects).forEach((metaObj: any) => {
              if (metaObj.type?.toLowerCase() === 'ifcspace') {
                const entity = sceneObjects[metaObj.id];
                if (entity && entity.visible) {
                  entity.visible = false;
                  hiddenCount++;
                }
              }
            });
            console.log(`Spaces hidden directly: ${hiddenCount} IfcSpace entities`);

            // Auto-hide "Area" objects globally — these block selection in both 2D and 3D
            let areaHiddenCount = 0;
            Object.values(metaObjects).forEach((mo: any) => {
              if (mo.type?.toLowerCase() !== 'ifcspace') return;
              const name = (mo.name || '').trim().toLowerCase();
              if (name === 'area' || name.startsWith('area ') || name.startsWith('area:')) {
                const entity = sceneObjects[mo.id];
                if (entity) {
                  entity.visible = false;
                  entity.pickable = false;
                  areaHiddenCount++;
                }
              }
            });
            if (areaHiddenCount > 0) {
              console.log(`Area objects hidden & unpickable: ${areaHiddenCount}`);
            }
          }
        } catch (e) {
          console.debug("Could not hide spaces:", e);
        }
      } else {
        console.log("[AssetPlusViewer] Skipping default space-hiding — insightsColorMode active");
      }

      // Check if we should auto-enable local annotations (triggered from AssetsView)
      const shouldAutoEnableLocalAnnotations = localStorage.getItem('viewer-show-local-annotations') === 'true';
      if (shouldAutoEnableLocalAnnotations) {
        localStorage.removeItem('viewer-show-local-annotations');
        console.log('Auto-enabling local annotations from AssetsView trigger');
      }
      
      // Load local annotations from database
      // IMPORTANT: These are async functions – try/catch only catches synchronous errors.
      // We must use .catch() to handle promise rejections and prevent unhandled crashes.
      // Read from refs to avoid adding these callbacks as dependencies (which would destabilize initializeViewer).
      loadLocalAnnotationsRef.current?.().catch(e => {
        console.error('loadLocalAnnotations failed:', e);
      });
      
      // Sensor annotations (IfcAlarm BIM objects) are NOT auto-loaded.
      // They are lazy-loaded when the user toggles "Show Sensors" in the right panel.

      // Issue annotations are NOT auto-loaded (default OFF).
      // They are lazy-loaded when the user toggles "Show Issues" in the right panel.

    // Initialize NavCube using custom plugin
    try {
      const viewer = viewerInstanceRef.current;
      const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      const NavCubePlugin = (window as any).NavCubePlugin;
      
      if (xeokitViewer && NavCubePlugin && !navCubeRef.current) {
        const navCubeCanvas = document.getElementById('navCubeCanvas') as HTMLCanvasElement;
        if (navCubeCanvas) {
          navCubeRef.current = new NavCubePlugin(xeokitViewer, {
            canvasId: 'navCubeCanvas',
            visible: showNavCubeRef.current,
            cameraFly: true,
            cameraFlyDuration: 0.5,
            color: '#CFCFCF',
            frontColor: '#55FF55',
            backColor: '#FF5555',
            leftColor: '#FFAA00',
            rightColor: '#00AAFF',
            topColor: '#7777FF',
            bottomColor: '#FFFF55',
            hoverColor: '#00FFFF',
          });
          console.log("NavCube initialized successfully");
        }
      } else if (!NavCubePlugin) {
        console.debug("NavCubePlugin not loaded yet");
      }
    } catch (e) {
      console.debug("Could not initialize NavCube:", e);
    }

    // Intercept Asset+ DevExtreme context menu at capture phase so Geminus menu is the only one shown
    try {
      const xViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      const canvas = xViewer?.scene?.canvas?.canvas as HTMLCanvasElement | undefined;

      const removeDxContextMenus = () => {
        const selectors = [
          '.dx-context-menu',
          '.dx-context-menu-container',
          '.dx-context-menu-container-wrapper',
          '.dx-overlay-wrapper.dx-context-menu-container-wrapper',
          '[class*="dx-context-menu"]',
        ].join(',');

        document.querySelectorAll<HTMLElement>(selectors).forEach((el) => {
          el.style.cssText = 'display:none!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important;width:0!important;height:0!important;position:absolute!important;left:-9999px!important;top:-9999px!important;';
          el.remove();
        });

        document.querySelectorAll<HTMLElement>('.dx-overlay-wrapper').forEach((overlay) => {
          if (overlay.querySelector('.dx-context-menu, [class*="dx-context-menu"]')) {
            overlay.style.cssText = 'display:none!important;visibility:hidden!important;pointer-events:none!important;';
            overlay.remove();
          }
        });
      };

      const openGeminusMenuAt = (clientX: number, clientY: number) => {
        const liveViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer || xViewer;
        if (!liveViewer?.scene?.canvas?.canvas) {
          setContextMenu({ position: { x: clientX, y: clientY }, entityId: null, fmGuid: null, entityName: null });
          return;
        }

        const liveCanvas = liveViewer.scene.canvas.canvas as HTMLCanvasElement;
        const rect = liveCanvas.getBoundingClientRect();
        const canvasPos = [clientX - rect.left, clientY - rect.top];
        const hit = liveViewer.scene.pick({ canvasPos });

        let entityId: string | null = null;
        let fmGuid: string | null = null;
        let entityName: string | null = null;

        if (hit?.entity) {
          entityId = hit.entity.id;
          const metaObj = liveViewer.metaScene?.metaObjects?.[entityId];
          if (metaObj) {
            fmGuid = metaObj.originalSystemId || null;
            entityName = metaObj.name || null;
          }
        }

        setContextMenu({ position: { x: clientX, y: clientY }, entityId, fmGuid, entityName });

        // Remove any Asset+ menu that may be created async
        removeDxContextMenus();
        window.setTimeout(removeDxContextMenus, 0);
        window.setTimeout(removeDxContextMenus, 30);
        window.setTimeout(removeDxContextMenus, 120);
      };

      // Canvas capture listener
      if (canvas && !(canvas as any).__geminusContextMenuAttached) {
        canvas.addEventListener('contextmenu', (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          openGeminusMenuAt(ev.clientX, ev.clientY);
        }, { capture: true });
        (canvas as any).__geminusContextMenuAttached = true;
        console.log('[ContextMenu] Capturing listener attached to xeokit canvas');
      }

      // Container capture listener (catches non-canvas targets inside viewer)
      const apvDiv = document.getElementById('AssetPlusViewer');
      if (apvDiv && !(apvDiv as any).__geminusContextMenuContainerAttached) {
        apvDiv.addEventListener('contextmenu', (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          openGeminusMenuAt(ev.clientX, ev.clientY);
        }, { capture: true });
        (apvDiv as any).__geminusContextMenuContainerAttached = true;
        console.log('[ContextMenu] Capturing listener attached to #AssetPlusViewer');
      }

      // MutationObserver to remove any DevExtreme context menus/load spinners that slip through
      if (!(window as any).__dxContextMenuObserver) {
        const observer = new MutationObserver((mutations) => {
          const hasAssetPlusViewer = !!document.getElementById('AssetPlusViewer');
          if (!hasAssetPlusViewer) return;

          for (const m of mutations) {
            m.addedNodes.forEach((node) => {
              if (!(node instanceof HTMLElement)) return;
              const className = String(node.className || '');

              const containsCtx =
                className.includes('dx-context-menu') ||
                node.matches('.dx-context-menu, .dx-context-menu-container, [class*="dx-context-menu"]') ||
                !!node.querySelector('.dx-context-menu, [class*="dx-context-menu"]');

              const containsLoadSpinner =
                className.includes('dx-loadpanel') ||
                className.includes('dx-loadindicator') ||
                node.matches('.dx-loadpanel, .dx-loadpanel-wrapper, .dx-loadpanel-content, .dx-loadindicator, [class*="dx-loadpanel"], [class*="dx-loadindicator"]') ||
                !!node.querySelector('.dx-loadpanel, .dx-loadpanel-wrapper, .dx-loadpanel-content, .dx-loadindicator, [class*="dx-loadpanel"], [class*="dx-loadindicator"]');

              if (containsCtx || containsLoadSpinner) {
                node.style.cssText = 'display:none!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important;';
                node.remove();
                if (containsCtx) {
                  console.log('[ContextMenu] Removed Asset+ DevExtreme context menu from DOM');
                }
                if (containsLoadSpinner) {
                  console.log('[AssetPlusViewer] Removed Asset+ internal load spinner from DOM');
                }
              }
            });
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        (window as any).__dxContextMenuObserver = observer;
      }
    } catch (e) {
      console.debug('Could not attach context menu interceptor:', e);
    }

    // ─── Zero-object recovery ───
    // If the A-model whitelist was active and 0 objects loaded, the model was likely too
    // large or unavailable. Clear the whitelist and reload ALL models as a fallback.
    {
      const xv = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      const objectCount = xv?.scene?.objectIds?.length ?? 0;
      if (objectCount === 0 && allowedModelIdsRef.current) {
        console.warn('[handleAllModelsLoaded] 0 objects loaded with active whitelist — disabling filter and reloading all models');
        allowedModelIdsRef.current = null; // Allow all models
        const resolvedGuid = assetDataRef.current?.buildingFmGuid || assetDataRef.current?.fmGuid || fmGuid;
        if (resolvedGuid) {
          try {
            viewerInstanceRef.current?.setAvailableModelsByFmGuid(resolvedGuid);
          } catch (e) {
            console.warn('[handleAllModelsLoaded] Reload failed:', e);
          }
        }
        // Don't proceed with display — wait for the next allModelsLoadedCallback
        return;
      }
    }

    if (deferredFmGuidForDisplayRef.current) {
      console.log("allModelsLoadedCallback - got an FMGUID to look at");
      const fmGuidToShow = deferredFmGuidForDisplayRef.current;
      const displayAction = deferredDisplayActionForDisplayRef.current;

      deferredFmGuidForDisplayRef.current = undefined;
      deferredDisplayActionForDisplayRef.current = undefined;

      // If we're not cutting the floor, then select + viewfit (zoom)
      if (!displayAction) {
        console.log("allModelsLoadedCallback - just select + zoom");
        viewerInstanceRef.current?.selectFmGuidAndViewFit(fmGuidToShow);
        // Fallback: if selection yielded 0 items (building GUID not in model), zoom to all geometry
        setTimeout(() => {
          const assetView = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView;
          const scene = assetView?.viewer?.scene;
          if (scene && (!scene.selectedObjectIds || Object.keys(scene.selectedObjectIds).length === 0)) {
            console.log("allModelsLoadedCallback - selection empty, falling back to viewFitAll");
            assetView?.viewFit?.(undefined, true);
          }
        }, 300);
      } else {
        console.log("allModelsLoadedCallback - display action + select");
        executeDisplayAction(displayAction);
        viewerInstanceRef.current?.selectFmGuid(fmGuidToShow);
      }
    }
    } catch (e) {
      console.error('[handleAllModelsLoaded] Unexpected error:', e);
    }
  }, [executeDisplayAction, transparentBackground, ghostOpacity]);


  // NavCube visibility is now controlled via React style prop on the canvas
  // The navCubeRef.setVisible() method is NOT used to avoid DOM manipulation crashes
  // Visibility is handled in the canvas element's style: display: showNavCube ? 'block' : 'none'

  // Setup the pick mode click listener - defined before handleTogglePickMode
  const setupPickModeListenerInternal = useCallback(() => {
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) {
      console.warn('Pick mode: viewer or scene not ready');
      toast.error('Viewer not ready. Please try again.');
      return false;
    }

    console.log('Pick mode: Setting up click listener...');

    const handlePick = (pickResult: any) => {
      if (pickResult?.worldPos) {
        const [x, y, z] = pickResult.worldPos;
        console.log('Picked coordinates:', { x, y, z });
        
        // Store as PENDING coordinates (not final yet)
        const coords = { x, y, z };
        setPendingPickCoords(coords);
        
        // Create temporary visual marker immediately
        const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
        if (xeokitViewer?.scene?.canvas?.canvas) {
          // Remove existing temp marker if any
          if (tempMarkerElement) {
            tempMarkerElement.remove();
          }
          
          // Project world coords to screen
          const canvas = xeokitViewer.scene.canvas.canvas;
          const rect = canvas.getBoundingClientRect();
          const canvasPos = xeokitViewer.camera?.projectWorldPos?.([x, y, z]);
          
          if (canvasPos) {
            const marker = document.createElement('div');
            marker.className = 'temp-pick-marker';
            marker.innerHTML = '📍';
            marker.style.cssText = `
              position: fixed;
              font-size: 32px;
              transform: translate(-50%, -100%);
              pointer-events: none;
              z-index: 1000;
              filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
              animation: bounce 0.5s ease-out;
            `;
            marker.style.left = `${rect.left + canvasPos[0]}px`;
            marker.style.top = `${rect.top + canvasPos[1]}px`;
            document.body.appendChild(marker);
            setTempMarkerElement(marker);
          }
        }
        
        // Don't proceed to dialog yet - wait for user confirmation
        toast.success(`Position marked: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`, {
          description: 'Confirm or select a new position',
          duration: 4000,
        });
        return; // Stop here - user needs to confirm
      }
    };
    
    // Original handlePick logic is now in handleConfirmPosition
    const handlePickLegacy = (pickResult: any) => {
      if (pickResult?.worldPos) {
        const [x, y, z] = pickResult.worldPos;
        const coords = { x, y, z };
        setPickedCoordinates(coords);
        
        // Try to find the parent space from the picked entity
        let parentNode: NavigatorNode | null = null;
        
        // Try to find parent IfcSpace from the picked entity
        if (pickResult.entity?.id) {
          const pickedEntityId = pickResult.entity.id;
          const assetView = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView;
          let metaObject = assetView?.viewer?.metaScene?.metaObjects?.[pickedEntityId];
          
          // Walk up the hierarchy to find IfcSpace
          while (metaObject?.id) {
            if (metaObject.type?.toLowerCase() === 'ifcspace') {
              // Found a space - get its fmGuid
              const spaceFmGuid = metaObject.originalSystemId || metaObject.id;
              const spaceData = allData.find((a: any) => 
                a.fmGuid?.toUpperCase() === spaceFmGuid?.toUpperCase() ||
                a.fmGuid === spaceFmGuid
              );
              if (spaceData) {
                parentNode = {
                  fmGuid: spaceData.fmGuid,
                  name: spaceData.name || '',
                  commonName: spaceData.commonName || spaceData.name || '',
                  category: 'Space',
                  children: [],
                };
                console.log('Found parent space from pick:', parentNode);
                break;
              }
            }
            metaObject = metaObject.parent;
          }
        }
        
        // Fallback: use current asset's room if it's a Space, or building storey
        if (!parentNode && assetData) {
          if (assetData.category === 'Space') {
            parentNode = {
              fmGuid: assetData.fmGuid,
              name: assetData.name || '',
              commonName: assetData.commonName || assetData.name || '',
              category: 'Space',
              children: [],
            };
          } else if (assetData.inRoomFmGuid) {
            const roomData = allData.find((a: any) => a.fmGuid === assetData.inRoomFmGuid);
            if (roomData) {
              parentNode = {
                fmGuid: roomData.fmGuid,
                name: roomData.name || '',
                commonName: roomData.commonName || roomData.name || '',
                category: 'Space',
                children: [],
              };
            }
          } else if (assetData.levelFmGuid) {
            const levelData = allData.find((a: any) => a.fmGuid === assetData.levelFmGuid);
            if (levelData) {
              parentNode = {
                fmGuid: levelData.fmGuid,
                name: levelData.name || '',
                commonName: levelData.commonName || levelData.name || '',
                category: 'Building Storey',
                children: [],
              };
            }
          }
        }

        // If still no parent, use the current fmGuid asset
        if (!parentNode) {
          parentNode = {
            fmGuid: fmGuid,
            name: assetData?.name || 'Current View',
            commonName: assetData?.commonName || assetData?.name || 'Current View',
            category: assetData?.category || 'Space',
            children: [],
          };
        }

        // Cleanup listener BEFORE opening dialog
        if (pickModeListenerRef.current) {
          pickModeListenerRef.current();
          pickModeListenerRef.current = null;
        }

        // Auto-enable annotations if they're off, so the user can see the marker
        if (!showAnnotations) {
          try {
            const assetViewer = viewerInstanceRef.current?.assetViewer;
            if (assetViewer?.onToggleAnnotation) {
              assetViewer.onToggleAnnotation(true);
              setShowAnnotations(true);
              console.log('Annotations auto-enabled for position picking');
            }
          } catch (e) {
            console.debug('Could not auto-enable annotations:', e);
          }
        }

        // Check if this pick is for the inventory form sheet
        if (inventoryPickModeRef.current) {
          console.log('Routing pick result to inventory form sheet');
          setInventoryPendingPosition(coords);
          inventoryPickModeRef.current = false;
          setIsPickMode(false);
        } else if (onCoordinatePicked) {
          // External callback is provided, use it (asset registration flow)
          console.log('Calling external onCoordinatePicked callback');
          onCoordinatePicked(coords, parentNode);
          setIsPickMode(false);
        } else {
          // Internal dialog flow - open asset creation dialog
          console.log('Opening internal AddAssetDialog with parent:', parentNode);
          setAddAssetParentNode(parentNode);
          setIsPickMode(false);
          // Use setTimeout to ensure state updates before opening dialog
          setTimeout(() => {
            setAddAssetDialogOpen(true);
          }, 50);
        }
        
        toast.success(`Position vald: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
      }
    };

    // Use xeokit's pick on click - continuous listener until successful pick
    const canvas = xeokitViewer.scene.canvas.canvas;
    
    const handleClick = (e: MouseEvent) => {
      // Prevent default to avoid triggering other handlers
      e.stopPropagation();
      
      const rect = canvas.getBoundingClientRect();
      const canvasPos = [
        e.clientX - rect.left,
        e.clientY - rect.top
      ];
      
      console.log('Pick mode click at canvas position:', canvasPos);
      
      // Use xeokit's pickSurface for accurate 3D coordinates
      const pickResult = xeokitViewer.scene.pick({
        canvasPos,
        pickSurface: true,
      });
      
      if (pickResult) {
        console.log('Pick result:', pickResult);
        handlePick(pickResult);
      } else {
        toast.warning('No surface found. Try clicking on a visible object.', {
          duration: 3000,
        });
        // Don't remove listener - let user try again
      }
    };

    // Use capture phase to get events before other handlers
    canvas.addEventListener('click', handleClick, { capture: true });
    
    // Store cleanup function
    pickModeListenerRef.current = () => {
      canvas.removeEventListener('click', handleClick, { capture: true });
      console.log('Pick mode listener cleaned up');
    };

    return true;
  }, [allData, assetData, fmGuid, onCoordinatePicked]);

  // Handle confirming the pending position
  const handleConfirmPosition = useCallback(() => {
    if (!pendingPickCoords) return;
    
    // Remove temp marker
    if (tempMarkerElement) {
      tempMarkerElement.remove();
      setTempMarkerElement(null);
    }
    
    // Set as final coordinates
    setPickedCoordinates(pendingPickCoords);
    
    // Build parent node from the picked data
    let parentNode: NavigatorNode | null = null;
    
    // Use current asset context for parent info
    if (assetData) {
      if (assetData.category === 'Space') {
        parentNode = {
          fmGuid: assetData.fmGuid,
          name: assetData.name || '',
          commonName: assetData.commonName || assetData.name || '',
          category: 'Space',
          children: [],
        };
      } else if (assetData.inRoomFmGuid) {
        const roomData = allData.find((a: any) => a.fmGuid === assetData.inRoomFmGuid);
        if (roomData) {
          parentNode = {
            fmGuid: roomData.fmGuid,
            name: roomData.name || '',
            commonName: roomData.commonName || roomData.name || '',
            category: 'Space',
            children: [],
          };
        }
      }
    }
    
    // Clear pending and disable pick mode
    setPendingPickCoords(null);
    setIsPickMode(false);
    
    if (pickModeListenerRef.current) {
      pickModeListenerRef.current();
      pickModeListenerRef.current = null;
    }
    
    // Check routing
    if (inventoryPickModeRef.current) {
      setInventoryPendingPosition(pendingPickCoords);
      inventoryPickModeRef.current = false;
    } else if (onCoordinatePicked) {
      onCoordinatePicked(pendingPickCoords, parentNode);
    } else {
      setAddAssetParentNode(parentNode);
      setTimeout(() => setAddAssetDialogOpen(true), 50);
    }
    
    toast.success('Position bekräftad!');
  }, [pendingPickCoords, tempMarkerElement, assetData, allData, onCoordinatePicked]);

  // Handle repicking position
  const handleRepickPosition = useCallback(() => {
    // Remove temp marker
    if (tempMarkerElement) {
      tempMarkerElement.remove();
      setTempMarkerElement(null);
    }
    setPendingPickCoords(null);
    
    // Restart pick mode
    const success = setupPickModeListenerInternal();
    if (success) {
      toast.info('Click on a new position');
    }
  }, [tempMarkerElement, setupPickModeListenerInternal]);

  // Handle coordinate picking mode - supports both internal and external control
  const handleTogglePickMode = useCallback(() => {
    if (isPickMode) {
      // Disable pick mode
      setIsPickMode(false);
      setPendingPickCoords(null);
      if (tempMarkerElement) {
        tempMarkerElement.remove();
        setTempMarkerElement(null);
      }
      toast.info('Registration mode cancelled');
      
      // Remove listener if exists
      if (pickModeListenerRef.current) {
        pickModeListenerRef.current();
        pickModeListenerRef.current = null;
      }
    } else {
      // Enable pick mode
      const success = setupPickModeListenerInternal();
      if (success) {
        setIsPickMode(true);
        toast.info('Click on a surface in the 3D view to select position', {
          duration: 5000,
        });
      }
    }
  }, [isPickMode, setupPickModeListenerInternal, tempMarkerElement]);

  // Respond to external pickModeEnabled prop changes
  useEffect(() => {
    if (pickModeEnabled && !isPickMode && state.isInitialized) {
      const success = setupPickModeListenerInternal();
      if (success) {
        setIsPickMode(true);
        toast.info('Klicka på en yta i 3D-vyn för att välja position', {
          duration: 5000,
        });
      }
    } else if (!pickModeEnabled && isPickMode) {
      // External cancelled pick mode
      setIsPickMode(false);
      if (pickModeListenerRef.current) {
        pickModeListenerRef.current();
        pickModeListenerRef.current = null;
      }
    }
  }, [pickModeEnabled, isPickMode, state.isInitialized, setupPickModeListenerInternal]);

  // Cleanup pick mode listener and temp markers on unmount
  useEffect(() => {
    return () => {
      if (pickModeListenerRef.current) {
        pickModeListenerRef.current();
        pickModeListenerRef.current = null;
      }
      // Remove all temp pick markers from DOM when viewer unmounts
      document.querySelectorAll('.temp-pick-marker').forEach(el => el.remove());
    };
  }, []);

  // Handle asset created - close dialog and show toast
  const handleAssetCreated = useCallback(() => {
    setAddAssetDialogOpen(false);
    setPickedCoordinates(null);
    setAddAssetParentNode(null);
    toast.success('Tillgång registrerad med 3D-koordinater!');
  }, []);

  // Open inventory sheet (replaces old add asset dialog flow)
  const handleOpenInventorySheet = useCallback(() => {
    setInventorySheetOpen(true);
  }, []);

  // Handle pick request from inventory sheet
  const handleInventoryPickRequest = useCallback(() => {
    inventoryPickModeRef.current = true;
    const success = setupPickModeListenerInternal();
    if (success) {
      setIsPickMode(true);
      toast.info('Klicka på en yta i 3D-vyn för att välja position', {
        duration: 5000,
      });
    }
  }, [setupPickModeListenerInternal]);

  // Handle floor selection from carousel
  const handleFloorSelect = useCallback((floor: FloorInfo) => {
    setSelectedFloorId(floor.id);
    
    // Navigate to floor with cutout
    const viewer = viewerInstanceRef.current;
    if (viewer) {
      try {
        // Use the floor's fmGuid for cutout
        viewer.cutOutFloorsByFmGuid(floor.fmGuid, true, { doViewFit: true });
        toast.success(`Navigerar till ${floor.name}`);
      } catch (e) {
        console.debug('Could not cut out floor:', e);
      }
    }
  }, []);

  // Toggle annotations visibility
  const handleToggleAnnotations = useCallback(() => {
    try {
      const viewer = viewerInstanceRef.current?.assetViewer;
      if (viewer && typeof viewer.onToggleAnnotation === 'function') {
        const newValue = !showAnnotations;
        viewer.onToggleAnnotation(newValue);
        setShowAnnotations(newValue);
      }
    } catch (error) {
      console.warn('Toggle annotations failed:', error);
    }
  }, [showAnnotations]);

  // Setup hover highlight listener
  const setupHoverHighlight = useCallback(() => {
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene || !xeokitViewer?.cameraControl) {
      console.warn('[AssetPlusViewer] Hover setup failed - viewer/cameraControl not available');
      return;
    }

    let lastHighlightedEntity: any = null;
    const cameraControl = xeokitViewer.cameraControl;

    const highlightEntity = (entity: any) => {
      if (lastHighlightedEntity && lastHighlightedEntity !== entity) {
        try { lastHighlightedEntity.highlighted = false; } catch (e) {}
      }
      if (entity) {
        entity.highlighted = true;
        lastHighlightedEntity = entity;
      }
    };

    const clearHighlight = () => {
      if (lastHighlightedEntity) {
        try { lastHighlightedEntity.highlighted = false; } catch (e) {}
        lastHighlightedEntity = null;
      }
    };

    // "hover" fires when pointer enters a new entity
    const onHover = (_canvasCoords: any, hit: any) => {
      if (hit?.entity) {
        highlightEntity(hit.entity);
      }
    };

    // "hoverSurface" fires continuously while pointer moves over entity surface
    const onHoverSurface = (_canvasCoords: any, hit: any) => {
      if (hit?.entity) {
        highlightEntity(hit.entity);
      }
    };

    // "hoverOut" fires when pointer leaves last entity
    const onHoverOut = () => {
      clearHighlight();
    };

    // "hoverOff" fires when pointer is over empty space
    const onHoverOff = () => {
      clearHighlight();
    };

    cameraControl.on('hover', onHover);
    cameraControl.on('hoverSurface', onHoverSurface);
    cameraControl.on('hoverOut', onHoverOut);
    cameraControl.on('hoverOff', onHoverOff);

    console.log('[AssetPlusViewer] Hover highlight active (4 events subscribed)');

    hoverListenerRef.current = () => {
      cameraControl.off('hover', onHover);
      cameraControl.off('hoverSurface', onHoverSurface);
      cameraControl.off('hoverOut', onHoverOut);
      cameraControl.off('hoverOff', onHoverOff);
      clearHighlight();
    };
  }, []);

  // Cleanup hover highlight listener
  const cleanupHoverHighlight = useCallback(() => {
    if (hoverListenerRef.current) {
      hoverListenerRef.current();
      hoverListenerRef.current = null;
    }
  }, []);

  // Toggle hover highlight
  useEffect(() => {
    if (hoverHighlightEnabled && state.isInitialized) {
      setupHoverHighlight();
    } else {
      cleanupHoverHighlight();
    }
    return cleanupHoverHighlight;
  }, [hoverHighlightEnabled, state.isInitialized, setupHoverHighlight, cleanupHoverHighlight]);

  // Listen for saved view loading events
  useEffect(() => {
    const handleLoadSavedView = (viewData: LoadSavedViewDetail) => {
      const viewData = e.detail;
      console.log('LOAD_SAVED_VIEW_EVENT received:', viewData);
      
      // Wait for viewer to be initialized and model loaded
      if (!state.isInitialized || modelLoadState !== 'loaded') {
        console.log('Viewer not ready yet, will retry after model loads');
        // Store the pending view data and apply after model loads
        const retryHandler = () => {
          setTimeout(() => {
            applyViewSettings(viewData);
          }, 500);
        };
        // Retry after a delay
        setTimeout(retryHandler, 1000);
        return;
      }
      
      applyViewSettings(viewData);
    };
    
    const applyViewSettings = (viewData: LoadSavedViewDetail) => {
      const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (!xeokitViewer) {
        console.warn('Could not get xeokit viewer for saved view');
        return;
      }
      
      console.log('Applying saved view settings:', viewData);
      
      // 1. Set camera position
      if (viewData.cameraEye && viewData.cameraLook && viewData.cameraUp) {
        const camera = xeokitViewer.camera;
        if (camera) {
          // Set projection first
          camera.projection = viewData.cameraProjection || 'perspective';
          
          // Fly to saved position
          xeokitViewer.cameraFlight?.flyTo({
            eye: viewData.cameraEye,
            look: viewData.cameraLook,
            up: viewData.cameraUp,
            duration: 0.8,
          });
        }
      }
      
      // 2. Set 2D/3D mode
      setTimeout(() => {
        emit('VIEW_MODE_REQUESTED', { mode: viewData.viewMode });
        
        // 3. Set clip height if in 2D mode
        if (viewData.viewMode === '2d' && viewData.clipHeight) {
          setTimeout(() => {
            emit('CLIP_HEIGHT_CHANGED', { height: viewData.clipHeight });
          }, 300);
        }
      }, 100);
      
      // 4. Set show spaces
      if (viewData.showSpaces) {
        try {
          const assetViewer = viewerInstanceRef.current?.assetViewer;
          assetViewer?.onShowSpacesChanged?.(true);
        } catch (e) {
          console.debug('Could not set show spaces:', e);
        }
      }
      
      // 5. Set show annotations
      if (viewData.showAnnotations) {
        try {
          const viewer = viewerInstanceRef.current?.assetViewer;
          if (viewer && typeof viewer.onToggleAnnotation === 'function') {
            viewer.onToggleAnnotation(true);
            setShowAnnotations(true);
          }
        } catch (e) {
          console.debug('Could not set show annotations:', e);
        }
      }
      
      toast.success('Vy laddad', { duration: 2000 });
    };
    
    const offHandleLoadSavedView = on('LOAD_SAVED_VIEW', handleLoadSavedView);
    return () => {
      offHandleLoadSavedView();
    };
  }, [state.isInitialized, modelLoadState]);

  // Dispatch viewer context changes for Gunnar AI integration
  const [currentViewMode, setCurrentViewMode] = useState<'2d' | '3d'>('3d');
  const [clipHeight, setClipHeight] = useState(1.2);
  
  // Listen for view mode changes
  useEffect(() => {
    const handleViewModeChanged = (detail: ViewModeEventDetail) => {
      setCurrentViewMode(detail.mode);
    };
    const handleClipHeightChanged = (detail: ClipHeightEventDetail) => {
      setClipHeight(detail.height);
    };
    const offHandleViewModeChanged = on('VIEW_MODE_CHANGED', handleViewModeChanged);
    const offHandleClipHeightChanged = on('CLIP_HEIGHT_CHANGED', handleClipHeightChanged);
    return () => {
      offHandleViewModeChanged();
      offHandleClipHeightChanged();
    };
  }, []);
  
  // Dispatch context to Gunnar when relevant state changes
  useEffect(() => {
    if (!state.isInitialized || modelLoadState !== 'loaded') return;
    
    const contextDetail: ViewerContextChangedDetail = {
      buildingFmGuid: buildingFmGuid || fmGuid,
      buildingName: assetData?.commonName || assetData?.name,
      viewMode: currentViewMode,
      visibleFloorFmGuids: visibleFloorFmGuids,
      visibleModelIds: availableModels.filter(m => m.visible).map(m => m.id),
      selectedFmGuids: selectedFmGuids,
      clipHeight: clipHeight,
    };
    
    emit('VIEWER_CONTEXT_CHANGED', contextDetail);
  }, [state.isInitialized, modelLoadState, buildingFmGuid, fmGuid, assetData, currentViewMode, visibleFloorFmGuids, availableModels, selectedFmGuids, clipHeight]);

  // Extract available models when viewer loads
  useEffect(() => {
    if (modelLoadState !== 'loaded' || initStep !== 'ready') return;
    
    const extractModels = () => {
      const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (!xeokitViewer?.scene?.models) return;
      
      const models = Object.entries(xeokitViewer.scene.models).map(([id, model]: [string, any]) => {
        // Try to resolve a friendly name from modelNamesMap (same source as ModelVisibilitySelector)
        const rawName = model.id || id;
        const fileNameWithoutExt = rawName.replace(/\.xkt$/i, '');
        const friendlyName =
          modelNamesMap.get(rawName) ||
          modelNamesMap.get(rawName.toLowerCase()) ||
          modelNamesMap.get(fileNameWithoutExt) ||
          modelNamesMap.get(fileNameWithoutExt.toLowerCase()) ||
          // Strategy: IfcProject root from metaScene
          (() => {
            try {
              const metaModel = xeokitViewer.metaScene?.metaModels?.[id];
              const root = metaModel?.rootMetaObject;
              if (root?.type === 'IfcProject' && root.name && !root.name.match(/^[0-9A-Fa-f-]{30,}$/)) {
                return root.name;
              }
            } catch { /* ignore */ }
            return null;
          })() ||
          id;
        return {
          id,
          name: friendlyName,
          visible: model.visible !== false
        };
      });
      
      setAvailableModels(models);
    };
    
    // Small delay to ensure models are fully loaded
    const timer = setTimeout(extractModels, 500);
    return () => clearTimeout(timer);
  }, [modelLoadState, initStep, modelNamesMap]);

  // Listen for Gunnar commands
  useEffect(() => {
    const handleGunnarShowFloor = (e: CustomEvent<{ floorFmGuid: string }>) => {
      const viewer = viewerInstanceRef.current;
      if (viewer && e.detail.floorFmGuid) {
        try {
          viewer.cutOutFloorsByFmGuid(e.detail.floorFmGuid, true, { doViewFit: true });
        } catch (err) {
          console.debug('Could not cut to floor:', err);
        }
      }
    };
    
    const handleGunnarHighlight = (e: CustomEvent<{ fmGuids: string[] }>) => {
      if (e.detail.fmGuids && e.detail.fmGuids.length > 0) {
        e.detail.fmGuids.forEach(guid => {
          flashEntityById(guid, viewerInstanceRef.current);
        });
      }
    };
    
    const handleGunnarFlyTo = (e: CustomEvent<{ fmGuid: string }>) => {
      if (e.detail.fmGuid) {
        lookAtInstanceFromAngle(e.detail.fmGuid, defaultMinimumHeightAboveBase, defaultHeightAboveAABB);
      }
    };
    
    window.addEventListener('GUNNAR_SHOW_FLOOR', handleGunnarShowFloor as EventListener);
    window.addEventListener('GUNNAR_HIGHLIGHT', handleGunnarHighlight as EventListener);
    window.addEventListener('GUNNAR_FLY_TO', handleGunnarFlyTo as EventListener);
    
    return () => {
      window.removeEventListener('GUNNAR_SHOW_FLOOR', handleGunnarShowFloor as EventListener);
      window.removeEventListener('GUNNAR_HIGHLIGHT', handleGunnarHighlight as EventListener);
      window.removeEventListener('GUNNAR_FLY_TO', handleGunnarFlyTo as EventListener);
    };
  }, [flashEntityById, lookAtInstanceFromAngle]);

  // Listen for Architect View Mode requests
  useEffect(() => {
    const handleArchitectModeRequest = (detail: { enabled: boolean }) => {
      console.log('ARCHITECT_MODE_REQUESTED:', detail.enabled);
      const success = toggleArchitectMode(viewerInstanceRef, detail.enabled);
      
      // Dispatch confirmation event
      if (success) {
        emit('ARCHITECT_MODE_CHANGED', { enabled: detail.enabled });
        toast.info(detail.enabled ? 'Arkitektvy aktiverad' : 'Arkitektvy avaktiverad', { duration: 2000 });
      }
    };
    
    const offHandleArchitectModeRequest = on('ARCHITECT_MODE_REQUESTED', handleArchitectModeRequest);
    return () => {
      offHandleArchitectModeRequest();
    };
  }, [toggleArchitectMode]);

  // Listen for architect background color changes
  useEffect(() => {
    const handleBackgroundChange = (detail: { presetId: string }) => {
      console.log('ARCHITECT_BACKGROUND_CHANGED:', detail.presetId);
      // Directly apply background since we know architect mode is active (palette is visible)
      applyBackgroundPreset(detail.presetId as BackgroundPresetId);
    };
    
    const offHandleBackgroundChange = on('ARCHITECT_BACKGROUND_CHANGED', handleBackgroundChange);
    return () => {
      offHandleBackgroundChange();
    };
  }, [applyBackgroundPreset]);

  // Listen for room labels toggle from VisualizationToolbar
  useEffect(() => {
    const handleRoomLabelsToggle = (detail: { enabled: boolean }) => {
      console.log('ROOM_LABELS_TOGGLE:', detail.enabled);
      setRoomLabelsEnabled(detail.enabled);
    };
    
    const offHandleRoomLabelsToggle = on('ROOM_LABELS_TOGGLE', handleRoomLabelsToggle);
    return () => {
      offHandleRoomLabelsToggle();
    };
  }, [setRoomLabelsEnabled]);

  // Extract floors from viewer for mobile UI
  const extractMobileFloors = useCallback(() => {
    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.metaScene?.metaObjects) return [];

    const metaObjects = xeokitViewer.metaScene.metaObjects;
    const extractedFloors: { id: string; fmGuid: string; name: string; visible: boolean }[] = [];

    Object.values(metaObjects).forEach((metaObject: any) => {
      const type = metaObject?.type?.toLowerCase();
      if (type === 'ifcbuildingstorey') {
        extractedFloors.push({
          id: metaObject.id,
          fmGuid: metaObject.id,
          name: metaObject.name || 'Unknown Floor',
          visible: true, // All visible by default
        });
      }
    });

    // Sort by name (floors are typically numbered)
    extractedFloors.sort((a, b) => {
      const extractLevel = (name: string): number => {
        const match = name.match(/(-?\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      };
      return extractLevel(b.name) - extractLevel(a.name);
    });

    return extractedFloors;
  }, []);

  // Update mobile floors when model loads
  useEffect(() => {
    if (modelLoadState === 'loaded' && initStep === 'ready') {
      const floors = extractMobileFloors();
      setMobileFloors(floors);
    }
  }, [modelLoadState, initStep, extractMobileFloors]);

  // Handle mobile floor toggle
  const handleMobileFloorToggle = useCallback((floorId: string, visible: boolean) => {
    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const scene = xeokitViewer?.scene;
    const metaScene = xeokitViewer?.metaScene;
    
    if (!scene || !metaScene) return;

    try {
      // Toggle visibility of the floor and all its children
      const toggleHierarchy = (metaObjectId: string, visible: boolean) => {
        const entity = scene.objects?.[metaObjectId];
        if (entity) {
          entity.visible = visible;
        }
        
        const metaObject = metaScene.metaObjects?.[metaObjectId];
        metaObject?.children?.forEach((child: any) => {
          toggleHierarchy(child.id, visible);
        });
      };

      toggleHierarchy(floorId, visible);

      // Update state and hide IfcCovering in solo mode
      setMobileFloors(prev => {
        const newFloors = prev.map(f => 
          f.id === floorId ? { ...f, visible } : f
        );

        // Hide IfcCovering objects in solo mode (matches desktop FloorVisibilitySelector)
        const visibleFloors = newFloors.filter(f => f.visible);
        const isAllVisible = visibleFloors.length === newFloors.length;
        const isSolo = visibleFloors.length === 1;

        if (isSolo) {
          const metaObjects = metaScene.metaObjects || {};
          const coveringIds: string[] = [];
          Object.values(metaObjects).forEach((metaObj: any) => {
            if (metaObj.type?.toLowerCase() === 'ifccovering') {
              coveringIds.push(metaObj.id);
            }
          });
          if (coveringIds.length > 0) {
            scene.setObjectsVisible(coveringIds, false);
            console.debug(`[MobileFloor] Hidden ${coveringIds.length} IfcCovering objects in solo mode`);
          }
        }

        // Dispatch floor selection event to sync room labels, ceiling clipping etc.
        emit('FLOOR_SELECTION_CHANGED', {
            floorId: isSolo ? visibleFloors[0].id : null,
            visibleFloorFmGuids: visibleFloors.map(f => f.fmGuid),
            visibleMetaFloorIds: visibleFloors.map(f => f.id),
            isAllFloorsVisible: isAllVisible,
          });

        return newFloors;
      });
    } catch (e) {
      console.debug('Error toggling floor visibility:', e);
    }
  }, []);

  // Reset camera to initial view
  const handleResetCamera = useCallback(() => {
    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    
    if (!xeokitViewer?.cameraFlight) return;

    try {
      // Fit scene to view
      const scene = xeokitViewer.scene;
      if (scene) {
        xeokitViewer.cameraFlight.flyTo({
          aabb: scene.aabb,
          duration: 0.5,
        });
      }
    } catch (e) {
      console.debug('Error resetting camera:', e);
    }
  }, []);

  // XKT cache interceptor - Cache-on-Load implementation
  // Passively captures XKT model responses and saves them to backend
  // Does NOT block or modify the viewer's loading - just clones and saves in background
  const setupCacheInterceptor = useCallback(() => {
    // Skip if already set up
    if (originalFetchRef.current) {
      console.log('XKT cache: Interceptor already active');
      return;
    }
    
    const resolvedBuildingGuid = buildingFmGuid;
    if (!resolvedBuildingGuid) {
      console.log('XKT cache: No building GUID, skipping interceptor');
      return;
    }
    
    console.log('XKT cache: Setting up Cache-on-Load interceptor');
    originalFetchRef.current = window.fetch;
    
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // Safety check: if the interceptor has been cleaned up (restoreFetch called while
      // an intercepted fetch was still in flight), fall back to the native fetch.
      const original = originalFetchRef.current;
      if (!original) {
        console.debug('XKT cache: Interceptor cleaned up, using native fetch');
        return fetch(input, init);
      }
      
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      
      // Check if this is an XKT model request (only Asset+ API URLs, not Supabase/Storage)
      const isXktRequest = (url.includes('.xkt') && 
                            !url.includes('supabase') && 
                            !url.includes('googleapis') &&
                            !url.includes('storage.')) || 
                           url.toLowerCase().includes('getxktdata');
      
      if (!isXktRequest) {
        // Not an XKT request, pass through
        return original!(input, init);
      }
      
      // ─── XKT DIAGNOSTICS ───
      const diagStart = performance.now();
      
      // Extract model ID for caching
      const modelId = xktCacheService.extractModelIdFromUrl(url);
      
      if (modelId) {
        // Check if model is in the initial load whitelist
        if (allowedModelIdsRef.current) {
          const allowed = allowedModelIdsRef.current;
          const lower = modelId.toLowerCase();
          const stripped = lower.replace(/\.xkt$/i, '');
          const isAllowed = allowed.has(modelId) || allowed.has(lower) || allowed.has(stripped);
          if (!isAllowed) {
            console.log(`XKT filter: Non-initial model ${modelId} — passing through without caching`);
            return original!(input, init);
          }
        }
        
        // Check memory cache first
        const memoryData = getModelFromMemory(modelId, resolvedBuildingGuid);
        if (memoryData) {
          const elapsed = Math.round(performance.now() - diagStart);
          console.log(`%c[XKT DIAG] ✅ MEMORY HIT — ${modelId} — ${(memoryData.byteLength / 1024 / 1024).toFixed(1)} MB — ${elapsed}ms`, 'color:#22c55e;font-weight:bold');
          // Return cached data as a Response
          return new Response(memoryData.slice(0), {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' }
          });
        }
        
        // Check database cache (skip stale entries — force fresh download)
        try {
          const dbCheckStart = performance.now();
          const cacheResult = await xktCacheService.checkCache(modelId, resolvedBuildingGuid);
          const dbCheckMs = Math.round(performance.now() - dbCheckStart);
          
          if (cacheResult.cached && cacheResult.url) {
            // Age-stale check (>7 days)
            if (cacheResult.stale) {
              console.log(`%c[XKT DIAG] ⏳ STALE (>7d) — ${modelId} — DB check: ${dbCheckMs}ms — fetching fresh`, 'color:#eab308;font-weight:bold');
            } else {
              // Fetch from storage
              const storeFetchStart = performance.now();
              const cachedResponse = await original!(cacheResult.url, init);
              const storeFetchMs = Math.round(performance.now() - storeFetchStart);
              
              if (cachedResponse.ok) {
                const data = await cachedResponse.clone().arrayBuffer();
                // Validate binary data before serving — reject HTML/JSON error responses
                const MIN_XKT_BYTES = 50_000;
                const firstByte = data.byteLength > 0 ? String.fromCharCode(new Uint8Array(data)[0]) : '';
                if (data.byteLength >= MIN_XKT_BYTES && firstByte !== '<' && firstByte !== '{') {
                  storeModelInMemory(modelId, resolvedBuildingGuid, data);
                  const totalMs = Math.round(performance.now() - diagStart);
                  console.log(`%c[XKT DIAG] 💾 STORAGE HIT — ${modelId} — ${(data.byteLength / 1024 / 1024).toFixed(1)} MB — DB: ${dbCheckMs}ms + fetch: ${storeFetchMs}ms = ${totalMs}ms total`, 'color:#3b82f6;font-weight:bold');
                  return new Response(data, {
                    status: 200,
                    headers: { 'Content-Type': 'application/octet-stream' }
                  });
                } else {
                  console.warn(`%c[XKT DIAG] ❌ CORRUPT — ${modelId} — ${data.byteLength} bytes — falling through`, 'color:#ef4444;font-weight:bold');
                }
              }
            }
          } else {
            console.log(`%c[XKT DIAG] 🔍 CACHE MISS — ${modelId} — DB check: ${dbCheckMs}ms — will fetch from Asset+ API`, 'color:#f97316;font-weight:bold');
          }
        } catch (e) {
          console.debug('XKT cache: Database check failed, fetching from source', e);
        }
      }
      
      // Fetch from Asset+ API
      const apiFetchStart = performance.now();
      const response = await original!(input, init);
      const apiFetchMs = Math.round(performance.now() - apiFetchStart);
      const totalMs = Math.round(performance.now() - diagStart);
      if (modelId) {
        console.log(`%c[XKT DIAG] 🌐 API FETCH — ${modelId} — status: ${response.status} — API: ${apiFetchMs}ms — total: ${totalMs}ms`, 'color:#a855f7;font-weight:bold');
      }
      
      // Only process successful XKT responses
      if (response.ok && modelId) {
        // Clone the response so we can read it without consuming the original
        const responseClone = response.clone();
        
        // Extract Last-Modified header for source timestamp tracking
        const sourceLastModified = response.headers.get('Last-Modified') || undefined;
        
        // Process in background - don't await
        (async () => {
          try {
            const data = await responseClone.arrayBuffer();
            
            // Validate it's actual XKT data — minimum 50 KB and not an HTML/JSON error response
            const MIN_VALID_XKT_BYTES = 50_000;
            const isLargeEnough = data.byteLength >= MIN_VALID_XKT_BYTES;
            const headerBytes = new Uint8Array(data, 0, Math.min(4, data.byteLength));
            const firstChar = String.fromCharCode(headerBytes[0]);
            const isHtmlOrJsonResponse = firstChar === '<' || firstChar === '{';

            if (isLargeEnough && !isHtmlOrJsonResponse) {
              // Store in memory cache
              storeModelInMemory(modelId, resolvedBuildingGuid, data);
              
              // Save to backend storage in background
              xktCacheService.saveModelFromViewer(
                modelId,
                data,
                resolvedBuildingGuid,
                modelId, // Use modelId as name for now
                sourceLastModified
              ).then(saved => {
                if (saved) {
                  console.log(`XKT cache: Saved ${modelId} to backend`);
                }
              }).catch(e => {
                console.debug(`XKT cache: Failed to save ${modelId} to backend:`, e);
              });
            } else if (!isLargeEnough) {
              console.warn(`XKT cache: Rejected ${modelId} — only ${data.byteLength} bytes (< 50 KB minimum, likely corrupt)`);
            } else if (isHtmlOrJsonResponse) {
              console.warn(`XKT cache: Rejected ${modelId} — starts with '${firstChar}', looks like HTML/JSON error response`);
            }
          } catch (e) {
            console.debug('XKT cache: Failed to process response for caching:', e);
          }
        })();
      }
      
      return response;
    };
    
    const stats = getMemoryStats();
    console.log(`XKT cache: Interceptor active (memory: ${stats.modelCount} models, ${(stats.usedBytes / 1024 / 1024).toFixed(1)} MB)`);
  }, [buildingFmGuid]);

  // Keep callback refs in sync for stable initializeViewer dependency array
  useEffect(() => { handleAllModelsLoadedRef.current = handleAllModelsLoaded; }, [handleAllModelsLoaded]);
  useEffect(() => { changeXrayMaterialRef.current = changeXrayMaterial; }, [changeXrayMaterial]);
  useEffect(() => { processDeferredRef.current = processDeferred; }, [processDeferred]);
  useEffect(() => { displayFmGuidRef.current = displayFmGuid; }, [displayFmGuid]);
  useEffect(() => { setupCacheInterceptorRef.current = setupCacheInterceptor; }, [setupCacheInterceptor]);

  // Restore original fetch
  const restoreFetch = useCallback(() => {
    if (originalFetchRef.current) {
      window.fetch = originalFetchRef.current;
      originalFetchRef.current = null;
      console.log('XKT cache: Interceptor removed');
    }
  }, []);

  const initializeViewer = useCallback(async () => {
    // Always clear error first so the viewer container renders back into the DOM.
    // Reset allowedModelIdsRef to avoid stale whitelist from previous building
    allowedModelIdsRef.current = null;
    setInitStep('wait_dom');
    setState(prev => ({ ...prev, isLoading: true, error: null, isInitialized: false }));

    // Wait for DOM with retry logic (handles React Strict Mode timing issues)
    // IMPORTANT: Do not show an error too quickly.
    // In practice, React StrictMode + async data can cause the container to be temporarily
    // unavailable for a short moment; showing an error here creates the “flash” the user sees.
    const maxDomWaitMs = 3000;
    const domStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let containerReady = false;

    while (true) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      if (viewerContainerRef.current) {
        containerReady = true;
        break;
      }

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - domStart >= maxDomWaitMs) {
        break;
      }

      // Small delay to avoid a tight loop while waiting for DOM.
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
    }

    if (!containerReady || !viewerContainerRef.current) {
      setInitStep('error');
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: '3D container missing in DOM. Try again or reload the page.',
      }));
      return;
    }

    // CRITICAL FIX: Destroy and recreate #AssetPlusViewer div to give Asset+ a fresh DOM anchor.
    // This prevents 'nextSibling' null errors when the old Vue runtime hasn't fully detached yet.
    const container = viewerContainerRef.current;
    container.innerHTML = '';
    const freshDiv = document.createElement('div');
    freshDiv.id = 'AssetPlusViewer';
    // CRITICAL: CSS selector #AssetPlusViewer.asset-plus-hide-builtin-toolbar requires BOTH id AND class on the SAME element.
    // DX-classes must also be here so Asset+ Vue runtime finds correct device/theme context.
    freshDiv.className = [
      isMobile ? 'dx-device-mobile' : 'dx-device-desktop',
      'dx-device-generic', 'dx-theme-material', 'dx-theme-material-typography',
      'asset-plus-hide-builtin-toolbar'
    ].join(' ');
    // flex:1 expands to fill the flex-column container; height:100% as fallback
    freshDiv.style.cssText = 'width:100%;height:100%;flex:1 1 auto;display:flex;flex-direction:column;';
    container.appendChild(freshDiv);

    // Wait 2 rAF + 50ms so the old Vue instance fully releases its DOM bindings
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    await new Promise<void>(r => setTimeout(r, 50));

    // Re-check container after settlement — React may have unmounted us during the wait
    if (!viewerContainerRef.current) {
      console.warn('[AssetPlusViewer] Container lost after settlement wait, aborting init');
      return;
    }

    setModelLoadState('idle');
    setCacheStatus(null);
    
    // Preserve preloaded XKT data in memory — useXktPreload may have already fetched models.
    // Only clear if no models are cached (avoids double-fetch which was the main perf bottleneck).
    if (buildingFmGuid) {
      const stats = getMemoryStats();
      if (stats.modelCount === 0) {
        console.log('AssetPlusViewer: No preloaded models in memory');
      } else {
        console.log(`AssetPlusViewer: ${stats.modelCount} preloaded models in memory (${(stats.usedBytes / 1024 / 1024).toFixed(1)} MB) — preserving for cache hits`);
      }
    }

    // Setup cache interceptor before viewer initialization
    // SKIP on mobile to save memory – cache-on-load doubles memory usage via .clone() + .arrayBuffer()
    // on every XKT model. For a building with 5 models × 10 MB = ~50 MB extra memory avoided on mobile.
    if (!isMobile) {
      setupCacheInterceptorRef.current();
    }

    // Initialization timeout – prevents infinite spinner on slow/unstable mobile connections
    const INIT_TIMEOUT_MS = isMobile ? 30_000 : 45_000;
    const timeoutId = setTimeout(() => {
      // If we're still loading after the timeout, force an error
      setState(prev => {
        if (prev.isLoading && !prev.isInitialized) {
          console.error(`[AssetPlusViewer] Initialization timed out after ${INIT_TIMEOUT_MS}ms`);
          setInitStep('error');
          setShowError(true);
          return {
            ...prev,
            isLoading: false,
            error: `Initialization timed out (${INIT_TIMEOUT_MS / 1000}s). Check your network connection and try again.`,
          };
        }
        return prev;
      });
    }, INIT_TIMEOUT_MS);

    const initStartTime = performance.now();
    try {
      setInitStep('fetch_token');
      
      const TOKEN_CACHE_KEY = 'geminus_ap_token';
      const CONFIG_CACHE_KEY = 'geminus_ap_config';

      // Read actual token expiry from JWT payload (Asset+ staging tokens expire in 5 min!)
      // Using hardcoded 55min was causing 401s on all requests after minute 5.
      const getJwtExpiry = (token: string): number => {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          return (payload.exp * 1000) - 30_000; // 30s safety margin
        } catch {
          return Date.now() + 4 * 60 * 1000; // fallback: 4 min
        }
      };

      let accessToken: string | null = null;
      
      // Clear stale/expired cached token — validate against JWT exp directly
      // (cached expiresAt may be wrong from old sessions that used hardcoded 55min)
      const rawCached = sessionStorage.getItem(TOKEN_CACHE_KEY);
      if (rawCached) {
        try {
          const { token } = JSON.parse(rawCached);
          // Always re-derive expiry from the JWT itself (ignores cached expiresAt)
          const jwtExpiry = getJwtExpiry(token);
          if (Date.now() >= jwtExpiry) {
            sessionStorage.removeItem(TOKEN_CACHE_KEY); // JWT expired: force refresh
            console.log('AssetPlusViewer: JWT expired, cleared stale cached token');
          }
        } catch {
          sessionStorage.removeItem(TOKEN_CACHE_KEY); // Bad cache: clear
        }
      }

      const cachedToken = sessionStorage.getItem(TOKEN_CACHE_KEY);
      if (cachedToken) {
        try {
          const { token } = JSON.parse(cachedToken);
          // Re-validate against JWT exp (not cached expiresAt which may be wrong)
          const jwtExpiry = getJwtExpiry(token);
          if (Date.now() < jwtExpiry) { // JWT still valid
            accessToken = token;
            console.log('AssetPlusViewer: Using cached token (saves ~500ms)');
          } else {
            sessionStorage.removeItem(TOKEN_CACHE_KEY); // Race condition: expired between checks
          }
        } catch { /* ignore bad cache */ }
      }
      
      if (!accessToken) {
        // Fetch Asset+ access token via edge function
        const { data: tokenData, error: tokenError } = await supabase.functions.invoke('asset-plus-query', {
          body: { action: 'getToken' }
        });

        if (tokenError) {
          throw new Error('Could not fetch access token');
        }

        accessToken = tokenData?.accessToken;
        
        if (!accessToken) {
          throw new Error('Asset+ access token is missing. Check your API settings.');
        }
        
        // Cache with actual JWT expiry (not hardcoded 55 min!)
        sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({
          token: accessToken,
          expiresAt: getJwtExpiry(accessToken),
        }));
        console.log('AssetPlusViewer: Fresh token fetched and cached with JWT expiry');
      }

      accessTokenRef.current = accessToken;
      console.log("AssetPlusViewer: Access token ready");

      setInitStep('check_script');
      // Load the Asset+ viewer script on-demand if not already loaded
      let assetplusviewer = (window as any).assetplusviewer;
      
      if (!assetplusviewer) {
        console.log('AssetPlusViewer: Loading UMD script on-demand...');
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/lib/assetplus/assetplusviewer.umd.min.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Asset+ 3D Viewer script'));
          document.body.appendChild(script);
        });
        assetplusviewer = (window as any).assetplusviewer;
        if (!assetplusviewer) {
          throw new Error('Asset+ 3D Viewer package failed to initialize after loading.');
        }
        console.log('AssetPlusViewer: UMD script loaded successfully');
      }

      setInitStep('fetch_config');
      let baseUrl = '';
      let apiKey = '';
      
      // Try sessionStorage cached config first
      const cachedConfig = sessionStorage.getItem(CONFIG_CACHE_KEY);
      if (cachedConfig) {
        try {
          const parsed = JSON.parse(cachedConfig);
          baseUrl = parsed.apiUrl || '';
          apiKey = parsed.apiKey || '';
          console.log('AssetPlusViewer: Using cached config (saves ~500ms)');
        } catch { /* ignore */ }
      }
      
      if (!baseUrl) {
        // Get API configuration
        const { data: configData } = await supabase.functions.invoke('asset-plus-query', {
          body: { action: 'getConfig' }
        });

        baseUrl = configData?.apiUrl || '';
        apiKey = configData?.apiKey || '';
        
        // Cache config (rarely changes)
        if (baseUrl) {
          sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ apiUrl: baseUrl, apiKey }));
        }
      }

      baseUrlRef.current = baseUrl;

      // Resolve model names and build A-model filter for initial loading
      try {
        const resolvedGuid = buildingFmGuid;
        if (resolvedGuid) {
          const { data: dbModels } = await supabase
            .from('xkt_models')
            .select('model_id, model_name, file_name')
            .eq('building_fm_guid', resolvedGuid);

          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
          let nameMap = new Map<string, string>();

          if (dbModels && dbModels.length > 0) {
            const hasRealNames = dbModels.some(m => m.model_name && !UUID_RE.test(m.model_name));

            if (hasRealNames) {
              dbModels.forEach(m => { if (m.model_name) nameMap.set(m.model_id, m.model_name); });
            }
            // If all names are GUIDs/generic, try Asset+ API for real names
          }

          // Fallback: if nameMap is empty, try to resolve via Asset+ API (GetAllRelatedModels)
          if (nameMap.size === 0 && dbModels && dbModels.length > 0) {
            try {
              const TOKEN_CACHE_KEY = 'geminus_ap_token';
              const cached = sessionStorage.getItem(TOKEN_CACHE_KEY);
              const token = cached ? JSON.parse(cached).token : null;
              const configRaw = sessionStorage.getItem('geminus_ap_config');
              const apiUrl = configRaw ? JSON.parse(configRaw).apiUrl : baseUrl;
              
              if (token && apiUrl) {
                const res = await fetch(`${apiUrl}/api/BimObject/GetAllRelatedModels/${resolvedGuid}`, {
                  headers: { 'Authorization': `Bearer ${token}` },
                });
                if (res.ok) {
                  const apiModels = await res.json();
                  // apiModels is array of { bimObjectId, name, ... }
                  if (Array.isArray(apiModels)) {
                    apiModels.forEach((am: any) => {
                      const matchingDb = dbModels.find(dm =>
                        dm.model_id === am.bimObjectId ||
                        dm.model_id.toLowerCase() === am.bimObjectId?.toLowerCase()
                      );
                      if (matchingDb && am.name) {
                        nameMap.set(matchingDb.model_id, am.name);
                      }
                    });
                    console.log(`XKT filter: API fallback resolved ${nameMap.size} model name(s)`);
                  }
                }
              }
            } catch (e) {
              console.debug('XKT filter: API fallback failed:', e);
            }
          }

          // If nameMap is still empty, skip filtering — load all models

          // Build A-model filter — only allow models whose name starts with 'A'
          if (nameMap.size > 0) {
            const aModelIdsOriginal = new Set<string>();
            const aModelIds = new Set<string>();
            
            // Also build a file_name → model_id lookup from DB
            const dbModelLookup = new Map<string, string>();
            dbModels?.forEach(m => {
              if (m.file_name) {
                dbModelLookup.set(m.file_name, m.model_id);
                dbModelLookup.set(m.file_name.toLowerCase(), m.model_id);
              }
            });

            nameMap.forEach((name, id) => {
              if (name.toLowerCase().startsWith('a')) {
                aModelIdsOriginal.add(id);
                // Add all possible key variants the SDK might use
                aModelIds.add(id);
                aModelIds.add(id.toLowerCase());
                // Find the file_name for this model_id and add variants
                const dbModel = dbModels?.find(m => m.model_id === id);
                if (dbModel?.file_name) {
                  aModelIds.add(dbModel.file_name);                          // e.g. "uuid.xkt"
                  aModelIds.add(dbModel.file_name.toLowerCase());
                  aModelIds.add(dbModel.file_name.replace(/\.xkt$/i, ''));    // strip .xkt
                  aModelIds.add(dbModel.file_name.replace(/\.xkt$/i, '').toLowerCase());
                }
              }
            });

            const totalUniqueModels = new Set([...nameMap.keys()].map(k => k.toLowerCase())).size;
            if (aModelIdsOriginal.size > 0 && aModelIdsOriginal.size < totalUniqueModels) {
              allowedModelIdsRef.current = aModelIds;
              console.log(`XKT filter: Initial load restricted to ${aModelIdsOriginal.size} A-model(s) out of ${totalUniqueModels}. Whitelist keys: ${aModelIds.size}`);
            }
          } else {
            console.debug('XKT filter: No model names resolved — loading all models');
          }
        }
      } catch (e) {
        console.debug('Model filter setup failed — loading all models:', e);
        allowedModelIdsRef.current = null;
      }

      // Save a reference to the real fetch before interceptor patches it
      const original_fetch_ref = window.fetch;

      console.log("AssetPlusViewer: Init - Calling assetplusviewer with baseUrl:", baseUrl);

      setInitStep('mount_viewer');
      // Initialize the viewer following EXACT Asset+ external_viewer.html pattern
      const viewer = await assetplusviewer(
        baseUrl,  // URL to the API Backend
        apiKey,   // API Key in UUID format
        // getAccessTokenCallback — always returns a valid (non-expired) token
        async () => {
          console.log("getAccessTokenCallback");
          const TOKEN_CACHE_KEY = 'geminus_ap_token';
          // Validate cached token against JWT exp directly (not cached expiresAt)
          const raw = sessionStorage.getItem(TOKEN_CACHE_KEY);
          if (raw) {
            try {
              const { token } = JSON.parse(raw);
              const jwtExpiry = (t: string) => {
                try { return (JSON.parse(atob(t.split('.')[1])).exp * 1000) - 30_000; }
                catch { return 0; }
              };
              if (Date.now() < jwtExpiry(token)) {
                accessTokenRef.current = token;
                return token;
              }
            } catch { /* fall through to refresh */ }
          }
          // Token expired or missing — fetch fresh
          console.log("getAccessTokenCallback: JWT expired, fetching fresh token");
          try {
            const { data } = await supabase.functions.invoke('asset-plus-query', {
              body: { action: 'getToken' }
            });
            const freshToken = data?.accessToken;
            if (freshToken) {
              accessTokenRef.current = freshToken;
              const jwtExp = (t: string) => {
                try { return (JSON.parse(atob(t.split('.')[1])).exp * 1000) - 30_000; }
                catch { return Date.now() + 4 * 60 * 1000; }
              };
              sessionStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({
                token: freshToken,
                expiresAt: jwtExp(freshToken),
              }));
              return freshToken;
            }
          } catch (e) {
            console.error("getAccessTokenCallback: Failed to refresh token", e);
          }
          return accessTokenRef.current;
        },
        // selectionChangedCallback - flash highlight on selection (if enabled)
        (items: any[], added: any[], removed: any[]) => {
          console.log("selectionChangedCallback -", items?.length, "items.", added?.length, "added.", removed?.length, "removed.");
          
          // Flash highlight newly selected items only if enabled
          if (added?.length > 0 && flashOnSelectEnabledRef.current) {
            const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
            if (xeokitViewer?.scene) {
              // Log the item structure for debugging
              console.log("itemIds", added.map((item: any) => item?.id || item));
              
              // Flash each newly added item
              added.forEach((item: any) => {
                // The item can be an object with .id or just a string ID
                const entityId = typeof item === 'string' ? item : item?.id;
                if (entityId) {
                  // Flash the entity - using xeokit pattern from docs
                  flashEntityById(xeokitViewer.scene, entityId, {
                    color1: [1, 0.3, 0.3],  // Highlight red
                    color2: [1, 1, 1],       // White/original
                    interval: 200,          // Flash faster for better visibility
                    duration: 2000,         // 2 seconds
                  });
                }
              });
            }
          }
        },
        // selectedFmGuidsChangedCallback - Track selection for properties dialog
        (items: string[], added: string[], removed: string[]) => {
          if (!isMountedRef.current) return; // Guard against state updates during unmount
          console.log("selectedFmGuidsChangedCallback -", items?.length, "items.", added?.length, "added.", removed?.length, "removed.");
          setSelectedFmGuids(items || []);
        },
        // allModelsLoadedCallback - call via ref for stable identity
        () => handleAllModelsLoadedRef.current(),
        // isItemIdEditableCallback (for BimObjectId instead of FmGuid)
        undefined,
        // isFmGuidEditableCallback
        async (fmGuidParam: string) => {
          console.log("isFmGuidEditableCallback - fmGuid:", fmGuidParam);
          return false; // Read-only for now
        },
        // additionalDefaultPredicate - filter to only load allowed models (A-model whitelist)
        (modelId: string) => {
          if (!allowedModelIdsRef.current) return true; // no filter → load all
          const whitelist = allowedModelIdsRef.current;
          const lower = modelId.toLowerCase();
          const stripped = lower.replace(/\.xkt$/i, '');
          const accepted = whitelist.has(modelId) || whitelist.has(lower) || whitelist.has(stripped);
          // Diagnostic logging for first few calls
          if (!(window as any).__xktPredicateLogCount) (window as any).__xktPredicateLogCount = 0;
          if ((window as any).__xktPredicateLogCount < 8) {
            console.log(`[XKT predicate] modelId="${modelId}" → ${accepted ? 'ACCEPT' : 'REJECT'}`);
            (window as any).__xktPredicateLogCount++;
          }
          return accepted;
        },
        // externalCustomObjectContextMenuItems — empty array disables Asset+ built-in menu
        [],
        // horizontalAngle (use default)
        undefined,
        // verticalAngle (use default)
        undefined,
      );

      console.log("AssetPlusViewer: Viewer mounted successfully");
      viewerInstanceRef.current = viewer;
      // Expose instance globally for Virtual Twin mode
      (window as any).__assetPlusViewerInstance = viewer;

      // Apply x-ray material changes
      changeXrayMaterialRef.current();

      // Disable alpha depth mask so colored (solid) objects render in front of xrayed objects
      // See: https://github.com/xeokit/xeokit-bim-viewer/issues/175
      const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (xeokitViewer) {
        xeokitViewer.scene.alphaDepthMask = false;
        // Diagnose available xeokit APIs for SectionPlane clipping
        import('@/hooks/useSectionPlaneClipping').then(mod => {
          mod.diagnoseXeokitScene(xeokitViewer);
        }).catch(() => {});
      }

      // Mark viewer ready for direct calls
      deferCallsRef.current = false;
      processDeferredRef.current();

      // Determine what to focus on
      const focusFmGuid = initialFmGuidToFocus || fmGuid;
      const focusData = allDataRef.current.find((a: any) => a.fmGuid === focusFmGuid);
      
      let displayAction: any = undefined;
      
      // For Floors/BuildingStoreys: do a cutout-floor action
      if (focusData?.category === 'Floor' || focusData?.category === 'IfcBuildingStorey') {
        displayAction = { 
          action: 'cutoutfloor', 
          parameter: { fmGuid: focusFmGuid, includeRelatedFloors: true } 
        };
      } else if (focusData?.category === 'Space' || focusData?.category === 'IfcSpace') {
        // Space: use the parent floor's fmGuid (levelFmGuid) for cutout, then look at the space
        const floorFmGuid = focusData.levelFmGuid || focusFmGuid;
        displayAction = { 
          action: 'cutoutfloor_and_lookatspace', 
          parameter: { 
            fmGuid: focusFmGuid,  // Space fmGuid for lookAt
            floorFmGuid: floorFmGuid, // Parent floor for cutout
            includeRelatedFloors: true, 
            heightAboveAABB: defaultHeightAboveAABB 
          } 
        };
      }
      
      displayFmGuidRef.current(focusFmGuid, displayAction);

      // Dispatch floor selection event so FloorVisibilitySelector and RoomVisualizationPanel sync
      if (focusData && initialFmGuidToFocus && initialFmGuidToFocus !== fmGuid) {
        const floorFmGuid = 
          (focusData.category === 'Floor' || focusData.category === 'IfcBuildingStorey' || focusData.category === 'Building Storey')
            ? focusFmGuid
            : focusData.levelFmGuid;
        
        if (floorFmGuid) {
          // Delay to allow viewer to finish loading models
          setTimeout(() => {
            console.log('AssetPlusViewer: Dispatching initial floor selection for', floorFmGuid);
            emit('FLOOR_SELECTION_CHANGED', {
                floorId: floorFmGuid,
                visibleMetaFloorIds: [],
                visibleFloorFmGuids: [floorFmGuid],
                isAllFloorsVisible: false,
                isSoloFloor: true,
                soloFloorName: focusData.commonName || focusData.name || '',
              });
          }, 1500);
        }
      }

      // Clear any pending error display on successful init
      if (showErrorTimeoutRef.current) {
        clearTimeout(showErrorTimeoutRef.current);
        showErrorTimeoutRef.current = null;
      }
      setShowError(false);
      clearTimeout(timeoutId); // Cancel the initialization timeout on success

      const initDuration = ((performance.now() - initStartTime) / 1000).toFixed(1);
      console.log(`[AssetPlusViewer] ⏱ Initialization completed in ${initDuration}s`);

      // Safety fallback: if allModelsLoadedCallback never fires (e.g. model parse error),
      // force the toolbar to become available after a timeout so the UI doesn't freeze.
      const MODEL_LOAD_FALLBACK_MS = isMobile ? 15_000 : 20_000;
      const modelFallbackId = setTimeout(() => {
        if (!isMountedRef.current) return;
        setModelLoadState(prev => {
          if (prev !== 'loaded') {
            console.warn('[AssetPlusViewer] Model load fallback triggered — forcing toolbar ready');
            setInitStep('ready');
            setXktSyncStatus('done');
            return 'loaded';
          }
          return prev;
        });
      }, MODEL_LOAD_FALLBACK_MS);

      // Store fallback timer so cleanup can cancel it
      (viewerInstanceRef.current as any).__modelFallbackTimer = modelFallbackId;

      setState(prev => ({
        ...prev,
        isLoading: false,
        isInitialized: true,
        error: null, // Ensure error is cleared on success
        modelInfo: {
          name: assetDataRef.current?.commonName || assetDataRef.current?.name || 'Unknown model',
          type: 'IFC/XKT',
          lastUpdated: assetDataRef.current?.sourceUpdatedAt || new Date().toISOString().split('T')[0],
        },
      }));

    } catch (error) {
      clearTimeout(timeoutId); // Cancel the initialization timeout on error (we already handle it)
      console.error('Failed to initialize 3D viewer:', error);
      setInitStep('error');
      
      // Set error state but delay showing the error UI to suppress brief flashes
      // during React Strict Mode double-mount cycles
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Could not load 3D viewer',
      }));
      
      // Only show error after a delay - if initialization succeeds by then, error clears
      if (showErrorTimeoutRef.current) {
        clearTimeout(showErrorTimeoutRef.current);
      }
      showErrorTimeoutRef.current = setTimeout(() => {
        setShowError(true);
      }, 800); // 800ms delay to allow retry to succeed
    }
  }, [fmGuid, initialFmGuidToFocus, isMobile]);

  const handleRetry = useCallback(() => {
    // If we're already initializing, ignore retry clicks.
    if (initializingRef.current) {
      console.debug('AssetPlusViewer: Retry ignored (initialization in progress)');
      return;
    }

    // Clear error display state and timeout
    setShowError(false);
    if (showErrorTimeoutRef.current) {
      clearTimeout(showErrorTimeoutRef.current);
      showErrorTimeoutRef.current = null;
    }

    // Clear the error FIRST so the viewer container is rendered back into the DOM,
    // then trigger initialization on the next frames.
    setState(prev => ({
      ...prev,
      error: null,
      isLoading: true,
      isInitialized: false,
    }));
    setInitStep('wait_dom');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initializeViewer();
      });
    });
  }, [initializeViewer]);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = React.useRef(true);
  
  // Initialize on mount with race condition protection
  useEffect(() => {
    isMountedRef.current = true;
    
    // Prevent concurrent initializations
    if (initializingRef.current) {
      console.debug('AssetPlusViewer: Skipping duplicate initialization (already in progress)');
      return;
    }
    
    // Use a small delay to let React Strict Mode complete its mount/unmount cycle
    const initTimeout = setTimeout(() => {
      if (isMountedRef.current && !initializingRef.current) {
        initializingRef.current = true;
        initializeViewer().finally(() => {
          initializingRef.current = false;
        });
      }
    }, 50);

    return () => {
      clearTimeout(initTimeout);
      isMountedRef.current = false;
      initializingRef.current = false; // CRITICAL: Reset so re-mount can re-initialize
      
      // Clear any pending error display timeout
      if (showErrorTimeoutRef.current) {
        clearTimeout(showErrorTimeoutRef.current);
        showErrorTimeoutRef.current = null;
      }

      // Cancel model load fallback timer
      const fallbackTimer = (viewerInstanceRef.current as any)?.__modelFallbackTimer;
      if (fallbackTimer) clearTimeout(fallbackTimer);

      // Restore original fetch on unmount
      restoreFetch();
      
      // Cleanup viewer on unmount - guard against null/incomplete viewer
      // The 'e.nextSibling' error occurs when Asset+ tries to manipulate DOM
      // elements that were removed before cleanup completed.
      // IMPORTANT: Capture ref and nullify BEFORE deferred cleanup to prevent
      // the UMD bundle's internal React from triggering renders on unmounted DOM
      // (which causes React #31 "Objects are not valid as a React child").
      const viewer = viewerInstanceRef.current;
      const issueChannel = viewer?._issueAnnotationsChannel;
      viewerInstanceRef.current = null;
      
      if (viewer) {
        // Synchronously detach the Vue app from the DOM container before React removes it.
        // This prevents the UMD bundle's internal framework from reacting to DOM mutations.
        try {
          const container = document.getElementById('AssetPlusViewer');
          if (container) {
            container.innerHTML = '';
          }
        } catch (e) {
          console.debug('Viewer DOM cleanup:', e);
        }
        
        // Deferred data cleanup — safe because we already detached from DOM
        setTimeout(() => {
          try {
            if (typeof viewer.clearData === 'function') {
              viewer.clearData();
            }
          } catch (e) {
            console.debug('Viewer cleanup (expected during teardown):', e);
          }
        }, 0);
      }
      
      // Cleanup issue annotations realtime channel
      if (issueChannel) {
        supabase.removeChannel(issueChannel);
      }
      
      // viewerInstanceRef already nullified above
      deferCallsRef.current = true;
    };
  }, [initializeViewer, restoreFetch]);

  // WebGL context lost/restored recovery
  // Mobile GPUs may run out of memory when loading large BIM models, causing the
  // WebGL context to be lost. This handler prevents a blank canvas crash and offers recovery.
  useEffect(() => {
    if (!state.isInitialized) return;

    // Find the canvas inside our viewer container
    const canvas = viewerContainerRef.current?.querySelector('canvas');
    if (!canvas) return;

    const handleContextLost = (e: Event) => {
      e.preventDefault(); // Allow context restoration
      console.error('[AssetPlusViewer] WebGL context lost – GPU out of memory or tab backgrounded');
      setState(prev => ({
        ...prev,
        error: 'WebGL-kontext förlorad. Enheten kan ha slut på grafikminne.',
        isLoading: false,
      }));
      setShowError(true);
    };

    const handleContextRestored = () => {
      console.log('[AssetPlusViewer] WebGL context restored');
      // Clear the error and retry initialization
      setState(prev => ({ ...prev, error: null }));
      setShowError(false);
    };

    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
    };
  }, [state.isInitialized]);

  // On-demand model loading: when a user toggles a deferred (non-A) model in ModelVisibilitySelector,
  // add it to the whitelist and re-trigger the Asset+ model load so the interceptor allows it through.
  useEffect(() => {
    const handleModelLoadRequested = (detail: ModelLoadRequestedDetail) => {
      const { modelId } = detail;
      if (!modelId) return;

      console.log(`[AssetPlusViewer] On-demand model load requested: ${modelId}`);

      // Add to whitelist so the cache interceptor allows it
      if (allowedModelIdsRef.current) {
        allowedModelIdsRef.current.add(modelId);
        allowedModelIdsRef.current.add(modelId.toLowerCase());
      }

      // Re-trigger model load via Asset+ viewer API
      const viewer = viewerInstanceRef.current;
      const resolvedGuid = buildingFmGuid;
      if (viewer && resolvedGuid) {
        // setAvailableModelsByFmGuid re-evaluates which models to load;
        // now the interceptor will allow the newly-whitelisted model through
        viewer.setAvailableModelsByFmGuid(resolvedGuid);
      }
    };

    const offHandleModelLoadRequested = on('MODEL_LOAD_REQUESTED', handleModelLoadRequested);
    return () => {
      offHandleModelLoadRequested();
    };
  }, [buildingFmGuid]);

  // Viewer uses built-in Asset+ controls - no custom handlers needed

  // Show error state - only show after the delay to prevent flashing during initialization
  if (state.error && showError) {
    return (
      <div className="h-full flex flex-col p-2 sm:p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg sm:text-xl font-semibold truncate">3D Viewer</h2>
            <p className="text-sm text-muted-foreground truncate">
              {assetData?.commonName || assetData?.name || fmGuid.substring(0, 16) + '...'}
            </p>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="flex-shrink-0 ml-2">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Error display */}
        <Card className="flex-1">
          <CardContent className="h-full flex items-center justify-center p-6">
            <div className="text-center space-y-4 max-w-md">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 mx-auto">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div>
                <p className="text-lg font-medium">Could not load 3D viewer</p>
                <p className="text-sm text-muted-foreground mt-2">{state.error}</p>
              </div>
              <Button onClick={handleRetry} variant="outline">
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main viewer - fullscreen layout without sidebar
  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 bg-background" : "h-full flex flex-col"}>
      {/* Viewer area with dx-viewport wrapper (CRITICAL for Asset+ popups) */}
      <div className={isFullscreen ? "h-full" : "flex-1 min-h-0"}>
        {/* dx-viewport wrapper - required by Asset+ for ObjectDetails popup constraint */}
        <div 
          ref={viewportWrapperRef}
          className="dx-viewport relative w-full h-full"
          style={{ margin: 0, display: 'flex', flexDirection: 'column' }}
        >
          {/* AssetPlusViewer container - no id here; freshDiv inside gets id="AssetPlusViewer" */}
          <div 
            ref={viewerContainerRef}
            className="w-full h-full"
            onContextMenu={handleContextMenu}
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 auto',
              height: '100%',
              minHeight: 0,
              position: 'relative',
              background: transparentBackground
                ? 'transparent'
                : 'radial-gradient(90% 100% at center top, rgb(236, 236, 236), rgb(42, 42, 50))',
              touchAction: 'none',
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              userSelect: 'none',
              pointerEvents: transparentBackground ? 'none' : undefined,
            } as React.CSSProperties}
          />

          {/* Loading overlay: initial load OR active XKT sync only (not 'checking') */}
          {((state.isLoading && !state.isInitialized) || (modelLoadState !== 'loaded' && xktSyncStatus === 'syncing' && state.isInitialized)) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-background/30">
              <Spinner 
                size="xl" 
                label={xktSyncStatus === 'syncing' ? 'Syncing 3D models...' : undefined} 
              />
            </div>
          )}
          
          {/* Mobile UI Overlay - shown on mobile devices (hidden when suppressOverlay) */}
          {isMobile && state.isInitialized && !suppressOverlay && (
            <MobileViewerOverlay
              onClose={onClose}
              viewerInstanceRef={viewerInstanceRef}
              buildingFmGuid={buildingFmGuid}
              isViewerReady={modelLoadState === 'loaded' && initStep === 'ready'}
              onOpenSettings={() => setRightPanelOpen(true)}
              showFilterPanel={showFilterPanel}
              onToggleFilterPanel={() => setShowFilterPanel(!showFilterPanel)}
              viewMode={mobileViewMode}
              onChangeViewMode={onMobileChangeViewMode}
              hasIvion={mobileHasIvion}
            />
          )}
          
          {/* Desktop UI - Top toolbar - hidden on mobile and when suppressOverlay */}
          {!isMobile && !suppressOverlay && (
            <div className="absolute top-2 left-2 right-2 z-30 flex items-center justify-between pointer-events-none">
              {/* Close and fullscreen buttons - left side */}
              <div className="flex gap-1.5 pointer-events-auto">
                {onClose && (
                  <Button 
                    variant="secondary" 
                    size="icon"
                    onClick={onClose} 
                    className="h-8 w-8 sm:h-10 sm:w-10 shadow-lg bg-card/95 backdrop-blur-sm border"
                    aria-label="Close 3D view"
                  >
                    <X className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                )}
                <Button 
                  variant="secondary" 
                  size="icon"
                  onClick={() => setIsFullscreen(!isFullscreen)} 
                  className="h-8 w-8 sm:h-10 sm:w-10 shadow-lg bg-card/95 backdrop-blur-sm border"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4 sm:h-5 sm:w-5" /> : <Maximize2 className="h-4 w-4 sm:h-5 sm:w-5" />}
                </Button>
                <Button 
                  variant={showFilterPanel ? "default" : "secondary"}
                  size="icon"
                  onClick={() => setShowFilterPanel(!showFilterPanel)} 
                  className="h-8 w-8 sm:h-10 sm:w-10 shadow-lg bg-card/95 backdrop-blur-sm border"
                  aria-label="Filter panel"
                  title="Filter"
                >
                  <Filter className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              </div>
            
            {/* Right side: Hamburger menu for right panel */}
            <div className="flex gap-1.5 pointer-events-auto">
              {state.isInitialized && (
                <Button
                  variant={rightPanelOpen ? "default" : "secondary"}
                  size="icon"
                  onClick={() => setRightPanelOpen(!rightPanelOpen)}
                  className="h-8 w-8 sm:h-10 sm:w-10 shadow-lg bg-card/95 backdrop-blur-sm border"
                  aria-label="Settings"
                  title="Settings"
                >
                  <Menu className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              )}
            </div>
            </div>
          )}

          {/* NavCube canvas - positioned in bottom-right corner, responsive size — hidden in compactMode */}
          <canvas 
            id="navCubeCanvas" 
            width={typeof window !== 'undefined' && window.innerWidth < 640 ? 60 : 80}
            height={typeof window !== 'undefined' && window.innerWidth < 640 ? 60 : 80}
            className="absolute right-3 z-[25]"
            style={{
              bottom: isMobile
                ? 'calc(env(safe-area-inset-bottom, 12px) + 80px)'
                : 'calc(env(safe-area-inset-bottom, 12px) + 74px)',
              width: typeof window !== 'undefined' && window.innerWidth < 640 ? '60px' : '80px',
              height: typeof window !== 'undefined' && window.innerWidth < 640 ? '60px' : '80px',
              display: showNavCube && !isMobile && !compactMode ? 'block' : 'none',
              background: 'rgba(20, 20, 20, 0.5)',
              borderRadius: '6px',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          />

          {/* Pick mode indicator overlay */}
          {isPickMode && !pendingPickCoords && (
            <div className="absolute inset-0 pointer-events-none z-10 border-4 border-dashed border-accent/50 animate-pulse">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card/90 backdrop-blur-sm px-4 py-2 rounded-lg shadow-lg">
                 <p className="text-sm font-medium text-center">
                  🎯 Click on a surface to select position
                </p>
              </div>
            </div>
          )}
          
          {/* Two-step confirmation overlay for position picking */}
          {pendingPickCoords && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 bg-card/95 backdrop-blur-md p-4 rounded-xl shadow-2xl border flex flex-col gap-3 min-w-[280px]">
              <div className="text-center">
                <p className="font-medium text-sm mb-1">📍 Position marked</p>
                <p className="text-xs text-muted-foreground font-mono">
                  X: {pendingPickCoords.x.toFixed(2)} Y: {pendingPickCoords.y.toFixed(2)} Z: {pendingPickCoords.z.toFixed(2)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={handleRepickPosition}
                  className="flex-1"
                >
                  Re-pick
                </Button>
                <Button 
                  onClick={handleConfirmPosition}
                  className="flex-1"
                >
                  Confirm ✓
                </Button>
              </div>
            </div>
          )}

          {/* Custom toolbar - centered at bottom */}
          {state.isInitialized && initStep === 'ready' && !compactMode && (
            <>
              {/* Floating Floor Switcher - always visible pills */}
              <FloatingFloorSwitcher
                viewerRef={viewerInstanceRef}
                buildingFmGuid={buildingFmGuid}
                isViewerReady={true}
                compact={isMobile}
                className={isMobile
                  ? "!fixed !left-auto !top-auto !bottom-16 !right-2 !flex-row !h-auto !w-auto !z-50"
                  : "absolute bottom-20 left-4 z-20 pointer-events-auto"
                }
              />

              {/* Visualization Legend Bar - independent of right panel */}
              <VisualizationLegendBarOverlay />

              {/* Quick visualization type selector */}
              {!compactMode && (
                <div
                  className="absolute z-[45] pointer-events-auto bottom-14 left-1/2 -translate-x-1/2"
                >
                  <VisualizationQuickBar />
                </div>
              )}
              
              <ViewerToolbar 
                viewer={viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer}
                className="pointer-events-auto"
              />
              
              
              {/* Tandem-style Filter Panel - fixed left sidebar */}
              {showFilterPanel && (
                <div className="pointer-events-auto">
                  <ViewerFilterPanel
                    viewerRef={viewerInstanceRef}
                    buildingFmGuid={buildingFmGuid}
                    isVisible={showFilterPanel}
                    onClose={() => setShowFilterPanel(false)}
                    onNodeSelect={(fmGuid) => {
                      const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
                      if (xeokitViewer?.scene) {
                        flashEntityById(xeokitViewer.scene, fmGuid, {
                          color1: [0.3, 1, 0.3],
                          color2: [1, 1, 1],
                          interval: 200,
                          duration: 2000,
                        });
                      }
                    }}
                  />
                </div>
              )}

              <div className="pointer-events-auto">
                <MinimapPanel
                  viewerRef={viewerInstanceRef}
                  isVisible={showMinimap}
                  onClose={() => setShowMinimap(false)}
                  onRoomClick={(roomFmGuid) => {
                    const roomData = allData.find((a: any) => a.fmGuid === roomFmGuid);
                    const floorFmGuid = roomData?.levelFmGuid || roomFmGuid;
                    const displayAction = { 
                      action: 'cutoutfloor_and_lookatspace', 
                      parameter: { 
                        fmGuid: roomFmGuid,
                        floorFmGuid,
                        includeRelatedFloors: true, 
                        heightAboveAABB: defaultHeightAboveAABB 
                      } 
                    };
                    executeDisplayAction(displayAction);
                    viewerInstanceRef.current?.selectFmGuid(roomFmGuid);
                  }}
                />
              </div>
              {!isMobile && (
                <div className="pointer-events-auto">
                  <FloorCarousel
                    viewerRef={viewerInstanceRef}
                    onFloorSelect={handleFloorSelect}
                    selectedFloorId={selectedFloorId || undefined}
                  />
                </div>
              )}
              
              {/* Right Side Panel (Sheet) - replaces floating VisualizationToolbar + RoomVisualizationPanel */}
              <div className="pointer-events-auto">
                <ViewerRightPanel
                  isOpen={rightPanelOpen}
                  onOpenChange={setRightPanelOpen}
                  viewerRef={viewerInstanceRef}
                  buildingFmGuid={buildingFmGuid}
                  buildingName={assetData?.commonName || assetData?.name}
                  isViewerReady={modelLoadState === 'loaded' && initStep === 'ready'}
                  showSpaces={showSpaces}
                  onShowSpacesChange={handleShowSpacesChange}
                  visibleFloorFmGuids={visibleFloorFmGuids}
                  onVisibleFloorsChange={handleVisibleFloorsChange}
                  visibleModelIds={[]}
                  visibleFloorIds={visibleFloorFmGuids}
                  onToggleTreeView={(visible) => setShowTreePanel(visible)}
                  showTreeView={showTreePanel}
                  onAddAsset={handleOpenInventorySheet}
                  initialFloorFmGuid={initialFmGuidToFocus}
                  showAnnotations={showAnnotations}
                  onShowAnnotationsChange={handleAnnotationsChange}
                />
              </div>
            </>
          )}

          {/* Properties Dialog - floating, dockable, supports both view/edit and create modes */}
          <div className="pointer-events-auto">
            <AssetPropertiesDialog
              isOpen={propertiesDialogOpen || addAssetDialogOpen}
              onClose={() => {
                setPropertiesDialogOpen(false);
                setAddAssetDialogOpen(false);
                setPickedCoordinates(null);
              }}
              selectedFmGuids={addAssetDialogOpen ? [] : selectedFmGuids}
              onUpdate={handleAssetCreated}
              createMode={addAssetDialogOpen}
              parentSpaceFmGuid={addAssetParentNode?.fmGuid || null}
              buildingFmGuid={buildingFmGuid || null}
              levelFmGuid={assetData?.levelFmGuid || null}
              initialCoordinates={pickedCoordinates}
              onPickCoordinates={handleTogglePickMode}
              isPickingCoordinates={isPickMode}
              viewerRef={viewerInstanceRef}
            />
          </div>
          
          {/* Inventory Form Sheet - opens from "Registrera tillgång" menu item */}
          <div className="pointer-events-auto">
            <InventoryFormSheet
              isOpen={inventorySheetOpen}
              onClose={() => {
                setInventorySheetOpen(false);
                setInventoryPendingPosition(null);
              }}
              buildingFmGuid={buildingFmGuid || ''}
              levelFmGuid={assetData?.levelFmGuid}
              roomFmGuid={assetData?.inRoomFmGuid || (assetData?.category === 'Space' ? assetData?.fmGuid : null)}
              pendingPosition={inventoryPendingPosition}
              onPickPositionRequest={handleInventoryPickRequest}
              isPickingPosition={isPickMode && inventoryPickModeRef.current}
              onPendingPositionConsumed={() => setInventoryPendingPosition(null)}
            />
          </div>

          {/* Custom right-click context menu */}
          {contextMenu && (
            <ViewerContextMenu
              position={contextMenu.position}
              entityId={contextMenu.entityId}
              entityName={contextMenu.entityName}
              onClose={() => setContextMenu(null)}
              onShowLabels={() => {
                emit('TOGGLE_ANNOTATIONS', { show: true });
              }}
              onCreateIssue={() => {}}
              onViewIssues={() => {}}
              onShowRoomLabels={() => {
                emit('ROOM_LABELS_TOGGLE', { enabled: true });
              }}
            />
          )}

          {/* Work Order Dialog */}
          <CreateWorkOrderDialog
            open={workOrderDialogOpen}
            onClose={() => setWorkOrderDialogOpen(false)}
            buildingName={assetData?.commonName || assetData?.name}
            buildingFmGuid={buildingFmGuid}
            objectName={workOrderContext.objectName}
            objectFmGuid={workOrderContext.objectFmGuid}
          />
          
        </div>
      </div>
    </div>
  );
};

export default AssetPlusViewer;
