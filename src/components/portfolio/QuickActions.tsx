import React from 'react';
import { 
  Globe, Network, Package, BarChart, Cuboid, 
  FileText, DoorOpen, Zap, View 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Facility } from '@/lib/types';

interface QuickActionsProps {
  facility: Facility;
  onOpenMap: () => void;
  onOpenNavigator: (facility: Facility) => void;
  onShowAssets: (facility: Facility) => void;
  onShowRooms: (facility: Facility) => void;
  onOpen360: (siteId?: string) => void;
  onToggle3D: (facility: Facility) => void;
  onShowDocs: (facility: Facility) => void;
  onShowInsights: (facility: Facility) => void;
  onOpenIoT: (facility: Facility) => void;
}

const QuickActions: React.FC<QuickActionsProps> = ({ 
  facility, 
  onOpenMap, 
  onOpenNavigator, 
  onShowAssets, 
  onShowRooms, 
  onOpen360, 
  onToggle3D, 
  onShowDocs, 
  onShowInsights, 
  onOpenIoT 
}) => {
  const isBuilding = facility.category === 'Building';
  const isStorey = facility.category === 'Building Storey';

  return (
    <Card className="mt-6">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Snabbåtgärder</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          {isBuilding && (
            <Button variant="ghost" onClick={() => onShowInsights(facility)} className="justify-start sm:justify-center gap-2 h-auto py-3">
              <BarChart size={14} className="text-accent" />
              <span className="text-xs">Insights</span>
            </Button>
          )}
          <Button variant="ghost" onClick={() => onShowAssets(facility)} className="justify-start sm:justify-center gap-2 h-auto py-3">
            <Package size={14} className="text-primary" />
            <span className="text-xs">Assets</span>
          </Button>
          {(isBuilding || isStorey) && (
            <Button variant="ghost" onClick={() => onShowRooms(facility)} className="justify-start sm:justify-center gap-2 h-auto py-3">
              <DoorOpen size={14} className="text-accent" />
              <span className="text-xs">Rum</span>
            </Button>
          )}
          {(isBuilding || isStorey) && (
            <Button variant="ghost" onClick={onOpenMap} className="justify-start sm:justify-center gap-2 h-auto py-3">
              <Globe size={14} className="text-accent" />
              <span className="text-xs">Karta</span>
            </Button>
          )}
          <Button variant="ghost" onClick={() => onShowDocs(facility)} className="justify-start sm:justify-center gap-2 h-auto py-3">
             <FileText size={14} className="text-primary" />
            <span className="text-xs">Docs+</span>
          </Button>
          <Button variant="ghost" onClick={() => onOpenNavigator(facility)} className="justify-start sm:justify-center gap-2 h-auto py-3">
            <Network size={14} className="text-primary" />
            <span className="text-xs">Navigator</span>
          </Button>
          {isBuilding && (
            <Button variant="ghost" onClick={() => onToggle3D(facility)} className="justify-start sm:justify-center gap-2 h-auto py-3">
              <Cuboid size={14} className="text-primary" />
              <span className="text-xs">3D</span>
            </Button>
          )}
          {(isBuilding || isStorey) && (
            <Button variant="ghost" onClick={() => onOpen360(facility.siteId)} className="justify-start sm:justify-center gap-2 h-auto py-3">
              <View size={14} className="text-destructive" />
              <span className="text-xs">360+</span>
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenIoT(facility)} className="justify-start sm:justify-center gap-2 h-auto py-3">
             <Zap size={14} className="text-primary" />
            <span className="text-xs">IOT+</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default QuickActions;
