import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { on } from '@/lib/event-bus';

export interface FloorInfo {
  id: string;           // Representative metaObject ID for this floor group
  name: string;
  shortName: string;
  metaObjectIds: string[];        // All metaObject IDs with this name (from all models)
  databaseLevelFmGuids: string[]; // All database fmGuids for this floor
}

// ── A-model detection (same logic as NativeXeokitViewer) ─────────────────
const NON_ARCH_PREFIXES = ['BRAND', 'FIRE', 'V-', 'V_', 'VS-', 'VS_', 'EL-', 'EL_', 'MEP', 'SPRINKLER', 'K-', 'K_', 'R-', 'R_', 'S-', 'S_', 'B-', 'B_'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/**
 * Detect architectural models by name. Matches:
 * "A-modell", "A modell", "ARK", "Arkitekt", "A_modell", names starting with "A" (single char prefix)
 */
export function isArchitecturalModel(name: string | null): boolean {
  if (!name || UUID_RE.test(name)) return false;
  const upper = name.toUpperCase().trim();
  if (NON_ARCH_PREFIXES.some(p => upper.startsWith(p))) return false;
  // Explicit matches
  if (upper.includes('ARKITEKT') || upper.includes('A-MODELL') || upper.includes('A_MODELL') || upper.includes('A MODELL') || upper === 'ARK') return true;
  // Single-char prefix: "A" followed by separator or end
  if (upper.charAt(0) === 'A' && (upper.length === 1 || /^A[\s\-_.]/.test(upper))) return true;
  return false;
}

interface DbStorey {
  fm_guid: string;
  common_name: string | null;
  name: string | null;
  attributes: Record<string, any> | null;
}

/**
 * Shared hook for extracting and naming floors from DB + xeokit metaScene.
 * Single source of truth used by FloorVisibilitySelector, FloatingFloorSwitcher,
 * and ViewerFilterPanel (levels section).
 *
 * Source priority:
 *   1. DB `assets` table storeys where parentCommonName matches an A-model name
 *   2. xeokit metaScene storeys as fallback when DB has no A-model storeys
 *
 * Name resolution:
 *   1. DB `common_name` (authoritative)
 *   2. DB `attributes.levelName`
 *   3. Sequential "Plan N" for unnamed storeys
 *
 * xeokit metaObjectIds are merged into matching DB floors for visibility toggling.
 */
export function useFloorData(
  viewerRef: React.MutableRefObject<any>,
  buildingFmGuid: string | undefined | null
) {
  const [dbStoreys, setDbStoreys] = useState<DbStorey[]>([]);
  const [floors, setFloors] = useState<FloorInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Keep a stable ref to floorNamesMap for backward compat (used by callers)
  const [floorNamesMap, setFloorNamesMap] = useState<Map<string, string>>(new Map());

  // ── Step 1: Fetch all Building Storey records from DB ──────────────────
  useEffect(() => {
    if (!buildingFmGuid) return;
    let cancelled = false;

    const fetch = async () => {
      try {
        const { data, error } = await supabase
          .from('assets')
          .select('fm_guid, common_name, name, attributes')
          .eq('building_fm_guid', buildingFmGuid)
          .eq('category', 'Building Storey');

        if (!error && data && data.length > 0 && !cancelled) {
          setDbStoreys(data as DbStorey[]);
          // Build floorNamesMap for backward compat
          const nameMap = new Map<string, string>();
          (data as DbStorey[]).forEach((s) => {
            const displayName = s.common_name
              || (s.attributes as any)?.levelName
              || s.name
              || null;
            if (!displayName) return;
            nameMap.set(s.fm_guid, displayName);
            nameMap.set(s.fm_guid.toLowerCase(), displayName);
            nameMap.set(s.fm_guid.toUpperCase(), displayName);
          });
          setFloorNamesMap(nameMap);
        }
      } catch (e) {
        console.debug('[useFloorData] Failed to fetch storeys:', e);
      }
    };

    fetch();
    return () => { cancelled = true; };
  }, [buildingFmGuid]);

  // ── XEOkit viewer accessor ──────────────────────────────────────────────
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer
        ?? (window as any).__nativeXeokitViewer
        ?? null;
    } catch {
      return (window as any).__nativeXeokitViewer ?? null;
    }
  }, [viewerRef]);

  // ── Build floors from DB storeys + merge xeokit metaObjectIds ──────────
  const buildFloors = useCallback((): FloorInfo[] => {
    // Filter DB storeys to A-model storeys
    const aModelStoreys = dbStoreys.filter((s) => {
      const parentModel = (s.attributes as any)?.parentCommonName || null;
      return isArchitecturalModel(parentModel);
    });

    // If no A-model storeys in DB, fall back to ALL DB storeys
    const sourceStoreys = aModelStoreys.length > 0 ? aModelStoreys : dbStoreys;

    if (sourceStoreys.length === 0) return [];

    // Build FloorInfo from DB records
    const floorMap = new Map<string, FloorInfo>();
    let guidCounter = 0;

    sourceStoreys.forEach((s) => {
      const displayName = s.common_name
        || (s.attributes as any)?.levelName
        || s.name
        || null;

      let finalName: string;
      let isGuidName = false;

      if (displayName && !displayName.match(/^[0-9A-Fa-f-]{30,}$/)) {
        finalName = displayName;
      } else {
        guidCounter++;
        finalName = `Plan ${guidCounter}`;
        isGuidName = true;
      }

      const shortMatch = finalName.match(/(\d+)/);
      const shortName = shortMatch ? shortMatch[1] : finalName.substring(0, 10);
      const key = isGuidName ? `__guid_${guidCounter}` : finalName;

      if (!isGuidName && floorMap.has(finalName)) {
        const existing = floorMap.get(finalName)!;
        if (!existing.databaseLevelFmGuids.includes(s.fm_guid)) {
          existing.databaseLevelFmGuids.push(s.fm_guid);
        }
      } else {
        floorMap.set(key, {
          id: s.fm_guid, // Will be replaced by metaObjectId if found
          name: finalName,
          shortName,
          metaObjectIds: [],
          databaseLevelFmGuids: [s.fm_guid],
        });
      }
    });

    // Merge xeokit metaObjectIds into matching floors
    const viewer = getXeokitViewer();
    if (viewer?.metaScene?.metaObjects) {
      const metaObjects = viewer.metaScene.metaObjects;

      Object.values(metaObjects).forEach((metaObject: any) => {
        if (metaObject?.type?.toLowerCase() !== 'ifcbuildingstorey') return;

        const fmGuid = metaObject.originalSystemId || metaObject.id;

        const floorValues = Array.from(floorMap.values());
        for (const floor of floorValues) {
          const guidMatch = floor.databaseLevelFmGuids.some(g =>
            g.toLowerCase() === fmGuid.toLowerCase()
          );

          if (guidMatch) {
            if (!floor.metaObjectIds.includes(metaObject.id)) {
              floor.metaObjectIds.push(metaObject.id);
            }
            // Use first matched metaObject id as the representative id
            if (floor.id === floor.databaseLevelFmGuids[0]) {
              floor.id = metaObject.id;
            }
            break;
          }
        }
      });
    }

    const result = Array.from(floorMap.values());
    result.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    return result;
  }, [dbStoreys, getXeokitViewer]);

  // ── Rebuild floors when DB data or viewer changes ──────────────────────
  useEffect(() => {
    if (dbStoreys.length === 0) return;
    const result = buildFloors();
    if (result.length > 0) {
      setFloors(result);
      setIsLoading(false);
    }
  }, [dbStoreys, buildFloors]);

  // ── Poll for xeokit viewer readiness to merge metaObjectIds ────────────
  useEffect(() => {
    if (dbStoreys.length === 0) return;

    let attempts = 0;
    const maxAttempts = 20;

    const check = () => {
      const viewer = getXeokitViewer();
      if (viewer?.metaScene?.metaObjects) {
        const result = buildFloors();
        if (result.length > 0) {
          setFloors(result);
          setIsLoading(false);
        }
        return true;
      }
      return false;
    };

    if (check()) return;

    const interval = setInterval(() => {
      if (check() || attempts++ >= maxAttempts) {
        clearInterval(interval);
        setIsLoading(false);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [dbStoreys, buildFloors, getXeokitViewer]);

  // ── Re-merge when models stream in (progressive loading) ───────────────
  useEffect(() => {
    const offModelsLoaded = on('VIEWER_MODELS_LOADED', () => {
      const result = buildFloors();
      if (result.length > 0) {
        setFloors(result);
        setIsLoading(false);
      }
    });

    const viewer = getXeokitViewer();
    let sceneUnsub: (() => void) | null = null;
    if (viewer?.scene) {
      const handler = () => {
        const result = buildFloors();
        if (result.length > 0) setFloors(result);
      };
      viewer.scene.on('modelLoaded', handler);
      sceneUnsub = () => {
        try { viewer.scene?.off?.('modelLoaded', handler); } catch {}
      };
    }

    return () => {
      offModelsLoaded();
      sceneUnsub?.();
    };
  }, [buildFloors, getXeokitViewer]);

  return { floors, floorNamesMap, isLoading };
}
