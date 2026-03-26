/**
 * MinimapPanel — Draggable/resizable minimap using xeokit StoreyViewsPlugin.
 *
 * Uses StoreyViewsPlugin.createStoreyMap() for high-quality plan images
 * and shows a live camera position indicator.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, RefreshCw, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MinimapPanelProps {
  viewerRef: React.MutableRefObject<any>;
  isVisible: boolean;
  onClose: () => void;
  onRoomClick?: (fmGuid: string) => void;
}

type SizePreset = 'mini' | 'medium' | 'large';

const SIZE_PRESETS: Record<SizePreset, { width: number; height: number }> = {
  mini: { width: 240, height: 200 },
  medium: { width: 400, height: 350 },
  large: { width: 0, height: 0 },
};

const MinimapPanel: React.FC<MinimapPanelProps> = ({ viewerRef, isVisible, onClose, onRoomClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ width: 240, height: 200 });
  const [sizePreset, setSizePreset] = useState<SizePreset>('mini');
  const [mapData, setMapData] = useState<{ imageData: string; width: number; height: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cameraPos, setCameraPos] = useState<{ x: number; y: number } | null>(null);
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const pluginRef = useRef<any>(null);
  const storeyMapRef = useRef<any>(null);

  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer
        ?? (window as any).__nativeXeokitViewer
        ?? null;
    } catch { return null; }
  }, [viewerRef]);

  const getLargeSize = useCallback(() => ({
    width: Math.floor(window.innerWidth * 0.48),
    height: Math.floor(window.innerHeight * 0.48),
  }), []);

  const applyPreset = useCallback((preset: SizePreset) => {
    setSizePreset(preset);
    setSize(preset === 'large' ? getLargeSize() : SIZE_PRESETS[preset]);
  }, [getLargeSize]);

  // Resize handle
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartRef.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height };

    const handleMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const dx = ev.clientX - resizeStartRef.current.x;
      const dy = ev.clientY - resizeStartRef.current.y;
      const newW = Math.max(200, Math.min(window.innerWidth * 0.6, resizeStartRef.current.w + dx));
      const newH = Math.max(160, Math.min(window.innerHeight * 0.6, resizeStartRef.current.h + dy));
      setSize({ width: newW, height: newH });
      setSizePreset(newW > 380 ? (newW > window.innerWidth * 0.35 ? 'large' : 'medium') : 'mini');
    };

    const handleUp = () => {
      isResizingRef.current = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [size]);

  // Initialize StoreyViewsPlugin
  useEffect(() => {
    if (!isVisible) return;
    let mounted = true;

    const tryInit = async () => {
      const viewer = getXeokitViewer();
      if (!viewer?.scene) {
        setTimeout(tryInit, 500);
        return;
      }

      try {
        const sdk = await (Function('return import("/lib/xeokit/xeokit-sdk.es.js")')() as Promise<any>);
        const { StoreyViewsPlugin } = sdk;

        let plugin = viewer.plugins?.StoreyViews;
        if (!plugin) {
          plugin = new StoreyViewsPlugin(viewer, { fitStoreyMaps: true });
        }

        if (mounted) {
          pluginRef.current = plugin;
        }
      } catch (e) {
        console.warn('MinimapPanel: StoreyViewsPlugin init failed:', e);
      }
    };

    tryInit();
    return () => { mounted = false; };
  }, [isVisible, getXeokitViewer]);

  // Find current storey
  const findCurrentStoreyId = useCallback((): string | null => {
    const plugin = pluginRef.current;
    if (!plugin?.storeys) return null;
    const storeyIds = Object.keys(plugin.storeys);
    if (storeyIds.length === 0) return null;

    const viewer = getXeokitViewer();
    if (!viewer?.scene) return storeyIds[0];

    let bestId = storeyIds[0];
    let bestCount = 0;
    for (const id of storeyIds) {
      const storey = plugin.storeys[id];
      if (!storey) continue;
      const sAABB = storey.storeyAABB;
      let count = 0;
      const metaScene = viewer.metaScene;
      if (metaScene?.metaObjects) {
        for (const moId in metaScene.metaObjects) {
          const mo = metaScene.metaObjects[moId];
          if (mo?.type?.toLowerCase() !== 'ifcspace') continue;
          const obj = viewer.scene.objects?.[mo.id];
          if (!obj?.visible || !obj?.aabb) continue;
          const objY = (obj.aabb[1] + obj.aabb[4]) / 2;
          if (objY >= sAABB[1] && objY <= sAABB[4]) count++;
        }
      }
      if (count > bestCount) { bestCount = count; bestId = id; }
    }
    return bestId;
  }, [getXeokitViewer]);

  // Generate map
  const generateMap = useCallback(() => {
    const plugin = pluginRef.current;
    const viewer = getXeokitViewer();
    if (!plugin || !viewer?.scene) {
      setIsLoading(true);
      return;
    }

    setIsLoading(true);
    setError(null);

    const storeyId = findCurrentStoreyId();
    if (!storeyId) {
      setError('Loading model...');
      setIsLoading(false);
      return;
    }

    try {
      const mapWidth = Math.min(size.width * 2, 800);
      const map = plugin.createStoreyMap(storeyId, { width: mapWidth, format: 'png' });

      if (map?.imageData) {
        setMapData({ imageData: map.imageData, width: map.width, height: map.height });
        storeyMapRef.current = map;
        setError(null);
      } else {
        setError('Could not generate map');
      }
    } catch (e) {
      console.warn('Minimap generation failed:', e);
      setError('Map generation failed');
    }
    setIsLoading(false);
  }, [getXeokitViewer, findCurrentStoreyId, size.width]);

  // Periodic update
  useEffect(() => {
    if (!isVisible) return;
    const timeout = setTimeout(generateMap, 800);
    const interval = setInterval(generateMap, 3000);
    return () => { clearTimeout(timeout); clearInterval(interval); };
  }, [isVisible, generateMap]);

  // Camera position — use xeokit's built-in worldPosToStoreyMap for accuracy
  useEffect(() => {
    if (!isVisible) return;
    const update = () => {
      const viewer = getXeokitViewer();
      const map = storeyMapRef.current;
      const plugin = pluginRef.current;
      if (!viewer?.camera?.eye || !map || !plugin) return;

      const eye = viewer.camera.eye;

      // Use xeokit's built-in worldPosToStoreyMap if available
      if (typeof plugin.worldPosToStoreyMap === 'function') {
        const imagePos = [0, 0];
        try {
          plugin.worldPosToStoreyMap(map, [eye[0], eye[1], eye[2]], imagePos);
          setCameraPos({
            x: (imagePos[0] / map.width) * 100,
            y: (imagePos[1] / map.height) * 100,
          });
          return;
        } catch (e) {
          // Fall through to manual calc
        }
      }

      // Fallback: manual calculation
      const storey = plugin.storeys[map.storeyId];
      if (!storey) return;

      const aabb = plugin._fitStoreyMaps ? storey.storeyAABB : storey.modelAABB;
      const normX = (eye[0] - aabb[0]) / (aabb[3] - aabb[0]);
      const normZ = (eye[2] - aabb[2]) / (aabb[5] - aabb[2]);

      setCameraPos({
        x: (1.0 - normX) * 100,
        y: (1.0 - normZ) * 100,
      });
    };

    const interval = setInterval(update, 200);
    update();
    return () => clearInterval(interval);
  }, [isVisible, getXeokitViewer]);

  // Click to navigate
  const handleClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
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

  if (!isVisible) return null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute top-14 left-3 z-20",
        "bg-card/95 backdrop-blur-md border border-border/30 rounded-lg shadow-xl",
        "overflow-hidden transition-all duration-200"
      )}
      style={{ width: size.width, height: size.height }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/30">
        <span className="text-xs font-medium text-foreground/90">Overview</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={generateMap} title="Refresh">
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </Button>
          {(['mini', 'medium', 'large'] as SizePreset[]).map(preset => (
            <Button
              key={preset}
              variant={sizePreset === preset ? 'secondary' : 'ghost'}
              size="icon"
              className="h-6 w-6 text-[10px] font-bold"
              onClick={() => applyPreset(preset)}
              title={preset === 'mini' ? 'Small' : preset === 'medium' ? 'Medium' : 'Large (~50%)'}
            >
              {preset === 'mini' ? 'S' : preset === 'medium' ? 'M' : 'L'}
            </Button>
          ))}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Map content */}
      <div className="relative w-full bg-background" style={{ height: size.height - 40 }}>
        {isLoading && !mapData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span className="text-xs">Loading map...</span>
            </div>
          </div>
        )}
        {error && !mapData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">{error}</span>
          </div>
        )}
        {mapData && (
          <div className="relative w-full h-full">
            <img
              ref={imgRef}
              src={mapData.imageData}
              alt="Floor plan minimap"
              className="w-full h-full object-contain cursor-crosshair"
              onClick={handleClick}
              draggable={false}
            />
            {/* Camera dot */}
            {cameraPos && (
              <div
                className="absolute w-2.5 h-2.5 rounded-full bg-primary border border-primary-foreground shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${cameraPos.x}%`, top: `${cameraPos.y}%` }}
              />
            )}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity"
        onMouseDown={handleResizeStart}
        title="Drag to resize"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground rotate-[-45deg]" />
      </div>
    </div>
  );
};

export default MinimapPanel;
