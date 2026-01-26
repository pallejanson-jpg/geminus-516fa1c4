import React, { useState, useRef, useCallback, useEffect, useContext } from 'react';
import { X, Maximize2, Minimize2, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';

// Monochrome room style - clean black & white
const ROOM_STYLE = {
  fill: 'rgba(255, 255, 255, 0.15)',
  stroke: 'rgba(255, 255, 255, 0.5)',
  hoverFill: 'rgba(255, 255, 255, 0.35)',
  hoverStroke: 'rgba(255, 255, 255, 0.8)',
};

interface RoomData {
  id: string;
  fmGuid: string;
  name: string;
  aabb: number[];
}

interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MinimapPanelProps {
  viewerRef: React.MutableRefObject<any>;
  isVisible: boolean;
  onClose: () => void;
  onRoomClick?: (fmGuid: string) => void;
}

const MinimapPanel: React.FC<MinimapPanelProps> = ({ viewerRef, isVisible, onClose, onRoomClick }) => {
  const { allData } = useContext(AppContext);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 220, height: 180 });
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRooms, setShowRooms] = useState(true);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [sceneInfo, setSceneInfo] = useState<{ aabb: number[] | null; scale: number; offsetX: number; offsetZ: number } | null>(null);
  
  const roomRectsRef = useRef<Map<string, CanvasRect>>(new Map());
  const hoveredRoom = rooms.find(r => r.id === hoveredRoomId) || null;

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

  // Extract room data from metaScene - only from current visible storey
  const extractRooms = useCallback(() => {
    const viewer = getXeokitViewer();
    const assetView = getAssetView();
    if (!viewer || !assetView) return [];

    const metaScene = viewer.metaScene;
    if (!metaScene?.metaObjects) return [];

    const extractedRooms: RoomData[] = [];

    Object.values(metaScene.metaObjects).forEach((metaObject: any) => {
      if (metaObject?.type?.toLowerCase() === 'ifcspace') {
        try {
          // Only include visible spaces
          const sceneObject = viewer.scene?.objects?.[metaObject.id];
          if (!sceneObject?.visible) return;
          
          const aabb = assetView.getAABB(metaObject.id);
          if (aabb && aabb.length >= 6) {
            let fmGuid = metaObject.id;
            let name = metaObject.name || 'Room';
            
            if (sceneObject?.propertySet?.properties) {
              const fmGuidProp = Object.values(sceneObject.propertySet.properties).find((p: any) => 
                p?.name?.toLowerCase() === 'fmguid'
              );
              if (fmGuidProp && (fmGuidProp as any).value) {
                fmGuid = String((fmGuidProp as any).value);
              }
            }

            extractedRooms.push({
              id: metaObject.id,
              fmGuid,
              name,
              aabb,
            });
          }
        } catch (e) {
          // Skip objects that can't be processed
        }
      }
    });

    return extractedRooms;
  }, [getXeokitViewer, getAssetView]);

  // Update rooms data when models are loaded
  useEffect(() => {
    if (!isVisible) return;

    const checkForRooms = () => {
      const newRooms = extractRooms();
      if (newRooms.length > 0) {
        setRooms(newRooms);
      }
    };

    checkForRooms();
    const interval = setInterval(checkForRooms, 1000);

    return () => clearInterval(interval);
  }, [isVisible, extractRooms]);

  // Update minimap from current view - monochrome style
  const updateMinimap = useCallback(() => {
    const viewer = getXeokitViewer();
    const canvas = minimapCanvasRef.current;
    if (!viewer || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use AABB from visible rooms if available, otherwise use scene AABB
    let aabb: number[] | null = null;
    
    if (rooms.length > 0) {
      // Calculate AABB from visible rooms for current storey
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      
      rooms.forEach(room => {
        minX = Math.min(minX, room.aabb[0]);
        minY = Math.min(minY, room.aabb[1]);
        minZ = Math.min(minZ, room.aabb[2]);
        maxX = Math.max(maxX, room.aabb[3]);
        maxY = Math.max(maxY, room.aabb[4]);
        maxZ = Math.max(maxZ, room.aabb[5]);
      });
      
      aabb = [minX, minY, minZ, maxX, maxY, maxZ];
    } else {
      try {
        aabb = viewer.scene?.getAABB?.();
      } catch (e) {
        aabb = null;
      }
    }
    
    if (!aabb || aabb.length < 6 || !isFinite(aabb[0])) {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#555';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Laddar...', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Clean dark background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const modelWidth = aabb[3] - aabb[0];
    const modelDepth = aabb[5] - aabb[2];
    
    // Avoid division by zero
    if (modelWidth <= 0 || modelDepth <= 0) return;
    
    const padding = 16;
    const scaleX = (canvas.width - padding * 2) / modelWidth;
    const scaleZ = (canvas.height - padding * 2) / modelDepth;
    const scale = Math.min(scaleX, scaleZ);
    
    const offsetX = padding + (canvas.width - padding * 2 - modelWidth * scale) / 2;
    const offsetZ = padding + (canvas.height - padding * 2 - modelDepth * scale) / 2;

    setSceneInfo({ aabb, scale, offsetX, offsetZ });

    // Draw building outline in subtle gray
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX, offsetZ, modelWidth * scale, modelDepth * scale);

    // Draw rooms with monochrome style
    if (showRooms && rooms.length > 0) {
      const newRects = new Map<string, CanvasRect>();
      
      rooms.forEach(room => {
        const roomAabb = room.aabb;
        const roomX = offsetX + (roomAabb[0] - aabb[0]) * scale;
        const roomZ = offsetZ + (roomAabb[2] - aabb[2]) * scale;
        const roomWidth = (roomAabb[3] - roomAabb[0]) * scale;
        const roomHeight = (roomAabb[5] - roomAabb[2]) * scale;

        newRects.set(room.id, { x: roomX, y: roomZ, width: roomWidth, height: roomHeight });
        
        const isHovered = hoveredRoomId === room.id;
        
        // Monochrome colors
        ctx.fillStyle = isHovered ? ROOM_STYLE.hoverFill : ROOM_STYLE.fill;
        ctx.strokeStyle = isHovered ? ROOM_STYLE.hoverStroke : ROOM_STYLE.stroke;
        ctx.lineWidth = isHovered ? 1.5 : 0.5;
        
        ctx.fillRect(roomX, roomZ, roomWidth, roomHeight);
        ctx.strokeRect(roomX, roomZ, roomWidth, roomHeight);

        // Draw room name if large enough
        if (roomWidth > 30 && roomHeight > 16) {
          ctx.fillStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.7)';
          ctx.font = isHovered ? '500 9px system-ui' : '8px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          const maxChars = Math.floor(roomWidth / 5);
          let displayName = room.name;
          if (displayName.length > maxChars) {
            displayName = displayName.substring(0, maxChars - 1) + '…';
          }
          
          ctx.fillText(displayName, roomX + roomWidth / 2, roomZ + roomHeight / 2);
        }
      });

      roomRectsRef.current = newRects;
    }

    // Draw camera position
    const camera = viewer.camera;
    if (camera?.eye && camera?.look) {
      const eye = camera.eye;
      const look = camera.look;
      
      const camX = offsetX + (eye[0] - aabb[0]) * scale;
      const camZ = offsetZ + (eye[2] - aabb[2]) * scale;
      const lookX = offsetX + (look[0] - aabb[0]) * scale;
      const lookZ = offsetZ + (look[2] - aabb[2]) * scale;

      const angle = Math.atan2(lookZ - camZ, lookX - camX);
      const fovAngle = 0.35;
      const coneLength = 16;
      
      // View cone
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(camX, camZ);
      ctx.lineTo(camX + Math.cos(angle - fovAngle) * coneLength, camZ + Math.sin(angle - fovAngle) * coneLength);
      ctx.lineTo(camX + Math.cos(angle + fovAngle) * coneLength, camZ + Math.sin(angle + fovAngle) * coneLength);
      ctx.closePath();
      ctx.fill();

      // Camera marker
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(camX, camZ, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [getXeokitViewer, showRooms, rooms, hoveredRoomId]);

  // Find room at canvas position
  const findRoomAtPosition = useCallback((canvasX: number, canvasY: number): RoomData | null => {
    if (!showRooms) return null;
    
    for (let i = rooms.length - 1; i >= 0; i--) {
      const room = rooms[i];
      const rect = roomRectsRef.current.get(room.id);
      if (rect && canvasX >= rect.x && canvasX <= rect.x + rect.width && 
          canvasY >= rect.y && canvasY <= rect.y + rect.height) {
        return room;
      }
    }
    return null;
  }, [rooms, showRooms]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const room = findRoomAtPosition(x, y);
    setHoveredRoomId(room?.id || null);
  }, [findRoomAtPosition]);

  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapCanvasRef.current;
    const viewer = getXeokitViewer();
    if (!canvas || !viewer || !sceneInfo?.aabb) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const clickedRoom = findRoomAtPosition(x, y);
    if (clickedRoom && onRoomClick) {
      onRoomClick(clickedRoom.fmGuid);
      return;
    }

    const { aabb, scale, offsetX, offsetZ } = sceneInfo;
    const worldX = aabb[0] + (x - offsetX) / scale;
    const worldZ = aabb[2] + (y - offsetZ) / scale;
    const worldY = (aabb[1] + aabb[4]) / 2;

    const camera = viewer.camera;
    if (camera && viewer.cameraFlight) {
      viewer.cameraFlight.flyTo({
        eye: [worldX, camera.eye[1], worldZ],
        look: [worldX, worldY, worldZ],
        up: [0, 1, 0],
        duration: 0.5
      });
    }
  }, [getXeokitViewer, sceneInfo, findRoomAtPosition, onRoomClick]);

  // Update minimap periodically
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(updateMinimap, 100);
    updateMinimap();
    return () => clearInterval(interval);
  }, [isVisible, updateMinimap, size]);

  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      setSize({ width: 220, height: 180 });
    } else {
      setSize({ width: 320, height: 260 });
    }
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        "absolute top-14 left-3 z-20",
        "bg-card/90 backdrop-blur-md border border-border/40 rounded-lg shadow-xl",
        "overflow-hidden"
      )}
      style={{ width: size.width, height: size.height }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-muted/20 border-b border-border/30">
        <span className="text-xs font-medium text-foreground/80">Översikt</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant={showRooms ? "secondary" : "ghost"}
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowRooms(!showRooms)}
          >
            <Layers className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleExpand}>
            {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={minimapCanvasRef}
        width={size.width}
        height={size.height - 32}
        className={cn(
          "w-full",
          hoveredRoom ? "cursor-pointer" : "cursor-crosshair"
        )}
        style={{ height: `calc(100% - 32px)` }}
        onClick={handleMinimapClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredRoomId(null)}
      />

      {/* Hovered room tooltip */}
      {hoveredRoom && (
        <div className="absolute bottom-1 left-1 right-1 px-2 py-1 bg-background/95 backdrop-blur-sm rounded text-[10px] border border-border/30">
          <span className="font-medium">{hoveredRoom.name}</span>
        </div>
      )}
    </div>
  );
};

export default MinimapPanel;
