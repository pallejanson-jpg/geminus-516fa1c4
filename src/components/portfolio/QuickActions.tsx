import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Globe, Package, BarChart, Cuboid, Square,
  DoorOpen, View, Plus, ClipboardList, SplitSquareHorizontal, AlertTriangle, Layers 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Facility } from '@/lib/types';

export interface InventoryPrefill {
  buildingFmGuid?: string;
  levelFmGuid?: string;
  roomFmGuid?: string;
}

interface QuickActionsProps {
  facility: Facility;
  ivionSiteId?: string | null;
  has3DModels?: boolean;
  hasFmAccess?: boolean;
  isLoading?: boolean;
  onOpenMap: () => void;
  onOpenNavigator: (facility: Facility) => void;
  onShowAssets: (facility: Facility) => void;
  onShowRooms: (facility: Facility) => void;
  onOpen360: (siteId?: string) => void;
  onToggle3D: (facility: Facility) => void;
  onToggle2D?: (facility: Facility) => void;
  onShowDocs: (facility: Facility) => void;
  onShowInsights: (facility: Facility) => void;
  onOpenIoT: (facility: Facility) => void;
  onAddAsset?: (facility: Facility) => void;
  onInventory?: (prefill: InventoryPrefill) => void;
  onOpenSplitView?: (facility: Facility) => void;
  onFaultReport?: (facility: Facility) => void;
}

const QuickActions: React.FC<QuickActionsProps> = ({ 
  facility, 
  ivionSiteId,
  has3DModels,
  hasFmAccess,
  isLoading,
  onOpenMap, 
  onOpenNavigator, 
  onShowAssets, 
  onShowRooms, 
  onOpen360, 
  onToggle3D,
  onToggle2D,
  onShowDocs, 
  onShowInsights, 
  onOpenIoT,
  onAddAsset,
  onInventory,
  onOpenSplitView,
  onFaultReport
}) => {
  const navigate = useNavigate();
  const isBuilding = facility.category === 'Building';
  const isStorey = facility.category === 'Building Storey';
  const isSpace = facility.category === 'Space';
  const canAddAsset = isStorey || isSpace;

  // Availability flags for visualization buttons
  const has3D = has3DModels !== false;
  const has360 = !!ivionSiteId;
  const hasSplit = has3D && has360;
  const has2D = hasFmAccess !== false;

  const disabledClass = 'opacity-40 cursor-not-allowed';

  // Unified navigation helper — always routes to /viewer with correct params
  const buildingGuid = isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid || facility.fmGuid;
  const floorParam = isStorey ? `&floor=${facility.fmGuid}&floorName=${encodeURIComponent(facility.commonName || facility.name || '')}` : '';
  const entityParam = isSpace ? `&entity=${facility.fmGuid}` : '';
  
  const navigateToViewer = useCallback((mode: string) => {
    navigate(`/viewer?building=${buildingGuid}&mode=${mode}${floorParam}${entityParam}`);
  }, [navigate, buildingGuid, floorParam, entityParam]);

  // Standardized button style with proper touch targets (min 44x44)
  const btnClass = "w-full justify-center gap-0.5 sm:gap-2 h-auto py-1.5 px-1 sm:py-3 sm:px-4 min-w-0 min-h-[44px] text-[10px] sm:text-sm flex-col sm:flex-row whitespace-normal text-center";
  const iconSize = 14;
  const labelClass = "text-[9px] sm:text-xs leading-tight mt-0.5 sm:mt-0 break-words";

  if (isLoading) {
    return (
      <Card className="mt-4 sm:mt-6">
        <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
          <CardTitle className="text-sm sm:text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-fr items-stretch gap-1 sm:gap-2 md:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-4 sm:mt-6 overflow-hidden">
      <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
        <CardTitle className="text-sm sm:text-base">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="px-2.5 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-fr items-stretch gap-1 sm:gap-2 md:gap-4">
          {/* ===== VISUALIZATION TOOLS ===== */}
          
          {/* 2D - Building, Storey, Space */}
          {(isBuilding || isStorey || isSpace) && (
            <Button 
              variant="ghost" 
              onClick={() => navigateToViewer('2d')}
              className={btnClass}
            >
              <Square size={iconSize} className="text-primary" />
              <span className={labelClass}>2D</span>
            </Button>
          )}

          {/* 3D */}
          {(isBuilding || isStorey || isSpace) && (
            <Button 
              variant="ghost" 
              onClick={() => { if (has3D) navigateToViewer('3d'); }}
              className={`${btnClass} ${!has3D ? disabledClass : ''}`}
            >
              <Cuboid size={iconSize} className="text-primary" />
              <span className={labelClass}>3D</span>
            </Button>
          )}

          {/* 360° */}
          {(isBuilding || isStorey) && (
            <Button 
              variant="ghost" 
              onClick={() => { if (has360) navigateToViewer('360'); }}
              className={`${btnClass} ${!has360 ? disabledClass : ''}`}
            >
              <View size={iconSize} className="text-destructive" />
              <span className={labelClass}>360°</span>
            </Button>
          )}

          {/* Split View - Building only */}
          {isBuilding && (
            <Button 
              variant="ghost" 
              onClick={() => { if (hasSplit) navigateToViewer('split'); }}
              className={`${btnClass} ${!hasSplit ? disabledClass : ''}`}
            >
              <SplitSquareHorizontal size={iconSize} className="text-accent" />
              <span className={labelClass}>3D+360°</span>
            </Button>
          )}

          {/* Virtual Twin - Building only */}
          {isBuilding && (
            <Button 
              variant="ghost" 
              onClick={() => { if (hasSplit) navigateToViewer('vt'); }}
              className={`${btnClass} ${!hasSplit ? disabledClass : ''}`}
            >
              <Layers size={iconSize} className="text-primary" />
              <span className={labelClass}>Virtual Twin</span>
            </Button>
          )}

          {/* ===== DATA & TOOLS ===== */}

          {/* Insights */}
          <Button variant="ghost" onClick={() => onShowInsights(facility)} className={btnClass}>
            <BarChart size={iconSize} className="text-accent" />
            <span className={labelClass}>Insights</span>
          </Button>

          {/* Assets */}
          <Button variant="ghost" onClick={() => onShowAssets(facility)} className={btnClass}>
            <Package size={iconSize} className="text-primary" />
            <span className={labelClass}>Assets</span>
          </Button>

          {/* Rooms */}
          {(isBuilding || isStorey) && (
            <Button variant="ghost" onClick={() => onShowRooms(facility)} className={btnClass}>
              <DoorOpen size={iconSize} className="text-accent" />
              <span className={labelClass}>Rooms</span>
            </Button>
          )}

          {/* Map - Building only */}
          {isBuilding && (
            <Button variant="ghost" onClick={onOpenMap} className={btnClass}>
              <Globe size={iconSize} className="text-accent" />
              <span className={labelClass}>Map</span>
            </Button>
          )}


          {/* Add Asset */}
          {canAddAsset && onAddAsset && (
            <Button variant="ghost" onClick={() => onAddAsset(facility)} className={btnClass}>
              <Plus size={iconSize} className="text-accent" />
              <span className={labelClass}>Add Asset</span>
            </Button>
          )}

          {/* Inventory */}
          {onInventory && (
            <Button 
              variant="ghost" 
              onClick={() => onInventory({
                buildingFmGuid: isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid,
                levelFmGuid: isStorey ? facility.fmGuid : (facility as any).levelFmGuid,
                roomFmGuid: isSpace ? facility.fmGuid : undefined,
              })} 
              className={btnClass}
            >
              <ClipboardList size={iconSize} className="text-accent" />
              <span className={labelClass}>Inventering</span>
            </Button>
          )}

          {/* Felanmälan */}
          {onFaultReport && (
            <Button variant="ghost" onClick={() => onFaultReport(facility)} className={btnClass}>
              <AlertTriangle size={iconSize} className="text-destructive" />
              <span className={labelClass}>Felanmälan</span>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default QuickActions;
