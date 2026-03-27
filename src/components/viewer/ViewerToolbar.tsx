import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ZoomIn,
  Focus,
  Ruler,
  Scissors,
  MousePointer2,
  RotateCcw,
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { applyArchitectColors } from '@/lib/architect-colors';
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
  viewer: any;
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

const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ viewer, className }) => {
  const [activeTool, setActiveTool] = useState<ViewerTool>(null);
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [isXrayActive, setIsXrayActive] = useState(false);
  const [isOnHoverActive, setIsOnHoverActive] = useState(false);
  const [isCrosshairActive, setIsCrosshairActive] = useState(false);
  const [isGunnarOpen, setIsGunnarOpen] = useState(false);
  const [enabledTools, setEnabledTools] = useState<string[]>(getEnabledTools);
  const [showConfig, setShowConfig] = useState(false);
  const [navSpeed, setNavSpeed] = useState(() => {
    try { return parseInt(localStorage.getItem('viewer-nav-speed') || '100'); } catch { return 100; }
  });

  // Store initial camera for reset
  const initialCameraRef = useRef<{ eye: number[]; look: number[]; up: number[] } | null>(null);

  const viewModeRef = useRef<ViewMode>(viewMode);
  const colorizedFor2dRef = useRef<Map<string, { colorize: number[] | null; opacity: number; edges: boolean; pickable: boolean; visible: boolean; offset: number[] | null }>>(new Map());
  const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);
  const [currentFloorBounds, setCurrentFloorBounds] = useState<{ minY: number; maxY: number } | null>(null);

  const viewerShimRef = useRef<any>(null);
  useEffect(() => {
    if (!viewer) return;
    const assetViewShim = { viewer, viewFit: () => {}, setNavMode: () => {}, useTool: () => {}, clearSlices: () => {} };
    viewerShimRef.current = { $refs: { AssetViewer: { $refs: { assetView: assetViewShim } } }, assetViewer: { $refs: { assetView: assetViewShim } } };
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
  } = useSectionPlaneClipping(viewerShimRef, { enabled: true, clipMode: 'floor', floorCutHeight: 0.5 });

  // ── Floor selection events ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
      let { floorId, bounds, isAllFloorsVisible, visibleMetaFloorIds } = e.detail;
      const visibleFloorFmGuids = (e.detail as any).visibleFloorFmGuids as string[] | undefined;
      const skipClipping = !!(e.detail as any).skipClipping;

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

      setCurrentFloorId(floorId);
      setCurrentFloorBounds(bounds || null);

      // When skipClipping is set (e.g. from FloatingFloorSwitcher which already
      // handles visibility), don't apply additional section-plane clipping.
      if (skipClipping) {
        // Still remove stale clipping planes when showing all floors
        if (isAllFloorsVisible) {
          requestAnimationFrame(() => { try { remove3DClipping(); } catch {} });
        }
        return;
      }

      const isSolo = floorId !== null && !isAllFloorsVisible;
      const soloId = isSolo ? (floorId || visibleMetaFloorIds?.[0]) : null;

      if (viewModeRef.current === '2d') {
        if (floorId) applyFloorPlanClipping(floorId);
        else {
          const sceneAABB = viewer?.scene?.getAABB?.();
          if (sceneAABB) applyGlobalFloorPlanClipping(sceneAABB[1]);
        }
      } else {
        // In 3D mode: apply ceiling clipping to cut objects that extend above next floor
        if (soloId) {
          requestAnimationFrame(() => { try { applyCeilingClipping(soloId); } catch {} });
        } else {
          requestAnimationFrame(() => { try { remove3DClipping(); } catch {} });
        }
      }
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, [viewer, applyFloorPlanClipping, applyGlobalFloorPlanClipping, applyCeilingClipping, remove3DClipping]);

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
  // Keep a ref to the latest handleViewModeChange so event handlers always call the current version
  const handleViewModeChangeRef = useRef<((mode: ViewMode) => void) | null>(null);

  useEffect(() => {
    const handler = (e: CustomEvent<ViewModeRequestedDetail>) => {
      if (e.detail.mode === '2d' || e.detail.mode === '3d') handleViewModeChangeRef.current?.(e.detail.mode);
    };
    window.addEventListener(VIEW_MODE_REQUESTED_EVENT, handler as EventListener);
    return () => window.removeEventListener(VIEW_MODE_REQUESTED_EVENT, handler as EventListener);
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
    }

    // Respect current view mode — don't jump to 3D from 2D
    if (viewModeRef.current === '2d') {
      // Re-center 2D view without switching to 3D
      const sceneAABB = scene.getAABB?.();
      if (sceneAABB) {
        viewer.cameraFlight.flyTo({ aabb: sceneAABB, duration: 0.3 });
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
    }

    // Reset x-ray
    setIsXrayActive(false);
    // Re-apply architect color palette asynchronously to avoid blocking interaction
    requestAnimationFrame(() => {
      applyArchitectColors(viewer);
    });
    // Re-apply modifications (deleted/moved objects) so they stay deleted
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('REAPPLY_MODIFICATIONS'));
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
  const sectionPluginRef = useRef<any>(null);

  const activateMeasure = useCallback(() => {
    if (!viewer?.scene) return;
    const sdk = (window as any).__xeokitSdk;
    if (!sdk?.DistanceMeasurementsPlugin) { console.warn('[ViewerToolbar] DistanceMeasurementsPlugin not in SDK'); return; }
    if (!measurePluginRef.current) {
      measurePluginRef.current = new sdk.DistanceMeasurementsPlugin(viewer, {
        defaultVisible: true,
        defaultAxisVisible: true,
        defaultLabelsVisible: true,
      });
    }
    measurePluginRef.current.control?.activate?.();
  }, [viewer]);

  const deactivateMeasure = useCallback(() => {
    measurePluginRef.current?.control?.deactivate?.();
  }, []);

  const clearMeasurements = useCallback(() => {
    if (measurePluginRef.current) {
      measurePluginRef.current.clear?.();
      console.log('[ViewerToolbar] Measurements cleared');
    }
  }, []);

  const activateSection = useCallback(() => {
    if (!viewer?.scene) return;
    const sdk = (window as any).__xeokitSdk;
    if (!sdk?.SectionPlanesPlugin) { console.warn('[ViewerToolbar] SectionPlanesPlugin not in SDK'); return; }
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
            console.log('[ViewerToolbar] Section plane created with interactive control');
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
    if (activeTool === 'slicer') deactivateSection();

    // Activate new tool plugins
    if (newTool === 'measure') activateMeasure();
    if (newTool === 'slicer') activateSection();

    setActiveTool(newTool);
    selfDispatchRef.current = true;
    window.dispatchEvent(new CustomEvent<ViewerToolChangedDetail>(VIEWER_TOOL_CHANGED_EVENT, {
      detail: { tool: newTool },
    }));
    selfDispatchRef.current = false;
  }, [activeTool, activateMeasure, deactivateMeasure, activateSection, deactivateSection]);

  // Ref to track activeTool without stale closures in the external listener
  const activeToolRef2 = useRef<ViewerTool>(activeTool);
  activeToolRef2.current = activeTool;

  // Listen for external tool changes (e.g. from MobileViewerPage / navigation menu)
  useEffect(() => {
    const handler = (e: CustomEvent<ViewerToolChangedDetail>) => {
      // Skip events we dispatched ourselves
      if (selfDispatchRef.current) return;

      const tool = e.detail.tool as ViewerTool;
      const prev = activeToolRef2.current;

      // Deactivate previous
      if (prev === 'measure') deactivateMeasure();
      if (prev === 'slicer') deactivateSection();

      // Activate new
      if (tool === 'measure') activateMeasure();
      if (tool === 'slicer') activateSection();

      setActiveTool(tool);
    };
    window.addEventListener(VIEWER_TOOL_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(VIEWER_TOOL_CHANGED_EVENT, handler as EventListener);
  }, [activateMeasure, deactivateMeasure, activateSection, deactivateSection]);

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

  // ── X-ray toggle ─────────────────────────────────────────────────────────
  const XRAY_BATCH = 100;
  const handleXrayToggle = useCallback(() => {
    if (!viewer?.scene) return;
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
      console.warn('[ViewerToolbar] handleViewModeChange: viewer not ready, skipping');
      return;
    }
    // Force reapply: if already in 2D mode and requesting 2D, re-run clipping
    const isForceReapply = mode === '2d' && viewModeRef.current === '2d';
    // Idempotency: skip if already in target mode (unless force reapply)
    if (mode === viewModeRef.current && !isForceReapply) return;
    // Prevent overlapping 2D transitions
    if (mode === '2d' && mode2dTransitionRef.current && !isForceReapply) return;
    const scene = viewer.scene;

    setViewMode(mode);
    if (mode === '2d') mode2dTransitionRef.current = true;
    window.dispatchEvent(new CustomEvent(VIEW_MODE_CHANGED_EVENT, { detail: { mode, floorId: currentFloorId } }));

    if (mode === '2d') {
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
        window.dispatchEvent(new CustomEvent(ARCHITECT_BACKGROUND_CHANGED_EVENT, { detail: { presetId: 'white' } }));

        let targetFloorId = currentFloorId;

        // Try to resolve floor from last FLOOR_SELECTION_CHANGED event cache
        if (!targetFloorId) {
          // Check sessionStorage for last known floor
          try {
            const lastFloor = sessionStorage.getItem('viewer_last_floor_id');
            if (lastFloor) targetFloorId = lastFloor;
          } catch {}
        }

        if (!targetFloorId) {
          const metaObjects2 = viewer?.metaScene?.metaObjects || {};
          const storeys = Object.values(metaObjects2)
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

          if (targetFloorId !== currentFloorId) {
            const floorMeta = viewer?.metaScene?.metaObjects?.[targetFloorId];
            const floorFmGuid =
              floorMeta?.originalSystemId ||
              floorMeta?.attributes?.FmGuid ||
              floorMeta?.attributes?.fmGuid ||
              floorMeta?.attributes?.fmguid ||
              targetFloorId;

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

        const SLAB_TYPES = new Set(['ifcslab', 'ifcslabstandardcase', 'ifcslabelementedcase', 'ifcplate']);
        const ROOF_TYPES = new Set(['ifcroof']);
        const COVERING_TYPES = new Set(['ifccovering']);
        const WALL_TYPES = new Set(['ifcwall', 'ifcwallstandardcase']);
        const DOOR_WINDOW_TYPES = new Set(['ifcdoor', 'ifcwindow']);
        const FURNITURE_TYPES = new Set(['ifcfurnishingelement', 'ifcrailing', 'ifcstair', 'ifcstairflight']);
        const SPACE_TYPES = new Set(['ifcspace']);
        const HIDE_TYPES = new Set([...SLAB_TYPES, ...ROOF_TYPES, ...COVERING_TYPES]);
        const metaObjects = viewer?.metaScene?.metaObjects || scene?.metaScene?.metaObjects || {};
        const metaCount = Object.keys(metaObjects).length;
        console.log(`[ViewerToolbar] 2D styling: found ${metaCount} metaObjects, floor: ${targetFloorId}`);
        const colorized = new Map<string, { colorize: number[] | null; opacity: number; edges: boolean; pickable: boolean; visible: boolean; offset: number[] | null }>();

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

        let visibleCount = 0;

        const saveOrig = (entity: any, id: string) => {
          colorized.set(id, { colorize: entity.colorize ? [...entity.colorize] : null, opacity: entity.opacity, edges: entity.edges, pickable: entity.pickable !== false, visible: entity.visible, offset: entity.offset ? [...entity.offset] : null });
        };

        Object.values(metaObjects).forEach((mo: any) => {
          const typeLower = mo.type?.toLowerCase() || '';
          const entity = scene.objects?.[mo.id];
          if (!entity) return;

          // If we have storey descendants, hide entities not belonging to this floor
          if (storeyDescendants.size > 0 && !storeyDescendants.has(mo.id) && typeLower !== 'ifcbuildingstorey' && typeLower !== 'ifcbuilding' && typeLower !== 'ifcsite' && typeLower !== 'ifcproject') {
            saveOrig(entity, mo.id);
            entity.visible = false;
            entity.pickable = false;
            return;
          }

          if (HIDE_TYPES.has(typeLower)) {
            // Hide slabs, roofs, coverings — they occlude the plan from above
            saveOrig(entity, mo.id);
            entity.visible = false; entity.pickable = false;
         } else if (SPACE_TYPES.has(typeLower)) {
            saveOrig(entity, mo.id);
            entity.visible = true; entity.pickable = true; entity.opacity = 0.15; entity.colorize = [0.7, 0.85, 0.95]; entity.edges = true;
            // Lower spaces so equipment wins pick priority in top-down 2D
            try {
              const origOffset = entity.offset ? [...entity.offset] : [0, 0, 0];
              entity.offset = [origOffset[0], origOffset[1] - 0.3, origOffset[2]];
            } catch (e) { /* DTX _textureData null — safe to ignore */ }
            visibleCount++;
          } else if (WALL_TYPES.has(typeLower)) {
            saveOrig(entity, mo.id);
            entity.colorize = [0.25, 0.25, 0.25]; entity.opacity = 1; entity.edges = true; entity.pickable = false;
            visibleCount++;
          } else if (DOOR_WINDOW_TYPES.has(typeLower)) {
            saveOrig(entity, mo.id);
            entity.colorize = [0.12, 0.12, 0.12]; entity.opacity = 1; entity.edges = true; entity.pickable = false;
            visibleCount++;
          } else if (FURNITURE_TYPES.has(typeLower)) {
            saveOrig(entity, mo.id);
            entity.visible = false; entity.pickable = false;
          } else {
            saveOrig(entity, mo.id);
            entity.colorize = [0.35, 0.35, 0.35]; entity.opacity = 0.9; entity.edges = true; entity.pickable = true;
            visibleCount++;
          }
        });

        // Safety: if almost no objects are visible after 2D styling, rollback
        if (visibleCount === 0) {
          console.warn('[ViewerToolbar] 2D mode: 0 visible objects after styling — rolling back');
          colorized.forEach((orig, id) => {
            const entity = scene.objects?.[id];
            if (entity) {
              if (orig.colorize) entity.colorize = orig.colorize; else entity.colorize = null;
              entity.opacity = orig.opacity; entity.edges = orig.edges; entity.pickable = orig.pickable; entity.visible = orig.visible;
              if (orig.offset) entity.offset = orig.offset; else entity.offset = [0, 0, 0];
            }
          });
          colorized.clear();
        }

        if (edgeMat) { edgeMat.edgeColor = [0.15, 0.15, 0.15]; edgeMat.edgeAlpha = 1.0; edgeMat.edgeWidth = 2; }
        colorizedFor2dRef.current = colorized;
        (viewerShimRef.current as any).__orig2dEdge = { origEdgeColor, origEdgeAlpha, origEdgeWidth };

        // Lock camera: orthographic top-down, no rotation allowed
        const camera = viewer.camera;
        if (camera) {
          const lookX = camera.look[0], lookY = camera.look[1], lookZ = camera.look[2];
          const dx = camera.eye[0] - lookX, dy = camera.eye[1] - lookY, dz = camera.eye[2] - lookZ;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          // Cancel previous momentum BEFORE setting 2D camera
          try { viewer.cameraFlight?.cancel?.(); } catch {}

          camera.projection = 'ortho';
          camera.ortho.scale = dist * 1.2;
          // Set camera instantly to top-down view
          viewer.cameraFlight.flyTo({ eye: [lookX, lookY + dist, lookZ], look: [lookX, lookY, lookZ], up: [0, 0, -1], duration: 0 });
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
            // Kill inertia again in case touch events re-applied it
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
        console.warn('[ViewerToolbar] Failed to enter 2D mode cleanly:', err);
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
      // Restore all entities modified during 2D mode
      if (colorizedFor2dRef.current.size > 0) {
        colorizedFor2dRef.current.forEach((orig, id) => {
          const entity = scene.objects?.[id];
          if (entity) {
            if (orig.colorize) entity.colorize = orig.colorize; else entity.colorize = null;
            entity.opacity = orig.opacity; entity.edges = orig.edges; entity.pickable = orig.pickable; entity.visible = orig.visible;
            if (orig.offset) entity.offset = orig.offset; else entity.offset = [0, 0, 0];
          }
        });
        colorizedFor2dRef.current.clear();
      }

      const origEdge = (viewerShimRef.current as any)?.__orig2dEdge;
      if (origEdge) {
        const edgeMat = scene.edgeMaterial;
        if (edgeMat) { edgeMat.edgeColor = origEdge.origEdgeColor; edgeMat.edgeAlpha = origEdge.origEdgeAlpha; edgeMat.edgeWidth = origEdge.origEdgeWidth; }
        delete (viewerShimRef.current as any).__orig2dEdge;
      }

      // Re-apply architect color palette to ensure spaces are hidden and colors correct
      try { applyArchitectColors(viewer); } catch {}

      // Remove 2D clipping planes, restore 3D ceiling clip if a floor is selected
      try { remove2DClipping(); } catch {}
      if (currentFloorId) { try { applyCeilingClipping(currentFloorId); } catch {} }

      // Restore navigation: orbit mode
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
      window.dispatchEvent(new CustomEvent(ARCHITECT_BACKGROUND_CHANGED_EVENT, { detail: { presetId: 'light-gray' } }));
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
                <ToolButton
                  icon={viewMode === '3d' ? <SquareDashed className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Cuboid className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                  label={viewMode === '3d' ? '2D view' : '3D view'}
                  onClick={() => handleViewModeChange(viewMode === '3d' ? '2d' : '3d')}
                  active={viewMode === '2d'}
                  disabled={!isReady}
                />
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
                  onClick={() => window.dispatchEvent(new CustomEvent('TOGGLE_NAVIGATION_PANEL'))}
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
            </React.Fragment>
          );
        })}

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
              <span className="text-[10px] text-muted-foreground w-8 text-right">
                {navSpeed}%
              </span>
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

      {/* Geminus AI floating chat panel */}
      {isGunnarOpen && (
        <div className="fixed z-50 bottom-24 right-6 w-[380px] max-h-[70vh] rounded-xl bg-card/95 backdrop-blur-md border border-border shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 shrink-0">
            <span className="text-sm font-medium flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Geminus AI
            </span>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setIsGunnarOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            <GunnarChat
              open={true}
              onClose={() => setIsGunnarOpen(false)}
              context={{ activeApp: 'viewer' } as GunnarContext}
              embedded
            />
          </div>
        </div>
      )}
    </TooltipProvider>
  );
};

export default ViewerToolbar;
