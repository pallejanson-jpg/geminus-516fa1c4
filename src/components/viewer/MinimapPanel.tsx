import React, { useState, useRef, useCallback, useEffect, useContext } from 'react';
import { X, Maximize2, Minimize2, RefreshCw, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';

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
  large: { width: 0, height: 0 }, // Calculated dynamically from viewport
};

const MinimapPanel: React.FC<MinimapPanelProps> = ({ viewerRef, isVisible, onClose, onRoomClick }) => {
  const { allData } = useContext(AppContext);
  const minimapContainerRef = useRef<HTMLDivElement>(null);
  const minimapImageRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ width: 240, height: 200 });
  const [sizePreset, setSizePreset] = useState<SizePreset>('mini');
  const [storeyMapData, setStoreyMapData] = useState<{ imageData: string; width: number; height: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  // Calculate large preset from viewport
  const getLargeSize = useCallback(() => ({
    width: Math.floor(window.innerWidth * 0.48),
    height: Math.floor(window.innerHeight * 0.48),
  }), []);

  const applyPreset = useCallback((preset: SizePreset) => {
    setSizePreset(preset);
    if (preset === 'large') {
      setSize(getLargeSize());
    } else {
      setSize(SIZE_PRESETS[preset]);
    }
  }, [getLargeSize]);

  // Drag-to-resize handler
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

  // Generate minimap from scene AABB + spaces
  const generateStoreyMap = useCallback(async () => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const scene = xeokitViewer.scene;
      if (!scene) { setError('Scene ej tillgänglig'); setIsLoading(false); return; }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { setError('Canvas ej tillgänglig'); setIsLoading(false); return; }

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = size.width * pixelRatio;
      canvas.height = (size.height - 40) * pixelRatio;

      const aabb = scene.getAABB?.() || scene.aabb;
      if (!aabb || aabb.length < 6 || !isFinite(aabb[0])) {
        setError('Laddar modell...');
        setIsLoading(false);
        return;
      }

      const modelWidth = aabb[3] - aabb[0];
      const modelDepth = aabb[5] - aabb[2];
      const padding = 20 * pixelRatio;
      const scaleX = (canvas.width - padding * 2) / modelWidth;
      const scaleZ = (canvas.height - padding * 2) / modelDepth;
      const scale = Math.min(scaleX, scaleZ);
      const offsetX = padding + (canvas.width - padding * 2 - modelWidth * scale) / 2;
      const offsetZ = padding + (canvas.height - padding * 2 - modelDepth * scale) / 2;

      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#3a3a5a';
      ctx.lineWidth = 2;
      ctx.strokeRect(offsetX, offsetZ, modelWidth * scale, modelDepth * scale);

      // Draw rooms
      const metaScene = xeokitViewer.metaScene;
      if (metaScene?.metaObjects) {
        Object.values(metaScene.metaObjects).forEach((metaObject: any) => {
          if (metaObject?.type?.toLowerCase() === 'ifcspace') {
            const sceneObject = scene.objects?.[metaObject.id];
            if (!sceneObject?.visible) return;
            try {
              const objAABB = sceneObject.aabb;
              if (objAABB && objAABB.length >= 6) {
                const x = offsetX + (objAABB[0] - aabb[0]) * scale;
                const z = offsetZ + (objAABB[2] - aabb[2]) * scale;
                const w = (objAABB[3] - objAABB[0]) * scale;
                const h = (objAABB[5] - objAABB[2]) * scale;

                ctx.fillStyle = 'rgba(100, 120, 180, 0.25)';
                ctx.fillRect(x, z, w, h);
                ctx.strokeStyle = 'rgba(150, 170, 220, 0.6)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x, z, w, h);

                if (w > 30 && h > 15) {
                  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                  ctx.font = `${10 * pixelRatio}px system-ui`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  const name = metaObject.name || '';
                  const maxChars = Math.floor(w / (6 * pixelRatio));
                  const displayName = name.length > maxChars ? name.substring(0, maxChars - 1) + '…' : name;
                  ctx.fillText(displayName, x + w / 2, z + h / 2);
                }
              }
            } catch (e) { /* skip */ }
          }
        });
      }

      // Camera indicator
      const camera = xeokitViewer.camera;
      if (camera?.eye && camera?.look) {
        const camX = offsetX + (camera.eye[0] - aabb[0]) * scale;
        const camZ = offsetZ + (camera.eye[2] - aabb[2]) * scale;
        const lookX = offsetX + (camera.look[0] - aabb[0]) * scale;
        const lookZ = offsetZ + (camera.look[2] - aabb[2]) * scale;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(camX, camZ);
        ctx.lineTo(lookX, lookZ);
        ctx.stroke();

        ctx.fillStyle = '#60a5fa';
        ctx.beginPath();
        ctx.arc(camX, camZ, 6 * pixelRatio, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      setStoreyMapData({
        imageData: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      });
      setIsLoading(false);
    } catch (e) {
      console.warn('Minimap generation failed:', e);
      setError('Kunde ej generera karta');
      setIsLoading(false);
    }
  }, [getXeokitViewer, size]);

  // Click to navigate
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const xeokitViewer = getXeokitViewer();
    const img = minimapImageRef.current;
    if (!xeokitViewer || !img || !storeyMapData) return;

    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const scene = xeokitViewer.scene;
    const aabb = scene?.getAABB?.() || scene?.aabb;
    if (!aabb || aabb.length < 6) return;

    const worldX = aabb[0] + x * (aabb[3] - aabb[0]);
    const worldZ = aabb[2] + y * (aabb[5] - aabb[2]);
    const worldY = (aabb[1] + aabb[4]) / 2;

    if (xeokitViewer.cameraFlight) {
      xeokitViewer.cameraFlight.flyTo({
        eye: [worldX, xeokitViewer.camera.eye[1], worldZ],
        look: [worldX, worldY, worldZ],
        up: [0, 1, 0],
        duration: 0.8,
      });
    }
  }, [getXeokitViewer, storeyMapData]);

  // Periodic update
  useEffect(() => {
    if (!isVisible) return;
    const timeout = setTimeout(generateStoreyMap, 500);
    const interval = setInterval(generateStoreyMap, 2000);
    return () => { clearTimeout(timeout); clearInterval(interval); };
  }, [isVisible, generateStoreyMap]);

  if (!isVisible) return null;

  return (
    <div
      ref={minimapContainerRef}
      className={cn(
        "absolute top-14 left-3 z-20",
        "bg-card/95 backdrop-blur-md border border-border/50 rounded-lg shadow-xl",
        "overflow-hidden transition-all duration-200"
      )}
      style={{ width: size.width, height: size.height }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/30">
        <span className="text-xs font-medium text-foreground/90">Översikt</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={generateStoreyMap} title="Uppdatera">
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </Button>
          {/* Size presets */}
          {(['mini', 'medium', 'large'] as SizePreset[]).map(preset => (
            <Button
              key={preset}
              variant={sizePreset === preset ? 'secondary' : 'ghost'}
              size="icon"
              className="h-6 w-6 text-[10px] font-bold"
              onClick={() => applyPreset(preset)}
              title={preset === 'mini' ? 'Mini' : preset === 'medium' ? 'Medel' : 'Stor (~50%)'}
            >
              {preset === 'mini' ? 'S' : preset === 'medium' ? 'M' : 'L'}
            </Button>
          ))}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Stäng">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Map content */}
      <div className="relative w-full bg-[#1a1a2e]" style={{ height: size.height - 40 }}>
        {isLoading && !storeyMapData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span className="text-xs">Laddar karta...</span>
            </div>
          </div>
        )}
        {error && !storeyMapData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">{error}</span>
          </div>
        )}
        {storeyMapData && (
          <img
            ref={minimapImageRef}
            src={storeyMapData.imageData}
            alt="Floor plan minimap"
            className="w-full h-full object-contain cursor-crosshair"
            onClick={handleMinimapClick}
            draggable={false}
          />
        )}
      </div>

      {/* Resize handle (bottom-right corner) */}
      <div
        className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity"
        onMouseDown={handleResizeStart}
        title="Dra för att ändra storlek"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground rotate-[-45deg]" />
      </div>
    </div>
  );
};

export default MinimapPanel;
