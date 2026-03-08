/**
 * SplitPlanView — 2D floor plan using xeokit StoreyViewsPlugin.
 *
 * Uses StoreyViewsPlugin.createStoreyMap() for high-quality orthographic plan images
 * and pickStoreyMap() / storeyMapToWorldPos() for click-to-navigate.
 * Supports pan/zoom and shows a live camera position indicator.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { FLOOR_SELECTION_CHANGED_EVENT, type FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { AlertTriangle } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFloorData } from '@/hooks/useFloorData';
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
}

interface PanZoom {
  offsetX: number;
  offsetY: number;
  scale: number;
}

const SplitPlanView: React.FC<SplitPlanViewProps> = ({ viewerRef, buildingFmGuid, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const isMobile = useIsMobile();
  const [storeyMap, setStoreyMap] = useState<any>(null);
  const [storeyPlugin, setStoreyPlugin] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panZoom, setPanZoom] = useState<PanZoom>({ offsetX: 0, offsetY: 0, scale: 0.75 });
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
  // Track whether we used the fallback snapshot
  const usedFallbackRef = useRef(false);
  // Cache for generated storey maps
  const mapCacheRef = useRef<Map<string, any>>(new Map());
  // Precomputed wall entity IDs per storey (for black-wall coloring)
  const wallIdCacheRef = useRef<Map<string, string[]>>(new Map());
  // Track if initial center has been applied
  const initialCenterApplied = useRef(false);

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

  // Load SDK once — prefer globally shared SDK from NativeXeokitViewer
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

  // Initialize StoreyViewsPlugin — start immediately + on VIEWER_MODELS_LOADED
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
        if (initAttemptRef.current++ < 10) {
          retryTimer = setTimeout(tryInit, 100);
        } else if (mounted) {
          setError(!viewer?.scene ? 'Viewer not available' : 'SDK StoreyViewsPlugin missing');
        }
        return;
      }

      if (metaStoreyCount === 0) {
        if (initAttemptRef.current++ < 10) {
          retryTimer = setTimeout(tryInit, 100);
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
          if (initAttemptRef.current++ < 10) {
            retryTimer = setTimeout(tryInit, 100);
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

    // Start immediately
    tryInit();

    // Also listen for VIEWER_MODELS_LOADED to retry
    const modelsHandler = () => {
      initAttemptRef.current = 0;
      tryInit();
    };
    window.addEventListener('VIEWER_MODELS_LOADED', modelsHandler);

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('VIEWER_MODELS_LOADED', modelsHandler);
    };
  }, [getXeokitViewer]);

  // Find current storey ID based on selected floor (preferred) or fallback
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

  // Dispatch floor selection event to sync 3D viewer
  const dispatchFloorSync = useCallback((storeyId: string) => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene) return;

    const mo = viewer.metaScene.metaObjects?.[storeyId];
    const fmGuid = mo?.originalSystemId || mo?.id || storeyId;

    const detail: FloorSelectionEventDetail = {
      floorId: storeyId,
      visibleFloorFmGuids: [fmGuid],
      visibleMetaFloorIds: [storeyId],
    };

    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail }));
  }, [getXeokitViewer]);

  // Generate a fallback snapshot via top-down camera capture
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

  // Generate storey map — with caching and mobile resolution optimization
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

    // Dispatch floor selection to keep 3D in sync
    dispatchFloorSync(preferredStoreyId);

    // Update selectedFloorId state for dropdown
    setSelectedFloorId(preferredStoreyId);

    // Check cache first
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

    // Generate immediately without requestIdleCallback delay
    const container = containerRef.current;
    const maxWidth = isMobile ? 900 : 1600;
    const width = container ? Math.min(container.clientWidth * (isMobile ? 1.5 : 2), maxWidth) : 800;

    // Precompute wall IDs for this storey (cached)
    const wallTypes = new Set(['ifcwall', 'ifcwallstandardcase', 'ifccurtainwall', 'ifcslab', 'ifccolumn', 'ifcbeam', 'ifcrailing', 'ifcstair', 'ifcstairflight']);
    let wallIds = wallIdCacheRef.current.get(preferredStoreyId);
    if (!wallIds) {
      wallIds = [];
      const metaObjects = viewer.metaScene?.metaObjects || {};
      for (const [id, mo] of Object.entries(metaObjects) as [string, any][]) {
        const t = (mo?.type || '').toLowerCase();
        if (wallTypes.has(t) && viewer.scene.objects?.[id]) {
          wallIds.push(id);
        }
      }
      wallIdCacheRef.current.set(preferredStoreyId, wallIds);
    }

    // Apply black walls
    const scene = viewer.scene;
    const originalColors: { id: string; color: number[] | null }[] = [];
    for (const id of wallIds) {
      const entity = scene.objects?.[id];
      if (!entity) continue;
      originalColors.push({ id, color: entity.colorize ? [...entity.colorize] : null });
      entity.colorize = [0, 0, 0];
    }

    const restoreColors = () => {
      for (const { id, color } of originalColors) {
        const entity = scene.objects?.[id];
        if (!entity) continue;
        if (color) { entity.colorize = color; } else { entity.colorize = null; }
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
  }, [getXeokitViewer, findCurrentStoreyId, generateFallbackSnapshot, isMobile, dispatchFloorSync]);

  // Generate map once when plugin is ready, and on floor changes
  useEffect(() => {
    if (!storeyPlugin) return;

    // Single initial generation — immediate
    const t0 = setTimeout(generateMap, 50);

    // Listen for floor changes from other components (e.g. 3D floor switcher)
    const floorHandler = (event: Event) => {
      const detail = (event as CustomEvent<FloorSelectionEventDetail>).detail;
      selectedFloorRef.current = {
        floorId: detail?.floorId ?? null,
        floorFmGuid: detail?.visibleFloorFmGuids?.[0] ?? null,
      };
      // Reset center for new floor
      initialCenterApplied.current = false;
      setTimeout(generateMap, 50);
    };

    // Listen for models loaded (re-generate once)
    const modelsLoadedHandler = () => {
      mapCacheRef.current.clear();
      wallIdCacheRef.current.clear();
      setTimeout(generateMap, 200);
    };

    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, floorHandler);
    window.addEventListener('VIEWER_MODELS_LOADED', modelsLoadedHandler);

    return () => {
      clearTimeout(t0);
      window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, floorHandler);
      window.removeEventListener('VIEWER_MODELS_LOADED', modelsLoadedHandler);
    };
  }, [storeyPlugin, generateMap]);

  // If no plugin after 15 seconds, try fallback snapshot directly
  useEffect(() => {
    if (storeyPlugin || storeyMapRef.current) return;
    const t = setTimeout(() => {
      if (!storeyMapRef.current && !pluginRef.current) {
        generateFallbackSnapshot();
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [storeyPlugin, generateFallbackSnapshot]);

  // Center image after storey map loads
  useEffect(() => {
    if (!storeyMap || initialCenterApplied.current) return;

    // Small delay to let image render
    const timer = setTimeout(() => {
      const container = containerRef.current;
      const img = imgRef.current;
      if (!container || !img) return;

      const cRect = container.getBoundingClientRect();
      const imgW = img.naturalWidth || img.clientWidth;
      const imgH = img.naturalHeight || img.clientHeight;

      // The image is rendered with max-w-full max-h-full object-contain
      // Calculate its rendered size at scale 0.75
      const scale = 0.75;
      const containerAspect = cRect.width / cRect.height;
      const imgAspect = imgW / imgH;

      let renderedW: number, renderedH: number;
      if (imgAspect > containerAspect) {
        renderedW = cRect.width;
        renderedH = cRect.width / imgAspect;
      } else {
        renderedH = cRect.height;
        renderedW = cRect.height * imgAspect;
      }

      const scaledW = renderedW * scale;
      const scaledH = renderedH * scale;
      const ox = (cRect.width - scaledW) / 2;
      const oy = (cRect.height - scaledH) / 2;

      setPanZoom({ offsetX: ox, offsetY: oy, scale });
      initialCenterApplied.current = true;
    }, 50);

    return () => clearTimeout(timer);
  }, [storeyMap]);

  // Camera position overlay — uses percentage of image
  useEffect(() => {
    const updateCamera = () => {
      const viewer = getXeokitViewer();
      const map = storeyMapRef.current;
      const plugin = pluginRef.current;
      if (!viewer?.camera?.eye || !map) return;

      const eye = viewer.camera.eye;
      const look = viewer.camera.look;
      const dx = look[0] - eye[0];
      const dz = look[2] - eye[2];
      const angle = Math.atan2(-dz, -dx);

      if (usedFallbackRef.current || !plugin) {
        const aabb = viewer.scene?.aabb;
        if (!aabb) return;
        const normX = (eye[0] - aabb[0]) / (aabb[3] - aabb[0]);
        const normZ = (eye[2] - aabb[2]) / (aabb[5] - aabb[2]);
        setCameraPos({ x: normX * 100, y: normZ * 100, angle });
        return;
      }

      const storey = plugin.storeys?.[map.storeyId];
      if (!storey) {
        // Fallback: use scene AABB
        const aabb = viewer.scene?.aabb;
        if (!aabb) return;
        const normX = (eye[0] - aabb[0]) / (aabb[3] - aabb[0]);
        const normZ = (eye[2] - aabb[2]) / (aabb[5] - aabb[2]);
        setCameraPos({ x: normX * 100, y: normZ * 100, angle });
        return;
      }

      const aabb = plugin._fitStoreyMaps ? storey.storeyAABB : storey.modelAABB;
      const normX = (eye[0] - aabb[0]) / (aabb[3] - aabb[0]);
      const normZ = (eye[2] - aabb[2]) / (aabb[5] - aabb[2]);

      setCameraPos({
        x: (1.0 - normX) * 100,
        y: (1.0 - normZ) * 100,
        angle,
      });
    };

    const interval = setInterval(updateCamera, isMobile ? 350 : 150);
    updateCamera();
    return () => clearInterval(interval);
  }, [getXeokitViewer, storeyMap]);

  // Dalux-style: Lock 3D camera Y to selected floor's height range
  useEffect(() => {
    const viewer = getXeokitViewer();
    const plugin = pluginRef.current;
    if (!viewer?.scene || !plugin) return;

    let tickSub: any = null;

    const clampToFloor = () => {
      const map = storeyMapRef.current;
      if (!map?.storeyId) return;
      const storey = plugin.storeys?.[map.storeyId];
      if (!storey) return;

      const sAABB = storey.storeyAABB;
      if (!sAABB) return;

      const floorMinY = sAABB[1];
      const floorMaxY = sAABB[4];
      const floorRange = floorMaxY - floorMinY;
      // Allow camera to be within floor range + generous margin above/below
      const margin = Math.max(floorRange * 0.5, 2);
      const minY = floorMinY - margin;
      const maxY = floorMaxY + floorRange * 2 + margin;

      const eye = viewer.camera.eye;
      const look = viewer.camera.look;

      let needsClamp = false;
      const newLookY = Math.max(minY, Math.min(maxY, look[1]));
      const newEyeY = Math.max(minY, Math.min(maxY + floorRange * 3, eye[1]));

      if (Math.abs(newLookY - look[1]) > 0.01 || Math.abs(newEyeY - eye[1]) > 0.01) {
        needsClamp = true;
      }

      if (needsClamp) {
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
  }, [getXeokitViewer, storeyMap, storeyPlugin]);

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
  }, [storeyMap, getXeokitViewer]);

  // Click to navigate — preserve camera heading
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

    // Cancel any ongoing flight
    viewer.cameraFlight?.cancel?.();

    // Get current camera heading to preserve direction
    const currentEye = viewer.camera.eye;
    const currentLook = viewer.camera.look;
    const headX = currentLook[0] - currentEye[0];
    const headZ = currentLook[2] - currentEye[2];
    const horizDist = Math.sqrt(headX * headX + headZ * headZ);
    const headUnit = horizDist > 0.01
      ? [headX / horizDist, headZ / horizDist]
      : [1, 0];
    const yOffset = currentEye[1] - currentLook[1];
    const safeDist = Math.max(horizDist, 3); // minimum 3m horizontal distance

    // For fallback, compute world pos from scene AABB
    if (usedFallbackRef.current || !plugin) {
      const aabb = viewer.scene?.aabb;
      if (!aabb) return;
      const normX = (e.clientX - rect.left) / rect.width;
      const normZ = (e.clientY - rect.top) / rect.height;
      const worldX = aabb[0] + normX * (aabb[3] - aabb[0]);
      const worldZ = aabb[2] + normZ * (aabb[5] - aabb[2]);
      const floorY = aabb[1];
      const newLook = [worldX, floorY, worldZ];
      const newEye = [
        newLook[0] - headUnit[0] * safeDist,
        newLook[1] + Math.max(yOffset, 3),
        newLook[2] - headUnit[1] * safeDist,
      ];
      viewer.cameraFlight?.flyTo({
        eye: newEye,
        look: newLook,
        up: [0, 1, 0],
        duration: 0,
      });
      return;
    }

    const worldPos = plugin.storeyMapToWorldPos(map, [imgX, imgY]);
    if (worldPos && viewer.cameraFlight) {
      const newLook = [worldPos[0], worldPos[1], worldPos[2]];
      const newEye = [
        newLook[0] - headUnit[0] * safeDist,
        newLook[1] + Math.max(yOffset, 3),
        newLook[2] - headUnit[1] * safeDist,
      ];
      viewer.cameraFlight.flyTo({
        eye: newEye,
        look: newLook,
        up: [0, 1, 0],
        duration: 0,
      });
    }
  }, [getXeokitViewer]);

  // Mouse move for hover
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanZoom(pz => ({ ...pz, offsetX: panStartRef.current!.ox + dx, offsetY: panStartRef.current!.oy + dy }));
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
      if (!rect) return { ...pz, scale: newScale };
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ox = mx - (mx - pz.offsetX) * (newScale / pz.scale);
      const oy = my - (my - pz.offsetY) * (newScale / pz.scale);
      return { offsetX: ox, offsetY: oy, scale: newScale };
    });
  }, []);

  // Pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      clickStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { x: e.clientX, y: e.clientY, ox: panZoom.offsetX, oy: panZoom.offsetY };
    }
  }, [panZoom]);

  const handleMouseUp = useCallback(() => {
    panStartRef.current = null;
  }, []);

  // Touch support
  const touchStartRef = useRef<{ x: number; y: number; ox: number; oy: number; dist?: number; scale?: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      clickStartRef.current = { x: t.clientX, y: t.clientY };
      touchStartRef.current = { x: t.clientX, y: t.clientY, ox: panZoom.offsetX, oy: panZoom.offsetY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      touchStartRef.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        ox: panZoom.offsetX, oy: panZoom.offsetY,
        dist, scale: panZoom.scale,
      };
    }
  }, [panZoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const ts = touchStartRef.current;
    if (!ts) return;
    if (e.touches.length === 1 && !ts.dist) {
      const dx = e.touches[0].clientX - ts.x;
      const dy = e.touches[0].clientY - ts.y;
      const newOx = ts.ox + dx;
      const newOy = ts.oy + dy;
      setPanZoom(pz => ({ ...pz, offsetX: newOx, offsetY: newOy }));
    } else if (e.touches.length === 2 && ts.dist) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scaleFactor = dist / ts.dist;
      const newScale = Math.max(0.3, Math.min(10, (ts.scale || 1) * scaleFactor));
      setPanZoom(pz => ({ ...pz, scale: newScale }));
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
    // Find matching floor from useFloorData
    const floor = floors.find(f => f.id === floorId);
    selectedFloorRef.current = {
      floorId: floorId,
      floorFmGuid: floor?.databaseLevelFmGuids?.[0] ?? null,
    };
    setSelectedFloorId(floorId);
    initialCenterApplied.current = false;
    mapCacheRef.current.delete(floorId); // force fresh generation if needed
    generateMap();
  }, [floors, generateMap]);

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
      {/* Mini floor dropdown */}
      {storeyMap && floors.length > 1 && (
        <div className="absolute top-2 left-2 z-20" onClick={(e) => e.stopPropagation()}>
          <Select value={selectedFloorId} onValueChange={handleFloorChange}>
            <SelectTrigger
              className="h-6 w-auto min-w-[70px] max-w-[120px] text-[10px] px-2 py-0 bg-card/95 backdrop-blur-sm border border-border shadow-sm rounded"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <SelectValue placeholder="Plan" />
            </SelectTrigger>
            <SelectContent>
              {floors.map(f => (
                <SelectItem key={f.id} value={f.id} className="text-[11px]">
                  {f.shortName || f.name}
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
            draggable={false}
            onClick={handleClick}
            onError={() => {
              console.error('[SplitPlanView] img onError — imageData URL failed to render');
              setImgError(true);
            }}
          />
          {/* Room labels overlay */}
          {roomLabels.length > 0 && imgRef.current && (
            <div
              className="absolute inset-0 pointer-events-none"
            >
              {roomLabels.map((label) => (
                <div
                  key={label.id}
                  className="absolute text-center pointer-events-none"
                  style={{
                    left: `${label.x}%`,
                    top: `${label.y}%`,
                    transform: 'translate(-50%, -50%)',
                    fontSize: '9px',
                    fontWeight: 500,
                    color: '#000000',
                    textShadow: '0 0 3px white, 0 0 3px white, 0 0 5px white',
                    whiteSpace: 'nowrap',
                    maxWidth: '80px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {label.number && <div style={{ fontWeight: 600 }}>{label.number}</div>}
                  {label.name && <div style={{ fontSize: '8px', opacity: 0.85 }}>{label.name}</div>}
                </div>
              ))}
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

      {/* Camera position overlay */}
      {storeyMap && !imgError && cameraPos && imgRef.current && (
        (() => {
          const imgEl = imgRef.current;
          const containerEl = containerRef.current;
          if (!imgEl || !containerEl) return null;
          const imgRect = imgEl.getBoundingClientRect();
          const containerRect = containerEl.getBoundingClientRect();
          const screenX = imgRect.left + (cameraPos.x / 100) * imgRect.width;
          const screenY = imgRect.top + (cameraPos.y / 100) * imgRect.height;
          const relX = screenX - containerRect.left;
          const relY = screenY - containerRect.top;
          return (
            <div
              className="absolute pointer-events-none z-10"
              style={{ left: `${relX}px`, top: `${relY}px` }}
            >
              {/* FOV cone */}
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  width: 0, height: 0,
                  borderLeft: '20px solid transparent',
                  borderRight: '20px solid transparent',
                  borderBottom: '35px solid hsl(var(--primary) / 0.15)',
                  transform: `translate(-50%, -50%) rotate(${cameraPos.angle - Math.PI / 2}rad)`,
                  transformOrigin: 'center bottom',
                }}
              />
              {/* Camera dot */}
              <div className="absolute w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground shadow-lg -translate-x-1/2 -translate-y-1/2" />
            </div>
          );
        })()
      )}
    </div>
  );
};

export default SplitPlanView;
