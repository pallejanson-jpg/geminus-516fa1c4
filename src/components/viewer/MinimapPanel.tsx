import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MinimapPanelProps {
  viewerRef: React.MutableRefObject<any>;
  isVisible: boolean;
  onClose: () => void;
}

/**
 * Minimap panel for 3D Viewer
 * Shows a top-down overview of the model with current camera position
 * Click to navigate to different areas
 */
const MinimapPanel: React.FC<MinimapPanelProps> = ({ viewerRef, isVisible, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 200, height: 150 });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
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

    // Draw grid lines for reference
    ctx.strokeStyle = 'hsl(var(--border) / 0.3)';
    ctx.lineWidth = 0.5;
    const gridSize = 4;
    for (let i = 1; i < gridSize; i++) {
      // Vertical lines
      const gx = offsetX + (modelWidth * scale * i) / gridSize;
      ctx.beginPath();
      ctx.moveTo(gx, offsetZ);
      ctx.lineTo(gx, offsetZ + modelDepth * scale);
      ctx.stroke();
      
      // Horizontal lines
      const gz = offsetZ + (modelDepth * scale * i) / gridSize;
      ctx.beginPath();
      ctx.moveTo(offsetX, gz);
      ctx.lineTo(offsetX + modelWidth * scale, gz);
      ctx.stroke();
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
  }, [getXeokitViewer]);

  // Handle click on minimap to navigate
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapCanvasRef.current;
    const viewer = getXeokitViewer();
    if (!canvas || !viewer || !sceneInfo?.aabb) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const { aabb, scale, offsetX, offsetZ } = sceneInfo;

    // Convert canvas coords to world coords
    const worldX = aabb[0] + (x - offsetX) / scale;
    const worldZ = aabb[2] + (y - offsetZ) / scale;
    const worldY = (aabb[1] + aabb[4]) / 2; // Middle height

    // Fly camera to look at this point from above
    const camera = viewer.camera;
    if (camera && viewer.cameraFlight) {
      const currentEye = camera.eye;
      const height = currentEye[1] - worldY;
      
      viewer.cameraFlight.flyTo({
        eye: [worldX, currentEye[1], worldZ],
        look: [worldX, worldY, worldZ],
        up: [0, 1, 0],
        duration: 0.5
      });
    }
  }, [getXeokitViewer, sceneInfo]);

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

    const handleMouseMove = (e: MouseEvent) => {
      const dx = resizeStartRef.current.x - e.clientX;
      const dy = resizeStartRef.current.y - e.clientY;
      setSize({
        width: Math.max(150, Math.min(400, resizeStartRef.current.width + dx)),
        height: Math.max(100, Math.min(300, resizeStartRef.current.height + dy)),
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Toggle expand/collapse
  const toggleExpand = useCallback(() => {
    if (isExpanded) {
      setSize({ width: 200, height: 150 });
    } else {
      setSize({ width: 320, height: 240 });
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
        <span className="text-xs font-medium text-muted-foreground">Minimap</span>
        <div className="flex items-center gap-1">
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
        className="w-full h-[calc(100%-28px)] cursor-crosshair"
        onClick={handleMinimapClick}
        title="Klicka för att navigera"
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
