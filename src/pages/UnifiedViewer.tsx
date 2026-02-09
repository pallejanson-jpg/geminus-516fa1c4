/**
 * Unified Viewer — Single component for all viewer modes.
 * 
 * Modes:
 *   3D:    Full-screen AssetPlusViewer only
 *   split: 3D + 360° side by side (ResizablePanelGroup)
 *   vt:    3D overlay on 360° panorama (Virtual Twin)
 *   360:   Full-screen 360° panorama only
 * 
 * All modes share:
 *   - Building data loading (useBuildingViewerData)
 *   - SDK lifecycle (useIvionSdk)
 *   - Toolbar with mode switcher
 *   - Fullscreen toggle
 *   - Alignment panel (VT + Split)
 * 
 * Routes:
 *   /virtual-twin?building=X  → initialMode='vt'
 *   /split-viewer?building=X  → initialMode='split'
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Layers, Move3D, Maximize2, Minimize2, Eye,
  RefreshCw, View, Box, Combine, SplitSquareHorizontal,
  Link2, Link2Off, Upload, RotateCcw, Loader2, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ViewerSyncProvider, useViewerSync, type LocalCoords } from '@/context/ViewerSyncContext';
import AssetPlusViewer from '@/components/viewer/AssetPlusViewer';
import AlignmentPanel from '@/components/viewer/AlignmentPanel';
import Ivion360View from '@/components/viewer/Ivion360View';
import { useBuildingViewerData } from '@/hooks/useBuildingViewerData';
import { useIvionSdk } from '@/hooks/useIvionSdk';
import { useVirtualTwinSync } from '@/hooks/useVirtualTwinSync';
import { IDENTITY_TRANSFORM, type IvionBimTransform } from '@/lib/ivion-bim-transform';
import { VIEWER_TOOL_CHANGED_EVENT, type ViewerToolChangedDetail } from '@/lib/viewer-events';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';

export type ViewMode = '3d' | 'split' | 'vt' | '360';

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

  // ─── Building data (shared) ────────────────────────────────────────
  const { buildingData, isLoading, error } = useBuildingViewerData(buildingFmGuid);

  // ─── View mode ─────────────────────────────────────────────────────
  const hasIvion = !!buildingData?.ivionSiteId;
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // If no Ivion site ID, force 3D mode
    if (!hasIvion && initialMode !== '3d') return '3d';
    return initialMode;
  });

  // Update viewMode when buildingData loads and Ivion availability changes
  useEffect(() => {
    if (buildingData && !buildingData.ivionSiteId && viewMode !== '3d') {
      setViewMode('3d');
    }
  }, [buildingData, viewMode]);

  // ─── SDK (shared, one instance) ────────────────────────────────────
  const sdkContainerRef = useRef<HTMLDivElement>(null);

  // SDK is managed here for VT and 360 modes only.
  // Split mode delegates SDK management to Ivion360View internally.
  const sdkNeeded = hasIvion && (viewMode === 'vt' || viewMode === '360');

  const { sdkStatus, ivApiRef, retry: retrySDK } = useIvionSdk({
    baseUrl: buildingData?.ivionBaseUrl || '',
    siteId: buildingData?.ivionSiteId || '',
    buildingFmGuid: buildingData?.fmGuid || '',
    containerRef: sdkContainerRef,
    enabled: !!buildingData && sdkNeeded,
  });

  // When SDK fails, fall back to 3D
  useEffect(() => {
    if (sdkStatus === 'failed' && viewMode !== '3d' && viewMode !== 'split') {
      setViewMode('3d');
      toast.error('360° SDK kunde inte laddas. Visar 3D-modell.');
    }
  }, [sdkStatus, viewMode]);

  // ─── UI state ──────────────────────────────────────────────────────
  const [showAlignment, setShowAlignment] = useState(false);
  const [ghostOpacity, setGhostOpacity] = useState(30);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transform, setTransform] = useState<IvionBimTransform>(IDENTITY_TRANSFORM);

  // Initialize transform from building data
  useEffect(() => {
    if (buildingData?.transform) {
      setTransform(buildingData.transform);
    }
  }, [buildingData?.transform]);

  // ─── Viewer instance ref (for xeokit) ──────────────────────────────
  const viewerInstanceRef = useRef<any>(null);

  useEffect(() => {
    const checkForViewer = () => {
      const win = window as any;
      if (win.__assetPlusViewerInstance) {
        viewerInstanceRef.current = win.__assetPlusViewerInstance;
        return true;
      }
      return false;
    };
    const interval = setInterval(() => {
      if (checkForViewer()) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [buildingData]);

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

  // Set building context for split sync
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

  // Split sync: 3D camera change handler
  const handle3DCameraChange = useCallback((position: LocalCoords, heading: number, pitch: number) => {
    if (!syncLocked || viewMode !== 'split') return;
    updateFrom3D(position, heading, pitch);
  }, [syncLocked, updateFrom3D, viewMode]);

  // Split sync: react to Ivion-driven updates
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

  // Manual sync dialog (split mode)
  const [showManualSyncDialog, setShowManualSyncDialog] = useState(false);
  const [manualIvionUrl, setManualIvionUrl] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const handleParseManualUrl = useCallback(async () => {
    if (!manualIvionUrl.includes('image=') || !buildingData) return;
    setIsSyncing(true);
    try {
      const url = new URL(manualIvionUrl);
      const imageId = url.searchParams.get('image');
      if (!imageId) { toast.error('Kunde inte hitta image-parameter'); return; }

      const vlon = parseFloat(url.searchParams.get('vlon') || '0');
      const vlat = parseFloat(url.searchParams.get('vlat') || '0');
      const heading = (vlon * 180) / Math.PI;
      const pitch = (vlat * 180) / Math.PI;

      const { data, error: fnError } = await (await import('@/integrations/supabase/client')).supabase.functions.invoke('ivion-poi', {
        body: { action: 'get-image-position', imageId: parseInt(imageId, 10), buildingFmGuid: buildingData.fmGuid },
      });

      if (fnError || !data?.success) { toast.error('Kunde inte hämta bildposition'); return; }

      const position: LocalCoords = { x: data.location.x, y: data.location.y, z: data.location.z };
      updateFromIvion(position, heading, pitch);
      setSync3DPosition(position);
      setSync3DHeading(heading);
      setSync3DPitch(pitch);
      toast.success('3D-vy synkad från 360°');
      setShowManualSyncDialog(false);
      setManualIvionUrl('');
    } catch { toast.error('Ogiltig URL'); }
    finally { setIsSyncing(false); }
  }, [manualIvionUrl, buildingData, updateFromIvion]);

  // ─── Ghost opacity for VT mode ────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'vt' || sdkStatus !== 'ready') return;
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) return;
    try {
      const objectIds = xeokitViewer.scene.objectIds;
      if (objectIds?.length) {
        xeokitViewer.scene.setObjectsOpacity(objectIds, ghostOpacity / 100);
      }
    } catch (e) { console.debug('[UnifiedViewer] Ghost opacity error:', e); }
  }, [ghostOpacity, sdkStatus, viewMode]);

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

  const handleGoBack = useCallback(() => navigate(-1), [navigate]);

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
      syncLocked={syncLocked}
      setSyncLocked={setSyncLocked}
      handle3DCameraChange={handle3DCameraChange}
      sync3DPosition={sync3DPosition}
      sync3DHeading={sync3DHeading}
      sync3DPitch={sync3DPitch}
      hasIvion={hasIvion}
      onGoBack={handleGoBack}
    />;
  }

  // ─── Desktop Render ────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen relative overflow-hidden bg-black">
      {/* ─── SDK container — always mounted, visibility controlled by mode ─── */}
      {/* SDK container — visible for vt and 360 modes */}
      <div
        ref={sdkContainerRef}
        className="absolute inset-0 z-0"
        style={{
          display: (viewMode === 'vt' || viewMode === '360') ? 'block' : 'none',
        }}
      />

      {/* ─── Mode-specific content ─── */}
      {viewMode === '3d' && (
        <div className="absolute inset-0 z-10">
          <AssetPlusViewer fmGuid={buildingData.fmGuid} onClose={handleGoBack} />
        </div>
      )}

      {viewMode === 'vt' && (
        <>
          {/* SDK is already rendered in sdkContainerRef above (z-0) */}
          <div
            className="absolute inset-0 z-10"
            style={{
              pointerEvents: overlayInteractive ? 'auto' : 'none',
            }}
          >
            <AssetPlusViewer
              fmGuid={buildingData.fmGuid}
              transparentBackground
              ghostOpacity={ghostOpacity / 100}
              suppressOverlay
              onClose={handleGoBack}
            />
          </div>
        </>
      )}

      {viewMode === '360' && (
        <>
          {/* SDK is already rendered in sdkContainerRef above (z-0) */}
        </>
      )}

      {viewMode === 'split' && (
        <div className="absolute inset-0 z-10" style={{ top: '48px' }}>
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={50} minSize={25}>
              <div className="h-full relative">
                <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs font-medium text-foreground">
                  3D Model
                </div>
                <AssetPlusViewer
                  fmGuid={buildingData.fmGuid}
                  syncEnabled={syncLocked}
                  onCameraChange={handle3DCameraChange}
                  syncPosition={sync3DPosition}
                  syncHeading={sync3DHeading}
                  syncPitch={sync3DPitch}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={25}>
              <div className="h-full relative">
                <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs font-medium text-foreground">
                  360° View
                </div>
                <Ivion360View
                  url={buildingData.ivionUrl || undefined}
                  syncEnabled={syncLocked}
                  buildingOrigin={buildingData.origin}
                  buildingFmGuid={buildingData.fmGuid}
                  ivionSiteIdProp={buildingData.ivionSiteId || undefined}
                  ivionBimTransform={transform}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}

      {/* ─── Header toolbar — above everything ─── */}
      <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between p-2 bg-black/40 backdrop-blur-sm">
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
                 viewMode === 'split' ? 'Split View' :
                 viewMode === '360' ? '360° Panorama' : '3D Viewer'}
              </p>
            </div>
          </div>
        </div>

        {/* Center: Mode switcher */}
        <div className="flex gap-1 bg-black/40 backdrop-blur-md rounded-lg p-1 border border-white/10">
          <ModeButton mode="360" current={viewMode} disabled={!hasIvion || sdkStatus === 'failed'} onClick={setViewMode} icon={<View className="h-3.5 w-3.5" />} label="360°" />
          <ModeButton mode="split" current={viewMode} disabled={!hasIvion} onClick={setViewMode} icon={<SplitSquareHorizontal className="h-3.5 w-3.5" />} label="Split" />
          <ModeButton mode="vt" current={viewMode} disabled={!hasIvion || sdkStatus === 'failed'} onClick={setViewMode} icon={<Combine className="h-3.5 w-3.5" />} label="VT" />
          <ModeButton mode="3d" current={viewMode} disabled={false} onClick={setViewMode} icon={<Box className="h-3.5 w-3.5" />} label="3D" />

          {/* SDK loading indicator */}
          {sdkStatus === 'loading' && viewMode !== '3d' && (
            <span className="text-xs text-blue-300 flex items-center gap-1 px-2">
              <Loader2 className="h-3 w-3 animate-spin" />
            </span>
          )}

          {/* Retry button */}
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
          {/* Split sync controls */}
          {viewMode === 'split' && (
            <>
              {/* Sync status */}
              <div className="flex items-center gap-1.5 text-xs text-white/70 px-2 py-1 bg-white/10 rounded">
                <span className={`h-2 w-2 rounded-full transition-colors ${
                  syncState.source === 'ivion' ? 'bg-primary' :
                  syncState.source === '3d' ? 'bg-accent-foreground' : 'bg-white/30'
                }`} />
                <span className="hidden sm:inline">
                  {syncState.source === 'ivion' ? '360° → 3D' :
                   syncState.source === '3d' ? '3D → 360°' : 'Väntar...'}
                </span>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setSyncLocked(!syncLocked)}
                    className={`gap-1.5 text-white hover:bg-white/20 ${syncLocked ? 'bg-white/10' : ''}`}
                  >
                    {syncLocked ? <Link2 className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
                    <span className="hidden sm:inline text-xs">{syncLocked ? 'Sync ON' : 'Sync OFF'}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{syncLocked ? 'Klicka för att avsynka' : 'Klicka för att synka'}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 h-8 w-8" onClick={() => setShowManualSyncDialog(true)}>
                    <Upload className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Synka manuellt från URL</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 h-8 w-8" onClick={resetSync}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Återställ synk</TooltipContent>
              </Tooltip>
            </>
          )}

          {/* VT sync status */}
          {viewMode === 'vt' && vtSyncActive && (
            <span className="text-xs text-green-400 bg-green-900/40 px-2 py-0.5 rounded flex items-center gap-1 mr-2">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              Synk aktiv
            </span>
          )}

          {/* Ghost opacity slider (VT mode) */}
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

          {/* Alignment toggle (VT + Split) */}
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

          {/* Fullscreen */}
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 h-8 w-8" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Alignment panel overlay */}
      {showAlignment && (
        <div className="absolute top-14 left-4 z-50">
          <AlignmentPanel
            transform={transform}
            onChange={setTransform}
            buildingFmGuid={buildingData.fmGuid}
            onSaved={() => setShowAlignment(false)}
          />
        </div>
      )}

      {/* Manual sync dialog (split mode) */}
      <Dialog open={showManualSyncDialog} onOpenChange={setShowManualSyncDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Synka från 360°</DialogTitle>
            <DialogDescription>Klistra in en 360°-länk för att synka 3D-vyn.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ol className="list-decimal list-inside text-sm space-y-2 text-muted-foreground">
              <li>I 360°-vyn, klicka på <strong className="text-foreground">Dela</strong>-ikonen</li>
              <li>Kopiera länken</li>
              <li>Klistra in den nedan</li>
            </ol>
            <Input value={manualIvionUrl} onChange={(e) => setManualIvionUrl(e.target.value)} placeholder="https://swg.iv.navvis.com/?site=...&image=..." className="font-mono text-xs" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowManualSyncDialog(false); setManualIvionUrl(''); }}>Avbryt</Button>
            <Button onClick={handleParseManualUrl} disabled={!manualIvionUrl.includes('image=') || isSyncing}>
              {isSyncing ? 'Synkar...' : 'Synka'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
         mode === 'vt' ? 'Virtual Twin — 3D overlay på 360°' :
         'Enbart 360° panorama'}
      </TooltipContent>
    </Tooltip>
  );
}

/** Mobile layout — simplified tab switcher */
function MobileUnifiedViewer({
  buildingData, viewMode, setViewMode, sdkStatus, ivApiRef,
  sdkContainerRef, transform, syncLocked, setSyncLocked,
  handle3DCameraChange, sync3DPosition, sync3DHeading, sync3DPitch,
  hasIvion, onGoBack,
}: {
  buildingData: NonNullable<ReturnType<typeof useBuildingViewerData>['buildingData']>;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  sdkStatus: string;
  ivApiRef: React.MutableRefObject<any>;
  sdkContainerRef: React.RefObject<HTMLDivElement | null>;
  transform: IvionBimTransform;
  syncLocked: boolean;
  setSyncLocked: (v: boolean) => void;
  handle3DCameraChange: (pos: LocalCoords, heading: number, pitch: number) => void;
  sync3DPosition: LocalCoords | null;
  sync3DHeading: number;
  sync3DPitch: number;
  hasIvion: boolean;
  onGoBack: () => void;
}) {
  // On mobile show a simple tab: 3D | 360
  const activePanel = viewMode === '360' || viewMode === 'vt' ? '360' : '3d';

  return (
    <div className="h-screen flex flex-col bg-background">
      <div
        className="flex items-center justify-between px-2 py-2 border-b bg-background/95 backdrop-blur-sm shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
      >
        <Button variant="ghost" size="icon" onClick={onGoBack} className="h-9 w-9">
          <ArrowLeft className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          <Button size="sm" variant={activePanel === '3d' ? 'default' : 'ghost'} className="h-7 px-3 text-xs rounded-md" onClick={() => setViewMode('3d')}>3D</Button>
          {hasIvion && (
            <Button size="sm" variant={activePanel === '360' ? 'default' : 'ghost'} className="h-7 px-3 text-xs rounded-md" onClick={() => setViewMode('360')}>360°</Button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {hasIvion && (
            <Button
              variant={syncLocked ? 'default' : 'outline'}
              size="icon" className="h-8 w-8"
              onClick={() => setSyncLocked(!syncLocked)}
            >
              {syncLocked ? <Link2 className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {activePanel === '3d' ? (
          <AssetPlusViewer
            fmGuid={buildingData.fmGuid}
            syncEnabled={syncLocked}
            onCameraChange={handle3DCameraChange}
            syncPosition={sync3DPosition}
            syncHeading={sync3DHeading}
            syncPitch={sync3DPitch}
          />
        ) : (
          <Ivion360View
            url={buildingData.ivionUrl || undefined}
            syncEnabled={syncLocked}
            buildingOrigin={buildingData.origin}
            buildingFmGuid={buildingData.fmGuid}
            ivionSiteIdProp={buildingData.ivionSiteId || undefined}
            ivionBimTransform={transform}
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
