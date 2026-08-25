import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTandemIsolation, SPACE_TYPES } from '@/hooks/useTandemIsolation';
import { useViewerHistory } from '@/hooks/useViewerHistory';
import { RoomIsolationOverlay } from './RoomIsolationOverlay';
import {
  ZoomIn,
  Focus,
  Ruler,
  Scissors,
  MousePointer2,
  RotateCcw,
  RotateCw,
  Move,
  Cuboid,
  SquareDashed,
  Box,
  Settings,
  Eye,
  Crosshair,
  Home,
  Gauge,
  Navigation,
  Bot,
  X,
  Triangle,
  PanelRight,
  GripVertical,
  Camera,
  Undo2,
  Redo2,
  Expand,
  TreeDeciduous,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { applyArchitectColors } from '@/lib/architect-colors';
import { isAModelName } from '@/lib/building-utils';
import GunnarChat, { GunnarContext } from '@/components/chat/GunnarChat';
import { ARCHITECT_BACKGROUND_CHANGED_EVENT } from '@/hooks/useArchitectViewMode';
import {
  useSectionPlaneClipping,
  FLOOR_SELECTION_CHANGED_EVENT,
  VIEW_MODE_CHANGED_EVENT,
  CLIP_HEIGHT_CHANGED_EVENT,
  type FloorSelectionEventDetail,
  type ClipHeightEventDetail,
} from '@/hooks/useSectionPlaneClipping';
import { emit, on } from '@/lib/event-bus';
import {
  VIEW_MODE_REQUESTED_EVENT,
  VIEWER_TOOL_CHANGED_EVENT,
  VIEW_MODE_2D_TOGGLED_EVENT,
  type ViewModeRequestedDetail,
  type ViewerToolChangedDetail,
  type ViewMode2DToggledDetail,
} from '@/lib/viewer-events';
import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewerTool = 'select' | 'measure' | 'angleMeasure' | 'slicer' | null;
type NavMode = 'orbit' | 'firstPerson';
type ViewMode = '3d' | '2d';

interface ViewerToolbarProps {
  viewer: any;
  buildingFmGuid?: string;
  buildingName?: string;
  className?: string;
}

interface ToolDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  group?: string;
}

const STORAGE_KEY = 'viewer-toolbar-tools';

const ALL_TOOLS: ToolDef[] = [
  { id: 'orbit', label: 'Orbit', icon: <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'nav' },
  { id: 'firstPerson', label: 'First person', icon: <Move className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'nav' },
  { id: 'fitView', label: 'Fit view', icon: <Focus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'view' },
  { id: 'resetView', label: 'Reset view', icon: <Home className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'view' },
  { id: 'select', label: 'Select', icon: <MousePointer2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'tool' },
  { id: 'measure', label: 'Measure', icon: <Ruler className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'tool' },
  { id: 'section', label: 'Section', icon: <Scissors className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'tool' },
  // viewMode removed — handled by mode switcher in header
  // Configurable extras
  { id: 'xray', label: 'X-ray', icon: <Box className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'extra' },
  { id: 'onHover', label: 'On hover info', icon: <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'extra' },
  { id: 'zoomIn', label: 'Zoom in', icon: <ZoomIn className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'extra' },
  { id: 'crosshair', label: 'Crosshair', icon: <Crosshair className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'extra' },
  { id: 'navigation', label: 'Indoor navigation', icon: <Navigation className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'extra' },
  { id: 'geminiAi', label: 'Geminus AI', icon: <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'extra' },
  { id: 'screenshot', label: 'Screenshot', icon: <Camera className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'extra' },
  { id: 'explode', label: 'Explode', icon: <Expand className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'extra' },
  { id: 'modelTree', label: 'Modellträd', icon: <TreeDeciduous className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, group: 'extra' },
];

const DEFAULT_ENABLED = ['orbit', 'firstPerson', 'fitView', 'resetView', 'select', 'measure', 'section', 'viewMode', 'geminiAi'];

function getEnabledTools(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return DEFAULT_ENABLED;
}

function saveEnabledTools(tools: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tools));
}

/**
 * Adds procedural door-swing arc geometry to the scene at floor level.
 * Creates a thin SceneModel with quarter-circle arcs (+ door-panel lines) for
 * every visible IfcDoor entity. The overlay is not clippable so it stays visible
 * regardless of the horizontal section plane.
 */
function apply2DDoorSwings(viewer: any, scene: any, metaObjects: any, floorBaseY: number) {
  const sdk = (window as any).__xeokitSdk;
  // Remove any previous overlay
  try { scene.models?.['__2d_door_swings']?.destroy?.(); } catch {}
  if (!sdk?.SceneModel) return;

  const ARC_SEGS = 18;
  const SWING_COLOR = [0.0, 0.55, 0.28]; // FM Access green
  const arcY = floorBaseY + 0.05; // just above floor

  let idx = 0;
  const positions: number[] = [];
  const indices: number[] = [];

  const addArc = (
    cx: number, cz: number,
    radius: number,
    startDeg: number, sweepDeg: number,
  ) => {
    const startRad = (startDeg * Math.PI) / 180;
    const sweepRad = (sweepDeg * Math.PI) / 180;
    // Door panel line: hinge → free end (closed position)
    const p0 = positions.length / 3;
    positions.push(cx, arcY, cz); // hinge
    positions.push(
      cx + Math.cos(startRad) * radius, arcY,
      cz + Math.sin(startRad) * radius,
    );
    indices.push(p0, p0 + 1);
    // Quarter-circle arc
    const a0 = positions.length / 3;
    for (let i = 0; i <= ARC_SEGS; i++) {
      const a = startRad + (i / ARC_SEGS) * sweepRad;
      positions.push(cx + Math.cos(a) * radius, arcY, cz + Math.sin(a) * radius);
    }
    for (let i = 0; i < ARC_SEGS; i++) indices.push(a0 + i, a0 + i + 1);
    idx++;
  };

  for (const mo of Object.values(metaObjects) as any[]) {
    const t = (mo.type || '').toLowerCase();
    if (t !== 'ifcdoor' && t !== 'ifcdoorstandardcase') continue;
    const entity = scene.objects?.[mo.id];
    if (!entity?.visible) continue;
    const aabb = entity.aabb;
    if (!aabb) continue;

    const [minX, , minZ, maxX, , maxZ] = aabb;
    const dx = maxX - minX;
    const dz = maxZ - minZ;

    // IFC places the door origin at the hinge point. entity.worldMatrix column 3
    // = world translation = [m[12], m[13], m[14]]. Comparing the origin to the
    // AABB extremes tells us which end holds the hinge without parsing IFC geometry.
    const wm: Float32Array | null = entity.worldMatrix ?? null;

    if (dx >= dz) {
      const midZ = (minZ + maxZ) / 2;
      const hingeAtMax = wm !== null && Math.abs(wm[12] - maxX) < Math.abs(wm[12] - minX);
      if (hingeAtMax) {
        addArc(maxX, midZ, dx, 180, -90); // hinge at maxX, opens toward +Z
      } else {
        addArc(minX, midZ, dx, 0, 90);   // hinge at minX, opens toward +Z
      }
    } else {
      const midX = (minX + maxX) / 2;
      const hingeAtMax = wm !== null && Math.abs(wm[14] - maxZ) < Math.abs(wm[14] - minZ);
      if (hingeAtMax) {
        addArc(midX, maxZ, dz, -90, 90); // hinge at maxZ, opens toward +X
      } else {
        addArc(midX, minZ, dz, 90, -90); // hinge at minZ, opens toward +X
      }
    }
  }

  if (idx === 0) return; // no doors found

  try {
    const m = new sdk.SceneModel(viewer, {
      id: '__2d_door_swings',
      pickable: false,
      collidable: false,
      clippable: false,
      edges: false,
    });
    m.createGeometry({
      id: 'door-geo',
      primitive: 'lines',
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
    });
    m.createMesh({ id: 'door-mesh', geometryId: 'door-geo', color: SWING_COLOR });
    m.createEntity({ id: 'door-ent', meshIds: ['door-mesh'], pickable: false });
    m.finalize();
  } catch (e) {
    console.warn('[2D] Door swing overlay failed:', e);
  }
}

// ─── ToolButton ───────────────────────────────────────────────────────────────

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

const ToolButton = React.forwardRef<HTMLButtonElement, ToolButtonProps>(
  ({ icon, label, onClick, active = false, disabled = false }, ref) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant={active ? 'secondary' : 'ghost'}
          size="icon"
          className={cn(
            'h-7 w-7 sm:h-9 sm:w-9',
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

const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ viewer, buildingFmGuid, buildingName, className }) => {
  const [activeTool, setActiveTool] = useState<ViewerTool>(null);
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [isXrayActive, setIsXrayActive] = useState(false);
  const [isOnHoverActive, setIsOnHoverActive] = useState(false);
  const [isCrosshairActive, setIsCrosshairActive] = useState(false);
  const [isGunnarOpen, setIsGunnarOpen] = useState(false);
  const [isGunnarDocked, setIsGunnarDocked] = useState(() =>
    localStorage.getItem('viewer-ai-docked') === 'true'
  );
  // Floating drag state
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  const [enabledTools, setEnabledTools] = useState<string[]>(getEnabledTools);
  const [showConfig, setShowConfig] = useState(false);

  // ── Explode tool ─────────────────────────────────────────────────────────
  const [explodeAmount, setExplodeAmount] = useState(0);
  const [isExplodeActive, setIsExplodeActive] = useState(false);
  const explodeBaseOffsetsRef = useRef<Map<string, number[]>>(new Map());

  // ── Undo / redo ───────────────────────────────────────────────────────────
  const getViewerForHistory = useCallback(() => viewer, [viewer]);
  const { push: historyPush, undo: historyUndo, redo: historyRedo, canUndo, canRedo } = useViewerHistory(getViewerForHistory);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!viewer?.scene) return;
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); historyUndo(); }
      if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); historyRedo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, historyUndo, historyRedo]);

  // ── Tandem-style room isolation ───────────────────────────────────────────
  const { isolatedSpaceId, isolatedSpaceIdRef, isolatedSpaceName, backdropLabels, isolate, exit: exitIsolation } = useTandemIsolation();
  const pendingIsolationRef = useRef<string | null>(null);
  const [navSpeed, setNavSpeed] = useState(() => {
    try { return parseInt(localStorage.getItem('viewer-nav-speed') || '100'); } catch { return 100; }
  });

  // Drag handlers for floating AI panel
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (isGunnarDocked) return;
    e.preventDefault();
    const pos = dragPos ?? { x: window.innerWidth - 400, y: window.innerHeight - 600 };
    dragStartRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = ev.clientX - dragStartRef.current.mx;
      const dy = ev.clientY - dragStartRef.current.my;
      setDragPos({
        x: Math.max(0, Math.min(window.innerWidth - 380, dragStartRef.current.px + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 200, dragStartRef.current.py + dy)),
      });
    };
    const onUp = () => {
      dragStartRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isGunnarDocked, dragPos]);

  const toggleDocked = useCallback(() => {
    setIsGunnarDocked(prev => {
      const next = !prev;
      localStorage.setItem('viewer-ai-docked', String(next));
      if (!next) setDragPos(null); // reset to default bottom-right when undocking
      return next;
    });
  }, []);

  // Store initial camera for reset
  const initialCameraRef = useRef<{ eye: number[]; look: number[]; up: number[] } | null>(null);

  const viewModeRef = useRef<ViewMode>(viewMode);
  const colorizedFor2dRef = useRef<Map<string, { offset: number[] | null }>>(new Map());
  // Manual 2D plan rotation (0 = auto-detected, then user can cycle 90° CW per click)
  const plan2dRotationRef = useRef<number>(0); // degrees, 0/90/180/270
  const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);
  const currentFloorIdRef = useRef<string | null>(null); // sync ref — always up-to-date for rAF callbacks
  const [currentFloorBounds, setCurrentFloorBounds] = useState<{ minY: number; maxY: number } | null>(null);

  const viewerShimRef = useRef<any>(null);
  useEffect(() => {
    if (!viewer) return;
    const assetViewShim = { viewer, viewFit: () => {}, setNavMode: () => {}, useTool: () => {}, clearSlices: () => {} };
    viewerShimRef.current = { $refs: { AssetViewer: { $refs: { assetView: assetViewShim } } }, assetViewer: { $refs: { assetView: assetViewShim } } };
  }, [viewer]);

  // Cache door metaObjects once after model load — avoids O(N) full scan on every 2D floor switch.
  // Populated by VIEWER_MODELS_LOADED and reused on subsequent 2D activations.
  const cachedDoorMetaObjectsRef = useRef<any[] | null>(null);
  useEffect(() => {
    const buildDoorCache = () => {
      const meta = viewer?.metaScene?.metaObjects;
      if (!meta) return;
      cachedDoorMetaObjectsRef.current = Object.values(meta).filter((mo: any) => {
        const t = (mo.type || '').toLowerCase();
        return t === 'ifcdoor' || t === 'ifcdoorstandardcase';
      });
    };
    const off = on('VIEWER_MODELS_LOADED', buildDoorCache);
    // Also try immediately in case models are already loaded
    buildDoorCache();
    return off;
  }, [viewer]);

  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  // Capture initial camera state once viewer is ready
  useEffect(() => {
    if (!viewer?.camera || initialCameraRef.current) return;
    // Wait a moment for camera to settle after model load
    const timer = setTimeout(() => {
      if (viewer?.camera) {
        initialCameraRef.current = {
          eye: [...viewer.camera.eye],
          look: [...viewer.camera.look],
          up: [...viewer.camera.up],
        };
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [viewer]);

  const isReady = !!viewer?.scene;
  const isToolEnabled = (id: string) => enabledTools.includes(id);

  // ── Section plane clipping hook ───────────────────────────────────────────
  const {
    applyFloorPlanClipping,
    applyGlobalFloorPlanClipping,
    applyCeilingClipping,
    removeSectionPlane,
    remove2DClipping,
    remove3DClipping,
    calculateFloorBounds,
    updateFloorCutHeight,
    update3DCeilingOffset,
  } = useSectionPlaneClipping(viewerShimRef, { enabled: true, clipMode: 'floor', floorCutHeight: 1.2 });

  // ── Floor selection events ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (detail: FloorSelectionEventDetail) => {
      let { floorId, bounds, isAllFloorsVisible, visibleMetaFloorIds } = detail;
      const visibleFloorFmGuids = (detail as any).visibleFloorFmGuids as string[] | undefined;
      const skipClipping = !!(detail as any).skipClipping;

      if (!floorId && visibleFloorFmGuids?.length && !visibleMetaFloorIds?.length) {
        const metaObjects = viewer?.metaScene?.metaObjects || viewer?.scene?.metaScene?.metaObjects || {};
        const normalizeGuid = (value: string) => value.toLowerCase().replace(/-/g, '');
        const fmGuidSet = new Set(visibleFloorFmGuids.map((g: string) => normalizeGuid(String(g))));

        for (const mo of Object.values(metaObjects) as any[]) {
          const t = mo?.type?.toLowerCase() || '';
          if (t !== 'ifcbuildingstorey') continue;

          const candidates = [
            mo.originalSystemId,
            mo.attributes?.FmGuid,
            mo.attributes?.fmGuid,
            mo.attributes?.fmguid,
            mo.id,
          ]
            .filter(Boolean)
            .map((value) => normalizeGuid(String(value)));

          if (candidates.some((candidate) => fmGuidSet.has(candidate))) {
            floorId = mo.id;
            visibleMetaFloorIds = [mo.id];
            break;
          }
        }
      }

      const resolvedFloorId = visibleMetaFloorIds?.length === 1 ? visibleMetaFloorIds[0] : floorId;

      currentFloorIdRef.current = resolvedFloorId; // sync — available immediately in rAF
      setCurrentFloorId(resolvedFloorId);
      setCurrentFloorBounds(bounds || null);

      // When skipClipping is set (e.g. from FloatingFloorSwitcher which already
      // handles visibility), don't apply additional section-plane clipping.
      if (skipClipping) {
        if (isAllFloorsVisible) {
          requestAnimationFrame(() => { try { remove3DClipping(); } catch {} });
        } else if (resolvedFloorId) {
          // Even when entity visibility is handled externally, still apply clipping:
          // — 2D mode: re-run full entity styling for the new floor
          // — 3D mode: apply ceiling clip so objects above the selected floor are cut
          if (viewModeRef.current === '2d') {
            requestAnimationFrame(() => { handleViewModeChangeRef.current?.('2d'); });
          } else {
            requestAnimationFrame(() => { try { applyCeilingClipping(resolvedFloorId); } catch {} });
          }
        }
        return;
      }

      const isSolo = resolvedFloorId !== null && !isAllFloorsVisible;
      const soloId = isSolo ? resolvedFloorId : null;

      if (viewModeRef.current === '2d') {
        // In 2D mode: re-run full entity isolation for the new floor so that
        // objects from other floors are hidden and styling is re-applied.
        // handleViewModeChangeRef detects isForceReapply when already in 2D.
        requestAnimationFrame(() => { handleViewModeChangeRef.current?.('2d'); });
      } else {
        // In 3D mode: apply ceiling clipping to cut objects that extend above next floor
        if (soloId) {
          requestAnimationFrame(() => { try { applyCeilingClipping(soloId); } catch {} });
        } else {
          requestAnimationFrame(() => { try { remove3DClipping(); } catch {} });
        }
      }
    };
    const off = on('FLOOR_SELECTION_CHANGED', handler);
    return () => off();
  }, [viewer, applyFloorPlanClipping, applyGlobalFloorPlanClipping, applyCeilingClipping, remove3DClipping]);

  // ── Clip height events ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (detail: ClipHeightEventDetail) => updateFloorCutHeight(detail.height);
    const off = on('CLIP_HEIGHT_CHANGED', handler);
    return () => off();
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
  // Keep a ref to the latest handleViewModeChange so event handlers always call the current version
  const handleViewModeChangeRef = useRef<((mode: ViewMode) => void) | null>(null);

  useEffect(() => {
    const handler = (detail: ViewModeRequestedDetail) => {
      if (detail.mode === '2d' || detail.mode === '3d') handleViewModeChangeRef.current?.(detail.mode);
    };
    const off = on('VIEW_MODE_REQUESTED', handler);
    return () => off();
  }, []);

  // ── External 2D toggle ───────────────────────────────────────────────────
  const pending2dRef = useRef(false);
  useEffect(() => {
    const handler = (e: CustomEvent<ViewMode2DToggledDetail>) => {
      if (e.detail.enabled) {
        if (!viewer?.scene) { pending2dRef.current = true; setViewMode('2d'); }
        else handleViewModeChangeRef.current?.('2d');
      } else {
        pending2dRef.current = false;
        handleViewModeChangeRef.current?.('3d');
      }
    };
    window.addEventListener(VIEW_MODE_2D_TOGGLED_EVENT, handler as EventListener);
    return () => window.removeEventListener(VIEW_MODE_2D_TOGGLED_EVENT, handler as EventListener);
  }, [viewer]);

  useEffect(() => {
    if (isReady && pending2dRef.current) {
      pending2dRef.current = false;
      handleViewModeChangeRef.current?.('2d');
    }
  }, [isReady]);

  // ── On-hover highlight logic ─────────────────────────────────────────────
  const onHoverCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isOnHoverActive || !viewer?.scene) {
      onHoverCleanupRef.current?.();
      onHoverCleanupRef.current = null;
      return;
    }

    let lastHighlightedId: string | null = null;
    const scene = viewer.scene;
    const canvas = scene.canvas?.canvas;
    if (!canvas) return;

    const handleMouseMove = (e: MouseEvent) => {
      const pickResult = scene.pick({
        canvasPos: [e.offsetX, e.offsetY],
        pickSurface: false,
      });

      const newId = pickResult?.entity?.id || null;

      if (lastHighlightedId && lastHighlightedId !== newId) {
        const prev = scene.objects?.[lastHighlightedId];
        if (prev) prev.highlighted = false;
      }

      if (newId) {
        const entity = scene.objects?.[newId];
        if (entity) entity.highlighted = true;
      }

      lastHighlightedId = newId;
    };

    canvas.addEventListener('mousemove', handleMouseMove);

    const cleanup = () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      if (lastHighlightedId) {
        const prev = scene.objects?.[lastHighlightedId];
        if (prev) prev.highlighted = false;
      }
    };

    onHoverCleanupRef.current = cleanup;
    return cleanup;
  }, [isOnHoverActive, viewer]);

  // ── Crosshair overlay ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isCrosshairActive || !viewer?.scene) return;

    const canvas = viewer.scene.canvas?.canvas;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const crosshairEl = document.createElement('div');
    crosshairEl.id = 'viewer-crosshair';
    crosshairEl.style.cssText = `
      position: absolute; top: 50%; left: 50%; 
      width: 24px; height: 24px; 
      transform: translate(-50%, -50%);
      pointer-events: none; z-index: 20;
    `;
    crosshairEl.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5">
        <line x1="12" y1="4" x2="12" y2="10" />
        <line x1="12" y1="14" x2="12" y2="20" />
        <line x1="4" y1="12" x2="10" y2="12" />
        <line x1="14" y1="12" x2="20" y2="12" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    `;
    parent.appendChild(crosshairEl);

    return () => {
      crosshairEl.remove();
    };
  }, [isCrosshairActive, viewer]);

  // ── Navigation handlers — direct xeokit API ──────────────────────────────

  const handleRotate2DPlan = useCallback(() => {
    if (!viewer?.camera) return;
    plan2dRotationRef.current = (plan2dRotationRef.current + 90) % 360;
    const d = plan2dRotationRef.current;
    const upVec: [number, number, number] =
      d === 90 ? [1, 0, 0] : d === 180 ? [0, 0, 1] : d === 270 ? [-1, 0, 0] : [0, 0, -1];
    const cam = viewer.camera;
    const eye = [...cam.eye];
    const look = [...cam.look];
    viewer.cameraFlight?.flyTo({ eye, look, up: upVec, duration: 0.3 });
  }, [viewer]);

  const handleZoomIn = useCallback(() => {
    if (!viewer?.cameraFlight) return;
    const { eye, look } = viewer.camera;
    const newEye = eye.map((v: number, i: number) => v + (look[i] - v) * 0.2);
    viewer.cameraFlight.flyTo({ eye: newEye, look, duration: 0.3 });
  }, [viewer]);

  const handleViewFit = useCallback(() => {
    if (!viewer?.cameraFlight) return;
    const selected = viewer.scene?.selectedObjectIds || [];
    if (selected.length > 0) {
      const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      selected.forEach((id: string) => {
        const entity = viewer.scene.objects?.[id];
        if (entity?.aabb) {
          aabb[0] = Math.min(aabb[0], entity.aabb[0]);
          aabb[1] = Math.min(aabb[1], entity.aabb[1]);
          aabb[2] = Math.min(aabb[2], entity.aabb[2]);
          aabb[3] = Math.max(aabb[3], entity.aabb[3]);
          aabb[4] = Math.max(aabb[4], entity.aabb[4]);
          aabb[5] = Math.max(aabb[5], entity.aabb[5]);
        }
      });
      if (aabb[0] !== Infinity) viewer.cameraFlight.flyTo({ aabb, duration: 0.5 });
    } else {
      viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.5 });
    }
  }, [viewer]);

  const handleResetView = useCallback(() => {
    if (!viewer?.cameraFlight) return;
    const scene = viewer.scene;
    // Clear selection
    const selected = scene?.selectedObjectIds || [];
    if (selected.length > 0) scene.setObjectsSelected(selected, false);
    // Clear user-created section planes (NOT floor clipping planes)
    const planes = Object.entries(scene.sectionPlanes || {});
    planes.forEach(([planeId, sp]: [string, any]) => {
      if (planeId.startsWith('3d-ceiling-') || planeId.startsWith('floor-clip-') || planeId.startsWith('2d-')) return;
      try { sp.destroy(); } catch {}
    });
    // Clear measurements
    if (measurePluginRef.current) {
      measurePluginRef.current.clear?.();
    }
    // Reset visibility — use batch API which is faster
    const allIds = scene.objectIds || [];
    if (allIds.length > 0) {
      scene.setObjectsVisible(allIds, true);
      scene.setObjectsXRayed(allIds, false);
      scene.setObjectsPickable(allIds, true);
      scene.setObjectsColorized(allIds, null);
    }
    // Reset alphaDepthMask (xray sets it to false, causing white artifacts)
    scene.alphaDepthMask = true;

    // Re-apply architect colors after batch reset (critical!)
    try { applyArchitectColors(viewer); } catch (e) { logger.warn('[handleResetView] applyArchitectColors failed:', e); }

    // Clear global flags set by insights / visualization systems
    (window as any).__colorFilterActive = false;
    const vizSet = (window as any).__vizColorizedEntityIds;
    if (vizSet instanceof Set) vizSet.clear();

    // Respect current view mode — don't jump to 3D from 2D
    if (viewModeRef.current === '2d') {
      // Re-apply the current floor selection so other-floor objects get re-hidden
      const floorId = currentFloorIdRef.current;
      if (floorId) {
        window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
          detail: { floorId, visibleMetaFloorIds: [floorId], isAllFloorsVisible: false },
        }));
      }
      // Fly to the current floor's AABB (or full scene if no floor selected)
      const floorAABB = floorId ? scene.getAABB?.({ objectIds: Object.keys(scene.objects || {}) }) : scene.getAABB?.();
      if (floorAABB) {
        viewer.cameraFlight.flyTo({ aabb: floorAABB, duration: 0.3 });
      }
    } else {
      // Fly to initial camera IMMEDIATELY (before slow color reapply)
      if (initialCameraRef.current) {
        viewer.cameraFlight.flyTo({
          eye: initialCameraRef.current.eye,
          look: initialCameraRef.current.look,
          up: initialCameraRef.current.up,
          duration: 0.3,
        });
      } else {
        viewer.cameraFlight.flyTo({ aabb: scene.aabb, duration: 0.3 });
      }
      // Remove any 3D clipping only in 3D mode
      try { remove3DClipping(); } catch {}
      // Destroy door swing overlay (2D-only geometry)
      try { scene.models?.['__2d_door_swings']?.destroy?.(); } catch {}
    }

    // Reset x-ray
    setIsXrayActive(false);
    // Restore native model colors (architect palette is opt-in via theme selector)
    requestAnimationFrame(() => {
      const nativeColors = (window as any).__xeokitNativeColors as Map<string, { color: number[]; opacity: number; edges: boolean }> | undefined;
      if (nativeColors) {
        for (const [objId, props] of nativeColors) {
          const entity = viewer.scene.objects?.[objId];
          if (entity) {
            entity.colorize = props.color;
            entity.opacity = props.opacity;
          }
        }
      }
    });
    // Re-apply modifications (deleted/moved objects) so they stay deleted
    requestAnimationFrame(() => {
      emit('REAPPLY_MODIFICATIONS');
    });
  }, [viewer, remove3DClipping, remove2DClipping]);

  const handleNavModeChange = useCallback((mode: NavMode) => {
    if (!viewer?.cameraControl) return;
    // Never allow orbit/firstPerson in 2D plan view
    if (viewModeRef.current === '2d') return;
    if (mode === 'firstPerson') {
      viewer.cameraControl.navMode = 'firstPerson';
      viewer.cameraControl.followPointer = true;
      viewer.cameraControl.constrainVertical = true;
    } else {
      viewer.cameraControl.navMode = 'orbit';
      viewer.cameraControl.followPointer = true;
      viewer.cameraControl.constrainVertical = false;
    }
    setNavMode(mode);
  }, [viewer]);

  // ── Measure & Section plugin refs ──────────────────────────────────────
  const measurePluginRef = useRef<any>(null);
  const angleMeasurePluginRef = useRef<any>(null);
  const sectionPluginRef = useRef<any>(null);

  const activateMeasure = useCallback(() => {
    if (!viewer?.scene) return;
    const sdk = (window as any).__xeokitSdk;
    if (!sdk?.DistanceMeasurementsPlugin) { logger.warn('[ViewerToolbar] DistanceMeasurementsPlugin not in SDK'); return; }
    if (!measurePluginRef.current) {
      measurePluginRef.current = new sdk.DistanceMeasurementsPlugin(viewer, {
        defaultVisible: true,
        defaultAxisVisible: true,
        defaultLabelsVisible: true,
      });
    }
    angleMeasurePluginRef.current?.control?.deactivate?.();
    measurePluginRef.current.control?.activate?.();
  }, [viewer]);

  const deactivateMeasure = useCallback(() => {
    measurePluginRef.current?.control?.deactivate?.();
  }, []);

  const clearMeasurements = useCallback(() => {
    if (measurePluginRef.current) {
      measurePluginRef.current.clear?.();
      logger.log('[ViewerToolbar] Measurements cleared');
    }
  }, []);

  const activateAngleMeasure = useCallback(() => {
    if (!viewer?.scene) return;
    const sdk = (window as any).__xeokitSdk;
    if (!sdk?.AngleMeasurementsPlugin) { logger.warn('[ViewerToolbar] AngleMeasurementsPlugin not in SDK'); return; }
    if (!angleMeasurePluginRef.current) {
      angleMeasurePluginRef.current = new sdk.AngleMeasurementsPlugin(viewer, {
        defaultVisible: true,
        defaultLabelsVisible: true,
      });
    }
    measurePluginRef.current?.control?.deactivate?.();
    angleMeasurePluginRef.current.control?.activate?.();
  }, [viewer]);

  const deactivateAngleMeasure = useCallback(() => {
    angleMeasurePluginRef.current?.control?.deactivate?.();
  }, []);

  const clearAngleMeasurements = useCallback(() => {
    angleMeasurePluginRef.current?.clear?.();
  }, []);

  const activateSection = useCallback(() => {
    if (!viewer?.scene) return;
    const sdk = (window as any).__xeokitSdk;
    if (!sdk?.SectionPlanesPlugin) { logger.warn('[ViewerToolbar] SectionPlanesPlugin not in SDK'); return; }
    if (!sectionPluginRef.current) {
      sectionPluginRef.current = new sdk.SectionPlanesPlugin(viewer, {
        overviewVisible: true,
      });
    }
    // Set up a click handler on the canvas to create section planes with interactive gizmo
    const canvas = viewer.scene?.canvas?.canvas;
    if (canvas) {
      const clickHandler = (e: MouseEvent) => {
        const pickResult = viewer.scene.pick({
          canvasPos: [e.offsetX, e.offsetY],
          pickSurface: true,
        });
        if (pickResult?.worldPos && pickResult?.worldNormal) {
          // Negate worldNormal: the pick normal points outward from the surface,
          // but xeokit dir points toward the DISCARDED half-space.
          // We want to cut away the side the user clicked on (visible side),
          // so we negate the normal to discard inward from the click point.
          const n = pickResult.worldNormal;
          const negDir = [-n[0], -n[1], -n[2]];
          const sectionPlane = sectionPluginRef.current?.createSectionPlane?.({
            pos: pickResult.worldPos,
            dir: negDir,
          });
          // Show interactive drag gizmo/control for the created plane
          if (sectionPlane && sectionPluginRef.current?.showControl) {
            sectionPluginRef.current.showControl(sectionPlane.id);
            logger.log('[ViewerToolbar] Section plane created with interactive control');
          }
          // Remove click handler after first plane - user can reposition via gizmo
          canvas.removeEventListener('click', clickHandler);
          delete (sectionPluginRef.current as any).__manualClickHandler;
        }
      };
      canvas.addEventListener('click', clickHandler);
      (sectionPluginRef.current as any).__manualClickHandler = clickHandler;
      (sectionPluginRef.current as any).__canvas = canvas;
    }
  }, [viewer]);

  const deactivateSection = useCallback(() => {
    if (sectionPluginRef.current?.control?.deactivate) {
      sectionPluginRef.current.control.deactivate();
    }
    // Clean up manual click handler if used
    const handler = (sectionPluginRef.current as any)?.__manualClickHandler;
    const canvas = (sectionPluginRef.current as any)?.__canvas;
    if (handler && canvas) {
      canvas.removeEventListener('click', handler);
      delete (sectionPluginRef.current as any).__manualClickHandler;
      delete (sectionPluginRef.current as any).__canvas;
    }
  }, []);

  // Track whether we dispatched the event to avoid re-entrant handling
  const selfDispatchRef = useRef(false);

  const handleToolChange = useCallback((tool: ViewerTool) => {
    const newTool = tool === activeTool ? null : tool;

    // Deactivate previous tool plugins
    if (activeTool === 'measure') deactivateMeasure();
    if (activeTool === 'angleMeasure') deactivateAngleMeasure();
    if (activeTool === 'slicer') deactivateSection();

    // Activate new tool plugins
    if (newTool === 'measure') activateMeasure();
    if (newTool === 'angleMeasure') activateAngleMeasure();
    if (newTool === 'slicer') activateSection();

    setActiveTool(newTool);
    selfDispatchRef.current = true;
    window.dispatchEvent(new CustomEvent<ViewerToolChangedDetail>(VIEWER_TOOL_CHANGED_EVENT, {
      detail: { tool: newTool },
    }));
    selfDispatchRef.current = false;
  }, [activeTool, activateMeasure, deactivateMeasure, activateAngleMeasure, deactivateAngleMeasure, activateSection, deactivateSection]);

  // Ref to track activeTool without stale closures in the external listener
  const activeToolRef2 = useRef<ViewerTool>(activeTool);
  activeToolRef2.current = activeTool;

  // Listen for external tool changes (e.g. from MobileViewerPage / navigation menu)
  useEffect(() => {
    const handler = (detail: ViewerToolChangedDetail) => {
      // Skip events we dispatched ourselves
      if (selfDispatchRef.current) return;

      const tool = detail.tool as ViewerTool;
      const prev = activeToolRef2.current;

      // Deactivate previous
      if (prev === 'measure') deactivateMeasure();
      if (prev === 'angleMeasure') deactivateAngleMeasure();
      if (prev === 'slicer') deactivateSection();

      // Activate new
      if (tool === 'measure') activateMeasure();
      if (tool === 'angleMeasure') activateAngleMeasure();
      if (tool === 'slicer') activateSection();

      setActiveTool(tool);
    };
    const off = on('VIEWER_TOOL_CHANGED', handler);
    return () => off();
  }, [activateMeasure, deactivateMeasure, activateAngleMeasure, deactivateAngleMeasure, activateSection, deactivateSection]);

  // ── Tandem isolation: apply pending isolation when 3D mode is active ───────
  useEffect(() => {
    if (viewMode === '3d' && pendingIsolationRef.current && viewer) {
      const spaceId = pendingIsolationRef.current;
      pendingIsolationRef.current = null;
      // Small delay to let 3D color restoration complete before isolation styling
      const t = setTimeout(() => { isolate(spaceId, viewer); }, 400);
      return () => clearTimeout(t);
    }
  }, [viewMode, viewer, isolate]);

  // ── Tandem isolation: click listener ──────────────────────────────────────
  useEffect(() => {
    if (!viewer?.scene?.input) return;
    const subId = viewer.scene.input.on('mouseclicked', (coords: number[]) => {
      const vMode = viewModeRef.current;
      const isIsolated = isolatedSpaceIdRef.current !== null;

      let hit: any = null;
      try { hit = viewer.scene.pick({ canvasPos: coords, pickSurface: false }); } catch {}

      if (isIsolated) {
        if (!hit?.entity) {
          // Click on empty → exit isolation
          exitIsolation(viewer);
          return;
        }
        const mo = viewer.metaScene?.metaObjects?.[hit.entity.id];
        const t = (mo?.type || '').toLowerCase();
        if (SPACE_TYPES.has(t) && hit.entity.id !== isolatedSpaceIdRef.current) {
          isolate(hit.entity.id, viewer);
        }
      } else if (vMode === '2d') {
        if (!hit?.entity) return;
        const mo = viewer.metaScene?.metaObjects?.[hit.entity.id];
        const t = (mo?.type || '').toLowerCase();
        if (SPACE_TYPES.has(t)) {
          pendingIsolationRef.current = hit.entity.id;
          handleViewModeChangeRef.current?.('3d');
        }
      }
    });
    return () => {
      try { viewer.scene.input.off(subId); } catch {}
    };
  }, [viewer, isolate, exitIsolation]);

  const handleClearSlices = useCallback(() => {
    if (!viewer?.scene) return;
    // Destroy all section planes
    const planes = Object.values(viewer.scene.sectionPlanes || {});
    planes.forEach((sp: any) => { try { sp.destroy(); } catch {} });
    // Hide control gizmo if shown
    if (sectionPluginRef.current?.hideControl) {
      sectionPluginRef.current.hideControl();
    }
  }, [viewer]);

  // ── Explode handler ─────────────────────────────────────────────────────
  const handleExplodeChange = useCallback((amount: number) => {
    if (!viewer?.scene || viewModeRef.current === '2d') return;
    const scene = viewer.scene;
    setExplodeAmount(amount);

    if (amount === 0) {
      // Restore saved base offsets
      for (const [id, base] of explodeBaseOffsetsRef.current) {
        const e = scene.objects?.[id];
        if (e) try { e.offset = base; } catch {}
      }
      explodeBaseOffsetsRef.current.clear();
      return;
    }

    const sceneAABB = scene.aabb;
    if (!sceneAABB) return;
    const cx = (sceneAABB[0] + sceneAABB[3]) / 2;
    const cy = (sceneAABB[1] + sceneAABB[4]) / 2;
    const cz = (sceneAABB[2] + sceneAABB[5]) / 2;
    const maxDist = amount / 100 * 12; // up to 12 m at full explode

    const objects = scene.objects || {};
    for (const [id, entity] of Object.entries(objects) as [string, any][]) {
      if (!entity?.aabb) continue;
      // Save base offset once
      if (!explodeBaseOffsetsRef.current.has(id)) {
        explodeBaseOffsetsRef.current.set(id, entity.offset ? [...entity.offset] : [0, 0, 0]);
      }
      const base = explodeBaseOffsetsRef.current.get(id)!;
      const ex = (entity.aabb[0] + entity.aabb[3]) / 2;
      const ey = (entity.aabb[1] + entity.aabb[4]) / 2;
      const ez = (entity.aabb[2] + entity.aabb[5]) / 2;
      const dx = ex - cx;
      const dy = ey - cy;
      const dz = ez - cz;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      try {
        entity.offset = [
          base[0] + (dx / len) * maxDist,
          base[1] + (dy / len) * maxDist,
          base[2] + (dz / len) * maxDist,
        ];
      } catch {}
    }
  }, [viewer]);

  const toggleExplode = useCallback(() => {
    setIsExplodeActive(prev => {
      if (prev) {
        // Deactivate: reset offsets
        handleExplodeChange(0);
        setExplodeAmount(0);
      }
      return !prev;
    });
  }, [handleExplodeChange]);

  // ── X-ray toggle ─────────────────────────────────────────────────────────
  const XRAY_BATCH = 100;
  const handleXrayToggle = useCallback(() => {
    if (!viewer?.scene) return;
    historyPush();
    const scene = viewer.scene;
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
  }, [viewer, isXrayActive]);

  // ── 2D / 3D toggle ───────────────────────────────────────────────────────

  // Guard ref to prevent re-entrant 2D transitions
  const mode2dTransitionRef = useRef(false);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (!viewer?.scene) {
      logger.warn('[ViewerToolbar] handleViewModeChange: viewer not ready, skipping');
      return;
    }
    // Force reapply: if already in 2D mode and requesting 2D, re-run clipping
    const isForceReapply = mode === '2d' && viewModeRef.current === '2d';
    // Idempotency: skip if already in target mode (unless force reapply)
    if (mode === viewModeRef.current && !isForceReapply) return;
    // Prevent overlapping 2D transitions
    if (mode === '2d' && mode2dTransitionRef.current && !isForceReapply) return;
    const scene = viewer.scene;

    // Exit room isolation on any explicit mode change (not when we're switching modes to enter isolation)
    if (isolatedSpaceIdRef.current && !pendingIsolationRef.current) {
      exitIsolation(viewer, { restoreCamera: false });
    }

    setViewMode(mode);
    if (mode === '2d') mode2dTransitionRef.current = true;
    emit('VIEW_MODE_CHANGED', { mode, floorId: currentFloorId });

    if (mode === '2d') {
      // ── Interactive pure 2D: live scene viewed top-down orthographic ──
      // Unlike split-screen's snapshot-based 2D (navigation aid only), pure 2D
      // keeps the real scene interactive: objects are pickable, the right-side
      // visualization menu / colorizing / properties all keep working.
      const canvas = scene.canvas?.canvas as HTMLCanvasElement | undefined;
      const revealCanvas = () => {
        if (!canvas) return;
        canvas.style.transition = 'opacity 0.25s ease-in';
        canvas.style.opacity = '1';
      };

      try {
        // Hide canvas to avoid 3D flash — skip on force-reapply to prevent flicker
        if (canvas && !isForceReapply) canvas.style.opacity = '0';

        // Set white background FIRST
        emit('ARCHITECT_BACKGROUND_CHANGED', { presetId: 'white' });

        // Use the ref for floor ID — it updates synchronously while React state is async
        let targetFloorId = currentFloorIdRef.current ?? currentFloorId;

        if (!targetFloorId) {
          try {
            const lastFloor = sessionStorage.getItem('viewer_last_floor_id');
            if (lastFloor) targetFloorId = lastFloor;
          } catch {}
        }

        if (!targetFloorId) {
          const metaObjects2 = viewer?.metaScene?.metaObjects || {};
          const storeys = (Object.values(metaObjects2) as any[])
            .filter((mo: any) => mo?.type?.toLowerCase() === 'ifcbuildingstorey')
            .map((mo: any) => {
              const bounds = calculateFloorBounds(mo.id);
              return bounds ? { id: mo.id, minY: bounds.minY } : null;
            })
            .filter(Boolean) as Array<{ id: string; minY: number }>;

          if (storeys.length > 0) {
            storeys.sort((a, b) => a.minY - b.minY);
            targetFloorId = storeys[0].id;
          }
        }

        // Force-disable X-ray in strict 2D plan mode
        const allIds = scene.objectIds || [];
        if (allIds.length > 0) {
          scene.setObjectsXRayed(allIds, false);
        }
        scene.alphaDepthMask = true;
        setIsXrayActive(false);

        // Auto-activate select tool in 2D so objects are immediately pickable
        if (activeTool !== 'select') {
          handleToolChange('select');
        }

        // Remove any existing 3D ceiling clipping first
        try { remove3DClipping(); } catch {}

        if (targetFloorId) {
          applyFloorPlanClipping(targetFloorId);

          // Always dispatch — keeps FloatingFloorSwitcher synced to the solo floor
          {
            const floorMeta = viewer?.metaScene?.metaObjects?.[targetFloorId];
            const floorFmGuid =
              floorMeta?.originalSystemId ||
              floorMeta?.attributes?.FmGuid ||
              floorMeta?.attributes?.fmGuid ||
              floorMeta?.attributes?.fmguid ||
              targetFloorId;

            currentFloorIdRef.current = targetFloorId;
            setCurrentFloorId(targetFloorId);
            window.dispatchEvent(new CustomEvent<FloorSelectionEventDetail>(FLOOR_SELECTION_CHANGED_EVENT, {
              detail: {
                floorId: targetFloorId,
                floorName: floorMeta?.name || null,
                bounds: calculateFloorBounds(targetFloorId) || null,
                visibleMetaFloorIds: [targetFloorId],
                visibleFloorFmGuids: [String(floorFmGuid)],
                isAllFloorsVisible: false,
                isSoloFloor: true,
                skipClipping: true, // clipping already applied above
              },
            }));
          }
        } else {
          const sceneAABB = scene.getAABB?.();
          if (sceneAABB) applyGlobalFloorPlanClipping(sceneAABB[1]);
        }

        const edgeMat = scene.edgeMaterial;
        const origEdgeColor = edgeMat?.edgeColor ? [...edgeMat.edgeColor] : [0.2, 0.2, 0.2];
        const origEdgeAlpha = edgeMat?.edgeAlpha ?? 0.5;
        const origEdgeWidth = edgeMat?.edgeWidth ?? 1;

        // Pure 2D: architectural floor plan — walls, spaces, doors/windows, stairs, room fixtures.
        // MEP ducts/pipes/cables stay hidden (clutter with no spatial meaning in plan view).
        const SPACE_TYPES = new Set(['ifcspace']);
        const WALL_TYPES = new Set(['ifcwall', 'ifcwallstandardcase', 'ifccurtainwall']);
        const DOOR_WINDOW_TYPES = new Set([
          'ifcdoor', 'ifcwindow', 'ifcdoorstandardcase', 'ifcwindowstandardcase',
          'ifcdoorpanel', 'ifcwindowpanel',
        ]);
        const STAIR_TYPES = new Set(['ifcstair', 'ifcstairflight', 'ifcrailing']);
        // Room fixtures: visible and pickable — sanitaryware, furniture, equipment
        const FIXTURE_TYPES = new Set([
          'ifcfurnishingelement', 'ifcfurniture', 'ifcsanitaryterminal', 'ifcwasteterminal',
          'ifcinterceptor', 'ifcflowterminal', 'ifcelectricappliance', 'ifcswitchingdevice',
          'ifcoutlet', 'ifclightfixture', 'ifcairterminal', 'ifcbuildingelementproxy',
          'ifcbeam', 'ifcbeamstandardcase', 'ifccolumn', 'ifccolumnstandardcase',
        ]);
        const MEP_TYPES = new Set([
          'ifcpipesegment', 'ifcpipefitting', 'ifcpipeconnection', 'ifcvalve',
          'ifcductsegment', 'ifcductfitting', 'ifcductsilencer', 'ifcairterminalbox',
          'ifccablesegment', 'ifccablecarriersegment', 'ifccablecarrierfitting',
          'ifcpump', 'ifccompressor', 'ifcstoragetank', 'ifcfilter', 'ifcchiller',
          'ifccoolingtower', 'ifcboiler', 'ifcheatexchanger', 'ifccoil', 'ifchumidifier',
          'ifcunitaryequipment', 'ifcelectricgenerator', 'ifcelectricmotor',
          'ifcdistributionboard', 'ifcelectricdistributionboard', 'ifctransformer',
          'ifcprotectivedevice', 'ifcjunctionbox', 'ifcmotorconnection',
          'ifccommunicationsappliance', 'ifcaudiovisualappliance',
          'ifctendon', 'ifctendonanchor', 'ifcreinforcingbar', 'ifcreinforcingmesh',
          'ifcmember', 'ifcmemberstandardcase',
          'ifcslab', 'ifcslabstandardcase', 'ifcslabelementedcase',
          'ifcplate', 'ifcplatestandardcase', 'ifcroof', 'ifccovering',
        ]);
        const metaObjects = viewer?.metaScene?.metaObjects || scene?.metaScene?.metaObjects || {};

        // Build set of entity IDs that belong to A-models only.
        // In 2D plan view we show only the architectural model — MEP, fire, structural
        // secondary models should be completely invisible (they add clutter and wrong geometry).
        const aModelEntityIds = new Set<string>();
        const sceneModels = scene.models || {};
        let hasAnyAModel = false;
        Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
          if (isAModelName(modelId)) {
            hasAnyAModel = true;
            const objs = model.objects || {};
            for (const id of Object.keys(objs)) aModelEntityIds.add(id);
          }
        });
        // If no model was identified as A-model (e.g. all models have UUID names),
        // fall back to showing all models so the plan isn't blank.
        const enforceAModelFilter = hasAnyAModel;

        // On force-reapply (floor switch while already in 2D): restore Y-offsets from
        // the previous 2D pass (spaces were lowered) then do a full batch reset so
        // 2D styling always starts from a clean baseline. Storing only offsets avoids
        // accumulated drift when colorize/opacity/visibility were saved from an already-
        // 2D-styled state.
        if (colorizedFor2dRef.current.size > 0) {
          colorizedFor2dRef.current.forEach((orig, id) => {
            if (orig.offset === null) return;
            const entity = scene.objects?.[id];
            if (entity) { try { entity.offset = orig.offset; } catch {} }
          });
          colorizedFor2dRef.current.clear();
        }
        {
          const resetIds = scene.objectIds || [];
          if (resetIds.length > 0) {
            scene.setObjectsVisible(resetIds, true);
            scene.setObjectsColorized(resetIds, null);
            scene.setObjectsOpacity(resetIds, 1);
            scene.setObjectsEdges(resetIds, false);
            scene.setObjectsPickable(resetIds, true);
          }
        }

        const colorized = new Map<string, { offset: number[] | null }>();

        // Build storey descendant set to scope 2D styling to the selected floor
        const storeyDescendants = new Set<string>();
        if (targetFloorId) {
          const storeyMeta = metaObjects[targetFloorId];
          if (storeyMeta) {
            const stack = [...(storeyMeta.children || [])];
            while (stack.length > 0) {
              const node = stack.pop();
              if (!node) continue;
              storeyDescendants.add(node.id);
              if (node.children?.length) stack.push(...node.children);
            }
          }
        }

        // Fallback: some models have empty storey.children — traverse each entity's
        // parent chain upward to its IfcBuildingStorey instead. Without this, floor
        // switching in 2D appears dead (all floors stay visible, stacked on top of
        // each other).
        if (storeyDescendants.size === 0 && targetFloorId) {
          Object.values(metaObjects).forEach((mo: any) => {
            if (!mo?.id || mo.id === targetFloorId) return;
            let cur: any = mo.parent;
            let depth = 0;
            while (cur && depth < 100) {
              if (cur.id === targetFloorId) { storeyDescendants.add(mo.id); break; }
              cur = cur.parent;
              depth++;
            }
          });
          logger.log(`[2D] storey.children empty — parent-chain fallback found ${storeyDescendants.size} entities for floor ${targetFloorId}`);
        }

        // ── Single bucketing pass — O(n) read, then batch GPU writes ─────────
        // Replacing the old per-entity property-set loop (which caused 20k+ individual
        // dirty-flag invalidations). We bucket by render role, then call xeokit batch
        // APIs once per bucket. Only Y-offsets (no batch API in xeokit) still loop,
        // but only over the small space/fixture subsets.
        const hideIds: string[] = [];
        const spaceIdsArr: string[] = [];
        const wallIdsArr: string[] = [];
        const doorWinIdsArr: string[] = [];
        const stairIdsArr: string[] = [];
        const fixtureIdsArr: string[] = [];

        const FLOOR_PASS_TYPES = new Set(['ifcbuildingstorey', 'ifcbuilding', 'ifcsite', 'ifcproject']);

        for (const mo of Object.values(metaObjects) as any[]) {
          const id = mo.id as string;
          const entity = scene.objects?.[id];
          if (!entity) continue;

          const typeLower = (mo.type || '').toLowerCase();
          colorized.set(id, { offset: entity.offset ? [...entity.offset] : null });

          if (enforceAModelFilter && !aModelEntityIds.has(id)) {
            hideIds.push(id); continue;
          }
          if (storeyDescendants.size > 0 && !storeyDescendants.has(id) && !FLOOR_PASS_TYPES.has(typeLower)) {
            hideIds.push(id); continue;
          }

          if (SPACE_TYPES.has(typeLower)) spaceIdsArr.push(id);
          else if (WALL_TYPES.has(typeLower)) wallIdsArr.push(id);
          else if (DOOR_WINDOW_TYPES.has(typeLower)) doorWinIdsArr.push(id);
          else if (STAIR_TYPES.has(typeLower)) stairIdsArr.push(id);
          else if (FIXTURE_TYPES.has(typeLower)) fixtureIdsArr.push(id);
          else hideIds.push(id);
        }

        const visibleCount = spaceIdsArr.length + wallIdsArr.length + doorWinIdsArr.length + stairIdsArr.length + fixtureIdsArr.length;

        // Batch GPU writes — one call per property per bucket
        if (hideIds.length > 0) {
          scene.setObjectsVisible(hideIds, false);
          scene.setObjectsPickable(hideIds, false);
        }
        if (spaceIdsArr.length > 0) {
          scene.setObjectsVisible(spaceIdsArr, true);
          scene.setObjectsPickable(spaceIdsArr, true);
          scene.setObjectsColorized(spaceIdsArr, [0.75, 0.88, 0.97]);
          scene.setObjectsOpacity(spaceIdsArr, 0.12);
          scene.setObjectsEdges(spaceIdsArr, false);
        }
        if (wallIdsArr.length > 0) {
          scene.setObjectsVisible(wallIdsArr, true);
          scene.setObjectsPickable(wallIdsArr, false);
          scene.setObjectsColorized(wallIdsArr, [0.15, 0.15, 0.15]);
          scene.setObjectsOpacity(wallIdsArr, 1);
          scene.setObjectsEdges(wallIdsArr, false);
        }
        if (doorWinIdsArr.length > 0) {
          scene.setObjectsVisible(doorWinIdsArr, true);
          scene.setObjectsPickable(doorWinIdsArr, true);
          scene.setObjectsColorized(doorWinIdsArr, [0.1, 0.1, 0.1]);
          scene.setObjectsOpacity(doorWinIdsArr, 1);
          scene.setObjectsEdges(doorWinIdsArr, true);
        }
        if (stairIdsArr.length > 0) {
          scene.setObjectsVisible(stairIdsArr, true);
          scene.setObjectsPickable(stairIdsArr, false);
          scene.setObjectsColorized(stairIdsArr, [0.35, 0.35, 0.35]);
          scene.setObjectsOpacity(stairIdsArr, 1);
          scene.setObjectsEdges(stairIdsArr, true);
        }
        if (fixtureIdsArr.length > 0) {
          scene.setObjectsVisible(fixtureIdsArr, true);
          scene.setObjectsPickable(fixtureIdsArr, true);
          scene.setObjectsColorized(fixtureIdsArr, [0.25, 0.25, 0.25]);
          scene.setObjectsOpacity(fixtureIdsArr, 1);
          scene.setObjectsEdges(fixtureIdsArr, true);
        }

        // Y-offset: xeokit has no batch API for offset — loop only small subsets
        for (const id of spaceIdsArr) {
          const e = scene.objects?.[id];
          if (!e) continue;
          try { const o = e.offset ? [...e.offset] : [0, 0, 0]; e.offset = [o[0], o[1] - 0.5, o[2]]; } catch {}
        }
        for (const id of fixtureIdsArr) {
          const e = scene.objects?.[id];
          if (!e) continue;
          try { const o = e.offset ? [...e.offset] : [0, 0, 0]; e.offset = [o[0], o[1] + 0.3, o[2]]; } catch {}
        }

        // Safety: if no objects are visible after 2D styling, rollback by restoring offsets
        // and resetting the scene to its 3D state
        if (visibleCount === 0) {
          logger.warn('[ViewerToolbar] 2D mode: 0 visible objects after styling — rolling back');
          colorized.forEach((orig, id) => {
            const entity = scene.objects?.[id];
            if (entity && orig.offset !== null) {
              try { entity.offset = orig.offset; } catch {}
            }
          });
          colorized.clear();
          const rbIds = scene.objectIds || [];
          if (rbIds.length > 0) {
            scene.setObjectsVisible(rbIds, true);
            scene.setObjectsColorized(rbIds, null);
            scene.setObjectsOpacity(rbIds, 1);
          }
        }

        if (edgeMat) { edgeMat.edgeColor = [0.15, 0.15, 0.15]; edgeMat.edgeAlpha = 1.0; edgeMat.edgeWidth = 2; }
        colorizedFor2dRef.current = colorized;

        // Door swing arcs — procedural SceneModel geometry at floor level.
        // Use cached door list (built once at model load) — avoids O(N) full scan each time.
        const floorBoundsForSwing = targetFloorId ? calculateFloorBounds(targetFloorId) : null;
        const floorBaseY = floorBoundsForSwing?.minY ?? 0;
        const doorMeta = cachedDoorMetaObjectsRef.current
          ? Object.fromEntries(cachedDoorMetaObjectsRef.current.map((mo: any) => [mo.id, mo]))
          : metaObjects;
        apply2DDoorSwings(viewer, scene, doorMeta, floorBaseY);
        // Only save edge originals ONCE — on force-reapply the material already holds
        // the 2D values, and overwriting would corrupt the 3D edges on exit
        if (!(viewerShimRef.current as any).__orig2dEdge) {
          (viewerShimRef.current as any).__orig2dEdge = { origEdgeColor, origEdgeAlpha, origEdgeWidth };
        }

        // Lock camera: orthographic top-down, no rotation allowed
        const camera = viewer.camera;
        if (camera) {
          // Cancel previous momentum BEFORE setting 2D camera
          try { viewer.cameraFlight?.cancel?.(); } catch {}

          // Compute the AABB of visible objects to position camera at the floor plan centre
          let planAabb: number[] | null = null;
          try {
            const visIds = (scene.visibleObjectIds || []) as string[];
            if (visIds.length > 0) planAabb = scene.getAABB({ objectIds: visIds });
          } catch {}
          if (!planAabb || planAabb.length < 6) {
            try { planAabb = scene.aabb; } catch {}
          }

          let cx = camera.look[0], cz = camera.look[2];
          let spread = 50;

          // Auto-orient from AABB on first entry; manual rotation overrides
          const rotUpFromDeg = (deg: number): [number, number, number] => {
            const d = ((deg % 360) + 360) % 360;
            if (d === 90)  return [1, 0, 0];
            if (d === 180) return [0, 0, 1];
            if (d === 270) return [-1, 0, 0];
            return [0, 0, -1]; // 0°
          };

          let autoUpDeg = 0;
          if (planAabb && planAabb.length >= 6) {
            cx = (planAabb[0] + planAabb[3]) / 2;
            cz = (planAabb[2] + planAabb[5]) / 2;
            const xSpan = planAabb[3] - planAabb[0];
            const zSpan = planAabb[5] - planAabb[2];
            spread = Math.max(xSpan, zSpan, 10);
            if (zSpan > xSpan * 1.15) autoUpDeg = 90; // building longer in Z → rotate 90°
          }

          // On first entry reset manual rotation to auto-detected value
          if (!isForceReapply) plan2dRotationRef.current = autoUpDeg;
          const upVec = rotUpFromDeg(plan2dRotationRef.current);

          const eyeHeight = (planAabb ? planAabb[4] : camera.look[1]) + spread;
          const lookY = planAabb ? planAabb[1] : camera.look[1];

          camera.projection = 'ortho';
          camera.ortho.scale = spread * 1.1;
          // Fly instantly to top-down view centred on the floor plan
          viewer.cameraFlight.flyTo({ eye: [cx, eyeHeight, cz], look: [cx, lookY, cz], up: upVec, duration: 0 });
        }

        // Lock navigation: planView mode prevents rotation, only pan + zoom
        if (viewer.cameraControl) {
          viewer.cameraControl.navMode = 'planView';
          viewer.cameraControl.followPointer = false;
        }

        // Kill any residual inertia from 3D orbit/pan so the view doesn't spin
        if (viewer.scene?.camera) {
          const cam = viewer.scene.camera;
          cam.eye = [...cam.eye];
          cam.look = [...cam.look];
          cam.up = [...cam.up];
        }
        // Re-assert planView after a short delay to catch late-arriving touch events on mobile
        setTimeout(() => {
          if (viewer.cameraControl && viewModeRef.current === '2d') {
            viewer.cameraControl.navMode = 'planView';
            viewer.cameraControl.followPointer = false;
            if (viewer.scene?.camera) {
              const cam = viewer.scene.camera;
              cam.eye = [...cam.eye];
              cam.look = [...cam.look];
              cam.up = [...cam.up];
            }
          }
        }, 150);
        // Cache the floor ID for force-reapply
        if (targetFloorId) {
          try { sessionStorage.setItem('viewer_last_floor_id', targetFloorId); } catch {}
        }
      } catch (err) {
        logger.warn('[ViewerToolbar] Failed to enter 2D mode cleanly:', err);
        try { remove2DClipping(); } catch {}
        try { remove3DClipping(); } catch {}
      } finally {
        if (!isForceReapply) {
          setTimeout(revealCanvas, 80);
          setTimeout(revealCanvas, 600);
        }
        mode2dTransitionRef.current = false;
      }
    } else {
      // ── 3D restore ────────────────────────────────────────────────────────
      // Restore entity offsets saved during 2D styling (spaces were lowered),
      // then do a full batch reset and re-apply architect colors.
      if (colorizedFor2dRef.current && colorizedFor2dRef.current.size > 0) {
        colorizedFor2dRef.current.forEach((orig, id) => {
          const entity = scene.objects?.[id];
          if (entity && orig.offset) {
            try { entity.offset = orig.offset; } catch {}
          }
        });
        colorizedFor2dRef.current.clear();
      }
      colorizedFor2dRef.current = new Map(); // never null

      const allIds = scene.objectIds || [];
      if (allIds.length > 0) {
        scene.setObjectsVisible(allIds, true);
        scene.setObjectsXRayed(allIds, false);
        scene.setObjectsPickable(allIds, true);
        scene.setObjectsColorized(allIds, null);  // reset colorize (RGB array or null — NOT boolean)
        scene.setObjectsEdges(allIds, false);
        scene.setObjectsOpacity(allIds, 1);
      }
      scene.alphaDepthMask = true;

      // Restore edge material saved when entering 2D
      const origEdge = (viewerShimRef.current as any)?.__orig2dEdge;
      if (origEdge) {
        const edgeMat = scene.edgeMaterial;
        if (edgeMat) { edgeMat.edgeColor = origEdge.origEdgeColor; edgeMat.edgeAlpha = origEdge.origEdgeAlpha; edgeMat.edgeWidth = origEdge.origEdgeWidth; }
        delete (viewerShimRef.current as any).__orig2dEdge;
      }

      // Clear color-filter flags so applyArchitectColors is never short-circuited
      (window as any).__colorFilterActive = false;
      const vizSet2d = (window as any).__vizColorizedEntityIds;
      if (vizSet2d instanceof Set) vizSet2d.clear();

      // Re-apply architect color palette — starting from a clean slate
      try {
        const result = applyArchitectColors(viewer);
        logger.log(`[ViewerToolbar] 3D colors restored: ${result.colorized} colorized, ${result.hiddenSpaces} spaces hidden`);
      } catch (err) {
        console.error('[ViewerToolbar] Failed to restore colors:', err);
      }

      // Remove 2D clipping planes, restore 3D ceiling clip if a floor is selected
      try { remove2DClipping(); } catch {}
      if (currentFloorId) { try { applyCeilingClipping(currentFloorId); } catch {} }

      // Restore toolbar defaults: Orbit ON, Select OFF
      // (2D auto-activates the select tool — turn it back off when returning to 3D)
      if (activeToolRef2.current === 'select') {
        handleToolChange('select'); // toggles select off
      }
      setNavMode('orbit');
      if (viewer.cameraControl) {
        viewer.cameraControl.navMode = 'orbit';
      }

      const camera = viewer.camera;
      if (camera) {
        const lookX = camera.look[0], lookY = camera.look[1], lookZ = camera.look[2];
        const scale = camera.ortho?.scale || 50;
        const dist = scale * 0.8;
        const offset = dist / Math.sqrt(2);
        camera.projection = 'perspective';
        viewer.cameraFlight.flyTo({ eye: [lookX - offset, lookY + offset, lookZ - offset], look: [lookX, lookY, lookZ], up: [0, 1, 0], duration: 0.5 });
      }

      // Restore default background when leaving 2D
      emit('ARCHITECT_BACKGROUND_CHANGED', { presetId: 'light-gray' });
    }
  }, [viewer, currentFloorId, currentFloorBounds, calculateFloorBounds, applyFloorPlanClipping, applyGlobalFloorPlanClipping, applyCeilingClipping, removeSectionPlane]);

  // Keep ref in sync with latest handleViewModeChange
  useEffect(() => { handleViewModeChangeRef.current = handleViewModeChange; }, [handleViewModeChange]);

  const toggleTool = useCallback((toolId: string) => {
    setEnabledTools(prev => {
      const next = prev.includes(toolId) 
        ? prev.filter(t => t !== toolId)
        : prev.length < 10 ? [...prev, toolId] : prev;
      saveEnabledTools(next);
      return next;
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const visibleTools = ALL_TOOLS.filter(t => enabledTools.includes(t.id));

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'absolute bottom-4 left-1/2 -translate-x-1/2 z-30',
          'flex items-center gap-0 px-1 py-1 sm:gap-0.5 sm:px-2 sm:py-1.5 rounded-xl',
          'bg-black/80 backdrop-blur-sm border border-white/10 shadow-lg text-white',
          className,
        )}
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4px)' }}
      >
        {visibleTools.map((tool, idx) => {
          const prevTool = idx > 0 ? visibleTools[idx - 1] : null;
          const showSep = prevTool && prevTool.group !== tool.group;

          return (
            <React.Fragment key={tool.id}>
              {showSep && <Separator orientation="vertical" className="h-4 sm:h-6 mx-0.5 sm:mx-1 bg-white/20" />}
              
              {tool.id === 'orbit' && viewMode !== '2d' && (
                <ToolButton icon={tool.icon} label={tool.label} onClick={() => handleNavModeChange('orbit')} active={navMode === 'orbit'} disabled={!isReady} />
              )}
              {tool.id === 'firstPerson' && viewMode !== '2d' && (
                <ToolButton icon={tool.icon} label={tool.label} onClick={() => handleNavModeChange('firstPerson')} active={navMode === 'firstPerson'} disabled={!isReady} />
              )}
              {tool.id === 'fitView' && (
                <ToolButton icon={tool.icon} label={tool.label} onClick={handleViewFit} disabled={!isReady} />
              )}
              {tool.id === 'resetView' && (
                <ToolButton icon={tool.icon} label={tool.label} onClick={handleResetView} disabled={!isReady} />
              )}
              {tool.id === 'select' && (
                <ToolButton icon={tool.icon} label={tool.label} onClick={() => handleToolChange('select')} active={activeTool === 'select'} disabled={!isReady} />
              )}
              {tool.id === 'measure' && (
                <>
                  <ToolButton icon={tool.icon} label={tool.label} onClick={() => handleToolChange('measure')} active={activeTool === 'measure'} disabled={!isReady} />
                  {activeTool === 'measure' && (
                    <ToolButton icon={<RotateCcw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />} label="Clear measurements" onClick={clearMeasurements} disabled={!isReady} />
                  )}
                  <ToolButton icon={<Triangle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />} label="Angle measure" onClick={() => handleToolChange('angleMeasure')} active={activeTool === 'angleMeasure'} disabled={!isReady} />
                  {activeTool === 'angleMeasure' && (
                    <ToolButton icon={<RotateCcw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />} label="Clear angles" onClick={clearAngleMeasurements} disabled={!isReady} />
                  )}
                </>
              )}
              {tool.id === 'section' && viewMode !== '2d' && (
                <>
                  <ToolButton icon={tool.icon} label={tool.label} onClick={() => handleToolChange('slicer')} active={activeTool === 'slicer'} disabled={!isReady} />
                  {activeTool === 'slicer' && (
                    <ToolButton icon={<RotateCcw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />} label="Clear sections" onClick={handleClearSlices} disabled={!isReady} />
                  )}
                </>
              )}
              {tool.id === 'viewMode' && (
                <>
                  <ToolButton
                    icon={viewMode === '3d' ? <SquareDashed className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Cuboid className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                    label={viewMode === '3d' ? '2D view' : '3D view'}
                    onClick={() => handleViewModeChange(viewMode === '3d' ? '2d' : '3d')}
                    active={viewMode === '2d'}
                    disabled={!isReady}
                  />
                  {viewMode === '2d' && (
                    <ToolButton
                      icon={<RotateCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                      label="Rotate plan 90°"
                      onClick={handleRotate2DPlan}
                      disabled={!isReady}
                    />
                  )}
                </>
              )}
              {tool.id === 'xray' && (
                <ToolButton icon={tool.icon} label={tool.label} onClick={handleXrayToggle} active={isXrayActive} disabled={!isReady} />
              )}
              {tool.id === 'onHover' && (
                <ToolButton icon={tool.icon} label={tool.label} onClick={() => setIsOnHoverActive(p => !p)} active={isOnHoverActive} disabled={!isReady} />
              )}
              {tool.id === 'zoomIn' && (
                <ToolButton icon={tool.icon} label={tool.label} onClick={handleZoomIn} disabled={!isReady} />
              )}
              {tool.id === 'crosshair' && (
                <ToolButton icon={tool.icon} label={tool.label} onClick={() => setIsCrosshairActive(p => !p)} active={isCrosshairActive} disabled={!isReady} />
              )}
              {tool.id === 'navigation' && (
                <ToolButton
                  icon={tool.icon}
                  label={tool.label}
                  onClick={() => emit('TOGGLE_NAVIGATION_PANEL')}
                  disabled={!isReady}
                />
              )}
              {tool.id === 'geminiAi' && (
                <ToolButton
                  icon={tool.icon}
                  label={tool.label}
                  onClick={() => setIsGunnarOpen(p => !p)}
                  active={isGunnarOpen}
                  disabled={!isReady}
                />
              )}
              {tool.id === 'screenshot' && (
                <ToolButton
                  icon={tool.icon}
                  label={tool.label}
                  onClick={() => {
                    try {
                      const snap = viewer?.getSnapshot?.({ format: 'png' });
                      if (!snap) return;
                      const a = document.createElement('a');
                      a.href = snap;
                      a.download = `geminus-${Date.now()}.png`;
                      a.click();
                    } catch (e) {
                      logger.warn('[ViewerToolbar] Screenshot failed', e);
                    }
                  }}
                  active={false}
                  disabled={!isReady}
                />
              )}
              {tool.id === 'modelTree' && (
                <ToolButton
                  icon={tool.icon}
                  label={tool.label}
                  onClick={() => window.dispatchEvent(new CustomEvent('TOGGLE_MODEL_TREE'))}
                  disabled={!isReady}
                />
              )}
              {tool.id === 'explode' && viewMode !== '2d' && (
                <>
                  <ToolButton icon={tool.icon} label="Explodera modell" onClick={toggleExplode} active={isExplodeActive} disabled={!isReady} />
                  {isExplodeActive && (
                    <div className="flex items-center gap-1.5 px-1">
                      <Slider
                        min={0}
                        max={100}
                        step={1}
                        value={[explodeAmount]}
                        onValueChange={([val]) => handleExplodeChange(val)}
                        className="w-20"
                      />
                    </div>
                  )}
                </>
              )}
            </React.Fragment>
          );
        })}

        <Separator orientation="vertical" className="h-4 sm:h-6 mx-0.5 sm:mx-1 bg-white/20" />

        {/* Undo / Redo — always visible */}
        <ToolButton icon={<Undo2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />} label="Ångra (Ctrl+Z)" onClick={historyUndo} disabled={!isReady || !canUndo} />
        <ToolButton icon={<Redo2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />} label="Gör om (Ctrl+Y)" onClick={historyRedo} disabled={!isReady || !canRedo} />

        <Separator orientation="vertical" className="h-4 sm:h-6 mx-0.5 sm:mx-1 bg-white/20" />

        {/* Settings cog */}
        <Popover open={showConfig} onOpenChange={setShowConfig}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 sm:h-9 sm:w-9 text-white/90 hover:text-white hover:bg-white/10"
            >
              <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" className="w-64 p-2 max-h-[60dvh] overflow-y-auto" align="end">
            <p className="text-xs font-medium mb-2 text-muted-foreground">Navigation Speed</p>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Slider
                min={25}
                max={300}
                step={25}
                value={[navSpeed]}
                onValueChange={([val]) => {
                  setNavSpeed(val);
                  localStorage.setItem('viewer-nav-speed', String(val));
                  if (viewer?.cameraControl) {
                    const m = val / 100;
                    const cc = viewer.cameraControl;
                    cc.dragRotationRate = 120 * m;
                    cc.mouseWheelDollyRate = 50 * m;
                    cc.keyboardDollyRate = 5 * m;
                    cc.touchPanRate = 0.3 * m;
                    cc.touchDollyRate = 0.15 * m;
                  }
                }}
                className="flex-1"
              />
              <span className="text-2xs text-muted-foreground w-8 text-right">
                {navSpeed}%
              </span>
            </div>
            <Separator className="my-2" />
            <p className="text-xs font-medium mb-2 text-muted-foreground">Rendering</p>
            <div className="space-y-2 mb-3">
              <div className="flex items-center justify-between py-0.5">
                <span className="text-sm">Ambient Occlusion (SAO)</span>
                <Switch
                  checked={(() => { try { return localStorage.getItem('viewer-sao-enabled') !== 'false'; } catch { return true; } })()}
                  onCheckedChange={(checked) => {
                    try { localStorage.setItem('viewer-sao-enabled', checked ? 'true' : 'false'); } catch {}
                    const sao = viewer?.scene?.sao;
                    if (sao) sao.enabled = checked;
                  }}
                />
              </div>
              <div className="flex items-center justify-between py-0.5">
                <span className="text-sm">FastNav (snabb kamera)</span>
                <Switch
                  checked={(() => { try { return localStorage.getItem('viewer-fastnav-enabled') !== 'false'; } catch { return true; } })()}
                  onCheckedChange={(checked) => {
                    try { localStorage.setItem('viewer-fastnav-enabled', checked ? 'true' : 'false'); } catch {}
                    // FastNav requires page reload to take effect; notify user
                  }}
                />
              </div>
            </div>
            <Separator className="my-2" />
            <p className="text-xs font-medium mb-2 text-muted-foreground">Toolbar tools (max 10)</p>
            <div className="space-y-1.5">
              {ALL_TOOLS.map(tool => (
                <div key={tool.id} className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-2 text-sm">
                    {tool.icon}
                    <span>{tool.label}</span>
                  </div>
                  <Switch
                    checked={enabledTools.includes(tool.id)}
                    onCheckedChange={() => toggleTool(tool.id)}
                    disabled={!enabledTools.includes(tool.id) && enabledTools.length >= 10}
                  />
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Geminus AI — floating (draggable) or docked to right edge */}
      {isGunnarOpen && (() => {
        const gunnarContext: GunnarContext = {
          activeApp: 'viewer',
          currentBuilding: buildingFmGuid
            ? { fmGuid: buildingFmGuid, name: buildingName || buildingFmGuid }
            : undefined,
        };

        if (isGunnarDocked) {
          // Docked: fixed right sidebar, full viewer height
          return (
            <div className="fixed z-50 top-[44px] right-0 w-[360px] h-[calc(100vh-44px)] bg-card/98 backdrop-blur-md border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right-4 fade-in duration-200">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40 shrink-0 select-none">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  Geminus AI
                </span>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleDocked}>
                        <PanelRight className="h-3.5 w-3.5 rotate-180" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Lossa från panel</TooltipContent>
                  </Tooltip>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsGunnarOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden min-h-0">
                <GunnarChat open={true} onClose={() => setIsGunnarOpen(false)} context={gunnarContext} embedded />
              </div>
            </div>
          );
        }

        // Floating: draggable panel
        const floatStyle: React.CSSProperties = dragPos
          ? { left: dragPos.x, top: dragPos.y, bottom: 'auto', right: 'auto' }
          : { bottom: '96px', right: '24px' };

        return (
          <div
            className="fixed z-50 w-[380px] max-h-[70vh] rounded-xl bg-card/98 backdrop-blur-md border border-border shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200"
            style={floatStyle}
          >
            <div
              className="flex items-center justify-between px-3 py-2 border-b bg-muted/40 shrink-0 select-none cursor-grab active:cursor-grabbing"
              onMouseDown={onDragStart}
            >
              <span className="text-sm font-medium flex items-center gap-1.5">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                <Bot className="h-4 w-4 text-primary" />
                Geminus AI
              </span>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleDocked}>
                      <PanelRight className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Docka till höger</TooltipContent>
                </Tooltip>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsGunnarOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              <GunnarChat open={true} onClose={() => setIsGunnarOpen(false)} context={gunnarContext} embedded />
            </div>
          </div>
        );
      })()}

      {/* Tandem-style room isolation overlay */}
      {isolatedSpaceId && viewer && (
        <RoomIsolationOverlay
          viewer={viewer}
          spaceName={isolatedSpaceName}
          backdropLabels={backdropLabels}
          onExit={() => exitIsolation(viewer)}
        />
      )}

    </TooltipProvider>
  );
};

export default ViewerToolbar;
