import React, { useContext } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';
import { Package, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AppContext } from '@/context/AppContext';
import { INVENTORY_CATEGORIES } from './InventoryForm';
import type { InventoryItem } from '@/pages/Inventory';

interface InventoryListProps {
  items: InventoryItem[];
  isLoading: boolean;
}

const InventoryList: React.FC<InventoryListProps> = ({ items, isLoading }) => {
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

  const getCategoryInfo = (assetType: string) => {
    return INVENTORY_CATEGORIES.find((c) => c.value === assetType) || {
      icon: '📦',
      label: assetType,
    };
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
    <div className="flex-1 flex flex-col min-h-0">
      <h2 className="text-sm font-medium text-muted-foreground mb-2">
        Senast registrerade
      </h2>
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

            return (
              <Card
                key={item.fm_guid}
                className="p-3 hover:bg-accent/50 transition-colors cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">{cat.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{item.name}</p>
                    {location && (
                      <p className="text-sm text-muted-foreground truncate">{location}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">{timeAgo}</p>
                  </div>
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
