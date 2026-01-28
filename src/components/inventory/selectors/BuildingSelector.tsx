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

interface BuildingSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

const BuildingSelector: React.FC<BuildingSelectorProps> = ({ value, onChange }) => {
  const { navigatorTreeData } = useContext(AppContext);

  // Top level nodes are buildings
  const buildings = navigatorTreeData.filter(
    (node) => node.category === 'Building' || node.category === 'IfcBuilding'
  );

  // If no buildings found, show all top-level nodes
  const displayBuildings = buildings.length > 0 ? buildings : navigatorTreeData;

  return (
    <div className="space-y-2">
      <Label className="text-base">Byggnad *</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12">
          <SelectValue placeholder="Välj byggnad..." />
        </SelectTrigger>
        <SelectContent className="bg-popover z-50">
          {displayBuildings.map((b) => (
            <SelectItem key={b.fmGuid} value={b.fmGuid}>
              {b.commonName || b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default BuildingSelector;
