import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GripVertical, X, Loader2, Search, MapPin, Check, AlertCircle, Move3D } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { findRoomMetaObject, computeRoomCentroid, type Point3 } from '@/lib/room-centroid';
import { distributeAroundAnchor } from '@/lib/poi-cluster-layout';
import { bimToIvion, buildTransformFromSettings, IDENTITY_TRANSFORM, type IvionBimTransform } from '@/lib/ivion-bim-transform';
import IvionPoiRepositionDialog from '@/components/inventory/IvionPoiRepositionDialog';

interface UnplacedAsset {
  id: string;
  fm_guid: string;
  name: string;
  asset_type: string | null;
  category: string;
  in_room_fm_guid: string | null;
}

interface PendingReviewAsset {
  id: string;
  fm_guid: string;
  name: string;
  ivion_poi_id: number;
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

const UNPLACED_SELECT = 'id, fm_guid, name, common_name, asset_type, category, in_room_fm_guid';

async function fetchUnplacedAssets(buildingFmGuid: string): Promise<UnplacedAsset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select(UNPLACED_SELECT)
    .eq('building_fm_guid', buildingFmGuid)
    .eq('category', 'Instance')
    // Only assets that don't exist in the BIM model ("Exist in model = No") need a
    // manually/auto-derived position — assets that DO exist in the model already
    // get their position from the model's own geometry, not from this panel.
    .eq('created_in_model', false)
    .is('ivion_poi_id', null)
    .order('name');

  if (error) throw error;

  return (data || []).map((a) => ({
    id: a.id,
    fm_guid: a.fm_guid,
    name: getDisplayName(a),
    asset_type: a.asset_type,
    category: a.category,
    in_room_fm_guid: a.in_room_fm_guid,
  }));
}

async function fetchPendingReviewAssets(buildingFmGuid: string): Promise<PendingReviewAsset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('id, fm_guid, name, common_name, asset_type, ivion_poi_id')
    .eq('building_fm_guid', buildingFmGuid)
    .eq('category', 'Instance')
    .eq('created_in_model', false)
    .not('ivion_poi_id', 'is', null)
    .is('ivion_poi_confirmed_at', null)
    .order('name');

  if (error) throw error;

  return (data || []).map((a) => ({
    id: a.id,
    fm_guid: a.fm_guid,
    name: getDisplayName(a),
    ivion_poi_id: a.ivion_poi_id as number,
  }));
}

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

  // Assets that already have a POI but were placed near a cluster anchor and
  // still need a human to drag them to their real spot in the 360° view.
  const [pendingReview, setPendingReview] = useState<PendingReviewAsset[]>([]);
  const [repositionTarget, setRepositionTarget] = useState<PendingReviewAsset | null>(null);

  // BIM <-> Ivion coordinate transform for this building (falls back to
  // identity when the building has no alignment calibration set up yet).
  const [transform, setTransform] = useState<IvionBimTransform>(IDENTITY_TRANSFORM);

  useEffect(() => {
    supabase
      .from('building_settings')
      .select('ivion_bim_offset_x, ivion_bim_offset_y, ivion_bim_offset_z, ivion_bim_rotation')
      .eq('fm_guid', buildingFmGuid)
      .maybeSingle()
      .then(({ data }) => {
        setTransform(data ? buildTransformFromSettings(data) : IDENTITY_TRANSFORM);
      });
  }, [buildingFmGuid]);

  const reloadLists = useCallback(async () => {
    try {
      const [unplaced, pending] = await Promise.all([
        fetchUnplacedAssets(buildingFmGuid),
        fetchPendingReviewAssets(buildingFmGuid),
      ]);
      setAssets(unplaced);
      setPendingReview(pending);
    } catch (err) {
      console.error('Failed to load unplaced assets:', err);
      toast.error('Could not load assets');
    }
  }, [buildingFmGuid]);

  // Load assets without Ivion position (+ assets pending position review)
  useEffect(() => {
    setIsLoading(true);
    reloadLists().finally(() => setIsLoading(false));
  }, [reloadLists]);

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

  // Find a shared anchor point (in Ivion-local coordinates) for assets that
  // have no room geometry to derive a position from: prefer the nearest
  // available 360° image, otherwise fall back to the building's BIM origin.
  const resolveClusterAnchor = useCallback(async (): Promise<Point3> => {
    if (ivionSiteId) {
      try {
        const { data } = await supabase.functions.invoke('ivion-poi', {
          body: { action: 'get-images-for-site', siteId: ivionSiteId, buildingFmGuid },
        });
        const firstImage = data?.images?.[0];
        if (firstImage?.location) {
          return { x: firstImage.location.x, y: firstImage.location.y, z: firstImage.location.z };
        }
      } catch (err) {
        console.warn('Could not resolve nearest 360° image for cluster anchor:', err);
      }
    }
    return bimToIvion({ x: 0, y: 0, z: 0 }, transform);
  }, [ivionSiteId, buildingFmGuid, transform]);

  // Create POIs in Ivion for selected assets
  const handleCreatePois = async () => {
    if (!ivionSiteId) {
      toast.error('No Ivion site configured');
      return;
    }

    if (selectedAssets.size === 0) {
      toast.error('Select at least one asset');
      return;
    }

    setIsCreating(true);
    let successCount = 0;
    let failCount = 0;

    const selectedAssetList = assets.filter((a) => selectedAssets.has(a.fm_guid));

    // Pass 1: assets whose in_room_fm_guid resolves to a room with real
    // geometry in the currently loaded 3D scene get placed at the room's
    // centroid — this position is derived from the model, so it's marked
    // confirmed right away (matches the "place at room center" pattern
    // already used for rooms that DO have model geometry).
    const viewer = (window as any).__nativeXeokitViewer ?? null;
    const roomPlaced: UnplacedAsset[] = [];
    const needsCluster: UnplacedAsset[] = [];

    for (const asset of selectedAssetList) {
      const roomMeta = viewer && asset.in_room_fm_guid ? findRoomMetaObject(viewer, asset.in_room_fm_guid) : null;
      const centroidBim = roomMeta ? computeRoomCentroid(viewer, roomMeta) : null;

      if (centroidBim) {
        const ivionPos = bimToIvion(centroidBim, transform);
        const { error: updateError } = await supabase
          .from('assets')
          .update({
            coordinate_x: ivionPos.x,
            coordinate_y: ivionPos.y,
            coordinate_z: ivionPos.z,
            ivion_poi_confirmed_at: new Date().toISOString(),
          })
          .eq('id', asset.id);

        if (updateError) {
          console.error('Failed to save room-centroid position:', asset.fm_guid, updateError);
          failCount++;
          continue;
        }
        roomPlaced.push(asset);
      } else {
        needsCluster.push(asset);
      }
    }

    // Pass 2: everything left has no room to derive a position from — cluster
    // them a short distance apart around one shared anchor so they're all
    // reachable, then leave them unconfirmed for manual review/drag-in.
    if (needsCluster.length > 0) {
      const anchor = await resolveClusterAnchor();
      const positions = distributeAroundAnchor(anchor, needsCluster.length);

      for (let i = 0; i < needsCluster.length; i++) {
        const asset = needsCluster[i];
        const pos = positions[i];
        const { error: updateError } = await supabase
          .from('assets')
          .update({
            coordinate_x: pos.x,
            coordinate_y: pos.y,
            coordinate_z: pos.z,
          })
          .eq('id', asset.id);

        if (updateError) {
          console.error('Failed to save cluster position:', asset.fm_guid, updateError);
          failCount++;
          // Remove from the list so we don't try to sync it below
          needsCluster.splice(i, 1);
          i--;
        }
      }
    }

    // Now that every asset has coordinates saved, create the actual POIs.
    for (const asset of [...roomPlaced, ...needsCluster]) {
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
      const clusteredCount = needsCluster.length;
      toast.success(
        clusteredCount > 0
          ? `${successCount} POI(s) created (${clusteredCount} need position review)`
          : `${successCount} POI(s) created in Ivion`
      );
      onAssetsCreated();
      await reloadLists();
      setSelectedAssets(new Set());
    }

    if (failCount > 0) {
      toast.error(`${failCount} failed`, {
        description: 'Check Ivion connection',
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
        'fixed z-[60] w-[360px] max-h-[80vh]',
        'bg-card/90 backdrop-blur-md border rounded-xl shadow-2xl overflow-hidden flex flex-col',
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
          <span className="font-medium">Create POI from Geminus</span>
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
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Assets list */}
      <ScrollArea className="h-[35vh]">
        <div className="p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <MapPin className="h-8 w-8 mb-2" />
              <p className="text-sm">No assets without Ivion position</p>
            </div>
          ) : (
            <>
              {/* Select all / deselect all */}
              <div className="flex justify-between items-center px-2 py-1 mb-2">
                <span className="text-xs text-muted-foreground">
                  {filteredAssets.length} assets without position
                </span>
                <div className="flex gap-2">
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={selectAll}>
                    Select all
                  </Button>
                  <span className="text-muted-foreground">|</span>
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={deselectAll}>
                    Deselect
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

      {/* Pending position review section */}
      {pendingReview.length > 0 && (
        <div className="border-t bg-amber-50/60 dark:bg-amber-950/20">
          <div className="px-4 py-2 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            <Move3D className="h-3.5 w-3.5" />
            {pendingReview.length} POI(s) waiting for confirmed position
          </div>
          <ScrollArea className="max-h-[18vh]">
            <div className="px-2 pb-2 space-y-1">
              {pendingReview.map((asset) => (
                <div key={asset.fm_guid} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50">
                  <span className="text-sm truncate">{asset.name}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    onClick={() => setRepositionTarget(asset)}
                  >
                    Move into place
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Footer with action buttons */}
      <div className="p-4 border-t bg-card/50">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">{selectedAssets.size} selected</span>
        </div>

        {!ivionSiteId ? (
          <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-xs">Ivion API authentication required to create POIs</span>
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
                 Creating POIs...
              </>
            ) : (
              <>
                <MapPin className="h-4 w-4 mr-2" />
                Create {selectedAssets.size} POI(s) in Ivion
              </>
            )}
          </Button>
        )}

         <p className="text-xs text-muted-foreground mt-3 text-center">
           POIs are created with FMGUID in "Custom attributes" to link to Geminus
        </p>
      </div>

      {ivionSiteId && repositionTarget && (
        <IvionPoiRepositionDialog
          open={!!repositionTarget}
          onOpenChange={(open) => { if (!open) setRepositionTarget(null); }}
          ivionSiteId={ivionSiteId}
          buildingFmGuid={buildingFmGuid}
          assetId={repositionTarget.id}
          ivionPoiId={repositionTarget.ivion_poi_id}
          displayName={repositionTarget.name}
          onConfirmed={() => {
            setRepositionTarget(null);
            reloadLists();
          }}
        />
      )}
    </div>
  );
};

export default UnplacedAssetsPanel;
