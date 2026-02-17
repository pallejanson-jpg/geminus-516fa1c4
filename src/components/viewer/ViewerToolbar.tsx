import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Focus,
  Ruler,
  Scissors,
  MousePointer2,
  RotateCcw,
  Move,
  Cuboid,
  SquareDashed,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  useSectionPlaneClipping,
  FLOOR_SELECTION_CHANGED_EVENT,
  VIEW_MODE_CHANGED_EVENT,
  CLIP_HEIGHT_CHANGED_EVENT,
  type FloorSelectionEventDetail,
  type ClipHeightEventDetail,
} from '@/hooks/useSectionPlaneClipping';
import {
  VIEW_MODE_REQUESTED_EVENT,
  VIEWER_TOOL_CHANGED_EVENT,
  type ViewModeRequestedDetail,
  type ViewerToolChangedDetail,
} from '@/lib/viewer-events';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewerTool = 'select' | 'measure' | 'slicer' | null;
type NavMode = 'orbit' | 'firstPerson';
type ViewMode = '3d' | '2d';

interface ViewerToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  /** Kept for event compatibility only — no longer shown in toolbar */
  flashOnSelectEnabled?: boolean;
  onToggleFlashOnSelect?: (v: boolean) => void;
  /** Kept for event compatibility only — no longer shown in toolbar */
  hoverHighlightEnabled?: boolean;
  onToggleHoverHighlight?: (v: boolean) => void;
  className?: string;
  /** When true, select tool is not auto-activated (pick-mode navigation) */
  disableSelectTool?: boolean;
}

// ─── ToolButton (defined OUTSIDE render loop — no React warning) ───────────────

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  compact?: boolean;
}

const ToolButton = React.forwardRef<HTMLButtonElement, ToolButtonProps>(
  ({ icon, label, onClick, active = false, disabled = false, compact = false }, ref) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant={active ? 'secondary' : 'ghost'}
          size="icon"
          className={cn(
            compact ? 'h-8 w-8' : 'h-9 w-9',
            active && 'ring-2 ring-primary bg-primary/10 text-primary',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
          onClick={disabled ? undefined : onClick}
          disabled={disabled}
          aria-pressed={active}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {disabled ? 'Väntar på viewer…' : label}
      </TooltipContent>
    </Tooltip>
  ),
);
ToolButton.displayName = 'ToolButton';

// ─── Component ────────────────────────────────────────────────────────────────

const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  viewerRef,
  className,
  disableSelectTool = false,
}) => {
  const [activeTool, setActiveTool] = useState<ViewerTool>(disableSelectTool ? null : 'select');
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [isViewerReady, setIsViewerReady] = useState(false);

  const toolDebounceRef = useRef(false);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);
  const [currentFloorBounds, setCurrentFloorBounds] = useState<{ minY: number; maxY: number } | null>(null);

  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  // ── Section plane clipping hook ───────────────────────────────────────────
  const {
    applyFloorPlanClipping,
    applyGlobalFloorPlanClipping,
    applyCeilingClipping,
    removeSectionPlane,
    remove3DClipping,
    calculateFloorBounds,
    updateFloorCutHeight,
    update3DCeilingOffset,
  } = useSectionPlaneClipping(viewerRef, { enabled: true, clipMode: 'floor', floorCutHeight: 1.2 });

  // ── Viewer accessors ──────────────────────────────────────────────────────

  const getAssetView = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView ?? null;
    } catch { return null; }
  }, [viewerRef]);

  const getXeokitViewer = useCallback(() => {
    try { return getAssetView()?.viewer ?? null; }
    catch { return null; }
  }, [getAssetView]);

  // ── Viewer readiness ──────────────────────────────────────────────────────

  useEffect(() => {
    const check = () => {
      const ready = !!getXeokitViewer()?.scene;
      setIsViewerReady(ready);
      if (!ready) setActiveTool('select');
    };
    check();
    const t1 = setTimeout(check, 200);
    const t2 = setTimeout(check, 500);
    const t3 = setTimeout(check, 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [getXeokitViewer]);

  // ── Floor selection events ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
      const { floorId, bounds, isAllFloorsVisible, visibleMetaFloorIds } = e.detail;
      setCurrentFloorId(floorId);
      setCurrentFloorBounds(bounds || null);

      const isSolo = !isAllFloorsVisible && visibleMetaFloorIds?.length === 1;
      const soloId = isSolo ? (visibleMetaFloorIds![0] || floorId) : null;

      if (viewModeRef.current === '2d') {
        if (floorId) {
          applyFloorPlanClipping(floorId);
        } else {
          const sceneAABB = getXeokitViewer()?.scene?.getAABB?.();
          if (sceneAABB) applyGlobalFloorPlanClipping(sceneAABB[1]);
        }
      } else {
        soloId ? applyCeilingClipping(soloId) : remove3DClipping();
      }
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, [applyFloorPlanClipping, applyGlobalFloorPlanClipping, applyCeilingClipping, remove3DClipping, getXeokitViewer]);

  // ── Clip height events ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: CustomEvent<ClipHeightEventDetail>) => updateFloorCutHeight(e.detail.height);
    window.addEventListener(CLIP_HEIGHT_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(CLIP_HEIGHT_CHANGED_EVENT, handler as EventListener);
  }, [updateFloorCutHeight]);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { offset } = e.detail || {};
      if (typeof offset === 'number') update3DCeilingOffset(offset);
    };
    window.addEventListener('CLIP_HEIGHT_3D_CHANGED', handler as EventListener);
    return () => window.removeEventListener('CLIP_HEIGHT_3D_CHANGED', handler as EventListener);
  }, [update3DCeilingOffset]);

  // ── View mode request events ──────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: CustomEvent<ViewModeRequestedDetail>) => {
      if (e.detail.mode === '2d' || e.detail.mode === '3d') handleViewModeChange(e.detail.mode);
    };
    window.addEventListener(VIEW_MODE_REQUESTED_EVENT, handler as EventListener);
    return () => window.removeEventListener(VIEW_MODE_REQUESTED_EVENT, handler as EventListener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Navigation handlers ───────────────────────────────────────────────────

  const handleZoomIn = useCallback(() => {
    if (!isViewerReady) return;
    const viewer = getXeokitViewer();
    if (!viewer?.cameraFlight) return;
    const { eye, look } = viewer.camera;
    const newEye = eye.map((v: number, i: number) => v + (look[i] - v) * 0.2);
    viewer.cameraFlight.flyTo({ eye: newEye, look, duration: 0.3 });
  }, [getXeokitViewer, isViewerReady]);

  const handleZoomOut = useCallback(() => {
    if (!isViewerReady) return;
    const viewer = getXeokitViewer();
    if (!viewer?.cameraFlight) return;
    const { eye, look } = viewer.camera;
    const newEye = eye.map((v: number, i: number) => v - (look[i] - v) * 0.25);
    viewer.cameraFlight.flyTo({ eye: newEye, look, duration: 0.3 });
  }, [getXeokitViewer, isViewerReady]);

  const handleViewFit = useCallback(() => {
    if (!isViewerReady) return;
    const assetView = viewerRef.current?.assetViewer?.$refs?.assetView
      ?? viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
    if (!assetView) return;
    const selected = assetView.selectedItemIds;
    selected?.length > 0 ? assetView.viewFit(selected, false) : assetView.viewFit(undefined, true);
  }, [viewerRef, isViewerReady]);

  const handleNavModeChange = useCallback((mode: NavMode) => {
    if (!isViewerReady) return;
    const assetView = getAssetView();
    if (assetView) { assetView.setNavMode(mode); setNavMode(mode); }
  }, [getAssetView, isViewerReady]);

  const handleToolChange = useCallback((tool: ViewerTool) => {
    if (!isViewerReady || toolDebounceRef.current) return;
    toolDebounceRef.current = true;
    let newTool: ViewerTool = tool;
    try {
      const assetView = getAssetView();
      if (assetView && typeof assetView.useTool === 'function') {
        try { assetView.useTool(null); } catch { /* ignore */ }
        if (tool === activeTool) {
          assetView.useTool('select');
          newTool = 'select';
        } else {
          assetView.useTool(tool);
          newTool = tool;
        }
        setActiveTool(newTool);
      }
    } catch {
      newTool = 'select';
      setActiveTool('select');
    } finally {
      window.dispatchEvent(new CustomEvent<ViewerToolChangedDetail>(VIEWER_TOOL_CHANGED_EVENT, {
        detail: { tool: newTool! },
      }));
      setTimeout(() => { toolDebounceRef.current = false; }, 150);
    }
  }, [getAssetView, activeTool, isViewerReady]);

  const handleClearSlices = useCallback(() => {
    getAssetView()?.clearSlices?.();
  }, [getAssetView]);

  // ── 2D / 3D toggle ───────────────────────────────────────────────────────

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    const viewer = getXeokitViewer();
    if (!viewer) return;

    setViewMode(mode);
    window.dispatchEvent(new CustomEvent(VIEW_MODE_CHANGED_EVENT, { detail: { mode, floorId: currentFloorId } }));

    if (mode === '2d') {
      const scene = viewer.scene;
      let targetBounds: number[] | null = null;
      let lookHeight = 0;

      if (currentFloorId && currentFloorBounds) {
        const floorBounds = calculateFloorBounds(currentFloorId);
        if (floorBounds) {
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          floorBounds.metaObjectIds.forEach((id: string) => {
            const aabb = scene?.objects?.[id]?.aabb;
            if (aabb) {
              minX = Math.min(minX, aabb[0]); maxX = Math.max(maxX, aabb[3]);
              minZ = Math.min(minZ, aabb[2]); maxZ = Math.max(maxZ, aabb[5]);
            }
          });
          if (minX !== Infinity) targetBounds = [minX, floorBounds.minY, minZ, maxX, floorBounds.maxY, maxZ];
          lookHeight = floorBounds.minY + 1.2;
        }
        applyFloorPlanClipping(currentFloorId);
      } else {
        targetBounds = scene?.getAABB?.();
        lookHeight = targetBounds ? (targetBounds[1] + targetBounds[4]) / 2 : 0;
        if (targetBounds) applyGlobalFloorPlanClipping(targetBounds[1]);
      }

      if (!targetBounds) targetBounds = scene?.getAABB?.();
      if (viewer.camera && targetBounds) {
        const cx = (targetBounds[0] + targetBounds[3]) / 2;
        const cy = lookHeight || (targetBounds[1] + targetBounds[4]) / 2;
        const cz = (targetBounds[2] + targetBounds[5]) / 2;
        const h = Math.max(targetBounds[3] - targetBounds[0], targetBounds[5] - targetBounds[2]) * 1.5;
        viewer.cameraFlight.flyTo({ eye: [cx, cy + h, cz], look: [cx, cy, cz], up: [0, 0, -1], duration: 0.5, orthoScale: h });
        viewer.camera.projection = 'ortho';
      }
    } else {
      removeSectionPlane();
      if (currentFloorId) applyCeilingClipping(currentFloorId);
      if (viewer.camera) {
        viewer.camera.projection = 'perspective';
        const assetView = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
        assetView?.viewFit(undefined, true);
      }
    }
  }, [getXeokitViewer, viewerRef, currentFloorId, currentFloorBounds, calculateFloorBounds, applyFloorPlanClipping, applyGlobalFloorPlanClipping, applyCeilingClipping, removeSectionPlane]);

  // ── Render ────────────────────────────────────────────────────────────────

  const disabled = !isViewerReady;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'absolute bottom-4 left-1/2 -translate-x-1/2 z-20',
          'flex items-center gap-0.5 px-2 py-1.5 rounded-xl',
          'bg-card/95 backdrop-blur-sm border shadow-lg',
          className,
        )}
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 12px) + 24px)' }}
      >
        {/* Group 1 — Navigation mode */}
        <ToolButton
          icon={<RotateCcw className="h-4 w-4" />}
          label="Orbit (rotera)"
          onClick={() => handleNavModeChange('orbit')}
          active={navMode === 'orbit'}
          disabled={disabled}
        />
        <ToolButton
          icon={<Move className="h-4 w-4" />}
          label="Första person (gå)"
          onClick={() => handleNavModeChange('firstPerson')}
          active={navMode === 'firstPerson'}
          disabled={disabled}
        />

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Group 2 — Zoom / Fit */}
        <ToolButton
          icon={<ZoomIn className="h-4 w-4" />}
          label="Zooma in"
          onClick={handleZoomIn}
          disabled={disabled}
        />
        <ToolButton
          icon={<ZoomOut className="h-4 w-4" />}
          label="Zooma ut"
          onClick={handleZoomOut}
          disabled={disabled}
        />
        <ToolButton
          icon={<Focus className="h-4 w-4" />}
          label="Anpassa vy (urval eller hela scenen)"
          onClick={handleViewFit}
          disabled={disabled}
        />

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Group 3 — Interaction tools */}
        <ToolButton
          icon={<MousePointer2 className="h-4 w-4" />}
          label="Välj objekt (CTRL för multi-select)"
          onClick={() => handleToolChange('select')}
          active={activeTool === 'select'}
          disabled={disabled}
        />
        <ToolButton
          icon={<Ruler className="h-4 w-4" />}
          label="Mätverktyg"
          onClick={() => handleToolChange('measure')}
          active={activeTool === 'measure'}
          disabled={disabled}
        />
        <ToolButton
          icon={<Scissors className="h-4 w-4" />}
          label="Snittplan"
          onClick={() => handleToolChange('slicer')}
          active={activeTool === 'slicer'}
          disabled={disabled}
        />
        {activeTool === 'slicer' && (
          <ToolButton
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            label="Rensa snitt"
            onClick={handleClearSlices}
            disabled={disabled}
          />
        )}

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Group 4 — View mode */}
        <ToolButton
          icon={viewMode === '3d' ? <SquareDashed className="h-4 w-4" /> : <Cuboid className="h-4 w-4" />}
          label={viewMode === '3d' ? 'Byt till 2D-vy' : 'Byt till 3D-vy'}
          onClick={() => handleViewModeChange(viewMode === '3d' ? '2d' : '3d')}
          active={viewMode === '2d'}
          disabled={disabled}
        />
      </div>
    </TooltipProvider>
  );
};

export default ViewerToolbar;
