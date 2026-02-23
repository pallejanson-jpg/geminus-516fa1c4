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
  Box,
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
  VIEW_MODE_2D_TOGGLED_EVENT,
  type ViewModeRequestedDetail,
  type ViewerToolChangedDetail,
  type ViewMode2DToggledDetail,
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
            compact ? 'h-8 w-8' : 'h-7 w-7 sm:h-9 sm:w-9',
            'text-white/90 hover:text-white hover:bg-white/10',
            active && 'ring-2 ring-primary bg-white/15 text-primary',
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
        {disabled ? 'Waiting for viewer…' : label}
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
  const [isXrayActive, setIsXrayActive] = useState(false);

  const toolDebounceRef = useRef(false);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const hiddenFor2dRef = useRef<string[]>([]);
  const colorizedFor2dRef = useRef<Map<string, { colorize: number[] | null; opacity: number; edges: boolean; pickable: boolean; visible: boolean }>>(new Map());
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
      let { floorId, bounds, isAllFloorsVisible, visibleMetaFloorIds } = e.detail;
      const visibleFloorFmGuids = (e.detail as any).visibleFloorFmGuids as string[] | undefined;

      // If no metaScene floorId but we have FM GUIDs, resolve from metaScene
      if (!floorId && visibleFloorFmGuids?.length && !visibleMetaFloorIds?.length) {
        const viewer = getXeokitViewer();
        const metaObjects = viewer?.scene?.metaScene?.metaObjects || {};
        const fmGuidSet = new Set(visibleFloorFmGuids.map((g: string) => g.toLowerCase()));
        for (const mo of Object.values(metaObjects) as any[]) {
          const t = mo.type?.toLowerCase() || '';
          if (t === 'ifcbuildingstorey' && mo.attributes) {
            const fmAttr = mo.attributes?.FmGuid || mo.attributes?.fmGuid || mo.attributes?.fmguid;
            if (fmAttr && fmGuidSet.has(String(fmAttr).toLowerCase())) {
              floorId = mo.id;
              visibleMetaFloorIds = [mo.id];
              break;
            }
          }
        }
      }

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

  // ── External 2D toggle (from UnifiedViewer mode-switcher) ─────────────────
  const pending2dRef = useRef(false);
  useEffect(() => {
    const handler = (e: CustomEvent<ViewMode2DToggledDetail>) => {
      if (e.detail.enabled) {
        // If viewer isn't ready yet, mark as pending and apply when ready
        if (!getXeokitViewer()?.scene) {
          pending2dRef.current = true;
          setViewMode('2d');
        } else {
          handleViewModeChange('2d');
        }
      } else {
        pending2dRef.current = false;
        handleViewModeChange('3d');
      }
    };
    window.addEventListener(VIEW_MODE_2D_TOGGLED_EVENT, handler as EventListener);
    return () => window.removeEventListener(VIEW_MODE_2D_TOGGLED_EVENT, handler as EventListener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Retroactive 2D application when viewer becomes ready ─────────────────
  useEffect(() => {
    if (isViewerReady && pending2dRef.current) {
      pending2dRef.current = false;
      handleViewModeChange('2d');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewerReady]);

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

  // ── X-ray toggle ──────────────────────────────────────────────────────────

  const XRAY_BATCH = 100;
  const handleXrayToggle = useCallback(() => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer?.scene) return;
    const scene = xeokitViewer.scene;
    const objectIds = scene.objectIds || [];
    const enabling = !isXrayActive;
    setIsXrayActive(enabling);

    if (enabling) {
      const xrayMaterial = scene.xrayMaterial;
      if (xrayMaterial) {
        xrayMaterial.fill = true;
        xrayMaterial.fillAlpha = 0.15;
        xrayMaterial.fillColor = [0.55, 0.55, 0.6];
        xrayMaterial.edges = true;
        xrayMaterial.edgeAlpha = 0.35;
        xrayMaterial.edgeColor = [0.4, 0.4, 0.45];
      }
      scene.alphaDepthMask = false;
      const toXray = objectIds.filter((id: string) => {
        const e = scene.objects?.[id];
        if (!e) return false;
        const c = e.colorize;
        return !(c && (c[0] !== 1 || c[1] !== 1 || c[2] !== 1));
      });
      let i = 0;
      const batch = () => {
        const end = Math.min(i + XRAY_BATCH, toXray.length);
        for (; i < end; i++) { const e = scene.objects?.[toXray[i]]; if (e) e.xrayed = true; }
        if (i < toXray.length) requestAnimationFrame(batch);
      };
      requestAnimationFrame(batch);
    } else {
      let i = 0;
      const ids = [...objectIds];
      const off = () => {
        const end = Math.min(i + XRAY_BATCH, ids.length);
        for (; i < end; i++) { const e = scene.objects?.[ids[i]]; if (e) { e.xrayed = false; if (e.opacity < 1) e.opacity = 1; } }
        if (i < ids.length) requestAnimationFrame(off);
      };
      requestAnimationFrame(off);
    }
  }, [getXeokitViewer, isXrayActive]);

  // ── 2D / 3D toggle ───────────────────────────────────────────────────────

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    const viewer = getXeokitViewer();
    if (!viewer) return;

    setViewMode(mode);
    window.dispatchEvent(new CustomEvent(VIEW_MODE_CHANGED_EVENT, { detail: { mode, floorId: currentFloorId } }));

    if (mode === '2d') {
      const scene = viewer.scene;
      const assetViewer = viewerRef.current?.$refs?.AssetViewer;
      const assetView = assetViewer?.$refs?.assetView;
      let targetBounds: number[] | null = null;
      let lookHeight = 0;

      // 1. Use Asset+ built-in floor plan mode (primary method)
      try {
        assetViewer?.setShowFloorplan?.(true);
        console.log('[2D Mode] setShowFloorplan(true) called');
      } catch (e) {
        console.warn('[2D Mode] setShowFloorplan not available:', e);
      }

      // 2. Set ortho top-down nav mode via Asset+ API
      try {
        assetView?.setNavMode?.('planView');
        console.log('[2D Mode] setNavMode("planView") called');
      } catch (e) {
        console.warn('[2D Mode] setNavMode not available:', e);
      }

      // 3. Calculate bounds and apply clipping as backup
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

      // Save original edge material values
      const edgeMat = scene.edgeMaterial;
      const origEdgeColor = edgeMat?.edgeColor ? [...edgeMat.edgeColor] : [0.2, 0.2, 0.2];
      const origEdgeAlpha = edgeMat?.edgeAlpha ?? 0.5;
      const origEdgeWidth = edgeMat?.edgeWidth ?? 1;

      // 4. Handle IFC types for 2D plan view
      const SLAB_TYPES = new Set([
        'ifcslab', 'ifcslabstandardcase', 'ifcslabelementedcase',
        'ifcroof', 'ifccovering', 'ifcplate',
      ]);
      const WALL_TYPES = new Set(['ifcwall', 'ifcwallstandardcase']);
      const SUBDUED_TYPES = new Set(['ifcdoor', 'ifcwindow', 'ifcfurnishingelement', 'ifcrailing', 'ifcstair', 'ifcstairflight']);
      const SPACE_TYPES = new Set(['ifcspace']);
      const metaObjects = scene?.metaScene?.metaObjects || {};
      const colorized = new Map<string, { colorize: number[] | null; opacity: number; edges: boolean; pickable: boolean; visible: boolean }>();
      let slabCount = 0;
      let spaceCount = 0;

      Object.values(metaObjects).forEach((mo: any) => {
        const typeLower = mo.type?.toLowerCase() || '';
        const entity = scene.objects?.[mo.id];
        if (!entity) return;

        if (SLAB_TYPES.has(typeLower)) {
          // Slabs: keep visible=true but unpickable + fully transparent (click passes through)
          colorized.set(mo.id, { colorize: entity.colorize ? [...entity.colorize] : null, opacity: entity.opacity, edges: entity.edges, pickable: entity.pickable !== false, visible: entity.visible });
          entity.visible = true;
          entity.pickable = false;
          entity.opacity = 0;
          entity.edges = false;
          slabCount++;
        } else if (SPACE_TYPES.has(typeLower)) {
          // IfcSpace: make visible + pickable with near-zero opacity as invisible click targets
          colorized.set(mo.id, { colorize: entity.colorize ? [...entity.colorize] : null, opacity: entity.opacity, edges: entity.edges, pickable: entity.pickable !== false, visible: entity.visible });
          entity.visible = true;
          entity.pickable = true;
          entity.opacity = 0.02;
          entity.colorize = [0.5, 0.7, 0.9];
          spaceCount++;
        } else if (WALL_TYPES.has(typeLower)) {
          colorized.set(mo.id, { colorize: entity.colorize ? [...entity.colorize] : null, opacity: entity.opacity, edges: entity.edges, pickable: entity.pickable !== false, visible: entity.visible });
          entity.colorize = [0.2, 0.2, 0.2];
          entity.opacity = 1.0;
          entity.edges = true;
        } else if (SUBDUED_TYPES.has(typeLower)) {
          colorized.set(mo.id, { colorize: entity.colorize ? [...entity.colorize] : null, opacity: entity.opacity, edges: entity.edges, pickable: entity.pickable !== false, visible: entity.visible });
          entity.colorize = [0.75, 0.75, 0.75];
          entity.opacity = 0.6;
        }
      });

      // Apply stronger edge styling for 2D
      if (edgeMat) {
        edgeMat.edgeColor = [0.15, 0.15, 0.15];
        edgeMat.edgeAlpha = 1.0;
        edgeMat.edgeWidth = 2;
      }

      hiddenFor2dRef.current = []; // No longer hiding via setObjectsVisible
      colorizedFor2dRef.current = colorized;
      // Store original edge values for restore
      (viewerRef.current as any).__orig2dEdge = { origEdgeColor, origEdgeAlpha, origEdgeWidth };
      console.log(`[2D Mode] Slabs transparent+unpickable: ${slabCount}, Spaces as click targets: ${spaceCount}, Colorized: ${colorized.size}`);

      // 5. Set camera — preserve current look position for smooth transition
      const camera = viewer.camera;
      if (camera) {
        const lookX = camera.look[0];
        const lookY = camera.look[1];
        const lookZ = camera.look[2];
        const dx = camera.eye[0] - lookX;
        const dy = camera.eye[1] - lookY;
        const dz = camera.eye[2] - lookZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const orthoScale = dist * 1.2;

        camera.projection = 'ortho';
        camera.ortho.scale = orthoScale;
        viewer.cameraFlight.flyTo({
          eye: [lookX, lookY + dist, lookZ],
          look: [lookX, lookY, lookZ],
          up: [0, 0, -1],
          duration: 0.5,
        });
      }
    } else {
      // Back to 3D -- disable Asset+ floor plan mode
      const assetViewer = viewerRef.current?.$refs?.AssetViewer;
      const assetView = assetViewer?.$refs?.assetView;
      try {
        assetViewer?.setShowFloorplan?.(false);
        console.log('[3D Mode] setShowFloorplan(false) called');
      } catch (e) { /* ignore */ }

      // Restore objects hidden for 2D mode
      if (hiddenFor2dRef.current.length > 0) {
        viewer.scene.setObjectsVisible(hiddenFor2dRef.current, true);
        console.log(`[3D Mode] Restored ${hiddenFor2dRef.current.length} hidden IFC objects`);
        hiddenFor2dRef.current = [];
      }

      // Restore colorized entities (including slabs and spaces)
      if (colorizedFor2dRef.current.size > 0) {
        colorizedFor2dRef.current.forEach((orig, id) => {
          const entity = viewer.scene.objects?.[id];
          if (entity) {
            if (orig.colorize) entity.colorize = orig.colorize;
            else entity.colorize = null;
            entity.opacity = orig.opacity;
            entity.edges = orig.edges;
            entity.pickable = orig.pickable;
            entity.visible = orig.visible;
          }
        });
        console.log(`[3D Mode] Restored ${colorizedFor2dRef.current.size} entities (slabs, spaces, walls)`);
        colorizedFor2dRef.current.clear();
      }

      // Restore original edge material
      const origEdge = (viewerRef.current as any)?.__orig2dEdge;
      if (origEdge) {
        const edgeMat = viewer.scene.edgeMaterial;
        if (edgeMat) {
          edgeMat.edgeColor = origEdge.origEdgeColor;
          edgeMat.edgeAlpha = origEdge.origEdgeAlpha;
          edgeMat.edgeWidth = origEdge.origEdgeWidth;
        }
        delete (viewerRef.current as any).__orig2dEdge;
      }

      removeSectionPlane();
      if (currentFloorId) applyCeilingClipping(currentFloorId);

      // Camera sync: preserve look position from 2D
      const camera = viewer.camera;
      if (camera) {
        const lookX = camera.look[0];
        const lookY = camera.look[1];
        const lookZ = camera.look[2];
        const scale = camera.ortho?.scale || 50;
        const dist = scale * 0.8;
        // Place camera at 45° angle above the current look point
        const offset = dist / Math.sqrt(2);

        camera.projection = 'perspective';
        viewer.cameraFlight.flyTo({
          eye: [lookX - offset, lookY + offset, lookZ - offset],
          look: [lookX, lookY, lookZ],
          up: [0, 1, 0],
          duration: 0.5,
        });
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
          'flex items-center gap-0 px-1 py-1 sm:gap-0.5 sm:px-2 sm:py-1.5 rounded-xl',
          'bg-black/80 backdrop-blur-sm border border-white/10 shadow-lg text-white',
          className,
        )}
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 12px) + 24px)' }}
      >
        {/* Group 1 — Navigation mode */}
        <ToolButton
          icon={<RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="Orbit (rotera)"
          onClick={() => handleNavModeChange('orbit')}
          active={navMode === 'orbit'}
          disabled={disabled}
        />
        <ToolButton
          icon={<Move className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="Första person (gå)"
          onClick={() => handleNavModeChange('firstPerson')}
          active={navMode === 'firstPerson'}
          disabled={disabled}
        />

        <Separator orientation="vertical" className="h-4 sm:h-6 mx-0.5 sm:mx-1 bg-white/20" />

        {/* Group 2 — Zoom / Fit */}
        <ToolButton
          icon={<ZoomIn className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="Zooma in"
          onClick={handleZoomIn}
          disabled={disabled}
        />
        <ToolButton
          icon={<ZoomOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="Zooma ut"
          onClick={handleZoomOut}
          disabled={disabled}
        />
        <ToolButton
          icon={<Focus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="Anpassa vy (urval eller hela scenen)"
          onClick={handleViewFit}
          disabled={disabled}
        />

        <Separator orientation="vertical" className="h-4 sm:h-6 mx-0.5 sm:mx-1 bg-white/20" />

        {/* Group 3 — Interaction tools */}
        <ToolButton
          icon={<MousePointer2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="Välj objekt (CTRL för multi-select)"
          onClick={() => handleToolChange('select')}
          active={activeTool === 'select'}
          disabled={disabled}
        />
        <ToolButton
          icon={<Ruler className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="Mätverktyg"
          onClick={() => handleToolChange('measure')}
          active={activeTool === 'measure'}
          disabled={disabled}
        />
        {viewMode !== '2d' && (
          <>
            <ToolButton
              icon={<Scissors className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
              label="Snittplan"
              onClick={() => handleToolChange('slicer')}
              active={activeTool === 'slicer'}
              disabled={disabled}
            />
            {activeTool === 'slicer' && (
              <ToolButton
                icon={<RotateCcw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
                label="Rensa snitt"
                onClick={handleClearSlices}
                disabled={disabled}
              />
            )}
          </>
        )}

        <Separator orientation="vertical" className="h-4 sm:h-6 mx-0.5 sm:mx-1 bg-white/20" />

        {/* Group 4 — X-ray */}
        <ToolButton
          icon={<Box className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="X-ray (genomsiktlig vy)"
          onClick={handleXrayToggle}
          active={isXrayActive}
          disabled={disabled}
        />

        <Separator orientation="vertical" className="h-4 sm:h-6 mx-0.5 sm:mx-1 bg-white/20" />

        {/* Group 5 — View mode */}
        <ToolButton
          icon={viewMode === '3d' ? <SquareDashed className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Cuboid className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
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
