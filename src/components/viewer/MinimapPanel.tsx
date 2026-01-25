import React, { useState, useRef, useCallback, useEffect, useContext } from 'react';
import { X, Maximize2, Minimize2, Layers, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Room category color scheme
const ROOM_CATEGORIES = {
  office: { label: 'Kontor', color: 'hsl(210, 70%, 50%)', fill: 'rgba(59, 130, 246, 0.25)', stroke: 'rgba(59, 130, 246, 0.7)' },
  technical: { label: 'Teknik', color: 'hsl(280, 60%, 50%)', fill: 'rgba(168, 85, 247, 0.25)', stroke: 'rgba(168, 85, 247, 0.7)' },
  circulation: { label: 'Kommunikation', color: 'hsl(45, 80%, 50%)', fill: 'rgba(234, 179, 8, 0.25)', stroke: 'rgba(234, 179, 8, 0.7)' },
  storage: { label: 'Förråd', color: 'hsl(30, 60%, 45%)', fill: 'rgba(180, 120, 60, 0.25)', stroke: 'rgba(180, 120, 60, 0.7)' },
  sanitary: { label: 'Hygien', color: 'hsl(180, 60%, 45%)', fill: 'rgba(20, 184, 166, 0.25)', stroke: 'rgba(20, 184, 166, 0.7)' },
  rental: { label: 'Hyresobjekt', color: 'hsl(140, 60%, 45%)', fill: 'rgba(34, 197, 94, 0.25)', stroke: 'rgba(34, 197, 94, 0.7)' },
  other: { label: 'Övrigt', color: 'hsl(0, 0%, 50%)', fill: 'rgba(120, 120, 120, 0.2)', stroke: 'rgba(120, 120, 120, 0.5)' },
} as const;

type RoomCategoryKey = keyof typeof ROOM_CATEGORIES;

interface RoomData {
  id: string;
  fmGuid: string;
  name: string;
  aabb: number[];
  category: RoomCategoryKey;
  rentalObject?: string;
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

// Classify room based on name patterns
const classifyRoom = (name: string, rentalObject?: string): RoomCategoryKey => {
  const lowerName = name.toLowerCase();
  
  if (rentalObject && rentalObject.length > 0) {
    return 'rental';
  }
  
  if (lowerName.includes('teknik') || lowerName.includes('tdk') || lowerName.includes('el') ||
      lowerName.includes('fläkt') || lowerName.includes('vvs') || lowerName.includes('server') ||
      lowerName.includes('it-') || lowerName.includes('ställverk')) {
    return 'technical';
  }
  
  if (lowerName.includes('trappa') || lowerName.includes('korridor') || lowerName.includes('hall') ||
      lowerName.includes('entré') || lowerName.includes('lobby') || lowerName.includes('hiss') ||
      lowerName.includes('passage') || lowerName.includes('sluss')) {
    return 'circulation';
  }
  
  if (lowerName.includes('wc') || lowerName.includes('toalett') || lowerName.includes('dusch') ||
      lowerName.includes('bad') || lowerName.includes('hygien') || lowerName.includes('tvätt') ||
      lowerName.includes('rkm') || lowerName.includes('städ')) {
    return 'sanitary';
  }
  
  if (lowerName.includes('förråd') || lowerName.includes('arkiv') || lowerName.includes('lager') ||
      lowerName.includes('skåp') || lowerName.includes('magasin')) {
    return 'storage';
  }
  
  if (lowerName.includes('kontor') || lowerName.includes('rum') || lowerName.includes('arbets') ||
      lowerName.includes('möte') || lowerName.includes('samman') || lowerName.includes('pentry') ||
      lowerName.includes('kök') || lowerName.includes('lunch') || lowerName.includes('fikarum')) {
    return 'office';
  }
  
  return 'other';
};

/**
 * Minimap panel for 3D Viewer
 * Shows a top-down overview of the model with color-coded rooms
 */
const MinimapPanel: React.FC<MinimapPanelProps> = ({ viewerRef, isVisible, onClose, onRoomClick }) => {
  const { allData } = useContext(AppContext);
  const panelRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 260, height: 200 });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [showRooms, setShowRooms] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [sceneInfo, setSceneInfo] = useState<{ aabb: number[] | null; scale: number; offsetX: number; offsetZ: number } | null>(null);
  
  // Store canvas rects in a ref to avoid state updates during render
  const roomRectsRef = useRef<Map<string, CanvasRect>>(new Map());
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Get hovered room data
  const hoveredRoom = rooms.find(r => r.id === hoveredRoomId) || null;

  // Get xeokit viewer reference
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  // Get asset view reference
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

    // Create a map of fmGuid to asset data
    const assetMap = new Map<string, any>();
    if (allData) {
      allData.forEach((asset: any) => {
        if (asset.fmGuid) {
          assetMap.set(asset.fmGuid.toLowerCase(), asset);
        }
      });
    }

    Object.values(metaScene.metaObjects).forEach((metaObject: any) => {
      if (metaObject?.type?.toLowerCase() === 'ifcspace') {
        try {
          const aabb = assetView.getAABB(metaObject.id);
          if (aabb && aabb.length >= 6) {
            let fmGuid = '';
            let name = metaObject.name || 'Room';
            let rentalObject: string | undefined;
            
            const sceneObject = viewer.scene?.objects?.[metaObject.id];
            if (sceneObject) {
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

            if (!fmGuid) {
              fmGuid = metaObject.id;
            }

            const assetInfo = assetMap.get(fmGuid.toLowerCase());
            if (assetInfo?.attributes) {
              const attrs = assetInfo.attributes;
              Object.keys(attrs).forEach(key => {
                const attr = attrs[key];
                if (attr?.name?.toLowerCase().includes('hyresobjekt') && attr?.value) {
                  rentalObject = String(attr.value);
                }
              });
              if (assetInfo.commonName) {
                name = assetInfo.commonName;
              }
            }

            const category = classifyRoom(name, rentalObject);

            extractedRooms.push({
              id: metaObject.id,
              fmGuid,
              name,
              aabb,
              category,
              rentalObject
            });
          }
        } catch (e) {
          // Skip objects that can't be processed
        }
      }
    });

    return extractedRooms;
  }, [getXeokitViewer, getAssetView, allData]);

  // Update rooms data when models are loaded
  useEffect(() => {
    if (!isVisible) return;

    const checkForRooms = () => {
      const newRooms = extractRooms();
      if (newRooms.length > 0 && newRooms.length !== rooms.length) {
        setRooms(newRooms);
      }
    };

    checkForRooms();
    const interval = setInterval(() => {
      if (rooms.length === 0) {
        checkForRooms();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isVisible, extractRooms, rooms.length]);

  // Get category stats for legend
  const categoryStats = React.useMemo(() => {
    const stats: Record<RoomCategoryKey, number> = {
      office: 0, technical: 0, circulation: 0, storage: 0, sanitary: 0, rental: 0, other: 0,
    };
    rooms.forEach(room => { stats[room.category]++; });
    return stats;
  }, [rooms]);

  // Update minimap from current view
  const updateMinimap = useCallback(() => {
    const viewer = getXeokitViewer();
    const canvas = minimapCanvasRef.current;
    if (!viewer || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scene = viewer.scene;
    let aabb;
    try {
      aabb = scene?.getAABB?.();
    } catch (e) {
      aabb = null;
    }
    
    if (!aabb || aabb.length < 6) {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#666';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Laddar modell...', canvas.width / 2, canvas.height / 2);
      return;
    }

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const modelWidth = aabb[3] - aabb[0];
    const modelDepth = aabb[5] - aabb[2];
    const padding = 12;
    const scaleX = (canvas.width - padding * 2) / modelWidth;
    const scaleZ = (canvas.height - padding * 2) / modelDepth;
    const scale = Math.min(scaleX, scaleZ);
    
    const offsetX = padding + (canvas.width - padding * 2 - modelWidth * scale) / 2;
    const offsetZ = padding + (canvas.height - padding * 2 - modelDepth * scale) / 2;

    setSceneInfo({ aabb, scale, offsetX, offsetZ });

    ctx.fillStyle = '#1a1a1a';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.fillRect(offsetX, offsetZ, modelWidth * scale, modelDepth * scale);
    ctx.strokeRect(offsetX, offsetZ, modelWidth * scale, modelDepth * scale);

    // Draw rooms with category colors - store rects in ref, not state
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
        const categoryColors = ROOM_CATEGORIES[room.category];
        
        if (isHovered) {
          ctx.fillStyle = categoryColors.fill.replace('0.25', '0.5');
          ctx.strokeStyle = categoryColors.stroke.replace('0.7', '1');
          ctx.lineWidth = 2;
        } else {
          ctx.fillStyle = categoryColors.fill;
          ctx.strokeStyle = categoryColors.stroke;
          ctx.lineWidth = 1;
        }
        
        ctx.fillRect(roomX, roomZ, roomWidth, roomHeight);
        ctx.strokeRect(roomX, roomZ, roomWidth, roomHeight);

        if (roomWidth > 25 && roomHeight > 14) {
          ctx.fillStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.8)';
          ctx.font = isHovered ? 'bold 9px system-ui' : '8px system-ui';
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

    // Draw camera
    const camera = viewer.camera;
    if (camera && camera.eye && camera.look) {
      const eye = camera.eye;
      const look = camera.look;
      
      const camX = offsetX + (eye[0] - aabb[0]) * scale;
      const camZ = offsetZ + (eye[2] - aabb[2]) * scale;
      const lookX = offsetX + (look[0] - aabb[0]) * scale;
      const lookZ = offsetZ + (look[2] - aabb[2]) * scale;

      const angle = Math.atan2(lookZ - camZ, lookX - camX);
      const fovAngle = 0.4;
      const coneLength = 20;
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(camX, camZ);
      ctx.lineTo(camX + Math.cos(angle - fovAngle) * coneLength, camZ + Math.sin(angle - fovAngle) * coneLength);
      ctx.lineTo(camX + Math.cos(angle + fovAngle) * coneLength, camZ + Math.sin(angle + fovAngle) * coneLength);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(camX, camZ);
      ctx.lineTo(lookX, lookZ);
      ctx.stroke();

      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(camX, camZ, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath();
      ctx.arc(camX, camZ, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [getXeokitViewer, showRooms, rooms, hoveredRoomId]);

  // Find room at canvas position using ref
  const findRoomAtPosition = useCallback((canvasX: number, canvasY: number): RoomData | null => {
    if (!showRooms) return null;
    
    for (let i = rooms.length - 1; i >= 0; i--) {
      const room = rooms[i];
      const rect = roomRectsRef.current.get(room.id);
      if (rect) {
        if (canvasX >= rect.x && canvasX <= rect.x + rect.width && 
            canvasY >= rect.y && canvasY <= rect.y + rect.height) {
          return room;
        }
      }
    }
    return null;
  }, [rooms, showRooms]);

  // Handle mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const room = findRoomAtPosition(x, y);
    setHoveredRoomId(room?.id || null);
  }, [findRoomAtPosition]);

  // Handle click
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

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartRef.current = { x: e.clientX, y: e.clientY, width: size.width, height: size.height };
  }, [size]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMoveResize = (e: MouseEvent) => {
      const dx = resizeStartRef.current.x - e.clientX;
      const dy = resizeStartRef.current.y - e.clientY;
      setSize({
        width: Math.max(200, Math.min(450, resizeStartRef.current.width + dx)),
        height: Math.max(150, Math.min(350, resizeStartRef.current.height + dy)),
      });
    };

    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMoveResize);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMoveResize);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      setSize({ width: 260, height: 200 });
    } else {
      setSize({ width: 400, height: 300 });
    }
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  if (!isVisible) return null;

  return (
    <TooltipProvider>
      <div
        ref={panelRef}
        className={cn(
          "absolute bottom-16 right-4 z-20",
          "bg-card/95 backdrop-blur-sm border border-border/50 rounded-lg shadow-xl",
          "overflow-hidden",
          isResizing && "select-none"
        )}
        style={{ width: size.width, height: size.height }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-2 py-1.5 bg-muted/30 border-b border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">Minimap</span>
            {rooms.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {rooms.length} rum
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showLegend ? "secondary" : "ghost"}
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setShowLegend(!showLegend)}
                >
                  <Info className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{showLegend ? 'Dölj' : 'Visa'} legend</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showRooms ? "secondary" : "ghost"}
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setShowRooms(!showRooms)}
                >
                  <Layers className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{showRooms ? 'Dölj' : 'Visa'} rum</p>
              </TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleExpand}>
              {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Legend */}
        {showLegend && (
          <div className="px-2 py-1.5 bg-background/80 border-b border-border/50 flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(ROOM_CATEGORIES).map(([key, { label, color }]) => {
              const count = categoryStats[key as RoomCategoryKey];
              if (count === 0) return null;
              return (
                <div key={key} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-foreground/70">({count})</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Canvas */}
        <canvas
          ref={minimapCanvasRef}
          width={size.width}
          height={size.height - (showLegend ? 56 : 32)}
          className={cn(
            "w-full",
            hoveredRoom ? "cursor-pointer" : "cursor-crosshair"
          )}
          style={{ height: `calc(100% - ${showLegend ? 56 : 32}px)` }}
          onClick={handleMinimapClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredRoomId(null)}
        />

        {/* Hovered room tooltip */}
        {hoveredRoom && (
          <div className="absolute bottom-1 left-1 right-1 px-2 py-1 bg-background/90 backdrop-blur-sm rounded border border-border/50 text-[10px]">
            <div className="flex items-center gap-2">
              <div 
                className="w-2 h-2 rounded-sm flex-shrink-0" 
                style={{ backgroundColor: ROOM_CATEGORIES[hoveredRoom.category].color }} 
              />
              <span className="font-medium truncate">{hoveredRoom.name}</span>
              <span className="text-muted-foreground ml-auto flex-shrink-0">
                {ROOM_CATEGORIES[hoveredRoom.category].label}
              </span>
            </div>
            {hoveredRoom.rentalObject && (
              <div className="text-muted-foreground mt-0.5">
                Hyresobjekt: {hoveredRoom.rentalObject}
              </div>
            )}
          </div>
        )}

        {/* Resize handle */}
        <div
          className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize"
          onMouseDown={handleResizeStart}
        >
          <div className="absolute top-1 left-1 w-2 h-2 border-l-2 border-t-2 border-muted-foreground/30" />
        </div>
      </div>
    </TooltipProvider>
  );
};

export default MinimapPanel;
