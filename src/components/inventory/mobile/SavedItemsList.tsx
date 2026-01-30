import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';
import { MapPin, ChevronRight, Package } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

interface SavedItem {
  id: string;
  fm_guid: string;
  name: string | null;
  common_name: string | null;
  asset_type: string | null;
  building_fm_guid: string | null;
  level_fm_guid: string | null;
  in_room_fm_guid: string | null;
  symbol_id: string | null;
  created_at: string;
  annotation_placed: boolean | null;
  coordinate_x: number | null;
  coordinate_y: number | null;
  coordinate_z: number | null;
  symbol?: {
    name: string;
    icon_url: string | null;
    color: string;
  } | null;
}

interface SavedItemsListProps {
  items: SavedItem[];
  isLoading: boolean;
  onEdit: (item: SavedItem) => void;
}

const SavedItemsList: React.FC<SavedItemsListProps> = ({
  items,
  isLoading,
  onEdit,
}) => {
  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-lg font-medium text-muted-foreground">Inga sparade objekt</p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Registrera din första tillgång för att se den här
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onEdit(item)}
            className="w-full text-left p-4 bg-card hover:bg-muted/50 border rounded-lg transition-colors flex items-center gap-3"
          >
            {/* Symbol/Icon */}
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              {item.symbol?.icon_url ? (
                <img src={item.symbol.icon_url} alt="" className="w-6 h-6" />
              ) : item.symbol?.color ? (
                <div 
                  className="w-6 h-6 rounded-full"
                  style={{ backgroundColor: item.symbol.color }}
                />
              ) : (
                <Package className="w-5 h-5 text-muted-foreground" />
              )}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">
                {item.name || item.common_name || 'Namnlös tillgång'}
              </div>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                {item.asset_type && (
                  <span className="truncate">{item.asset_type}</span>
                )}
                {item.annotation_placed && (
                  <span className="flex items-center gap-1 text-primary">
                    <MapPin className="h-3 w-3" />
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground/70 mt-0.5">
                {formatDistanceToNow(new Date(item.created_at), { 
                  addSuffix: true, 
                  locale: sv 
                })}
              </div>
            </div>

            {/* Arrow */}
            <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          </button>
        ))}
      </div>
    </ScrollArea>
  );
};

export default SavedItemsList;
