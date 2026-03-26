import React, { useState, useEffect, useCallback, useMemo, useContext, useRef } from 'react';
import { ChevronDown, ChevronRight, Search, X, Filter, Paintbrush, Box, MapPin, Eye } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, normalizeGuid } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { ANNOTATION_FILTER_EVENT, MODEL_LOAD_REQUESTED_EVENT } from '@/lib/viewer-events';
import { useFloorData, isArchitecturalModel } from '@/hooks/useFloorData';
import { useModelData } from '@/hooks/useModelData';
import { isAModelName, getAModelStoreyGuids } from '@/lib/building-utils';

import { getDescendantIds, hideSpaceAndAreaObjects, calculateFloorBounds } from '@/hooks/useFloorVisibility';
import { applyArchitectColors, recolorArchitectObjects } from '@/lib/architect-colors';
import { VIEWER_THEME_CHANGED_EVENT, VIEWER_THEME_REQUESTED_EVENT } from '@/hooks/useViewerTheme';

/** Safe accessor for scene.objectIds – the getter throws if internal maps are null */
function safeObjectIds(scene: any): string[] {
  try { return scene.objectIds ?? []; } catch { return []; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface BimSource {
  guid: string;
  name: string;
  storeyCount: number;
}

interface LevelItem {
  fmGuid: string;
  /** All known GUIDs for this level (xeokit originalSystemId + Asset+ fm_guid variants) */
  allGuids: string[];
  name: string;
  sourceGuid: string;
  spaceCount: number;
}

interface SpaceItem {
  fmGuid: string;
  name: string;
  designation: string;
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

// ─── IFC type → category mapping (shared) ─────────────────────────────────────

const IFC_TO_CATEGORY: Record<string, string> = {};
const CATEGORY_TO_IFC: Record<string, string[]> = {
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
for (const [cat, types] of Object.entries(CATEGORY_TO_IFC)) {
  types.forEach(t => { IFC_TO_CATEGORY[t] = cat; });
}

const HIGHLIGHT_COLOR: [number, number, number] = [0.25, 0.55, 0.95];

// ─── Component ────────────────────────────────────────────────────────────────

const ViewerFilterPanel: React.FC<ViewerFilterPanelProps> = ({
  viewerRef, buildingFmGuid, isVisible, onClose, onNodeSelect,
}) => {
  const { allData } = useContext(AppContext);

  // ── Shared hooks for consistent data ─────────────────────────────────
  const { floors: sharedFloors } = useFloorData(viewerRef, buildingFmGuid);
  const { models: sharedModels, applyModelVisibility, assetPlusSources: apSources, storeyLookup } = useModelData(viewerRef, buildingFmGuid);
  

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

  // Modification filter state
  const [modificationsOpen, setModificationsOpen] = useState(false);
  const [showMovedAssets, setShowMovedAssets] = useState(false);
  const [showDeletedAssets, setShowDeletedAssets] = useState(false);
  const [modifiedAssets, setModifiedAssets] = useState<Array<{ fm_guid: string; modification_status: string }>>([]);

  // ── Cached scene indices (built ONCE when viewer ready) ─────────────────
  // fmGuid → xeokit entity IDs
  const entityMapRef = useRef<Map<string, string[]>>(new Map());
  const entityMapBuilt = useRef(false);
  // IFC type → entity IDs (for fast category counting)
  const typeIndexRef = useRef<Map<string, string[]>>(new Map());
  // Area space IDs to auto-hide
  const areaSpaceIdsRef = useRef<string[]>([]);
  // IfcSpace entity IDs from non-A models — always hidden
  const nonASpaceIdsRef = useRef<string[]>([]);
  // Previous solidIds for delta updates
  const prevVisibleRef = useRef<Set<string> | null>(null);
  // Counter to force categories recalc when entity map is built
  const [entityMapVersion, setEntityMapVersion] = useState(0);

  // ── XEOKit accessor ─────────────────────────────────────────────────────
  const getXeokitViewer = useCallback(() => {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer
      ?? (window as any).__nativeXeokitViewer
      ?? null;
  }, [viewerRef]);

  // ── Derived data from Asset+ ────────────────────────────────────────────

  const buildingData = useMemo(() => {
    if (!allData || !buildingFmGuid) return [];
    return allData.filter((a: any) =>
      (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid
    );
  }, [allData, buildingFmGuid]);

  const storeyAssets = useMemo(() => {
    return buildingData
      .filter((a: any) => a.category === 'Building Storey' || a.category === 'IfcBuildingStorey')
      .map((a: any) => {
        const attrs = a.attributes || {};
        const fmGuid = a.fmGuid || a.fm_guid || '';
        const normalizedFmGuid = normalizeGuid(fmGuid);
        return {
          raw: a,
          fmGuid,
          normalizedFmGuid,
          name: (a.commonName || a.common_name || a.name || attrs.levelCommonName || 'Unnamed level').trim(),
          sourceGuid: attrs.parentBimObjectId || storeyLookup.byGuid.get(normalizedFmGuid)?.sourceGuid || '',
          sourceName: attrs.parentCommonName || storeyLookup.byGuid.get(normalizedFmGuid)?.parentName || '',
        };
      })
      .filter((storey) => !!storey.fmGuid);
  }, [buildingData, storeyLookup]);

  const sourceNameLookup = useMemo(() => {
    const map = new Map<string, string>();
    storeyAssets.forEach((storey) => {
      if (storey.sourceGuid && storey.sourceName && !isGuid(storey.sourceName)) {
        map.set(storey.sourceGuid, storey.sourceName);
      }
    });
    return map;
  }, [storeyAssets]);

  const sharedFloorGuidSet = useMemo(() => {
    const guids = new Set<string>();
    sharedFloors.forEach((floor) => {
      floor.databaseLevelFmGuids.forEach((guid) => guids.add(normalizeGuid(guid)));
    });
    return guids;
  }, [sharedFloors]);

  // Levels: driven primarily by sharedFloors (useFloorData) which correctly detects A-model
  // floors from the xeokit scene. Enriched with storeyAssets for space counts and sourceGuid.
  const levels: LevelItem[] = useMemo(() => {
    // Build A-model storey GUID set for filtering space counts
    const aModelStoreyGuidSet = getAModelStoreyGuids(buildingData, buildingFmGuid || '');

    // Count DB-driven A-model storeys to compare against scene-derived floors
    const aModelStoreyCount = storeyAssets.filter((s) => {
      if (!s.sourceName || isGuid(s.sourceName)) return false;
      return isArchitecturalModel(s.sourceName);
    }).length;

    // Quality check: use sharedFloors only if they are reasonably complete
    // compared to DB storeys. If DB has significantly more A-model storeys,
    // the scene data is incomplete (e.g. Småviken: scene=2, DB=10).
    const sceneIsReliable = sharedFloors.length > 0 &&
      (aModelStoreyCount === 0 || sharedFloors.length >= aModelStoreyCount * 0.7);

    if (sceneIsReliable) {
      return sharedFloors.map((floor) => {
        const allGuids = new Set<string>();
        floor.databaseLevelFmGuids.forEach(g => allGuids.add(normalizeGuid(g)));

        // Find matching storeyAsset by GUID first, then by name
        let sourceGuid = '';
        let matchedStorey: typeof storeyAssets[0] | null = null;
        const floorNameLower = floor.name.toLowerCase().trim();

        for (const storey of storeyAssets) {
          if (allGuids.has(storey.normalizedFmGuid)) {
            matchedStorey = storey;
            sourceGuid = storey.sourceGuid;
            break;
          }
        }

        // Name-based fallback: match by level name
        if (!matchedStorey) {
          for (const storey of storeyAssets) {
            const storeyNameLower = storey.name.toLowerCase().trim();
            if (storeyNameLower === floorNameLower ||
                storeyNameLower.includes(floorNameLower) ||
                floorNameLower.includes(storeyNameLower)) {
              matchedStorey = storey;
              sourceGuid = storey.sourceGuid;
              // Add Asset+ FM GUID so downstream space filtering works
              allGuids.add(normalizeGuid(storey.fmGuid));
              break;
            }
          }
        }

        // If no sourceGuid from storeyAssets, try storeyLookup
        if (!sourceGuid) {
          for (const g of allGuids) {
            const lookup = storeyLookup.byGuid.get(g);
            if (lookup?.sourceGuid) { sourceGuid = lookup.sourceGuid; break; }
          }
        }

        // Count spaces belonging to this level — only A-model spaces
        // Use aModelStoreyGuidSet (Asset+ FM GUIDs) for filtering
        const spaceCount = buildingData.filter((s: any) => {
          const cat = s.category;
          if (cat !== 'Space' && cat !== 'IfcSpace') return false;
          const levelGuid = s.levelFmGuid || s.level_fm_guid || '';
          const levelGuidNorm = normalizeGuid(levelGuid);
          // Check if space belongs to this level via any of its GUIDs
          if (!allGuids.has(levelGuidNorm) && !allGuids.has(normalizeGuid(levelGuid))) return false;
          // Only count if the space's level is in the A-model storey set
          if (aModelStoreyGuidSet.size > 0 && !aModelStoreyGuidSet.has(levelGuid)) return false;
          return true;
        }).length;

        return {
          fmGuid: floor.databaseLevelFmGuids[0] || floor.id,
          allGuids: Array.from(allGuids),
          name: floor.name,
          sourceGuid,
          spaceCount,
        };
      }).sort((a, b) => {
        const extract = (n: string) => {
          const m = n.match(/(-?\d+)/);
          return m ? parseInt(m[1], 10) : 0;
        };
        return extract(a.name) - extract(b.name) || a.name.localeCompare(b.name, 'sv');
      });
    }

    // Fallback: if sharedFloors is empty (viewer not ready yet), use storeyAssets
    const aModelStoreys = storeyAssets.filter((storey) => {
      if (!storey.sourceName || isGuid(storey.sourceName)) return false;
      return isArchitecturalModel(storey.sourceName);
    });
    const filtered = aModelStoreys.length > 0 ? aModelStoreys : storeyAssets;

    return filtered
      .map((storey) => {
        const allGuids = new Set<string>([storey.normalizedFmGuid]);
        const spaceCount = buildingData.filter((s: any) => {
          const cat = s.category;
          if (cat !== 'Space' && cat !== 'IfcSpace') return false;
          const levelGuid = normalizeGuid(s.levelFmGuid || s.level_fm_guid || '');
          return allGuids.has(levelGuid);
        }).length;
        return {
          fmGuid: storey.fmGuid,
          allGuids: Array.from(allGuids),
          name: storey.name,
          sourceGuid: storey.sourceGuid,
          spaceCount,
        };
      })
      .sort((a, b) => {
        const extract = (n: string) => {
          const m = n.match(/(-?\d+)/);
          return m ? parseInt(m[1], 10) : 0;
        };
        return extract(a.name) - extract(b.name) || a.name.localeCompare(b.name, 'sv');
      });
  }, [storeyAssets, sharedFloors, storeyLookup, buildingData]);

  // Sources: only A-model sources (architectural models)
  const sources: BimSource[] = useMemo(() => {
    // Count storeys per source — ONLY from A-model levels (filtered list)
    const storeyCountBySource = new Map<string, number>();
    levels.forEach(level => {
      const norm = normalizeGuid(level.sourceGuid);
      storeyCountBySource.set(norm, (storeyCountBySource.get(norm) || 0) + 1);
    });

    // Collect unique A-model source names from storeyAssets
    const sourceMap = new Map<string, { guid: string; name: string; storeyCount: number }>();
    storeyAssets.forEach(storey => {
      if (!storey.sourceGuid || !storey.sourceName || isGuid(storey.sourceName)) return;
      // Only include A-model sources
      if (!isAModelName(storey.sourceName)) return;
      const normGuid = normalizeGuid(storey.sourceGuid);
      if (!sourceMap.has(normGuid)) {
        sourceMap.set(normGuid, {
          guid: storey.sourceGuid,
          name: storey.sourceName,
          storeyCount: storeyCountBySource.get(normGuid) || 0,
        });
      }
    });

    // If no A-model sources found from storeyAssets, fall back to sharedModels filtered by isArchitecturalModel
    if (sourceMap.size === 0) {
      sharedModels.forEach((model, idx) => {
        let name = model.name || '';
        const looksLikeGuid = isGuid(name);
        if (!name || looksLikeGuid) {
          name = sourceNameLookup.get(model.id) || apSources.get(model.id) || '';
        }
        if (!name || isGuid(name)) {
          name = model.shortName || `Modell ${idx + 1}`;
        }
        // Only include if it looks like an A-model
        if (isArchitecturalModel(name) || isAModelName(name)) {
          const normId = normalizeGuid(model.id);
          sourceMap.set(normId, {
            guid: model.id,
            name,
            storeyCount: storeyCountBySource.get(normId) || 0,
          });
        }
      });
    }

    // Handle levels with no sourceGuid: assign them to the first A-model source
    // instead of creating a misleading "Orphan" entry (e.g. Småviken)
    const orphanLevels = levels.filter(l => !l.sourceGuid);
    if (orphanLevels.length > 0 && sourceMap.size > 0) {
      // Re-assign orphan level counts to the first A-model source
      const firstSource = Array.from(sourceMap.values())[0];
      if (firstSource) {
        firstSource.storeyCount += orphanLevels.length;
      }
    } else if (orphanLevels.length > 0) {
      sourceMap.set('orphan', { guid: '', name: 'Orphan', storeyCount: orphanLevels.length });
    }

    return Array.from(sourceMap.values())
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }, [sharedModels, storeyAssets, sourceNameLookup, apSources, levels]);

  // ── Spaces: cascading from checked levels (Source→Level→Space funnel) ───
  const spaces: SpaceItem[] = useMemo(() => {
    // Build set of A-model level GUIDs from Asset+ data (not from levels[].allGuids which may be xeokit IDs)
    const aModelLevelGuids = getAModelStoreyGuids(buildingData, buildingFmGuid || '');
    // Also add normalized variants for matching
    const aModelLevelGuidsNorm = new Set<string>();
    aModelLevelGuids.forEach(g => aModelLevelGuidsNorm.add(normalizeGuid(g)));

    const allSpaces = buildingData
      .filter((a: any) => {
        if (a.category !== 'Space' && a.category !== 'IfcSpace') return false;
        // Only include spaces belonging to A-model levels (using Asset+ FM GUIDs)
        const levelGuid = a.levelFmGuid || a.level_fm_guid || '';
        const levelGuidNorm = normalizeGuid(levelGuid);
        if (aModelLevelGuids.size > 0 && levelGuid) {
          return aModelLevelGuids.has(levelGuid) || aModelLevelGuidsNorm.has(levelGuidNorm);
        }
        return true;
      });

    const normalizedCheckedSourceGuids = new Set(Array.from(checkedSources).map(g => normalizeGuid(g)));
    const normalizedCheckedLevelGuids = new Set(Array.from(checkedLevels).map(g => normalizeGuid(g)));

    let visibleLevelGuids: Set<string> | null = null;
    if (levels.length > 0) {
      const allLevelGuids = new Set<string>();

      let relevantLevels = levels;
      if (normalizedCheckedSourceGuids.size > 0) {
        relevantLevels = relevantLevels.filter(l =>
          normalizedCheckedSourceGuids.has(normalizeGuid(l.sourceGuid))
        );
      }
      if (normalizedCheckedLevelGuids.size > 0) {
        relevantLevels = relevantLevels.filter(l =>
          l.allGuids.some(g => normalizedCheckedLevelGuids.has(g))
        );
      }

      relevantLevels.forEach(l => {
        l.allGuids.forEach(g => allLevelGuids.add(g));
      });

      if (normalizedCheckedLevelGuids.size > 0 || normalizedCheckedSourceGuids.size > 0) {
        visibleLevelGuids = allLevelGuids;
      }
    }

    let spacesSource = allSpaces;
    if (visibleLevelGuids) {
      const filtered = allSpaces.filter((a: any) => {
        const levelGuid = normalizeGuid(a.levelFmGuid || a.level_fm_guid || '');
        return visibleLevelGuids!.has(levelGuid);
      });

      if (filtered.length > 0 || visibleLevelGuids.size === 0) {
        spacesSource = filtered;
      } else if (entityMapRef.current.size > 0) {
        const viewer = getXeokitViewer();
        if (viewer?.metaScene?.metaObjects) {
          const sceneSpaceGuids = new Set<string>();
          const eMap = entityMapRef.current;
          const levelGuidsToSearch = checkedLevels.size > 0
            ? new Set(
                levels
                  .filter(level => level.allGuids.some(g => normalizedCheckedLevelGuids.has(g)))
                  .map(level => level.fmGuid)
              )
            : new Set(levels.map(l => l.fmGuid));

          levelGuidsToSearch.forEach(levelGuid => {
            const entityIds = eMap.get(levelGuid) || [];
            entityIds.forEach(id => {
              const mo = viewer.metaScene.metaObjects[id];
              if (mo && (mo.type || '').toLowerCase() === 'ifcspace') {
                sceneSpaceGuids.add(normalizeGuid(mo.originalSystemId || mo.id));
              }
            });
          });

          spacesSource = sceneSpaceGuids.size > 0
            ? allSpaces.filter((a: any) => sceneSpaceGuids.has(normalizeGuid(a.fmGuid || a.fm_guid || '')))
            : [];
        } else {
          spacesSource = [];
        }
      } else {
        spacesSource = [];
      }
    }

    return spacesSource
      .map((a: any) => {
        const name = (a.commonName || a.common_name || a.name || 'Unnamed').replace(/^null$/, 'Unnamed');
        const designation = a.attributes?.designation || a.attributes?.Designation || a.attributes?.number || '';
        return {
          fmGuid: a.fmGuid || a.fm_guid,
          name,
          designation: typeof designation === 'string' ? designation : '',
          levelFmGuid: a.levelFmGuid || a.level_fm_guid,
        };
      })
      .filter((s: SpaceItem) => s.name && s.name !== 'Unnamed')
      .sort((a: SpaceItem, b: SpaceItem) => a.name.localeCompare(b.name, 'sv', { numeric: true }));
  }, [buildingData, buildingFmGuid, checkedLevels, checkedSources, levels, getXeokitViewer]);

  // ── Categories: derived from typeIndex, scoped by active filters ────────
  const categories: CategoryItem[] = useMemo(() => {
    const tIdx = typeIndexRef.current;
    if (tIdx.size === 0) return [];

    // Determine scope IDs from active level/space filters
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
    } else if (checkedSources.size > 0) {
      scopeIds = new Set<string>();
      // Try level-based scoping first
      levels.filter(l => checkedSources.has(l.sourceGuid)).forEach(l => {
        eMap.get(l.fmGuid)?.forEach(id => scopeIds!.add(id));
      });
      // Fallback: if scopeIds is empty, scope by scene model objects directly
      if (scopeIds.size === 0) {
        const viewer = getXeokitViewer();
        if (viewer?.scene?.models) {
          const normalizedChecked = new Set(Array.from(checkedSources).map(g => normalizeGuid(g)));
          // Also match by model name from sharedModels
          const checkedModelIds = new Set<string>();
          sharedModels.forEach(m => {
            if (checkedSources.has(m.id) || normalizedChecked.has(normalizeGuid(m.id))) {
              checkedModelIds.add(m.id);
            }
          });
          Object.entries(viewer.scene.models).forEach(([modelId, model]: [string, any]) => {
            if (checkedModelIds.has(modelId) || checkedSources.has(modelId) || normalizedChecked.has(normalizeGuid(modelId))) {
              const objs = model.objects || {};
              Object.keys(objs).forEach(id => scopeIds!.add(id));
            }
          });
        }
        // If still empty, don't filter (show all)
        if (scopeIds.size === 0) scopeIds = null;
      }
    }

    const counts = new Map<string, number>();
    for (const [ifcType, ids] of tIdx) {
      const cat = IFC_TO_CATEGORY[ifcType] || ifcType.replace(/^Ifc/, '');
      if (['Building', 'Project', 'Site', 'Building Storey', 'Space'].includes(cat)) continue;
      const count = scopeIds ? ids.filter(id => scopeIds!.has(id)).length : ids.length;
      if (count > 0) {
        counts.set(cat, (counts.get(cat) || 0) + count);
      }
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [entityMapVersion, checkedLevels, checkedSpaces, checkedSources, levels, getXeokitViewer, sharedModels]);

  // ── Auto-assign palette colors (stable — only when list identity changes) ──
  useEffect(() => {
    const colors = new Map<string, string>();
    levels.forEach((level, idx) => {
      colors.set(level.fmGuid, LEVEL_PALETTE[idx % LEVEL_PALETTE.length]);
    });
    setLevelColors(colors);
  }, [levels]);

  useEffect(() => {
    const nameToColor = new Map<string, string>();
    const colors = new Map<string, string>();
    let colorIdx = 0;
    spaces.forEach(space => {
      if (!nameToColor.has(space.name)) {
        nameToColor.set(space.name, LEVEL_PALETTE[colorIdx % LEVEL_PALETTE.length]);
        colorIdx++;
      }
      colors.set(space.fmGuid, nameToColor.get(space.name)!);
    });
    setSpaceColors(colors);
  }, [spaces]);

  useEffect(() => {
    const colors = new Map<string, string>();
    categories.forEach((cat, idx) => {
      colors.set(cat.name, CATEGORY_PALETTE[cat.name] || LEVEL_PALETTE[idx % LEVEL_PALETTE.length]);
    });
    setCategoryColors(colors);
  }, [categories]);

  // ── Sync checkedLevels from external floor switcher ──────────────────
  useEffect(() => {
    const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
      if ((e.detail as any).fromFilterPanel) return;

      if (e.detail.isAllFloorsVisible || e.detail.floorId === null) {
        setCheckedLevels(new Set());
      } else if (e.detail.visibleFloorFmGuids?.length > 0) {
        const matchingLevelGuids = new Set<string>();
        const normalizedVisibleGuids = e.detail.visibleFloorFmGuids.map((g: string) => normalizeGuid(g));

        levels.forEach(level => {
          if (level.allGuids.some(g => normalizedVisibleGuids.includes(g))) {
            matchingLevelGuids.add(level.fmGuid);
          }
        });

        if (matchingLevelGuids.size > 0) {
          setCheckedLevels(matchingLevelGuids);
        }
      }
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, [levels]);

  // ── Build entity ID map (fmGuid → xeokit IDs) — runs ONCE ─────────────
  const buildEntityMap = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return false;

    const metaObjects = viewer.metaScene.metaObjects;
    const map = new Map<string, string[]>();

    // Build typeIndex: ifcType → entity IDs (for fast category counting)
    const tIdx = new Map<string, string[]>();

    // Build entityToModelId mapping
    const sceneModels = viewer.scene.models || {};
    const entityToModelId = new Map<string, string>();
    Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
      const objs = model.objects || model.entityList || {};
      if (typeof objs === 'object' && objs !== null) {
        const keys = Array.isArray(objs) ? objs.map((e: any) => e.id).filter(Boolean) : Object.keys(objs);
        keys.forEach((objId: string) => entityToModelId.set(objId, modelId));
      }
    });
    if (entityToModelId.size === 0) {
      Object.values(metaObjects).forEach((mo: any) => {
        const modelId = mo.metaModel?.id;
        if (modelId) entityToModelId.set(mo.id, modelId);
      });
    }

    // Detect A-model IDs
    const aModelSceneIds = new Set<string>();
    if (sharedModels.length > 0) {
      sharedModels.forEach(m => {
        if (isArchitecturalModel(m.name)) aModelSceneIds.add(m.id);
      });
    }
    if (aModelSceneIds.size === 0) {
      const sceneModelIds = Object.keys(sceneModels);
      sceneModelIds.forEach(id => { if (isArchitecturalModel(id)) aModelSceneIds.add(id); });
      if (aModelSceneIds.size === 0 && sceneModelIds.length === 1) {
        sceneModelIds.forEach(id => aModelSceneIds.add(id));
      }
    }

    const xeokitStoreys: { id: string; sysId: string; name: string; modelId: string }[] = [];
    const xeokitSpaces: { id: string; sysId: string; name: string }[] = [];
    const areaSpaceIds: string[] = [];
    const nonASpaceIds: string[] = [];

    // Single pass: build typeIndex + collect storeys/spaces
    Object.values(metaObjects).forEach((mo: any) => {
      const type = mo.type || '';
      if (type) {
        const arr = tIdx.get(type);
        if (arr) arr.push(mo.id); else tIdx.set(type, [mo.id]);
      }
      const typeLower = type.toLowerCase();
      if (typeLower === 'ifcbuildingstorey') {
        xeokitStoreys.push({
          id: mo.id,
          sysId: (mo.originalSystemId || mo.id || ''),
          name: (mo.name || ''),
          modelId: entityToModelId.get(mo.id) || mo.metaModel?.id || '',
        });
      } else if (typeLower === 'ifcspace') {
        const spaceModelId = entityToModelId.get(mo.id) || mo.metaModel?.id || '';
        const isFromAModel = aModelSceneIds.has(spaceModelId) || aModelSceneIds.size === 0;
        if (isFromAModel) {
          xeokitSpaces.push({
            id: mo.id,
            sysId: (mo.originalSystemId || mo.id || ''),
            name: (mo.name || ''),
          });
        } else {
          // Space from non-A model — track for permanent hiding
          nonASpaceIds.push(mo.id);
        }
        const spaceName = (mo.name || '').trim().toLowerCase();
        if (spaceName === 'area' || spaceName.startsWith('area ') || spaceName.startsWith('area:')) {
          areaSpaceIds.push(mo.id);
        }
      }
    });

    typeIndexRef.current = tIdx;
    areaSpaceIdsRef.current = areaSpaceIds;
    nonASpaceIdsRef.current = nonASpaceIds;

    if (xeokitStoreys.length === 0) {
      console.warn('[FilterPanel] No IfcBuildingStorey found in metaScene');
      // Still save the typeIndex even if no storeys
      entityMapRef.current = map;
      entityMapBuilt.current = true;
      setEntityMapVersion(v => v + 1);
      return true;
    }

    // Sort storeys: A-model first
    const sortedStoreys = [...xeokitStoreys].sort((a, b) => {
      const aIsA = aModelSceneIds.has(a.modelId) ? 0 : 1;
      const bIsA = aModelSceneIds.has(b.modelId) ? 0 : 1;
      return aIsA - bIsA;
    });

    const hasAnyModelMapping = sortedStoreys.some(xs => xs.modelId !== '');
    const eligibleStoreys = sortedStoreys.filter(xs => {
      if (!hasAnyModelMapping) return true;
      if (aModelSceneIds.has(xs.modelId)) return true;
      if (xs.modelId === '') return true;
      return false;
    });

    // Match levels → storeys
    const usedStoreyIds = new Set<string>();
    levels.forEach(level => {
      const levelGuidSet = new Set(level.allGuids.map(g => normalizeGuid(g)));
      const nameLower = level.name.toLowerCase().trim();

      let matched = eligibleStoreys.find(xs =>
        !usedStoreyIds.has(xs.id) && levelGuidSet.has(normalizeGuid(xs.sysId))
      );
      if (!matched) matched = eligibleStoreys.find(xs =>
        !usedStoreyIds.has(xs.id) && xs.name.toLowerCase().trim() === nameLower
      );
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
        level.allGuids.forEach(g => {
          map.set(g, descendants);
        });
      }
    });

    // Match spaces — only A-model spaces
    const aModelGuids = getAModelStoreyGuids(buildingData, buildingFmGuid || '');
    const allAssetSpaces = buildingData
      .filter((a: any) => {
        if (a.category !== 'Space' && a.category !== 'IfcSpace') return false;
        // Filter to A-model spaces when we have A-model storey data
        if (aModelGuids.size > 0) {
          const levelGuid = a.levelFmGuid || a.level_fm_guid || '';
          return aModelGuids.has(levelGuid);
        }
        return true;
      });
    const usedSpaceIds = new Set<string>();
    allAssetSpaces.forEach((space: any) => {
      const spaceFmGuid = space.fmGuid || space.fm_guid;
      if (!spaceFmGuid) return;
      const fmNorm = normalizeGuid(spaceFmGuid);
      const spaceName = (space.commonName || space.common_name || space.name || '').toLowerCase().trim();

      let matched = xeokitSpaces.find(xs =>
        !usedSpaceIds.has(xs.id) && normalizeGuid(xs.sysId) === fmNorm
      );
      if (!matched) matched = xeokitSpaces.find(xs =>
        !usedSpaceIds.has(xs.id) && xs.name.toLowerCase().trim() === spaceName
      );

      if (matched) {
        usedSpaceIds.add(matched.id);
        const descendants = getDescendantIds(viewer, matched.id);
        map.set(spaceFmGuid, descendants);
      }
    });

    // Build source → model objects map
    Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
      let modelObjKeys: string[] = [];
      const objs = model.objects || model.entityList;
      if (objs && typeof objs === 'object') {
        modelObjKeys = Array.isArray(objs) ? objs.map((e: any) => e.id).filter(Boolean) : Object.keys(objs);
      }
      if (modelObjKeys.length === 0) {
        entityToModelId.forEach((mId, objId) => { if (mId === modelId) modelObjKeys.push(objId); });
      }
      for (const objId of modelObjKeys) {
        const mo = metaObjects[objId];
        if (mo?.type === 'IfcBuildingStorey') {
          const sysId = normalizeGuid(mo.originalSystemId || '');
          const moName = (mo.name || '').toLowerCase().trim();
          const matchedLevel = levels.find(l =>
            l.allGuids.some(g => g === sysId) || l.name.toLowerCase().trim() === moName
          );
          if (matchedLevel?.sourceGuid) {
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
    setEntityMapVersion(v => v + 1);
    console.log('[FilterPanel] Entity map built:', map.size, 'entries.',
      'Levels matched:', levels.filter(l => map.has(l.fmGuid)).length, '/', levels.length,
      'Spaces matched:', allAssetSpaces.filter((s: any) => map.has(s.fmGuid || s.fm_guid)).length, '/', allAssetSpaces.length,
      'Type index:', tIdx.size, 'types',
      'Non-A spaces (hidden):', nonASpaceIds.length);
    return true;
  }, [getXeokitViewer, levels, sharedModels, buildingData, sharedFloors]);

  // Build map when viewer is ready (runs once per visibility)
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

  // Re-apply filter when a deferred model finishes loading in the scene
  const pendingReapplyRef = useRef(false);
  useEffect(() => {
    if (!isVisible) return;
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    const onModelLoaded = () => {
      // Rebuild entity map to include the newly loaded model's objects
      entityMapBuilt.current = false;
      buildEntityMap();
      // Flag for re-apply; the effect below will pick it up
      pendingReapplyRef.current = true;
    };

    viewer.scene.on?.('modelLoaded', onModelLoaded);
    return () => {
      viewer.scene.off?.('modelLoaded', onModelLoaded);
    };
  }, [isVisible, getXeokitViewer, buildEntityMap]);

  // ── Fetch annotation categories ────────────────────────────────────────
  useEffect(() => {
    if (!isVisible || !buildingFmGuid) return;
    const fetchAnnotations = async () => {
      const { data: assets } = await supabase
        .from('assets')
        .select('asset_type, symbol_id')
        .eq('building_fm_guid', buildingFmGuid)
        .or('annotation_placed.eq.true,created_in_model.eq.false');

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

      if (issueCount && issueCount > 0) {
        categories.push({ category: 'Issues', count: issueCount, color: '#EF4444' });
      }

      setAnnotationCategories(categories.sort((a, b) => b.count - a.count));
    };
    fetchAnnotations();
  }, [isVisible, buildingFmGuid]);

  // Dispatch annotation filter + toggle events
  useEffect(() => {
    const categories = Array.from(checkedAnnotations);
    window.dispatchEvent(new CustomEvent(ANNOTATION_FILTER_EVENT, {
      detail: { visibleCategories: categories },
    }));
    // Also dispatch TOGGLE_ANNOTATIONS so the native viewer creates/shows markers
    const show = categories.length > 0;
    window.dispatchEvent(new CustomEvent('TOGGLE_ANNOTATIONS', {
      detail: { show, visibleCategories: categories },
    }));
  }, [checkedAnnotations]);

  // ── Apply filter + coloring (debounced, delta-based) ────────────────────

  const rafRef = useRef<number>(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const isApplyingRef = useRef(false);

  const applyFilterVisibility = useCallback(() => {
    clearTimeout(debounceRef.current);
    cancelAnimationFrame(rafRef.current);
    debounceRef.current = setTimeout(() => {
    if (isApplyingRef.current) return;
    isApplyingRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) { isApplyingRef.current = false; return; }
    const scene = viewer.scene;
    const eMap = entityMapRef.current;

    const hasAnyFilter = checkedSources.size > 0 || checkedLevels.size > 0 ||
      checkedSpaces.size > 0 || checkedCategories.size > 0;

    // Step 0: Clean slate — reset xray (but DON'T reset colorize when theme is active or color filter is active)
    let prevXrayed: string[] = [];
    try { prevXrayed = scene.xrayedObjectIds || []; } catch (_e) { /* scene teardown */ }
    if (prevXrayed.length > 0) {
      scene.setObjectsXRayed(prevXrayed, false);
      scene.setObjectsPickable(prevXrayed, true);
    }
    
    // Only reset colorize when we actually have filter-applied colors (not theme colors)
    // When a theme is active, visualization is forcing spaces, or color filter is active, skip the colorize reset
    const themeActive = !!activeThemeIdRef.current;
    const spacesForced = !!(window as any).__spacesForceVisible;
    const colorFilterActive = !!(window as any).__colorFilterActive;
    if (!themeActive && !spacesForced && !colorFilterActive && (hasAnyFilter || autoColorEnabled || autoColorSpaces || autoColorCategories)) {
      let prevColorizedIds: string[] = [];
      try { prevColorizedIds = scene.colorizedObjectIds || []; } catch (_e) { /* scene teardown */ }
      if (prevColorizedIds.length > 0) {
        scene.setObjectsColorized(prevColorizedIds, false);
        prevColorizedIds.forEach((id: string) => {
          const entity = scene.objects?.[id];
          if (entity && entity.opacity < 1) entity.opacity = 1.0;
        });
      }
    }

    // Hide all IfcSpace entities by default — UNLESS visualization is forcing them visible
    const spaceEntityIds = typeIndexRef.current.get('IfcSpace') || [];
    if (!spacesForced) {
      spaceEntityIds.forEach(id => {
        const entity = scene.objects?.[id];
        if (entity) { entity.visible = false; entity.pickable = false; }
      });
    }

    if (!hasAnyFilter) {
      // No filter: show everything (except spaces), but only A-model objects
      const prev = prevVisibleRef.current;
      if (prev) {
        // Delta: show what was previously hidden
        scene.setObjectsVisible(safeObjectIds(scene), true);
        scene.setObjectsPickable(safeObjectIds(scene), true);
        // Re-hide spaces (unless visualization is forcing them visible)
        if (!spacesForced) {
          spaceEntityIds.forEach(id => {
            const entity = scene.objects?.[id];
            if (entity) { entity.visible = false; entity.pickable = false; }
          });
        }
        prevVisibleRef.current = null;
      }

      // Hide non-A models at model level (same as the "else" branch for sources)
      const sceneModelsNoFilter = viewer.scene.models || {};
      const hasIdentifiableAModelNoFilter = Object.entries(sceneModelsNoFilter).some(([mId, m]: [string, any]) => {
        const mName = (m as any).name || sourceNameLookup.get(mId) || mId;
        return isArchitecturalModel(mName);
      });
      if (hasIdentifiableAModelNoFilter) {
        Object.entries(sceneModelsNoFilter).forEach(([modelId, model]: [string, any]) => {
          if (typeof model.visible === 'undefined') return;
          const modelName = (model as any).name || sourceNameLookup.get(modelId) || modelId;
          model.visible = isArchitecturalModel(modelName);
        });
      }

      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
        detail: {
          floorId: null, floorName: null, bounds: null,
          visibleMetaFloorIds: [], visibleFloorFmGuids: [],
          isAllFloorsVisible: true,
        } as FloorSelectionEventDetail,
      }));
      isApplyingRef.current = false;
      return;
    }

    // Step 1: Compute solidIds via cascading filters
    // Source filter — also toggle model-level visibility for reliable switching
    let sourceIds: Set<string> | null = null;
    if (checkedSources.size > 0) {
      sourceIds = new Set<string>();
      
      const sceneModels2 = viewer.scene.models || {};
      const metaObjects = viewer.metaScene?.metaObjects;
      const checkedSourceGuidsNorm = new Set(Array.from(checkedSources).map(g => normalizeGuid(g)));
      const checkedSourceNames = new Set(
        sources.filter(s => checkedSources.has(s.guid)).map(s => s.name.toLowerCase())
      );

      // Determine which scene model IDs are checked vs unchecked
      const checkedSceneModelIds = new Set<string>();
      const requestedModelIds = new Set<string>();

      // Direct match: try checked source GUID as scene model ID
      checkedSources.forEach(srcGuid => {
        const sceneModel = sceneModels2[srcGuid];
        if (sceneModel) {
          checkedSceneModelIds.add(srcGuid);
          requestedModelIds.add(srcGuid.replace(/\.xkt$/i, ''));
          const objs = sceneModel.objects || {};
          const objKeys = Array.isArray(objs) ? objs.map((e: any) => e.id).filter(Boolean) : Object.keys(objs);
          objKeys.forEach((id: string) => sourceIds!.add(id));
        }
      });
      
      // Match via sharedModels (name or ID match)
      sharedModels.forEach(sm => {
        const guidMatch = checkedSourceGuidsNorm.has(normalizeGuid(sm.id));
        const nameMatch = checkedSourceNames.has((sm.name || '').toLowerCase());
        
        if (guidMatch || nameMatch) {
          checkedSceneModelIds.add(sm.id);
          requestedModelIds.add(sm.id.replace(/\.xkt$/i, ''));
          const sceneModel = sceneModels2[sm.id];
          if (sceneModel) {
            const objs = sceneModel.objects || {};
            const objKeys = Array.isArray(objs) ? objs.map((e: any) => e.id).filter(Boolean) : Object.keys(objs);
            objKeys.forEach((id: string) => sourceIds!.add(id));
            
            if (objKeys.length === 0 && metaObjects) {
              Object.values(metaObjects).forEach((mo: any) => {
                if (mo.metaModel?.id === sm.id) sourceIds!.add(mo.id);
              });
            }
          }
        }
      });
      
      // Also add from entityMap (level-based)
      levels.filter(l => checkedSources.has(l.sourceGuid)).forEach(l => {
        eMap.get(l.fmGuid)?.forEach(id => sourceIds!.add(id));
      });
      checkedSources.forEach(srcGuid => {
        eMap.get(`source::${srcGuid}`)?.forEach(id => sourceIds!.add(id));
      });

      // Toggle model-level visibility so xeokit actually switches rendered geometry
      // Also trigger on-demand loading for deferred (non-A) models that aren't loaded yet
      Object.entries(sceneModels2).forEach(([modelId, model]: [string, any]) => {
        const shouldShow = checkedSceneModelIds.has(modelId);
        if (typeof model.visible !== 'undefined') {
          model.visible = shouldShow;
        }
      });

      // Request loading for checked models that don't exist in the scene yet (deferred models)
      requestedModelIds.forEach(modelId => {
        const normalizedModelId = modelId.replace(/\.xkt$/i, '');
        if (!sceneModels2[normalizedModelId] && !sceneModels2[`${normalizedModelId}.xkt`]) {
          console.log(`[FilterPanel] Requesting deferred load for model: ${normalizedModelId}`);
          window.dispatchEvent(new CustomEvent(MODEL_LOAD_REQUESTED_EVENT, { detail: { modelId: normalizedModelId } }));
        }
      });
      
      if (sourceIds.size === 0) {
        console.warn('[FilterPanel] Source filter produced 0 IDs — falling back to all objects');
        sourceIds = null;
      }
    } else {
      // No source filter active — only show A-model(s), hide secondary models
      const sceneModels2 = viewer.scene.models || {};
      Object.entries(sceneModels2).forEach(([modelId, model]: [string, any]) => {
        if (typeof model.visible === 'undefined') return;
        // Check if this is an A-model by name or by being the first/only model
        const modelName = model.name || sourceNameLookup.get(modelId) || modelId;
        const isAModel = isArchitecturalModel(modelName);
        // If we can't identify any A-model (e.g. all GUIDs), keep all visible
        const hasIdentifiableAModel = Object.entries(sceneModels2).some(([mId, m]: [string, any]) => {
          const mName = (m as any).name || sourceNameLookup.get(mId) || mId;
          return isArchitecturalModel(mName);
        });
        if (hasIdentifiableAModel) {
          model.visible = isAModel;
        } else {
          model.visible = true;
        }
      });
    }

    // Level filter
    let levelIds: Set<string> | null = null;
    if (checkedLevels.size > 0) {
      levelIds = new Set<string>();
      checkedLevels.forEach(fmGuid => {
        eMap.get(fmGuid)?.forEach(id => levelIds!.add(id));
      });
    }

    // Space filter
    let spaceAndContextIds: Set<string> | null = null;
    let spaceOnlyEntityIds: Set<string> | null = null;
    if (checkedSpaces.size > 0) {
      spaceAndContextIds = new Set<string>();
      spaceOnlyEntityIds = new Set<string>();
      checkedSpaces.forEach(fmGuid => {
        const ids = eMap.get(fmGuid);
        if (ids) {
          ids.forEach(id => {
            spaceAndContextIds!.add(id);
            spaceOnlyEntityIds!.add(id);
          });
        }
      });
      // Add parent level context
      const parentLevelGuids = new Set<string>();
      spaces.forEach(space => {
        if (checkedSpaces.has(space.fmGuid) && space.levelFmGuid) {
          parentLevelGuids.add(space.levelFmGuid);
        }
      });
      parentLevelGuids.forEach(levelGuid => {
        eMap.get(levelGuid)?.forEach(id => spaceAndContextIds!.add(id));
      });
    }

    // Category filter
    let categoryIds: Set<string> | null = null;
    if (checkedCategories.size > 0) {
      categoryIds = new Set<string>();
      const allowedIfcTypes = new Set<string>();
      checkedCategories.forEach(cat => {
        const ifcTypes = CATEGORY_TO_IFC[cat];
        if (ifcTypes) ifcTypes.forEach(t => allowedIfcTypes.add(t));
        allowedIfcTypes.add(cat);
        allowedIfcTypes.add('Ifc' + cat);
        allowedIfcTypes.add('Ifc' + cat.replace(/\s+/g, ''));
      });
      // Use typeIndex for fast lookup instead of full metaObjects scan
      for (const [ifcType, ids] of typeIndexRef.current) {
        if (allowedIfcTypes.has(ifcType)) {
          ids.forEach(id => categoryIds!.add(id));
        }
      }
    }

    // Intersect active filters
    const filterSets = [
      sourceIds,
      checkedSpaces.size > 0 ? null : levelIds,
      spaceAndContextIds,
      categoryIds,
    ].filter((s): s is Set<string> => s !== null);

    let solidIds: Set<string>;
    if (filterSets.length === 0) {
      solidIds = new Set(safeObjectIds(scene));
    } else if (filterSets.length === 1) {
      solidIds = new Set(filterSets[0]);
    } else {
      const sorted = [...filterSets].sort((a, b) => a.size - b.size);
      solidIds = new Set<string>();
      for (const id of sorted[0]) {
        if (sorted.every(s => s.has(id))) solidIds.add(id);
      }
    }

    // Handle slab/roof/space visibility
    const fadeIds: string[] = [];
    const hideIds: string[] = [];
    const obstructTypes = new Set(['IfcRoof', 'IfcCovering']);
    const slabTypes = new Set(['IfcSlab', 'IfcSlabStandardCase', 'IfcPlate']);
    const areaSet = new Set(areaSpaceIdsRef.current);

    // Only hide roofs/coverings when drilling into spaces — 
    // when only a level filter (or source filter) is active, show the full model including roof/slabs
    // This matches the behavior of the floor switcher (FloatingFloorSwitcher)
    const hasSpaceFilter = checkedSpaces.size > 0;
    const hasLevelOrSpaceFilter = hasSpaceFilter;

    // Use typeIndex for slab collection (fast)
    const allSlabIds: string[] = [];
    for (const st of slabTypes) {
      const ids = typeIndexRef.current.get(st);
      if (ids) allSlabIds.push(...ids);
    }

    for (const id of solidIds) {
      const mo = viewer.metaScene?.metaObjects?.[id];
      if (mo) {
        if (obstructTypes.has(mo.type) && hasLevelOrSpaceFilter) {
          hideIds.push(id);
          solidIds.delete(id);
        } else if (slabTypes.has(mo.type) && hasLevelOrSpaceFilter) {
          fadeIds.push(id);
          solidIds.delete(id);
        } else if (mo.type === 'IfcSpace') {
          if (areaSet.has(id)) hideIds.push(id);
          solidIds.delete(id);
        }
      }
    }

    // Add slabs from active levels
    if (checkedLevels.size > 0 && levelIds) {
      allSlabIds.forEach(slabId => {
        if (!fadeIds.includes(slabId) && !solidIds.has(slabId)) {
          const slabMo = viewer.metaScene?.metaObjects?.[slabId];
          if (slabMo) {
            let parent = slabMo.parent;
            while (parent) {
              if (parent.type?.toLowerCase() === 'ifcbuildingstorey') {
                const parentGuidNorm = normalizeGuid(parent.originalSystemId || parent.id || '');
                const isVisible = levels.some(level =>
                  checkedLevels.has(level.fmGuid) && level.allGuids.some(g => g === parentGuidNorm)
                );
                if (isVisible) fadeIds.push(slabId);
                break;
              }
              parent = parent.parent ? viewer.metaScene?.metaObjects?.[parent.parent.id || parent.parent] : null;
            }
          }
        }
      });
    }

    // Step 2: Delta visibility update
    const newVisibleSet = new Set(solidIds);
    fadeIds.forEach(id => newVisibleSet.add(id));

    // Apply visibility: show solidIds + fadeIds, hide everything else
    const allObjIds: string[] = safeObjectIds(scene);
    const toShow: string[] = [];
    const toHide: string[] = [];

    const prev = prevVisibleRef.current;
    if (prev) {
      // Delta: only change what's different
      for (const id of allObjIds) {
        const wasVisible = prev.has(id);
        const shouldBeVisible = newVisibleSet.has(id);
        if (shouldBeVisible && !wasVisible) toShow.push(id);
        else if (!shouldBeVisible && wasVisible) toHide.push(id);
      }
    } else {
      // First time: full apply
      for (const id of allObjIds) {
        if (newVisibleSet.has(id)) toShow.push(id);
        else toHide.push(id);
      }
    }

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
      // In xray mode: everything visible but non-solid is xrayed
      if (toHide.length > 0) scene.setObjectsVisible(toHide, true);
      if (toShow.length > 0) scene.setObjectsVisible(toShow, true);
      const nonSolidIds = allObjIds.filter((id: string) => !solidIds.has(id));
      if (nonSolidIds.length > 0) {
        scene.setObjectsXRayed(nonSolidIds, true);
        scene.setObjectsPickable(nonSolidIds, false);
      }
      if (solidIds.size > 0) {
        scene.setObjectsXRayed([...solidIds], false);
        scene.setObjectsPickable([...solidIds], true);
      }
    } else {
      if (toHide.length > 0) scene.setObjectsVisible(toHide, false);
      if (toShow.length > 0) scene.setObjectsVisible(toShow, true);
    }

    // Hide obstructions, fade slabs
    if (hideIds.length > 0) scene.setObjectsVisible(hideIds, false);
    fadeIds.forEach(id => {
      const entity = scene.objects?.[id];
      if (entity) { entity.visible = true; entity.opacity = 0.3; entity.pickable = false; }
    });

    // Always hide IfcSpace entities from non-A models (they should never be visible)
    const nonASpaces = nonASpaceIdsRef.current;
    if (nonASpaces.length > 0) {
      nonASpaces.forEach(id => {
        const entity = scene.objects?.[id];
        if (entity) { entity.visible = false; entity.pickable = false; }
      });
    }

    // Step 3: Tandem-style room cutaway — selected room solid, everything else x-ray
    if (checkedSpaces.size > 0 && spaceOnlyEntityIds && spaceOnlyEntityIds.size > 0) {
      // Collect room contents: traverse metaScene hierarchy to find children inside the room
      const roomContentIds = new Set<string>();
      const metaObjects = viewer.metaScene?.metaObjects;
      if (metaObjects) {
        // For each selected space, find objects that are spatial children
        spaceOnlyEntityIds.forEach(spaceId => {
          const spaceMo = metaObjects[spaceId];
          if (!spaceMo) return;
          // Collect all descendants of the IfcSpace
          const collectDescendants = (mo: any) => {
            if (mo.children) {
              for (const child of mo.children) {
                roomContentIds.add(child.id);
                collectDescendants(child);
              }
            }
          };
          collectDescendants(spaceMo);
        });

        // Also find objects on the same level that share in_room relationship
        // by checking if objects have the same parent storey and are spatially contained
        const spaceParentIds = new Set<string>();
        spaceOnlyEntityIds.forEach(spaceId => {
          const spaceMo = metaObjects[spaceId];
          if (spaceMo?.parent) spaceParentIds.add(spaceMo.parent.id || spaceMo.parent);
        });

        // Find objects in same storey that reference the room
        for (const [objId, mo] of Object.entries(metaObjects) as [string, any][]) {
          if (roomContentIds.has(objId) || spaceOnlyEntityIds.has(objId)) continue;
          // Check if this object's parent chain leads to the same storey
          let parent = mo.parent;
          while (parent) {
            if (spaceParentIds.has(parent.id || parent)) {
              // Only include objects that are NOT IfcSpace themselves (other rooms)
              if (mo.type !== 'IfcSpace') {
                // Check spatial containment by bounding box overlap with room
                const roomEntity = scene.objects?.[Array.from(spaceOnlyEntityIds)[0]];
                const objEntity = scene.objects?.[objId];
                if (roomEntity?.aabb && objEntity?.aabb) {
                  const rAabb = roomEntity.aabb;
                  const oAabb = objEntity.aabb;
                  // Check if object center is within room AABB (expanded slightly)
                  const oCenterX = (oAabb[0] + oAabb[3]) / 2;
                  const oCenterY = (oAabb[1] + oAabb[4]) / 2;
                  const oCenterZ = (oAabb[2] + oAabb[5]) / 2;
                  const margin = 0.5; // 0.5m tolerance
                  if (oCenterX >= rAabb[0] - margin && oCenterX <= rAabb[3] + margin &&
                      oCenterY >= rAabb[1] - margin && oCenterY <= rAabb[4] + margin &&
                      oCenterZ >= rAabb[2] - margin && oCenterZ <= rAabb[5] + margin) {
                    roomContentIds.add(objId);
                  }
                }
              }
              break;
            }
            parent = parent.parent ? metaObjects[parent.parent.id || parent.parent] : null;
          }
        }
      }

      // Set x-ray material to Tandem-style light wireframe
      const xrayMat = scene.xrayMaterial;
      if (xrayMat) {
        xrayMat.fill = true;
        xrayMat.fillAlpha = 0.06;
        xrayMat.fillColor = [0.6, 0.6, 0.65];
        xrayMat.edges = true;
        xrayMat.edgeAlpha = 0.18;
        xrayMat.edgeColor = [0.45, 0.45, 0.5];
      }

      // Scope X-ray to the parent level(s) only — hide objects on other levels
      // Find parent storey IDs for the selected spaces
      const parentStoreyIds = new Set<string>();
      if (metaObjects) {
        spaceOnlyEntityIds.forEach(spaceId => {
          const spaceMo = metaObjects[spaceId];
          if (!spaceMo) return;
          let current = spaceMo.parent;
          while (current) {
            if (current.type?.toLowerCase() === 'ifcbuildingstorey') {
              parentStoreyIds.add(current.id);
              break;
            }
            current = current.parent;
          }
        });
      }

      // Collect all entity IDs belonging to the parent storey levels
      const levelEntityIds = new Set<string>();
      if (metaObjects && parentStoreyIds.size > 0) {
        const collectChildren = (mo: any) => {
          levelEntityIds.add(mo.id);
          if (mo.children) {
            for (const child of mo.children) {
              collectChildren(child);
            }
          }
        };
        parentStoreyIds.forEach(storeyId => {
          const storeyMo = metaObjects[storeyId];
          if (storeyMo) collectChildren(storeyMo);
        });
      }

      const allIds = safeObjectIds(scene);

      if (levelEntityIds.size > 0) {
        // Hide everything NOT on this level
        const otherLevelIds = allIds.filter((id: string) => !levelEntityIds.has(id));
        if (otherLevelIds.length > 0) scene.setObjectsVisible(otherLevelIds, false);

        // Show level objects and x-ray them
        const levelIds = [...levelEntityIds];
      scene.setObjectsVisible(levelIds, true);
      scene.setObjectsXRayed(levelIds, true);
      scene.setObjectsPickable(levelIds, false);
    } else {
      // Fallback: x-ray everything (no level info)
      scene.setObjectsVisible(allIds, true);
      scene.setObjectsXRayed(allIds, true);
      scene.setObjectsPickable(allIds, false);
    }

      // Un-xray room + its contents
      const solidRoomIds = [...spaceOnlyEntityIds, ...roomContentIds].filter(id => !areaSet.has(id));
      if (solidRoomIds.length > 0) {
        scene.setObjectsXRayed(solidRoomIds, false);
        scene.setObjectsPickable(solidRoomIds, true);
      }

      // Show room spaces with slight transparency
      spaceOnlyEntityIds.forEach(id => {
        if (areaSet.has(id)) return;
        const entity = scene.objects?.[id];
        if (entity) {
          entity.visible = true;
          entity.pickable = true;
          entity.xrayed = false;
          entity.opacity = 0.7;
          // Don't reset colorize — theme will re-apply after filter completes
        }
      });

      // NOTE: Auto fly removed — fly behavior is ONLY triggered by explicit user
      // interactions (handleSpaceToggle for checkbox, handleSpaceClick for name click)
    }

    // Ensure area spaces stay hidden
    areaSpaceIdsRef.current.forEach(id => {
      const entity = scene.objects?.[id];
      if (entity) { entity.visible = false; entity.pickable = false; }
    });

    prevVisibleRef.current = newVisibleSet;

    // Floor/space visibility event for labels and clipping
    const visibleFmGuids: string[] = [];
    if (checkedSpaces.size > 0) {
      const parentLevelGuids = new Set<string>();
      spaces.forEach(space => {
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

    // Resolve xeokit meta storey IDs for proper ceiling clipping
    const resolvedMetaIds: string[] = [];
    if (visibleFmGuids.length > 0) {
      const metaObjects = viewer.metaScene?.metaObjects || {};
      const normalizedFmGuids = new Set(visibleFmGuids.map((g: string) => g.toLowerCase().replace(/-/g, '')));
      Object.values(metaObjects).forEach((mo: any) => {
        if (mo.type?.toLowerCase() !== 'ifcbuildingstorey') return;
        const sysId = (mo.originalSystemId || mo.id || '').toLowerCase().replace(/-/g, '');
        if (normalizedFmGuids.has(sysId)) resolvedMetaIds.push(mo.id);
      });
    }

    // Compute floor bounds for proper ceiling clipping (matching floor switcher behavior)
    let floorBounds: { minY: number; maxY: number } | null = null;
    if (resolvedMetaIds.length === 1) {
      floorBounds = calculateFloorBounds(viewer, resolvedMetaIds[0]);
    }

    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
      detail: {
        floorId: visibleFmGuids.length === 1 ? visibleFmGuids[0] : null,
        floorName: null, bounds: floorBounds,
        visibleMetaFloorIds: resolvedMetaIds, visibleFloorFmGuids: visibleFmGuids,
        isAllFloorsVisible: !hasAnyFilter,
        isSoloFloor: visibleFmGuids.length === 1,
        fromFilterPanel: true,
        skipClipping: true,
      } as FloorSelectionEventDetail,
    }));

    console.debug('[FilterPanel] Applied filter. solidIds:', solidIds.size, '/', scene.objectIds.length, 'delta: show', toShow.length, 'hide', toHide.length);

    // Re-apply active theme after filter to prevent "native colors flash"
    // But skip if color filter is active — it takes precedence
    if (activeThemeIdRef.current && !(window as any).__colorFilterActive && !(window as any).__spacesForceVisible && checkedSpaces.size === 0) {
      window.dispatchEvent(new CustomEvent(VIEWER_THEME_REQUESTED_EVENT, {
        detail: { themeId: activeThemeIdRef.current }
      }));
    }

    isApplyingRef.current = false;
    }); // end requestAnimationFrame
    }, 500); // debounce 500ms
  }, [getXeokitViewer, checkedSources, checkedLevels, checkedSpaces, checkedCategories,
    levels, spaces, sources, sharedModels, xrayMode]);

  // ── Apply coloring separately (does NOT trigger visibility recalc) ──────
  const applyColoring = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;
    const eMap = entityMapRef.current;
    if (eMap.size === 0) return;

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
          if (entity) {
            entity.colorize = rgb;
            entity.visible = true;
            entity.pickable = true;
            entity.opacity = 0.7;
          }
        });
      });
    }

    // Category colors
    if (autoColorCategories) {
      for (const [ifcType, ids] of typeIndexRef.current) {
        const catName = ifcType.replace(/^Ifc/, '').replace(/StandardCase$/, '');
        const catColor = categoryColors.get(catName);
        if (catColor) {
          const rgb = hexToRgb01(catColor);
          ids.forEach(id => {
            const entity = scene.objects?.[id];
            if (entity) entity.colorize = rgb;
          });
        }
      }
    }
  }, [getXeokitViewer, levels, spaces, levelColors, spaceColors, categoryColors,
    autoColorEnabled, autoColorSpaces, autoColorCategories]);

  // Apply filter when filter state changes
  useEffect(() => {
    if (!isVisible) return;
    applyFilterVisibility();
  }, [checkedSources, checkedLevels, checkedSpaces, checkedCategories, xrayMode, applyFilterVisibility, isVisible, entityMapVersion]);

  // Apply coloring separately when color settings change
  useEffect(() => {
    if (!isVisible) return;
    if (autoColorEnabled || autoColorSpaces || autoColorCategories) {
      // Apply after a short delay to let visibility settle
      const timer = setTimeout(applyColoring, 50);
      return () => clearTimeout(timer);
    }
  }, [levelColors, spaceColors, categoryColors, autoColorEnabled, autoColorSpaces, autoColorCategories, applyColoring, isVisible]);

  // Track active viewer theme so cleanup can re-apply it
  const activeThemeIdRef = useRef<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      activeThemeIdRef.current = detail?.themeId ?? null;
    };
    window.addEventListener(VIEWER_THEME_CHANGED_EVENT, handler);
    return () => window.removeEventListener(VIEWER_THEME_CHANGED_EVENT, handler);
  }, []);

  // Cleanup when panel closes
  useEffect(() => {
    if (isVisible) return;
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;

    // Check if any filter is still active
    const anyFiltersActive = checkedSources.size > 0 || checkedLevels.size > 0 ||
      checkedSpaces.size > 0 || checkedCategories.size > 0;

    // Always clean up visual enhancements (xray, colorize) — but preserve color filter
    try {
      const xIds = scene.xrayedObjectIds;
      if (xIds?.length > 0) {
        scene.setObjectsXRayed(xIds, false);
        scene.setObjectsPickable(xIds, true);
      }
    } catch (_e) { /* ignore */ }
    if (!(window as any).__colorFilterActive) {
      try { const cIds = scene.colorizedObjectIds; if (cIds?.length > 0) scene.setObjectsColorized(cIds, false); } catch (_e) { /* ignore */ }
    }

    if (anyFiltersActive) {
      // Filters are active — preserve visibility state, only re-apply theme/colors on visible objects
      if (activeThemeIdRef.current) {
        window.dispatchEvent(new CustomEvent(VIEWER_THEME_REQUESTED_EVENT, {
          detail: { themeId: activeThemeIdRef.current }
        }));
      } else {
        applyArchitectColors(viewer);
      }
    } else {
      // No filters active — full cleanup: restore everything
      const sceneModels = scene.models || {};
      Object.values(sceneModels).forEach((model: any) => {
        if (typeof model.visible !== 'undefined' && !model.visible) {
          model.visible = true;
        }
      });
      scene.setObjectsVisible(scene.objectIds, true);
      scene.setObjectsPickable(scene.objectIds, true);
      // Only reset opacity if visualization is NOT active (otherwise we'd wipe sensor colors)
      if (!(window as any).__spacesForceVisible) {
        scene.objectIds.forEach((id: string) => {
          const entity = scene.objects?.[id];
          if (entity && entity.opacity < 1) entity.opacity = 1.0;
        });
      }

      if (activeThemeIdRef.current) {
        window.dispatchEvent(new CustomEvent(VIEWER_THEME_REQUESTED_EVENT, {
          detail: { themeId: activeThemeIdRef.current }
        }));
      } else {
        applyArchitectColors(viewer);
      }
      if (!(window as any).__spacesForceVisible) {
        hideSpaceAndAreaObjects(viewer);
      }
    }
    prevVisibleRef.current = null;
  }, [isVisible, getXeokitViewer, checkedSources, checkedLevels, checkedSpaces, checkedCategories]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSourceToggle = useCallback((guid: string, checked: boolean) => {
    setCheckedSources(prev => { const n = new Set(prev); checked ? n.add(guid) : n.delete(guid); return n; });
  }, []);

  const handleLevelToggle = useCallback((fmGuid: string, checked: boolean) => {
    setCheckedLevels(prev => { const n = new Set(prev); checked ? n.add(fmGuid) : n.delete(fmGuid); return n; });
  }, []);

  const handleSpaceToggle = useCallback((fmGuid: string, checked: boolean) => {
    setCheckedSpaces(prev => { const n = new Set(prev); checked ? n.add(fmGuid) : n.delete(fmGuid); return n; });
    if (!checked) return; // Only fly on check, not uncheck
    // Checkbox = zoom to space with camera OUTSIDE (expanded AABB)
    // Delay flyTo to let applyFilterVisibility run first and set up the cutaway
    setTimeout(() => {
      const viewer = getXeokitViewer();
      if (!viewer?.scene) return;
      const ids = entityMapRef.current.get(fmGuid) || [];
      if (ids.length > 0) {
        ids.forEach((id: string) => {
          const entity = viewer.scene.objects?.[id];
          if (entity) { entity.visible = true; entity.pickable = true; entity.xrayed = false; }
        });
        const firstEntity = viewer.scene.objects?.[ids[0]];
        if (firstEntity?.aabb) {
          // Expand AABB by 2x to position camera outside the space
          const aabb = [...firstEntity.aabb];
          const cx = (aabb[0] + aabb[3]) / 2, cy = (aabb[1] + aabb[4]) / 2, cz = (aabb[2] + aabb[5]) / 2;
          const dx = (aabb[3] - aabb[0]) * 0.5, dy = (aabb[4] - aabb[1]) * 0.5, dz = (aabb[5] - aabb[2]) * 0.5;
          const expanded = [cx - dx * 2, cy - dy * 2, cz - dz * 2, cx + dx * 2, cy + dy * 2, cz + dz * 2];
          viewer.cameraFlight?.flyTo({ aabb: expanded, duration: 0.5 });
        }
      }
    }, 600); // After 500ms debounce of applyFilterVisibility
  }, [getXeokitViewer]);

  const handleCategoryToggle = useCallback((name: string, checked: boolean) => {
    setCheckedCategories(prev => { const n = new Set(prev); checked ? n.add(name) : n.delete(name); return n; });
  }, []);

  const handleSpaceClick = useCallback((fmGuid: string) => {
    onNodeSelect?.(fmGuid);
    // Also select the space so cutaway activates
    setCheckedSpaces(prev => {
      const n = new Set(prev);
      n.add(fmGuid);
      return n;
    });
    // Delay fly-inside to let applyFilterVisibility run first
    setTimeout(() => {
      const viewer = getXeokitViewer();
      if (!viewer?.scene) return;
      const ids = entityMapRef.current.get(fmGuid) || [];
      if (ids.length > 0) {
        // Make visible (no selection — no green highlight)
        ids.forEach((id: string) => {
          const entity = viewer.scene.objects?.[id];
          if (entity) {
            entity.visible = true;
            entity.pickable = true;
            entity.xrayed = false;
          }
        });
        // Name click = fly camera INSIDE the space (use center point)
        const firstEntity = viewer.scene.objects?.[ids[0]];
        if (firstEntity?.aabb) {
          const aabb = firstEntity.aabb;
          const cx = (aabb[0] + aabb[3]) / 2, cy = (aabb[1] + aabb[4]) / 2, cz = (aabb[2] + aabb[5]) / 2;
          const height = aabb[4] - aabb[1];
          viewer.cameraFlight?.flyTo({
            eye: [cx, cy + height * 0.3, cz],
            look: [cx + 2, cy + height * 0.3, cz],
            up: [0, 1, 0],
            duration: 0.5
          });
        }
      }
    }, 600); // After 500ms debounce of applyFilterVisibility
  }, [getXeokitViewer, onNodeSelect]);

  const handleResetSection = useCallback((section: 'sources' | 'levels' | 'spaces' | 'categories' | 'annotations' | 'modifications') => {
    switch (section) {
      case 'sources': setCheckedSources(new Set()); break;
      case 'levels': setCheckedLevels(new Set()); break;
      case 'spaces': setCheckedSpaces(new Set()); break;
      case 'categories': setCheckedCategories(new Set()); break;
      case 'annotations': 
        setCheckedAnnotations(new Set());
        window.dispatchEvent(new CustomEvent(ANNOTATION_FILTER_EVENT, { detail: { visibleCategories: [] } }));
        break;
      case 'modifications':
        setShowMovedAssets(false);
        setShowDeletedAssets(false);
        break;
    }
  }, []);

  const handleResetAll = useCallback(() => {
    setCheckedSources(new Set());
    setCheckedLevels(new Set());
    setCheckedSpaces(new Set());
    setCheckedCategories(new Set());
    setCheckedAnnotations(new Set());
    setShowMovedAssets(false);
    setShowDeletedAssets(false);
    window.dispatchEvent(new CustomEvent(ANNOTATION_FILTER_EVENT, { detail: { visibleCategories: [] } }));
  }, []);

  // ── Fetch modified assets ────────────────────────────────────────────────
  const fetchModifiedRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!buildingFmGuid) return;
    const fetchModified = async () => {
      const { data } = await supabase
        .from('assets')
        .select('fm_guid, modification_status')
        .eq('building_fm_guid', buildingFmGuid)
        .not('modification_status', 'is', null);
      setModifiedAssets(data || []);
    };
    fetchModifiedRef.current = fetchModified;
    if (modificationsOpen) fetchModified();
  }, [modificationsOpen, buildingFmGuid]);

  useEffect(() => {
    const handler = () => {
      setTimeout(() => fetchModifiedRef.current(), 500);
    };
    window.addEventListener('OBJECT_DELETE', handler);
    return () => window.removeEventListener('OBJECT_DELETE', handler);
  }, []);

  // ── Apply modification visualization ────────────────────────────────
  useEffect(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene || !viewer?.metaScene?.metaObjects) return;

    const metaObjects = viewer.metaScene.metaObjects;
    const normGuid = (g: string) => (g || '').toLowerCase().replace(/-/g, '');

    const guidToEntityId = new Map<string, string>();
    Object.values(metaObjects).forEach((mo: any) => {
      const sysId = mo.originalSystemId || mo.id || '';
      guidToEntityId.set(normGuid(sysId), mo.id);
    });

    const movedGuids = new Set(modifiedAssets.filter(a => a.modification_status === 'moved').map(a => normGuid(a.fm_guid)));
    const deletedGuids = new Set(modifiedAssets.filter(a => a.modification_status === 'deleted').map(a => normGuid(a.fm_guid)));

    movedGuids.forEach(g => {
      const eid = guidToEntityId.get(g);
      if (!eid) return;
      const entity = viewer.scene.objects?.[eid];
      if (!entity) return;
      if (showMovedAssets) {
        entity.colorize = [1, 0.6, 0.1];
      } else {
        entity.colorize = null;
      }
    });

    if (!showMovedAssets && !showDeletedAssets && viewer) {
      recolorArchitectObjects(viewer);
    }

    deletedGuids.forEach(g => {
      const eid = guidToEntityId.get(g);
      if (!eid) return;
      const entity = viewer.scene.objects?.[eid];
      if (!entity) return;
      if (showDeletedAssets) {
        entity.visible = true;
        entity.pickable = true;
        entity.colorize = [1, 0.2, 0.2];
      } else {
        entity.visible = false;
        entity.pickable = false;
      }
    });
  }, [showMovedAssets, showDeletedAssets, modifiedAssets, getXeokitViewer]);

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
    <>
    {/* Backdrop */}
    {/* Backdrop removed for stability — panel closes only via X button */}
    <div
      className={cn(
        "fixed left-0 top-[44px] z-[65] w-[85%] max-w-[320px] sm:w-[320px]",
        "bg-card/95 backdrop-blur-xl border-r border-border/30 shadow-2xl text-foreground",
        "flex flex-col max-h-[calc(100dvh-44px)]",
        "animate-in slide-in-from-left duration-200"
      )}
      style={{ bottom: 'env(safe-area-inset-bottom, 0px)' }}
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
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2 gap-1 text-foreground"
            onClick={() => {
              // Reset all colors: level, space, category colorization + insights
              setLevelColors(new Map());
              setSpaceColors(new Map());
              setCategoryColors(new Map());
              setAutoColorEnabled(false);
              setAutoColorSpaces(false);
              setAutoColorCategories(false);
              // Clear global viz flags
              (window as any).__colorFilterActive = false;
              const vizSet = (window as any).__vizColorizedEntityIds;
              if (vizSet instanceof Set) vizSet.clear();
              // Dispatch insights reset + restore architect colors
              window.dispatchEvent(new CustomEvent('INSIGHTS_COLOR_RESET'));
              const viewer = getXeokitViewer();
              if (viewer) applyArchitectColors(viewer);
            }}
            title="Reset all colors to default"
          >
            <Paintbrush className="h-3.5 w-3.5" />
            Reset colors
          </Button>
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
                label={space.designation ? `${space.name} (${space.designation})` : space.name}
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

          {/* Modification filter */}
          <FilterSection
            title="Modifications"
            count={modifiedAssets.length}
            selectedCount={(showMovedAssets ? 1 : 0) + (showDeletedAssets ? 1 : 0)}
            isOpen={modificationsOpen}
            onToggle={() => setModificationsOpen(!modificationsOpen)}
            onReset={() => handleResetSection('modifications')}
          >
            <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/30 transition-colors cursor-pointer"
              onClick={() => setShowMovedAssets(p => !p)}>
              <Checkbox checked={showMovedAssets} className="h-4 w-4 shrink-0"
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={(v) => setShowMovedAssets(!!v)} />
              <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: '#FF9919' }} />
              <span className="text-sm truncate flex-1 text-foreground">Show moved objects</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {modifiedAssets.filter(a => a.modification_status === 'moved').length}
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/30 transition-colors cursor-pointer"
              onClick={() => setShowDeletedAssets(p => !p)}>
              <Checkbox checked={showDeletedAssets} className="h-4 w-4 shrink-0"
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={(v) => setShowDeletedAssets(!!v)} />
              <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: '#FF3333' }} />
              <span className="text-sm truncate flex-1 text-foreground">Show deleted objects</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {modifiedAssets.filter(a => a.modification_status === 'deleted').length}
              </span>
            </div>
          </FilterSection>

          {/* Annotations */}
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
    </>
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
