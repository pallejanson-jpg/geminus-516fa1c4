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
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';

export interface FloorInfo {
  id: string;
  fmGuid: string;
  name: string;
  shortName: string;
  thumbnail?: string; // Base64 encoded PNG
  aabb?: number[];
  /** Database level FM GUIDs (originalSystemId) */
  databaseLevelFmGuids?: string[];
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
  const [internalSelectedId, setInternalSelectedId] = useState<string | undefined>(selectedFloorId);
  const thumbnailsGeneratedRef = useRef(false);

  // Sync internal selection with prop
  useEffect(() => {
    setInternalSelectedId(selectedFloorId);
  }, [selectedFloorId]);

  // Listen for floor selection events from other sources
  useEffect(() => {
    const handleFloorChange = (e: CustomEvent<FloorSelectionEventDetail>) => {
      const { floorId, visibleMetaFloorIds } = e.detail;
      
      if (floorId) {
        // Single floor selected - find matching floor in our list
        const matchingFloor = floors.find(f => f.id === floorId);
        if (matchingFloor) {
          setInternalSelectedId(matchingFloor.id);
        }
      } else if (visibleMetaFloorIds && visibleMetaFloorIds.length === 1) {
        // Single floor via meta IDs
        const matchingFloor = floors.find(f => visibleMetaFloorIds.includes(f.id));
        if (matchingFloor) {
          setInternalSelectedId(matchingFloor.id);
        }
      } else {
        // Multiple or all floors - clear selection
        setInternalSelectedId(undefined);
      }
    };
    
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
    return () => {
      window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
    };
  }, [floors]);

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
    const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

    Object.values(metaObjects).forEach((metaObject: any) => {
      const type = metaObject?.type?.toLowerCase();
      if (type === 'ifcbuildingstorey') {
        const rawName = metaObject.name || '';
        
        // Check if name is a GUID or missing
        const isGuid = GUID_RE.test(rawName);
        const isUnknown = !rawName || rawName === 'Unknown Floor';
        
        // Get children of this floor
        const children = Object.values(metaObjects).filter((m: any) => m.parent?.id === metaObject.id);
        
        if (isGuid || isUnknown) {
          // Skip empty GUID floors
          if (children.length === 0) return;
        }
        
        let displayName: string;
        if (isGuid || isUnknown) {
          // Try to infer floor number from children names (pattern: "XX.N.XXX" → Våning N)
          let inferredNumber: string | null = null;
          for (const child of children) {
            const childName = (child as any).name || '';
            const match = childName.match(/^\d+\.(\d+)\./);
            if (match) {
              inferredNumber = match[1];
              break;
            }
          }
          displayName = inferredNumber ? `Våning ${inferredNumber.replace(/^0+/, '') || '0'}` : `Våning ${extractedFloors.length + 1}`;
        } else {
          displayName = rawName;
        }
        const shortMatch = displayName.match(/(\d+)/);
        const shortName = shortMatch ? shortMatch[1] : displayName.substring(0, 4);
        
        const fmGuid = metaObject.originalSystemId || metaObject.id;
        
        extractedFloors.push({
          id: metaObject.id,
          fmGuid: fmGuid,
          name: displayName,
          shortName,
          databaseLevelFmGuids: [fmGuid],
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

  // Generate floor plan style placeholder thumbnails
  const generatePlaceholderThumbnails = useCallback((floors: FloorInfo[]): FloorInfo[] => {
    return floors.map((floor, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        // Light blueprint background
        ctx.fillStyle = '#f0f4f8';
        ctx.fillRect(0, 0, 120, 80);
        
        // Draw architectural floor plan style
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 1.5;
        
        // Outer walls
        ctx.strokeRect(10, 8, 100, 64);
        
        // Interior walls - varied based on floor index
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#3b5998';
        
        // Horizontal dividers
        const hDividers = [25, 45, 60];
        hDividers.forEach((y, i) => {
          if ((index + i) % 2 === 0) {
            ctx.beginPath();
            ctx.moveTo(10, y);
            ctx.lineTo(110, y);
            ctx.stroke();
          }
        });
        
        // Vertical dividers - create rooms
        const vDividers = [35, 55, 75, 90];
        vDividers.forEach((x, i) => {
          if ((index + i) % 3 !== 0) {
            ctx.beginPath();
            ctx.moveTo(x, 8);
            ctx.lineTo(x, 72);
            ctx.stroke();
          }
        });
        
        // Door openings (gaps in walls)
        ctx.fillStyle = '#f0f4f8';
        ctx.fillRect(45, 7, 12, 3);
        ctx.fillRect(70, 70, 12, 3);
        ctx.fillRect(34, 30, 3, 10);
        
        // Small room details (furniture placeholders)
        ctx.fillStyle = '#c8d6e5';
        ctx.fillRect(15, 12, 8, 8);
        ctx.fillRect(85, 55, 12, 10);
        ctx.fillRect(60, 28, 6, 6);
        
        // Floor label background
        ctx.fillStyle = 'rgba(30, 58, 95, 0.9)';
        ctx.beginPath();
        ctx.roundRect(35, 32, 50, 18, 3);
        ctx.fill();
        
        // Floor label text
        ctx.fillStyle = 'white';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Plan ${floor.shortName}`, 60, 41);
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
      <div className="bg-card/95 backdrop-blur-sm border border-border/30 rounded-lg shadow-xl p-2">
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
                onClick={() => {
                  onFloorSelect(floor);
                  
                  // Dispatch floor selection event with complete data
                  const eventDetail: FloorSelectionEventDetail = {
                    floorId: floor.id,
                    floorName: floor.name,
                    bounds: null,
                    visibleMetaFloorIds: [floor.id],
                    visibleFloorFmGuids: floor.databaseLevelFmGuids || [floor.fmGuid],
                    isAllFloorsVisible: false,
                  };
                  window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: eventDetail }));
                }}
                className={cn(
                  "flex-shrink-0 rounded-md overflow-hidden transition-all",
                  "border-2 hover:border-primary/50",
                  internalSelectedId === floor.id 
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
