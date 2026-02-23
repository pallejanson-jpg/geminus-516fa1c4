import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Globe, Network, Package, BarChart, Cuboid, 
  FileText, DoorOpen, Zap, View, Square, Plus, ClipboardList, SplitSquareHorizontal, AlertTriangle, Layers 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

  // Standardized button style with proper touch targets (min 44x44)
  const btnClass = "justify-start sm:justify-center gap-2 h-auto py-3 px-3 sm:py-3 sm:px-4";
  const iconSize = 16;
  const labelClass = "text-[11px] sm:text-xs";

  return (
    <Card className="mt-4 sm:mt-6">
      <CardHeader className="pb-3 sm:pb-4">
        <CardTitle className="text-sm sm:text-base">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2 md:gap-4">
          {/* ===== VISUALIZATION TOOLS ===== */}
          
          {/* 2D - Building, Storey, Space */}
          {(isBuilding || isStorey || isSpace) && (
            <Button 
              variant="ghost" 
              onClick={() => {
                const buildingGuid = isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid || facility.fmGuid;
                const floorParam = isStorey ? `&floor=${facility.fmGuid}&floorName=${encodeURIComponent(facility.commonName || facility.name || '')}` : '';
                const entityParam = isSpace ? `&entity=${facility.fmGuid}` : '';
                navigate(`/split-viewer?building=${buildingGuid}&mode=2d${floorParam}${entityParam}`);
              }}
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
              onClick={() => {
                if (!has3D) return;
                const buildingGuid = isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid || facility.fmGuid;
                const entityParam = !isBuilding ? `&entity=${facility.fmGuid}` : '';
                navigate(`/split-viewer?building=${buildingGuid}&mode=3d${entityParam}`);
              }} 
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
              onClick={() => {
                if (!has360) return;
                const buildingGuid = isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid || facility.fmGuid;
                navigate(`/split-viewer?building=${buildingGuid}&mode=360`);
              }} 
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
              onClick={() => { if (hasSplit) navigate(`/split-viewer?building=${facility.fmGuid}&mode=split`); }}
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
              onClick={() => { if (hasSplit) navigate(`/split-viewer?building=${facility.fmGuid}&mode=vt`); }}
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

          {/* Navigator */}
          <Button variant="ghost" onClick={() => onOpenNavigator(facility)} className={btnClass}>
            <Network size={iconSize} className="text-primary" />
            <span className={labelClass}>Navigator</span>
          </Button>

          {/* Docs+ */}
          <Button variant="ghost" onClick={() => onShowDocs(facility)} className={btnClass}>
            <FileText size={iconSize} className="text-muted-foreground" />
            <span className={labelClass}>Docs+</span>
          </Button>

          {/* IOT+ */}
          <Button variant="ghost" onClick={() => onOpenIoT(facility)} className={btnClass}>
            <Zap size={iconSize} className="text-accent" />
            <span className={labelClass}>IOT+</span>
          </Button>

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
