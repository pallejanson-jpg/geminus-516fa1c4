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
 * Shows a small overview of the entire model with current viewport indicator
 * Resizable via drag handles
 */
const MinimapPanel: React.FC<MinimapPanelProps> = ({ viewerRef, isVisible, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 200, height: 150 });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Get xeokit viewer reference
  const getXeokitViewer = useCallback(() => {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
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
    const aabb = scene?.getAABB?.();
    if (!aabb) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate scale
    const modelWidth = aabb[3] - aabb[0];
    const modelDepth = aabb[5] - aabb[2];
    const padding = 20;
    const scaleX = (canvas.width - padding * 2) / modelWidth;
    const scaleZ = (canvas.height - padding * 2) / modelDepth;
    const scale = Math.min(scaleX, scaleZ);

    // Draw model footprint
    ctx.fillStyle = '#3a3a5e';
    ctx.strokeStyle = '#5a5a8e';
    ctx.lineWidth = 1;
    
    const drawX = padding + (modelWidth * scale) / 2;
    const drawZ = padding + (modelDepth * scale) / 2;
    
    ctx.fillRect(
      drawX - (modelWidth * scale) / 2,
      drawZ - (modelDepth * scale) / 2,
      modelWidth * scale,
      modelDepth * scale
    );
    ctx.strokeRect(
      drawX - (modelWidth * scale) / 2,
      drawZ - (modelDepth * scale) / 2,
      modelWidth * scale,
      modelDepth * scale
    );

    // Draw camera position indicator
    const camera = viewer.camera;
    if (camera) {
      const eye = camera.eye;
      const look = camera.look;
      
      // Map camera position to canvas
      const camX = padding + (eye[0] - aabb[0]) * scale;
      const camZ = padding + (eye[2] - aabb[2]) * scale;
      const lookX = padding + (look[0] - aabb[0]) * scale;
      const lookZ = padding + (look[2] - aabb[2]) * scale;

      // Draw look direction line
      ctx.strokeStyle = 'hsl(var(--primary))';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(camX, camZ);
      ctx.lineTo(lookX, lookZ);
      ctx.stroke();

      // Draw camera position
      ctx.fillStyle = 'hsl(var(--primary))';
      ctx.beginPath();
      ctx.arc(camX, camZ, 6, 0, Math.PI * 2);
      ctx.fill();

      // Draw look target
      ctx.fillStyle = 'hsl(var(--accent))';
      ctx.beginPath();
      ctx.arc(lookX, lookZ, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [getXeokitViewer]);

  // Update minimap periodically when visible
  useEffect(() => {
    if (!isVisible) return;

    const interval = setInterval(updateMinimap, 200);
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

      {/* Canvas */}
      <canvas
        ref={minimapCanvasRef}
        width={size.width}
        height={size.height - 28}
        className="w-full h-[calc(100%-28px)]"
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
