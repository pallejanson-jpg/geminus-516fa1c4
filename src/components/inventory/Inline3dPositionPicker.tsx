import React, { useState, useCallback } from 'react';
import { Crosshair, X, Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import NativeXeokitViewer from '@/components/viewer/NativeXeokitViewer';

interface Inline3dPositionPickerProps {
  buildingFmGuid: string;
  roomFmGuid?: string;
  onPositionConfirmed: (coords: { x: number; y: number; z: number }) => void;
  onClose: () => void;
}

const Inline3dPositionPicker: React.FC<Inline3dPositionPickerProps> = ({
  buildingFmGuid,
  roomFmGuid,
  onPositionConfirmed,
  onClose,
}) => {
  const [pendingCoords, setPendingCoords] = useState<{ x: number; y: number; z: number } | null>(null);

  const handleViewerReady = useCallback((viewer: any) => {
    const canvas = viewer.scene.canvas.canvas;

    // Track drag to distinguish click from orbit
    let startX = 0, startY = 0, dragged = false;
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      startX = e.clientX; startY = e.clientY; dragged = false;
    });
    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.buttons > 0 && !dragged) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.sqrt(dx * dx + dy * dy) > 6) dragged = true;
      }
    });

    // Single-click pick
    canvas.addEventListener('pointerup', (e: PointerEvent) => {
      if (dragged) return;
      const rect = canvas.getBoundingClientRect();
      const hit = viewer.scene.pick({ canvasPos: [e.clientX - rect.left, e.clientY - rect.top], pickSurface: true });
      if (hit?.worldPos) {
        setPendingCoords({ x: hit.worldPos[0], y: hit.worldPos[1], z: hit.worldPos[2] });
        if (viewer.camera.projection === 'ortho') {
          toast.info('Position selected in 2D — height may not be accurate', {
            description: 'Switch to 3D for exact height.',
          });
        }
      }
    });

    // Fly to room if provided
    if (roomFmGuid) {
      const tryFlyToRoom = () => {
        const normalizedRoom = roomFmGuid.toLowerCase().replace(/-/g, '');
        const objects = viewer.scene.objects;
        const metaObjects = viewer.metaScene?.metaObjects || {};

        // Strategy 1: Match entity ID directly
        for (const id of Object.keys(objects)) {
          if (id.toLowerCase().replace(/-/g, '').includes(normalizedRoom)) {
            const entity = objects[id];
            if (entity?.aabb) {
              viewer.cameraFlight.flyTo({ aabb: entity.aabb, duration: 0.8 });
              return true;
            }
          }
        }

        // Strategy 2: Match via metaObject attributes (originalSystemId, FmGuid)
        for (const mo of Object.values(metaObjects) as any[]) {
          const candidates = [
            mo?.originalSystemId,
            mo?.attributes?.FmGuid,
            mo?.attributes?.fmGuid,
            mo?.attributes?.fmguid,
          ].filter(Boolean).map((v: string) => v.toLowerCase().replace(/-/g, ''));

          if (candidates.some(c => c === normalizedRoom || c.includes(normalizedRoom))) {
            const entity = objects[mo.id];
            if (entity?.aabb) {
              viewer.cameraFlight.flyTo({ aabb: entity.aabb, duration: 0.8 });
              return true;
            }
          }
        }

        return false;
      };
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
      onPositionConfirmed(pendingCoords);
      toast.success('Position bekräftad', {
        description: `X: ${pendingCoords.x.toFixed(2)}, Y: ${pendingCoords.y.toFixed(2)}, Z: ${pendingCoords.z.toFixed(2)}`,
      });
      setPendingCoords(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center justify-between p-2 border-b bg-background/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Välj 3D-position</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 relative">
        <NativeXeokitViewer
          buildingFmGuid={buildingFmGuid}
          onClose={onClose}
          onViewerReady={handleViewerReady}
        />

        {!pendingCoords && (
          <div className="absolute top-3 left-3 z-20 bg-primary/90 text-primary-foreground text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 shadow-md">
            <Crosshair className="h-3.5 w-3.5" />
            <span>Click to mark position</span>
          </div>
        )}

        {pendingCoords && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-background/95 backdrop-blur border rounded-lg shadow-lg p-3 flex items-center gap-3">
            <p className="text-sm font-mono">
              {pendingCoords.x.toFixed(2)}, {pendingCoords.y.toFixed(2)}, {pendingCoords.z.toFixed(2)}
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
    </div>
  );
};

export default Inline3dPositionPicker;
