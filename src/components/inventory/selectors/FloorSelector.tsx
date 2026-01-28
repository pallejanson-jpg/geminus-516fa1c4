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

interface FloorSelectorProps {
  buildingFmGuid: string;
  value: string;
  onChange: (value: string) => void;
}

const FloorSelector: React.FC<FloorSelectorProps> = ({
  buildingFmGuid,
  value,
  onChange,
}) => {
  const { navigatorTreeData } = useContext(AppContext);

  const building = navigatorTreeData.find((b) => b.fmGuid === buildingFmGuid);
  const floors =
    building?.children?.filter(
      (c) => c.category === 'Building Storey' || c.category === 'IfcBuildingStorey'
    ) || [];

  if (floors.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label className="text-base">Våningsplan</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12">
          <SelectValue placeholder="Välj våning..." />
        </SelectTrigger>
        <SelectContent className="bg-popover z-50">
          {floors.map((f) => (
            <SelectItem key={f.fmGuid} value={f.fmGuid}>
              {f.commonName || f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default FloorSelector;
