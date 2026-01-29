import React, { useEffect } from 'react';
import { Crosshair, X } from 'lucide-react';
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
  // Cleanup temp markers on unmount
  useEffect(() => {
    return () => {
      // Remove all temp pick markers when this component unmounts
      document.querySelectorAll('.temp-pick-marker').forEach(el => el.remove());
    };
  }, []);

  const handleCoordinatePicked = (
    coords: { x: number; y: number; z: number },
    _parentNode: NavigatorNode | null
  ) => {
    // Position confirmed via AssetPlusViewer's built-in confirmation UI
    // Just pass it up to the parent
    onPositionConfirmed(coords);
    toast.success('Position bekräftad', {
      description: `X: ${coords.x.toFixed(2)}, Y: ${coords.y.toFixed(2)}, Z: ${coords.z.toFixed(2)}`,
    });
    // Do NOT call onClose() - keep 3D view open until form is saved
  };

  const handleClose = () => {
    // Cleanup markers before closing
    document.querySelectorAll('.temp-pick-marker').forEach(el => el.remove());
    onClose();
  };

  // Use room if available for better camera positioning, otherwise building
  const targetFmGuid = roomFmGuid || buildingFmGuid;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Minimal toolbar - just title and close */}
      <div className="flex items-center justify-between p-2 border-b bg-background/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Välj 3D-position</span>
        </div>
        <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Instructions */}
      <div className="bg-primary/10 px-3 py-2 text-sm text-primary shrink-0">
        Klicka på en yta för att markera position. Bekräfta sedan i modellen.
      </div>

      {/* 3D Viewer - uses its own built-in confirmation UI */}
      <div className="flex-1 min-h-0">
        <AssetPlusViewer
          fmGuid={targetFmGuid}
          pickModeEnabled={true}
          onCoordinatePicked={handleCoordinatePicked}
          onClose={handleClose}
        />
      </div>
    </div>
  );
};

export default Inline3dPositionPicker;
