import React, { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useContext } from 'react';
import { ChevronRight, ChevronDown, X, Search, TreeDeciduous, Layers, DoorOpen, Package, GripVertical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { AppContext } from '@/context/AppContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssetNode {
  fmGuid: string;
  name: string | null;
  commonName: string | null;
  category: string;
  levelFmGuid?: string | null;
  inRoomFmGuid?: string | null;
  buildingFmGuid?: string | null;
}

interface StoreyTreeNode {
  fmGuid: string;
  name: string;
  spaces: SpaceTreeNode[];
}

interface SpaceTreeNode {
  fmGuid: string;
  name: string;
  assets: AssetTreeNode[];
}

interface AssetTreeNode {
  fmGuid: string;
  name: string;
  category: string;
}

interface ViewerTreePanelProps {
  viewerRef: React.RefObject<any>;
  isVisible: boolean;
  onClose: () => void;
  onNodeSelect?: (nodeId: string, fmGuid?: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  embedded?: boolean;
  showVisibilityCheckboxes?: boolean;
  startFromStoreys?: boolean;
  // Asset+ data props
  buildingFmGuid?: string;
  buildingData?: any[];
  // Controlled state for persistence
  selectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  expandedIds?: Set<string>;
  onExpandedIdsChange?: (ids: Set<string>) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isGuid = (str: string): boolean => {
  if (!str || str.length < 20) return false;
  return /^[0-9a-f]{8}[-]?[0-9a-f]{4}[-]?[0-9a-f]{4}[-]?[0-9a-f]{4}[-]?[0-9a-f]{12}$/i.test(str) ||
    /^[0-9a-zA-Z$_]{22,}$/.test(str);
};

const getNodeDisplayName = (asset: AssetNode, index?: number): string => {
  const n = asset.commonName || asset.name;
  if (n && !isGuid(n)) return n;
  const cat = asset.category.replace(/^Ifc/, '');
  return index !== undefined ? `${cat} ${index + 1}` : cat;
};

const isStoreyCategory = (cat: string) =>
  cat === 'Building Storey' || cat === 'IfcBuildingStorey' || cat === 'BuildingStorey';

const isSpaceCategory = (cat: string) =>
  cat === 'Space' || cat === 'IfcSpace' || cat === 'Room';

// Sort storeys by floor number extracted from name
const sortStoreys = (a: StoreyTreeNode, b: StoreyTreeNode): number => {
  const extract = (name: string): number => {
    const m = name.match(/(-?\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  return extract(a.name) - extract(b.name);
};

// Get all xeokit entity IDs for a given fmGuid (via originalSystemId matching)
const getXeokitIdsForFmGuid = (xeokitViewer: any, fmGuid: string): string[] => {
  if (!xeokitViewer?.metaScene?.metaObjects) return [];
  const fmLower = fmGuid.toLowerCase();
  const ids: string[] = [];
  Object.values(xeokitViewer.metaScene.metaObjects).forEach((obj: any) => {
    const sysId = (obj.originalSystemId || '').toLowerCase();
    if (sysId === fmLower) {
      ids.push(obj.id);
    }
  });
  return ids;
};

// Get all descendant entity IDs for a meta object
const getDescendantIds = (xeokitViewer: any, rootId: string): string[] => {
  const metaObj = xeokitViewer?.metaScene?.metaObjects?.[rootId];
  if (!metaObj) return [rootId];
  const ids: string[] = [rootId];
  const collect = (obj: any) => {
    obj.children?.forEach((child: any) => {
      ids.push(child.id);
      collect(child);
    });
  };
  collect(metaObj);
  return ids;
};

// Get all xeokit IDs for a storey (storey + all its children)
const getAllXeokitIdsForStorey = (xeokitViewer: any, storeyFmGuid: string): string[] => {
  const rootIds = getXeokitIdsForFmGuid(xeokitViewer, storeyFmGuid);
  const all = new Set<string>();
  rootIds.forEach(id => {
    getDescendantIds(xeokitViewer, id).forEach(descId => all.add(descId));
  });
  return [...all];
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const SpaceRow = React.memo<{
  space: SpaceTreeNode;
  level: number;
  selectedFmGuid: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (fmGuid: string, name: string) => void;
  searchQuery: string;
}>(({ space, level, selectedFmGuid, expandedIds, onToggle, onSelect, searchQuery }) => {
  const isExpanded = expandedIds.has(space.fmGuid);
  const isSelected = selectedFmGuid === space.fmGuid;
  const hasAssets = space.assets.length > 0;

  const matchesSearch = useMemo(() => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return space.name.toLowerCase().includes(q) ||
      space.assets.some(a => a.name.toLowerCase().includes(q));
  }, [space, searchQuery]);

  if (searchQuery && !matchesSearch) return null;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-1 rounded cursor-pointer text-sm transition-colors",
          "hover:bg-accent/50",
          isSelected && "bg-accent text-accent-foreground",
          searchQuery && matchesSearch && !isSelected && "bg-primary/5"
        )}
        style={{ paddingLeft: `${level * 14 + 4}px` }}
        onClick={() => onSelect(space.fmGuid, space.name)}
      >
        {hasAssets ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(space.fmGuid); }}
            className="p-0.5 hover:bg-muted rounded shrink-0"
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <DoorOpen className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="truncate flex-1 text-xs">{space.name}</span>
        {hasAssets && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">{space.assets.length}</Badge>
        )}
      </div>

      {isExpanded && hasAssets && (
        <div>
          {space.assets.map((asset, idx) => (
            <div
              key={asset.fmGuid}
              className={cn(
                "flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer text-xs transition-colors",
                "hover:bg-accent/40",
                selectedFmGuid === asset.fmGuid && "bg-accent text-accent-foreground"
              )}
              style={{ paddingLeft: `${(level + 1) * 14 + 4}px` }}
              onClick={() => onSelect(asset.fmGuid, asset.name)}
            >
              <span className="w-4" />
              <Package className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{asset.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
SpaceRow.displayName = 'SpaceRow';

const StoreyRow = React.memo<{
  storey: StoreyTreeNode;
  isChecked: boolean;
  isExpanded: boolean;
  selectedFmGuid: string | null;
  expandedSpaceIds: Set<string>;
  onCheck: (fmGuid: string, checked: boolean) => void;
  onToggle: (fmGuid: string) => void;
  onToggleSpace: (fmGuid: string) => void;
  onSelect: (fmGuid: string, name: string) => void;
  searchQuery: string;
}>(({ storey, isChecked, isExpanded, selectedFmGuid, expandedSpaceIds, onCheck, onToggle, onToggleSpace, onSelect, searchQuery }) => {
  const matchesSearch = useMemo(() => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return storey.name.toLowerCase().includes(q) ||
      storey.spaces.some(s => s.name.toLowerCase().includes(q) || s.assets.some(a => a.name.toLowerCase().includes(q)));
  }, [storey, searchQuery]);

  if (searchQuery && !matchesSearch) return null;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1.5 px-1 rounded cursor-pointer text-sm transition-colors",
          "hover:bg-accent/50",
          selectedFmGuid === storey.fmGuid && "bg-accent text-accent-foreground"
        )}
        onClick={() => onSelect(storey.fmGuid, storey.name)}
      >
        {/* Checkbox for solo visibility */}
        <Checkbox
          checked={isChecked}
          className="h-4 w-4 shrink-0"
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(checked) => onCheck(storey.fmGuid, !!checked)}
        />

        {/* Expand/collapse */}
        {storey.spaces.length > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(storey.fmGuid); }}
            className="p-0.5 hover:bg-muted rounded shrink-0"
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-5" />
        )}

        <Layers className="h-4 w-4 text-primary/70 shrink-0" />
        <span className="truncate flex-1 font-medium text-sm">{storey.name}</span>
        {storey.spaces.length > 0 && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">{storey.spaces.length} rooms</Badge>
        )}
      </div>

      {isExpanded && (
        <div>
          {storey.spaces.map(space => (
            <SpaceRow
              key={space.fmGuid}
              space={space}
              level={1}
              selectedFmGuid={selectedFmGuid}
              expandedIds={expandedSpaceIds}
              onToggle={onToggleSpace}
              onSelect={onSelect}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
});
StoreyRow.displayName = 'StoreyRow';

// ─── Main Component ────────────────────────────────────────────────────────────

const ViewerTreePanel = forwardRef<HTMLDivElement, ViewerTreePanelProps>(({
  viewerRef,
  isVisible,
  onClose,
  onNodeSelect,
  onNodeHover,
  embedded = false,
  showVisibilityCheckboxes = true,
  startFromStoreys = true,
  buildingFmGuid: buildingFmGuidProp,
  buildingData: buildingDataProp,
  selectedId: externalSelectedId,
  onSelectedIdChange,
  expandedIds: externalExpandedIds,
  onExpandedIdsChange,
}, ref) => {
  const { allData } = useContext(AppContext);

  // Use prop data if provided, otherwise use AppContext allData
  const dataSource = buildingDataProp || allData;
  const buildingFmGuid = buildingFmGuidProp;

  // ── State ────────────────────────────────────────────────────────────────

  const [storeys, setStoreys] = useState<StoreyTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Checked storeys for solo visibility (checkbox state)
  const [checkedStoreyFmGuids, setCheckedStoreyFmGuids] = useState<Set<string>>(new Set());

  // Expanded storeys
  const [expandedStoreyIds, setExpandedStoreyIds] = useState<Set<string>>(new Set());

  // Expanded spaces
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<Set<string>>(new Set());

  // Selected node (for fly-to)
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = externalSelectedId !== undefined ? externalSelectedId : internalSelectedId;
  const setSelectedId = useCallback((id: string | null) => {
    if (onSelectedIdChange) onSelectedIdChange(id);
    else setInternalSelectedId(id);
  }, [onSelectedIdChange]);

  // Desktop floating panel state
  const [position, setPosition] = useState({ x: 12, y: 56 });
  const [size, setSize] = useState({ width: 320, height: 550 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // ── Xeokit accessor ────────────────────────────────────────────────────────

  const getXeokitViewer = useCallback(() => {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }, [viewerRef]);

  // ── Debounced search ───────────────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Build tree from Asset+ data ────────────────────────────────────────────

  useEffect(() => {
    if (!isVisible) return;
    setIsLoading(true);

    // Use setTimeout to not block render
    const timer = setTimeout(() => {
      if (!dataSource || dataSource.length === 0) {
        setStoreys([]);
        setIsLoading(false);
        return;
      }

      // Filter storeys for this building
      const rawStoreys = dataSource.filter((a: any) =>
        (!buildingFmGuid || a.buildingFmGuid === buildingFmGuid || a.building_fm_guid === buildingFmGuid) &&
        isStoreyCategory(a.category)
      );

      // If no storeys found with buildingFmGuid filter, try without (all storeys)
      const storeysData = rawStoreys.length > 0 ? rawStoreys :
        dataSource.filter((a: any) => isStoreyCategory(a.category));

      // Build storey → space → asset hierarchy
      const builtStoreys: StoreyTreeNode[] = storeysData.map((storey: any) => {
        const storeyFmGuid = storey.fmGuid || storey.fm_guid;
        const storeyName = storey.commonName || storey.common_name || storey.name || `Level ${storeyFmGuid?.slice(0, 8)}`;

        // Find spaces for this storey
        const spacesRaw = dataSource.filter((a: any) =>
          isSpaceCategory(a.category) &&
          ((a.levelFmGuid || a.level_fm_guid) === storeyFmGuid)
        );

        const spaces: SpaceTreeNode[] = spacesRaw.map((space: any, idx: number) => {
          const spaceFmGuid = space.fmGuid || space.fm_guid;
          const spaceName = space.commonName || space.common_name || space.name;
          const displayName = (spaceName && !isGuid(spaceName)) ? spaceName : `Room ${idx + 1}`;

          // Find assets in this space
          const assetsRaw = dataSource.filter((a: any) =>
            !isStoreyCategory(a.category) &&
            !isSpaceCategory(a.category) &&
            ((a.inRoomFmGuid || a.in_room_fm_guid) === spaceFmGuid)
          );

          const assets: AssetTreeNode[] = assetsRaw.map((asset: any, aIdx: number) => ({
            fmGuid: asset.fmGuid || asset.fm_guid,
            name: getNodeDisplayName({
              fmGuid: asset.fmGuid || asset.fm_guid,
              name: asset.name,
              commonName: asset.commonName || asset.common_name,
              category: asset.category,
            }, aIdx),
            category: asset.category,
          }));

          return {
            fmGuid: spaceFmGuid,
            name: displayName,
            assets,
          };
        }).sort((a: SpaceTreeNode, b: SpaceTreeNode) =>
          a.name.localeCompare(b.name, 'sv', { numeric: true })
        );

        return {
          fmGuid: storeyFmGuid,
          name: (storeyName && !isGuid(storeyName)) ? storeyName : `Level ${storeyFmGuid?.slice(0, 8)}`,
          spaces,
        };
      }).sort(sortStoreys);

      setStoreys(builtStoreys);
      setIsLoading(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [isVisible, dataSource, buildingFmGuid]);

  // ── Solo visibility logic ──────────────────────────────────────────────────

  const applyStoreyVisibility = useCallback((checkedGuids: Set<string>) => {
    const xeokitViewer = getXeokitViewer();
    const scene = xeokitViewer?.scene;
    if (!scene) return;

    try {
      if (checkedGuids.size === 0) {
        // No selection → show all
        scene.setObjectsVisible(scene.objectIds, true);

        // Dispatch "all floors visible" event
        const eventDetail: FloorSelectionEventDetail = {
          floorId: null,
          floorName: null,
          bounds: null,
          visibleMetaFloorIds: [],
          visibleFloorFmGuids: [],
          isAllFloorsVisible: true,
        };
        window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: eventDetail }));
        return;
      }

      // Solo mode: hide all, then show only checked storeys
      scene.setObjectsVisible(scene.objectIds, false);

      const visibleFmGuids: string[] = [];
      const visibleMetaIds: string[] = [];

      checkedGuids.forEach(storeyFmGuid => {
        const ids = getAllXeokitIdsForStorey(xeokitViewer, storeyFmGuid);
        ids.forEach(id => {
          const entity = scene.objects?.[id];
          if (entity) entity.visible = true;
        });
        visibleFmGuids.push(storeyFmGuid);

        // Also collect xeokit meta IDs for event
        const metaIds = getXeokitIdsForFmGuid(xeokitViewer, storeyFmGuid);
        visibleMetaIds.push(...metaIds);
      });

      // Determine solo floor for clip event
      const isSolo = checkedGuids.size === 1;
      const soloFmGuid = isSolo ? [...checkedGuids][0] : null;
      const soloMetaId = soloFmGuid ? (getXeokitIdsForFmGuid(xeokitViewer, soloFmGuid)[0] || null) : null;

      const eventDetail: FloorSelectionEventDetail = {
        floorId: soloMetaId,
        floorName: null,
        bounds: null,
        visibleMetaFloorIds: visibleMetaIds,
        visibleFloorFmGuids: visibleFmGuids,
        isAllFloorsVisible: false,
      };
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: eventDetail }));
    } catch (e) {
      console.debug('ViewerTreePanel: Error applying visibility:', e);
    }
  }, [getXeokitViewer]);

  const handleStoreyCheck = useCallback((storeyFmGuid: string, checked: boolean) => {
    setCheckedStoreyFmGuids(prev => {
      const next = new Set(prev);
      if (checked) next.add(storeyFmGuid);
      else next.delete(storeyFmGuid);
      // Apply to scene
      setTimeout(() => applyStoreyVisibility(next), 0);
      return next;
    });
  }, [applyStoreyVisibility]);

  // ── Toggle storey expand ───────────────────────────────────────────────────

  const handleToggleStorey = useCallback((fmGuid: string) => {
    setExpandedStoreyIds(prev => {
      const next = new Set(prev);
      if (next.has(fmGuid)) next.delete(fmGuid);
      else next.add(fmGuid);
      return next;
    });
  }, []);

  const handleToggleSpace = useCallback((fmGuid: string) => {
    setExpandedSpaceIds(prev => {
      const next = new Set(prev);
      if (next.has(fmGuid)) next.delete(fmGuid);
      else next.add(fmGuid);
      return next;
    });
  }, []);

  // ── Select node (fly-to in xeokit) ────────────────────────────────────────

  const handleSelect = useCallback((fmGuid: string, name: string) => {
    setSelectedId(fmGuid);
    onNodeSelect?.(fmGuid, fmGuid);

    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer?.scene) return;

    try {
      const ids = getXeokitIdsForFmGuid(xeokitViewer, fmGuid);
      if (ids.length === 0) return;

      xeokitViewer.scene.setObjectsSelected(xeokitViewer.scene.selectedObjectIds, false);
      ids.forEach(id => {
        const entity = xeokitViewer.scene.objects?.[id];
        if (entity) entity.selected = true;
      });

      const firstEntity = xeokitViewer.scene.objects?.[ids[0]];
      if (firstEntity?.aabb) {
        xeokitViewer.cameraFlight?.flyTo({ aabb: firstEntity.aabb, duration: 0.5 });
      }
    } catch (e) {
      console.debug('ViewerTreePanel: select error:', e);
    }
  }, [getXeokitViewer, onNodeSelect, setSelectedId]);

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeStart({ x: e.clientX, y: e.clientY, width: size.width, height: size.height });
  }, [size]);

  useEffect(() => {
    if (!isDragging) return;
    const move = (e: MouseEvent) => setPosition({ x: Math.max(0, e.clientX - dragOffset.x), y: Math.max(0, e.clientY - dragOffset.y) });
    const up = () => setIsDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [isDragging, dragOffset]);

  useEffect(() => {
    if (!isResizing) return;
    const move = (e: MouseEvent) => {
      const w = Math.max(280, Math.min(600, resizeStart.width + (e.clientX - resizeStart.x)));
      const h = Math.max(200, Math.min(window.innerHeight - 100, resizeStart.height + (e.clientY - resizeStart.y)));
      setSize({ width: w, height: h });
    };
    const up = () => setIsResizing(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [isResizing, resizeStart]);

  // ── Filtered storeys ───────────────────────────────────────────────────────

  const filteredStoreys = useMemo(() => {
    if (!debouncedSearch) return storeys;
    const q = debouncedSearch.toLowerCase();
    return storeys.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.spaces.some(sp => sp.name.toLowerCase().includes(q) || sp.assets.some(a => a.name.toLowerCase().includes(q)))
    );
  }, [storeys, debouncedSearch]);

  // ── Tree content ───────────────────────────────────────────────────────────

  const TreeContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading model tree...</span>
        </div>
      );
    }

    if (filteredStoreys.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-1.5">
          <TreeDeciduous className="h-8 w-8 opacity-40" />
          <span>{debouncedSearch ? 'No match' : 'No floors found'}</span>
          {!debouncedSearch && (
            <span className="text-xs text-center px-4">Model data loading from Asset+</span>
          )}
        </div>
      );
    }

    return (
      <>
        {filteredStoreys.map(storey => (
          <StoreyRow
            key={storey.fmGuid}
            storey={storey}
            isChecked={checkedStoreyFmGuids.has(storey.fmGuid)}
            isExpanded={expandedStoreyIds.has(storey.fmGuid)}
            selectedFmGuid={selectedId}
            expandedSpaceIds={expandedSpaceIds}
            onCheck={handleStoreyCheck}
            onToggle={handleToggleStorey}
            onToggleSpace={handleToggleSpace}
            onSelect={handleSelect}
            searchQuery={debouncedSearch}
          />
        ))}
      </>
    );
  };

  if (!isVisible) return null;

  // ── Embedded mode ──────────────────────────────────────────────────────────

  if (embedded) {
    return (
      <div ref={ref} className="flex flex-col h-full">
        {/* Search */}
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search floor, room..."
              className="h-7 pl-7 text-xs"
            />
          </div>
        </div>

        {/* Hint if storeys are checked */}
        {checkedStoreyFmGuids.size > 0 && (
          <div className="px-2 py-1 bg-primary/10 text-primary text-xs flex items-center justify-between border-b">
            <span>Solo: {checkedStoreyFmGuids.size} level(s) selected</span>
            <button
              className="underline text-[10px]"
              onClick={() => {
                setCheckedStoreyFmGuids(new Set());
                applyStoreyVisibility(new Set());
              }}
            >
              Clear
            </button>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-1">
            <TreeContent />
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ── Floating panel mode ────────────────────────────────────────────────────

  return (
    <div
      ref={ref}
      className={cn(
        "fixed z-50",
        "bg-card/90 backdrop-blur-md border border-border/30 rounded-lg shadow-xl",
        "flex flex-col",
        isDragging && "cursor-grabbing select-none"
      )}
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
    >
      {/* Draggable Header */}
      <div
        className="flex items-center justify-between p-2.5 border-b cursor-grab active:cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <TreeDeciduous className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Model Tree</span>
          {storeys.length > 0 && (
            <Badge variant="secondary" className="text-xs">{storeys.length} levels</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Search */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search floor, room..."
            className="h-8 pl-7 text-sm"
          />
        </div>
      </div>

      {/* Solo hint */}
      {checkedStoreyFmGuids.size > 0 && (
        <div className="px-3 py-1.5 bg-primary/10 text-primary text-xs flex items-center justify-between border-b">
          <span>Solo: {checkedStoreyFmGuids.size} level(s)</span>
          <button
            className="underline text-[10px]"
            onClick={() => {
              setCheckedStoreyFmGuids(new Set());
              applyStoreyVisibility(new Set());
            }}
          >
            Visa alla
          </button>
        </div>
      )}

      {/* Tree content */}
      <ScrollArea className="flex-1 p-1">
        <TreeContent />
      </ScrollArea>

      {/* Resize handle */}
      <div
        className="hidden sm:block absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
        onMouseDown={handleResizeStart}
      >
        <svg className="w-3 h-3 absolute bottom-1 right-1 text-muted-foreground" viewBox="0 0 10 10">
          <path d="M0 10 L10 0 M4 10 L10 4 M7 10 L10 7" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  );
});

ViewerTreePanel.displayName = 'ViewerTreePanel';

export default ViewerTreePanel;

