import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Maximize2, Minimize2, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RoomData {
  id: string;
  fmGuid: string;
  name: string;
  aabb: number[]; // [xMin, yMin, zMin, xMax, yMax, zMax]
  canvasRect?: { x: number; y: number; width: number; height: number };
}

interface MinimapPanelProps {
  viewerRef: React.MutableRefObject<any>;
  isVisible: boolean;
  onClose: () => void;
  onRoomClick?: (fmGuid: string) => void;
}

/**
 * Minimap panel for 3D Viewer
 * Shows a top-down overview of the model with rooms and current camera position
 * Click rooms to navigate to them, or click empty space to reposition camera
 */
const MinimapPanel: React.FC<MinimapPanelProps> = ({ viewerRef, isVisible, onClose, onRoomClick }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 240, height: 180 });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [showRooms, setShowRooms] = useState(true);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);
  const [sceneInfo, setSceneInfo] = useState<{ aabb: number[] | null; scale: number; offsetX: number; offsetZ: number } | null>(null);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Get xeokit viewer reference - correct path through Asset+ structure
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  // Get asset view reference for additional methods
  const getAssetView = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  // Extract room data from metaScene
  const extractRooms = useCallback(() => {
    const viewer = getXeokitViewer();
    const assetView = getAssetView();
    if (!viewer || !assetView) return [];

    const metaScene = viewer.metaScene;
    if (!metaScene?.metaObjects) return [];

    const extractedRooms: RoomData[] = [];

    // Iterate through all meta objects to find IfcSpace elements
    Object.values(metaScene.metaObjects).forEach((metaObject: any) => {
      if (metaObject?.type?.toLowerCase() === 'ifcspace') {
        try {
          // Get the AABB for this space
          const aabb = assetView.getAABB(metaObject.id);
          if (aabb && aabb.length >= 6) {
            // Try to get fmGuid from properties
            let fmGuid = '';
            let name = metaObject.name || 'Room';
            
            // Get object from scene to read properties
            const sceneObject = viewer.scene?.objects?.[metaObject.id];
            if (sceneObject) {
              // Try to extract fmGuid from the object's properties
              const props = sceneObject.propertySet?.properties;
              if (props) {
                const fmGuidProp = Object.values(props).find((p: any) => 
                  p?.name?.toLowerCase() === 'fmguid'
                );
                if (fmGuidProp && (fmGuidProp as any).value) {
                  fmGuid = String((fmGuidProp as any).value);
                }
              }
            }

            // Use metaObject id as fallback for fmGuid
            if (!fmGuid) {
              fmGuid = metaObject.id;
            }

            extractedRooms.push({
              id: metaObject.id,
              fmGuid,
              name,
              aabb
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

    // Check immediately and then periodically until we get rooms
    checkForRooms();
    const interval = setInterval(() => {
      if (rooms.length === 0) {
        checkForRooms();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isVisible, extractRooms, rooms.length]);

  // Update minimap from current view
  const updateMinimap = useCallback(() => {
    const viewer = getXeokitViewer();
    const canvas = minimapCanvasRef.current;
    if (!viewer || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get scene bounds
    const scene = viewer.scene;
    let aabb;
    try {
      aabb = scene?.getAABB?.();
    } catch (e) {
      aabb = null;
    }
    
    if (!aabb || aabb.length < 6) {
      // Draw placeholder if no model loaded
      ctx.fillStyle = 'hsl(var(--muted))';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'hsl(var(--muted-foreground))';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Laddar modell...', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Clear canvas with background
    ctx.fillStyle = 'hsl(var(--card))';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate scale to fit model in canvas
    const modelWidth = aabb[3] - aabb[0];
    const modelDepth = aabb[5] - aabb[2];
    const padding = 15;
    const scaleX = (canvas.width - padding * 2) / modelWidth;
    const scaleZ = (canvas.height - padding * 2) / modelDepth;
    const scale = Math.min(scaleX, scaleZ);
    
    const offsetX = padding + (canvas.width - padding * 2 - modelWidth * scale) / 2;
    const offsetZ = padding + (canvas.height - padding * 2 - modelDepth * scale) / 2;

    // Store for click handling
    setSceneInfo({ aabb, scale, offsetX, offsetZ });

    // Draw model footprint with gradient
    const gradient = ctx.createLinearGradient(
      offsetX, offsetZ,
      offsetX + modelWidth * scale, offsetZ + modelDepth * scale
    );
    gradient.addColorStop(0, 'hsl(var(--muted))');
    gradient.addColorStop(1, 'hsl(var(--accent))');
    
    ctx.fillStyle = gradient;
    ctx.strokeStyle = 'hsl(var(--border))';
    ctx.lineWidth = 1;
    
    ctx.fillRect(
      offsetX,
      offsetZ,
      modelWidth * scale,
      modelDepth * scale
    );
    ctx.strokeRect(
      offsetX,
      offsetZ,
      modelWidth * scale,
      modelDepth * scale
    );

    // Draw rooms if enabled
    if (showRooms && rooms.length > 0) {
      const updatedRooms = rooms.map(room => {
        const roomAabb = room.aabb;
        const roomX = offsetX + (roomAabb[0] - aabb[0]) * scale;
        const roomZ = offsetZ + (roomAabb[2] - aabb[2]) * scale;
        const roomWidth = (roomAabb[3] - roomAabb[0]) * scale;
        const roomHeight = (roomAabb[5] - roomAabb[2]) * scale;

        // Store canvas rect for click detection
        const canvasRect = { x: roomX, y: roomZ, width: roomWidth, height: roomHeight };

        // Draw room rectangle
        const isHovered = hoveredRoom === room.id;
        
        if (isHovered) {
          ctx.fillStyle = 'hsl(var(--primary) / 0.4)';
          ctx.strokeStyle = 'hsl(var(--primary))';
          ctx.lineWidth = 2;
        } else {
          ctx.fillStyle = 'hsl(var(--primary) / 0.15)';
          ctx.strokeStyle = 'hsl(var(--primary) / 0.5)';
          ctx.lineWidth = 1;
        }
        
        ctx.fillRect(roomX, roomZ, roomWidth, roomHeight);
        ctx.strokeRect(roomX, roomZ, roomWidth, roomHeight);

        // Draw room name if large enough
        if (roomWidth > 20 && roomHeight > 12) {
          ctx.fillStyle = isHovered ? 'hsl(var(--primary))' : 'hsl(var(--foreground) / 0.7)';
          ctx.font = isHovered ? 'bold 9px sans-serif' : '8px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // Truncate name if needed
          const maxChars = Math.floor(roomWidth / 5);
          let displayName = room.name;
          if (displayName.length > maxChars) {
            displayName = displayName.substring(0, maxChars - 1) + '…';
          }
          
          ctx.fillText(displayName, roomX + roomWidth / 2, roomZ + roomHeight / 2);
        }

        return { ...room, canvasRect };
      });

      // Update rooms with canvas rects (only if changed)
      if (JSON.stringify(updatedRooms.map(r => r.canvasRect)) !== JSON.stringify(rooms.map(r => r.canvasRect))) {
        setRooms(updatedRooms);
      }
    } else {
      // Draw grid lines for reference when rooms not shown
      ctx.strokeStyle = 'hsl(var(--border) / 0.3)';
      ctx.lineWidth = 0.5;
      const gridSize = 4;
      for (let i = 1; i < gridSize; i++) {
        const gx = offsetX + (modelWidth * scale * i) / gridSize;
        ctx.beginPath();
        ctx.moveTo(gx, offsetZ);
        ctx.lineTo(gx, offsetZ + modelDepth * scale);
        ctx.stroke();
        
        const gz = offsetZ + (modelDepth * scale * i) / gridSize;
        ctx.beginPath();
        ctx.moveTo(offsetX, gz);
        ctx.lineTo(offsetX + modelWidth * scale, gz);
        ctx.stroke();
      }
    }

    // Draw camera position indicator
    const camera = viewer.camera;
    if (camera && camera.eye && camera.look) {
      const eye = camera.eye;
      const look = camera.look;
      
      // Map world coordinates to canvas
      const camX = offsetX + (eye[0] - aabb[0]) * scale;
      const camZ = offsetZ + (eye[2] - aabb[2]) * scale;
      const lookX = offsetX + (look[0] - aabb[0]) * scale;
      const lookZ = offsetZ + (look[2] - aabb[2]) * scale;

      // Draw view frustum cone
      const angle = Math.atan2(lookZ - camZ, lookX - camX);
      const fovAngle = 0.4; // ~45 degrees half-angle
      const coneLength = 25;
      
      ctx.fillStyle = 'hsl(var(--primary) / 0.2)';
      ctx.beginPath();
      ctx.moveTo(camX, camZ);
      ctx.lineTo(
        camX + Math.cos(angle - fovAngle) * coneLength,
        camZ + Math.sin(angle - fovAngle) * coneLength
      );
      ctx.lineTo(
        camX + Math.cos(angle + fovAngle) * coneLength,
        camZ + Math.sin(angle + fovAngle) * coneLength
      );
      ctx.closePath();
      ctx.fill();

      // Draw look direction line
      ctx.strokeStyle = 'hsl(var(--primary))';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(camX, camZ);
      ctx.lineTo(lookX, lookZ);
      ctx.stroke();

      // Draw camera position with glow effect
      ctx.shadowColor = 'hsl(var(--primary))';
      ctx.shadowBlur = 6;
      ctx.fillStyle = 'hsl(var(--primary))';
      ctx.beginPath();
      ctx.arc(camX, camZ, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      // Camera inner dot
      ctx.fillStyle = 'hsl(var(--primary-foreground))';
      ctx.beginPath();
      ctx.arc(camX, camZ, 2, 0, Math.PI * 2);
      ctx.fill();

      // Draw look target
      ctx.fillStyle = 'hsl(var(--accent-foreground))';
      ctx.strokeStyle = 'hsl(var(--primary))';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(lookX, lookZ, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [getXeokitViewer, showRooms, rooms, hoveredRoom]);

  // Find room at canvas position
  const findRoomAtPosition = useCallback((canvasX: number, canvasY: number): RoomData | null => {
    if (!showRooms) return null;
    
    // Check rooms in reverse order (top-most first)
    for (let i = rooms.length - 1; i >= 0; i--) {
      const room = rooms[i];
      if (room.canvasRect) {
        const { x, y, width, height } = room.canvasRect;
        if (canvasX >= x && canvasX <= x + width && canvasY >= y && canvasY <= y + height) {
          return room;
        }
      }
    }
    return null;
  }, [rooms, showRooms]);

  // Handle mouse move for hover effect
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const room = findRoomAtPosition(x, y);
    setHoveredRoom(room?.id || null);
  }, [findRoomAtPosition]);

  // Handle click on minimap
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapCanvasRef.current;
    const viewer = getXeokitViewer();
    if (!canvas || !viewer || !sceneInfo?.aabb) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Check if clicked on a room
    const clickedRoom = findRoomAtPosition(x, y);
    if (clickedRoom && onRoomClick) {
      onRoomClick(clickedRoom.fmGuid);
      return;
    }

    // Otherwise, navigate to clicked position
    const { aabb, scale, offsetX, offsetZ } = sceneInfo;

    // Convert canvas coords to world coords
    const worldX = aabb[0] + (x - offsetX) / scale;
    const worldZ = aabb[2] + (y - offsetZ) / scale;
    const worldY = (aabb[1] + aabb[4]) / 2; // Middle height

    // Fly camera to look at this point from above
    const camera = viewer.camera;
    if (camera && viewer.cameraFlight) {
      const currentEye = camera.eye;
      
      viewer.cameraFlight.flyTo({
        eye: [worldX, currentEye[1], worldZ],
        look: [worldX, worldY, worldZ],
        up: [0, 1, 0],
        duration: 0.5
      });
    }
  }, [getXeokitViewer, sceneInfo, findRoomAtPosition, onRoomClick]);

  // Update minimap periodically when visible
  useEffect(() => {
    if (!isVisible) return;

    const interval = setInterval(updateMinimap, 100);
    updateMinimap();

    return () => clearInterval(interval);
  }, [isVisible, updateMinimap, size]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    };
  }, [size]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMoveResize = (e: MouseEvent) => {
      const dx = resizeStartRef.current.x - e.clientX;
      const dy = resizeStartRef.current.y - e.clientY;
      setSize({
        width: Math.max(180, Math.min(400, resizeStartRef.current.width + dx)),
        height: Math.max(120, Math.min(300, resizeStartRef.current.height + dy)),
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMoveResize);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMoveResize);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Toggle expand/collapse
  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      setSize({ width: 240, height: 180 });
    } else {
      setSize({ width: 360, height: 270 });
    }
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  if (!isVisible) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        "absolute bottom-16 right-4 z-20",
        "bg-card/95 backdrop-blur-sm border rounded-lg shadow-lg",
        "overflow-hidden",
        isResizing && "select-none"
      )}
      style={{ width: size.width, height: size.height }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Minimap</span>
          {rooms.length > 0 && (
            <span className="text-[10px] text-muted-foreground/70">
              ({rooms.length} rum)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={showRooms ? "secondary" : "ghost"}
            size="icon"
            className="h-5 w-5"
            onClick={() => setShowRooms(!showRooms)}
            title={showRooms ? "Dölj rum" : "Visa rum"}
          >
            <Layers className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={toggleExpand}
          >
            {isExpanded ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Canvas - clickable for navigation */}
      <canvas
        ref={minimapCanvasRef}
        width={size.width}
        height={size.height - 28}
        className={cn(
          "w-full h-[calc(100%-28px)]",
          hoveredRoom ? "cursor-pointer" : "cursor-crosshair"
        )}
        onClick={handleMinimapClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredRoom(null)}
        title={hoveredRoom ? "Klicka för att navigera till rum" : "Klicka för att flytta kameran"}
      />

      {/* Resize handle */}
      <div
        className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize"
        onMouseDown={handleResizeStart}
      >
        <div className="absolute top-1 left-1 w-2 h-2 border-l-2 border-t-2 border-muted-foreground/50" />
      </div>
    </div>
  );
};

export default MinimapPanel;
