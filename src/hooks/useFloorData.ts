import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface FloorInfo {
  id: string;           // Representative metaObject ID for this floor group
  name: string;
  shortName: string;
  metaObjectIds: string[];        // All metaObject IDs with this name (from all models)
  databaseLevelFmGuids: string[]; // All database fmGuids for this floor
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
 */
export function useFloorData(
  viewerRef: React.MutableRefObject<any>,
  buildingFmGuid: string | undefined | null
) {
  const [floorNamesMap, setFloorNamesMap] = useState<Map<string, string>>(new Map());
  const [floors, setFloors] = useState<FloorInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── DB name fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!buildingFmGuid) return;

    let cancelled = false;

    const fetchFloorNames = async () => {
      try {
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

  // ── Extract floors from metaScene ───────────────────────────────────────
  const extractFloors = useCallback((): FloorInfo[] => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects) return [];

    const metaObjects = viewer.metaScene.metaObjects;
    const floorsByName = new Map<string, FloorInfo>();

    Object.values(metaObjects).forEach((metaObject: any) => {
      if (metaObject?.type?.toLowerCase() !== 'ifcbuildingstorey') return;

      const fmGuid = metaObject.originalSystemId || metaObject.id;

      // Resolve name: DB first → metaObject.name fallback → placeholder
      const dbName =
        floorNamesMap.get(fmGuid) ||
        floorNamesMap.get(fmGuid.toLowerCase()) ||
        floorNamesMap.get(fmGuid.toUpperCase());

      let displayName = metaObject.name || 'Unknown Floor';
      if (dbName) {
        displayName = dbName;
      } else if (displayName.match(/^[0-9A-Fa-f-]{30,}$/)) {
        displayName = '__GUID_PLACEHOLDER__';
      }

      const shortMatch = displayName.match(/(\d+)/);
      const shortName = shortMatch ? shortMatch[1] : displayName.substring(0, 10);

      if (floorsByName.has(displayName)) {
        const existing = floorsByName.get(displayName)!;
        existing.metaObjectIds.push(metaObject.id);
        if (!existing.databaseLevelFmGuids.includes(fmGuid)) {
          existing.databaseLevelFmGuids.push(fmGuid);
        }
      } else {
        floorsByName.set(displayName, {
          id: metaObject.id,
          name: displayName,
          shortName,
          metaObjectIds: [metaObject.id],
          databaseLevelFmGuids: [fmGuid],
        });
      }
    });

    const result = Array.from(floorsByName.values());
    result.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

    // Replace GUID placeholders with sequential "Plan X"
    let unknownIndex = 1;
    result.forEach((floor) => {
      if (floor.name === '__GUID_PLACEHOLDER__') {
        floor.name = `Plan ${unknownIndex}`;
        floor.shortName = String(unknownIndex);
        unknownIndex++;
      }
    });

    return result;
  }, [getXeokitViewer, floorNamesMap]);

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
