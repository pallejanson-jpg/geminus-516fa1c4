import React, { useState } from 'react';
import { Crosshair, X, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import AssetPlusViewer from '@/components/viewer/AssetPlusViewer';
import { NavigatorNode } from '@/components/navigator/TreeNode';

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
  const [pickModeActive, setPickModeActive] = useState(false);

  const handleCoordinatePicked = (
    coords: { x: number; y: number; z: number },
    _parentNode: NavigatorNode | null
  ) => {
    // Save coordinates but do NOT close the viewer
    setPendingCoords(coords);
    toast.success('Position markerad', {
      description: `X: ${coords.x.toFixed(2)}, Y: ${coords.y.toFixed(2)}, Z: ${coords.z.toFixed(2)}`,
    });
  };

  const handleConfirm = () => {
    if (pendingCoords) {
      onPositionConfirmed(pendingCoords);
      // Do NOT call onClose() - keep 3D view open until form is saved
    }
  };

  const handleReset = () => {
    setPendingCoords(null);
  };

  // Use room if available for better camera positioning, otherwise building
  const targetFmGuid = roomFmGuid || buildingFmGuid;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-background/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Välj 3D-position</span>
        </div>
        <div className="flex items-center gap-2">
          {!pickModeActive && !pendingCoords && (
            <Button 
              size="sm" 
              onClick={() => setPickModeActive(true)}
              className="gap-1"
            >
              <Crosshair className="h-3 w-3" />
              Börja välja
            </Button>
          )}
          {pendingCoords && (
            <>
              <Button 
                size="sm" 
                variant="outline"
                onClick={handleReset}
                className="gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                Välj ny
              </Button>
              <Button 
                size="sm" 
                onClick={handleConfirm}
                className="gap-1"
              >
                <Check className="h-3 w-3" />
                Bekräfta
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Instructions / Status */}
      {pickModeActive && !pendingCoords && (
        <div className="bg-primary/10 px-3 py-2 text-sm text-primary shrink-0">
          Navigera i modellen, klicka sedan på en yta för att markera position
        </div>
      )}
      {pendingCoords && (
        <div className="bg-green-500/10 px-3 py-2 text-sm flex items-center justify-between shrink-0">
          <span className="font-mono text-xs">
            Position: X:{pendingCoords.x.toFixed(2)} Y:{pendingCoords.y.toFixed(2)} Z:{pendingCoords.z.toFixed(2)}
          </span>
        </div>
      )}

      {/* 3D Viewer */}
      <div className="flex-1 min-h-0">
        <AssetPlusViewer
          fmGuid={targetFmGuid}
          pickModeEnabled={pickModeActive && !pendingCoords}
          onCoordinatePicked={handleCoordinatePicked}
          onClose={onClose}
        />
      </div>
    </div>
  );
};

export default Inline3dPositionPicker;
