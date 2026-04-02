/**
 * Unified Viewer — Single component for all viewer modes.
 * 
 * Modes:
 *   3D:    Full-screen AssetPlusViewer only
 *   split: 3D + 360° side by side
 *   vt:    3D overlay on 360° panorama (Virtual Twin)
 *   360:   Full-screen 360° panorama only
 * 
 * CRITICAL: Only ONE AssetPlusViewer instance is ever mounted.
 * Mode switches control CSS (display, width, z-index, pointer-events)
 * so that xeokit keeps loaded XKT models in memory.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo, useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppContext } from '@/context/AppContext';
import {
  ArrowLeft, Layers, Move3D, Maximize2, Minimize2, Eye,
  RefreshCw, View, Box, Combine, SplitSquareHorizontal,
  Loader2, Square, BarChart2, LayoutPanelLeft, GripHorizontal,
  MoreVertical,
} from 'lucide-react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { supabase } from '@/integrations/supabase/client';
import FmAccess2DPanel from '@/components/viewer/FmAccess2DPanel';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ViewerSyncProvider, useViewerSync, type LocalCoords } from '@/context/ViewerSyncContext';
import NativeViewerShell from '@/components/viewer/NativeViewerShell';

const AssetPlusViewer = React.lazy(() => import('@/components/viewer/AssetPlusViewer'));
import AlignmentPanel from '@/components/viewer/AlignmentPanel';
import BuildingSelector from '@/components/viewer/BuildingSelector';
import Ivion360View from '@/components/viewer/Ivion360View';
import InsightsDrawerPanel from '@/components/viewer/InsightsDrawerPanel';
import { useBuildingViewerData } from '@/hooks/useBuildingViewerData';
import { useIvionSdk } from '@/hooks/useIvionSdk';
import { useVirtualTwinSync } from '@/hooks/useVirtualTwinSync';
import { useIvionCameraSync } from '@/hooks/useIvionCameraSync';
import { useViewerCameraSync } from '@/hooks/useViewerCameraSync';
import { IDENTITY_TRANSFORM, type IvionBimTransform } from '@/lib/ivion-bim-transform';
import { VIEWER_TOOL_CHANGED_EVENT, VIEW_MODE_2D_TOGGLED_EVENT, VIEW_MODE_REQUESTED_EVENT, LOAD_SAVED_VIEW_EVENT, type ViewerToolChangedDetail, type ViewMode2DToggledDetail, type LoadSavedViewDetail } from '@/lib/viewer-events';
import SplitPlanView from '@/components/viewer/SplitPlanView';
import { FLOOR_SELECTION_CHANGED_EVENT } from '@/hooks/useSectionPlaneClipping';
import NavigationPanel from '@/components/viewer/NavigationPanel';
import NavGraphEditorOverlay from '@/components/viewer/NavGraphEditorOverlay';
import RouteDisplayOverlay from '@/components/viewer/RouteDisplayOverlay';
import type { NavGraph, RouteResult } from '@/lib/pathfinding';

import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import MobileViewerPage from '@/components/viewer/mobile/MobileViewerPage';

import { emit, on } from '@/lib/event-bus';
export type ViewMode = '2d' | '3d' | 'split' | 'split2d3d' | 'vt' | '360';

interface UnifiedViewerProps {
  initialMode?: ViewMode;
}

/**
 * Inner component that has access to ViewerSyncContext.
 */
const UnifiedViewerContent: React.FC<{
  initialMode: ViewMode;
}> = ({ initialMode }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const buildingFmGuid = searchParams.get('building');
  const entityFmGuid = searchParams.get('entity');
  const floorFmGuid = searchParams.get('floor');
  const floorName = searchParams.get('floorName') || '';
  const returnToParam = searchParams.get('returnTo');
  const resolvedReturnPath = returnToParam && returnToParam.startsWith('/') && !returnToParam.startsWith('//')
    ? returnToParam
    : '/';
  const visualizationParam = searchParams.get('visualization') as import('@/lib/visualization-utils').VisualizationType | null;
  const insightsModeParam = searchParams.get('insightsMode') || null;
  const xrayParam = searchParams.get('xray') === 'true';

  // ─── Building data (shared) ────────────────────────────────────────
  const { buildingData, isLoading, error } = useBuildingViewerData(buildingFmGuid);

  // ─── View mode ─────────────────────────────────────────────────────
  const hasIvion = !!buildingData?.ivionSiteId;
  const modeParam = searchParams.get('mode') as ViewMode | null;
  const effectiveInitialMode = modeParam || initialMode;
  const [viewMode, setViewMode] = useState<ViewMode>(effectiveInitialMode);
  const userChangedModeRef = useRef(false);
  const viewModeRef = useRef<ViewMode>(effectiveInitialMode);
  const lastFloorEventRef = useRef<number>(0);

  // Keep viewModeRef always in sync
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  // When entering split2d3d mode, auto-select current floor and set first-person mode
  useEffect(() => {
    if (viewMode !== 'split2d3d') return;
    const timer = setTimeout(() => {
      // Use the floor from URL params if available
      const targetFloorGuid = floorFmGuid || null;

      emit('FLOOR_SELECTION_CHANGED', {
          floorId: null,
          floorName: floorName || null,
          bounds: null,
          visibleMetaFloorIds: [],
          visibleFloorFmGuids: targetFloorGuid ? [targetFloorGuid] : [],
          isAllFloorsVisible: !targetFloorGuid,
          isSoloFloor: !!targetFloorGuid,
        });

      // Set 3D camera to first-person mode for split view
      const viewer = (window as any).__nativeXeokitViewer;
      if (viewer?.cameraControl) {
        viewer.cameraControl.navMode = 'firstPerson';
        viewer.cameraControl.followPointer = true;
        viewer.cameraControl.constrainVertical = true;
      }
      // Reset 3D camera to building overview on split entry
      if (viewer?.cameraFlight && viewer?.scene?.aabb) {
        viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.3 });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [viewMode, floorFmGuid, floorName]);

  // ─── Split 2D/3D: listen for SPLIT_PLAN_NAVIGATE to fly 3D camera ──
  useEffect(() => {
    if (viewMode !== 'split2d3d') return;

    const handler = (detail: any) => {
      const { worldPos } = detail || {};
      if (!worldPos || worldPos.length < 3) return;
      // Validate coordinates before flying
      if (!worldPos.every((v: number) => Number.isFinite(v))) return;

      const viewer = (window as any).__nativeXeokitViewer;
      if (!viewer?.cameraFlight || !viewer?.camera) return;

      // Preserve current horizontal heading direction
      const eye = viewer.camera.eye;
      const look = viewer.camera.look;
      const dx = look[0] - eye[0];
      const dz = look[2] - eye[2];
      const hLen = Math.sqrt(dx * dx + dz * dz);
      const dirX = hLen > 0.01 ? dx / hLen : 0;
      const dirZ = hLen > 0.01 ? dz / hLen : -1;

      // Place camera at click point, 2m above floor, looking in same direction
      const floorY = worldPos[1];
      const eyeHeight = floorY + 2.0;

      const newEye = [worldPos[0], eyeHeight, worldPos[2]];
      const newLook = [worldPos[0] + dirX * 5, eyeHeight, worldPos[2] + dirZ * 5];

      // Validate computed positions
      if (!newEye.every((v: number) => Number.isFinite(v)) || !newLook.every((v: number) => Number.isFinite(v))) return;

      // Ensure perspective projection for 3D response
      if (viewer.camera.projection !== 'perspective') {
        viewer.camera.projection = 'perspective';
      }

      viewer.cameraFlight.flyTo({
        eye: newEye,
        look: newLook,
        up: [0, 1, 0],
        duration: 0.3,
      }, () => {
        // Force a canvas redraw after flyTo completes to prevent blank 3D pane
        try {
          viewer.scene.canvas?.resizeCanvas?.();
          viewer.scene.glRedraw?.();
          viewer.scene.fire?.('tick');
        } catch {}
      });
    };

    const off = on('SPLIT_PLAN_NAVIGATE', handler);
    return () => off();
  }, [viewMode]);

  // ─── FM Access availability ────────────────────────────────────────
  const [hasFmAccess, setHasFmAccess] = useState(!!floorFmGuid);
  useEffect(() => {
    if (buildingData?.fmAccessBuildingGuid) {
      setHasFmAccess(true);
      return;
    }
    if (!buildingData?.fmGuid) return;
    supabase
      .from('building_external_links')
      .select('id')
      .eq('building_fm_guid', buildingData.fmGuid)
      .eq('system_name', 'fm_access')
      .limit(1)
      .then(({ data }) => setHasFmAccess((data?.length ?? 0) > 0));
  }, [buildingData?.fmGuid, buildingData?.fmAccessBuildingGuid]);

  useEffect(() => {
    if (buildingData && !buildingData.ivionSiteId && viewMode !== '3d' && viewMode !== '2d' && viewMode !== 'split2d3d') {
      setViewMode('3d');
    }
  }, [buildingData, viewMode]);

  // Keep internal viewMode in sync with URL mode param (important when navigating
  // to the same route with a new mode query parameter, e.g. "2D" quick action).
  // IMPORTANT: Only react to modeParam changes, NOT viewMode changes, otherwise
  // clicking a mode button triggers a re-sync back to the URL param value.
  const prevModeParamRef = useRef(modeParam);
  useEffect(() => {
    if (!modeParam) return;
    if (modeParam === prevModeParamRef.current) return;
    prevModeParamRef.current = modeParam;
    const validModes: ViewMode[] = ['2d', '3d', 'split', 'split2d3d', 'vt', '360'];
    if (!validModes.includes(modeParam)) return;
    if (modeParam !== viewMode) {
      userChangedModeRef.current = true;
      setViewMode(modeParam);
    }
  }, [modeParam]);

  // ─── Dispatch mode events when viewMode changes ────────────────
  const prevViewModeRef = useRef<ViewMode | '__init__'>(viewMode === '2d' ? '__init__' : viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;

    // Only dispatch when viewMode actually changed — not on floorFmGuid changes
    if (prev !== viewMode && (viewMode === '2d' || viewMode === '3d')) {
      emit('VIEW_MODE_REQUESTED', { mode: viewMode });
    }

    if (prev !== '__init__' && prev !== viewMode) {
      userChangedModeRef.current = true;
    }

    if (viewMode === '2d' && prev !== '2d') {
      window.dispatchEvent(new CustomEvent<ViewMode2DToggledDetail>(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: true } }));
      if (floorFmGuid) {
        setTimeout(() => {
          emit('FLOOR_SELECTION_CHANGED', {
              floorId: null,
              floorName: null,
              bounds: null,
              visibleMetaFloorIds: [],
              visibleFloorFmGuids: [floorFmGuid],
              isAllFloorsVisible: false,
              isSoloFloor: true,
            });
        }, 500);
      }
    } else if (viewMode === '3d' && floorFmGuid && (prev === '__init__' || prev !== '3d')) {
      // Also isolate floor in 3D mode when navigating from Portfolio/Navigator
      setTimeout(() => {
        emit('FLOOR_SELECTION_CHANGED', {
            floorId: null,
            floorName: floorName || null,
            bounds: null,
            visibleMetaFloorIds: [],
            visibleFloorFmGuids: [floorFmGuid],
            isAllFloorsVisible: false,
            isSoloFloor: true,
          });
      }, 500);
    } else if (viewMode === 'split2d3d' && prev !== 'split2d3d') {
      // Split 2D/3D uses a dedicated 2D panel, so keep xeokit pane explicitly in 3D mode.
      window.dispatchEvent(new CustomEvent<ViewMode2DToggledDetail>(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: false } }));
      emit('VIEW_MODE_REQUESTED', { mode: '3d' });

      // Carry over current floor selection from 2D mode into split mode
      // If we came from 2D with a floor selected, keep it; otherwise show all
      const now = Date.now();
      if (now - (lastFloorEventRef.current || 0) > 500) {
        lastFloorEventRef.current = now;
        setTimeout(() => {
          // Try to get current floor from URL param or from the floor switcher state
          const currentFloorGuid = floorFmGuid || null;
          emit('FLOOR_SELECTION_CHANGED', {
              floorId: null,
              floorName: floorName || null,
              bounds: null,
              visibleMetaFloorIds: [],
              visibleFloorFmGuids: currentFloorGuid ? [currentFloorGuid] : [],
              isAllFloorsVisible: !currentFloorGuid,
              isSoloFloor: !!currentFloorGuid,
            });
        }, 300);
      }
    } else if (viewMode !== '2d' && prev === '2d') {
      window.dispatchEvent(new CustomEvent<ViewMode2DToggledDetail>(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: false } }));
    }
  }, [viewMode, floorFmGuid]);

  // ─── SDK (shared, one instance) ────────────────────────────────────
  const sdkContainerRef = useRef<HTMLDivElement>(null);
  const sdkNeeded = hasIvion && (viewMode === 'vt' || viewMode === '360' || viewMode === 'split');

  const { sdkStatus, ivApiRef, retry: retrySDK } = useIvionSdk({
    baseUrl: buildingData?.ivionBaseUrl || '',
    siteId: buildingData?.ivionSiteId || '',
    buildingFmGuid: buildingData?.fmGuid || '',
    containerRef: sdkContainerRef,
    enabled: !!buildingData && sdkNeeded,
  });

  useEffect(() => {
    if (sdkStatus === 'failed' && (viewMode === 'vt' || viewMode === 'split' || viewMode === '360')) {
      setViewMode('3d');
      toast.error('360° SDK failed to load. Showing 3D model.');
    }
  }, [sdkStatus, viewMode]);

  // Apply Street View entry heading to Ivion SDK when transitioning outdoor → indoor
  useEffect(() => {
    if (sdkStatus !== 'ready' || viewMode !== '360') return;
    const savedHeading = sessionStorage.getItem('street-view-entry-heading');
    if (!savedHeading) return;
    sessionStorage.removeItem('street-view-entry-heading');
    const heading = parseFloat(savedHeading);
    if (isNaN(heading)) return;
    try {
      const api = ivApiRef.current as any;
      if (api?.camera?.setHeading) {
        api.camera.setHeading(heading);
        console.log('[UnifiedViewer] Applied Street View heading to Ivion:', heading);
      } else if (api?.resolveMoveTo) {
        api.resolveMoveTo({ heading });
      }
    } catch (e) {
      console.warn('[UnifiedViewer] Could not apply Street View heading:', e);
    }
  }, [sdkStatus, viewMode]);

  // ─── UI state ──────────────────────────────────────────────────────
  const [showAlignment, setShowAlignment] = useState(false);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [ghostOpacity, setGhostOpacity] = useState(30);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transform, setTransform] = useState<IvionBimTransform>(IDENTITY_TRANSFORM);
  const [insightsPanelOpen, setInsightsPanelOpen] = useState(!!insightsModeParam);

  // Resize xeokit canvas when insights panel toggles (layout changes height)
  useEffect(() => {
    const doResize = () => {
      try {
        const xv = (window as any).__nativeXeokitViewer;
        if (xv?.scene?.canvas) {
          xv.scene.canvas.resizeCanvas?.();
          xv.scene.glRedraw?.();
        }
      } catch {}
    };
    const t1 = setTimeout(doResize, 100);
    const t2 = setTimeout(doResize, 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [insightsPanelOpen]);

  // ─── Indoor navigation state ──────────────────────────────────────
  const [navPanelOpen, setNavPanelOpen] = useState(false);
  const [navEditMode, setNavEditMode] = useState(false);
  const [navGraph, setNavGraph] = useState<NavGraph>({ nodes: new Map(), edges: [] });
  const [navRoute, setNavRoute] = useState<RouteResult | null>(null);
  const [planRoomLabels, setPlanRoomLabels] = useState<Array<{ id: string; name: string; x: number; y: number }>>([]);
  const [navFloorFmGuid, setNavFloorFmGuid] = useState<string | null>(null);

  // Listen for toolbar toggle event
  useEffect(() => {
    const handler = () => setNavPanelOpen(p => !p);
    const off = on('TOGGLE_NAVIGATION_PANEL', handler);
    return () => off();
  }, []);

  // Track current floor fm_guid from floor selection events
  useEffect(() => {
    const handler = (detail: any) => {
      const guids = detail?.visibleFloorFmGuids;
      if (guids?.length) setNavFloorFmGuid(guids[0]);
    };
    const off = on('FLOOR_SELECTION_CHANGED', handler);
    return () => off();
  }, []);

  useEffect(() => {
    if (buildingData?.transform) {
      setTransform(buildingData.transform);
    }
  }, [buildingData?.transform]);

  // ─── Apply start view ONLY when startView exists, triggered by VIEWER_MODELS_LOADED ──
  const startViewAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const sv = buildingData?.startView;
    if (!sv || !buildingData) return;
    if (startViewAppliedRef.current === buildingData.fmGuid) return;

    // Wait for VIEWER_MODELS_LOADED instead of a hardcoded timeout
    const handler = () => {
      if (startViewAppliedRef.current === buildingData.fmGuid) return;
      startViewAppliedRef.current = buildingData.fmGuid;

      const currentMode = viewModeRef.current;
      const resolvedViewMode = userChangedModeRef.current
        ? currentMode
        : ((sv.viewMode as '2d' | '3d') || '3d');

      const resolvedMode2d3d: '2d' | '3d' = resolvedViewMode === '2d' ? '2d' : '3d';
      window.dispatchEvent(new CustomEvent<LoadSavedViewDetail>(LOAD_SAVED_VIEW_EVENT, {
        detail: {
          viewId: 'start-view',
          cameraEye: sv.cameraEye || [0, 0, 0],
          cameraLook: sv.cameraLook || [0, 0, 0],
          cameraUp: sv.cameraUp || [0, 1, 0],
          cameraProjection: sv.cameraProjection || 'perspective',
          viewMode: resolvedMode2d3d,
          clipHeight: sv.clipHeight || 1.2,
          visibleModelIds: sv.visibleModelIds || [],
          visibleFloorIds: sv.visibleFloorIds || [],
          showSpaces: sv.showSpaces || false,
          showAnnotations: sv.showAnnotations || false,
          visualizationType: 'none',
          visualizationMockData: false,
        },
      }));
      if (resolvedViewMode === '2d') setViewMode('2d');
    };

    const off = on('VIEWER_MODELS_LOADED', handler);
    return () => off();
  }, [buildingData]);

  // ─── Viewer instance ref (for xeokit) ──────────────────────────────
  const viewerInstanceRef = useRef<any>(null);
  const [viewerReady, setViewerReady] = useState(false);

  const prevBuildingFmGuidRef = useRef<string | null>(null);
  useEffect(() => {
    const currentFmGuid = buildingData?.fmGuid ?? null;
    // Only reset viewerReady when building actually changes, not on every buildingData reference update
    if (currentFmGuid !== prevBuildingFmGuidRef.current) {
      prevBuildingFmGuidRef.current = currentFmGuid;
      setViewerReady(false);
    }
    const checkForViewer = () => {
      const win = window as any;
      const instance = win.__assetPlusViewerInstance;
      if (instance) {
        viewerInstanceRef.current = instance;
        setViewerReady(true);
        return true;
      }
      return false;
    };
    if (checkForViewer()) return;
    const interval = setInterval(() => {
      if (checkForViewer()) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [buildingData]);

  // ─── Re-dispatch 2D event once viewer is ready, and also on VIEWER_MODELS_LOADED ─
  useEffect(() => {
    if (viewerReady && viewMode === '2d') {
      let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
      let cancelled = false;

      const dispatch2D = () => {
        if (cancelled) return;
        window.dispatchEvent(new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: true } }));
        emit('VIEW_MODE_REQUESTED', { mode: '2d' });
        if (floorFmGuid) {
          emit('FLOOR_SELECTION_CHANGED', {
              floorId: null,
              floorName: null,
              bounds: null,
              visibleMetaFloorIds: [],
              visibleFloorFmGuids: [floorFmGuid],
              isAllFloorsVisible: false,
              isSoloFloor: true,
            });
        }
      };

      // Dispatch immediately when switching to 2D while viewer is already ready
      // (models are already loaded at this point)
      pendingTimeout = setTimeout(dispatch2D, 150);

      // Also listen for VIEWER_MODELS_LOADED for the case where 2D is set before models finish
      const modelsLoadedHandler = () => {
        if (cancelled) return;
        // Clear the immediate timeout and re-dispatch after models
        if (pendingTimeout) clearTimeout(pendingTimeout);
        pendingTimeout = setTimeout(dispatch2D, 300);
      };
      const offModelsLoadedHandler = on('VIEWER_MODELS_LOADED', modelsLoadedHandler);

      return () => {
        cancelled = true;
        if (pendingTimeout) clearTimeout(pendingTimeout);
        offModelsLoadedHandler();
      };
    }
  }, [viewerReady, viewMode, floorFmGuid]);

  // ─── Pointer-events toggle for VT overlay ──────────────────────────
  const [overlayInteractive, setOverlayInteractive] = useState(false);

  useEffect(() => {
    const handleToolChanged = (detail: ViewerToolChangedDetail) => {
      setOverlayInteractive(detail.tool === 'select' || detail.tool === 'measure' || detail.tool === 'slicer');
    };
    const off = on('VIEWER_TOOL_CHANGED', handleToolChanged);
    return () => off();
  }, []);

  // ─── Camera sync (VT mode — one-directional) ──────────────────────
  const { isActive: vtSyncActive } = useVirtualTwinSync({
    ivApiRef,
    viewerInstanceRef,
    transform,
    enabled: sdkStatus === 'ready' && viewMode === 'vt',
  });

  // ─── Split-view sync context ──────────────────────────────────────
  const {
    syncLocked, setSyncLocked, resetSync, syncState,
    updateFrom3D, updateFromIvion, setBuildingContext,
  } = useViewerSync();

  useEffect(() => {
    if (buildingData) {
      setBuildingContext({
        fmGuid: buildingData.fmGuid,
        originLat: buildingData.origin?.lat,
        originLng: buildingData.origin?.lng,
        rotation: buildingData.origin?.rotation,
      });
    }
  }, [buildingData, setBuildingContext]);

  const handle3DCameraChange = useCallback((position: LocalCoords, heading: number, pitch: number) => {
    if (!syncLocked || viewMode !== 'split') return;
    updateFrom3D(position, heading, pitch);
  }, [syncLocked, updateFrom3D, viewMode]);

  // ─── Ivion camera sync for split mode ─────────
  const dummyIframeRef = useRef<HTMLIFrameElement>(null);
  const isSplitMode = viewMode === 'split';

  useViewerCameraSync({
    viewerRef: viewerInstanceRef,
    enabled: isSplitMode && syncLocked && viewerReady,
  });

  useIvionCameraSync({
    iframeRef: dummyIframeRef,
    ivApiRef,
    enabled: isSplitMode && sdkStatus === 'ready',
    ivionSiteId: buildingData?.ivionSiteId || '',
    buildingFmGuid: buildingData?.fmGuid,
    buildingTransform: transform,
  });

  const [sync3DPosition, setSync3DPosition] = useState<LocalCoords | null>(null);
  const [sync3DHeading, setSync3DHeading] = useState(0);
  const [sync3DPitch, setSync3DPitch] = useState(0);

  useEffect(() => {
    if (!syncLocked || viewMode !== 'split') return;
    if (syncState.source !== 'ivion' || !syncState.position) return;
    setSync3DPosition(syncState.position);
    setSync3DHeading(syncState.heading);
    setSync3DPitch(syncState.pitch);
  }, [syncLocked, syncState, viewMode]);

  // ─── Ghost opacity ──
  useEffect(() => {
    if (viewMode !== 'vt') return;
    try {
      let xv = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (!xv) {
        const win = window as any;
        xv = win.__assetPlusViewerInstance?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      }
      if (xv?.scene) {
        const ids = xv.scene.objectIds;
        if (ids?.length) {
          xv.scene.setObjectsOpacity(ids, ghostOpacity / 100);
        }
      }
    } catch { /* ignore */ }
  }, [viewMode, ghostOpacity, viewerReady]);

  // ─── Fullscreen ────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const { setViewer3dFmGuid } = useContext(AppContext);

  const handleGoBack = useCallback(() => {
    // Clear viewer context to prevent redirect loops from NativeViewerPage
    setViewer3dFmGuid(null);
    // Respect explicit return path (e.g. standalone /ai), otherwise fallback to home.
    navigate(resolvedReturnPath);
  }, [navigate, setViewer3dFmGuid, resolvedReturnPath]);

  const handleRetrySDK = useCallback(() => {
    retrySDK();
    if (hasIvion) setViewMode(initialMode !== '3d' ? initialMode : 'vt');
  }, [retrySDK, hasIvion, initialMode]);

  // ─── Compute values used in render (must be before returns) ────────
  const is2DMode = viewMode === '2d';
  const needs3D = viewMode !== '360';
  const is3DMode = viewMode === '3d';
  const isVTMode = viewMode === 'vt';
  const isSplit2D3D = viewMode === 'split2d3d';
  const shouldUseNative3D = true;

  // ─── Dispatch zoom-to-entity for native viewer when entity param is present ──
  useEffect(() => {
    if (!entityFmGuid || !viewerReady || !shouldUseNative3D) return;
    const timer = setTimeout(() => {
      emit('VIEWER_ZOOM_TO_OBJECT', { fmGuid: entityFmGuid });
    }, 1500);
    return () => clearTimeout(timer);
  }, [entityFmGuid, viewerReady, shouldUseNative3D]);

  // Draggable split ratio for desktop split2d3d
  const [desktopSplitRatio, setDesktopSplitRatio] = useState(40);
  const desktopDragRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleDesktopDividerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    desktopDragRef.current = true;
  }, []);

  useEffect(() => {
    if (!isSplit2D3D) return;
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!desktopDragRef.current || !contentRef.current) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const rect = contentRef.current.getBoundingClientRect();
      const pct = Math.max(20, Math.min(70, ((clientX - rect.left) / rect.width) * 100));
      setDesktopSplitRatio(pct);
    };
    const handleUp = () => { desktopDragRef.current = false; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isSplit2D3D]);

  // Trigger xeokit canvas resize when split ratio changes or entering split mode
  useEffect(() => {
    if (!isSplit2D3D) return;
    const doResize = () => {
      try {
        const xv = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer
          ?? (window as any).__nativeXeokitViewer;
        if (xv?.scene?.canvas) {
          xv.scene.canvas.resizeCanvas?.();
          xv.scene.glRedraw?.();
        }
      } catch {}
    };
    // Multiple resize passes: immediate, short, and delayed to catch late layout
    const t1 = setTimeout(doResize, 50);
    const t2 = setTimeout(doResize, 200);
    const t3 = setTimeout(doResize, 600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isSplit2D3D, desktopSplitRatio, viewerReady]);

  // NOTE: We no longer show a full-screen "Loading viewer..." overlay here.
  // Instead we let the NativeXeokitViewer handle its own loading spinner,
  // which eliminates the double-spinner issue (especially from saved views).
  if (isLoading || !buildingData) {
    // Still need to wait for buildingData before rendering the header/content
    if (!buildingFmGuid) {
      return (
        <div className="h-screen bg-background">
          <BuildingSelector />
        </div>
      );
    }
    if (error) {
      return (
        <div className="h-screen flex items-center justify-center p-4 bg-background">
          <div className="text-center max-w-md">
            <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-destructive font-medium mb-2">{error}</p>
            <Button variant="outline" onClick={handleGoBack}>Back</Button>
          </div>
        </div>
      );
    }
    // Show a minimal loading state that doesn't compete with the viewer's own spinner
    // On mobile, use transparent bg so there's no visible "flash" before the viewer spinner takes over
    return (
      <div className={`h-screen flex items-center justify-center ${isMobile ? 'bg-background' : 'bg-black'}`}>
        {!isMobile && <Loader2 className="h-6 w-6 animate-spin text-white/30" />}
      </div>
    );
  }

  // (buildingFmGuid and error checks moved into the isLoading block above)

  // ─── Mobile: Simplified tab layout ─────────────────────────────────
  if (isMobile) {
    return <MobileViewerPage
      buildingData={buildingData}
      viewMode={viewMode}
      setViewMode={setViewMode}
      sdkStatus={sdkStatus}
      ivApiRef={ivApiRef}
      sdkContainerRef={sdkContainerRef}
      transform={transform}
      handle3DCameraChange={handle3DCameraChange}
      sync3DPosition={sync3DPosition}
      sync3DHeading={sync3DHeading}
      sync3DPitch={sync3DPitch}
      hasIvion={hasIvion}
      hasFmAccess={hasFmAccess}
      floorFmGuid={floorFmGuid}
      floorName={floorName}
      entityFmGuid={entityFmGuid}
      visualizationParam={visualizationParam}
      insightsMode={insightsModeParam}
      forceXray={xrayParam}
      onGoBack={handleGoBack}
      viewerInstanceRef={viewerInstanceRef}
      viewerReady={viewerReady}
      insightsPanelOpen={insightsPanelOpen}
      setInsightsPanelOpen={setInsightsPanelOpen}
    />;
  }


  const viewerContainerStyle: React.CSSProperties = isSplit2D3D ? {
    position: 'absolute',
    top: 0,
    right: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    width: `${100 - desktopSplitRatio}%`,
    zIndex: 5,
    pointerEvents: 'auto',
  } : {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    display: needs3D ? 'flex' : 'none',
    flexDirection: 'column',
    width: isSplitMode ? '50%' : '100%',
    zIndex: is3DMode || is2DMode ? 10 : isVTMode ? 10 : 5,
    pointerEvents: isVTMode ? (overlayInteractive ? 'auto' : 'none') : 'auto',
  };

  // ─── Desktop Render ────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-black">
      {/* ─── Header toolbar ─── */}
      <div className="shrink-0 flex items-center justify-between p-2 bg-black/80 backdrop-blur-sm z-40">
        {/* Left: Back + building name */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost" size="sm"
            onClick={handleGoBack}
            className="text-white hover:bg-white/20 gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="h-5 w-px bg-white/30" />
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <div>
              <h1 className="text-sm font-semibold text-white">{buildingData.name}</h1>
            </div>
          </div>
        </div>

        {/* Center: Mode switcher */}
        <div className="flex gap-1 bg-black/40 backdrop-blur-md rounded-lg p-1 border border-white/10">
          <ModeButton mode="2d" current={viewMode} disabled={false} onClick={setViewMode} icon={<Square className="h-3.5 w-3.5" />} label="2D" />
          <ModeButton mode="split2d3d" current={viewMode} disabled={false} onClick={setViewMode} icon={<LayoutPanelLeft className="h-3.5 w-3.5" />} label="2D/3D" />
          <ModeButton mode="3d" current={viewMode} disabled={false} onClick={setViewMode} icon={<Box className="h-3.5 w-3.5" />} label="3D" />
          <ModeButton mode="split" current={viewMode} disabled={!hasIvion} onClick={setViewMode} icon={<SplitSquareHorizontal className="h-3.5 w-3.5" />} label="3D/360" />
          <ModeButton mode="vt" current={viewMode} disabled={!hasIvion || sdkStatus === 'failed'} onClick={setViewMode} icon={<Combine className="h-3.5 w-3.5" />} label="VT" />
          <ModeButton mode="360" current={viewMode} disabled={!hasIvion || sdkStatus === 'failed'} onClick={setViewMode} icon={<View className="h-3.5 w-3.5" />} label="360°" />

          {sdkStatus === 'loading' && viewMode !== '3d' && (
            <span className="text-xs text-blue-300 flex items-center gap-1 px-2">
              <Loader2 className="h-3 w-3 animate-spin" />
            </span>
          )}

          {sdkStatus === 'failed' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="text-white/60 hover:text-white hover:bg-white/10 h-8 w-8" onClick={handleRetrySDK}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Retry SDK</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-1">
          {buildingFmGuid && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setInsightsPanelOpen(v => !v)}
                  className={`gap-1.5 px-3 h-8 text-xs ${insightsPanelOpen ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
                >
                  <BarChart2 className="h-3.5 w-3.5" />
                  Insights
                </Button>
              </TooltipTrigger>
              <TooltipContent>Building insights & analytics</TooltipContent>
            </Tooltip>
          )}

          {viewMode === 'vt' && vtSyncActive && (
            <span className="text-xs text-green-400 bg-green-900/40 px-2 py-0.5 rounded flex items-center gap-1 mr-2">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              Sync active
            </span>
          )}

          {viewMode === 'vt' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 bg-white/10 rounded px-3 py-1 min-w-[160px]">
                  <Eye className="h-3.5 w-3.5 text-white/70 shrink-0" />
                  <Slider value={[ghostOpacity]} onValueChange={([v]) => setGhostOpacity(v)} min={0} max={100} step={5} className="w-28" />
                  <span className="text-xs text-white/70 w-8 text-right shrink-0">{ghostOpacity}%</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>3D model opacity</TooltipContent>
            </Tooltip>
          )}

          {(viewMode === 'vt' || viewMode === 'split') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost" size="icon"
                  className={`text-white hover:bg-white/20 h-8 w-8 ${showAlignment ? 'bg-white/20' : ''}`}
                  onClick={() => setShowAlignment(!showAlignment)}
                >
                  <Move3D className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Alignment calibration</TooltipContent>
            </Tooltip>
          )}

          <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 h-8 w-8" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ─── Content area ─── */}
      <div ref={contentRef} className="flex-1 flex flex-col min-h-0">
        {/* ─── Viewer area (relative, shrinks when insights open) ─── */}
        <div className="flex-1 relative min-h-0">
        {/* SDK container */}
        <div
          ref={sdkContainerRef}
          className="absolute z-0 transition-opacity duration-300"
          style={{
            display: sdkNeeded ? 'block' : 'none',
            opacity: sdkStatus === 'ready' ? 1 : 0,
            top: 0,
            right: 0,
            width: isSplitMode ? '50%' : '100%',
            height: '100%',
            zIndex: isSplitMode ? 5 : 0,
          }}
        />

        {/* ── SINGLE 3D Viewer — always mounted ── */}
        <div style={viewerContainerStyle}>
          {shouldUseNative3D ? (
            <NativeViewerShell
              buildingFmGuid={buildingData.fmGuid}
              onClose={is3DMode ? handleGoBack : () => {}}
              hideBackButton
              hideFloorSwitcher={isSplit2D3D}
              showGeminusMenu={viewMode === '3d'}
            />
          ) : (
            <React.Suspense fallback={<div className="flex items-center justify-center h-full bg-black"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>}>
              <AssetPlusViewer
                fmGuid={buildingData.fmGuid}
                initialFmGuidToFocus={entityFmGuid || undefined}
                initialVisualization={visualizationParam || undefined}
                insightsColorMode={insightsModeParam || undefined}
                forceXray={xrayParam || undefined}
                transparentBackground={isVTMode}
                ghostOpacity={isVTMode ? ghostOpacity / 100 : undefined}
                suppressOverlay={isVTMode}
                onClose={is3DMode ? handleGoBack : undefined}
                syncEnabled={isSplitMode ? syncLocked : false}
                onCameraChange={isSplitMode ? handle3DCameraChange : undefined}
                syncPosition={isSplitMode ? sync3DPosition : undefined}
                syncHeading={isSplitMode ? sync3DHeading : undefined}
                syncPitch={isSplitMode ? sync3DPitch : undefined}
              />
            </React.Suspense>
          )}
        </div>

        {/* ── Split 2D/3D: SplitPlanView on left + thin draggable divider ── */}
        {isSplit2D3D && (
          <>
            <div className="absolute top-0 left-0 z-20" style={{ width: `${desktopSplitRatio}%`, height: '100%' }}>
              <SplitPlanView
                viewerRef={viewerInstanceRef}
                buildingFmGuid={buildingData.fmGuid}
                className="h-full"
                syncFloorSelection={false}
                lockCameraToFloor={false}
                monochrome
                isSplitMode
                onRoomLabelsChange={setPlanRoomLabels}
                navigationOverlay={navPanelOpen ? (
                  <>
                    {navEditMode && (
                      <NavGraphEditorOverlay
                        graph={navGraph}
                        onGraphChange={setNavGraph}
                        roomLabels={planRoomLabels}
                        floorFmGuid={navFloorFmGuid}
                      />
                    )}
                    {!navEditMode && navRoute && (
                      <RouteDisplayOverlay route={navRoute} />
                    )}
                  </>
                ) : undefined}
              />
            </div>
            {/* Thin draggable divider */}
            <div
              className="absolute top-0 z-30 flex items-center justify-center cursor-col-resize group"
              style={{
                left: `${desktopSplitRatio}%`,
                transform: 'translateX(-50%)',
                width: '12px',
                height: '100%',
              }}
              onMouseDown={handleDesktopDividerDown}
              onTouchStart={handleDesktopDividerDown as any}
            >
              {/* Visual line — 2px visible, 12px hitbox */}
              <div className="w-px h-full bg-border group-hover:bg-primary/50 transition-colors" />
              {/* Center grip indicator */}
              <div className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-6 rounded bg-card/90 border border-border shadow-sm">
                <GripHorizontal className="h-3 w-3 text-muted-foreground rotate-90" />
              </div>
            </div>
          </>
        )}

        {/* ── Pure 2D mode: fullscreen SplitPlanView when nav panel open ── */}
        {is2DMode && navPanelOpen && (
          <div className="absolute inset-0 z-20">
            <SplitPlanView
              viewerRef={viewerInstanceRef}
              buildingFmGuid={buildingData.fmGuid}
              className="h-full"
              syncFloorSelection={false}
              lockCameraToFloor={false}
              monochrome
              onRoomLabelsChange={setPlanRoomLabels}
              navigationOverlay={
                <>
                  {navEditMode && (
                    <NavGraphEditorOverlay
                      graph={navGraph}
                      onGraphChange={setNavGraph}
                      roomLabels={planRoomLabels}
                      floorFmGuid={navFloorFmGuid}
                    />
                  )}
                  {!navEditMode && navRoute && (
                    <RouteDisplayOverlay route={navRoute} />
                  )}
                </>
              }
            />
          </div>
        )}

        {/* Crosshair overlay for alignment in VT mode */}
        {isVTMode && showAlignment && showCrosshair && (
          <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
            <div className="relative w-16 h-16">
              <div className="absolute top-1/2 left-0 right-0 h-px bg-red-500/60" />
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-red-500/60" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-red-500/80" />
            </div>
          </div>
        )}

        {/* Alignment panel overlay */}
        {showAlignment && (
          <div className="absolute top-2 left-4 z-50">
            <AlignmentPanel
              transform={transform}
              onChange={setTransform}
              buildingFmGuid={buildingData.fmGuid}
              onSaved={() => setShowAlignment(false)}
              showCrosshair={showCrosshair}
              onToggleCrosshair={setShowCrosshair}
              ivApiRef={isSplitMode ? ivApiRef : undefined}
              canPointPick={isSplitMode && sdkStatus === 'ready'}
            />
          </div>
        )}
      </div>
      {/* Close inner viewer area wrapper */}
      </div>

      {/* ─── Navigation sidebar panel ─── */}
      {navPanelOpen && buildingData && (
        <div className="absolute top-12 right-2 z-50 w-64 max-h-[80vh] bg-card border border-border rounded-lg shadow-xl overflow-hidden">
          <NavigationPanel
            buildingFmGuid={buildingData.fmGuid}
            onRouteCalculated={setNavRoute}
            onGraphLoaded={setNavGraph}
            onEditModeChange={setNavEditMode}
            onGraphSave={setNavGraph}
            currentFloorFmGuid={navFloorFmGuid}
            graph={navGraph}
            onClose={() => setNavPanelOpen(false)}
          />
        </div>
      )}

      {/* ─── Insights bottom-sheet panel — flex sibling that shrinks the viewer ─── */}
      {buildingFmGuid && (
        <InsightsDrawerPanel
          buildingFmGuid={buildingFmGuid}
          buildingName={buildingData?.name}
          open={insightsPanelOpen}
          onClose={() => setInsightsPanelOpen(false)}
        />
      )}
    </div>
  );
};

/** Mode switcher button */
function ModeButton({ mode, current, disabled, onClick, icon, label }: {
  mode: ViewMode;
  current: ViewMode;
  disabled: boolean;
  onClick: (m: ViewMode) => void;
  icon: React.ReactNode;
  label: string;
}) {
  const isActive = mode === current;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost" size="sm"
          disabled={disabled}
          onClick={() => onClick(mode)}
          className={`gap-1.5 px-3 h-8 rounded-md transition-all text-xs ${
            isActive
              ? 'bg-primary text-primary-foreground shadow-inner'
              : 'text-white/60 hover:text-white hover:bg-white/10'
          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          {icon}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {disabled ? 'Requires Ivion configuration' :
         mode === '3d' ? '3D BIM model only' :
         mode === 'split' ? '3D + 360° side by side' :
         mode === 'split2d3d' ? '2D plan + 3D side by side' :
         mode === 'vt' ? 'Virtual Twin — 3D overlay on 360°' :
         mode === '2d' ? 'Xeokit 2D plan view' :
         '360° panorama only'}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Top-level UnifiedViewer — wraps content in ViewerSyncProvider.
 */
const UnifiedViewer: React.FC<UnifiedViewerProps> = ({ initialMode = '3d' }) => {
  return (
    <ViewerSyncProvider>
      <UnifiedViewerContent initialMode={initialMode} />
    </ViewerSyncProvider>
  );
};

export default UnifiedViewer;
