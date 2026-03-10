import React, { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, RotateCcw, Crosshair } from 'lucide-react';
import { toast } from 'sonner';
import NativeXeokitViewer from '@/components/viewer/NativeXeokitViewer';

interface PositionPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingFmGuid: string;
  roomFmGuid?: string;
  onPositionPicked: (coords: { x: number; y: number; z: number }) => void;
}

const PositionPickerDialog: React.FC<PositionPickerDialogProps> = ({
  open,
  onOpenChange,
  buildingFmGuid,
  roomFmGuid,
  onPositionPicked,
}) => {
  const [pendingCoords, setPendingCoords] = useState<{ x: number; y: number; z: number } | null>(null);
  const viewerRef = useRef<any>(null);

  const handleViewerReady = useCallback((viewer: any) => {
    viewerRef.current = viewer;
    const canvas = viewer.scene.canvas.canvas;

    // Single-click pick
    canvas.addEventListener('pointerup', (e: PointerEvent) => {
      // Ignore if it was a drag (orbit/pan)
      if ((e as any).__dragged) return;
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const hit = viewer.scene.pick({ canvasPos: [canvasX, canvasY], pickSurface: true });
      if (hit?.worldPos) {
        const coords = { x: hit.worldPos[0], y: hit.worldPos[1], z: hit.worldPos[2] };
        setPendingCoords(coords);

        // Warn if picking in 2D/ortho mode
        if (viewer.camera.projection === 'ortho') {
          toast.info('Position vald i 2D — höjden kanske inte stämmer', {
            description: 'Byt till 3D för exakt höjd.',
          });
        }
      }
    });

    // Track drag to avoid picking on orbit
    let startX = 0, startY = 0;
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      startX = e.clientX; startY = e.clientY;
      (e as any).__dragged = false;
    });
    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.buttons > 0) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.sqrt(dx * dx + dy * dy) > 6) {
          (e as any).__dragged = true;
        }
      }
    });

    // Fly to room if provided
    if (roomFmGuid) {
      // Wait a bit for models to load, then fly to room entity
      const tryFlyToRoom = () => {
        const normalizedRoom = roomFmGuid.toLowerCase().replace(/-/g, '');
        const objects = viewer.scene.objects;
        for (const id of Object.keys(objects)) {
          const normalizedId = id.toLowerCase().replace(/-/g, '');
          if (normalizedId.includes(normalizedRoom)) {
            const entity = objects[id];
            if (entity?.aabb) {
              viewer.cameraFlight.flyTo({ aabb: entity.aabb, duration: 0.8 });
              return true;
            }
          }
        }
        return false;
      };

      // Try immediately, then retry after models load
      if (!tryFlyToRoom()) {
        const interval = setInterval(() => {
          if (tryFlyToRoom()) clearInterval(interval);
        }, 1000);
        setTimeout(() => clearInterval(interval), 10000);
      }
    }
  }, [roomFmGuid]);

  const handleConfirm = () => {
    if (pendingCoords) {
      onPositionPicked(pendingCoords);
      setPendingCoords(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[85vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-4 pb-2 flex-shrink-0">
          <DialogTitle>Välj position i 3D-modellen</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Klicka i modellen för att välja position
          </p>
        </DialogHeader>
        <div className="flex-1 min-h-0 relative">
          <NativeXeokitViewer
            buildingFmGuid={buildingFmGuid}
            onClose={() => onOpenChange(false)}
            onViewerReady={handleViewerReady}
          />

          {!pendingCoords && (
            <div className="absolute top-3 left-3 z-20 bg-primary/90 text-primary-foreground text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 shadow-md">
              <Crosshair className="h-3.5 w-3.5" />
              <span>Klicka för att välja position</span>
            </div>
          )}

          {pendingCoords && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-background/95 backdrop-blur border rounded-lg shadow-lg p-3 flex items-center gap-3">
              <p className="text-sm font-mono">
                X: {pendingCoords.x.toFixed(2)}, Y: {pendingCoords.y.toFixed(2)}, Z: {pendingCoords.z.toFixed(2)}
              </p>
              <Button size="sm" variant="outline" onClick={() => setPendingCoords(null)} className="gap-1">
                <RotateCcw className="h-3.5 w-3.5" />
                Välj om
              </Button>
              <Button size="sm" onClick={handleConfirm} className="gap-1">
                <Check className="h-3.5 w-3.5" />
                Bekräfta
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PositionPickerDialog;
