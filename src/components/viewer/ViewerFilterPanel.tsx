import React, { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { ChevronDown, ChevronRight, Search, RotateCcw, Eye, X, Filter } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { MODEL_LOAD_REQUESTED_EVENT } from '@/lib/viewer-events';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BimSource {
  guid: string; // parentBimObjectId
  name: string; // parentCommonName e.g. "A-modell"
  storeyCount: number;
}

interface LevelItem {
  fmGuid: string;
  name: string;
  sourceGuid: string; // which BIM source it belongs to
  spaceCount: number;
}

interface SpaceItem {
  fmGuid: string;
  name: string;
  levelFmGuid: string;
}

interface CategoryItem {
  name: string;
  count: number;
}

interface ViewerFilterPanelProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  isVisible: boolean;
  onClose: () => void;
  onNodeSelect?: (fmGuid: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isGuid = (str: string): boolean => {
  if (!str || str.length < 20) return false;
  return /^[0-9a-f]{8}[-]?[0-9a-f]{4}/i.test(str);
};

const getXeokitIdsForFmGuid = (xeokitViewer: any, fmGuid: string): string[] => {
  if (!xeokitViewer?.metaScene?.metaObjects) return [];
  const fmLower = fmGuid.toLowerCase();
  const ids: string[] = [];
  Object.values(xeokitViewer.metaScene.metaObjects).forEach((obj: any) => {
    const sysId = (obj.originalSystemId || '').toLowerCase();
    if (sysId === fmLower) ids.push(obj.id);
  });
  return ids;
};

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

const getAllXeokitIdsForStorey = (xeokitViewer: any, storeyFmGuid: string): string[] => {
  const rootIds = getXeokitIdsForFmGuid(xeokitViewer, storeyFmGuid);
  const all = new Set<string>();
  rootIds.forEach(id => {
    getDescendantIds(xeokitViewer, id).forEach(descId => all.add(descId));
  });
  return [...all];
};

const HIGHLIGHT_COLOR: [number, number, number] = [0.25, 0.55, 0.95]; // Blue highlight for selected spaces

// ─── Component ────────────────────────────────────────────────────────────────

const ViewerFilterPanel: React.FC<ViewerFilterPanelProps> = ({
  viewerRef,
  buildingFmGuid,
  isVisible,
  onClose,
  onNodeSelect,
}) => {
  const { allData } = useContext(AppContext);

  // Section open/close state
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [levelsOpen, setLevelsOpen] = useState(true);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  // Checked state per section
  const [checkedSources, setCheckedSources] = useState<Set<string>>(new Set());
  const [checkedLevels, setCheckedLevels] = useState<Set<string>>(new Set());
  const [checkedSpaces, setCheckedSpaces] = useState<Set<string>>(new Set());
  const [checkedCategories, setCheckedCategories] = useState<Set<string>>(new Set());

  // Search per section
  const [spacesSearch, setSpacesSearch] = useState('');
  const [levelsSearch, setLevelsSearch] = useState('');

  // ── Derived data from Asset+ ────────────────────────────────────────────

  const buildingData = useMemo(() => {
    if (!allData || !buildingFmGuid) return [];
    return allData.filter((a: any) =>
      (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid
    );
  }, [allData, buildingFmGuid]);

  // Sources: unique BIM models from Building Storey parentBimObjectId
  const sources: BimSource[] = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    buildingData
      .filter((a: any) => a.category === 'Building Storey' || a.category === 'IfcBuildingStorey')
      .forEach((a: any) => {
        const attrs = a.attributes || {};
        const guid = attrs.parentBimObjectId;
        const name = attrs.parentCommonName;
        if (guid && name && !isGuid(name)) {
          const existing = map.get(guid);
          if (existing) existing.count++;
          else map.set(guid, { name, count: 1 });
        }
      });
    return Array.from(map.entries())
      .map(([guid, { name, count }]) => ({ guid, name, storeyCount: count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }, [buildingData]);

  // Levels: Building Storeys
  const levels: LevelItem[] = useMemo(() => {
    return buildingData
      .filter((a: any) => a.category === 'Building Storey' || a.category === 'IfcBuildingStorey')
      .map((a: any) => {
        const fmGuid = a.fmGuid || a.fm_guid;
        const name = a.commonName || a.common_name || a.name;
        const attrs = a.attributes || {};
        const sourceGuid = attrs.parentBimObjectId || '';
        const spaceCount = buildingData.filter((s: any) =>
          (s.category === 'Space' || s.category === 'IfcSpace') &&
          (s.levelFmGuid || s.level_fm_guid) === fmGuid
        ).length;
        return {
          fmGuid,
          name: name && !isGuid(name) ? name : `Level ${fmGuid?.slice(0, 8)}`,
          sourceGuid,
          spaceCount,
        };
      })
      .sort((a, b) => {
        const extract = (n: string) => {
          const m = n.match(/(-?\d+)/);
          return m ? parseInt(m[1], 10) : 0;
        };
        return extract(a.name) - extract(b.name);
      });
  }, [buildingData]);

  // Spaces: rooms, filtered by checked levels
  const spaces: SpaceItem[] = useMemo(() => {
    const visibleLevelGuids = checkedLevels.size > 0 ? checkedLevels : new Set(levels.map(l => l.fmGuid));
    return buildingData
      .filter((a: any) => {
        const cat = a.category;
        if (cat !== 'Space' && cat !== 'IfcSpace') return false;
        const levelGuid = a.levelFmGuid || a.level_fm_guid;
        return visibleLevelGuids.has(levelGuid);
      })
      .map((a: any) => ({
        fmGuid: a.fmGuid || a.fm_guid,
        name: (a.commonName || a.common_name || a.name || 'Unnamed').replace(/^null$/, 'Unnamed'),
        levelFmGuid: a.levelFmGuid || a.level_fm_guid,
      }))
      .filter(s => !isGuid(s.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv', { numeric: true }));
  }, [buildingData, checkedLevels, levels]);

  // Categories: from Asset+ category field
  const categories: CategoryItem[] = useMemo(() => {
    const map = new Map<string, number>();
    buildingData.forEach((a: any) => {
      const cat = a.category;
      if (cat) map.set(cat, (map.get(cat) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [buildingData]);

  // ── XEOKit accessor ─────────────────────────────────────────────────────

  const getXeokitViewer = useCallback(() => {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }, [viewerRef]);

  // ── Apply X-ray + highlight logic ───────────────────────────────────────

  const applyFilterVisibility = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;

    const hasAnyFilter = checkedSources.size > 0 || checkedLevels.size > 0 || checkedSpaces.size > 0;

    if (!hasAnyFilter) {
      // Reset: show all, remove xray
      scene.setObjectsVisible(scene.objectIds, true);
      scene.setObjectsXRayed(scene.xrayedObjectIds, false);
      scene.setObjectsColorized(scene.colorizedObjectIds, false);

      // Dispatch all floors visible
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
        detail: {
          floorId: null, floorName: null, bounds: null,
          visibleMetaFloorIds: [], visibleFloorFmGuids: [],
          isAllFloorsVisible: true,
        } as FloorSelectionEventDetail,
      }));
      return;
    }

    // Step 1: Determine which storeys are visible based on sources + levels filters
    let visibleStoreyGuids: Set<string>;
    if (checkedLevels.size > 0) {
      visibleStoreyGuids = new Set(checkedLevels);
    } else if (checkedSources.size > 0) {
      // Show only levels belonging to checked sources
      visibleStoreyGuids = new Set(
        levels.filter(l => checkedSources.has(l.sourceGuid)).map(l => l.fmGuid)
      );
    } else {
      visibleStoreyGuids = new Set(levels.map(l => l.fmGuid));
    }

    // Step 2: Hide all, then show visible storeys
    scene.setObjectsVisible(scene.objectIds, false);
    
    const visibleFmGuids: string[] = [];
    visibleStoreyGuids.forEach(storeyFmGuid => {
      const ids = getAllXeokitIdsForStorey(viewer, storeyFmGuid);
      ids.forEach(id => {
        const entity = scene.objects?.[id];
        if (entity) entity.visible = true;
      });
      visibleFmGuids.push(storeyFmGuid);
    });

    // Step 3: If spaces are checked, X-ray everything visible and highlight checked spaces
    if (checkedSpaces.size > 0) {
      // X-ray all visible objects
      const visibleIds = scene.visibleObjectIds;
      scene.setObjectsXRayed(visibleIds, true);

      // Un-xray and colorize checked spaces
      checkedSpaces.forEach(spaceFmGuid => {
        const ids = getXeokitIdsForFmGuid(viewer, spaceFmGuid);
        ids.forEach(id => {
          const allIds = getDescendantIds(viewer, id);
          allIds.forEach(descId => {
            const entity = scene.objects?.[descId];
            if (entity) {
              entity.xrayed = false;
              entity.colorize = HIGHLIGHT_COLOR;
            }
          });
        });
      });
    } else {
      // No space filter: remove xray
      scene.setObjectsXRayed(scene.xrayedObjectIds, false);
      scene.setObjectsColorized(scene.colorizedObjectIds, false);
    }

    // Step 4: Dispatch floor visibility event
    const isSolo = visibleStoreyGuids.size === 1;
    const soloFmGuid = isSolo ? [...visibleStoreyGuids][0] : null;
    const soloMetaId = soloFmGuid ? (getXeokitIdsForFmGuid(viewer, soloFmGuid)[0] || null) : null;

    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
      detail: {
        floorId: soloMetaId,
        floorName: null,
        bounds: null,
        visibleMetaFloorIds: [],
        visibleFloorFmGuids: visibleFmGuids,
        isAllFloorsVisible: false,
      } as FloorSelectionEventDetail,
    }));
  }, [getXeokitViewer, checkedSources, checkedLevels, checkedSpaces, levels]);

  // Apply whenever filters change
  useEffect(() => {
    if (!isVisible) return;
    applyFilterVisibility();
  }, [checkedSources, checkedLevels, checkedSpaces, applyFilterVisibility, isVisible]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSourceToggle = useCallback((guid: string, checked: boolean) => {
    setCheckedSources(prev => {
      const next = new Set(prev);
      if (checked) next.add(guid); else next.delete(guid);
      return next;
    });
  }, []);

  const handleLevelToggle = useCallback((fmGuid: string, checked: boolean) => {
    setCheckedLevels(prev => {
      const next = new Set(prev);
      if (checked) next.add(fmGuid); else next.delete(fmGuid);
      return next;
    });
  }, []);

  const handleSpaceToggle = useCallback((fmGuid: string, checked: boolean) => {
    setCheckedSpaces(prev => {
      const next = new Set(prev);
      if (checked) next.add(fmGuid); else next.delete(fmGuid);
      return next;
    });
  }, []);

  const handleCategoryToggle = useCallback((name: string, checked: boolean) => {
    setCheckedCategories(prev => {
      const next = new Set(prev);
      if (checked) next.add(name); else next.delete(name);
      return next;
    });
  }, []);

  const handleSpaceClick = useCallback((fmGuid: string) => {
    onNodeSelect?.(fmGuid);
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    
    // Fly to space
    const ids = getXeokitIdsForFmGuid(viewer, fmGuid);
    if (ids.length > 0) {
      viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
      ids.forEach((id: string) => {
        const entity = viewer.scene.objects?.[id];
        if (entity) entity.selected = true;
      });
      const firstEntity = viewer.scene.objects?.[ids[0]];
      if (firstEntity?.aabb) {
        viewer.cameraFlight?.flyTo({ aabb: firstEntity.aabb, duration: 0.5 });
      }
    }
  }, [getXeokitViewer, onNodeSelect]);

  const handleResetSection = useCallback((section: 'sources' | 'levels' | 'spaces' | 'categories') => {
    switch (section) {
      case 'sources': setCheckedSources(new Set()); break;
      case 'levels': setCheckedLevels(new Set()); break;
      case 'spaces': setCheckedSpaces(new Set()); break;
      case 'categories': setCheckedCategories(new Set()); break;
    }
  }, []);

  const handleResetAll = useCallback(() => {
    setCheckedSources(new Set());
    setCheckedLevels(new Set());
    setCheckedSpaces(new Set());
    setCheckedCategories(new Set());
  }, []);

  // ── Filtered spaces by search ───────────────────────────────────────────

  const filteredSpaces = useMemo(() => {
    if (!spacesSearch) return spaces;
    const q = spacesSearch.toLowerCase();
    return spaces.filter(s => s.name.toLowerCase().includes(q));
  }, [spaces, spacesSearch]);

  const filteredLevels = useMemo(() => {
    if (!levelsSearch) return levels;
    const q = levelsSearch.toLowerCase();
    return levels.filter(l => l.name.toLowerCase().includes(q));
  }, [levels, levelsSearch]);

  const totalFilters = checkedSources.size + checkedLevels.size + checkedSpaces.size + checkedCategories.size;

  if (!isVisible) return null;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "fixed left-0 top-0 bottom-0 z-40 w-[300px]",
        "bg-card/95 backdrop-blur-xl border-r shadow-2xl",
        "flex flex-col",
        "animate-in slide-in-from-left duration-200"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Filter</span>
          {totalFilters > 0 && (
            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
              {totalFilters}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {totalFilters > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleResetAll}>
              Reset
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {/* ── Sources Section ──────────────────────────────────────────── */}
          <FilterSection
            title="Sources"
            count={sources.length}
            selectedCount={checkedSources.size}
            isOpen={sourcesOpen}
            onToggle={() => setSourcesOpen(!sourcesOpen)}
            onReset={() => handleResetSection('sources')}
          >
            {sources.map(source => (
              <FilterRow
                key={source.guid}
                label={source.name}
                badge={`${source.storeyCount}`}
                checked={checkedSources.has(source.guid)}
                onCheckedChange={(checked) => handleSourceToggle(source.guid, checked)}
              />
            ))}
            {sources.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">No sources found</p>
            )}
          </FilterSection>

          {/* ── Levels Section ──────────────────────────────────────────── */}
          <FilterSection
            title="Levels"
            count={levels.length}
            selectedCount={checkedLevels.size}
            isOpen={levelsOpen}
            onToggle={() => setLevelsOpen(!levelsOpen)}
            onReset={() => handleResetSection('levels')}
            searchValue={levelsSearch}
            onSearchChange={setLevelsSearch}
            showSearch={levels.length > 6}
          >
            {filteredLevels.map(level => (
              <FilterRow
                key={level.fmGuid}
                label={level.name}
                badge={level.spaceCount > 0 ? `${level.spaceCount}` : undefined}
                checked={checkedLevels.has(level.fmGuid)}
                onCheckedChange={(checked) => handleLevelToggle(level.fmGuid, checked)}
                onClick={() => handleSpaceClick(level.fmGuid)}
                dimmed={checkedSources.size > 0 && !checkedSources.has(level.sourceGuid)}
              />
            ))}
          </FilterSection>

          {/* ── Spaces Section ──────────────────────────────────────────── */}
          <FilterSection
            title="Spaces"
            count={spaces.length}
            selectedCount={checkedSpaces.size}
            isOpen={spacesOpen}
            onToggle={() => setSpacesOpen(!spacesOpen)}
            onReset={() => handleResetSection('spaces')}
            searchValue={spacesSearch}
            onSearchChange={setSpacesSearch}
            showSearch={spaces.length > 6}
          >
            {filteredSpaces.slice(0, 200).map(space => (
              <FilterRow
                key={space.fmGuid}
                label={space.name}
                checked={checkedSpaces.has(space.fmGuid)}
                onCheckedChange={(checked) => handleSpaceToggle(space.fmGuid, checked)}
                onClick={() => handleSpaceClick(space.fmGuid)}
              />
            ))}
            {filteredSpaces.length > 200 && (
              <p className="text-xs text-muted-foreground px-3 py-1">
                Showing 200 of {filteredSpaces.length} spaces
              </p>
            )}
            {filteredSpaces.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">
                {spacesSearch ? 'No match' : 'No spaces on selected levels'}
              </p>
            )}
          </FilterSection>

          {/* ── Categories Section ──────────────────────────────────────── */}
          <FilterSection
            title="Categories"
            count={categories.length}
            selectedCount={checkedCategories.size}
            isOpen={categoriesOpen}
            onToggle={() => setCategoriesOpen(!categoriesOpen)}
            onReset={() => handleResetSection('categories')}
          >
            {categories.map(cat => (
              <FilterRow
                key={cat.name}
                label={cat.name}
                badge={`${cat.count}`}
                checked={checkedCategories.has(cat.name)}
                onCheckedChange={(checked) => handleCategoryToggle(cat.name, checked)}
              />
            ))}
          </FilterSection>
        </div>
      </ScrollArea>
    </div>
  );
};

// ─── Sub-components ────────────────────────────────────────────────────────────

interface FilterSectionProps {
  title: string;
  count: number;
  selectedCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onReset: () => void;
  showSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  children: React.ReactNode;
}

const FilterSection: React.FC<FilterSectionProps> = ({
  title, count, selectedCount, isOpen, onToggle, onReset,
  showSearch, searchValue, onSearchChange, children,
}) => (
  <div className="border-b last:border-b-0">
    <button
      className="flex items-center justify-between w-full px-3 py-2 hover:bg-accent/30 transition-colors"
      onClick={onToggle}
    >
      <div className="flex items-center gap-2">
        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-normal">
          {selectedCount > 0 ? `${selectedCount}/${count}` : count}
        </Badge>
      </div>
      {selectedCount > 0 && (
        <button
          className="text-[10px] text-primary hover:underline"
          onClick={(e) => { e.stopPropagation(); onReset(); }}
        >
          Reset
        </button>
      )}
    </button>
    {isOpen && (
      <div className="pb-1">
        {showSearch && onSearchChange && (
          <div className="px-3 pb-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={searchValue || ''}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search..."
                className="h-6 pl-7 text-xs"
              />
            </div>
          </div>
        )}
        {children}
      </div>
    )}
  </div>
);

interface FilterRowProps {
  label: string;
  badge?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onClick?: () => void;
  dimmed?: boolean;
}

const FilterRow: React.FC<FilterRowProps> = ({ label, badge, checked, onCheckedChange, onClick, dimmed }) => (
  <div
    className={cn(
      "flex items-center gap-2 px-3 py-1 hover:bg-accent/30 transition-colors cursor-pointer group",
      dimmed && "opacity-40"
    )}
    onClick={onClick}
  >
    <Checkbox
      checked={checked}
      className="h-3.5 w-3.5 shrink-0"
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={(v) => onCheckedChange(!!v)}
    />
    <span className="text-xs truncate flex-1">{label}</span>
    {badge && (
      <span className="text-[10px] text-muted-foreground shrink-0">{badge}</span>
    )}
  </div>
);

export default ViewerFilterPanel;
