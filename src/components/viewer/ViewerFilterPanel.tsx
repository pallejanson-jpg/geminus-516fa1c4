import React, { useState, useEffect, useCallback, useMemo, useContext, useRef } from 'react';
import { ChevronDown, ChevronRight, Search, X, Filter, Paintbrush, Box, MapPin, Eye } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { ANNOTATION_FILTER_EVENT } from '@/lib/viewer-events';
import { useFloorData } from '@/hooks/useFloorData';
import { useModelData } from '@/hooks/useModelData';
import { recolorArchitectObjects } from '@/lib/architect-colors';

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

const CATEGORY_PALETTE: Record<string, string> = {
  'Wall': '#607D8B', 'Door': '#8D6E63', 'Window': '#B0B0A8',
  'Slab': '#90A4AE', 'Roof': '#FF7043', 'Stair': '#AB47BC',
  'Column': '#78909C', 'Beam': '#A1887F', 'Covering': '#CE93D8',
  'Railing': '#FFB74D', 'Curtain Wall': '#4DD0E1', 'Space': '#E5E4E3',
  'Furnishing': '#81C784', 'Flow Terminal': '#4DB6AC', 'Flow Segment': '#4DD0E1',
  'Flow Fitting': '#7986CB', 'Flow Controller': '#9575CD',
  'Pipe': '#26A69A', 'Duct': '#66BB6A', 'Member': '#BDBDBD', 'Proxy': '#E0E0E0',
};

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

const normalizeGuid = (value?: string | null): string =>
  (value || '').toLowerCase().replace(/-/g, '');

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

  // ── Shared hooks for consistent data ─────────────────────────────────
  const { floors: sharedFloors } = useFloorData(viewerRef, buildingFmGuid);
  const { models: sharedModels, applyModelVisibility, assetPlusSources: apSources } = useModelData(viewerRef, buildingFmGuid);

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

  // Per-level, per-space and per-category colors
  const [levelColors, setLevelColors] = useState<Map<string, string>>(new Map());
  const [spaceColors, setSpaceColors] = useState<Map<string, string>>(new Map());
  const [categoryColors, setCategoryColors] = useState<Map<string, string>>(new Map());
  const [autoColorEnabled, setAutoColorEnabled] = useState(false);
  const [autoColorSpaces, setAutoColorSpaces] = useState(false);
  const [autoColorCategories, setAutoColorCategories] = useState(false);
  const [xrayMode, setXrayMode] = useState(false);

  // Annotations state
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [checkedAnnotations, setCheckedAnnotations] = useState<Set<string>>(new Set());
  const [annotationCategories, setAnnotationCategories] = useState<Array<{ category: string; count: number; color: string }>>([]);
  // Cache: level fmGuid → xeokit entity IDs (built once when viewer ready)
  const entityMapRef = useRef<Map<string, string[]>>(new Map());
  const entityMapBuilt = useRef(false);

  // Cache: IfcSpace IDs with name "Area" to auto-hide
  const areaSpaceIdsRef = useRef<string[]>([]);

  // ── Derived data from Asset+ ────────────────────────────────────────────

  const buildingData = useMemo(() => {
    if (!allData || !buildingFmGuid) return [];
    return allData.filter((a: any) =>
      (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid
    );
  }, [allData, buildingFmGuid]);

  // Sources: derived from shared useModelData hook (consistent with Visningsmeny)
  const sources: BimSource[] = useMemo(() => {
    // Build from Asset+ sources map (same data, but guaranteed consistent naming)
    return Array.from(apSources.entries())
      .map(([guid, name]) => {
        // Count storeys belonging to this source
        const storeyCount = buildingData.filter((a: any) => {
          const attrs = a.attributes || {};
          return (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey') &&
            attrs.parentBimObjectId === guid;
        }).length;
        return { guid, name, storeyCount };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }, [apSources, buildingData]);

  // Levels: derived from shared useFloorData hook (consistent naming with Visningsmeny)
  const levels: LevelItem[] = useMemo(() => {
    return sharedFloors.map(floor => {
      // Find matching Asset+ storey for sourceGuid
      const matchingAsset = buildingData.find((a: any) => {
        const fmGuid = (a.fmGuid || a.fm_guid || '').toLowerCase();
        return (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey') &&
          floor.databaseLevelFmGuids.some(g => g.toLowerCase() === fmGuid);
      });
      const sourceGuid = matchingAsset?.attributes?.parentBimObjectId || '';
      const fmGuid = floor.databaseLevelFmGuids[0] || floor.id;
      const spaceCount = buildingData.filter((s: any) =>
        (s.category === 'Space' || s.category === 'IfcSpace') &&
        floor.databaseLevelFmGuids.includes(s.levelFmGuid || s.level_fm_guid)
      ).length;
      return { fmGuid, name: floor.name, sourceGuid, spaceCount };
    }).sort((a, b) => {
      const extract = (n: string) => { const m = n.match(/(-?\d+)/); return m ? parseInt(m[1], 10) : 0; };
      return extract(a.name) - extract(b.name);
    });
  }, [sharedFloors, buildingData]);




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
      .filter((s: SpaceItem) => s.name && s.name !== 'Unnamed')
      .sort((a: SpaceItem, b: SpaceItem) => a.name.localeCompare(b.name, 'sv', { numeric: true }));
  }, [buildingData, checkedLevels, levels]);

  // Auto-assign palette colors to levels
  useEffect(() => {
    const colors = new Map<string, string>();
    levels.forEach((level, idx) => {
      colors.set(level.fmGuid, LEVEL_PALETTE[idx % LEVEL_PALETTE.length]);
    });
    setLevelColors(colors);
  }, [levels]);

  // (Category colors useEffect moved below categories declaration)

  // ── XEOKit accessor ─────────────────────────────────────────────────────

  const getXeokitViewer = useCallback(() => {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }, [viewerRef]);

  // Categories: derived from xeokit metaScene IFC types, filtered by selected floor/space
  const categories: CategoryItem[] = useMemo(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects) return [];

    // Build reverse map: IFC type → human-readable category name
    const ifcTypeToCategory = new Map<string, string>();
    const mappings: Record<string, string[]> = {
      'Wall': ['IfcWall', 'IfcWallStandardCase'],
      'Door': ['IfcDoor'],
      'Window': ['IfcWindow'],
      'Slab': ['IfcSlab', 'IfcSlabStandardCase'],
      'Roof': ['IfcRoof'],
      'Stair': ['IfcStairFlight', 'IfcStair'],
      'Column': ['IfcColumn'],
      'Beam': ['IfcBeam'],
      'Covering': ['IfcCovering'],
      'Railing': ['IfcRailing'],
      'Curtain Wall': ['IfcCurtainWall', 'IfcPlate'],
      'Space': ['IfcSpace'],
      'Building Storey': ['IfcBuildingStorey'],
      'Furnishing': ['IfcFurnishingElement'],
      'Flow Terminal': ['IfcFlowTerminal'],
      'Flow Segment': ['IfcFlowSegment'],
      'Flow Fitting': ['IfcFlowFitting'],
      'Flow Controller': ['IfcFlowController'],
      'Pipe': ['IfcPipeSegment', 'IfcPipeFitting'],
      'Duct': ['IfcDuctSegment', 'IfcDuctFitting'],
      'Member': ['IfcMember'],
      'Proxy': ['IfcBuildingElementProxy'],
    };
    for (const [cat, types] of Object.entries(mappings)) {
      types.forEach(t => ifcTypeToCategory.set(t, cat));
    }

    // Determine which entity IDs are in scope based on level/space filters
    const eMap = entityMapRef.current;
    let scopeIds: Set<string> | null = null;
    if (checkedSpaces.size > 0) {
      scopeIds = new Set<string>();
      checkedSpaces.forEach(fmGuid => {
        eMap.get(fmGuid)?.forEach(id => scopeIds!.add(id));
      });
    } else if (checkedLevels.size > 0) {
      scopeIds = new Set<string>();
      checkedLevels.forEach(fmGuid => {
        eMap.get(fmGuid)?.forEach(id => scopeIds!.add(id));
      });
    }

    // Count entities per category from metaScene (filtered to scope)
    const counts = new Map<string, number>();
    Object.values(viewer.metaScene.metaObjects).forEach((mo: any) => {
      if (!mo.type) return;
      // If scope filter is active, only count entities within scope
      if (scopeIds && !scopeIds.has(mo.id)) return;
      const cat = ifcTypeToCategory.get(mo.type) || mo.type.replace(/^Ifc/, '');
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });

    // Remove non-useful categories (they have their own sections)
    counts.delete('Building');
    counts.delete('Project');
    counts.delete('Site');
    counts.delete('Building Storey');
    counts.delete('Space');

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .filter(c => c.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [getXeokitViewer, isVisible, checkedLevels, checkedSpaces]);

  // Auto-assign palette colors to categories (must be after categories declaration)
  useEffect(() => {
    const colors = new Map<string, string>();
    categories.forEach((cat, idx) => {
      colors.set(cat.name, CATEGORY_PALETTE[cat.name] || LEVEL_PALETTE[idx % LEVEL_PALETTE.length]);
    });
    setCategoryColors(colors);
  }, [categories]);

  // ── Build entity ID map (fmGuid → xeokit IDs) ─────────────────────────

  const buildEntityMap = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return false;

    const metaObjects = viewer.metaScene.metaObjects;
    const map = new Map<string, string[]>();

    // Step 1: Collect ALL IfcBuildingStorey and IfcSpace from xeokit metaScene
    // Also track which model each storey belongs to, to prefer A-model storeys
    const sceneModels = viewer.scene.models || {};
    const entityToModelId = new Map<string, string>();
    // Method 1: scene model objects (works in Asset+ wrapper)
    Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
      const objs = model.objects || model.entityList || {};
      if (typeof objs === 'object' && objs !== null) {
        // Handle both Map-like and array-like structures
        const keys = Array.isArray(objs) ? objs.map((e: any) => e.id).filter(Boolean) : Object.keys(objs);
        keys.forEach((objId: string) => entityToModelId.set(objId, modelId));
      }
    });

    // Method 2 (fallback): use metaObject.metaModel.id (native xeokit)
    if (entityToModelId.size === 0) {
      Object.values(metaObjects).forEach((mo: any) => {
        const modelId = mo.metaModel?.id;
        if (modelId) entityToModelId.set(mo.id, modelId);
      });
      if (entityToModelId.size > 0) {
        console.log(`[FilterPanel] entityToModelId built from metaModel fallback: ${entityToModelId.size} entries`);
      }
    }

    // Detect A-model IDs (name starts with 'A' or contains 'arkitekt')
    const aModelSceneIds = new Set<string>();
    if (sharedModels.length > 0) {
      sharedModels.forEach(m => {
        const n = m.name.toLowerCase();
        if (n.startsWith('a') || n.includes('a-modell') || n.includes('arkitekt')) {
          aModelSceneIds.add(m.id);
        }
      });
    }

    // Also add model IDs from scene that we know are A-models (by matching name)
    if (aModelSceneIds.size === 0) {
      // If sharedModels hasn't resolved names yet, try all scene model IDs
      // since we only load A-models in native viewer
      const sceneModelIds = Object.keys(sceneModels);
      if (sceneModelIds.length > 0) {
        console.log(`[FilterPanel] No A-models from sharedModels, treating all ${sceneModelIds.length} scene models as A-models`);
        sceneModelIds.forEach(id => aModelSceneIds.add(id));
      }
    }

    const xeokitStoreys: { id: string; sysId: string; name: string; modelId: string }[] = [];
    const xeokitSpaces: { id: string; sysId: string; name: string }[] = [];
    const areaSpaceIds: string[] = [];

    Object.values(metaObjects).forEach((mo: any) => {
      const type = (mo.type || '').toLowerCase();
      if (type === 'ifcbuildingstorey') {
        xeokitStoreys.push({
          id: mo.id,
          sysId: (mo.originalSystemId || mo.id || ''),
          name: (mo.name || ''),
          modelId: entityToModelId.get(mo.id) || mo.metaModel?.id || '',
        });
      } else if (type === 'ifcspace') {
        xeokitSpaces.push({
          id: mo.id,
          sysId: (mo.originalSystemId || mo.id || ''),
          name: (mo.name || ''),
        });
        // Detect "Area" spaces that cover entire floors
        const spaceName = (mo.name || '').trim().toLowerCase();
        if (spaceName === 'area' || spaceName.startsWith('area ') || spaceName.startsWith('area:')) {
          areaSpaceIds.push(mo.id);
        }
      }
    });

    // Store area space IDs for auto-hiding
    areaSpaceIdsRef.current = areaSpaceIds;
    if (areaSpaceIds.length > 0) {
      console.log(`[FilterPanel] Found ${areaSpaceIds.length} "Area" spaces to auto-hide`);
    }

    if (xeokitStoreys.length === 0) {
      console.warn('[FilterPanel] No IfcBuildingStorey found in metaScene');
      return false;
    }

    // Step 2: Match Asset+ levels → xeokit storeys (try sysId first, then name)
    // IMPORTANT: Only map storeys from A-model by default.
    // Only include non-A storeys when that specific source is explicitly checked.
    // Sort storeys: A-model first, then others
    const sortedStoreys = [...xeokitStoreys].sort((a, b) => {
      const aIsA = aModelSceneIds.has(a.modelId) ? 0 : 1;
      const bIsA = aModelSceneIds.has(b.modelId) ? 0 : 1;
      return aIsA - bIsA;
    });

    const checkedNonASourceGuids = new Set<string>();
    sources.forEach(s => {
      if (checkedSources.has(s.guid)) {
        const n = s.name.toLowerCase();
        if (!n.startsWith('a') && !n.includes('a-modell') && !n.includes('arkitekt')) {
          checkedNonASourceGuids.add(s.guid);
        }
      }
    });

    // Filter storeys: A-model always, non-A only if explicitly checked
    // Fallback: if no storey has a recognized model ID, include ALL storeys
    const hasAnyModelMapping = sortedStoreys.some(xs => xs.modelId !== '');
    const eligibleStoreys = sortedStoreys.filter(xs => {
      // If we couldn't map any storey to a model, include everything
      if (!hasAnyModelMapping) return true;
      if (aModelSceneIds.has(xs.modelId)) return true;
      // If modelId is empty (couldn't resolve), include as fallback
      if (xs.modelId === '') return true;
      // Non-A storey: only include if that source is explicitly checked
      if (checkedNonASourceGuids.size === 0) return false;
      const matchModel = sharedModels.find(m => m.id === xs.modelId);
      if (!matchModel) return false;
      const matchSource = sources.find(s => s.name === matchModel.name);
      return matchSource && checkedNonASourceGuids.has(matchSource.guid);
    });

    const usedStoreyIds = new Set<string>();
    levels.forEach(level => {
      const fmLower = level.fmGuid.toLowerCase();
      const nameLower = level.name.toLowerCase().trim();

      let matched = eligibleStoreys.find(xs =>
        !usedStoreyIds.has(xs.id) && xs.sysId.toLowerCase() === fmLower
      );
      if (!matched) matched = eligibleStoreys.find(xs =>
        !usedStoreyIds.has(xs.id) &&
        xs.sysId.toLowerCase().replace(/-/g, '') === fmLower.replace(/-/g, '')
      );
      if (!matched) matched = eligibleStoreys.find(xs =>
        !usedStoreyIds.has(xs.id) && xs.name.toLowerCase().trim() === nameLower
      );
      // Fuzzy name: contains match
      if (!matched) matched = eligibleStoreys.find(xs =>
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

    // Step 3: Match Asset+ spaces → xeokit spaces (use cached ref)
    const usedSpaceIds = new Set<string>();
    spacesRef.current.forEach(space => {
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
    const sceneModels2 = viewer.scene.models || {};
    Object.entries(sceneModels2).forEach(([modelId, model]: [string, any]) => {
      // Get object keys: try model.objects, entityList, or fallback to entityToModelId
      let modelObjKeys: string[] = [];
      const objs = model.objects || model.entityList;
      if (objs && typeof objs === 'object') {
        modelObjKeys = Array.isArray(objs) ? objs.map((e: any) => e.id).filter(Boolean) : Object.keys(objs);
      }
      // Fallback: collect from entityToModelId
      if (modelObjKeys.length === 0) {
        entityToModelId.forEach((mId, objId) => { if (mId === modelId) modelObjKeys.push(objId); });
      }
      for (const objId of modelObjKeys) {
        const mo = metaObjects[objId];
        if (mo?.type === 'IfcBuildingStorey') {
          const sysId = (mo.originalSystemId || '').toLowerCase();
          const moName = (mo.name || '').toLowerCase().trim();
          const matchedLevel = levels.find(l =>
            l.fmGuid.toLowerCase() === sysId ||
            l.fmGuid.toLowerCase().replace(/-/g, '') === sysId.replace(/-/g, '') ||
            l.name.toLowerCase().trim() === moName
          );
          if (matchedLevel) {
            const sourceKey = `source::${matchedLevel.sourceGuid}`;
            const existing = map.get(sourceKey) || [];
            map.set(sourceKey, [...existing, ...modelObjKeys]);
          }
          break;
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
  }, [getXeokitViewer, levels, sharedModels, checkedSources, sources]);

  // Cached spaces ref for entity map (avoids rebuild on checkbox toggle)
  const spacesRef = useRef(spaces);
  useEffect(() => { spacesRef.current = spaces; }, [spaces]);

  // Build map when viewer is ready (only depends on levels, not spaces via checkbox)
  useEffect(() => {
    if (!isVisible) return;
    entityMapBuilt.current = false;
    if (buildEntityMap()) return;
    let attempts = 0;
    const interval = setInterval(() => {
      if (buildEntityMap() || attempts++ > 10) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [isVisible, buildEntityMap]);

  // ── Fetch annotation categories (non-modeled assets + issues) ────────────
  useEffect(() => {
    if (!isVisible || !buildingFmGuid) return;
    const fetchAnnotations = async () => {
      const { data: assets } = await supabase
        .from('assets')
        .select('asset_type, symbol_id')
        .eq('building_fm_guid', buildingFmGuid)
        .or('created_in_model.eq.false,asset_type.eq.IfcAlarm');

      // Also fetch issue count for this building
      const { count: issueCount } = await supabase
        .from('bcf_issues')
        .select('id', { count: 'exact', head: true })
        .eq('building_fm_guid', buildingFmGuid)
        .in('status', ['open', 'in_progress'])
        .not('viewpoint_json', 'is', null);

      const categories: Array<{ category: string; count: number; color: string }> = [];

      if (assets && assets.length > 0) {
        const { data: symbols } = await supabase
          .from('annotation_symbols')
          .select('id, color, category');
        const symbolMap = new Map(symbols?.map(s => [s.id, s]) || []);

        const groups = new Map<string, { count: number; color: string }>();
        assets.forEach(a => {
          const cat = a.asset_type || 'Other';
          const existing = groups.get(cat);
          const sym = a.symbol_id ? symbolMap.get(a.symbol_id) : null;
          const color = sym?.color || '#3B82F6';
          if (existing) { existing.count++; }
          else { groups.set(cat, { count: 1, color }); }
        });

        groups.forEach((val, key) => categories.push({ category: key, count: val.count, color: val.color }));
      }

      // Add Issues category
      if (issueCount && issueCount > 0) {
        categories.push({ category: 'Issues', count: issueCount, color: '#EF4444' });
      }

      setAnnotationCategories(
        categories.sort((a, b) => b.count - a.count)
      );
    };
    fetchAnnotations();
  }, [isVisible, buildingFmGuid]);

  // Dispatch annotation filter event when checked annotations change
  useEffect(() => {
    // Always dispatch - empty means show none when filter was explicitly used
    window.dispatchEvent(new CustomEvent(ANNOTATION_FILTER_EVENT, {
      detail: { visibleCategories: Array.from(checkedAnnotations) },
    }));
  }, [checkedAnnotations]);

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

  const rafRef = useRef<number>(0);
  const applyFilterVisibility = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;
    const eMap = entityMapRef.current;

    const hasAnyFilter = checkedSources.size > 0 || checkedLevels.size > 0 ||
      checkedSpaces.size > 0 || checkedCategories.size > 0;

    // Step 0: Clean slate — reset visibility, xray, colorize, opacity, pickable
    scene.setObjectsVisible(scene.objectIds, true);
    scene.setObjectsPickable(scene.objectIds, true);
    const prevXrayed = scene.xrayedObjectIds;
    if (prevXrayed?.length > 0) scene.setObjectsXRayed(prevXrayed, false);
    const prevColorized = scene.colorizedObjectIds;
    if (prevColorized?.length > 0) scene.setObjectsColorized(prevColorized, false);
    // Reset opacity for any previously transparent slabs (batch operation)
    const resetOpacityIds = scene.objectIds.filter((id: string) => {
      const entity = scene.objects?.[id];
      return entity && entity.opacity < 1;
    });
    resetOpacityIds.forEach((id: string) => {
      const entity = scene.objects?.[id];
      if (entity) entity.opacity = 1.0;
    });

    // Re-apply architect color palette as base layer after clean slate
    // This prevents raw XKT colors (red rooms, blue windows) from showing
    recolorArchitectObjects(viewer);

    // Step 0b: Always hide ALL IfcSpace entities after clean slate (prevent red rooms)
    // They should only become visible when explicitly enabled via "Visa rum" or space filter
    if (viewer.metaScene?.metaObjects) {
      Object.values(viewer.metaScene.metaObjects).forEach((mo: any) => {
        const ifcType = (mo.type || '').toLowerCase();
        if (ifcType === 'ifcspace' || ifcType === 'ifc_space') {
          const entity = scene.objects?.[mo.id];
          if (entity) { entity.visible = false; entity.pickable = false; }
        }
      });
    }

    // Step 1: Apply auto-colors per section (only when each section's brush is enabled)
    if (eMap.size > 0) {
      // Level colors
      if (autoColorEnabled) {
        levels.forEach(level => {
          const color = levelColors.get(level.fmGuid);
          const entityIds = eMap.get(level.fmGuid);
          if (color && entityIds) {
            const rgb = hexToRgb01(color);
            entityIds.forEach(id => {
              const entity = scene.objects?.[id];
              if (entity) entity.colorize = rgb;
            });
          }
        });
      }

      // Space colors
      if (autoColorSpaces) {
        spaces.forEach(space => {
          const color = spaceColors.get(space.fmGuid) || LEVEL_PALETTE[spaces.indexOf(space) % LEVEL_PALETTE.length];
          const rgb = hexToRgb01(color);
          const spaceEntityIds = eMap.get(space.fmGuid);
          spaceEntityIds?.forEach(id => {
            const entity = scene.objects?.[id];
            if (entity) entity.colorize = rgb;
          });
        });
      }

      // Category colors
      if (autoColorCategories && viewer.metaScene?.metaObjects) {
        Object.values(viewer.metaScene.metaObjects).forEach((mo: any) => {
          if (!mo.type) return;
          const catName = mo.type.replace(/^Ifc/, '').replace(/StandardCase$/, '');
          const catColor = categoryColors.get(catName);
          if (catColor) {
            const entity = scene.objects?.[mo.id];
            if (entity) entity.colorize = hexToRgb01(catColor);
          }
        });
      }
    }

    if (!hasAnyFilter) {
      // No filter active: hide all IfcSpace entities by default (don't auto-show spaces)
      if (viewer.metaScene?.metaObjects) {
        Object.values(viewer.metaScene.metaObjects).forEach((mo: any) => {
          if (mo.type === 'IfcSpace') {
            const entity = scene.objects?.[mo.id];
            if (entity) { entity.visible = false; entity.pickable = false; }
          }
        });
      }
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
    // Source filtering: use model-level visibility via shared hook's batch approach
    let sourceIds: Set<string> | null = null;
    if (checkedSources.size > 0) {
      sourceIds = new Set<string>();
      // Collect entity IDs from levels belonging to checked sources
      levels.filter(l => checkedSources.has(l.sourceGuid)).forEach(l => {
        eMap.get(l.fmGuid)?.forEach(id => sourceIds!.add(id));
      });
      // Also collect from source:: keys in entityMap
      checkedSources.forEach(srcGuid => {
        eMap.get(`source::${srcGuid}`)?.forEach(id => sourceIds!.add(id));
      });
      // Also collect from scene models matched to these sources
      const viewer2 = getXeokitViewer();
      const sceneModels = viewer2?.scene?.models || {};
      const metaObjects = viewer2?.metaScene?.metaObjects;
      if (metaObjects) {
        // Try to match scene models to checked sources via sharedModels name matching
        const checkedSourceNames = new Set(
          sources.filter(s => checkedSources.has(s.guid)).map(s => s.name.toLowerCase())
        );
        sharedModels.forEach(sm => {
          if (checkedSourceNames.has(sm.name.toLowerCase())) {
            const sceneModel = sceneModels[sm.id];
            if (sceneModel) {
              // Method 1: model.objects
              const objs = sceneModel.objects || {};
              const objKeys = Array.isArray(objs) ? objs.map((e: any) => e.id).filter(Boolean) : Object.keys(objs);
              objKeys.forEach((id: string) => sourceIds!.add(id));
              // Method 2: metaModel fallback
              if (objKeys.length === 0 && metaObjects) {
                Object.values(metaObjects).forEach((mo: any) => {
                  if (mo.metaModel?.id === sm.id) sourceIds!.add(mo.id);
                });
              }
            }
          }
        });
        // Fallback: if sourceIds still empty, try direct model objects scan
        if (sourceIds.size === 0) {
          Object.entries(sceneModels).forEach(([, model]: [string, any]) => {
            const objKeys = Object.keys(model.objects || {});
            for (const objId of objKeys) {
              const mo = metaObjects[objId];
              if (mo?.type === 'IfcBuildingStorey') {
                const sysId = (mo.originalSystemId || '').toLowerCase();
                const matchedLevel = levels.find(l =>
                  l.fmGuid.toLowerCase() === sysId ||
                  l.fmGuid.toLowerCase().replace(/-/g, '') === sysId.replace(/-/g, '')
                );
                if (matchedLevel && checkedSources.has(matchedLevel.sourceGuid)) {
                  objKeys.forEach(id => sourceIds!.add(id));
                }
                break;
              }
            }
          });
        }
      }
      // Safety: if source filter is active but produced no IDs, don't hide everything —
      // fall back to showing all scene objects (prevents "everything disappears" bug)
      if (sourceIds.size === 0) {
        console.warn('[FilterPanel] Source filter produced 0 IDs — falling back to all objects');
        sourceIds = null;
      }
    }

    let levelIds: Set<string> | null = null;
    if (checkedLevels.size > 0) {
      levelIds = new Set<string>();
      checkedLevels.forEach(fmGuid => {
        eMap.get(fmGuid)?.forEach(id => levelIds!.add(id));
      });
    }

    // Space filtering: collect space-only IDs AND parent level context separately
    let spaceAndContextIds: Set<string> | null = null;
    let spaceOnlyEntityIds: Set<string> | null = null; // Only the IfcSpace entity IDs, for highlighting
    if (checkedSpaces.size > 0) {
      spaceAndContextIds = new Set<string>();
      spaceOnlyEntityIds = new Set<string>();
      // Add the space entities themselves
      checkedSpaces.forEach(fmGuid => {
        const ids = eMap.get(fmGuid);
        if (ids) {
          ids.forEach(id => {
            spaceAndContextIds!.add(id);
            spaceOnlyEntityIds!.add(id);
          });
        }
      });
      // ALSO add all entities from parent levels so context (walls, doors, etc.) stays visible
      const parentLevelGuids = new Set<string>();
      spacesRef.current.forEach(space => {
        if (checkedSpaces.has(space.fmGuid) && space.levelFmGuid) {
          parentLevelGuids.add(space.levelFmGuid);
        }
      });
      parentLevelGuids.forEach(levelGuid => {
        eMap.get(levelGuid)?.forEach(id => spaceAndContextIds!.add(id));
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
    // When spaces are checked, skip levelIds from intersection (spaces already include their parent level)
    const filterSets = [sourceIds, checkedSpaces.size > 0 ? null : levelIds, spaceAndContextIds, categoryIds].filter((s): s is Set<string> => s !== null);
    let solidIds: Set<string>;
    if (filterSets.length === 0) {
      solidIds = new Set(scene.objectIds);
    } else if (filterSets.length === 1) {
      solidIds = filterSets[0];
    } else {
      const sorted = [...filterSets].sort((a, b) => a.size - b.size);
      solidIds = new Set<string>();
      for (const id of sorted[0]) {
        if (sorted.every(s => s.has(id))) solidIds.add(id);
      }
    }

    // Step 2b: Handle IfcSpace and IfcSlab visibility
    const fadeIds: string[] = [];   // IfcSlab — semi-transparent + unpickable
    const hideIds: string[] = []; // IfcRoof/IfcCovering — hide entirely
    const obstructTypes = new Set(['IfcRoof', 'IfcCovering']);
    const slabTypes = new Set(['IfcSlab', 'IfcSlabStandardCase', 'IfcPlate']);
    // Collect ALL slab IDs from metaScene for floor visibility
    const allSlabIds: string[] = [];
    // Track which area space IDs to ensure they stay hidden
    const areaSet = new Set(areaSpaceIdsRef.current);

    if (viewer.metaScene?.metaObjects) {
      // First pass: collect all slabs in the scene for floor visibility
      Object.values(viewer.metaScene.metaObjects).forEach((mo: any) => {
        if (slabTypes.has(mo.type)) {
          allSlabIds.push(mo.id);
        }
      });

      for (const id of solidIds) {
        const mo = viewer.metaScene.metaObjects[id];
        if (mo) {
          if (obstructTypes.has(mo.type)) { 
            hideIds.push(id); 
            solidIds.delete(id); 
          } else if (slabTypes.has(mo.type)) { 
            fadeIds.push(id); 
            solidIds.delete(id); 
          } else if (mo.type === 'IfcSpace') {
            // Always remove IfcSpace from solidIds — they should not be "solid"
            // If this space is a checked space, it will be highlighted separately
            // If it's an "Area" space, it stays hidden
            if (areaSet.has(id)) {
              hideIds.push(id);
            }
            solidIds.delete(id);
          }
        }
      }

      // Add slabs from active levels that weren't already in solidIds
      if (checkedLevels.size > 0 && levelIds) {
        allSlabIds.forEach(slabId => {
          if (!fadeIds.includes(slabId) && !solidIds.has(slabId)) {
            const slabMo = viewer.metaScene.metaObjects[slabId];
            if (slabMo) {
              let parent = slabMo.parent;
              while (parent) {
                if (parent.type?.toLowerCase() === 'ifcbuildingstorey') {
                  const parentGuid = (parent.originalSystemId || parent.id || '').toLowerCase();
                  const isVisible = Array.from(checkedLevels).some(lg => lg.toLowerCase() === parentGuid || lg.toLowerCase().replace(/-/g, '') === parentGuid.replace(/-/g, ''));
                  if (isVisible) fadeIds.push(slabId);
                  break;
                }
                parent = parent.parent ? viewer.metaScene.metaObjects[parent.parent.id || parent.parent] : null;
              }
            }
          }
        });
      }
    }

    // Step 3: Apply visibility or X-ray for non-solid objects
    const nonSolidIds = scene.objectIds.filter((id: string) => !solidIds.has(id));
    if (xrayMode) {
      const xrayMat = scene.xrayMaterial;
      if (xrayMat) {
        xrayMat.fill = true;
        xrayMat.fillAlpha = 0.12;
        xrayMat.fillColor = [0.55, 0.55, 0.6];
        xrayMat.edges = true;
        xrayMat.edgeAlpha = 0.3;
        xrayMat.edgeColor = [0.4, 0.4, 0.45];
      }
      if (nonSolidIds.length > 0) scene.setObjectsXRayed(nonSolidIds, true);
      if (solidIds.size > 0) scene.setObjectsXRayed([...solidIds], false);
    } else {
      if (nonSolidIds.length > 0) scene.setObjectsVisible(nonSolidIds, false);
    }

    // Step 3b: Hide obstructions, make slabs semi-transparent
    if (hideIds.length > 0) scene.setObjectsVisible(hideIds, false);
    fadeIds.forEach(id => {
      const entity = scene.objects?.[id];
      if (entity) { entity.visible = true; entity.opacity = 0.3; entity.pickable = false; }
    });

    // Step 4: Handle checked spaces — show room solid in 3D while context is x-rayed
    if (checkedSpaces.size > 0 && spaceOnlyEntityIds && spaceOnlyEntityIds.size > 0) {
      // X-ray the context (parent level entities minus the space entities)
      if (spaceAndContextIds) {
        const contextOnlyIds = [...spaceAndContextIds].filter(id => !spaceOnlyEntityIds!.has(id));
        if (contextOnlyIds.length > 0) {
          const xrayMat = scene.xrayMaterial;
          if (xrayMat) {
            xrayMat.fill = true;
            xrayMat.fillAlpha = 0.15;
            xrayMat.fillColor = [0.55, 0.55, 0.6];
            xrayMat.edges = true;
            xrayMat.edgeAlpha = 0.35;
            xrayMat.edgeColor = [0.4, 0.4, 0.45];
          }
          scene.setObjectsXRayed(contextOnlyIds, true);
        }
      }
      // Show the selected space solid with natural colors (or user-picked color)
      spaceOnlyEntityIds.forEach(id => {
        if (areaSet.has(id)) return; // Never show area spaces
        const entity = scene.objects?.[id];
        if (entity) {
          entity.visible = true;
          entity.pickable = true;
          entity.xrayed = false;
          entity.opacity = 0.7;
          // Only colorize if user has explicitly set a color for this space
          // Find the space fmGuid for this entity id
          let hasCustomColor = false;
          if (autoColorSpaces) {
            for (const [spaceFmGuid, color] of spaceColors.entries()) {
              if (checkedSpaces.has(spaceFmGuid)) {
                const spaceIds = eMap.get(spaceFmGuid);
                if (spaceIds?.includes(id)) {
                  entity.colorize = hexToRgb01(color);
                  hasCustomColor = true;
                  break;
                }
              }
            }
            // If auto-color enabled but no custom color, use palette
            if (!hasCustomColor) {
              for (const space of spaces) {
                if (checkedSpaces.has(space.fmGuid)) {
                  const spaceIds = eMap.get(space.fmGuid);
                  if (spaceIds?.includes(id)) {
                    const color = LEVEL_PALETTE[spaces.indexOf(space) % LEVEL_PALETTE.length];
                    entity.colorize = hexToRgb01(color);
                    hasCustomColor = true;
                    break;
                  }
                }
              }
            }
          }
          // If no custom color, keep natural colors (don't colorize)
          if (!hasCustomColor) {
            entity.colorize = null;
          }
        }
      });
    }

    // Step 5: Ensure "Area" spaces stay hidden always
    areaSpaceIdsRef.current.forEach(id => {
      const entity = scene.objects?.[id];
      if (entity) { entity.visible = false; entity.pickable = false; }
    });

    // Step 6: Floor/space visibility event for labels and clipping
    const visibleFmGuids: string[] = [];
    if (checkedSpaces.size > 0) {
      const parentLevelGuids = new Set<string>();
      spacesRef.current.forEach(space => {
        if (checkedSpaces.has(space.fmGuid) && space.levelFmGuid) {
          parentLevelGuids.add(space.levelFmGuid);
        }
      });
      parentLevelGuids.forEach(g => visibleFmGuids.push(g));
    } else if (checkedLevels.size > 0) {
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
        isSoloFloor: visibleFmGuids.length === 1,
      } as FloorSelectionEventDetail,
    }));

    console.debug('[FilterPanel] Applied filter. solidIds:', solidIds.size, '/', scene.objectIds.length);
    }); // end requestAnimationFrame
  }, [getXeokitViewer, checkedSources, checkedLevels, checkedSpaces, checkedCategories,
    levels, spaces, categoryToIfcTypes, levelColors, spaceColors, categoryColors, autoColorEnabled, autoColorSpaces, autoColorCategories, xrayMode]);

  // Apply whenever filters or colors change
  useEffect(() => {
    if (!isVisible) return;
    applyFilterVisibility();
  }, [checkedSources, checkedLevels, checkedSpaces, checkedCategories,
    levelColors, spaceColors, categoryColors, autoColorEnabled, autoColorSpaces, autoColorCategories, applyFilterVisibility, isVisible]);

  // Cleanup when panel closes: reset viewer state
  useEffect(() => {
    if (isVisible) return;
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;
    if (scene.xrayedObjectIds?.length > 0) scene.setObjectsXRayed(scene.xrayedObjectIds, false);
    if (scene.colorizedObjectIds?.length > 0) scene.setObjectsColorized(scene.colorizedObjectIds, false);
    scene.setObjectsVisible(scene.objectIds, true);
    scene.setObjectsPickable(scene.objectIds, true);
    scene.objectIds.forEach((id: string) => {
      const entity = scene.objects?.[id];
      if (entity && entity.opacity < 1) entity.opacity = 1.0;
    });
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

  const handleResetSection = useCallback((section: 'sources' | 'levels' | 'spaces' | 'categories' | 'annotations') => {
    switch (section) {
      case 'sources': setCheckedSources(new Set()); break;
      case 'levels': setCheckedLevels(new Set()); break;
      case 'spaces': setCheckedSpaces(new Set()); break;
      case 'categories': setCheckedCategories(new Set()); break;
      case 'annotations': 
        setCheckedAnnotations(new Set());
        window.dispatchEvent(new CustomEvent(ANNOTATION_FILTER_EVENT, { detail: { visibleCategories: [] } }));
        break;
    }
  }, []);

  const handleResetAll = useCallback(() => {
    setCheckedSources(new Set());
    setCheckedLevels(new Set());
    setCheckedSpaces(new Set());
    setCheckedCategories(new Set());
    setCheckedAnnotations(new Set());
    window.dispatchEvent(new CustomEvent(ANNOTATION_FILTER_EVENT, { detail: { visibleCategories: [] } }));
  }, []);

  const handleAnnotationToggle = useCallback((category: string, checked: boolean) => {
    setCheckedAnnotations(prev => {
      const n = new Set(prev);
      checked ? n.add(category) : n.delete(category);
      return n;
    });
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

  const totalFilters = checkedSources.size + checkedLevels.size + checkedSpaces.size + checkedCategories.size + checkedAnnotations.size;

  if (!isVisible) return null;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "fixed left-0 top-0 bottom-0 z-40 w-[85%] max-w-[320px] sm:w-[320px]",
        "bg-card/95 backdrop-blur-xl border-r shadow-2xl text-foreground",
        "flex flex-col",
        "animate-in slide-in-from-left duration-200"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Filter</span>
          {totalFilters > 0 && (
            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5">{totalFilters}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Show All button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2 gap-1 text-foreground"
            onClick={handleResetAll}
            title="Show all objects"
          >
            <Eye className="h-3.5 w-3.5" />
            Show all
          </Button>
          <Button
            variant={xrayMode ? "default" : "ghost"}
            size="icon"
            className={cn("h-7 w-7", xrayMode && "bg-primary text-primary-foreground")}
            onClick={() => setXrayMode(!xrayMode)}
            title={xrayMode ? "X-ray on (click to hide)" : "Show X-ray"}
          >
            <Box className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground bg-background shadow-md relative z-50" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClose(); }} title="Close filter panel">
            <X className="h-5 w-5" />
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
              <p className="text-sm text-muted-foreground px-3 py-2">No sources found</p>
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
                className={cn("h-6 w-6", autoColorEnabled ? "text-primary" : "text-muted-foreground")}
                title={autoColorEnabled ? "Disable auto colors" : "Enable auto colors"}
                onClick={(e) => { e.stopPropagation(); setAutoColorEnabled(!autoColorEnabled); }}
              >
                <Paintbrush className="h-3.5 w-3.5" />
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
            rightAction={
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-6 w-6", autoColorSpaces ? "text-primary" : "text-muted-foreground")}
                title={autoColorSpaces ? "Disable space colors" : "Enable space colors"}
                onClick={(e) => { e.stopPropagation(); setAutoColorSpaces(!autoColorSpaces); }}
              >
                <Paintbrush className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {filteredSpaces.slice(0, 200).map(space => (
              <FilterRow
                key={space.fmGuid}
                label={space.name}
                checked={checkedSpaces.has(space.fmGuid)}
                onCheckedChange={(checked) => handleSpaceToggle(space.fmGuid, checked)}
                onClick={() => handleSpaceClick(space.fmGuid)}
                color={autoColorSpaces ? (spaceColors.get(space.fmGuid) || LEVEL_PALETTE[spaces.indexOf(space) % LEVEL_PALETTE.length]) : undefined}
                onColorChange={autoColorSpaces ? (c) => setSpaceColors(prev => new Map(prev).set(space.fmGuid, c)) : undefined}
              />
            ))}
            {filteredSpaces.length > 200 && (
              <p className="text-sm text-muted-foreground px-3 py-1">
                Showing 200 of {filteredSpaces.length} spaces
              </p>
            )}
            {filteredSpaces.length === 0 && (
              <p className="text-sm text-muted-foreground px-3 py-2">
                {spacesSearch ? 'No match' : 'No spaces on selected level'}
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
            rightAction={
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-6 w-6", autoColorCategories ? "text-primary" : "text-muted-foreground")}
                title={autoColorCategories ? "Disable category colors" : "Enable category colors"}
                onClick={(e) => { e.stopPropagation(); setAutoColorCategories(!autoColorCategories); }}
              >
                <Paintbrush className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {categories.map(cat => (
              <FilterRow
                key={cat.name}
                label={cat.name}
                badge={`${cat.count}`}
                checked={checkedCategories.has(cat.name)}
                onCheckedChange={(checked) => handleCategoryToggle(cat.name, checked)}
                color={autoColorCategories ? (categoryColors.get(cat.name) || LEVEL_PALETTE[categories.indexOf(cat) % LEVEL_PALETTE.length]) : undefined}
                onColorChange={autoColorCategories ? (c) => setCategoryColors(prev => new Map(prev).set(cat.name, c)) : undefined}
              />
            ))}
          </FilterSection>

          {/* Annotations (non-modeled assets) */}
          {annotationCategories.length > 0 && (
            <FilterSection
              title="Annotations"
              count={annotationCategories.reduce((s, c) => s + c.count, 0)}
              selectedCount={checkedAnnotations.size}
              isOpen={annotationsOpen}
              onToggle={() => setAnnotationsOpen(!annotationsOpen)}
              onReset={() => handleResetSection('annotations')}
              rightAction={<MapPin className="h-3.5 w-3.5 text-muted-foreground" />}
            >
              {annotationCategories.map(cat => (
                <div
                  key={cat.category}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/30 transition-colors cursor-pointer"
                >
                  <Checkbox
                    checked={checkedAnnotations.has(cat.category)}
                    className="h-4 w-4 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={(v) => handleAnnotationToggle(cat.category, !!v)}
                  />
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-sm truncate flex-1 text-foreground">{cat.category}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{cat.count}</span>
                </div>
              ))}
            </FilterSection>
          )}
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
      className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-accent/30 transition-colors"
      onClick={onToggle}
    >
      <div className="flex items-center gap-2">
        {isOpen ? <ChevronDown className="h-4 w-4 text-foreground" /> : <ChevronRight className="h-4 w-4 text-foreground" />}
            <span className="text-sm font-semibold uppercase tracking-wider text-foreground">{title}</span>
        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 font-normal">
          {selectedCount > 0 ? `${selectedCount}/${count}` : count}
        </Badge>
      </div>
      <div className="flex items-center gap-1">
        {rightAction}
        {selectedCount > 0 && (
          <button
            className="text-xs text-primary hover:underline"
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
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={searchValue || ''} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search…" className="h-7 pl-7 text-sm" />
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
      "flex items-center gap-2 px-3 py-1.5 hover:bg-accent/30 transition-colors cursor-pointer group",
      dimmed && "opacity-40"
    )}
    onClick={onClick}
  >
    <Checkbox
      checked={checked}
      className="h-4 w-4 shrink-0"
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={(v) => onCheckedChange(!!v)}
    />
    <span className="text-sm truncate flex-1 text-foreground">{label}</span>
    {badge && <span className="text-xs text-muted-foreground shrink-0">{badge}</span>}
    {color && onColorChange && (
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="h-3.5 w-3.5 rounded-full shrink-0 border border-border/50 hover:scale-125 transition-transform"
            style={{ backgroundColor: color }}
            onClick={(e) => e.stopPropagation()}
            title="Change color"
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" side="right" align="center" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <input
              type="color"
              value={color}
              onChange={(e) => onColorChange(e.target.value)}
              className="w-32 h-8 cursor-pointer border rounded"
            />
            <div className="flex flex-wrap gap-1">
              {LEVEL_PALETTE.slice(0, 10).map(c => (
                <button
                  key={c}
                  className={cn("h-5 w-5 rounded-full border", c === color && "ring-2 ring-primary ring-offset-1")}
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
