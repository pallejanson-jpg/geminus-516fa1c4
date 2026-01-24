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
  ivionSiteId?: string | null;
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
  ivionSiteId,
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
    <Card className="mt-4 sm:mt-6">
      <CardHeader className="pb-3 sm:pb-4">
        <CardTitle className="text-sm sm:text-base">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-2 md:gap-4">
          {isBuilding && (
            <Button variant="ghost" onClick={() => onShowInsights(facility)} className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4">
              <BarChart size={12} className="sm:w-3.5 sm:h-3.5 text-accent" />
              <span className="text-[10px] sm:text-xs">Insights</span>
            </Button>
          )}
          <Button variant="ghost" onClick={() => onShowAssets(facility)} className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4">
            <Package size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
            <span className="text-[10px] sm:text-xs">Assets</span>
          </Button>
          {(isBuilding || isStorey) && (
            <Button variant="ghost" onClick={() => onShowRooms(facility)} className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4">
              <DoorOpen size={12} className="sm:w-3.5 sm:h-3.5 text-accent" />
              <span className="text-[10px] sm:text-xs">Rooms</span>
            </Button>
          )}
          {(isBuilding || isStorey) && (
            <Button variant="ghost" onClick={onOpenMap} className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4">
              <Globe size={12} className="sm:w-3.5 sm:h-3.5 text-accent" />
              <span className="text-[10px] sm:text-xs">Map</span>
            </Button>
          )}
          <Button variant="ghost" onClick={() => onShowDocs(facility)} className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4">
             <FileText size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
            <span className="text-[10px] sm:text-xs">Docs+</span>
          </Button>
          <Button variant="ghost" onClick={() => onOpenNavigator(facility)} className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4">
            <Network size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
            <span className="text-[10px] sm:text-xs">Navigator</span>
          </Button>
          {isBuilding && (
            <Button variant="ghost" onClick={() => onToggle3D(facility)} className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4">
              <Cuboid size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
              <span className="text-[10px] sm:text-xs">3D</span>
            </Button>
          )}
          {(isBuilding || isStorey) && (
            <Button 
              variant="ghost" 
              onClick={() => ivionSiteId ? onOpen360(ivionSiteId) : undefined} 
              className={`justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4 ${!ivionSiteId ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={ivionSiteId ? `Open Ivion: ${ivionSiteId}` : 'Configure Ivion Site ID in settings'}
              disabled={!ivionSiteId}
            >
              <View size={12} className={`sm:w-3.5 sm:h-3.5 ${ivionSiteId ? 'text-destructive' : 'text-muted-foreground'}`} />
              <span className={`text-[10px] sm:text-xs ${!ivionSiteId ? 'text-muted-foreground' : ''}`}>360+</span>
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenIoT(facility)} className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4">
             <Zap size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
            <span className="text-[10px] sm:text-xs">IOT+</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default QuickActions;
