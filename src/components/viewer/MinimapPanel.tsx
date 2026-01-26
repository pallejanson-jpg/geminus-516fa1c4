import React, { useState, useRef, useCallback, useEffect, useContext } from 'react';
import { X, Maximize2, Minimize2, Layers, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';

interface MinimapPanelProps {
  viewerRef: React.MutableRefObject<any>;
  isVisible: boolean;
  onClose: () => void;
  onRoomClick?: (fmGuid: string) => void;
}

/**
 * MinimapPanel using xeokit's StoreyViewsPlugin for 2D floor plan rendering
 * Falls back to custom canvas rendering if StoreyViewsPlugin is not available
 */
const MinimapPanel: React.FC<MinimapPanelProps> = ({ viewerRef, isVisible, onClose, onRoomClick }) => {
  const { allData } = useContext(AppContext);
  const minimapContainerRef = useRef<HTMLDivElement>(null);
  const minimapImageRef = useRef<HTMLImageElement>(null);
  const storeyViewsPluginRef = useRef<any>(null);
  const [size, setSize] = useState({ width: 240, height: 200 });
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentStorey, setCurrentStorey] = useState<string | null>(null);
  const [storeyMapData, setStoreyMapData] = useState<{ imageData: string; width: number; height: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get xeokit viewer instance
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  // Initialize StoreyViewsPlugin when viewer is ready
  const initStoreyViewsPlugin = useCallback(() => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer) {
      setError('Viewer ej redo');
      return null;
    }

    // Check if plugin already exists
    if (storeyViewsPluginRef.current) {
      return storeyViewsPluginRef.current;
    }

    // Check if StoreyViewsPlugin is available globally
    const StoreyViewsPlugin = (window as any).StoreyViewsPlugin || (window as any).xeokit?.StoreyViewsPlugin;
    
    if (StoreyViewsPlugin) {
      try {
        storeyViewsPluginRef.current = new StoreyViewsPlugin(xeokitViewer, {
          modelAtlasSize: 2048,
          format: "png",
          lineWidth: 2,
        });
        console.log('StoreyViewsPlugin initialized');
        return storeyViewsPluginRef.current;
      } catch (e) {
        console.warn('Failed to initialize StoreyViewsPlugin:', e);
      }
    }

    return null;
  }, [getXeokitViewer]);

  // Generate storey map image
  const generateStoreyMap = useCallback(async () => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Try to use StoreyViewsPlugin
    const storeyPlugin = initStoreyViewsPlugin();
    
    if (storeyPlugin) {
      try {
        // Get available storeys
        const storeyIds = Object.keys(storeyPlugin.storeys || {});
        
        if (storeyIds.length > 0) {
          // Use current storey or first available
          const storeyId = currentStorey || storeyIds[0];
          const storey = storeyPlugin.storeys[storeyId];
          
          if (storey) {
            // Create storey map image
            const storeyMap = storeyPlugin.createStoreyMap(storeyId, {
              width: size.width * 2,
              height: (size.height - 40) * 2,
              format: "png",
            });

            if (storeyMap?.imageData) {
              setStoreyMapData({
                imageData: storeyMap.imageData,
                width: storeyMap.width,
                height: storeyMap.height,
              });
              setCurrentStorey(storeyId);
              setIsLoading(false);
              return;
            }
          }
        }
      } catch (e) {
        console.warn('StoreyViewsPlugin map generation failed:', e);
      }
    }

    // Fallback: Create simple top-down view using scene AABB
    try {
      const scene = xeokitViewer.scene;
      if (!scene) {
        setError('Scene ej tillgänglig');
        setIsLoading(false);
        return;
      }

      // Create a simple canvas-based minimap from visible objects
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setError('Canvas ej tillgänglig');
        setIsLoading(false);
        return;
      }

      canvas.width = size.width * 2;
      canvas.height = (size.height - 40) * 2;

      // Get scene AABB
      const aabb = scene.getAABB?.() || scene.aabb;
      if (!aabb || aabb.length < 6 || !isFinite(aabb[0])) {
        setError('Laddar modell...');
        setIsLoading(false);
        return;
      }

      // Calculate scale and offsets for top-down view (X-Z plane)
      const modelWidth = aabb[3] - aabb[0];
      const modelDepth = aabb[5] - aabb[2];
      const padding = 20;
      const scaleX = (canvas.width - padding * 2) / modelWidth;
      const scaleZ = (canvas.height - padding * 2) / modelDepth;
      const scale = Math.min(scaleX, scaleZ);
      const offsetX = padding + (canvas.width - padding * 2 - modelWidth * scale) / 2;
      const offsetZ = padding + (canvas.height - padding * 2 - modelDepth * scale) / 2;

      // Dark background
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw building outline
      ctx.strokeStyle = '#3a3a5a';
      ctx.lineWidth = 2;
      ctx.strokeRect(offsetX, offsetZ, modelWidth * scale, modelDepth * scale);

      // Draw visible spaces/rooms
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

                // Room fill
                ctx.fillStyle = 'rgba(100, 120, 180, 0.25)';
                ctx.fillRect(x, z, w, h);

                // Room outline
                ctx.strokeStyle = 'rgba(150, 170, 220, 0.6)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x, z, w, h);

                // Room label if large enough
                if (w > 30 && h > 15) {
                  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                  ctx.font = '10px system-ui';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  const name = metaObject.name || '';
                  const maxChars = Math.floor(w / 6);
                  const displayName = name.length > maxChars ? name.substring(0, maxChars - 1) + '…' : name;
                  ctx.fillText(displayName, x + w / 2, z + h / 2);
                }
              }
            } catch (e) {
              // Skip objects that can't be rendered
            }
          }
        });
      }

      // Draw camera position indicator
      const camera = xeokitViewer.camera;
      if (camera?.eye && camera?.look) {
        const camX = offsetX + (camera.eye[0] - aabb[0]) * scale;
        const camZ = offsetZ + (camera.eye[2] - aabb[2]) * scale;
        const lookX = offsetX + (camera.look[0] - aabb[0]) * scale;
        const lookZ = offsetZ + (camera.look[2] - aabb[2]) * scale;

        // View direction line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(camX, camZ);
        ctx.lineTo(lookX, lookZ);
        ctx.stroke();

        // Camera position dot
        ctx.fillStyle = '#60a5fa';
        ctx.beginPath();
        ctx.arc(camX, camZ, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Convert canvas to data URL
      setStoreyMapData({
        imageData: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      });
      setIsLoading(false);
    } catch (e) {
      console.warn('Fallback minimap failed:', e);
      setError('Kunde ej generera karta');
      setIsLoading(false);
    }
  }, [getXeokitViewer, initStoreyViewsPlugin, currentStorey, size]);

  // Handle click on minimap to navigate
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const xeokitViewer = getXeokitViewer();
    const img = minimapImageRef.current;
    if (!xeokitViewer || !img || !storeyMapData) return;

    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Convert click position to world coordinates
    const scene = xeokitViewer.scene;
    const aabb = scene?.getAABB?.() || scene?.aabb;
    if (!aabb || aabb.length < 6) return;

    const worldX = aabb[0] + x * (aabb[3] - aabb[0]);
    const worldZ = aabb[2] + y * (aabb[5] - aabb[2]);
    const worldY = (aabb[1] + aabb[4]) / 2;

    // Fly camera to clicked position
    if (xeokitViewer.cameraFlight) {
      xeokitViewer.cameraFlight.flyTo({
        eye: [worldX, xeokitViewer.camera.eye[1], worldZ],
        look: [worldX, worldY, worldZ],
        up: [0, 1, 0],
        duration: 0.8,
      });
    }
  }, [getXeokitViewer, storeyMapData]);

  // Update minimap periodically when visible
  useEffect(() => {
    if (!isVisible) return;

    // Initial generation
    const timeout = setTimeout(generateStoreyMap, 500);

    // Periodic update
    const interval = setInterval(generateStoreyMap, 2000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [isVisible, generateStoreyMap]);

  // Cleanup plugin on unmount
  useEffect(() => {
    return () => {
      if (storeyViewsPluginRef.current?.destroy) {
        try {
          storeyViewsPluginRef.current.destroy();
        } catch (e) {
          // Ignore cleanup errors
        }
        storeyViewsPluginRef.current = null;
      }
    };
  }, []);

  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      setSize({ width: 240, height: 200 });
    } else {
      setSize({ width: 360, height: 300 });
    }
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

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
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={generateStoreyMap}
            title="Uppdatera"
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={toggleExpand}
            title={isExpanded ? "Förminska" : "Förstora"}
          >
            {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
            title="Stäng"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Map content */}
      <div 
        className="relative w-full bg-[#1a1a2e]"
        style={{ height: size.height - 40 }}
      >
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
    </div>
  );
};

export default MinimapPanel;
