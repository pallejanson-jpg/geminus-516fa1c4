import React, { useEffect, useRef, useState, useCallback, useContext, useMemo } from 'react';
import { AlertCircle, X, Maximize2, Minimize2, TreeDeciduous, Menu } from 'lucide-react';
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
// AnnotationToggleMenu removed - consolidated into VisualizationToolbar flyout
import AssetPropertiesDialog from './AssetPropertiesDialog';
import ToolbarSettings from './ToolbarSettings';
import ViewerTreePanel from './ViewerTreePanel';
import ViewerRightPanel from './ViewerRightPanel';
import InventoryFormSheet from '@/components/inventory/InventoryFormSheet';
import MobileViewerOverlay, { MobileFloorInfo } from './mobile/MobileViewerOverlay';
import { xktCacheService } from '@/services/xkt-cache-service';
import { isModelInMemory, getModelFromMemory, storeModelInMemory, getMemoryStats } from '@/hooks/useXktPreload';
import { useFlashHighlight } from '@/hooks/useFlashHighlight';
import { usePerformancePlugins } from '@/hooks/usePerformancePlugins';
import { useIsMobile } from '@/hooks/use-mobile';
import type { VisualizationType } from '@/lib/visualization-utils';
import { NavigatorNode } from '@/components/navigator/TreeNode';
import { LOAD_SAVED_VIEW_EVENT, LoadSavedViewDetail, VIEW_MODE_REQUESTED_EVENT, VIEWER_CONTEXT_CHANGED_EVENT, ViewerContextChangedDetail } from '@/lib/viewer-events';
import { CLIP_HEIGHT_CHANGED_EVENT, VIEW_MODE_CHANGED_EVENT, FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { useArchitectViewMode, ARCHITECT_MODE_REQUESTED_EVENT, ARCHITECT_MODE_CHANGED_EVENT, ARCHITECT_BACKGROUND_CHANGED_EVENT, type BackgroundPresetId } from '@/hooks/useArchitectViewMode';
import { useRoomLabels, ROOM_LABELS_TOGGLE_EVENT, type RoomLabelsToggleDetail } from '@/hooks/useRoomLabels';
import { useViewerCameraSync } from '@/hooks/useViewerCameraSync';
import { useModelNames } from '@/hooks/useModelNames';
import type { LocalCoords } from '@/context/ViewerSyncContext';
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
  const loadAlarmAnnotationsRef = useRef<(() => Promise<void>) | null>(null);
  const assetDataRef = useRef<any>(null);
  const allDataRef = useRef<any[]>(allData);

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
  const [toolbarSettingsOpen, setToolbarSettingsOpen] = useState(false);
  const [showTreePanel, setShowTreePanel] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [visibleFloorFmGuids, setVisibleFloorFmGuids] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  
  // Mobile floors state for visibility control
  const [mobileFloors, setMobileFloors] = useState<MobileFloorInfo[]>([]);
  
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

  // Performance plugins (FastNav, ViewCull, LOD)
  usePerformancePlugins({
    viewerRef: viewerInstanceRef,
    ready: modelLoadState === 'loaded' && initStep === 'ready',
    isMobile: !!isMobile,
  });

  // Auto-activate room visualization when initialVisualization is set
  const initialVisAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialVisualization || initialVisualization === 'none') return;
    if (modelLoadState !== 'loaded' || initStep !== 'ready') return;
    if (initialVisAppliedRef.current) return;
    initialVisAppliedRef.current = true;

    // Dispatch event to activate room visualization via RoomVisualizationPanel
    console.log('[AssetPlusViewer] Auto-activating visualization:', initialVisualization);
    window.dispatchEvent(new CustomEvent('INITIAL_VISUALIZATION_REQUESTED', {
      detail: { type: initialVisualization },
    }));
  }, [initialVisualization, modelLoadState, initStep]);

  // ─── Insights color mode: apply X-Ray + colorization from sessionStorage ───
  const insightsAppliedRef = useRef(false);
  useEffect(() => {
    if (!insightsColorMode) return;
    if (modelLoadState !== 'loaded' || initStep !== 'ready') return;
    if (insightsAppliedRef.current) return;
    insightsAppliedRef.current = true;

    const raw = sessionStorage.getItem('insights_color_map');
    if (!raw) {
      console.warn('[AssetPlusViewer] insightsColorMode set but no color map in sessionStorage');
      return;
    }

    let parsed: { mode: string; colorMap: Record<string, [number, number, number]> };
    try { parsed = JSON.parse(raw); } catch { return; }
    sessionStorage.removeItem('insights_color_map');

    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) return;

    const scene = xeokitViewer.scene;
    const metaObjects = xeokitViewer.metaScene?.metaObjects || {};
    const colorMap = parsed.colorMap;

    console.log('[AssetPlusViewer] Applying insights color mode:', parsed.mode, 'keys:', Object.keys(colorMap).length);

    // Step 1: Set ALL objects to X-Ray
    const allIds = scene.objectIds || [];
    scene.setObjectsXRayed(allIds, true);
    scene.setObjectsVisible(allIds, true);

    if (parsed.mode === 'energy_floors' || parsed.mode === 'energy_floor') {
      // colorMap keys are floor fmGuids
      // Find IfcSpace entities under each storey and colorize them
      Object.entries(colorMap).forEach(([floorGuid, rgb]) => {
        const guidLower = floorGuid.toLowerCase();
        const spaceIds = spacesByFloorCacheRef.current.get(guidLower) || [];
        
        if (spaceIds.length === 0) {
          // Try to find by iterating metaObjects
          Object.values(metaObjects).forEach((mo: any) => {
            if (mo.type?.toLowerCase() !== 'ifcbuildingstorey') return;
            const moGuid = (mo.originalSystemId || mo.id || '').toLowerCase();
            if (moGuid !== guidLower) return;
            // Find all IfcSpace children
            const findSpaces = (parent: any) => {
              if (!parent.children) return;
              parent.children.forEach((child: any) => {
                if (child.type?.toLowerCase() === 'ifcspace') {
                  spaceIds.push(child.id);
                }
                findSpaces(child);
              });
            };
            findSpaces(mo);
          });
        }

        // Un-xray and colorize the spaces
        spaceIds.forEach(id => {
          const entity = scene.objects?.[id];
          if (entity) {
            entity.xrayed = false;
            entity.visible = true;
            entity.colorize = rgb;
            entity.opacity = 0.85;
          }
        });
      });
      
      // Also show the storey entities themselves (IfcBuildingStorey)
      Object.entries(colorMap).forEach(([floorGuid]) => {
        const guidLower = floorGuid.toLowerCase();
        Object.values(metaObjects).forEach((mo: any) => {
          if (mo.type?.toLowerCase() !== 'ifcbuildingstorey') return;
          const moGuid = (mo.originalSystemId || mo.id || '').toLowerCase();
          if (moGuid === guidLower) {
            const entity = scene.objects?.[mo.id];
            if (entity) {
              entity.xrayed = false;
              entity.visible = true;
            }
          }
        });
      });

    } else if (parsed.mode === 'asset_categories' || parsed.mode === 'asset_category') {
      // colorMap keys are asset type names (e.g. "FireExtinguisher")
      // Find matching objects from allData and colorize them
      const currentData = allDataRef.current;
      const buildingGuid = assetDataRef.current?.buildingFmGuid || assetDataRef.current?.fmGuid;
      
      Object.entries(colorMap).forEach(([assetType, rgb]) => {
        const matchingAssets = currentData.filter((a: any) => {
          if (a.buildingFmGuid !== buildingGuid) return false;
          const type = (a.assetType || a.category || '').replace('Ifc', '');
          return type === assetType;
        });
        
        matchingAssets.forEach((asset: any) => {
          // Look up entities by fmGuid using viewer API
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
    }

    // Force showSpaces on so colorized rooms remain visible
    setShowSpaces(true);
    try {
      const assetViewer = viewer?.assetViewer;
      assetViewer?.onShowSpacesChanged?.(true);
    } catch {}

  }, [insightsColorMode, modelLoadState, initStep]);

  // Camera sync hook for Split View synchronization
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
  const buildingFmGuid = assetData?.buildingFmGuid || assetData?.fmGuid;

  // Shared model names hook (used by extractModels for mobile + ModelVisibilitySelector)
  const { modelNamesMap } = useModelNames(buildingFmGuid);

  // On-demand XKT sync: ensure models are cached for this building with visual feedback
  useEffect(() => {
    if (!buildingFmGuid) return;
    
    const ensureModels = async () => {
      setXktSyncStatus('checking');
      
      try {
        const result = await xktCacheService.ensureBuildingModels(buildingFmGuid);
        
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
    window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, {
      detail: { mode }
    }));
  }, []);

  // Handler for room labels toggle
  const handleRoomLabelsToggle = useCallback((enabled: boolean) => {
    setShowRoomLabels(enabled);
    setRoomLabelsEnabled(enabled);
  }, [setRoomLabelsEnabled]);

  // Listen for view mode changes to update room label heights
  useEffect(() => {
    const handleViewModeChange = (e: CustomEvent) => {
      const mode = e.detail?.mode as '2d' | '3d';
      if (mode && updateLabelsViewMode) {
        console.log('AssetPlusViewer: View mode changed to', mode, '- updating room labels');
        updateLabelsViewMode(mode);
      }
    };
    
    window.addEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChange as EventListener);
    return () => {
      window.removeEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChange as EventListener);
    };
  }, [updateLabelsViewMode]);

  // Listen for floor selection changes to update spaces, room labels, and visualization
  useEffect(() => {
    const handleFloorSelectionChange = (e: CustomEvent<FloorSelectionEventDetail>) => {
      const { visibleFloorFmGuids: newGuids, isAllFloorsVisible } = e.detail;
      
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
    
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorSelectionChange as EventListener);
    return () => {
      window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorSelectionChange as EventListener);
    };
  }, [updateFloorFilter, showSpaces, filterSpacesToVisibleFloors]);

  // Handler for annotations toggle from mobile overlay and ViewerRightPanel
  const handleAnnotationsChange = useCallback((show: boolean) => {
    setShowAnnotations(show);
    // Update local annotation markers (DOM-based icons for inventoried assets, alarms, etc.)
    const plugin = localAnnotationsPluginRef.current;
    if (plugin?.annotations) {
      Object.values(plugin.annotations).forEach((ann: any) => {
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

  // Sync local annotation marker visibility when showAnnotations state changes
  useEffect(() => {
    const plugin = localAnnotationsPluginRef.current;
    if (!plugin?.annotations) return;
    Object.values(plugin.annotations).forEach((ann: any) => {
      ann.markerShown = showAnnotations;
      if (ann.markerElement) {
        ann.markerElement.style.display = showAnnotations ? 'flex' : 'none';
      }
    });
  }, [showAnnotations]);

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

  // Change X-ray material (from external_viewer-2.html)
  const changeXrayMaterial = useCallback(() => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
    const xeokitViewer = assetView?.viewer;
    const scene = xeokitViewer?.scene;
    const xrayMaterial = scene?.xrayMaterial;

    if (xrayMaterial) {
      xrayMaterial.fill = true;
      xrayMaterial.fillAlpha = 0.7;
      xrayMaterial.fillColor = [200 / 255, 200 / 255, 200 / 255];
      xrayMaterial.edges = true;
      xrayMaterial.edgeAlpha = 0.6;
      xrayMaterial.edgeColor = [15 / 255, 15 / 255, 15 / 255];
    }
  }, []);

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
        .select('fm_guid, name, asset_type, coordinate_x, coordinate_y, coordinate_z, symbol_id')
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
        worldPos: [number, number, number];
        category: string;
        name: string;
        color: string;
        iconUrl: string;
        markerShown: boolean;
      }> = [];

      // Build annotation data array
      assets.forEach(asset => {
        const symbol = asset.symbol_id ? symbolMap.get(asset.symbol_id) : null;
        const iconUrl = symbol?.icon_url || '';
        const color = symbol?.color || '#3B82F6';

        annotationsData.push({
          id: `local-${asset.fm_guid}`,
          worldPos: [
            Number(asset.coordinate_x),
            Number(asset.coordinate_y),
            Number(asset.coordinate_z)
          ],
          category: asset.asset_type || 'Övrigt',
          name: asset.name || 'Okänd',
          color,
          iconUrl,
          markerShown: showAnnotations,
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
          if (!canvas) return;
          
          Object.values(localAnnotationsManager.annotations).forEach(ann => {
            if (!ann.markerElement || !ann.markerShown) return;
            
            // Project world position to canvas position
            const canvasPos = xeokitViewer.scene.camera.projectWorldPos(ann.worldPos);
            if (canvasPos && canvasPos[2] > 0 && canvasPos[2] < 1) {
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

  // Load alarm annotations from BIM geometry (assets with asset_type = 'IfcAlarm')
  // These are placed at their BIM object positions, not from coordinate_x/y/z
  const loadAlarmAnnotations = useCallback(async () => {
    const resolvedBuildingGuid = resolveBuildingFmGuid();
    if (!resolvedBuildingGuid) return;

    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.metaScene?.metaObjects || !xeokitViewer?.scene) {
      console.log('Cannot load alarm annotations - viewer not ready');
      return;
    }

    try {
      // Fetch Alarm symbol
      const { data: alarmSymbol } = await supabase
        .from('annotation_symbols')
        .select('id, name, color, icon_url')
        .eq('name', 'Alarm')
        .maybeSingle();

      if (!alarmSymbol) {
        console.log('No Alarm symbol configured - skipping alarm annotations');
        return;
      }

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
        // Look up object in metaScene via fmGuid
        const metaObj = Object.values(metaObjects).find((m: any) =>
          (m.originalSystemId || m.id)?.toUpperCase() === alarm.fm_guid?.toUpperCase()
        );

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
          id: `alarm-${alarm.fm_guid}`,
          worldPos,
          category: 'Alarm',
          name: alarm.name || 'Alarm',
          color: alarmSymbol.color,
          iconUrl: alarmSymbol.icon_url || '',
          markerShown: showAnnotations,
          levelFmGuid: alarm.level_fm_guid,
        });

        foundCount++;
      });

      console.log(`Found ${foundCount} alarm annotations with BIM positions`);

      if (foundCount === 0) return;

      // Get existing annotations manager or create new container
      let localAnnotationsManager = localAnnotationsPluginRef.current;
      let container = document.getElementById('local-annotations-container');

      if (!localAnnotationsManager) {
        // Initialize a basic annotations manager
        localAnnotationsManager = {
          annotations: {} as Record<string, any>,
          container: null as HTMLElement | null,
          updatePositions: () => {
            const canvas = xeokitViewer.scene?.canvas?.canvas;
            if (!canvas) return;
            Object.values(localAnnotationsManager.annotations).forEach((ann: any) => {
              if (!ann.markerElement || !ann.markerShown) return;
              const canvasPos = xeokitViewer.scene.camera.projectWorldPos(ann.worldPos);
              if (canvasPos && canvasPos[2] > 0 && canvasPos[2] < 1) {
                ann.markerElement.style.display = 'flex';
                ann.markerElement.style.left = `${canvasPos[0] - 14}px`;
                ann.markerElement.style.top = `${canvasPos[1] - 14}px`;
              } else {
                ann.markerElement.style.display = 'none';
              }
            });
          },
        };
        localAnnotationsPluginRef.current = localAnnotationsManager;
        if (viewerInstanceRef.current) {
          viewerInstanceRef.current.localAnnotationsPlugin = localAnnotationsManager;
        }
      }

      if (!container) {
        container = document.createElement('div');
        container.id = 'local-annotations-container';
        container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:15;overflow:hidden;';
        viewerContainerRef.current?.appendChild(container);
      }
      localAnnotationsManager.container = container;

      // Create marker elements for each alarm annotation
      alarmAnnotations.forEach(ann => {
        // Skip if already exists
        if (localAnnotationsManager.annotations[ann.id]) return;

        const marker = document.createElement('div');
        marker.id = ann.id;
        marker.className = 'local-annotation-marker alarm-marker';
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
        container!.appendChild(marker);

        localAnnotationsManager.annotations[ann.id] = { ...ann, markerElement: marker };
      });

      // Set up camera update listener (only once)
      if (!localAnnotationsManager._cameraListenerSet) {
        const updateHandler = () => localAnnotationsManager.updatePositions();
        xeokitViewer.scene.camera.on('viewMatrix', updateHandler);
        xeokitViewer.scene.camera.on('projMatrix', updateHandler);
        localAnnotationsManager._cameraListenerSet = true;

        // Initial position update
        setTimeout(updateHandler, 100);
      } else {
        // Just update positions for new markers
        setTimeout(() => localAnnotationsManager.updatePositions(), 100);
      }

      console.log(`Created ${foundCount} alarm annotations for building:`, resolvedBuildingGuid);

      // Bulk update symbol_id for alarms that don't have it set
      const alarmsWithoutSymbol = alarms.filter(a => !a.symbol_id);
      if (alarmsWithoutSymbol.length > 0) {
        console.log(`Updating ${alarmsWithoutSymbol.length} alarms with Alarm symbol_id`);
        // Update in batches to avoid large queries
        const batchSize = 100;
        for (let i = 0; i < alarmsWithoutSymbol.length; i += batchSize) {
          const batch = alarmsWithoutSymbol.slice(i, i + batchSize);
          const ids = batch.map(a => a.id);
          await supabase
            .from('assets')
            .update({ symbol_id: alarmSymbol.id })
            .in('id', ids);
        }
      }
    } catch (e) {
      console.error('Error loading alarm annotations:', e);
    }
  }, [resolveBuildingFmGuid, showAnnotations]);

  // Keep annotation function refs in sync so handleAllModelsLoaded can call latest versions
  useEffect(() => { loadLocalAnnotationsRef.current = loadLocalAnnotations; }, [loadLocalAnnotations]);
  useEffect(() => { loadAlarmAnnotationsRef.current = loadAlarmAnnotations; }, [loadAlarmAnnotations]);

  // allModelsLoadedCallback - executed when all models are loaded
  const handleAllModelsLoaded = useCallback(() => {
    try {
      console.log("allModelsLoadedCallback");

      setModelLoadState('loaded');
      setInitStep('ready');

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
      try {
        const viewer = viewerInstanceRef.current;
        const assetViewer = viewer?.assetViewer;
        if (assetViewer?.onToggleAnnotation) {
          assetViewer.onToggleAnnotation(true);
          console.log("Annotations enabled");
          
          if (assetViewer.getAnnotations) {
            assetViewer.getAnnotations();
          }
        }
      } catch (e) {
        console.debug("Could not enable annotations:", e);
      }

      // CRITICAL: Ensure spaces (rooms) are hidden by default
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
        }
      } catch (e) {
        console.debug("Could not hide spaces:", e);
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
      
      // Load alarm annotations from BIM geometry
      loadAlarmAnnotationsRef.current?.().catch(e => {
        console.error('loadAlarmAnnotations failed:', e);
      });

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
      toast.error('Viewer ej redo. Försök igen.');
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
        toast.success(`Position markerad: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`, {
          description: 'Bekräfta eller välj ny position',
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
        toast.warning('Ingen yta hittades. Försök klicka på ett synligt objekt.', {
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
      toast.info('Klicka på en ny position');
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
      toast.info('Registreringsläge avbrutet');
      
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
        toast.info('Klicka på en yta i 3D-vyn för att välja position', {
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
    const handleLoadSavedView = (e: CustomEvent<LoadSavedViewDetail>) => {
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
        window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, {
          detail: { mode: viewData.viewMode }
        }));
        
        // 3. Set clip height if in 2D mode
        if (viewData.viewMode === '2d' && viewData.clipHeight) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(CLIP_HEIGHT_CHANGED_EVENT, {
              detail: { height: viewData.clipHeight }
            }));
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
    
    window.addEventListener(LOAD_SAVED_VIEW_EVENT, handleLoadSavedView as EventListener);
    return () => {
      window.removeEventListener(LOAD_SAVED_VIEW_EVENT, handleLoadSavedView as EventListener);
    };
  }, [state.isInitialized, modelLoadState]);

  // Dispatch viewer context changes for Gunnar AI integration
  const [currentViewMode, setCurrentViewMode] = useState<'2d' | '3d'>('3d');
  const [clipHeight, setClipHeight] = useState(1.2);
  
  // Listen for view mode changes
  useEffect(() => {
    const handleViewModeChanged = (e: CustomEvent<{ mode: '2d' | '3d' }>) => {
      setCurrentViewMode(e.detail.mode);
    };
    const handleClipHeightChanged = (e: CustomEvent<{ height: number }>) => {
      setClipHeight(e.detail.height);
    };
    window.addEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChanged as EventListener);
    window.addEventListener(CLIP_HEIGHT_CHANGED_EVENT, handleClipHeightChanged as EventListener);
    return () => {
      window.removeEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChanged as EventListener);
      window.removeEventListener(CLIP_HEIGHT_CHANGED_EVENT, handleClipHeightChanged as EventListener);
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
    
    window.dispatchEvent(new CustomEvent(VIEWER_CONTEXT_CHANGED_EVENT, {
      detail: contextDetail
    }));
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
    const handleArchitectModeRequest = (e: CustomEvent<{ enabled: boolean }>) => {
      console.log('ARCHITECT_MODE_REQUESTED:', e.detail.enabled);
      const success = toggleArchitectMode(viewerInstanceRef, e.detail.enabled);
      
      // Dispatch confirmation event
      if (success) {
        window.dispatchEvent(new CustomEvent(ARCHITECT_MODE_CHANGED_EVENT, {
          detail: { enabled: e.detail.enabled }
        }));
        toast.info(e.detail.enabled ? 'Arkitektvy aktiverad' : 'Arkitektvy avaktiverad', { duration: 2000 });
      }
    };
    
    window.addEventListener(ARCHITECT_MODE_REQUESTED_EVENT, handleArchitectModeRequest as EventListener);
    return () => {
      window.removeEventListener(ARCHITECT_MODE_REQUESTED_EVENT, handleArchitectModeRequest as EventListener);
    };
  }, [toggleArchitectMode]);

  // Listen for architect background color changes
  useEffect(() => {
    const handleBackgroundChange = (e: CustomEvent<{ presetId: BackgroundPresetId }>) => {
      console.log('ARCHITECT_BACKGROUND_CHANGED:', e.detail.presetId);
      // Directly apply background since we know architect mode is active (palette is visible)
      applyBackgroundPreset(e.detail.presetId);
    };
    
    window.addEventListener(ARCHITECT_BACKGROUND_CHANGED_EVENT, handleBackgroundChange as EventListener);
    return () => {
      window.removeEventListener(ARCHITECT_BACKGROUND_CHANGED_EVENT, handleBackgroundChange as EventListener);
    };
  }, [applyBackgroundPreset]);

  // Listen for room labels toggle from VisualizationToolbar
  useEffect(() => {
    const handleRoomLabelsToggle = (e: CustomEvent<RoomLabelsToggleDetail>) => {
      console.log('ROOM_LABELS_TOGGLE:', e.detail.enabled);
      setRoomLabelsEnabled(e.detail.enabled);
    };
    
    window.addEventListener(ROOM_LABELS_TOGGLE_EVENT, handleRoomLabelsToggle as EventListener);
    return () => {
      window.removeEventListener(ROOM_LABELS_TOGGLE_EVENT, handleRoomLabelsToggle as EventListener);
    };
  }, [setRoomLabelsEnabled]);

  // Extract floors from viewer for mobile UI
  const extractMobileFloors = useCallback(() => {
    const viewer = viewerInstanceRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.metaScene?.metaObjects) return [];

    const metaObjects = xeokitViewer.metaScene.metaObjects;
    const extractedFloors: MobileFloorInfo[] = [];

    Object.values(metaObjects).forEach((metaObject: any) => {
      const type = metaObject?.type?.toLowerCase();
      if (type === 'ifcbuildingstorey') {
        extractedFloors.push({
          id: metaObject.id,
          fmGuid: metaObject.id,
          name: metaObject.name || 'Okänd våning',
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
        window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
          detail: {
            floorId: isSolo ? visibleFloors[0].id : null,
            visibleFloorFmGuids: visibleFloors.map(f => f.fmGuid),
            visibleMetaFloorIds: visibleFloors.map(f => f.id),
            isAllFloorsVisible: isAllVisible,
          }
        }));

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
      
      // Check if this is an XKT model request
      const isXktRequest = url.includes('.xkt') || 
                           url.toLowerCase().includes('getxktdata') ||
                           url.toLowerCase().includes('threed');
      
      if (!isXktRequest) {
        // Not an XKT request, pass through
        return original!(input, init);
      }
      
      // Extract model ID for caching
      const modelId = xktCacheService.extractModelIdFromUrl(url);
      
      if (modelId) {
        // Check memory cache first
        const memoryData = getModelFromMemory(modelId, resolvedBuildingGuid);
        if (memoryData) {
          console.log(`XKT cache: Memory hit for ${modelId}`);
          // Return cached data as a Response
          return new Response(memoryData.slice(0), {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' }
          });
        }
        
        // Check database cache
        try {
          const cachedUrl = await xktCacheService.interceptModelRequest(url, resolvedBuildingGuid);
          if (cachedUrl) {
            console.log(`XKT cache: Database hit for ${modelId}, fetching from storage`);
            const cachedResponse = await original!(cachedUrl, init);
            if (cachedResponse.ok) {
              // Clone and store in memory
              const data = await cachedResponse.clone().arrayBuffer();
              storeModelInMemory(modelId, resolvedBuildingGuid, data);
              return new Response(data, {
                status: 200,
                headers: { 'Content-Type': 'application/octet-stream' }
              });
            }
          }
        } catch (e) {
          console.debug('XKT cache: Database check failed, fetching from source', e);
        }
      }
      
      // Fetch from Asset+ API
      const response = await original!(input, init);
      
      // Only process successful XKT responses
      if (response.ok && modelId) {
        // Clone the response so we can read it without consuming the original
        const responseClone = response.clone();
        
        // Process in background - don't await
        (async () => {
          try {
            const data = await responseClone.arrayBuffer();
            
            // Validate it's actual XKT data (should start with specific bytes)
            if (data.byteLength > 100) {
              // Store in memory cache
              storeModelInMemory(modelId, resolvedBuildingGuid, data);
              
              // Save to backend storage in background
              xktCacheService.saveModelFromViewer(
                modelId,
                data,
                resolvedBuildingGuid,
                modelId // Use modelId as name for now
              ).then(saved => {
                if (saved) {
                  console.log(`XKT cache: Saved ${modelId} to backend`);
                }
              }).catch(e => {
                console.debug(`XKT cache: Failed to save ${modelId} to backend:`, e);
              });
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

      if (viewerContainerRef.current && document.getElementById('AssetPlusViewer')) {
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

    // CRITICAL FIX: Clear container innerHTML before initialization
    // This prevents 'nextSibling' null errors during React mount/unmount cycles
    viewerContainerRef.current.innerHTML = '';

    setModelLoadState('idle');
    setCacheStatus(null);
    
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
            error: `Initiering tog för lång tid (${INIT_TIMEOUT_MS / 1000}s). Kontrollera nätverksanslutningen och försök igen.`,
          };
        }
        return prev;
      });
    }, INIT_TIMEOUT_MS);

    try {
      setInitStep('fetch_token');
      // Fetch Asset+ access token via edge function
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke('asset-plus-query', {
        body: { action: 'getToken' }
      });

      if (tokenError) {
        throw new Error('Could not fetch access token');
      }

      const accessToken = tokenData?.accessToken;
      
      if (!accessToken) {
        throw new Error('Asset+ access token is missing. Check your API settings.');
      }

      accessTokenRef.current = accessToken;
      console.log("AssetPlusViewer: Access token received");

      setInitStep('check_script');
      // Check if assetplusviewer is available globally
      const assetplusviewer = (window as any).assetplusviewer;
      
      if (!assetplusviewer) {
        throw new Error('Asset+ 3D Viewer package is not loaded. Verify that /lib/assetplus/assetplusviewer.umd.min.js is included.');
      }

      setInitStep('fetch_config');
      // Get API configuration
      const { data: configData } = await supabase.functions.invoke('asset-plus-query', {
        body: { action: 'getConfig' }
      });

      const baseUrl = configData?.apiUrl || '';
      const apiKey = configData?.apiKey || '';

      baseUrlRef.current = baseUrl;

      console.log("AssetPlusViewer: Init - Calling assetplusviewer with baseUrl:", baseUrl);

      setInitStep('mount_viewer');
      // Initialize the viewer following EXACT Asset+ external_viewer.html pattern
      const viewer = await assetplusviewer(
        baseUrl,  // URL to the API Backend
        apiKey,   // API Key in UUID format
        // getAccessTokenCallback
        async () => {
          console.log("getAccessTokenCallback");
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
        // additionalDefaultPredicate - () => true = load ALL models for this building
        () => true,
        // externalCustomObjectContextMenuItems
        undefined,
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
            window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
              detail: {
                visibleMetaFloorIds: [],
                visibleFloorFmGuids: [floorFmGuid],
                isAllFloorsVisible: false,
                isSoloFloor: true,
                soloFloorName: focusData.commonName || focusData.name || '',
              }
            }));
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
      
      // Clear any pending error display timeout
      if (showErrorTimeoutRef.current) {
        clearTimeout(showErrorTimeoutRef.current);
        showErrorTimeoutRef.current = null;
      }

      // Restore original fetch on unmount
      restoreFetch();
      
      // Cleanup viewer on unmount - guard against null/incomplete viewer
      // The 'e.nextSibling' error occurs when Asset+ tries to manipulate DOM
      // elements that were removed before cleanup completed
      try {
        const viewer = viewerInstanceRef.current;
        if (viewer) {
          // Defer cleanup to next frame to allow Asset+ to complete pending operations
          requestAnimationFrame(() => {
            try {
              // Only call clearData if the viewer is fully initialized
              const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
              const scene = assetView?.viewer?.scene;
              
              if (scene && typeof viewer.clearData === 'function') {
                viewer.clearData();
              }
            } catch (e) {
              // Silently ignore cleanup errors - the DOM is being torn down anyway
              console.debug('Viewer cleanup (expected during teardown):', e);
            }
          });
        }
      } catch (e) {
        // Silently ignore cleanup errors - the DOM is being torn down anyway
        console.debug('Viewer cleanup (expected during teardown):', e);
      }
      
      viewerInstanceRef.current = null;
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
          style={{ margin: 0 }}
        >
          {/* AssetPlusViewer container - MUST have id="AssetPlusViewer" */}
          <div 
            ref={viewerContainerRef}
            id="AssetPlusViewer"
            className={`w-full h-full ${isMobile ? 'dx-device-mobile' : 'dx-device-desktop'} dx-device-generic dx-theme-material dx-theme-material-typography asset-plus-hide-builtin-toolbar`}
            style={{
              display: 'flex',
              flex: '1 0 auto',
              background: transparentBackground
                ? 'transparent'
                : 'radial-gradient(90% 100% at center top, rgb(236, 236, 236), rgb(42, 42, 50))',
              touchAction: transparentBackground ? 'none' : 'none',
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              pointerEvents: transparentBackground ? 'none' : undefined,
            } as React.CSSProperties}
          />

          {/* Loading spinner overlay */}
          {((state.isLoading && !state.isInitialized) || (xktSyncStatus === 'syncing' || xktSyncStatus === 'checking') && state.isInitialized) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-background/30">
              <Spinner 
                size="xl" 
                label={xktSyncStatus === 'syncing' ? 'Synkar 3D-modeller...' : undefined} 
              />
            </div>
          )}
          
          {/* Mobile UI Overlay - shown on mobile devices (hidden when suppressOverlay) */}
          {isMobile && state.isInitialized && !suppressOverlay && (
            <MobileViewerOverlay
              onClose={onClose}
              viewerInstanceRef={viewerInstanceRef}
              buildingName={assetData?.commonName || assetData?.name}
              showSpaces={showSpaces}
              onShowSpacesChange={handleShowSpacesChange}
              floors={mobileFloors}
              onFloorToggle={handleMobileFloorToggle}
              onResetCamera={handleResetCamera}
              isViewerReady={modelLoadState === 'loaded' && initStep === 'ready'}
              is2DMode={currentViewMode === '2d'}
              onToggle2DMode={handleToggle2DMode}
              showAnnotations={showAnnotations}
              onShowAnnotationsChange={handleAnnotationsChange}
              showRoomLabels={showRoomLabels}
              onShowRoomLabelsChange={handleRoomLabelsToggle}
              onOpenVisualizationPanel={() => setRightPanelOpen(true)}
              models={availableModels}
              onModelToggle={handleModelToggle}
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
                    aria-label="Stäng 3D-vy"
                  >
                    <X className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                )}
                <Button 
                  variant="secondary" 
                  size="icon"
                  onClick={() => setIsFullscreen(!isFullscreen)} 
                  className="h-8 w-8 sm:h-10 sm:w-10 shadow-lg bg-card/95 backdrop-blur-sm border"
                  aria-label={isFullscreen ? "Avsluta helskärm" : "Helskärm"}
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4 sm:h-5 sm:w-5" /> : <Maximize2 className="h-4 w-4 sm:h-5 sm:w-5" />}
                </Button>
                <Button 
                  variant={showTreePanel ? "default" : "secondary"}
                  size="icon"
                  onClick={() => setShowTreePanel(!showTreePanel)} 
                  className="h-8 w-8 sm:h-10 sm:w-10 shadow-lg bg-card/95 backdrop-blur-sm border"
                  aria-label="Modellträd"
                  title="Modellträd"
                >
                  <TreeDeciduous className="h-4 w-4 sm:h-5 sm:w-5" />
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
                  aria-label="Visning"
                  title="Visning"
                >
                  <Menu className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              )}
            </div>
            </div>
          )}

          {/* NavCube canvas - positioned in bottom-right corner, responsive size */}
          <canvas 
            id="navCubeCanvas" 
            width={typeof window !== 'undefined' && window.innerWidth < 640 ? 60 : 80}
            height={typeof window !== 'undefined' && window.innerWidth < 640 ? 60 : 80}
            className="absolute right-3 z-[25]"
            style={{
              bottom: 'calc(env(safe-area-inset-bottom, 12px) + 74px)',
              width: typeof window !== 'undefined' && window.innerWidth < 640 ? '60px' : '80px',
              height: typeof window !== 'undefined' && window.innerWidth < 640 ? '60px' : '80px',
              display: showNavCube ? 'block' : 'none',
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
                  🎯 Klicka på en yta för att välja position
                </p>
              </div>
            </div>
          )}
          
          {/* Two-step confirmation overlay for position picking */}
          {pendingPickCoords && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 bg-card/95 backdrop-blur-md p-4 rounded-xl shadow-2xl border flex flex-col gap-3 min-w-[280px]">
              <div className="text-center">
                <p className="font-medium text-sm mb-1">📍 Position markerad</p>
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
                  Välj om
                </Button>
                <Button 
                  onClick={handleConfirmPosition}
                  className="flex-1"
                >
                  Bekräfta ✓
                </Button>
              </div>
            </div>
          )}

          {/* Custom toolbar - centered at bottom */}
          {state.isInitialized && initStep === 'ready' && (
            <>
              {/* Floating Floor Switcher - always visible pills above toolbar */}
              {!isMobile && (
                <FloatingFloorSwitcher
                  viewerRef={viewerInstanceRef}
                  buildingFmGuid={buildingFmGuid}
                  isViewerReady={true}
                  className="absolute bottom-20 left-4 z-20 pointer-events-auto"
                />
              )}

              {/* Visualization Legend Bar - independent of right panel */}
              <VisualizationLegendBarOverlay />
              
              <ViewerToolbar 
                viewerRef={viewerInstanceRef} 
                onOpenSettings={() => setToolbarSettingsOpen(true)}
                flashOnSelectEnabled={flashOnSelectEnabled}
                onToggleFlashOnSelect={setFlashOnSelectEnabled}
                hoverHighlightEnabled={hoverHighlightEnabled}
                onToggleHoverHighlight={setHoverHighlightEnabled}
                disableSelectTool={pickModeEnabled}
                className="pointer-events-auto"
              />
              
              {/* Tree View Panel - standalone mode (not in sheet) */}
              {showTreePanel && (
                <div className="pointer-events-auto">
                  <ViewerTreePanel
                    viewerRef={viewerInstanceRef}
                    isVisible={showTreePanel}
                    onClose={() => setShowTreePanel(false)}
                    onNodeSelect={(nodeId, nodeFmGuid) => {
                      console.log('TreePanel node selected:', nodeId, nodeFmGuid);
                      const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
                      if (xeokitViewer?.scene) {
                        flashEntityById(xeokitViewer.scene, nodeId, {
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
              <div className="pointer-events-auto">
                <FloorCarousel
                  viewerRef={viewerInstanceRef}
                  onFloorSelect={handleFloorSelect}
                  selectedFloorId={selectedFloorId || undefined}
                />
              </div>
              
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
          
          {/* Toolbar Settings Modal */}
          <div className="pointer-events-auto">
            <ToolbarSettings
              isOpen={toolbarSettingsOpen}
              onClose={() => setToolbarSettingsOpen(false)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssetPlusViewer;
