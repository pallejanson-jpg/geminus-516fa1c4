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
import { RefreshCw } from 'lucide-react';

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
  const [storeyMap, setStoreyMap] = useState<any>(null);
  const [storeyPlugin, setStoreyPlugin] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panZoom, setPanZoom] = useState<PanZoom>({ offsetX: 0, offsetY: 0, scale: 1 });
  const [cameraPos, setCameraPos] = useState<{ x: number; y: number; angle: number } | null>(null);
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);
  const storeyMapRef = useRef<any>(null);
  const pluginRef = useRef<any>(null);
  const selectedFloorRef = useRef<{ floorId: string | null; floorFmGuid: string | null }>({ floorId: null, floorFmGuid: null });
  const sdkRef = useRef<any>(null);
  const initAttemptRef = useRef(0);

  const normalizeGuidKey = useCallback((value?: string | null) => (value || '').toLowerCase().replace(/-/g, ''), []);

  const getXeokitViewer = useCallback(() => {
    try {
      // First try the native xeokit viewer (used by NativeViewerShell)
      const nativeViewer = (window as any).__nativeXeokitViewer;
      if (nativeViewer?.scene) return nativeViewer;
      // Fallback to Asset+ viewer ref chain
      const v = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (v) return v;
      return null;
    } catch { return null; }
  }, [viewerRef]);

  // Load SDK once
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sdk = await (Function('return import("/lib/xeokit/xeokit-sdk.es.js")')() as Promise<any>);
        if (mounted) sdkRef.current = sdk;
      } catch (e) {
        console.warn('[SplitPlanView] SDK load failed:', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Initialize StoreyViewsPlugin — keep retrying until viewer has models with metaObjects
  useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryInit = () => {
      if (!mounted) return;
      const viewer = getXeokitViewer();
      const sdk = sdkRef.current;

      if (!viewer?.scene || !sdk?.StoreyViewsPlugin) {
        if (initAttemptRef.current++ < 60) {
          retryTimer = setTimeout(tryInit, 500);
        } else if (mounted) {
          setError('Viewer not available');
        }
        return;
      }

      // Check that metaScene has IfcBuildingStorey objects — if not, models aren't loaded yet
      const metaObjects = viewer.metaScene?.metaObjects || {};
      const hasStoreys = Object.values(metaObjects).some(
        (mo: any) => mo?.type?.toLowerCase() === 'ifcbuildingstorey'
      );

      if (!hasStoreys) {
        if (initAttemptRef.current++ < 60) {
          retryTimer = setTimeout(tryInit, 500);
        }
        return;
      }

      try {
        // Check if plugin already exists
        let plugin = viewer.plugins?.StoreyViews;
        if (!plugin) {
          plugin = new sdk.StoreyViewsPlugin(viewer, { fitStoreyMaps: true });
        }

        // Verify the plugin actually found storeys
        const storeyKeys = Object.keys(plugin.storeys || {});
        if (storeyKeys.length === 0) {
          // Plugin created but no storeys registered yet — destroy and retry
          console.debug('[SplitPlanView] Plugin has 0 storeys, retrying...');
          try { plugin.destroy?.(); } catch {}
          if (initAttemptRef.current++ < 60) {
            retryTimer = setTimeout(tryInit, 1000);
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
        if (mounted) setError('Could not initialize plan view');
      }
    };

    tryInit();

    // Also listen for VIEWER_MODELS_LOADED to retry
    const modelsHandler = () => {
      initAttemptRef.current = 0; // reset counter
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

    // 1) Use explicit selected floor from floor picker event
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

    // 2) Fallback: choose storey with most descendants
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

  // Generate storey map
  const generateMap = useCallback(() => {
    const plugin = pluginRef.current;
    const viewer = getXeokitViewer();
    if (!plugin || !viewer?.scene) return;

    const storeyKeys = Object.keys(plugin.storeys || {});
    if (storeyKeys.length === 0) return;

    setIsLoading(true);

    const preferredStoreyId = findCurrentStoreyId();
    const candidateStoreys = preferredStoreyId
      ? [preferredStoreyId, ...storeyKeys.filter((id) => id !== preferredStoreyId)]
      : storeyKeys;

    const tryCreateStoreyMap = (storeyId: string, forceRenderable: boolean) => {
      const container = containerRef.current;
      const width = container ? Math.min(container.clientWidth * 2, 1600) : 800;

      if (!forceRenderable) {
        return plugin.createStoreyMap(storeyId, { width, format: 'png' });
      }

      const scene = viewer.scene;
      const hiddenIds: string[] = [];
      const culledIds: string[] = [];
      const sectionPlanes = Object.values(scene.sectionPlanes || {}) as any[];
      const activeSectionPlanes = sectionPlanes.filter((sp) => sp?.active);
      activeSectionPlanes.forEach((sp) => { sp.active = false; });

      const objectIds = scene.objectIds || [];
      objectIds.forEach((id: string) => {
        const entity = scene.objects?.[id];
        if (!entity) return;
        if (!entity.visible) { hiddenIds.push(id); entity.visible = true; }
        if (entity.culled) { culledIds.push(id); entity.culled = false; }
      });

      try {
        return plugin.createStoreyMap(storeyId, { width, format: 'png' });
      } finally {
        hiddenIds.forEach(id => { const e = scene.objects?.[id]; if (e) e.visible = false; });
        culledIds.forEach(id => { const e = scene.objects?.[id]; if (e) e.culled = true; });
        activeSectionPlanes.forEach((sp) => { sp.active = true; });
      }
    };

    try {
      let map: any = null;
      for (const storeyId of candidateStoreys.slice(0, 6)) {
        map = tryCreateStoreyMap(storeyId, false);
        if (map?.imageData) break;
        map = tryCreateStoreyMap(storeyId, true);
        if (map?.imageData) break;
      }

      if (map?.imageData) {
        console.debug(`[SplitPlanView] Map generated for storey ${map.storeyId || preferredStoreyId}`);
        setStoreyMap(map);
        storeyMapRef.current = map;
        setError(null);
      } else {
        setError('Could not generate plan image');
      }
    } catch (e) {
      console.warn('[SplitPlanView] createStoreyMap failed:', e);
      setError('Map generation failed');
    } finally {
      setIsLoading(false);
    }
  }, [getXeokitViewer, findCurrentStoreyId]);

  // Generate map when plugin is ready and on floor changes
  useEffect(() => {
    if (!storeyPlugin) return;

    // Generate immediately and with retries
    const t0 = setTimeout(generateMap, 100);
    const t1 = setTimeout(generateMap, 1000);
    const t2 = setTimeout(generateMap, 3000);
    const t3 = setTimeout(generateMap, 6000);

    const retryInterval = setInterval(() => {
      if (!storeyMapRef.current) {
        generateMap();
      }
    }, 2500);

    const modelsLoadedHandler = () => {
      setTimeout(generateMap, 300);
      setTimeout(generateMap, 1500);
    };
    window.addEventListener('VIEWER_MODELS_LOADED', modelsLoadedHandler);

    const floorHandler = (event: Event) => {
      const detail = (event as CustomEvent<FloorSelectionEventDetail>).detail;
      selectedFloorRef.current = {
        floorId: detail?.floorId ?? null,
        floorFmGuid: detail?.visibleFloorFmGuids?.[0] ?? null,
      };
      setPanZoom({ offsetX: 0, offsetY: 0, scale: 1 });
      setTimeout(generateMap, 100);
    };

    const viewer = getXeokitViewer();
    let modelLoadedSub: any = null;
    if (viewer?.scene) {
      modelLoadedSub = viewer.scene.on('modelLoaded', () => {
        setTimeout(generateMap, 500);
      });
    }

    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, floorHandler);
    return () => {
      clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      clearInterval(retryInterval);
      window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, floorHandler);
      window.removeEventListener('VIEWER_MODELS_LOADED', modelsLoadedHandler);
      if (modelLoadedSub !== null && viewer?.scene) viewer.scene.off(modelLoadedSub);
    };
  }, [storeyPlugin, generateMap, getXeokitViewer]);

  // Camera position overlay
  useEffect(() => {
    const updateCamera = () => {
      const viewer = getXeokitViewer();
      const map = storeyMapRef.current;
      const plugin = pluginRef.current;
      if (!viewer?.camera?.eye || !map || !plugin) return;

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
    if (!plugin || !map || !img || !viewer) return;

    const rect = img.getBoundingClientRect();
    const imgX = (e.clientX - rect.left) / rect.width * map.width;
    const imgY = (e.clientY - rect.top) / rect.height * map.height;

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
    if (e.touches.length === 1 && touchStartRef.current && !touchStartRef.current.dist) {
      const dx = e.touches[0].clientX - touchStartRef.current.x;
      const dy = e.touches[0].clientY - touchStartRef.current.y;
      setPanZoom(pz => ({ ...pz, offsetX: touchStartRef.current!.ox + dx, offsetY: touchStartRef.current!.oy + dy }));
    } else if (e.touches.length === 2 && touchStartRef.current?.dist) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scaleFactor = dist / touchStartRef.current.dist;
      const newScale = Math.max(0.3, Math.min(10, (touchStartRef.current.scale || 1) * scaleFactor));
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
      className={cn('relative w-full h-full bg-background overflow-hidden select-none', className)}
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
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading plan view...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !storeyMap && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">{error}</span>
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
          />
        </div>
      )}

      {/* Camera position overlay */}
      {storeyMap && cameraPos && imgRef.current && (
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

      {/* Controls info */}
      <div className="absolute bottom-3 right-3 text-[10px] text-muted-foreground/60 pointer-events-none z-20">
        {Math.round(panZoom.scale * 100)}%
      </div>

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
