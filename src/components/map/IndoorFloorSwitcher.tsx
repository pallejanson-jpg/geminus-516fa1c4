import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface IndoorFloorSwitcherProps {
  floors: Array<{ id: string; label: string }>;
  selectedFloor: string | null;
  onSelectFloor: (floorId: string) => void;
}

const IndoorFloorSwitcher: React.FC<IndoorFloorSwitcherProps> = ({ floors, selectedFloor, onSelectFloor }) => {
  if (floors.length === 0) return null;

  return (
    <div className="absolute bottom-24 left-3 z-10 flex flex-col gap-1 bg-card/95 backdrop-blur-sm rounded-lg p-1 shadow-lg border border-border">
      {floors.map(floor => (
        <Button
          key={floor.id}
          variant={selectedFloor === floor.id ? 'default' : 'ghost'}
          size="sm"
          className={cn(
            'h-8 w-8 p-0 text-xs font-medium',
            selectedFloor === floor.id && 'bg-primary text-primary-foreground'
          )}
          onClick={() => onSelectFloor(floor.id)}
        >
          {floor.label}
        </Button>
      ))}
    </div>
  );
};

export default IndoorFloorSwitcher;
