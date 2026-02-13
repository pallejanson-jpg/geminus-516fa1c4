import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Globe, Network, Package, BarChart, Cuboid, 
  FileText, DoorOpen, Zap, View, Square, Plus, ClipboardList, SplitSquareHorizontal, AlertTriangle, Layers 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Facility } from '@/lib/types';

export interface InventoryPrefill {
  buildingFmGuid?: string;
  levelFmGuid?: string;
  roomFmGuid?: string;
}

interface QuickActionsProps {
  facility: Facility;
  ivionSiteId?: string | null;
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

  const ivionDisabledTooltip = "Konfigurera Ivion Site ID först";

  return (
    <TooltipProvider delayDuration={300}>
      <Card className="mt-4 sm:mt-6">
        <CardHeader className="pb-3 sm:pb-4">
          <CardTitle className="text-sm sm:text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 sm:gap-2 md:gap-4">
            {/* ===== ROW 1: VISUALIZATION TOOLS ===== */}
            
            {/* 2D - Only for Storey */}
            {isStorey && onToggle2D && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => onToggle2D(facility)} 
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <Square size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
                    <span className="text-[10px] sm:text-xs">2D</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Visa 2D-planritning</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* 2D FMA - Only for Storey */}
            {isStorey && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => {
                      const buildingGuid = (facility as any).buildingFmGuid || facility.fmGuid;
                      const floorName = facility.commonName || facility.name || '';
                      navigate(`/split-viewer?building=${buildingGuid}&mode=2d&floor=${facility.fmGuid}&floorName=${encodeURIComponent(floorName)}`);
                    }}
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <Square size={12} className="sm:w-3.5 sm:h-3.5 text-accent" />
                    <span className="text-[10px] sm:text-xs">2D FMA</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Visa FM Access 2D-ritning för våning</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* 3D - Building or Storey - navigates to UnifiedViewer with mode=3d */}
            {(isBuilding || isStorey || isSpace) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => {
                      const buildingGuid = isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid || facility.fmGuid;
                      const entityParam = !isBuilding ? `&entity=${facility.fmGuid}` : '';
                      navigate(`/split-viewer?building=${buildingGuid}&mode=3d${entityParam}`);
                    }} 
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <Cuboid size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
                    <span className="text-[10px] sm:text-xs">3D</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isSpace ? "Visa rum i 3D" : "Visa 3D-modell"}</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* 360° - Building or Storey - navigates to UnifiedViewer with mode=360 */}
            {(isBuilding || isStorey) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => {
                      const buildingGuid = isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid || facility.fmGuid;
                      navigate(`/split-viewer?building=${buildingGuid}&mode=360`);
                    }} 
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <View size={12} className="sm:w-3.5 sm:h-3.5 text-destructive" />
                    <span className="text-[10px] sm:text-xs">360°</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Öppna 360°-panorama</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Split View - Building only */}
            {isBuilding && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => navigate(`/split-viewer?building=${facility.fmGuid}&mode=split`)}
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <SplitSquareHorizontal size={12} className="sm:w-3.5 sm:h-3.5 text-accent" />
                    <span className="text-[10px] sm:text-xs">3D+360°</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Synkroniserad 3D och 360°-vy</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* 2D Ritning - Building only, navigates to UnifiedViewer with mode=2d */}
            {isBuilding && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => navigate(`/split-viewer?building=${facility.fmGuid}&mode=2d`)}
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <Square size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
                    <span className="text-[10px] sm:text-xs">2D Ritning</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Visa FM Access 2D-ritning</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Virtual Twin - Building only */}
            {isBuilding && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => navigate(`/split-viewer?building=${facility.fmGuid}&mode=vt`)}
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <Layers size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
                    <span className="text-[10px] sm:text-xs">Virtual Twin</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>3D-modell överlagrad på 360°-panorama</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* ===== ROW 2+: DATA & TOOLS ===== */}

            {/* Insights - available for all levels */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  onClick={() => onShowInsights(facility)} 
                  className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                >
                  <BarChart size={12} className="sm:w-3.5 sm:h-3.5 text-accent" />
                  <span className="text-[10px] sm:text-xs">Insights</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Visa nyckeltal och analyser</p>
              </TooltipContent>
            </Tooltip>

            {/* Assets */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  onClick={() => onShowAssets(facility)} 
                  className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                >
                  <Package size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
                  <span className="text-[10px] sm:text-xs">Assets</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Visa tillgångar</p>
              </TooltipContent>
            </Tooltip>

            {/* Rooms - Building or Storey */}
            {(isBuilding || isStorey) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => onShowRooms(facility)} 
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <DoorOpen size={12} className="sm:w-3.5 sm:h-3.5 text-accent" />
                    <span className="text-[10px] sm:text-xs">Rooms</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Visa rum och utrymmen</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Map - Building only */}
            {isBuilding && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={onOpenMap} 
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <Globe size={12} className="sm:w-3.5 sm:h-3.5 text-accent" />
                    <span className="text-[10px] sm:text-xs">Map</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Visa på karta</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Navigator */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  onClick={() => onOpenNavigator(facility)} 
                  className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                >
                  <Network size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
                  <span className="text-[10px] sm:text-xs">Navigator</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Öppna hierarkisk navigator</p>
              </TooltipContent>
            </Tooltip>

            {/* Docs+ */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  onClick={() => onShowDocs(facility)} 
                  className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                >
                  <FileText size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
                  <span className="text-[10px] sm:text-xs">Docs+</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Visa dokument</p>
              </TooltipContent>
            </Tooltip>

            {/* IOT+ */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  onClick={() => onOpenIoT(facility)} 
                  className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                >
                  <Zap size={12} className="sm:w-3.5 sm:h-3.5 text-primary" />
                  <span className="text-[10px] sm:text-xs">IOT+</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Visa IoT-sensorer</p>
              </TooltipContent>
            </Tooltip>

            {/* Add Asset - Storey or Space */}
            {canAddAsset && onAddAsset && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => onAddAsset(facility)} 
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <Plus size={12} className="sm:w-3.5 sm:h-3.5 text-accent" />
                    <span className="text-[10px] sm:text-xs">Add Asset</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Registrera ny tillgång</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Inventory */}
            {onInventory && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => onInventory({
                      buildingFmGuid: isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid,
                      levelFmGuid: isStorey ? facility.fmGuid : (facility as any).levelFmGuid,
                      roomFmGuid: isSpace ? facility.fmGuid : undefined,
                    })} 
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <ClipboardList size={12} className="sm:w-3.5 sm:h-3.5 text-orange-500" />
                    <span className="text-[10px] sm:text-xs">Inventering</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Inventera tillgångar här</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Felanmälan */}
            {onFaultReport && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    onClick={() => onFaultReport(facility)} 
                    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
                  >
                    <AlertTriangle size={12} className="sm:w-3.5 sm:h-3.5 text-destructive" />
                    <span className="text-[10px] sm:text-xs">Felanmälan</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Rapportera ett fel</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};

export default QuickActions;
