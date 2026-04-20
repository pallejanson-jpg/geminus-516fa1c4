/**
 * SplitPlanView — 2D floor plan using xeokit StoreyViewsPlugin.
 *
 * Uses StoreyViewsPlugin.createStoreyMap() for high-quality orthographic plan images
 * and pickStoreyMap() / storeyMapToWorldPos() for click-to-navigate.
 * Supports pan/zoom and shows a live camera position indicator.
 *
 * Dalux-style: 3D camera Y is locked to the selected floor's height range.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { FLOOR_SELECTION_CHANGED_EVENT, type FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { AlertTriangle } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFloorData } from '@/hooks/useFloorData';
import { emit, on } from '@/lib/event-bus';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SplitPlanViewProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;
  className?: string;
  /** When false, 2D plan interactions do not change 3D floor visibility/clipping */
  syncFloorSelection?: boolean;
  /** Optional legacy camera Y clamp to selected floor bounds */
  lockCameraToFloor?: boolean;
  /** Force neutral black/white map styling */
  monochrome?: boolean;
  /** Navigation graph overlays rendered on top of the plan image */
  navigationOverlay?: React.ReactNode;
  /** Current room labels exposed for editor components */
  onRoomLabelsChange?: (labels: Array<{ id: string; name: string; x: number; y: number }>) => void;
  /** When true, clicks dispatch SPLIT_PLAN_NAVIGATE instead of first-person flyTo */
  isSplitMode?: boolean;
  /** Callback when an entity is clicked (for opening properties etc.) */
  onEntityClick?: (entityId: string, fmGuid: string | null, entityName: string | null) => void;
}

interface PanZoom {
  offsetX: number;
  offsetY: number;
  scale: number;
}

/** Unique source tag to prevent event echo loops */
const SPLIT_PLAN_SOURCE = 'split-plan-view';

const SplitPlanView: React.FC<SplitPlanViewProps> = ({
  viewerRef,
  buildingFmGuid,
  className,
  syncFloorSelection = true,
  lockCameraToFloor = false,
  monochrome = true,
  navigationOverlay,
  onRoomLabelsChange,
  isSplitMode = false,
  onEntityClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const isMobile = useIsMobile();
  const [storeyMap, setStoreyMap] = useState<any>(null);
  const [storeyPlugin, setStoreyPlugin] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panZoom, setPanZoom] = useState<PanZoom>({ offsetX: 0, offsetY: 0, scale: 1 });
  const panZoomRef = useRef<PanZoom>({ offsetX: 0, offsetY: 0, scale: 1 });
  const [cameraPos, setCameraPos] = useState<{ x: number; y: number; angle: number } | null>(null);
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [roomLabels, setRoomLabels] = useState<Array<{ id: string; name: string; number: string; x: number; y: number }>>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);
  const storeyMapRef = useRef<any>(null);
  const pluginRef = useRef<any>(null);
  const selectedFloorRef = useRef<{ floorId: string | null; floorFmGuid: string | null }>({ floorId: null, floorFmGuid: null });
  const sdkRef = useRef<any>(null);
  const initAttemptRef = useRef(0);
  const usedFallbackRef = useRef(false);
  const mapCacheRef = useRef<Map<string, any>>(new Map());
  const wallIdCacheRef = useRef<Map<string, string[]>>(new Map());
  const initialCenterApplied = useRef(false);
  // Guard: last dispatched floor ID to prevent redundant dispatches
  const lastDispatchedFloorRef = useRef<string | null>(null);

  const { floors } = useFloorData(viewerRef, buildingFmGuid);

  const normalizeGuidKey = useCallback((value?: string | null) => (value || '').toLowerCase().replace(/-/g, ''), []);

  const getXeokitViewer = useCallback(() => {
    try {
      const nativeViewer = (window as any).__nativeXeokitViewer;
      if (nativeViewer?.scene) return nativeViewer;
      const v = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (v) return v;
      return null;
    } catch { return null; }
  }, [viewerRef]);

  // Plugin-based floors as immediate fallback (no DB wait)
  const pluginFloors = React.useMemo(() => {
    const plugin = pluginRef.current;
    const viewer = getXeokitViewer();
    if (!plugin?.storeys) return [];
    let idx = 0;
    return Object.entries(plugin.storeys).map(([id, storey]: [string, any]) => {
      const mo = viewer?.metaScene?.metaObjects?.[id];
      const rawName = mo?.name || (storey as any).storeyId || id;
      const isGuid = /^[0-9A-Fa-f-]{30,}$/.test(rawName);
      idx++;
      const name = isGuid ? `Plan ${idx}` : rawName;
      const shortMatch = name.match(/(\d+)/);
      const shortName = shortMatch ? shortMatch[1] : name.substring(0, 10);
      return { id, name, shortName, metaObjectIds: [id], databaseLevelFmGuids: [mo?.originalSystemId || id] };
    });
  }, [storeyPlugin, getXeokitViewer]);

  // Prefer DB floors when available, fall back to plugin floors
  const effectiveFloors = floors.length > 0 ? floors : pluginFloors;

  const resolveFloorFromStoreyId = useCallback((storeyId: string) => {
    return effectiveFloors.find(
      (floor) => floor.id === storeyId || floor.metaObjectIds.includes(storeyId)
    ) ?? null;
  }, [effectiveFloors]);

  // Load SDK once
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const globalSdk = (window as any).__xeokitSdk;
        if (globalSdk?.StoreyViewsPlugin) {
          if (mounted) sdkRef.current = globalSdk;
          return;
        }
        const sdk = await (Function('return import("/lib/xeokit/xeokit-sdk.es.js")')() as Promise<any>);
        if (mounted) sdkRef.current = sdk;
      } catch (e) {
        console.warn('[SplitPlanView] SDK load failed:', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Initialize StoreyViewsPlugin
  useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryInit = () => {
      if (!mounted) return;
      const viewer = getXeokitViewer();
      const sdk = sdkRef.current;

      const metaObjects = viewer?.metaScene?.metaObjects || {};
      const metaStoreyCount = Object.values(metaObjects).filter(
        (mo: any) => mo?.type?.toLowerCase() === 'ifcbuildingstorey'
      ).length;

      if (!viewer?.scene || !sdk?.StoreyViewsPlugin) {
        if (initAttemptRef.current++ < 30) {
          retryTimer = setTimeout(tryInit, 200);
        } else if (mounted) {
          setError(!viewer?.scene ? 'Viewer not available' : 'SDK StoreyViewsPlugin missing');
        }
        return;
      }

      if (metaStoreyCount === 0) {
        if (initAttemptRef.current++ < 30) {
          retryTimer = setTimeout(tryInit, 200);
        }
        return;
      }

      try {
        let plugin = viewer.plugins?.StoreyViews;
        if (!plugin) {
          plugin = new sdk.StoreyViewsPlugin(viewer, { fitStoreyMaps: true });
        }

        const storeyKeys = Object.keys(plugin.storeys || {});
        if (storeyKeys.length === 0) {
          try { plugin.destroy?.(); } catch {}
          if (initAttemptRef.current++ < 30) {
            retryTimer = setTimeout(tryInit, 200);
          }
          return;
        }

        if (mounted) {
          console.log(`[SplitPlanView] StoreyViewsPlugin ready with ${storeyKeys.length} storeys`);
          setStoreyPlugin(plugin);
          pluginRef.current = plugin;
          setIsLoading(false);
        }
      } catch (e) {
        console.warn('StoreyViewsPlugin init failed:', e);
        if (mounted) {
          setError('Could not initialize plan view');
        }
      }
    };

    tryInit();

    const modelsHandler = () => {
      initAttemptRef.current = 0;
      tryInit();
    };
    const offModelsHandler = on('VIEWER_MODELS_LOADED', modelsHandler);

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      offModelsHandler();
    };
  }, [getXeokitViewer]);

  // Find current storey ID
  const findCurrentStoreyId = useCallback((): string | null => {
    const plugin = pluginRef.current;
    if (!plugin?.storeys) return null;

    const storeyIds = Object.keys(plugin.storeys);
    if (storeyIds.length === 0) return null;

    const viewer = getXeokitViewer();
    if (!viewer?.scene) return storeyIds[0];

    const metaObjects = viewer.metaScene?.metaObjects || {};

    const selFloorId = selectedFloorRef.current.floorId;
    if (selFloorId && plugin.storeys[selFloorId]) {
      return selFloorId;
    }

    const selectedFloorFmGuid = normalizeGuidKey(selectedFloorRef.current.floorFmGuid);
    if (selectedFloorFmGuid) {
      for (const storeyId of storeyIds) {
        const mo = metaObjects[storeyId];
        if (!mo) continue;
        const storeyGuid = normalizeGuidKey(mo.originalSystemId || mo.id || '');
        if (storeyGuid && storeyGuid === selectedFloorFmGuid) {
          return storeyId;
        }
      }
    }

    let bestId = storeyIds[0];
    let bestScore = -1;

    for (const storeyId of storeyIds) {
      const mo = metaObjects[storeyId];
      if (!mo) continue;
      let count = 0;
      const stack = [...(mo.children || [])];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        if (viewer.scene.objects?.[node.id]) count++;
        if (node.children?.length) stack.push(...node.children);
      }
      if (count > bestScore) {
        bestScore = count;
        bestId = storeyId;
      }
    }

    return bestId;
  }, [getXeokitViewer, normalizeGuidKey]);

  // Dispatch floor selection event — with source tag and dedup guard
  const dispatchFloorSync = useCallback((storeyId: string) => {
    // Dedup: don't dispatch if we already dispatched for this floor
    if (lastDispatchedFloorRef.current === storeyId) return;
    lastDispatchedFloorRef.current = storeyId;

    const viewer = getXeokitViewer();
    if (!viewer?.metaScene) return;

    const floor = resolveFloorFromStoreyId(storeyId);
    const mo = viewer.metaScene.metaObjects?.[storeyId];

    const visibleMetaFloorIds = floor?.metaObjectIds?.length ? floor.metaObjectIds : [storeyId];
    const visibleFloorFmGuids = floor?.databaseLevelFmGuids?.length
      ? floor.databaseLevelFmGuids
      : [mo?.originalSystemId || mo?.id || storeyId];

    const detail: FloorSelectionEventDetail & { source?: string } = {
      floorId: floor?.id || storeyId,
      floorName: floor?.name || mo?.name || null,
      visibleFloorFmGuids,
      visibleMetaFloorIds,
      isAllFloorsVisible: false,
      source: SPLIT_PLAN_SOURCE,
    };

    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail }));
  }, [getXeokitViewer, resolveFloorFromStoreyId]);

  // Generate fallback snapshot
  const generateFallbackSnapshot = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    try {
      const scene = viewer.scene;
      const camera = viewer.camera;
      const origEye = [...camera.eye];
      const origLook = [...camera.look];
      const origUp = [...camera.up];
      const origProjection = camera.projection;

      const aabb = scene.aabb;
      const cx = (aabb[0] + aabb[3]) / 2;
      const cy = (aabb[1] + aabb[4]) / 2;
      const cz = (aabb[2] + aabb[5]) / 2;
      const height = Math.max(aabb[3] - aabb[0], aabb[5] - aabb[2]) * 1.2;

      camera.projection = 'ortho';
      camera.ortho.scale = height;
      camera.eye = [cx, cy + height, cz];
      camera.look = [cx, cy, cz];
      camera.up = [0, 0, -1];

      scene.glRedraw?.();

      setTimeout(() => {
        try {
          const canvas = scene.canvas?.canvas as HTMLCanvasElement;
          if (canvas) {
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl && dataUrl.length > 100) {
              const fakeMap = {
                imageData: dataUrl,
                width: canvas.width,
                height: canvas.height,
                storeyId: 'fallback',
              };
              setStoreyMap(fakeMap);
              storeyMapRef.current = fakeMap;
              usedFallbackRef.current = true;
              setError(null);
              setImgError(false);
            }
          }
        } catch (snapErr) {
          console.warn('[SplitPlanView] Fallback snapshot capture failed:', snapErr);
        } finally {
          camera.projection = origProjection;
          camera.eye = origEye;
          camera.look = origLook;
          camera.up = origUp;
          setIsLoading(false);
        }
      }, 100);
    } catch (e) {
      console.warn('[SplitPlanView] Fallback snapshot failed:', e);
      setIsLoading(false);
    }
  }, [getXeokitViewer]);

  // Generate storey map
  const generateMap = useCallback(() => {
    const plugin = pluginRef.current;
    const viewer = getXeokitViewer();
    if (!plugin || !viewer?.scene) return;

    const storeyKeys = Object.keys(plugin.storeys || {});
    if (storeyKeys.length === 0) {
      generateFallbackSnapshot();
      return;
    }

    const preferredStoreyId = findCurrentStoreyId();
    if (!preferredStoreyId) return;

    // Optional: sync selected 2D floor into 3D floor filter/clipping
    if (syncFloorSelection) {
      dispatchFloorSync(preferredStoreyId);
    }

    const selectedFloor = resolveFloorFromStoreyId(preferredStoreyId);
    setSelectedFloorId(selectedFloor?.id ?? preferredStoreyId);

    // Check cache
    const cacheKey = preferredStoreyId;
    const cached = mapCacheRef.current.get(cacheKey);
    if (cached) {
      setStoreyMap(cached);
      storeyMapRef.current = cached;
      setIsLoading(false);
      setError(null);
      setImgError(false);
      usedFallbackRef.current = false;
      return;
    }

    setIsLoading(true);

    const container = containerRef.current;
    const maxWidth = isMobile ? 3000 : 6000;
    const width = container ? Math.min(container.clientWidth * (isMobile ? 3 : 5), maxWidth) : 3000;

    // Build set of entity IDs that belong to the selected storey (descendants)
    const storeyDescendants = new Set<string>();
    const storeyMeta = viewer.metaScene?.metaObjects?.[preferredStoreyId];
    if (storeyMeta) {
      const stack = [...(storeyMeta.children || [])];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        if (viewer.scene.objects?.[node.id]) storeyDescendants.add(node.id);
        if (node.children?.length) stack.push(...node.children);
      }
    }

    // Precompute entity type buckets scoped to this storey
    const wallTypes = new Set(['ifcwall', 'ifcwallstandardcase', 'ifcwallelementedcase', 'ifccurtainwall', 'ifccolumn', 'ifccolumnstandardcase', 'ifcbeam', 'ifcbeamstandardcase', 'ifcmember', 'ifcmemberstandardcase', 'ifcrailing', 'ifcrailingstandardcase', 'ifcstairflight', 'ifcstair']);
    const slabTypes = new Set(['ifcslab', 'ifcslabstandardcase', 'ifcslabelementedcase', 'ifcroof', 'ifccovering', 'ifcplate']);
    const spaceTypes = new Set(['ifcspace']);
    const doorTypes = new Set(['ifcdoor', 'ifcdoorstandardcase', 'ifcwindow', 'ifcwindowstandardcase']);

    const wallIds: string[] = [];
    const slabIds: string[] = [];
    const spaceIds: string[] = [];
    const doorIds: string[] = [];
    const metaObjects = viewer.metaScene?.metaObjects || {};

    // Only include entities that belong to this storey's descendants
    const entityPool = storeyDescendants.size > 0 ? storeyDescendants : new Set(Object.keys(viewer.scene.objects || {}));
    for (const id of entityPool) {
      const mo = metaObjects[id] as any;
      if (!mo) continue;
      const t = (mo.type || '').toLowerCase();
      if (!viewer.scene.objects?.[id]) continue;
      if (wallTypes.has(t)) wallIds.push(id);
      else if (slabTypes.has(t)) slabIds.push(id);
      else if (spaceTypes.has(t)) {
        // Skip large "area" type spaces that cover the whole floor
        const spaceName = (mo.name || '').trim().toLowerCase();
        const isArea = spaceName === 'area' || spaceName.startsWith('area ') || spaceName.startsWith('area:') || spaceName === 'areas';
        if (!isArea) {
          // Also check if this space has an abnormally large AABB relative to the floor
          const entity = viewer.scene.objects?.[id];
          if (entity?.aabb) {
            const dx = entity.aabb[3] - entity.aabb[0];
            const dz = entity.aabb[5] - entity.aabb[2];
            const floorArea = dx * dz;
            // Skip spaces larger than 2000 m² (likely a covering/area object)
            if (floorArea < 2000) {
              spaceIds.push(id);
            }
          } else {
            spaceIds.push(id);
          }
        }
      }
      else if (doorTypes.has(t)) doorIds.push(id);
    }

    // Apply clean architectural styling before map capture
    const scene = viewer.scene;
    const originalStyles: { id: string; color: number[] | null; opacity: number; edges: boolean; visible: boolean }[] = [];

    const saveStyle = (id: string) => {
      const entity = scene.objects?.[id];
      if (!entity) return;
      originalStyles.push({
        id,
        color: entity.colorize ? [...entity.colorize] : null,
        opacity: typeof entity.opacity === 'number' ? entity.opacity : 1,
        edges: !!entity.edges,
        visible: entity.visible !== false,
      });
    };

    const structuralIds = new Set([...wallIds, ...slabIds, ...spaceIds, ...doorIds]);
    const storeyScope = storeyDescendants.size > 0 ? storeyDescendants : null;

    if (monochrome) {
      // Hide ALL entities — then selectively show storey-scoped structural ones
      for (const [id, entity] of Object.entries(scene.objects || {}) as [string, any][]) {
        // If entity is outside storey scope, hide it
        if (storeyScope && !storeyScope.has(id)) {
          saveStyle(id);
          entity.visible = false;
          continue;
        }
        if (structuralIds.has(id)) continue;
        saveStyle(id);
        entity.visible = false;
      }

      // Spaces: bright fill for clear Dalux-style room outlines
      for (const id of spaceIds) {
        const entity = scene.objects?.[id];
        if (!entity) continue;
        saveStyle(id);
        entity.visible = true;
        entity.colorize = [0.95, 0.95, 0.95];
        entity.opacity = 0.9;
        entity.edges = true;
      }

      // Slabs: hidden (would occlude plan from above)
      for (const id of slabIds) {
        const entity = scene.objects?.[id];
        if (!entity) continue;
        saveStyle(id);
        entity.visible = false;
      }

      // Doors/windows: medium gray for context
      for (const id of doorIds) {
        const entity = scene.objects?.[id];
        if (!entity) continue;
        saveStyle(id);
        entity.visible = true;
        entity.colorize = [0.65, 0.65, 0.65];
        entity.opacity = 0.7;
        entity.edges = false;
      }
    }

      // Bold wall edges for Dalux-style crisp plan
    if (scene.edgeMaterial) {
      scene.edgeMaterial.edgeWidth = monochrome ? 12 : 6;
      scene.edgeMaterial.edgeColor = [0, 0, 0];
    }
    for (const id of wallIds) {
      const entity = scene.objects?.[id];
      if (!entity) continue;
      saveStyle(id);
      entity.visible = true;
      entity.colorize = [0.0, 0.0, 0.0];
      entity.opacity = 1;
      entity.edges = true;
    }

    const restoreColors = () => {
      for (const { id, color, opacity, edges, visible } of originalStyles) {
        const entity = scene.objects?.[id];
        if (!entity) continue;
        if (color) entity.colorize = color; else entity.colorize = null;
        entity.opacity = opacity;
        entity.edges = edges;
        entity.visible = visible;
      }
    };

    try {
      const map = plugin.createStoreyMap(preferredStoreyId, { width, format: 'png' });
      restoreColors();

      if (map?.imageData && map.imageData.length > 200) {
        mapCacheRef.current.set(cacheKey, map);
        setStoreyMap(map);
        storeyMapRef.current = map;
        setError(null);
        setImgError(false);
        usedFallbackRef.current = false;
      } else {
        generateFallbackSnapshot();
      }
    } catch (e) {
      restoreColors();
      console.warn('[SplitPlanView] createStoreyMap failed:', e);
      generateFallbackSnapshot();
    } finally {
      setIsLoading(false);
    }
  }, [getXeokitViewer, findCurrentStoreyId, generateFallbackSnapshot, isMobile, dispatchFloorSync, resolveFloorFromStoreyId, syncFloorSelection, monochrome]);

  // Generate map once plugin ready + listen for external floor changes
  useEffect(() => {
    if (!storeyPlugin) return;

    const t0 = setTimeout(generateMap, 50);

    // Listen for floor changes from OTHER components (ignore our own)
    const floorHandler = (detail: FloorSelectionEventDetail & { source?: string }) => {
      // CRITICAL: Ignore events we dispatched ourselves to break the loop
      if (detail?.source === SPLIT_PLAN_SOURCE) return;

      selectedFloorRef.current = {
        floorId: detail?.floorId ?? null,
        floorFmGuid: detail?.visibleFloorFmGuids?.[0] ?? null,
      };
      initialCenterApplied.current = false;
      // Reset dedup guard so we can dispatch for the new floor
      lastDispatchedFloorRef.current = null;
      setTimeout(generateMap, 50);
    };

    const modelsLoadedHandler = () => {
      mapCacheRef.current.clear();
      wallIdCacheRef.current.clear();
      lastDispatchedFloorRef.current = null;
      setTimeout(generateMap, 200);
    };

    const offFloorHandler = on('FLOOR_SELECTION_CHANGED', floorHandler);
    const offModelsLoadedHandler = on('VIEWER_MODELS_LOADED', modelsLoadedHandler);

    return () => {
      clearTimeout(t0);
      offFloorHandler();
      offModelsLoadedHandler();
    };
  }, [storeyPlugin, generateMap]);

  // Fallback snapshot after 15s
  useEffect(() => {
    if (storeyPlugin || storeyMapRef.current) return;
    const t = setTimeout(() => {
      if (!storeyMapRef.current && !pluginRef.current) {
        generateFallbackSnapshot();
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [storeyPlugin, generateFallbackSnapshot]);

  // Center image helper — called from effect and onLoad
  const centerImage = useCallback(() => {
    if (initialCenterApplied.current) return;
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const imgW = img.naturalWidth || img.clientWidth;
    const imgH = img.naturalHeight || img.clientHeight;
    if (!imgW || !imgH) return;

    const cRect = container.getBoundingClientRect();
    const scale = Math.min(cRect.width / imgW, cRect.height / imgH) * 0.92;
    const scaledW = imgW * scale;
    const scaledH = imgH * scale;
    const ox = (cRect.width - scaledW) / 2;
    const oy = (cRect.height - scaledH) / 2;

    const newPz = { offsetX: ox, offsetY: oy, scale };
    setPanZoom(newPz);
    panZoomRef.current = newPz;
    initialCenterApplied.current = true;
  }, []);

  // Center image after storey map loads
  useEffect(() => {
    if (!storeyMap || initialCenterApplied.current) return;
    const timer = setTimeout(centerImage, 50);
    return () => clearTimeout(timer);
  }, [storeyMap, centerImage]);

  // Camera position overlay — use xeokit's built-in worldPosToStoreyMap for accuracy
  useEffect(() => {
    const updateCamera = () => {
      try {
      const viewer = getXeokitViewer();
      const map = storeyMapRef.current;
      const plugin = pluginRef.current;
      if (!viewer?.camera?.eye || !map) return;

      const eye = viewer.camera.eye;
      const look = viewer.camera.look;
      const dx = look[0] - eye[0];
      const dz = look[2] - eye[2];
      const angle = Math.atan2(dx, -dz);

      // Use xeokit's built-in worldPosToStoreyMap if available
      if (plugin && typeof plugin.worldPosToStoreyMap === 'function') {
        const imagePos = [0, 0];
        try {
          plugin.worldPosToStoreyMap(map, [eye[0], eye[1], eye[2]], imagePos);
          setCameraPos({
            x: (imagePos[0] / map.width) * 100,
            y: (imagePos[1] / map.height) * 100,
            angle,
          });
          return;
        } catch (e) {
          // Fall through to manual calc
        }
      }

      if (usedFallbackRef.current || !plugin) {
        const aabb = viewer.scene?.aabb;
        if (!aabb) return;
        const xRange = aabb[3] - aabb[0];
        const zRange = aabb[5] - aabb[2];
        if (xRange < 0.01 || zRange < 0.01) return;
        const normX = (eye[0] - aabb[0]) / xRange;
        const normZ = (eye[2] - aabb[2]) / zRange;
        setCameraPos({ x: normX * 100, y: normZ * 100, angle });
        return;
      }

      const storey = plugin.storeys?.[map.storeyId];
      if (!storey) {
        const aabb = viewer.scene?.aabb;
        if (!aabb) return;
        const xRange = aabb[3] - aabb[0];
        const zRange = aabb[5] - aabb[2];
        if (xRange < 0.01 || zRange < 0.01) return;
        const normX = (eye[0] - aabb[0]) / xRange;
        const normZ = (eye[2] - aabb[2]) / zRange;
        setCameraPos({ x: normX * 100, y: normZ * 100, angle });
        return;
      }

      const aabb = plugin._fitStoreyMaps ? storey.storeyAABB : storey.modelAABB;
      const xRange = aabb[3] - aabb[0];
      const zRange = aabb[5] - aabb[2];
      if (xRange < 0.01 || zRange < 0.01) return;

      const normX = (eye[0] - aabb[0]) / xRange;
      const normZ = (eye[2] - aabb[2]) / zRange;

      setCameraPos({
        x: (1.0 - normX) * 100,
        y: (1.0 - normZ) * 100,
        angle,
      });
      } catch (err) {
        // Silently ignore errors (e.g. DTXTrianglesLayer._subPortionSetOffset after model disposal)
      }
    };

    const interval = setInterval(updateCamera, isMobile ? 350 : 150);
    updateCamera();
    return () => clearInterval(interval);
  }, [getXeokitViewer, storeyMap, isMobile]);

  // Optional legacy clamp: lock 3D camera Y to selected floor bounds
  useEffect(() => {
    if (!lockCameraToFloor) return;
    const viewer = getXeokitViewer();
    const plugin = pluginRef.current;
    if (!viewer?.scene || !plugin) return;

    let tickSub: any = null;

    const clampToFloor = () => {
      const map = storeyMapRef.current;
      if (!map?.storeyId) return;
      const storey = plugin.storeys?.[map.storeyId];
      if (!storey?.storeyAABB) return;

      const sAABB = storey.storeyAABB;
      const floorMinY = sAABB[1];
      const floorMaxY = sAABB[4];
      const floorRange = floorMaxY - floorMinY;
      const margin = Math.max(floorRange * 0.5, 2);
      const minY = floorMinY - margin;
      const maxY = floorMaxY + floorRange * 2 + margin;

      const eye = viewer.camera.eye;
      const look = viewer.camera.look;

      const newLookY = Math.max(minY, Math.min(maxY, look[1]));
      const newEyeY = Math.max(minY, Math.min(maxY + floorRange * 3, eye[1]));

      if (Math.abs(newLookY - look[1]) > 0.01 || Math.abs(newEyeY - eye[1]) > 0.01) {
        viewer.camera.eye = [eye[0], newEyeY, eye[2]];
        viewer.camera.look = [look[0], newLookY, look[2]];
      }
    };

    tickSub = viewer.scene.on('tick', clampToFloor);

    return () => {
      if (tickSub !== undefined && tickSub !== null) {
        try { viewer.scene.off?.(tickSub); } catch {}
      }
    };
  }, [getXeokitViewer, storeyMap, storeyPlugin, lockCameraToFloor]);

  // Compute room labels for 2D overlay
  useEffect(() => {
    const map = storeyMapRef.current;
    const plugin = pluginRef.current;
    const viewer = getXeokitViewer();
    if (!map || !viewer?.metaScene || usedFallbackRef.current) {
      setRoomLabels([]);
      return;
    }

    const metaObjects = viewer.metaScene.metaObjects || {};
    const storey = plugin?.storeys?.[map.storeyId];
    const aabb = storey
      ? (plugin._fitStoreyMaps ? storey.storeyAABB : storey.modelAABB)
      : viewer.scene?.aabb;
    if (!aabb) {
      setRoomLabels([]);
      return;
    }

    const roomTypes = new Set(['ifcspace', 'ifcroom']);
    const labels: Array<{ id: string; name: string; number: string; x: number; y: number }> = [];

    const storeyMeta = metaObjects[map.storeyId];
    const storeyChildren = new Set<string>();
    if (storeyMeta) {
      const stack = [...(storeyMeta.children || [])];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        storeyChildren.add(node.id);
        if (node.children?.length) stack.push(...node.children);
      }
    }

    for (const [id, mo] of Object.entries(metaObjects) as [string, any][]) {
      const t = (mo?.type || '').toLowerCase();
      if (!roomTypes.has(t)) continue;

      if (storeyChildren.size > 0 && !storeyChildren.has(id)) continue;

      const entity = viewer.scene.objects?.[id];
      if (!entity) continue;

      const entityAabb = entity.aabb;
      if (!entityAabb) continue;

      const cx = (entityAabb[0] + entityAabb[3]) / 2;
      const cz = (entityAabb[2] + entityAabb[5]) / 2;

      const normX = (cx - aabb[0]) / (aabb[3] - aabb[0]);
      const normZ = (cz - aabb[2]) / (aabb[5] - aabb[2]);
      const imgX = (1.0 - normX) * 100;
      const imgY = (1.0 - normZ) * 100;

      const name = mo.name || '';
      const number = mo.LongName || mo.longName || mo.attributes?.LongName || '';

      labels.push({ id, name, number, x: imgX, y: imgY });
    }

    setRoomLabels(labels);
    onRoomLabelsChange?.(labels);
  }, [storeyMap, getXeokitViewer, onRoomLabelsChange]);

  // Click to navigate — use storeyMapToWorldPos for accurate position,
  // then translate current camera offset to avoid disorienting jumps/invalid poses
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (clickStartRef.current) {
      const dx = Math.abs(e.clientX - clickStartRef.current.x);
      const dy = Math.abs(e.clientY - clickStartRef.current.y);
      if (dx > 5 || dy > 5) return;
    }

    const plugin = pluginRef.current;
    const map = storeyMapRef.current;
    const img = imgRef.current;
    const viewer = getXeokitViewer();
    if (!map || !img || !viewer) return;

    const rect = img.getBoundingClientRect();
    const imgX = (e.clientX - rect.left) / rect.width * map.width;
    const imgY = (e.clientY - rect.top) / rect.height * map.height;

    viewer.cameraFlight?.cancel?.();

    // --- Entity picking: identify clicked entity ---
    let pickedEntityId: string | null = null;
    let pickedFmGuid: string | null = null;
    let pickedEntityName: string | null = null;

    if (!usedFallbackRef.current && plugin) {
      try {
        const pickResult = plugin.pickStoreyMap(map, [imgX, imgY]);
        if (pickResult?.entity) {
          const entityId = pickResult.entity.id;
          const metaObj = viewer.metaScene?.metaObjects?.[entityId];
          const ifcType = (metaObj?.type || '').toLowerCase();

          // Filter out large area objects that cover the entire floor
          const largeAreaTypes = new Set(['ifcsite', 'ifcbuilding', 'ifcproject']);
          let isLargeArea = largeAreaTypes.has(ifcType);

          // Also check if the entity's AABB covers >80% of the floor AABB
          if (!isLargeArea && pickResult.entity.aabb) {
            const storey = plugin.storeys?.[map.storeyId];
            const floorAABB = storey
              ? (plugin._fitStoreyMaps ? storey.storeyAABB : storey.modelAABB)
              : viewer.scene?.aabb;
            if (floorAABB) {
              const floorArea = (floorAABB[3] - floorAABB[0]) * (floorAABB[5] - floorAABB[2]);
              const entityAABB = pickResult.entity.aabb;
              const entityArea = (entityAABB[3] - entityAABB[0]) * (entityAABB[5] - entityAABB[2]);
              if (floorArea > 0 && entityArea / floorArea > 0.8) {
                isLargeArea = true;
              }
            }
          }

          // In split mode, 2D clicks are for navigation only — no object selection
          if (!isSplitMode && !isLargeArea) {
            pickedEntityId = entityId;
            pickedFmGuid = metaObj?.originalSystemId || null;
            pickedEntityName = metaObj?.name || metaObj?.type || null;

            // Select the entity in xeokit
            const selected = viewer.scene.selectedObjectIds || [];
            if (selected.length > 0) viewer.scene.setObjectsSelected(selected, false);
            pickResult.entity.selected = true;

            // Dispatch selection event
            emit('VIEWER_SELECT_ENTITY', { entityId: pickedEntityId, fmGuid: pickedFmGuid, entityName: pickedEntityName },);

            // Notify parent
            onEntityClick?.(pickedEntityId, pickedFmGuid, pickedEntityName);
          }
        }
      } catch {
        // ignore pick errors
      }
    }

    // --- Camera navigation ---
    let worldPos: [number, number, number] | null = null;

    if (!usedFallbackRef.current && plugin) {
      try {
        const wp = plugin.storeyMapToWorldPos(map, [imgX, imgY]);
        if (Array.isArray(wp) && wp.length >= 3 && wp.slice(0, 3).every((v) => Number.isFinite(v))) {
          worldPos = [wp[0], wp[1], wp[2]];
        }
      } catch {
        // ignore and use fallback mapping below
      }
    }

    if (!worldPos) {
      const storey = plugin?.storeys?.[map.storeyId];
      const aabb = storey
        ? (plugin._fitStoreyMaps ? storey.storeyAABB : storey.modelAABB)
        : viewer.scene?.aabb;
      if (!aabb) return;

      const normX = (e.clientX - rect.left) / rect.width;
      const normZ = (e.clientY - rect.top) / rect.height;
      const fallbackWorldPos: [number, number, number] = [
        aabb[0] + (1 - normX) * (aabb[3] - aabb[0]),
        aabb[1],
        aabb[2] + (1 - normZ) * (aabb[5] - aabb[2]),
      ];

      if (fallbackWorldPos.every((v) => Number.isFinite(v))) {
        worldPos = fallbackWorldPos;
      }
    }

    if (!worldPos || !viewer.cameraFlight) return;

    if (isSplitMode) {
      // In split 2D/3D mode, dispatch event for 3D camera to follow
      emit('SPLIT_PLAN_NAVIGATE', { worldPos },);
      return;
    }

    // Dalux-style first-person camera: 1.5m above floor, looking straight ahead
    const eye = viewer.camera.eye;
    const look = viewer.camera.look;

    // Get current horizontal viewing direction (preserve heading)
    const dx = (look?.[0] ?? 0) - (eye?.[0] ?? 0);
    const dz = (look?.[2] ?? 0) - (eye?.[2] ?? 0);
    const hLen = Math.sqrt(dx * dx + dz * dz);
    const dirX = hLen > 0.01 ? dx / hLen : 0;
    const dirZ = hLen > 0.01 ? dz / hLen : -1;

    // Floor Y from clicked point, eye at person height (2m above floor)
    const floorY = worldPos[1];
    const eyeHeight = floorY + 2.0;

    const nextEye: [number, number, number] = [worldPos[0], eyeHeight, worldPos[2]];
    const nextLook: [number, number, number] = [worldPos[0] + dirX * 5, eyeHeight, worldPos[2] + dirZ * 5];

    if (!nextEye.every((v) => Number.isFinite(v)) || !nextLook.every((v) => Number.isFinite(v))) {
      console.warn('[SplitPlanView] Skipping flyTo — invalid camera coords');
      return;
    }

    viewer.cameraFlight.flyTo({
      eye: nextEye,
      look: nextLook,
      up: [0, 1, 0],
      duration: 0.4,
    });
  }, [getXeokitViewer, isSplitMode, onEntityClick]);

  // Mouse move for hover
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanZoom(pz => { const nv = { ...pz, offsetX: panStartRef.current!.ox + dx, offsetY: panStartRef.current!.oy + dy }; panZoomRef.current = nv; return nv; });
      return;
    }

    const plugin = pluginRef.current;
    const map = storeyMapRef.current;
    const img = imgRef.current;
    if (!plugin || !map || !img) return;

    const rect = img.getBoundingClientRect();
    const imgX = (e.clientX - rect.left) / rect.width * map.width;
    const imgY = (e.clientY - rect.top) / rect.height * map.height;

    try {
      const pickResult = plugin.pickStoreyMap(map, [imgX, imgY]);
      if (pickResult?.entity) {
        const viewer = getXeokitViewer();
        const metaObj = viewer?.metaScene?.metaObjects?.[pickResult.entity.id];
        const name = metaObj?.name || pickResult.entity.id;
        setHoveredEntity(name);
      } else {
        setHoveredEntity(null);
      }
    } catch {
      setHoveredEntity(null);
    }
  }, [getXeokitViewer]);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setPanZoom(pz => {
      const newScale = Math.max(0.3, Math.min(10, pz.scale * delta));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) { const nv = { ...pz, scale: newScale }; panZoomRef.current = nv; return nv; }
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ox = mx - (mx - pz.offsetX) * (newScale / pz.scale);
      const oy = my - (my - pz.offsetY) * (newScale / pz.scale);
      const nv = { offsetX: ox, offsetY: oy, scale: newScale };
      panZoomRef.current = nv;
      return nv;
    });
  }, []);

  // Pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      clickStartRef.current = { x: e.clientX, y: e.clientY };
      const pz = panZoomRef.current;
      panStartRef.current = { x: e.clientX, y: e.clientY, ox: pz.offsetX, oy: pz.offsetY };
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    panStartRef.current = null;
  }, []);

  // Touch support
  const touchStartRef = useRef<{ x: number; y: number; ox: number; oy: number; dist?: number; scale?: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const pz = panZoomRef.current;
      clickStartRef.current = { x: t.clientX, y: t.clientY };
      touchStartRef.current = { x: t.clientX, y: t.clientY, ox: pz.offsetX, oy: pz.offsetY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const pz = panZoomRef.current;
      touchStartRef.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        ox: pz.offsetX, oy: pz.offsetY,
        dist, scale: pz.scale,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const ts = touchStartRef.current;
    if (!ts) return;
    if (e.touches.length === 1 && !ts.dist) {
      const dx = e.touches[0].clientX - ts.x;
      const dy = e.touches[0].clientY - ts.y;
      const newOx = ts.ox + dx;
      const newOy = ts.oy + dy;
      setPanZoom(pz => { const nv = { ...pz, offsetX: newOx, offsetY: newOy }; panZoomRef.current = nv; return nv; });
    } else if (e.touches.length === 2 && ts.dist) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scaleFactor = dist / ts.dist;
      const newScale = Math.max(0.3, Math.min(10, (ts.scale || 1) * scaleFactor));
      setPanZoom(pz => { const nv = { ...pz, scale: newScale }; panZoomRef.current = nv; return nv; });
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.changedTouches.length > 0 && clickStartRef.current) {
      const t = e.changedTouches[0];
      const dx = Math.abs(t.clientX - clickStartRef.current.x);
      const dy = Math.abs(t.clientY - clickStartRef.current.y);
      if (dx < 5 && dy < 5) {
        const synth = { clientX: t.clientX, clientY: t.clientY } as React.MouseEvent;
        handleClick(synth);
      }
    }
    touchStartRef.current = null;
  }, [handleClick]);

  // Handle floor dropdown change
  const handleFloorChange = useCallback((floorId: string) => {
    if (selectedFloorId === floorId) return;

    const floor = effectiveFloors.find((f) => f.id === floorId);
    const targetStoreyId = floor?.metaObjectIds.find((id) => pluginRef.current?.storeys?.[id]) || floorId;
    const fmGuid = floor?.databaseLevelFmGuids?.[0] ?? null;

    selectedFloorRef.current = {
      floorId: targetStoreyId,
      floorFmGuid: fmGuid,
    };

    setSelectedFloorId(floor?.id ?? floorId);
    initialCenterApplied.current = false;
    lastDispatchedFloorRef.current = null; // allow new dispatch

    const cachedMap = mapCacheRef.current.get(targetStoreyId);
    if (cachedMap?.imageData) {
      setStoreyMap(cachedMap);
      storeyMapRef.current = cachedMap;
      setIsLoading(false);
      setError(null);
      setImgError(false);
      usedFallbackRef.current = false;
      if (syncFloorSelection) {
        dispatchFloorSync(targetStoreyId);
      }
      return;
    }

    generateMap();
  }, [effectiveFloors, generateMap, selectedFloorId, dispatchFloorSync]);

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full overflow-hidden select-none', className)}
      style={{ backgroundColor: '#ffffff' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { panStartRef.current = null; setHoveredEntity(null); }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Mini floor dropdown — show when we have floors from any source */}
      {storeyMap && effectiveFloors.length > 0 && (
        <div className="absolute top-2 left-2 z-20" onClick={(e) => e.stopPropagation()}>
          <Select value={selectedFloorId} onValueChange={handleFloorChange}>
            <SelectTrigger
              className="h-6 w-auto min-w-[70px] max-w-[120px] text-[10px] px-2 py-0 bg-card/95 backdrop-blur-sm border border-border shadow-sm rounded"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <SelectValue placeholder="Plan" />
            </SelectTrigger>
            <SelectContent>
              {effectiveFloors.map((f: any) => (
                <SelectItem key={f.id} value={f.id} className="text-[11px]">
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !storeyMap && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: '#ffffff' }}>
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="h-5 w-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Loading plan view...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !storeyMap && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: '#ffffff' }}>
          <div className="flex flex-col items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <span className="text-xs text-muted-foreground">{error}</span>
            <button
              className="text-xs text-primary underline mt-1"
              onClick={() => generateFallbackSnapshot()}
            >
              Try snapshot fallback
            </button>
          </div>
        </div>
      )}

      {/* Plan image with room labels overlay */}
      {storeyMap && (
        <div
          className="relative"
          style={{
            transform: `translate(${panZoom.offsetX}px, ${panZoom.offsetY}px) scale(${panZoom.scale})`,
            transformOrigin: '0 0',
            display: 'inline-block',
          }}
        >
          <img
            ref={imgRef}
            src={storeyMap.imageData}
            alt="Floor plan"
            className="max-w-none cursor-crosshair"
            style={{
              imageRendering: 'crisp-edges',
              filter: 'contrast(1.8)',
            }}
            draggable={false}
            onClick={handleClick}
            onLoad={centerImage}
            onError={() => {
              console.error('[SplitPlanView] img onError — imageData URL failed to render');
              setImgError(true);
            }}
          />
          {/* Room labels overlay */}
          {roomLabels.length > 0 && imgRef.current && (
            <div
              className="absolute pointer-events-none"
              style={{
                top: 0,
                left: 0,
                width: imgRef.current.naturalWidth || imgRef.current.clientWidth || '100%',
                height: imgRef.current.naturalHeight || imgRef.current.clientHeight || '100%',
              }}
            >
              {roomLabels.map((label) => (
                <div
                  key={label.id}
                  className="absolute text-center pointer-events-none"
                  style={{
                    left: `${label.x}%`,
                    top: `${label.y}%`,
                    transform: 'translate(-50%, -50%)',
                    fontSize: '11px',
                    fontWeight: 500,
                    color: '#000000',
                    textShadow: '0 0 3px white, 0 0 3px white, 0 0 3px white',
                    whiteSpace: 'nowrap',
                    maxWidth: '120px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.15,
                  }}
                >
                  {label.number && <div style={{ fontWeight: 600 }}>{label.number}</div>}
                  {label.name && <div style={{ fontSize: '10px', opacity: 0.9 }}>{label.name}</div>}
                </div>
              ))}
            </div>
          )}
          {/* Navigation overlays (editor + route display) */}
          {navigationOverlay && (
            <div className="absolute inset-0">
              {navigationOverlay}
            </div>
          )}
          {/* Camera position indicator (inside transformed container) */}
          {cameraPos && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${cameraPos.x}%`,
                top: `${cameraPos.y}%`,
              }}
            >
            {/* FOV cone */}
              <div
                className="absolute"
                style={{
                  width: 0, height: 0,
                  borderLeft: `${isMobile ? 14 : 24}px solid transparent`,
                  borderRight: `${isMobile ? 14 : 24}px solid transparent`,
                  borderBottom: `${isMobile ? 26 : 42}px solid rgba(59, 130, 246, 0.25)`,
                  transform: `translate(-50%, -100%) rotate(${cameraPos.angle}rad)`,
                  transformOrigin: 'center bottom',
                }}
              />
              {/* Camera dot with pulse ring */}
              <div className="absolute" style={{ transform: 'translate(-50%, -50%)' }}>
                <div className={cn("rounded-full bg-blue-500 border-2 border-white shadow-lg relative z-10", isMobile ? "w-4 h-4" : "w-7 h-7")} />
                <div className={cn("absolute rounded-full border-2 border-blue-400 animate-ping", isMobile ? "w-4 h-4 top-0 left-0" : "w-7 h-7 top-0 left-0")} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Image error fallback */}
      {imgError && storeyMap && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: '#ffffff' }}>
          <div className="flex flex-col items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <span className="text-xs text-muted-foreground">Plan image failed to render</span>
            <button className="text-xs text-primary underline" onClick={generateMap}>Retry</button>
          </div>
        </div>
      )}

      {/* Hovered entity tooltip */}
      {hoveredEntity && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 px-2 py-0.5 bg-card/90 backdrop-blur-sm rounded text-[10px] text-foreground border border-border shadow-sm pointer-events-none">
          {hoveredEntity}
        </div>
      )}
    </div>
  );
};

export default SplitPlanView;
