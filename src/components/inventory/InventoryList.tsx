import React, { useContext } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { Package, Loader2, AlertCircle, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AppContext } from '@/context/AppContext';
import { cn } from '@/lib/utils';
import { INVENTORY_CATEGORIES, type InventoryCategory } from './InventoryForm';
import type { InventoryItem } from '@/pages/Inventory';

interface InventoryListProps {
  items: InventoryItem[];
  isLoading: boolean;
  onEdit?: (item: InventoryItem) => void;
  selectedFmGuid?: string | null;
  compact?: boolean;
}

const InventoryList: React.FC<InventoryListProps> = ({ items, isLoading, onEdit, selectedFmGuid, compact = false }) => {
  const { navigatorTreeData } = useContext(AppContext);

  // Helper to find names from tree data
  const findBuildingName = (fmGuid: string | null) => {
    if (!fmGuid) return null;
    const building = navigatorTreeData.find((b) => b.fmGuid === fmGuid);
    return building?.commonName || building?.name || null;
  };

  const findFloorName = (buildingFmGuid: string | null, levelFmGuid: string | null) => {
    if (!buildingFmGuid || !levelFmGuid) return null;
    const building = navigatorTreeData.find((b) => b.fmGuid === buildingFmGuid);
    const floor = building?.children?.find((f) => f.fmGuid === levelFmGuid);
    return floor?.commonName || floor?.name || null;
  };

  const findRoomName = (
    buildingFmGuid: string | null,
    levelFmGuid: string | null,
    roomFmGuid: string | null
  ) => {
    if (!buildingFmGuid || !levelFmGuid || !roomFmGuid) return null;
    const building = navigatorTreeData.find((b) => b.fmGuid === buildingFmGuid);
    const floor = building?.children?.find((f) => f.fmGuid === levelFmGuid);
    const room = floor?.children?.find((r) => r.fmGuid === roomFmGuid);
    return room?.commonName || room?.name || null;
  };

  const getCategoryInfo = (assetType: string): InventoryCategory | null => {
    return INVENTORY_CATEGORIES.find((c) => c.value === assetType) || null;
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground py-12">
        <Package className="h-12 w-12 mb-3 opacity-50" />
        <p className="text-sm">Inga registrerade tillgångar ännu</p>
        <p className="text-xs mt-1">Tryck "Ny tillgång" för att börja</p>
      </div>
    );
  }

  return (
    <div className={cn("flex-1 flex flex-col min-h-0", compact && "")}>
      {!compact && (
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Senast registrerade {onEdit && <span className="text-xs">(klicka för att redigera)</span>}
        </h2>
      )}
      <ScrollArea className="flex-1">
        <div className="space-y-2 pr-2">
          {items.map((item) => {
            const cat = getCategoryInfo(item.asset_type);
            const buildingName = findBuildingName(item.building_fm_guid);
            const floorName = findFloorName(item.building_fm_guid, item.level_fm_guid);
            const roomName = findRoomName(
              item.building_fm_guid,
              item.level_fm_guid,
              item.in_room_fm_guid
            );

            const locationParts = [floorName, roomName].filter(Boolean);
            const location = locationParts.length > 0 ? locationParts.join(', ') : buildingName;

            const timeAgo = item.created_at
              ? formatDistanceToNow(new Date(item.created_at), {
                  addSuffix: true,
                  locale: sv,
                })
              : item.attributes?.inventoryDate
              ? formatDistanceToNow(new Date(item.attributes.inventoryDate), {
                  addSuffix: true,
                  locale: sv,
                })
              : 'Just nu';

            const isSelected = selectedFmGuid === item.fm_guid;

            return (
              <Card
                key={item.fm_guid}
                className={cn(
                  "transition-colors cursor-pointer",
                  compact ? "p-2" : "p-3",
                  isSelected 
                    ? 'bg-primary/10 border-primary' 
                    : 'hover:bg-accent/50'
                )}
                onClick={() => onEdit?.(item)}
              >
                <div className={cn("flex items-start", compact ? "gap-2" : "gap-3")}>
                  {cat?.Icon ? (
                    <cat.Icon className={cn(cat.color, compact ? "h-4 w-4" : "h-5 w-5")} />
                  ) : (
                    <Package className={cn("text-muted-foreground", compact ? "h-4 w-4" : "h-5 w-5")} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={cn("font-medium text-foreground truncate", compact && "text-sm")}>{item.name}</p>
                      {/* "Not in model" badge - inventory items are never in model */}
                      {!compact && (
                        <Badge 
                          variant="outline" 
                          className="text-amber-500 border-amber-500 text-[10px] px-1.5 py-0 shrink-0"
                        >
                          <AlertCircle className="h-3 w-3 mr-0.5" />
                          Ej i modell
                        </Badge>
                      )}
                    </div>
                    {location && (
                      <p className={cn("text-muted-foreground truncate", compact ? "text-xs" : "text-sm")}>{location}</p>
                    )}
                    {!compact && <p className="text-xs text-muted-foreground mt-0.5">{timeAgo}</p>}
                  </div>
                  {onEdit && (
                    <Pencil className={cn("text-muted-foreground shrink-0", compact ? "h-3 w-3" : "h-4 w-4 mt-1")} />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};

export default InventoryList;
