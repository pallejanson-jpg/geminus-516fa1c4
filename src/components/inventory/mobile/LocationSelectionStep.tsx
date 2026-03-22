import React, { useContext, useMemo } from 'react';
import { Building2, Layers, DoorOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { AppContext } from '@/context/AppContext';
import type { WizardFormData } from './MobileInventoryWizard';

// Constant for "no room selected" - Radix UI requires non-empty string
const NONE_ROOM_VALUE = '__none__';

interface LocationSelectionStepProps {
  formData: WizardFormData;
  updateFormData: (updates: Partial<WizardFormData>) => void;
  onComplete: () => void;
  quickLoopEnabled: boolean;
  setQuickLoopEnabled: (enabled: boolean) => void;
}

const LocationSelectionStep: React.FC<LocationSelectionStepProps> = ({
  formData,
  updateFormData,
  onComplete,
  quickLoopEnabled,
  setQuickLoopEnabled,
}) => {
  const { navigatorTreeData, isLoadingData, refreshInitialData } = useContext(AppContext);

  // Get buildings from navigator tree
  const buildings = useMemo(() => {
    return navigatorTreeData.filter(
      (node) => node.category === 'Building' || node.category === 'IfcBuilding'
    );
  }, [navigatorTreeData]);

  // Get floors for selected building
  const floors = useMemo(() => {
    if (!formData.buildingFmGuid) return [];

    const building = navigatorTreeData.find((n) => n.fmGuid === formData.buildingFmGuid);
    if (!building?.children) return [];

    return building.children.filter(
      (child) => child.category === 'Building Storey' || child.category === 'IfcBuildingStorey'
    );
  }, [navigatorTreeData, formData.buildingFmGuid]);

  // Get rooms for selected floor
  const rooms = useMemo(() => {
    if (!formData.levelFmGuid) return [];

    const findFloor = (nodes: typeof navigatorTreeData): typeof navigatorTreeData[0] | null => {
      for (const node of nodes) {
        if (node.fmGuid === formData.levelFmGuid) return node;
        if (node.children) {
          const found = findFloor(node.children);
          if (found) return found;
        }
      }
      return null;
    };

    const floor = findFloor(navigatorTreeData);
    if (!floor?.children) return [];

    // Find Space category children (may be nested)
    const findSpaces = (nodes: typeof navigatorTreeData): typeof navigatorTreeData => {
      const spaces: typeof navigatorTreeData = [];
      for (const node of nodes) {
        if (node.category === 'Space' || node.category === 'IfcSpace') {
          spaces.push(node);
        }
        if (node.children) {
          spaces.push(...findSpaces(node.children));
        }
      }
      return spaces;
    };

    return findSpaces(floor.children);
  }, [navigatorTreeData, formData.levelFmGuid]);

  const handleBuildingChange = (fmGuid: string) => {
    const building = buildings.find((b) => b.fmGuid === fmGuid);
    updateFormData({
      buildingFmGuid: fmGuid,
      buildingName: building?.commonName || building?.name || '',
      levelFmGuid: '',
      levelName: '',
      roomFmGuid: '',
      roomName: '',
    });
  };

  const handleFloorSelect = (floor: { fmGuid: string; name?: string; commonName?: string }) => {
    updateFormData({
      levelFmGuid: floor.fmGuid,
      levelName: floor.commonName || floor.name || '',
      roomFmGuid: '',
      roomName: '',
    });
  };

  const handleRoomChange = (fmGuid: string) => {
    if (fmGuid === NONE_ROOM_VALUE) {
      updateFormData({
        roomFmGuid: '',
        roomName: '',
      });
      return;
    }
    const room = rooms.find((r) => r.fmGuid === fmGuid);
    updateFormData({
      roomFmGuid: fmGuid,
      roomName: room?.commonName || room?.name || '',
    });
  };

  const canContinue = formData.buildingFmGuid && formData.levelFmGuid;

  // Show loading if data is still loading
  if (isLoadingData) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <p className="text-center text-muted-foreground">Loading buildings...</p>
      </div>
    );
  }

  // Show message if data is empty after loading
  if (!isLoadingData && navigatorTreeData.length === 0) {
    return (
      <div className="p-4 space-y-4 flex flex-col items-center justify-center h-full">
        <Building2 className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground text-center">
          No data found. Check that synchronization has been completed in Settings.
        </p>
        <Button variant="outline" onClick={() => refreshInitialData()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">
        {/* Building selector */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <Label className="text-base font-medium">Building *</Label>
          </div>
          <Select value={formData.buildingFmGuid} onValueChange={handleBuildingChange}>
            <SelectTrigger className="h-14 text-base">
              <SelectValue placeholder="Select building..." />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              {buildings.map((b) => (
                <SelectItem key={b.fmGuid} value={b.fmGuid} className="py-3">
                  {b.commonName || b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {formData.buildingName && (
            <p className="text-sm text-green-600">✓ {formData.buildingName}</p>
          )}
        </div>

        {/* Floor selector - large touch buttons */}
        {formData.buildingFmGuid && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              <Label className="text-base font-medium">Floor *</Label>
            </div>
            {floors.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {floors.map((floor) => {
                  const isSelected = formData.levelFmGuid === floor.fmGuid;
                  const displayName = floor.commonName || floor.name || 'Floor';

                  return (
                    <Button
                      key={floor.fmGuid}
                      type="button"
                      variant={isSelected ? 'default' : 'outline'}
                      className={`h-16 text-base ${isSelected ? '' : 'border-2'}`}
                      onClick={() => handleFloorSelect(floor)}
                    >
                      {displayName}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No floors found for this building</p>
            )}
          </div>
        )}

        {/* Room selector (optional) */}
        {formData.levelFmGuid && rooms.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <DoorOpen className="h-5 w-5 text-primary" />
              <Label className="text-base font-medium">Room (optional)</Label>
            </div>
            <Select 
              value={formData.roomFmGuid || NONE_ROOM_VALUE} 
              onValueChange={handleRoomChange}
            >
              <SelectTrigger className="h-14 text-base">
                <SelectValue placeholder="Select room..." />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50 max-h-64">
                <SelectItem value={NONE_ROOM_VALUE} className="py-3">
                  No specific room
                </SelectItem>
                {rooms.map((room) => (
                  <SelectItem key={room.fmGuid} value={room.fmGuid} className="py-3">
                    {room.commonName || room.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Quick loop toggle */}
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div className="space-y-1">
            <Label className="text-base">Snabb-registrering</Label>
            <p className="text-sm text-muted-foreground">
              Behåll plats och kategori för nästa tillgång
            </p>
          </div>
          <Switch checked={quickLoopEnabled} onCheckedChange={setQuickLoopEnabled} />
        </div>

        {/* Continue button */}
        <Button
          onClick={onComplete}
          disabled={!canContinue}
          className="w-full h-14 text-lg mt-4"
        >
          Fortsätt →
        </Button>
      </div>
    </ScrollArea>
  );
};

export default LocationSelectionStep;
