import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GripVertical, X, Loader2, Search, MapPin, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface UnplacedAsset {
  id: string;
  fm_guid: string;
  name: string;
  asset_type: string | null;
  category: string;
}

// Helper function to format IFC asset type to readable name
const formatAssetType = (type: string | null): string => {
  if (!type) return '';
  // "IfcBeam" → "Beam", "IfcWallStandardCase" → "Wall Standard Case"
  return type
    .replace(/^Ifc/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
};

// Get a display name for an asset with intelligent fallbacks
const getDisplayName = (asset: { name?: string | null; common_name?: string | null; asset_type?: string | null; fm_guid: string }): string => {
  if (asset.name) return asset.name;
  if (asset.common_name) return asset.common_name;
  const formattedType = formatAssetType(asset.asset_type || null);
  if (formattedType) return formattedType;
  return `Unknown (${asset.fm_guid.slice(0, 8)}...)`;
};

interface UnplacedAssetsPanelProps {
  buildingFmGuid: string;
  ivionSiteId: string | null;
  onClose: () => void;
  onAssetsCreated: () => void;
}

const UnplacedAssetsPanel: React.FC<UnplacedAssetsPanelProps> = ({
  buildingFmGuid,
  ivionSiteId,
  onClose,
  onAssetsCreated,
}) => {
  // Dragging state - position on the right side
  const [position, setPosition] = useState({ x: window.innerWidth - 420, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Data state
  const [assets, setAssets] = useState<UnplacedAsset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [creationMode, setCreationMode] = useState(false);

  // Load assets without Ivion position
  useEffect(() => {
    const loadAssets = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('assets')
          .select('id, fm_guid, name, common_name, asset_type, category')
          .eq('building_fm_guid', buildingFmGuid)
          .eq('category', 'Instance')
          .is('ivion_poi_id', null)
          .order('name');

        if (error) throw error;

        setAssets(
          (data || []).map((a) => ({
            id: a.id,
            fm_guid: a.fm_guid,
            name: getDisplayName(a),
            asset_type: a.asset_type,
            category: a.category,
          }))
        );
      } catch (err) {
        console.error('Failed to load unplaced assets:', err);
        toast.error('Could not load assets');
      } finally {
        setIsLoading(false);
      }
    };

    loadAssets();
  }, [buildingFmGuid]);

  // Filtered assets based on search
  const filteredAssets = assets.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (a.asset_type && a.asset_type.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Toggle asset selection
  const toggleAsset = (fmGuid: string) => {
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(fmGuid)) {
        next.delete(fmGuid);
      } else {
        next.add(fmGuid);
      }
      return next;
    });
  };

  // Select all filtered assets
  const selectAll = () => {
    setSelectedAssets(new Set(filteredAssets.map((a) => a.fm_guid)));
  };

  // Deselect all
  const deselectAll = () => {
    setSelectedAssets(new Set());
  };

  // Create POIs in Ivion for selected assets
  const handleCreatePois = async () => {
    if (!ivionSiteId) {
      toast.error('Ingen Ivion-site konfigurerad');
      return;
    }

    if (selectedAssets.size === 0) {
      toast.error('Välj minst en tillgång');
      return;
    }

    setIsCreating(true);
    let successCount = 0;
    let failCount = 0;

    const selectedAssetList = assets.filter((a) => selectedAssets.has(a.fm_guid));

    for (const asset of selectedAssetList) {
      try {
        const { data, error } = await supabase.functions.invoke('ivion-poi', {
          body: {
            action: 'sync-asset',
            assetFmGuid: asset.fm_guid,
          },
        });

        if (error || !data?.success) {
          console.error('Failed to sync asset:', asset.fm_guid, data?.message || error);
          failCount++;
        } else {
          successCount++;
        }
      } catch (err) {
        console.error('Error syncing asset:', asset.fm_guid, err);
        failCount++;
      }
    }

    setIsCreating(false);

    if (successCount > 0) {
      toast.success(`${successCount} POI(s) skapade i Ivion`);
      onAssetsCreated();
      
      // Reload assets list
      const { data } = await supabase
        .from('assets')
        .select('id, fm_guid, name, common_name, asset_type, category')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('category', 'Instance')
        .is('ivion_poi_id', null)
        .order('name');

      setAssets(
        (data || []).map((a) => ({
          id: a.id,
          fm_guid: a.fm_guid,
          name: getDisplayName(a),
          asset_type: a.asset_type,
          category: a.category,
        }))
      );
      setSelectedAssets(new Set());
    }

    if (failCount > 0) {
      toast.error(`${failCount} misslyckades`, {
        description: 'Kontrollera Ivion-anslutningen',
      });
    }
  };

  // Dragging handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    },
    [position]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(0, Math.min(window.innerWidth - 380, e.clientX - dragOffset.current.x));
      const newY = Math.max(60, Math.min(window.innerHeight - 200, e.clientY - dragOffset.current.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      className={cn(
        'fixed z-[60] w-[360px] max-h-[70vh]',
        'bg-card/90 backdrop-blur-md border rounded-xl shadow-2xl overflow-hidden',
        isDragging && 'cursor-grabbing'
      )}
      style={{ left: position.x, top: position.y }}
    >
      {/* Draggable header */}
      <div
        className="px-4 py-3 bg-muted/50 cursor-grab flex items-center justify-between border-b select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Skapa POI från Geminus</span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Assets list */}
      <ScrollArea className="h-[40vh]">
        <div className="p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <MapPin className="h-8 w-8 mb-2" />
              <p className="text-sm">Inga assets utan Ivion-position</p>
            </div>
          ) : (
            <>
              {/* Select all / deselect all */}
              <div className="flex justify-between items-center px-2 py-1 mb-2">
                <span className="text-xs text-muted-foreground">
                  {filteredAssets.length} tillgångar utan position
                </span>
                <div className="flex gap-2">
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={selectAll}>
                    Välj alla
                  </Button>
                  <span className="text-muted-foreground">|</span>
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={deselectAll}>
                    Avmarkera
                  </Button>
                </div>
              </div>

              {filteredAssets.map((asset) => (
                <div
                  key={asset.fm_guid}
                  className={cn(
                    'flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors',
                    selectedAssets.has(asset.fm_guid) && 'bg-primary/10'
                  )}
                  onClick={() => toggleAsset(asset.fm_guid)}
                >
                  <Checkbox
                    checked={selectedAssets.has(asset.fm_guid)}
                    onCheckedChange={() => toggleAsset(asset.fm_guid)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{asset.name}</div>
                    {asset.asset_type && (
                      <div className="text-xs text-muted-foreground truncate">{asset.asset_type}</div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Footer with action buttons */}
      <div className="p-4 border-t bg-card/50">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">{selectedAssets.size} valda</span>
        </div>

        {!ivionSiteId ? (
          <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-xs">Ivion API-autentisering krävs för att skapa POIs</span>
          </div>
        ) : (
          <Button
            onClick={handleCreatePois}
            disabled={isCreating || selectedAssets.size === 0}
            className="w-full h-11"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Skapar POIs...
              </>
            ) : (
              <>
                <MapPin className="h-4 w-4 mr-2" />
                Skapa {selectedAssets.size} POI(s) i Ivion
              </>
            )}
          </Button>
        )}

        <p className="text-xs text-muted-foreground mt-3 text-center">
          POIs skapas med FMGUID i "Custom attributes" för att koppla till Geminus
        </p>
      </div>
    </div>
  );
};

export default UnplacedAssetsPanel;
