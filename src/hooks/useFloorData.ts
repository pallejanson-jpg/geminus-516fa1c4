import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useModelNames } from '@/hooks/useModelNames';

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

/**
 * Shared hook for extracting and naming floors from xeokit metaScene + database.
 * Single source of truth used by FloorVisibilitySelector, FloatingFloorSwitcher,
 * and ViewerFilterPanel (levels section).
 *
 * Name resolution priority:
 *   1. DB `assets` table `common_name` (authoritative)
 *   2. xeokit metaObject.name (fallback)
 *   3. Sequential "Plan N" for GUID-like names
 *
 * Model priority:
 *   When multiple models exist, only storeys from A-models (architectural)
 *   are used as the primary floor list. Non-A storey metaObjectIds are still
 *   merged into matching floors for correct visibility toggling.
 */
export function useFloorData(
  viewerRef: React.MutableRefObject<any>,
  buildingFmGuid: string | undefined | null
) {
  const { modelNamesMap } = useModelNames(buildingFmGuid);
  const [floorNamesMap, setFloorNamesMap] = useState<Map<string, string>>(new Map());
  const [floors, setFloors] = useState<FloorInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── DB name fetch (geometry_entity_map primary, assets fallback) ──────
  useEffect(() => {
    if (!buildingFmGuid) return;

    let cancelled = false;

    const fetchFloorNames = async () => {
      try {
        // Primary: geometry_entity_map — authoritative storey names
        const { data: gemData, error: gemError } = await supabase
          .from('geometry_entity_map' as any)
          .select('asset_fm_guid, source_storey_name, source_model_name, source_model_guid')
          .eq('building_fm_guid', buildingFmGuid)
          .eq('entity_type', 'storey');

        if (!gemError && gemData && (gemData as any[]).length > 0 && !cancelled) {
          const nameMap = new Map<string, string>();
          (gemData as any[]).forEach((row: any) => {
            const displayName = row.source_storey_name;
            if (!displayName) return;
            nameMap.set(row.asset_fm_guid, displayName);
            nameMap.set(row.asset_fm_guid.toLowerCase(), displayName);
            nameMap.set(row.asset_fm_guid.toUpperCase(), displayName);
          });
          if (nameMap.size > 0) {
            setFloorNamesMap(nameMap);
            return;
          }
        }

        // Fallback: assets table
        const { data, error } = await supabase
          .from('assets')
          .select('fm_guid, name, common_name')
          .eq('building_fm_guid', buildingFmGuid)
          .eq('category', 'Building Storey');

        if (!error && data && data.length > 0 && !cancelled) {
          const nameMap = new Map<string, string>();
          data.forEach((f) => {
            const displayName = f.common_name || f.name || null;
            if (!displayName) return;
            nameMap.set(f.fm_guid, displayName);
            nameMap.set(f.fm_guid.toLowerCase(), displayName);
            nameMap.set(f.fm_guid.toUpperCase(), displayName);
          });
          setFloorNamesMap(nameMap);
        }
      } catch (e) {
        console.debug('[useFloorData] Failed to fetch floor names:', e);
      }
    };

    fetchFloorNames();
    return () => { cancelled = true; };
  }, [buildingFmGuid]);

  // ── XEOkit viewer accessor ──────────────────────────────────────────────
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch {
      return null;
    }
  }, [viewerRef]);

  // ── Build model→objectIds lookup + detect A-models ──────────────────────
  const classifyModels = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene?.models) return { modelObjectSets: new Map<string, Set<string>>(), hasAModel: false, aModelObjectIds: new Set<string>() };

    const sceneModels = viewer.scene.models;
    const modelObjectSets = new Map<string, Set<string>>();
    let hasAModel = false;
    const aModelObjectIds = new Set<string>();

    Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
      const objIds = new Set(Object.keys(model.objects || {}));
      modelObjectSets.set(modelId, objIds);

      // Resolve friendly name from modelNamesMap (DB lookup) for A-model detection
      const friendlyName =
        modelNamesMap.get(modelId) ||
        modelNamesMap.get(modelId.toLowerCase()) ||
        modelNamesMap.get(modelId.replace(/\.xkt$/i, '')) ||
        modelNamesMap.get(modelId.replace(/\.xkt$/i, '').toLowerCase()) ||
        null;

      const isArch = isArchitecturalModel(friendlyName) || isArchitecturalModel(modelId);
      if (isArch) {
        hasAModel = true;
        objIds.forEach(id => aModelObjectIds.add(id));
      }
    });

    return { modelObjectSets, hasAModel, aModelObjectIds };
  }, [getXeokitViewer, modelNamesMap]);

  // ── Extract floors from metaScene ───────────────────────────────────────
  const extractFloors = useCallback((): FloorInfo[] => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects) return [];

    const metaObjects = viewer.metaScene.metaObjects;
    const { hasAModel, aModelObjectIds } = classifyModels();

    // Phase 1: Extract A-model storeys (or all if no A-model exists)
    const primaryFloors = new Map<string, FloorInfo>();
    let guidCounter = 0;

    Object.values(metaObjects).forEach((metaObject: any) => {
      if (metaObject?.type?.toLowerCase() !== 'ifcbuildingstorey') return;

      // If A-models exist, skip storeys that don't belong to A-models
      if (hasAModel && !aModelObjectIds.has(metaObject.id)) return;

      const fmGuid = metaObject.originalSystemId || metaObject.id;

      // Resolve name: DB first → metaObject.name fallback → placeholder
      const dbName =
        floorNamesMap.get(fmGuid) ||
        floorNamesMap.get(fmGuid.toLowerCase()) ||
        floorNamesMap.get(fmGuid.toUpperCase());

      let displayName = metaObject.name || 'Unknown Floor';
      let isGuidName = false;
      if (dbName) {
        displayName = dbName;
      } else if (displayName.match(/^[0-9A-Fa-f-]{30,}$/)) {
        guidCounter++;
        displayName = `Plan ${guidCounter}`;
        isGuidName = true;
      }

      const shortMatch = displayName.match(/(\d+)/);
      const shortName = shortMatch ? shortMatch[1] : displayName.substring(0, 10);

      if (!isGuidName && primaryFloors.has(displayName)) {
        const existing = primaryFloors.get(displayName)!;
        existing.metaObjectIds.push(metaObject.id);
        if (!existing.databaseLevelFmGuids.includes(fmGuid)) {
          existing.databaseLevelFmGuids.push(fmGuid);
        }
      } else {
        const key = isGuidName ? `__guid_${guidCounter}` : displayName;
        primaryFloors.set(key, {
          id: metaObject.id,
          name: displayName,
          shortName,
          metaObjectIds: [metaObject.id],
          databaseLevelFmGuids: [fmGuid],
        });
      }
    });

    // Phase 2: If A-models exist, merge non-A storey metaObjectIds into matching floors
    // This ensures toggling a floor pill also hides/shows V-model objects on that floor.
    if (hasAModel) {
      Object.values(metaObjects).forEach((metaObject: any) => {
        if (metaObject?.type?.toLowerCase() !== 'ifcbuildingstorey') return;
        if (aModelObjectIds.has(metaObject.id)) return; // Already processed

        const fmGuid = metaObject.originalSystemId || metaObject.id;

        // Find matching floor by databaseLevelFmGuid or by name
        const dbName =
          floorNamesMap.get(fmGuid) ||
          floorNamesMap.get(fmGuid.toLowerCase()) ||
          floorNamesMap.get(fmGuid.toUpperCase());
        const moName = dbName || metaObject.name || '';

        for (const floor of primaryFloors.values()) {
          // Match by DB fmGuid
          const guidMatch = floor.databaseLevelFmGuids.some(g =>
            g.toLowerCase() === fmGuid.toLowerCase()
          );
          // Match by display name (strip model suffix like " - 01")
          const strippedName = moName.replace(/\s*-\s*\d+$/, '').trim();
          const nameMatch = floor.name === moName || floor.name === strippedName;

          if (guidMatch || nameMatch) {
            if (!floor.metaObjectIds.includes(metaObject.id)) {
              floor.metaObjectIds.push(metaObject.id);
            }
            break;
          }
        }
      });
    }

    const result = Array.from(primaryFloors.values());
    result.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

    return result;
  }, [getXeokitViewer, floorNamesMap, classifyModels]);

  // ── Poll for floors until available ─────────────────────────────────────
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 20;

    const check = () => {
      const result = extractFloors();
      if (result.length > 0) {
        setFloors(result);
        setIsLoading(false);
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
  }, [extractFloors]);

  // ── Re-extract when DB names arrive (preserves existing floor IDs) ──────
  useEffect(() => {
    if (floorNamesMap.size === 0) return;
    const updated = extractFloors();
    if (updated.length > 0) {
      setFloors(updated);
    }
  }, [floorNamesMap, extractFloors]);

  return { floors, floorNamesMap, isLoading };
}
