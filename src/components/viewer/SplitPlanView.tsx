/**
 * SplitPlanView — 2D floor plan using xeokit StoreyViewsPlugin.
 *
 * Uses StoreyViewsPlugin.createStoreyMap() for high-quality orthographic plan images
 * and pickStoreyMap() / storeyMapToWorldPos() for click-to-navigate.
 * Supports pan/zoom and shows a live camera position indicator.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { FLOOR_SELECTION_CHANGED_EVENT } from '@/hooks/useSectionPlaneClipping';
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

  // Initialize StoreyViewsPlugin
  useEffect(() => {
    let mounted = true;
    let attempts = 0;
    const maxAttempts = 30;

    const tryInit = async () => {
      const viewer = getXeokitViewer();
      if (!viewer?.scene) {
        if (attempts++ < maxAttempts) setTimeout(tryInit, 500);
        else if (mounted) setError('Viewer not available');
        return;
      }

      try {
        const sdk = await (Function('return import("/lib/xeokit/xeokit-sdk.es.js")')() as Promise<any>);
        const { StoreyViewsPlugin } = sdk;

        // Check if plugin already exists
        let plugin = viewer.plugins?.StoreyViews;
        if (!plugin) {
          plugin = new StoreyViewsPlugin(viewer, { fitStoreyMaps: true });
        }

        if (mounted) {
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
    return () => { mounted = false; };
  }, [getXeokitViewer]);

  // Find current storey ID based on visible floor
  const findCurrentStoreyId = useCallback((): string | null => {
    const plugin = pluginRef.current;
    if (!plugin?.storeys) return null;

    const storeyIds = Object.keys(plugin.storeys);
    if (storeyIds.length === 0) return null;

    // Try to find the storey with the most visible objects
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return storeyIds[0];

    let bestId = storeyIds[0];
    let bestCount = 0;

    for (const id of storeyIds) {
      const storey = plugin.storeys[id];
      if (!storey) continue;
      // Count visible objects in this storey's AABB range
      const sAABB = storey.storeyAABB;
      let count = 0;
      const metaScene = viewer.metaScene;
      if (metaScene?.metaObjects) {
        for (const moId in metaScene.metaObjects) {
          const mo = metaScene.metaObjects[moId];
          if (mo?.type?.toLowerCase() !== 'ifcspace') continue;
          const obj = viewer.scene.objects?.[mo.id];
          if (!obj?.visible || !obj?.aabb) continue;
          // Check if object's Y center is within storey Y range
          const objYCenter = (obj.aabb[1] + obj.aabb[4]) / 2;
          if (objYCenter >= sAABB[1] && objYCenter <= sAABB[4]) {
            count++;
          }
        }
      }
      if (count > bestCount) {
        bestCount = count;
        bestId = id;
      }
    }

    return bestId;
  }, [getXeokitViewer]);

  // Generate storey map
  const generateMap = useCallback(() => {
    const plugin = pluginRef.current;
    const viewer = getXeokitViewer();
    if (!plugin || !viewer?.scene) return;

    const storeyId = findCurrentStoreyId();
    if (!storeyId) {
      console.debug('[SplitPlanView] No storeys found yet, will retry on model load');
      return;
    }

    try {
      const container = containerRef.current;
      const width = container ? Math.min(container.clientWidth * 2, 1600) : 800;

      // Temporarily make all objects visible for storey map rendering
      // (IfcSpace objects are hidden by default in our viewer but needed for plan rendering)
      const scene = viewer.scene;
      const hiddenIds: string[] = [];
      const objectIds = scene.objectIds || [];
      objectIds.forEach((id: string) => {
        const entity = scene.objects?.[id];
        if (entity && !entity.visible) {
          hiddenIds.push(id);
          entity.visible = true;
        }
      });

      const map = plugin.createStoreyMap(storeyId, {
        width,
        format: 'png',
      });

      // Restore hidden objects
      hiddenIds.forEach(id => {
        const entity = scene.objects?.[id];
        if (entity) entity.visible = false;
      });

      if (map?.imageData) {
        setStoreyMap(map);
        storeyMapRef.current = map;
        setError(null);
        setIsLoading(false);
      } else {
        setError('Could not generate plan');
      }
    } catch (e) {
      console.warn('createStoreyMap failed:', e);
      setError('Plan generation failed');
    }
  }, [getXeokitViewer, findCurrentStoreyId]);

  // Generate map when plugin is ready and on floor changes
  useEffect(() => {
    if (!storeyPlugin) return;

    // Wait longer for models to fully load their metaobjects
    const timeout = setTimeout(generateMap, 2000);
    const retry1 = setTimeout(generateMap, 4000);
    const retry2 = setTimeout(generateMap, 7000);

    // Also listen for VIEWER_MODELS_LOADED (fired by NativeXeokitViewer)
    const modelsLoadedHandler = () => setTimeout(generateMap, 1000);
    window.addEventListener('VIEWER_MODELS_LOADED', modelsLoadedHandler);

    const floorHandler = () => {
      setPanZoom({ offsetX: 0, offsetY: 0, scale: 1 });
      setTimeout(generateMap, 300);
    };

    // Listen for model loaded events to regenerate
    const viewer = getXeokitViewer();
    let modelLoadedSub: any = null;
    if (viewer?.scene) {
      modelLoadedSub = viewer.scene.on('modelLoaded', () => {
        setTimeout(generateMap, 500);
      });
    }

    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, floorHandler);
    return () => {
      clearTimeout(timeout);
      clearTimeout(retry1);
      clearTimeout(retry2);
      window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, floorHandler);
      if (modelLoadedSub !== null && viewer?.scene) {
        viewer.scene.off(modelLoadedSub);
      }
    };
  }, [storeyPlugin, generateMap, getXeokitViewer]);

  // Camera position overlay — update periodically
  useEffect(() => {
    const updateCamera = () => {
      const viewer = getXeokitViewer();
      const map = storeyMapRef.current;
      const plugin = pluginRef.current;
      if (!viewer?.camera?.eye || !map || !plugin) return;

      const storey = plugin.storeys[map.storeyId];
      if (!storey) return;

      // Use the same AABB the plugin uses (fitStoreyMaps → storeyAABB)
      const aabb = plugin._fitStoreyMaps ? storey.storeyAABB : storey.modelAABB;
      const eye = viewer.camera.eye;
      const look = viewer.camera.look;

      // Map world coords to image coords (matching pickStoreyMap's inverse: normX = 1 - imageX/width)
      const normX = (eye[0] - aabb[0]) / (aabb[3] - aabb[0]);
      const normZ = (eye[2] - aabb[2]) / (aabb[5] - aabb[2]);
      const imgX = (1.0 - normX) * map.width;
      const imgY = (1.0 - normZ) * map.height;

      // Direction angle
      const dx = look[0] - eye[0];
      const dz = look[2] - eye[2];
      const angle = Math.atan2(-dz, -dx); // Invert to match image coordinate space

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
      if (dx > 5 || dy > 5) return; // was a drag
    }

    const plugin = pluginRef.current;
    const map = storeyMapRef.current;
    const img = imgRef.current;
    const viewer = getXeokitViewer();
    if (!plugin || !map || !img || !viewer) return;

    const rect = img.getBoundingClientRect();
    const imgX = (e.clientX - rect.left) / rect.width * map.width;
    const imgY = (e.clientY - rect.top) / rect.height * map.height;

    // Use storeyMapToWorldPos for reliable coordinate mapping
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

    // Hover pick
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
        ox: panZoom.offsetX,
        oy: panZoom.offsetY,
        dist,
        scale: panZoom.scale,
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
        // Simulate click
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
              width: 0,
              height: 0,
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
        {Math.round(panZoom.scale * 100)}% · Drag = pan · Scroll = zoom
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
