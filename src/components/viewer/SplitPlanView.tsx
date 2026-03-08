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

interface DiagInfo {
  viewerReady: boolean;
  metaStoreyCount: number;
  pluginStoreyCount: number;
  lastTriedStoreyId: string | null;
  imageDataLength: number;
  lastError: string | null;
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
        // Check if NativeXeokitViewer already exposed the SDK
        const globalSdk = (window as any).__xeokitSdk;
        if (globalSdk?.StoreyViewsPlugin) {
          if (mounted) sdkRef.current = globalSdk;
          console.log('[SplitPlanView] Using shared global SDK');
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

  // Initialize StoreyViewsPlugin — triggered by VIEWER_MODELS_LOADED event
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
        if (initAttemptRef.current++ < 90) {
          retryTimer = setTimeout(tryInit, 300);
        } else if (mounted) {
          setError(!viewer?.scene ? 'Viewer not available' : 'SDK StoreyViewsPlugin missing');
        }
        return;
      }

      if (metaStoreyCount === 0) {
        if (initAttemptRef.current++ < 90) {
          retryTimer = setTimeout(tryInit, 300);
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
          console.debug('[SplitPlanView] Plugin has 0 storeys, retrying...');
          try { plugin.destroy?.(); } catch {}
          if (initAttemptRef.current++ < 60) {
            retryTimer = setTimeout(tryInit, 1000);
          }
          return;
        }

        if (mounted) {
          console.log(`[SplitPlanView] StoreyViewsPlugin ready with ${storeyKeys.length} storeys (meta: ${metaStoreyCount})`);
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
      retryTimer = setTimeout(tryInit, 300);
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

    const selectedFloorId = selectedFloorRef.current.floorId;
    if (selectedFloorId && plugin.storeys[selectedFloorId]) {
      return selectedFloorId;
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

  // Generate a fallback snapshot via top-down camera capture
  const generateFallbackSnapshot = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    try {
      const scene = viewer.scene;
      const camera = viewer.camera;
      // Save current camera state
      const origEye = [...camera.eye];
      const origLook = [...camera.look];
      const origUp = [...camera.up];
      const origProjection = camera.projection;

      // Set top-down ortho view
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

      // Force a render frame
      scene.glRedraw?.();

      // Capture the canvas
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
              console.log('[SplitPlanView] Fallback snapshot generated');
            }
          }
        } catch (snapErr) {
          console.warn('[SplitPlanView] Fallback snapshot capture failed:', snapErr);
        } finally {
          // Restore camera
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

    // Use requestIdleCallback so UI can render "Loading…" first
    const doGenerate = () => {
      const container = containerRef.current;
      // Lower resolution on mobile for speed
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
          console.log(`[SplitPlanView] Map generated: storey=${preferredStoreyId}, size=${map.imageData.length}`);
          mapCacheRef.current.set(cacheKey, map);
          setStoreyMap(map);
          storeyMapRef.current = map;
          setError(null);
          setImgError(false);
          usedFallbackRef.current = false;
        } else {
          console.warn('[SplitPlanView] StoreyMap empty, trying fallback');
          generateFallbackSnapshot();
        }
      } catch (e) {
        restoreColors();
        console.warn('[SplitPlanView] createStoreyMap failed:', e);
        generateFallbackSnapshot();
      } finally {
        setIsLoading(false);
      }
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => doGenerate(), { timeout: 3000 });
    } else {
      setTimeout(doGenerate, 50);
    }
  }, [getXeokitViewer, findCurrentStoreyId, generateFallbackSnapshot, isMobile]);

  // Generate map once when plugin is ready, and on floor changes (no polling/retry intervals)
  useEffect(() => {
    if (!storeyPlugin) return;

    // Single initial generation
    const t0 = setTimeout(generateMap, 200);

    // Listen for floor changes
    const floorHandler = (event: Event) => {
      const detail = (event as CustomEvent<FloorSelectionEventDetail>).detail;
      selectedFloorRef.current = {
        floorId: detail?.floorId ?? null,
        floorFmGuid: detail?.visibleFloorFmGuids?.[0] ?? null,
      };
      setPanZoom({ offsetX: 0, offsetY: 0, scale: 0.75 });
      setTimeout(generateMap, 100);
    };

    // Listen for models loaded (re-generate once)
    const modelsLoadedHandler = () => {
      // Invalidate cache since new models loaded
      mapCacheRef.current.clear();
      wallIdCacheRef.current.clear();
      setTimeout(generateMap, 500);
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
        console.log('[SplitPlanView] No plugin after 15s, trying fallback snapshot...');
        generateFallbackSnapshot();
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [storeyPlugin, generateFallbackSnapshot]);

  // Camera position overlay
  useEffect(() => {
    const updateCamera = () => {
      const viewer = getXeokitViewer();
      const map = storeyMapRef.current;
      const plugin = pluginRef.current;
      if (!viewer?.camera?.eye || !map) return;

      // For fallback snapshots, use scene AABB
      if (usedFallbackRef.current || !plugin) {
        const aabb = viewer.scene?.aabb;
        if (!aabb) return;
        const eye = viewer.camera.eye;
        const look = viewer.camera.look;
        const normX = (eye[0] - aabb[0]) / (aabb[3] - aabb[0]);
        const normZ = (eye[2] - aabb[2]) / (aabb[5] - aabb[2]);
        const dx = look[0] - eye[0];
        const dz = look[2] - eye[2];
        const angle = Math.atan2(-dz, -dx);
        setCameraPos({ x: normX * 100, y: normZ * 100, angle });
        return;
      }

      const storey = plugin.storeys[map.storeyId];
      if (!storey) return;

      const aabb = plugin._fitStoreyMaps ? storey.storeyAABB : storey.modelAABB;
      const eye = viewer.camera.eye;
      const look = viewer.camera.look;

      const normX = (eye[0] - aabb[0]) / (aabb[3] - aabb[0]);
      const normZ = (eye[2] - aabb[2]) / (aabb[5] - aabb[2]);
      const imgX = (1.0 - normX) * map.width;
      const imgY = (1.0 - normZ) * map.height;

      const dx = look[0] - eye[0];
      const dz = look[2] - eye[2];
      const angle = Math.atan2(-dz, -dx);

      setCameraPos({
        x: (imgX / map.width) * 100,
        y: (imgY / map.height) * 100,
        angle,
      });
    };

    const interval = setInterval(updateCamera, 100);
    updateCamera();
    return () => clearInterval(interval);
  }, [getXeokitViewer]);

  // Click to navigate
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

    // For fallback, compute world pos from scene AABB
    if (usedFallbackRef.current || !plugin) {
      const aabb = viewer.scene?.aabb;
      if (!aabb) return;
      const normX = (e.clientX - rect.left) / rect.width;
      const normZ = (e.clientY - rect.top) / rect.height;
      const worldX = aabb[0] + normX * (aabb[3] - aabb[0]);
      const worldZ = aabb[2] + normZ * (aabb[5] - aabb[2]);
      const worldY = (aabb[1] + aabb[4]) / 2;
      viewer.cameraFlight?.flyTo({
        eye: [worldX, viewer.camera.eye[1], worldZ],
        look: [worldX, worldY, worldZ],
        up: [0, 1, 0],
        duration: 0.8,
      });
      return;
    }

    const worldPos = plugin.storeyMapToWorldPos(map, [imgX, imgY]);
    if (worldPos && viewer.cameraFlight) {
      viewer.cameraFlight.flyTo({
        eye: [worldPos[0], viewer.camera.eye[1], worldPos[2]],
        look: [worldPos[0], worldPos[1], worldPos[2]],
        up: [0, 1, 0],
        duration: 0.8,
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

  

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full overflow-hidden select-none', className)}
      style={{ backgroundColor: '#ffffff' }} // Always white background for plan contrast
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { panStartRef.current = null; setHoveredEntity(null); }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
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

      {/* Plan image */}
      {storeyMap && (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            transform: `translate(${panZoom.offsetX}px, ${panZoom.offsetY}px) scale(${panZoom.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <img
            ref={imgRef}
            src={storeyMap.imageData}
            alt="Floor plan"
            className="max-w-full max-h-full object-contain cursor-crosshair"
            draggable={false}
            onClick={handleClick}
            onError={() => {
              console.error('[SplitPlanView] img onError — imageData URL failed to render');
              setImgError(true);
              setDiag(prev => ({ ...prev, lastError: 'img onError' }));
            }}
          />
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
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: `calc(${cameraPos.x}% * ${panZoom.scale} + ${panZoom.offsetX}px)`,
            top: `calc(${cameraPos.y}% * ${panZoom.scale} + ${panZoom.offsetY}px)`,
          }}
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
      )}

      {/* Hovered entity tooltip */}
      {hoveredEntity && (
        <div className="absolute top-3 left-3 bg-card/90 backdrop-blur-sm text-foreground text-xs px-3 py-1.5 rounded-md border border-border/50 pointer-events-none z-20">
          {hoveredEntity}
        </div>
      )}


      {/* Refresh button */}
      <button
        className="absolute top-3 right-3 p-1.5 rounded-md bg-card/80 backdrop-blur-sm border border-border/50 text-muted-foreground hover:text-foreground transition-colors z-20"
        onClick={(e) => { e.stopPropagation(); generateMap(); }}
        title="Refresh plan"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>

    </div>
  );
};

export default SplitPlanView;
