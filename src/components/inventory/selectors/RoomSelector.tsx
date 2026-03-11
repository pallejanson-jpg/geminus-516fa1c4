import React, { useContext } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AppContext } from '@/context/AppContext';

interface RoomSelectorProps {
  levelFmGuid: string;
  value: string;
  onChange: (value: string) => void;
}

const RoomSelector: React.FC<RoomSelectorProps> = ({
  levelFmGuid,
  value,
  onChange,
}) => {
  const { navigatorTreeData } = useContext(AppContext);

  // Find the floor in the tree
  type RoomNode = { fmGuid: string; name?: string; commonName?: string };
  let rooms: RoomNode[] = [];

  for (const building of navigatorTreeData) {
    const floor = building.children?.find((f) => f.fmGuid === levelFmGuid);
    if (floor) {
      rooms =
        (floor.children?.filter(
          (c) => c.category === 'Space' || c.category === 'IfcSpace'
        ) as RoomNode[]) || [];
      break;
    }
  }

  if (rooms.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label className="text-base">Room</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12">
          <SelectValue placeholder="Välj rum..." />
        </SelectTrigger>
        <SelectContent className="bg-popover z-50 max-h-60">
          {rooms.map((r) => (
            <SelectItem key={r.fmGuid} value={r.fmGuid}>
              {r.commonName || r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default RoomSelector;
