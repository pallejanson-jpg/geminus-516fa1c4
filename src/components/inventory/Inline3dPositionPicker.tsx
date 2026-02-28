import React, { useState, useRef, useCallback } from 'react';
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
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const targetFmGuid = roomFmGuid || buildingFmGuid;

  const handleViewerReady = useCallback((viewer: any) => {
    const canvas = viewer.scene.canvas.canvas;

    const doPick = (canvasX: number, canvasY: number) => {
      const hit = viewer.scene.pick({ canvasPos: [canvasX, canvasY], pickSurface: true });
      if (hit?.worldPos) {
        setPendingCoords({ x: hit.worldPos[0], y: hit.worldPos[1], z: hit.worldPos[2] });
      }
    };

    // Touch long-press (500ms)
    canvas.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      touchStartPos.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      longPressTimer.current = setTimeout(() => {
        if (touchStartPos.current) doPick(touchStartPos.current.x, touchStartPos.current.y);
      }, 500);
    }, { passive: true });

    canvas.addEventListener('touchmove', (e: TouchEvent) => {
      if (longPressTimer.current && touchStartPos.current) {
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const dx = touch.clientX - rect.left - touchStartPos.current.x;
        const dy = touch.clientY - rect.top - touchStartPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    });

    // Desktop: double-click
    canvas.addEventListener('dblclick', (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      doPick(e.clientX - rect.left, e.clientY - rect.top);
    });
  }, []);

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
          buildingFmGuid={targetFmGuid}
          onClose={onClose}
          onViewerReady={handleViewerReady}
        />

        {/* Instruction — top-left */}
        {!pendingCoords && (
          <div className="absolute top-3 left-3 z-20 bg-primary/90 text-primary-foreground text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 shadow-md">
            <Crosshair className="h-3.5 w-3.5" />
            <span>Håll nedtryckt för att markera position</span>
          </div>
        )}

        {/* Confirmation bar */}
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
