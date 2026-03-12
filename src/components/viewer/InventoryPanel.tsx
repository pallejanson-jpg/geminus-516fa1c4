/**
 * InventoryPanel — Tandem-style bottom drawer showing all assets for the current building.
 * Syncs with viewer filters (floor selection, categories).
 */

import React, { useContext, useMemo, useState, useEffect } from 'react';
import { cn, normalizeGuid } from '@/lib/utils';
import { Package, X, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { supabase } from '@/integrations/supabase/client';

interface InventoryPanelProps {
  buildingFmGuid: string;
  buildingName?: string;
  open: boolean;
  onClose: () => void;
}

interface AssetRow {
  fmGuid: string;
  name: string;
  category: string;
  assetType: string;
  levelFmGuid: string;
  levelName: string;
  roomFmGuid: string;
  roomName: string;
  systemNames: string[];
}

export default function InventoryPanel({
  buildingFmGuid,
  buildingName,
  open,
  onClose,
}: InventoryPanelProps) {
  const { allData } = useContext(AppContext);
  const [search, setSearch] = useState('');
  const [followSelection, setFollowSelection] = useState(false);
  const [visibleFloorGuids, setVisibleFloorGuids] = useState<string[]>([]);
  const [isAllFloors, setIsAllFloors] = useState(true);
  const [systemMap, setSystemMap] = useState<Map<string, string[]>>(new Map());

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // Listen for floor selection events
  useEffect(() => {
    const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
      if (e.detail.isAllFloorsVisible) {
        setIsAllFloors(true);
        setVisibleFloorGuids([]);
      } else if (e.detail.visibleFloorFmGuids?.length > 0) {
        setIsAllFloors(false);
        setVisibleFloorGuids(e.detail.visibleFloorFmGuids);
      }
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, []);

  // Fetch system memberships
  useEffect(() => {
    if (!open || !buildingFmGuid) return;
    const fetchSystems = async () => {
      const { data: systems } = await supabase
        .from('systems')
        .select('id, name')
        .eq('building_fm_guid', buildingFmGuid);
      const { data: assetSystems } = await supabase
        .from('asset_system')
        .select('asset_fm_guid, system_id');

      if (systems && assetSystems) {
        const sysNameMap = new Map(systems.map(s => [s.id, s.name]));
        const map = new Map<string, string[]>();
        assetSystems.forEach(as => {
          const name = sysNameMap.get(as.system_id);
          if (name) {
            const existing = map.get(as.asset_fm_guid) || [];
            existing.push(name);
            map.set(as.asset_fm_guid, existing);
          }
        });
        setSystemMap(map);
      }
    };
    fetchSystems();
  }, [open, buildingFmGuid]);

  // Build asset rows from allData
  const allAssets: AssetRow[] = useMemo(() => {
    if (!allData || !buildingFmGuid) return [];

    const buildingAssets = allData.filter((a: any) =>
      (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid &&
      a.category !== 'Building' && a.category !== 'Building Storey'
    );

    // Build lookup maps for levels and rooms
    const levelNameMap = new Map<string, string>();
    const roomNameMap = new Map<string, string>();
    allData.forEach((a: any) => {
      const fmGuid = a.fmGuid || a.fm_guid;
      if (a.category === 'Building Storey' && (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid) {
        levelNameMap.set(normalizeGuid(fmGuid), a.commonName || a.common_name || a.name || '');
      }
      if ((a.category === 'Space' || a.category === 'IfcSpace') && (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid) {
        roomNameMap.set(normalizeGuid(fmGuid), a.commonName || a.common_name || a.name || '');
      }
    });

    return buildingAssets.map((a: any) => {
      const fmGuid = a.fmGuid || a.fm_guid;
      const levelGuid = a.levelFmGuid || a.level_fm_guid || '';
      const roomGuid = a.inRoomFmGuid || a.in_room_fm_guid || '';
      return {
        fmGuid,
        name: a.commonName || a.common_name || a.name || 'Unnamed',
        category: a.category || '',
        assetType: a.assetType || a.asset_type || '',
        levelFmGuid: levelGuid,
        levelName: levelNameMap.get(normalizeGuid(levelGuid)) || '',
        roomFmGuid: roomGuid,
        roomName: roomNameMap.get(normalizeGuid(roomGuid)) || '',
        systemNames: systemMap.get(fmGuid) || [],
      };
    });
  }, [allData, buildingFmGuid, systemMap]);

  // Filter by floor selection and search
  const filteredAssets = useMemo(() => {
    let result = allAssets;

    // Filter by floor
    if (!isAllFloors && visibleFloorGuids.length > 0) {
      const normGuids = new Set(visibleFloorGuids.map(g => normalizeGuid(g)));
      result = result.filter(a => normGuids.has(normalizeGuid(a.levelFmGuid)));
    }

    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.assetType.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.levelName.toLowerCase().includes(q) ||
        a.roomName.toLowerCase().includes(q) ||
        a.systemNames.some(s => s.toLowerCase().includes(q))
      );
    }

    return result;
  }, [allAssets, isAllFloors, visibleFloorGuids, search]);

  // Handle row click — fly to object in viewer
  const handleRowClick = (asset: AssetRow) => {
    if (!followSelection) return;
    window.dispatchEvent(new CustomEvent('VIEWER_FLY_TO', {
      detail: { fmGuid: asset.fmGuid },
    }));
  };

  if (!open) return null;

  return (
    <div
      className={cn(
        "border-t border-border bg-background/95 backdrop-blur-md overflow-hidden flex flex-col",
        isMobile ? "fixed inset-0 z-50" : "shrink-0"
      )}
      style={isMobile ? undefined : { height: '400px' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            ASSET PANEL
            <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 h-5 font-normal">
              {filteredAssets.length}
              {filteredAssets.length !== allAssets.length && ` / ${allAssets.length}`}
            </Badge>
          </span>
          {buildingName && (
            <span className="text-muted-foreground font-normal text-sm ml-1.5">– {buildingName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="follow-sel"
              checked={followSelection}
              onCheckedChange={(v) => setFollowSelection(!!v)}
              className="h-3.5 w-3.5"
            />
            <label htmlFor="follow-sel" className="text-[11px] text-muted-foreground cursor-pointer">
              Follow selection
            </label>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets…"
              className="h-7 pl-7 w-48 text-sm"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1 min-h-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-8">Name</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-8">Type</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-8">Category</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-8">Level</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-8">Room</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-8">Systems</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAssets.slice(0, 500).map((asset) => (
              <TableRow
                key={asset.fmGuid}
                className={cn(
                  "cursor-pointer text-xs",
                  followSelection && "hover:bg-primary/10"
                )}
                onClick={() => handleRowClick(asset)}
              >
                <TableCell className="py-1.5 font-medium truncate max-w-[200px]">{asset.name}</TableCell>
                <TableCell className="py-1.5 text-muted-foreground truncate max-w-[150px]">{asset.assetType}</TableCell>
                <TableCell className="py-1.5">
                  <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal">{asset.category}</Badge>
                </TableCell>
                <TableCell className="py-1.5 text-muted-foreground truncate max-w-[120px]">{asset.levelName}</TableCell>
                <TableCell className="py-1.5 text-muted-foreground truncate max-w-[120px]">{asset.roomName}</TableCell>
                <TableCell className="py-1.5 text-muted-foreground truncate max-w-[150px]">
                  {asset.systemNames.length > 0 ? asset.systemNames.join(', ') : '–'}
                </TableCell>
              </TableRow>
            ))}
            {filteredAssets.length > 500 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-2">
                  Showing 500 of {filteredAssets.length} assets. Use search to narrow results.
                </TableCell>
              </TableRow>
            )}
            {filteredAssets.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                  {search ? 'No matching assets found.' : 'No assets in this building.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
