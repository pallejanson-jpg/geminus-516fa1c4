import React, { useState, useEffect, useCallback, useMemo, useContext, useRef } from 'react';
import { ChevronDown, ChevronRight, Search, X, Filter, Paintbrush } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BimSource {
  guid: string;
  name: string;
  storeyCount: number;
}

interface LevelItem {
  fmGuid: string;
  name: string;
  sourceGuid: string;
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

// ─── Color palette (Tandem-style rainbow) ─────────────────────────────────────

const LEVEL_PALETTE = [
  '#FF6B6B', '#4ECB71', '#9B59B6', '#F1C40F', '#3498DB',
  '#E67E22', '#1ABC9C', '#E91E63', '#00BCD4', '#8BC34A',
  '#FF9800', '#673AB7', '#009688', '#CDDC39', '#FF5722',
  '#795548', '#607D8B', '#9C27B0', '#2196F3', '#4CAF50',
];

const hexToRgb01 = (hex: string): [number, number, number] => {
  const c = hex.replace('#', '');
  return [
    parseInt(c.slice(0, 2), 16) / 255,
    parseInt(c.slice(2, 4), 16) / 255,
    parseInt(c.slice(4, 6), 16) / 255,
  ];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isGuid = (str: string): boolean =>
  !!str && str.length >= 20 && /^[0-9a-f]{8}[-]?[0-9a-f]{4}/i.test(str);

const getDescendantIds = (viewer: any, rootId: string): string[] => {
  const metaObj = viewer?.metaScene?.metaObjects?.[rootId];
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

const HIGHLIGHT_COLOR: [number, number, number] = [0.25, 0.55, 0.95];

// ─── Component ────────────────────────────────────────────────────────────────

const ViewerFilterPanel: React.FC<ViewerFilterPanelProps> = ({
  viewerRef, buildingFmGuid, isVisible, onClose, onNodeSelect,
}) => {
  const { allData } = useContext(AppContext);

  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [levelsOpen, setLevelsOpen] = useState(true);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const [checkedSources, setCheckedSources] = useState<Set<string>>(new Set());
  const [checkedLevels, setCheckedLevels] = useState<Set<string>>(new Set());
  const [checkedSpaces, setCheckedSpaces] = useState<Set<string>>(new Set());
  const [checkedCategories, setCheckedCategories] = useState<Set<string>>(new Set());

  const [spacesSearch, setSpacesSearch] = useState('');
  const [levelsSearch, setLevelsSearch] = useState('');

  // Per-level colors
  const [levelColors, setLevelColors] = useState<Map<string, string>>(new Map());
  const [autoColorEnabled, setAutoColorEnabled] = useState(true);

  // Cache: level fmGuid → xeokit entity IDs (built once when viewer ready)
  const entityMapRef = useRef<Map<string, string[]>>(new Map());
  const entityMapBuilt = useRef(false);

  // ── Derived data from Asset+ ────────────────────────────────────────────

  const buildingData = useMemo(() => {
    if (!allData || !buildingFmGuid) return [];
    return allData.filter((a: any) =>
      (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid
    );
  }, [allData, buildingFmGuid]);

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
        const extract = (n: string) => { const m = n.match(/(-?\d+)/); return m ? parseInt(m[1], 10) : 0; };
        return extract(a.name) - extract(b.name);
      });
  }, [buildingData]);

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

  // Auto-assign palette colors to levels
  useEffect(() => {
    const colors = new Map<string, string>();
    levels.forEach((level, idx) => {
      colors.set(level.fmGuid, LEVEL_PALETTE[idx % LEVEL_PALETTE.length]);
    });
    setLevelColors(colors);
  }, [levels]);

  // ── XEOKit accessor ─────────────────────────────────────────────────────

  const getXeokitViewer = useCallback(() => {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }, [viewerRef]);

  // ── Build entity ID map (fmGuid → xeokit IDs) ─────────────────────────

  const buildEntityMap = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return false;

    const metaObjects = viewer.metaScene.metaObjects;
    const map = new Map<string, string[]>();

    // Step 1: Collect ALL IfcBuildingStorey and IfcSpace from xeokit metaScene
    const xeokitStoreys: { id: string; sysId: string; name: string }[] = [];
    const xeokitSpaces: { id: string; sysId: string; name: string }[] = [];

    Object.values(metaObjects).forEach((mo: any) => {
      const type = (mo.type || '').toLowerCase();
      if (type === 'ifcbuildingstorey') {
        xeokitStoreys.push({
          id: mo.id,
          sysId: (mo.originalSystemId || mo.id || ''),
          name: (mo.name || ''),
        });
      } else if (type === 'ifcspace') {
        xeokitSpaces.push({
          id: mo.id,
          sysId: (mo.originalSystemId || mo.id || ''),
          name: (mo.name || ''),
        });
      }
    });

    if (xeokitStoreys.length === 0) {
      console.warn('[FilterPanel] No IfcBuildingStorey found in metaScene');
      return false;
    }

    // Step 2: Match Asset+ levels → xeokit storeys (try sysId first, then name)
    const usedStoreyIds = new Set<string>();
    levels.forEach(level => {
      const fmLower = level.fmGuid.toLowerCase();
      const nameLower = level.name.toLowerCase().trim();

      let matched = xeokitStoreys.find(xs =>
        !usedStoreyIds.has(xs.id) && xs.sysId.toLowerCase() === fmLower
      );
      if (!matched) matched = xeokitStoreys.find(xs =>
        !usedStoreyIds.has(xs.id) &&
        xs.sysId.toLowerCase().replace(/-/g, '') === fmLower.replace(/-/g, '')
      );
      if (!matched) matched = xeokitStoreys.find(xs =>
        !usedStoreyIds.has(xs.id) && xs.name.toLowerCase().trim() === nameLower
      );
      // Fuzzy name: contains match
      if (!matched) matched = xeokitStoreys.find(xs =>
        !usedStoreyIds.has(xs.id) && (
          xs.name.toLowerCase().includes(nameLower) ||
          nameLower.includes(xs.name.toLowerCase().trim())
        )
      );

      if (matched) {
        usedStoreyIds.add(matched.id);
        const descendants = getDescendantIds(viewer, matched.id);
        map.set(level.fmGuid, descendants);
      }
    });

    // Step 3: Match Asset+ spaces → xeokit spaces
    const usedSpaceIds = new Set<string>();
    spaces.forEach(space => {
      const fmLower = space.fmGuid.toLowerCase();
      const nameLower = space.name.toLowerCase().trim();

      let matched = xeokitSpaces.find(xs =>
        !usedSpaceIds.has(xs.id) && xs.sysId.toLowerCase() === fmLower
      );
      if (!matched) matched = xeokitSpaces.find(xs =>
        !usedSpaceIds.has(xs.id) &&
        xs.sysId.toLowerCase().replace(/-/g, '') === fmLower.replace(/-/g, '')
      );
      if (!matched) matched = xeokitSpaces.find(xs =>
        !usedSpaceIds.has(xs.id) && xs.name.toLowerCase().trim() === nameLower
      );

      if (matched) {
        usedSpaceIds.add(matched.id);
        const descendants = getDescendantIds(viewer, matched.id);
        map.set(space.fmGuid, descendants);
      }
    });

    // Step 4: Also build a source → model objects map using scene.models
    // For Sources filtering: map each xeokit model to a source guid
    const sceneModels = viewer.scene.models || {};
    Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
      const modelObjKeys = Object.keys((model as any).objects || {});
      // Find an IfcBuildingStorey in this model to determine which source it belongs to
      for (const objId of modelObjKeys) {
        const mo = metaObjects[objId];
        if (mo?.type === 'IfcBuildingStorey') {
          const sysId = (mo.originalSystemId || '').toLowerCase();
          const moName = (mo.name || '').toLowerCase().trim();
          // Find matching Asset+ level
          const matchedLevel = levels.find(l =>
            l.fmGuid.toLowerCase() === sysId ||
            l.fmGuid.toLowerCase().replace(/-/g, '') === sysId.replace(/-/g, '') ||
            l.name.toLowerCase().trim() === moName
          );
          if (matchedLevel) {
            // Store model objects under a source key: "source::{guid}"
            const sourceKey = `source::${matchedLevel.sourceGuid}`;
            const existing = map.get(sourceKey) || [];
            map.set(sourceKey, [...existing, ...modelObjKeys]);
          }
          break; // Only need first storey per model
        }
      }
    });

    entityMapRef.current = map;
    entityMapBuilt.current = true;
    console.log('[FilterPanel] Entity map built:', map.size, 'entries.',
      'Levels matched:', levels.filter(l => map.has(l.fmGuid)).length, '/', levels.length,
      'Spaces matched:', spaces.filter(s => map.has(s.fmGuid)).length, '/', spaces.length,
      'xeokit storeys:', xeokitStoreys.length, 'xeokit spaces:', xeokitSpaces.length);
    return true;
  }, [getXeokitViewer, levels, spaces]);

  // Build map when viewer is ready
  useEffect(() => {
    if (!isVisible) return;
    entityMapBuilt.current = false;
    const tryBuild = () => {
      if (buildEntityMap()) return;
      // Retry a few times
      let attempts = 0;
      const interval = setInterval(() => {
        if (buildEntityMap() || attempts++ > 15) clearInterval(interval);
      }, 500);
      return () => clearInterval(interval);
    };
    const cleanup = tryBuild();
    return cleanup;
  }, [isVisible, buildEntityMap]);

  // ── IFC type mapping for categories ─────────────────────────────────────

  const categoryToIfcTypes = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const mappings: Record<string, string[]> = {
      'Building': ['IfcBuilding'],
      'Building Storey': ['IfcBuildingStorey'],
      'Space': ['IfcSpace'],
      'Instance': ['IfcFurnishingElement', 'IfcFlowTerminal', 'IfcFlowSegment', 'IfcFlowFitting', 'IfcFlowController', 'IfcFlowMovingDevice', 'IfcFlowStorageDevice', 'IfcFlowTreatmentDevice', 'IfcEnergyConversionDevice', 'IfcDistributionFlowElement'],
      'Wall': ['IfcWall', 'IfcWallStandardCase'],
      'Door': ['IfcDoor'],
      'Window': ['IfcWindow'],
      'Slab': ['IfcSlab'],
      'Roof': ['IfcRoof'],
      'Stair': ['IfcStairFlight', 'IfcStair'],
      'Column': ['IfcColumn'],
      'Beam': ['IfcBeam'],
      'Covering': ['IfcCovering'],
      'Railing': ['IfcRailing'],
      'Curtain Wall': ['IfcCurtainWall', 'IfcPlate'],
    };
    for (const [cat, types] of Object.entries(mappings)) {
      map.set(cat, new Set(types));
    }
    return map;
  }, []);

  // ── Apply filter + coloring ─────────────────────────────────────────────

  const applyFilterVisibility = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;
    const eMap = entityMapRef.current;

    const hasAnyFilter = checkedSources.size > 0 || checkedLevels.size > 0 ||
      checkedSpaces.size > 0 || checkedCategories.size > 0;

    // Step 0: Clean slate
    scene.setObjectsVisible(scene.objectIds, true);
    if (scene.xrayedObjectIds?.length > 0) scene.setObjectsXRayed(scene.xrayedObjectIds, false);
    if (scene.colorizedObjectIds?.length > 0) scene.setObjectsColorized(scene.colorizedObjectIds, false);

    // Step 1: Apply level auto-colors (always, if enabled)
    if (autoColorEnabled && eMap.size > 0) {
      levels.forEach(level => {
        const color = levelColors.get(level.fmGuid);
        const entityIds = eMap.get(level.fmGuid);
        if (color && entityIds) {
          const rgb = hexToRgb01(color);
          entityIds.forEach(id => {
            const entity = scene.objects?.[id];
            if (entity) {
              entity.colorize = rgb;
            }
          });
        }
      });
    }

    if (!hasAnyFilter) {
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
        detail: {
          floorId: null, floorName: null, bounds: null,
          visibleMetaFloorIds: [], visibleFloorFmGuids: [],
          isAllFloorsVisible: true,
        } as FloorSelectionEventDetail,
      }));
      return;
    }

    // Step 2: Collect solid IDs per active filter, then intersect
    let sourceIds: Set<string> | null = null;
    if (checkedSources.size > 0) {
      sourceIds = new Set<string>();
      // Method 1: via level descendants
      levels.filter(l => checkedSources.has(l.sourceGuid)).forEach(l => {
        eMap.get(l.fmGuid)?.forEach(id => sourceIds!.add(id));
      });
      // Method 2: via source::guid model objects map (direct from scene.models)
      checkedSources.forEach(guid => {
        eMap.get(`source::${guid}`)?.forEach(id => sourceIds!.add(id));
      });
    }

    let levelIds: Set<string> | null = null;
    if (checkedLevels.size > 0) {
      levelIds = new Set<string>();
      checkedLevels.forEach(fmGuid => {
        eMap.get(fmGuid)?.forEach(id => levelIds!.add(id));
      });
    }

    let spaceIds: Set<string> | null = null;
    if (checkedSpaces.size > 0) {
      spaceIds = new Set<string>();
      checkedSpaces.forEach(fmGuid => {
        eMap.get(fmGuid)?.forEach(id => spaceIds!.add(id));
      });
    }

    let categoryIds: Set<string> | null = null;
    if (checkedCategories.size > 0) {
      categoryIds = new Set<string>();
      const allowedIfcTypes = new Set<string>();
      checkedCategories.forEach(cat => {
        const ifcTypes = categoryToIfcTypes.get(cat);
        if (ifcTypes) ifcTypes.forEach(t => allowedIfcTypes.add(t));
        allowedIfcTypes.add(cat);
      });
      if (viewer.metaScene?.metaObjects) {
        Object.values(viewer.metaScene.metaObjects).forEach((mo: any) => {
          if (allowedIfcTypes.has(mo.type)) categoryIds!.add(mo.id);
        });
      }
    }

    // Intersect active filters
    const filterSets = [sourceIds, levelIds, spaceIds, categoryIds].filter((s): s is Set<string> => s !== null);
    let solidIds: Set<string>;
    if (filterSets.length === 1) {
      solidIds = filterSets[0];
    } else {
      const sorted = [...filterSets].sort((a, b) => a.size - b.size);
      solidIds = new Set<string>();
      for (const id of sorted[0]) {
        if (sorted.every(s => s.has(id))) solidIds.add(id);
      }
    }

    // Step 3: X-ray everything, then un-x-ray solid set
    // Configure xray material
    const xrayMat = scene.xrayMaterial;
    if (xrayMat) {
      xrayMat.fill = true;
      xrayMat.fillAlpha = 0.12;
      xrayMat.fillColor = [0.55, 0.55, 0.6];
      xrayMat.edges = true;
      xrayMat.edgeAlpha = 0.3;
      xrayMat.edgeColor = [0.4, 0.4, 0.45];
    }
    scene.setObjectsXRayed(scene.objectIds, true);

    if (solidIds.size > 0) {
      const arr = [...solidIds];
      scene.setObjectsXRayed(arr, false);
    }

    // Step 4: If spaces checked, colorize them blue (override level color)
    if (checkedSpaces.size > 0 && spaceIds) {
      spaceIds.forEach(id => {
        const entity = scene.objects?.[id];
        if (entity) entity.colorize = HIGHLIGHT_COLOR;
      });
    }

    // Step 5: Floor visibility event for labels
    const visibleFmGuids: string[] = [];
    if (checkedLevels.size > 0) {
      checkedLevels.forEach(g => visibleFmGuids.push(g));
    } else if (checkedSources.size > 0) {
      levels.filter(l => checkedSources.has(l.sourceGuid)).forEach(l => visibleFmGuids.push(l.fmGuid));
    }

    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
      detail: {
        floorId: visibleFmGuids.length === 1 ? visibleFmGuids[0] : null,
        floorName: null, bounds: null,
        visibleMetaFloorIds: [], visibleFloorFmGuids: visibleFmGuids,
        isAllFloorsVisible: !hasAnyFilter,
      } as FloorSelectionEventDetail,
    }));

    console.debug('[FilterPanel] Applied filter. solidIds:', solidIds.size, '/', scene.objectIds.length);
  }, [getXeokitViewer, checkedSources, checkedLevels, checkedSpaces, checkedCategories,
    levels, categoryToIfcTypes, levelColors, autoColorEnabled]);

  // Apply whenever filters or colors change
  useEffect(() => {
    if (!isVisible) return;
    applyFilterVisibility();
  }, [checkedSources, checkedLevels, checkedSpaces, checkedCategories,
    levelColors, autoColorEnabled, applyFilterVisibility, isVisible]);

  // Cleanup when panel closes: reset viewer state
  useEffect(() => {
    if (isVisible) return;
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;
    if (scene.xrayedObjectIds?.length > 0) scene.setObjectsXRayed(scene.xrayedObjectIds, false);
    if (scene.colorizedObjectIds?.length > 0) scene.setObjectsColorized(scene.colorizedObjectIds, false);
  }, [isVisible, getXeokitViewer]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSourceToggle = useCallback((guid: string, checked: boolean) => {
    setCheckedSources(prev => { const n = new Set(prev); checked ? n.add(guid) : n.delete(guid); return n; });
  }, []);

  const handleLevelToggle = useCallback((fmGuid: string, checked: boolean) => {
    setCheckedLevels(prev => { const n = new Set(prev); checked ? n.add(fmGuid) : n.delete(fmGuid); return n; });
  }, []);

  const handleSpaceToggle = useCallback((fmGuid: string, checked: boolean) => {
    setCheckedSpaces(prev => { const n = new Set(prev); checked ? n.add(fmGuid) : n.delete(fmGuid); return n; });
  }, []);

  const handleCategoryToggle = useCallback((name: string, checked: boolean) => {
    setCheckedCategories(prev => { const n = new Set(prev); checked ? n.add(name) : n.delete(name); return n; });
  }, []);

  const handleSpaceClick = useCallback((fmGuid: string) => {
    onNodeSelect?.(fmGuid);
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const ids = entityMapRef.current.get(fmGuid) || [];
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

  const handleLevelColorChange = useCallback((fmGuid: string, color: string) => {
    setLevelColors(prev => {
      const n = new Map(prev);
      n.set(fmGuid, color);
      return n;
    });
  }, []);

  // ── Filtered items ──────────────────────────────────────────────────────

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
            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">{totalFilters}</Badge>
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
          {/* Sources */}
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

          {/* Levels */}
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
            rightAction={
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-5 w-5", autoColorEnabled ? "text-primary" : "text-muted-foreground")}
                title={autoColorEnabled ? "Turn off auto-colors" : "Turn on auto-colors"}
                onClick={(e) => { e.stopPropagation(); setAutoColorEnabled(!autoColorEnabled); }}
              >
                <Paintbrush className="h-3 w-3" />
              </Button>
            }
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
                color={autoColorEnabled ? levelColors.get(level.fmGuid) : undefined}
                onColorChange={(color) => handleLevelColorChange(level.fmGuid, color)}
              />
            ))}
          </FilterSection>

          {/* Spaces */}
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

          {/* Categories */}
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
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}

const FilterSection: React.FC<FilterSectionProps> = ({
  title, count, selectedCount, isOpen, onToggle, onReset,
  showSearch, searchValue, onSearchChange, rightAction, children,
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
      <div className="flex items-center gap-1">
        {rightAction}
        {selectedCount > 0 && (
          <button
            className="text-[10px] text-primary hover:underline"
            onClick={(e) => { e.stopPropagation(); onReset(); }}
          >
            Reset
          </button>
        )}
      </div>
    </button>
    {isOpen && (
      <div className="pb-1">
        {showSearch && onSearchChange && (
          <div className="px-3 pb-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input value={searchValue || ''} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search..." className="h-6 pl-7 text-xs" />
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
  color?: string;
  onColorChange?: (color: string) => void;
}

const FilterRow: React.FC<FilterRowProps> = ({
  label, badge, checked, onCheckedChange, onClick, dimmed, color, onColorChange,
}) => (
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
    <span className={cn("text-xs truncate flex-1", checked && "text-primary font-medium")}>{label}</span>
    {badge && <span className="text-[10px] text-muted-foreground shrink-0">{badge}</span>}
    {color && onColorChange && (
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="h-3 w-3 rounded-full shrink-0 border border-border/50 hover:scale-125 transition-transform"
            style={{ backgroundColor: color }}
            onClick={(e) => e.stopPropagation()}
            title="Change color"
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" side="right" align="center" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium">{label}</span>
            <input
              type="color"
              value={color}
              onChange={(e) => onColorChange(e.target.value)}
              className="w-32 h-8 cursor-pointer border rounded"
            />
            {/* Quick palette */}
            <div className="flex flex-wrap gap-1">
              {LEVEL_PALETTE.slice(0, 10).map(c => (
                <button
                  key={c}
                  className={cn("h-4 w-4 rounded-full border", c === color && "ring-2 ring-primary ring-offset-1")}
                  style={{ backgroundColor: c }}
                  onClick={() => onColorChange(c)}
                />
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    )}
  </div>
);

export default ViewerFilterPanel;
