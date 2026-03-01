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

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Layers, Move3D, Maximize2, Minimize2, Eye,
  RefreshCw, View, Box, Combine, SplitSquareHorizontal,
  Loader2, Square, BarChart2, LayoutPanelLeft,
} from 'lucide-react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { supabase } from '@/integrations/supabase/client';
import FmAccess2DPanel from '@/components/viewer/FmAccess2DPanel';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ViewerSyncProvider, useViewerSync, type LocalCoords } from '@/context/ViewerSyncContext';
const AssetPlusViewer = React.lazy(() => import('@/components/viewer/AssetPlusViewer'));
import NativeXeokitViewer from '@/components/viewer/NativeXeokitViewer';
import AlignmentPanel from '@/components/viewer/AlignmentPanel';
import BuildingSelector from '@/components/viewer/BuildingSelector';
import Ivion360View from '@/components/viewer/Ivion360View';
import InsightsDrawerPanel from '@/components/viewer/InsightsDrawerPanel';
import { useBuildingViewerData } from '@/hooks/useBuildingViewerData';
import { useIvionSdk } from '@/hooks/useIvionSdk';
import { useVirtualTwinSync } from '@/hooks/useVirtualTwinSync';
import { useIvionCameraSync } from '@/hooks/useIvionCameraSync';
import { IDENTITY_TRANSFORM, type IvionBimTransform } from '@/lib/ivion-bim-transform';
import { VIEWER_TOOL_CHANGED_EVENT, VIEW_MODE_2D_TOGGLED_EVENT, VIEW_MODE_REQUESTED_EVENT, LOAD_SAVED_VIEW_EVENT, type ViewerToolChangedDetail, type ViewMode2DToggledDetail, type LoadSavedViewDetail } from '@/lib/viewer-events';
import SplitPlanView from '@/components/viewer/SplitPlanView';
import { FLOOR_SELECTION_CHANGED_EVENT } from '@/hooks/useSectionPlaneClipping';

import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';

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
  const visualizationParam = searchParams.get('visualization') as import('@/lib/visualization-utils').VisualizationType | null;
  const insightsModeParam = searchParams.get('insightsMode') || null;
  const xrayParam = searchParams.get('xray') === 'true';
  
  // 3D/2D ska alltid använda native xeokit för stabil laddning på både desktop och mobil

  // ─── Building data (shared) ────────────────────────────────────────
  const { buildingData, isLoading, error } = useBuildingViewerData(buildingFmGuid);

  // ─── View mode ─────────────────────────────────────────────────────
  const hasIvion = !!buildingData?.ivionSiteId;
  const modeParam = searchParams.get('mode') as ViewMode | null;
  const effectiveInitialMode = modeParam || initialMode;
  const [viewMode, setViewMode] = useState<ViewMode>(effectiveInitialMode);
  const userChangedModeRef = useRef(false);
  const viewModeRef = useRef<ViewMode>(effectiveInitialMode);

  // Keep viewModeRef always in sync
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

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
    if (modeParam === prevModeParamRef.current) return; // only react to URL changes
    prevModeParamRef.current = modeParam;
    const validModes: ViewMode[] = ['2d', '3d', 'split', 'split2d3d', 'vt', '360'];
    if (!validModes.includes(modeParam)) return;
    if (modeParam !== viewMode) {
      userChangedModeRef.current = true;
      setViewMode(modeParam);
    }
  }, [modeParam]);

  // ─── Dispatch mode events when viewMode changes ────────────────
  // Use a sentinel so the first render always fires the event when starting in 2D
  const prevViewModeRef = useRef<ViewMode | '__init__'>(viewMode === '2d' ? '__init__' : viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;

    if (viewMode === '2d' || viewMode === '3d') {
      window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: viewMode } }));
    }

    // Mark user-initiated mode changes (not the initial dispatch)
    if (prev !== '__init__' && prev !== viewMode) {
      userChangedModeRef.current = true;
    }

    if (viewMode === '2d' && prev !== '2d') {
      window.dispatchEvent(new CustomEvent<ViewMode2DToggledDetail>(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: true } }));
      // If a floor was specified in URL, dispatch floor selection after a short delay
      // so that ViewerToolbar and FloatingFloorSwitcher can pick it up
      if (floorFmGuid) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
            detail: {
              floorId: null,
              floorName: null,
              bounds: null,
              visibleMetaFloorIds: [],
              visibleFloorFmGuids: [floorFmGuid],
              isAllFloorsVisible: false,
              isSoloFloor: true,
            },
          }));
        }, 500);
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
    // Only force 3D for modes that actually require the 360° SDK
    if (sdkStatus === 'failed' && (viewMode === 'vt' || viewMode === 'split' || viewMode === '360')) {
      setViewMode('3d');
      toast.error('360° SDK kunde inte laddas. Visar 3D-modell.');
    }
  }, [sdkStatus, viewMode]);

  // ─── UI state ──────────────────────────────────────────────────────
  const [showAlignment, setShowAlignment] = useState(false);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [ghostOpacity, setGhostOpacity] = useState(30);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transform, setTransform] = useState<IvionBimTransform>(IDENTITY_TRANSFORM);
  // Insights drawer — auto-open if insightsModeParam is set in URL
  const [insightsPanelOpen, setInsightsPanelOpen] = useState(!!insightsModeParam);

  useEffect(() => {
    if (buildingData?.transform) {
      setTransform(buildingData.transform);
    }
  }, [buildingData?.transform]);

  // ─── Apply start view when building data is ready ──────────────────
  const startViewAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const sv = buildingData?.startView;
    if (!sv || !buildingData) return;
    // Only apply once per building
    if (startViewAppliedRef.current === buildingData.fmGuid) return;
    startViewAppliedRef.current = buildingData.fmGuid;

    // Dispatch after a delay to allow model loading
    const timer = setTimeout(() => {
      // Read current mode from ref to avoid stale closure
      const currentMode = viewModeRef.current;
      // If user has already manually changed mode, respect their choice
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
      // If start view is 2D (and user hasn't overridden), also switch mode
      if (resolvedViewMode === '2d') setViewMode('2d');
    }, 2000);
    return () => clearTimeout(timer);
  }, [buildingData]);

  // ─── Viewer instance ref (for xeokit) ──────────────────────────────
  const viewerInstanceRef = useRef<any>(null);
  const [viewerReady, setViewerReady] = useState(false);

  useEffect(() => {
    setViewerReady(false);
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
    const interval = setInterval(() => {
      if (checkForViewer()) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [buildingData]);

  // ─── Re-dispatch 2D event once viewer is ready (fixes mobile + desktop init) ─
  useEffect(() => {
    if (viewerReady && viewMode === '2d') {
      // Fire at 1.5s and again at 3s as fallback for slow mobile loads
      const dispatch2D = () => {
        window.dispatchEvent(new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: true } }));
        window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '2d' } }));
      };
      const t1 = setTimeout(dispatch2D, 1500);
      const t2 = setTimeout(dispatch2D, 3000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [viewerReady, viewMode]);

  // ─── Pointer-events toggle for VT overlay ──────────────────────────
  const [overlayInteractive, setOverlayInteractive] = useState(false);

  useEffect(() => {
    const handleToolChanged = (e: CustomEvent<ViewerToolChangedDetail>) => {
      setOverlayInteractive(e.detail.tool === 'select' || e.detail.tool === 'measure' || e.detail.tool === 'slicer');
    };
    window.addEventListener(VIEWER_TOOL_CHANGED_EVENT, handleToolChanged as EventListener);
    return () => window.removeEventListener(VIEWER_TOOL_CHANGED_EVENT, handleToolChanged as EventListener);
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

  // ─── Ivion camera sync for split mode (polls SDK position) ─────────
  const dummyIframeRef = useRef<HTMLIFrameElement>(null);
  const isSplitMode = viewMode === 'split';

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

  // ─── Ghost opacity — change-driven (no rAF loop) ──
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

  const handleGoBack = useCallback(() => navigate('/'), [navigate]);

  const handleRetrySDK = useCallback(() => {
    retrySDK();
    if (hasIvion) setViewMode(initialMode !== '3d' ? initialMode : 'vt');
  }, [retrySDK, hasIvion, initialMode]);

  // ─── Loading / Error states ────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Laddar viewer...</p>
        </div>
      </div>
    );
  }

  if (!buildingFmGuid) {
    return (
      <div className="h-screen bg-background">
        <BuildingSelector />
      </div>
    );
  }

  if (error || !buildingData) {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-background">
        <div className="text-center max-w-md">
          <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-destructive font-medium mb-2">{error || 'Byggnadsdata saknas'}</p>
          <Button variant="outline" onClick={handleGoBack}>Tillbaka</Button>
        </div>
      </div>
    );
  }

  // ─── Mobile: Simplified tab layout ─────────────────────────────────
  if (isMobile) {
    return <MobileUnifiedViewer
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
    />;
  }

  // ─── Compute AssetPlusViewer container style per mode ──────────────
  const is2DMode = viewMode === '2d';
  const needs3D = viewMode !== '360'; // 2D now uses xeokit too
  const is3DMode = viewMode === '3d';
  const isVTMode = viewMode === 'vt';
  const isSplit2D3D = viewMode === 'split2d3d';
  const shouldUseNative3D = viewMode === '3d' || viewMode === '2d';

  const viewerContainerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: isSplit2D3D ? '40%' : 0,
    height: '100%',
    display: needs3D ? 'flex' : 'none',
    flexDirection: 'column',
    width: isSplit2D3D ? '60%' : (isSplitMode ? '50%' : '100%'),
    zIndex: is3DMode || is2DMode ? 10 : isVTMode ? 10 : 5,
    pointerEvents: isVTMode ? (overlayInteractive ? 'auto' : 'none') : 'auto',
  };

  // ─── Desktop Render ────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-black">
      {/* ─── Header toolbar — in document flow, pushes content down ─── */}
      <div className="shrink-0 flex items-center justify-between p-2 bg-black/80 backdrop-blur-sm z-40">
        {/* Left: Back + building name */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost" size="sm"
            onClick={handleGoBack}
            className="text-white hover:bg-white/20 gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Tillbaka</span>
          </Button>
          <div className="h-5 w-px bg-white/30" />
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <div>
              <h1 className="text-sm font-semibold text-white">{buildingData.name}</h1>
              <p className="text-[10px] text-white/60">
                {viewMode === 'vt' ? 'Virtual Twin' :
                 viewMode === 'split' ? 'Split 3D/360°' :
                 viewMode === 'split2d3d' ? 'Split 2D/3D' :
                 viewMode === '360' ? '360° Panorama' :
                 viewMode === '2d' ? '2D Planvy' : '3D Viewer'}
              </p>
            </div>
          </div>
        </div>

        {/* Center: Mode switcher */}
        <div className="flex gap-1 bg-black/40 backdrop-blur-md rounded-lg p-1 border border-white/10">
          <ModeButton mode="2d" current={viewMode} disabled={false} onClick={setViewMode} icon={<Square className="h-3.5 w-3.5" />} label="2D" />
          <ModeButton mode="3d" current={viewMode} disabled={false} onClick={setViewMode} icon={<Box className="h-3.5 w-3.5" />} label="3D" />
          <ModeButton mode="split2d3d" current={viewMode} disabled={false} onClick={setViewMode} icon={<LayoutPanelLeft className="h-3.5 w-3.5" />} label="2D/3D" />
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
              <TooltipContent>Försök ladda SDK igen</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-1">
          {/* Insights drawer toggle — desktop only */}
          {!isMobile && buildingFmGuid && (
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
              <TooltipContent>Byggnadsinsikter och analys</TooltipContent>
            </Tooltip>
          )}

          {viewMode === 'vt' && vtSyncActive && (
            <span className="text-xs text-green-400 bg-green-900/40 px-2 py-0.5 rounded flex items-center gap-1 mr-2">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              Synk aktiv
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
              <TooltipContent>3D-modellens synlighet</TooltipContent>
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
              <TooltipContent>Alignment-kalibrering</TooltipContent>
            </Tooltip>
          )}

          <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 h-8 w-8" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ─── Content area — fills remaining space ─── */}
      <div className="flex-1 min-h-0 relative">
        {/* SDK container — visible for vt and 360 modes */}
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

        {/* ── Split 2D/3D: left panel with 2D plan view ── */}
        {isSplit2D3D && (
          <div className="absolute top-0 left-0 h-full z-20" style={{ width: '40%' }}>
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel defaultSize={100} minSize={100}>
                <SplitPlanView
                  viewerRef={viewerInstanceRef}
                  buildingFmGuid={buildingData.fmGuid}
                />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </ResizablePanelGroup>
          </div>
        )}

        {/* ── SINGLE 3D Viewer — always mounted, CSS-controlled ── */}
        <div style={viewerContainerStyle}>
          {shouldUseNative3D ? (
            <NativeXeokitViewer
              buildingFmGuid={buildingData.fmGuid}
              onClose={is3DMode ? handleGoBack : undefined}
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

        {/* ── Split: 360° panel on the right half ── */}
        {/* Split mode: SDK container above handles the 360° panel */}

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

      {/* ─── Insights bottom-sheet panel — desktop only ─── */}
      {!isMobile && buildingFmGuid && (
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
              ? 'bg-white/20 text-white shadow-inner'
              : 'text-white/60 hover:text-white hover:bg-white/10'
          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          {icon}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {disabled ? 'Kräver Ivion-konfiguration' :
         mode === '3d' ? 'Enbart 3D BIM-modell' :
         mode === 'split' ? '3D + 360° sida vid sida' :
         mode === 'split2d3d' ? '2D planvy + 3D sida vid sida' :
         mode === 'vt' ? 'Virtual Twin — 3D overlay på 360°' :
         mode === '2d' ? 'Xeokit 2D planvy' :
         'Enbart 360° panorama'}
      </TooltipContent>
    </Tooltip>
  );
}

/** Mobile layout — simplified tab switcher */
function MobileUnifiedViewer({
  buildingData, viewMode, setViewMode, sdkStatus, ivApiRef,
  sdkContainerRef, transform,
  handle3DCameraChange, sync3DPosition, sync3DHeading, sync3DPitch,
  hasIvion, hasFmAccess, floorFmGuid, floorName, entityFmGuid, visualizationParam, insightsMode, forceXray, onGoBack,
}: {
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
}) {
  // 2D now uses xeokit, so activePanel is '3d' for both '2d' and '3d' modes
  const activePanel = viewMode === '360' || viewMode === 'vt' ? '360' : '3d';

  return (
    <div className="fixed inset-0 bg-black z-40 overflow-hidden">
      {/* Canvas layer — fills entire screen, behind header */}
      <div className="absolute inset-0">
        {/* 3D/2D viewer — always mounted, hidden when 360 active */}
        <div style={{ display: activePanel === '3d' ? 'flex' : 'none', flexDirection: 'column', height: '100%', position: 'relative' }}>
          {viewMode === '3d' || viewMode === '2d' ? (
            <NativeXeokitViewer
              buildingFmGuid={buildingData.fmGuid}
              onClose={onGoBack}
            />
          ) : (
            <React.Suspense fallback={<div className="flex items-center justify-center h-full bg-black"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>}>
              <AssetPlusViewer
                fmGuid={buildingData.fmGuid}
                initialFmGuidToFocus={entityFmGuid || undefined}
                initialVisualization={visualizationParam || undefined}
                insightsColorMode={insightsMode || undefined}
                forceXray={forceXray || undefined}
                syncEnabled={false}
                onCameraChange={handle3DCameraChange}
                syncPosition={sync3DPosition}
                syncHeading={sync3DHeading}
                syncPitch={sync3DPitch}
                onClose={onGoBack}
                mobileViewMode="3d"
                onMobileChangeViewMode={(m) => setViewMode(m as ViewMode)}
                mobileHasIvion={hasIvion}
              />
            </React.Suspense>
          )}
        </div>

        {/* 360 SDK container */}
        {hasIvion && (
          <div
            ref={sdkContainerRef}
            style={{
              display: activePanel === '360' ? 'block' : 'none',
              position: 'absolute',
              inset: 0,
              height: '100%',
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Top-level UnifiedViewer — wraps content in ViewerSyncProvider.
 */
const UnifiedViewer: React.FC<UnifiedViewerProps> = ({ initialMode = 'vt' }) => {
  return (
    <ViewerSyncProvider>
      <UnifiedViewerContent initialMode={initialMode} />
    </ViewerSyncProvider>
  );
};

export default UnifiedViewer;
