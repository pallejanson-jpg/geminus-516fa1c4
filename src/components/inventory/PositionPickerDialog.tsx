import React, { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, RotateCcw, Crosshair } from 'lucide-react';
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
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const targetFmGuid = roomFmGuid || buildingFmGuid;

  const handleViewerReady = useCallback((viewer: any) => {
    viewerRef.current = viewer;
    const canvas = viewer.scene.canvas.canvas;

    // Long-press pick (500ms) for both touch and mouse
    const doPick = (canvasX: number, canvasY: number) => {
      const hit = viewer.scene.pick({ canvasPos: [canvasX, canvasY], pickSurface: true });
      if (hit?.worldPos) {
        setPendingCoords({ x: hit.worldPos[0], y: hit.worldPos[1], z: hit.worldPos[2] });
      }
    };

    // Touch events
    canvas.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      touchStartPos.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      longPressTimer.current = setTimeout(() => {
        if (touchStartPos.current) {
          doPick(touchStartPos.current.x, touchStartPos.current.y);
        }
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
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    });

    // Desktop: double-click to pick
    canvas.addEventListener('dblclick', (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      doPick(e.clientX - rect.left, e.clientY - rect.top);
    });
  }, []);

  const handleConfirm = () => {
    if (pendingCoords) {
      onPositionPicked(pendingCoords);
      setPendingCoords(null);
      onOpenChange(false);
    }
  };

  const handleReset = () => {
    setPendingCoords(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[85vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-4 pb-2 flex-shrink-0">
          <DialogTitle>Välj position i 3D-modellen</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Håll nedtryckt (mobil) eller dubbelklicka (dator) för att välja position
          </p>
        </DialogHeader>
        <div className="flex-1 min-h-0 relative">
          <NativeXeokitViewer
            buildingFmGuid={targetFmGuid}
            onClose={() => onOpenChange(false)}
            onViewerReady={handleViewerReady}
          />

          {/* Instruction banner — top-left, out of the way */}
          {!pendingCoords && (
            <div className="absolute top-3 left-3 z-20 bg-primary/90 text-primary-foreground text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 shadow-md">
              <Crosshair className="h-3.5 w-3.5" />
              <span>Håll nedtryckt för att välja position</span>
            </div>
          )}

          {/* Confirmation bar */}
          {pendingCoords && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-background/95 backdrop-blur border rounded-lg shadow-lg p-3 flex items-center gap-3">
              <p className="text-sm font-mono">
                X: {pendingCoords.x.toFixed(2)}, Y: {pendingCoords.y.toFixed(2)}, Z: {pendingCoords.z.toFixed(2)}
              </p>
              <Button size="sm" variant="outline" onClick={handleReset} className="gap-1">
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
