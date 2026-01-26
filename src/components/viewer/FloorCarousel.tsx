import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '@/components/ui/carousel';

export interface FloorInfo {
  id: string;
  fmGuid: string;
  name: string;
  shortName: string;
  thumbnail?: string; // Base64 encoded PNG
  aabb?: number[];
}

interface FloorCarouselProps {
  viewerRef: React.MutableRefObject<any>;
  onFloorSelect: (floor: FloorInfo) => void;
  selectedFloorId?: string;
  className?: string;
}

/**
 * Floor carousel component for navigating between building storeys
 * Generates thumbnails from XEOkit's StoreyViewsPlugin pattern
 */
const FloorCarousel: React.FC<FloorCarouselProps> = ({
  viewerRef,
  onFloorSelect,
  selectedFloorId,
  className
}) => {
  const [floors, setFloors] = useState<FloorInfo[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const thumbnailsGeneratedRef = useRef(false);

  // Get XEOkit viewer
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  const getAssetView = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  // Extract floors from metaScene
  const extractFloors = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects) return [];

    const metaObjects = viewer.metaScene.metaObjects;
    const extractedFloors: FloorInfo[] = [];

    Object.values(metaObjects).forEach((metaObject: any) => {
      const type = metaObject?.type?.toLowerCase();
      if (type === 'ifcbuildingstorey') {
        const name = metaObject.name || 'Unknown Floor';
        // Extract short name (e.g., "Plan 2" -> "2", "Våning 03" -> "03")
        const shortMatch = name.match(/(\d+)/);
        const shortName = shortMatch ? shortMatch[1] : name.substring(0, 4);
        
        extractedFloors.push({
          id: metaObject.id,
          fmGuid: metaObject.id, // Will be updated if FmGuid property exists
          name,
          shortName,
        });
      }
    });

    // Sort by name (typically floors are numbered)
    extractedFloors.sort((a, b) => {
      const numA = parseInt(a.shortName) || 0;
      const numB = parseInt(b.shortName) || 0;
      return numA - numB;
    });

    return extractedFloors;
  }, [getXeokitViewer]);

  // Generate thumbnail for a floor using XEOkit's rendering
  const generateFloorThumbnail = useCallback(async (floor: FloorInfo): Promise<string | undefined> => {
    const viewer = getXeokitViewer();
    const assetView = getAssetView();
    if (!viewer || !assetView) return undefined;

    try {
      const scene = viewer.scene;
      const camera = viewer.camera;
      
      // Get AABB for this floor's objects
      const floorObjects: string[] = [];
      Object.values(viewer.metaScene.metaObjects || {}).forEach((metaObj: any) => {
        if (metaObj.parent?.id === floor.id) {
          floorObjects.push(metaObj.id);
        }
      });

      if (floorObjects.length === 0) return undefined;

      const aabb = assetView.getAABB(floorObjects);
      if (!aabb) return undefined;

      // Store original camera state
      const origEye = [...camera.eye];
      const origLook = [...camera.look];
      const origUp = [...camera.up];
      const origProjection = camera.projection;

      // Calculate top-down view for this floor
      const centerX = (aabb[0] + aabb[3]) / 2;
      const centerY = (aabb[1] + aabb[4]) / 2;
      const centerZ = (aabb[2] + aabb[5]) / 2;
      const width = aabb[3] - aabb[0];
      const depth = aabb[5] - aabb[2];
      const height = Math.max(width, depth) * 1.2;

      // Move camera to top-down view
      camera.eye = [centerX, centerY + height, centerZ];
      camera.look = [centerX, centerY, centerZ];
      camera.up = [0, 0, -1];
      camera.projection = 'ortho';
      camera.ortho.scale = Math.max(width, depth) * 1.1;

      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture screenshot using canvas
      const canvas = scene.canvas.canvas;
      const thumbnailCanvas = document.createElement('canvas');
      thumbnailCanvas.width = 120;
      thumbnailCanvas.height = 120;
      const ctx = thumbnailCanvas.getContext('2d');
      
      if (ctx) {
        // Draw scaled version of viewer canvas
        const srcSize = Math.min(canvas.width, canvas.height);
        const srcX = (canvas.width - srcSize) / 2;
        const srcY = (canvas.height - srcSize) / 2;
        ctx.drawImage(canvas, srcX, srcY, srcSize, srcSize, 0, 0, 120, 120);
      }

      // Restore camera
      camera.eye = origEye;
      camera.look = origLook;
      camera.up = origUp;
      camera.projection = origProjection;

      return thumbnailCanvas.toDataURL('image/png');
    } catch (e) {
      console.debug('Could not generate thumbnail for floor:', floor.name, e);
      return undefined;
    }
  }, [getXeokitViewer, getAssetView]);

  // Generate simple colored placeholder thumbnails instead of real renders
  // (Real renders would require complex camera manipulation)
  const generatePlaceholderThumbnails = useCallback((floors: FloorInfo[]): FloorInfo[] => {
    return floors.map((floor, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        // Create a simple floor plan placeholder
        const hue = (index * 40) % 360;
        ctx.fillStyle = `hsl(${hue}, 20%, 25%)`;
        ctx.fillRect(0, 0, 120, 80);
        
        // Draw grid pattern
        ctx.strokeStyle = `hsl(${hue}, 30%, 35%)`;
        ctx.lineWidth = 1;
        for (let x = 15; x < 120; x += 20) {
          ctx.beginPath();
          ctx.moveTo(x, 10);
          ctx.lineTo(x, 70);
          ctx.stroke();
        }
        for (let y = 15; y < 80; y += 15) {
          ctx.beginPath();
          ctx.moveTo(10, y);
          ctx.lineTo(110, y);
          ctx.stroke();
        }
        
        // Draw floor number
        ctx.fillStyle = 'white';
        ctx.font = 'bold 24px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(floor.shortName, 60, 40);
      }
      
      return {
        ...floor,
        thumbnail: canvas.toDataURL('image/png'),
      };
    });
  }, []);

  // Load floors when viewer is ready
  useEffect(() => {
    const checkFloors = () => {
      const newFloors = extractFloors();
      if (newFloors.length > 0 && newFloors.length !== floors.length) {
        // Generate placeholder thumbnails
        const floorsWithThumbnails = generatePlaceholderThumbnails(newFloors);
        setFloors(floorsWithThumbnails);
      }
    };

    checkFloors();
    const interval = setInterval(() => {
      if (floors.length === 0) checkFloors();
    }, 1000);

    return () => clearInterval(interval);
  }, [extractFloors, floors.length, generatePlaceholderThumbnails]);

  // Don't render if no floors
  if (floors.length === 0) return null;

  return (
    <div className={cn(
      "absolute bottom-20 left-1/2 -translate-x-1/2 z-20",
      "transition-all duration-300",
      isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none",
      className
    )}>
      {/* Toggle button */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsVisible(!isVisible)}
        className={cn(
          "absolute -top-10 left-1/2 -translate-x-1/2",
          "shadow-lg bg-card/95 backdrop-blur-sm border",
          "transition-all",
          isVisible ? "opacity-100" : "opacity-100 translate-y-4"
        )}
      >
        <Layers className="h-4 w-4 mr-1.5" />
        <span className="text-xs">{floors.length} våningar</span>
      </Button>

      {/* Floor carousel */}
      <div className="bg-card/95 backdrop-blur-sm border rounded-lg shadow-xl p-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            disabled={floors.length <= 3}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          
          <div className="flex gap-2 overflow-x-auto max-w-[400px] py-1">
            {floors.map((floor) => (
              <button
                key={floor.id}
                onClick={() => onFloorSelect(floor)}
                className={cn(
                  "flex-shrink-0 rounded-md overflow-hidden transition-all",
                  "border-2 hover:border-primary/50",
                  selectedFloorId === floor.id 
                    ? "border-primary ring-2 ring-primary/30" 
                    : "border-border/50"
                )}
              >
                {floor.thumbnail ? (
                  <img 
                    src={floor.thumbnail} 
                    alt={floor.name}
                    className="w-[80px] h-[60px] object-cover"
                  />
                ) : (
                  <div className="w-[80px] h-[60px] bg-muted flex items-center justify-center">
                    <span className="text-lg font-bold text-muted-foreground">
                      {floor.shortName}
                    </span>
                  </div>
                )}
                <div className="px-1.5 py-0.5 bg-background/90 text-[10px] font-medium text-center truncate">
                  {floor.name}
                </div>
              </button>
            ))}
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            disabled={floors.length <= 3}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default FloorCarousel;
