import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { useModelNames } from '@/hooks/useModelNames';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';

const isGuid = (str: string): boolean =>
  !!str && str.length >= 20 && /^[0-9a-f]{8}[-]?[0-9a-f]{4}/i.test(str);

export interface ModelInfo {
  id: string;
  name: string;
  shortName: string;
  loaded?: boolean;
}

/**
 * Shared hook for listing BIM models with friendly names.
 * Resolution priority:
 *   1. geometry_entity_map (canonical mapping layer)
 *   2. useModelNames hook (xkt_models + Asset+ API)
 *   3. Asset+ storey attributes (parentBimObjectId → parentCommonName)
 *
 * Also provides a batch-optimised `applyModelVisibility` function.
 */
export function useModelData(
  viewerRef: React.MutableRefObject<any>,
  buildingFmGuid: string | undefined | null
) {
  const { allData } = useContext(AppContext);
  const { modelNamesMap, isLoading: isLoadingNames } = useModelNames(buildingFmGuid);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // ── geometry_entity_map storey lookup (primary) ──────────────────────────
  const [gemStoreyData, setGemStoreyData] = useState<any[]>([]);

  useEffect(() => {
    if (!buildingFmGuid) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('geometry_entity_map' as any)
        .select('asset_fm_guid, model_id, source_model_guid, source_model_name, source_storey_name')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('entity_type', 'storey');
      if (!error && data && !cancelled) {
        setGemStoreyData(data as any[]);
      }
    })();
    return () => { cancelled = true; };
  }, [buildingFmGuid]);

  // ── Storey-based source lookup (geometry_entity_map primary, allData fallback) ──
  const storeyLookup = useMemo(() => {
    const byGuid = new Map<string, { parentName: string; sourceGuid: string }>();
    const byName = new Map<string, { parentName: string; sourceGuid: string }>();

    // Primary: geometry_entity_map
    if (gemStoreyData.length > 0) {
      gemStoreyData.forEach((row: any) => {
        const parentName = row.source_model_name;
        const sourceGuid = row.source_model_guid || row.model_id || '';
        if (parentName && !isGuid(parentName)) {
          const fmGuid = (row.asset_fm_guid || '').toLowerCase();
          if (fmGuid) {
            byGuid.set(fmGuid, { parentName, sourceGuid });
            byGuid.set(fmGuid.replace(/-/g, ''), { parentName, sourceGuid });
          }
        }
      });
      if (byGuid.size > 0) return { byGuid, byName };
    }

    // Fallback: allData
    if (!allData || !buildingFmGuid) return { byGuid, byName };

    allData
      .filter((a: any) =>
        (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid &&
        (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey')
      )
      .forEach((a: any) => {
        const attrs = a.attributes || {};
        const fmGuid = (a.fmGuid || a.fm_guid || '').toLowerCase();
        const name = (a.commonName || a.common_name || a.name || '').toLowerCase().trim();
        const parentName = attrs.parentCommonName;
        const sourceGuid = attrs.parentBimObjectId || '';
        if (parentName && !isGuid(parentName)) {
          if (fmGuid) {
            byGuid.set(fmGuid, { parentName, sourceGuid });
            byGuid.set(fmGuid.replace(/-/g, ''), { parentName, sourceGuid });
          }
          if (name) byName.set(name, { parentName, sourceGuid });
        }
      });
    return { byGuid, byName };
  }, [gemStoreyData, allData, buildingFmGuid]);

  // Asset+ sources: parentBimObjectId → parentCommonName
  const assetPlusSources = useMemo(() => {
    const map = new Map<string, string>();

    // Primary: geometry_entity_map
    if (gemStoreyData.length > 0) {
      gemStoreyData.forEach((row: any) => {
        const guid = row.source_model_guid || row.model_id;
        const name = row.source_model_name;
        if (guid && name && !isGuid(name)) {
          map.set(guid, name);
        }
      });
      if (map.size > 0) return map;
    }

    // Fallback
    if (!allData || !buildingFmGuid) return map;
    allData
      .filter((a: any) =>
        (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid &&
        (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey')
      )
      .forEach((a: any) => {
        const attrs = a.attributes || {};
        const guid = attrs.parentBimObjectId;
        const name = attrs.parentCommonName;
        if (guid && name && !isGuid(name)) {
          map.set(guid, name);
        }
      });
    return map;
  }, [gemStoreyData, allData, buildingFmGuid]);

  // ── XEOkit accessor ──────────────────────────────────────────────────────
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer
        ?? (window as any).__nativeXeokitViewer
        ?? null;
    } catch {
      return (window as any).__nativeXeokitViewer ?? null;
    }
  }, [viewerRef]);

  // ── Derive dbModels from useModelNames ────────────────────────────────────
  const dbModels = useMemo(() => {
    if (modelNamesMap.size === 0) return [];
    const seen = new Set<string>();
    const result: { id: string; name: string; fileName: string }[] = [];
    for (const [key, name] of modelNamesMap.entries()) {
      if (key !== key.toLowerCase()) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const canonicalId = key.replace(/\.xkt$/i, '');
      const fileName = key.endsWith('.xkt') ? key : key + '.xkt';
      result.push({ id: canonicalId, name, fileName });
    }
    return result;
  }, [modelNamesMap]);

  // ── Extract models from scene ─────────────────────────────────────────────
  const extractModels = useCallback((): ModelInfo[] => {
    const viewer = getXeokitViewer();
    const sceneModels = viewer?.scene?.models || {};
    const extracted: ModelInfo[] = [];
    const processedFileNames = new Set<string>();

    // 1. Scene models
    Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
      const rawName = model.id || modelId;
      const fileName = rawName.endsWith('.xkt') ? rawName : rawName + '.xkt';
      const fileNameWithoutExt = fileName.replace(/\.xkt$/i, '');

      processedFileNames.add(fileName.toLowerCase());
      processedFileNames.add(fileNameWithoutExt.toLowerCase());

      let matchedName: string | undefined;

      // Strategy 1–5: modelNamesMap lookups
      matchedName = modelNamesMap.get(fileName)
        || modelNamesMap.get(fileNameWithoutExt)
        || modelNamesMap.get(fileName.toLowerCase())
        || modelNamesMap.get(fileNameWithoutExt.toLowerCase())
        || modelNamesMap.get(modelId)
        || modelNamesMap.get(modelId.toLowerCase());

      if (!matchedName && modelNamesMap.size > 0) {
        for (const [key, value] of modelNamesMap.entries()) {
          const kc = key.replace(/\.xkt$/i, '').toLowerCase();
          const ic = fileNameWithoutExt.toLowerCase();
          if (kc.includes(ic) || ic.includes(kc)) { matchedName = value; break; }
        }
      }

      // Strategy 6: storey lookup from metaScene
      if (!matchedName && (storeyLookup.byGuid.size > 0 || storeyLookup.byName.size > 0)) {
        const metaObjects = viewer?.metaScene?.metaObjects;
        if (metaObjects && model.objects) {
          const objKeys = Object.keys(model.objects);
          for (let k = 0; k < Math.min(objKeys.length, 500); k++) {
            const mo = metaObjects[objKeys[k]];
            if (mo?.type === 'IfcBuildingStorey') {
              const sysId = (mo.originalSystemId || '').toLowerCase();
              const moName = (mo.name || '').toLowerCase().trim();
              const byGuid = storeyLookup.byGuid.get(sysId) || storeyLookup.byGuid.get(sysId.replace(/-/g, ''));
              if (byGuid) { matchedName = byGuid.parentName; break; }
              const byName = storeyLookup.byName.get(moName);
              if (byName) { matchedName = byName.parentName; break; }
            }
          }
        }
      }

      const friendlyName = matchedName || (isLoadingNames ? 'Loading...' : fileNameWithoutExt.replace(/-/g, ' '));
      const shortName = friendlyName.length > 30 ? friendlyName.substring(0, 27) + '...' : friendlyName;

      extracted.push({ id: modelId, name: friendlyName, shortName, loaded: true });
    });

    // 2. DB models not yet loaded
    dbModels.forEach((dbModel) => {
      const fLower = dbModel.fileName.toLowerCase();
      const fNoExt = dbModel.fileName.replace(/\.xkt$/i, '').toLowerCase();
      if (processedFileNames.has(fLower) || processedFileNames.has(fNoExt)) return;

      const name = dbModel.name || dbModel.fileName.replace(/\.xkt$/i, '').replace(/-/g, ' ');
      const shortName = name.length > 30 ? name.substring(0, 27) + '...' : name;
      extracted.push({ id: dbModel.id, name, shortName, loaded: false });
    });

    // 3. Ensure all Asset+ sources represented
    const extractedNames = new Set(extracted.map((m) => m.name.toLowerCase()));
    assetPlusSources.forEach((sourceName) => {
      if (extractedNames.has(sourceName.toLowerCase())) return;
      const viewer2 = getXeokitViewer();
      const metaObjects = viewer2?.metaScene?.metaObjects;
      if (!metaObjects) return;

      for (const em of extracted) {
        if (!em.loaded) continue;
        const sceneModel = viewer2?.scene?.models?.[em.id];
        if (!sceneModel?.objects) continue;
        for (const objKey of Object.keys(sceneModel.objects).slice(0, 500)) {
          const mo = metaObjects[objKey];
          if (mo?.type === 'IfcBuildingStorey') {
            const sysId = (mo.originalSystemId || '').toLowerCase();
            const byGuid = storeyLookup.byGuid.get(sysId) || storeyLookup.byGuid.get(sysId.replace(/-/g, ''));
            if (byGuid && byGuid.parentName === sourceName) {
              em.name = sourceName;
              em.shortName = sourceName.length > 30 ? sourceName.substring(0, 27) + '...' : sourceName;
              return;
            }
          }
        }
      }
    });

    extracted.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    return extracted;
  }, [getXeokitViewer, modelNamesMap, dbModels, isLoadingNames, storeyLookup, assetPlusSources]);

  // ── Batch model visibility (perf optimisation) ─────────────────────────
  const applyModelVisibility = useCallback((visibleIds: Set<string>) => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene?.models) return;

    const scene = viewer.scene;
    const sceneModels = scene.models;

    // Collect IDs in two buckets
    const showIds: string[] = [];
    const hideIds: string[] = [];

    Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
      const isVisible = visibleIds.has(modelId);
      const objIds = Object.keys(model.objects || {});
      if (isVisible) showIds.push(...objIds);
      else hideIds.push(...objIds);

      if (typeof model.visible !== 'undefined') model.visible = isVisible;
    });

    // Batch calls — much faster than per-object iteration
    if (hideIds.length > 0 && scene.setObjectsVisible) scene.setObjectsVisible(hideIds, false);
    if (showIds.length > 0 && scene.setObjectsVisible) scene.setObjectsVisible(showIds, true);
  }, [getXeokitViewer]);

  // ── Poll for models ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isInitialized || isLoadingNames) return;

    const check = () => {
      const result = extractModels();
      if (result.length > 0) {
        setModels(result);
        setIsInitialized(true);
        return true;
      }
      return false;
    };

    if (check()) return;

    let attempts = 0;
    const interval = setInterval(() => {
      if (check() || attempts++ >= 10) {
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [extractModels, isInitialized, isLoadingNames]);

  // Re-extract when names update
  useEffect(() => {
    if (!isInitialized || modelNamesMap.size === 0) return;
    const updated = extractModels();
    if (updated.length > 0) setModels(updated);
  }, [modelNamesMap, isInitialized, extractModels]);

  return {
    models,
    isLoading: isLoadingNames,
    applyModelVisibility,
    extractModels,
    assetPlusSources,
    storeyLookup,
  };
}
