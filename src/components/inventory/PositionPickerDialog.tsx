import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AssetPlusViewer from '@/components/viewer/AssetPlusViewer';
import { NavigatorNode } from '@/components/navigator/TreeNode';

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
  const handleCoordinatePicked = (
    coords: { x: number; y: number; z: number },
    parentNode: NavigatorNode | null
  ) => {
    onPositionPicked(coords);
    onOpenChange(false);
  };

  // Use room if available, otherwise building
  const targetFmGuid = roomFmGuid || buildingFmGuid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[85vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-4 pb-2 flex-shrink-0">
          <DialogTitle>Välj position i 3D-modellen</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Klicka på en yta i modellen för att välja position
          </p>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <AssetPlusViewer
            fmGuid={targetFmGuid}
            pickModeEnabled={true}
            onCoordinatePicked={handleCoordinatePicked}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PositionPickerDialog;
