import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import InventoryForm from './InventoryForm';
import type { InventoryItem } from '@/pages/Inventory';

interface InventoryFormSheetProps {
  isOpen: boolean;
  onClose: () => void;
  buildingFmGuid: string;
  levelFmGuid?: string | null;
  roomFmGuid?: string | null;
  pendingPosition?: { x: number; y: number; z: number } | null;
  onPickPositionRequest?: () => void;
  isPickingPosition?: boolean;
  onPendingPositionConsumed?: () => void;
}

/**
 * Sheet-based wrapper for InventoryForm used in the 3D viewer.
 * Opens as a side panel while the user can pick positions in the existing viewer.
 */
const InventoryFormSheet: React.FC<InventoryFormSheetProps> = ({
  isOpen,
  onClose,
  buildingFmGuid,
  levelFmGuid,
  roomFmGuid,
  pendingPosition,
  onPickPositionRequest,
  isPickingPosition,
  onPendingPositionConsumed,
}) => {
  const handleSaved = (item: InventoryItem) => {
    onClose();
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-md overflow-y-auto p-0"
        // Prevent closing when clicking overlay while picking position
        onInteractOutside={(e) => {
          if (isPickingPosition) {
            e.preventDefault();
          }
        }}
      >
        <SheetHeader className="px-6 pt-6">
          <SheetTitle>Registrera tillgång</SheetTitle>
        </SheetHeader>
        <div className="px-6 pb-6">
          <InventoryForm
            onSaved={handleSaved}
            onCancel={onClose}
            prefill={{
              buildingFmGuid,
              levelFmGuid: levelFmGuid || undefined,
              roomFmGuid: roomFmGuid || undefined,
            }}
            // Use the inline pick mode instead of opening a separate 3D picker dialog
            onOpen3d={onPickPositionRequest ? () => onPickPositionRequest() : undefined}
            pendingPosition={pendingPosition}
            onPendingPositionConsumed={onPendingPositionConsumed}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default InventoryFormSheet;
