/**
 * useModelLoader — Handles model metadata fetching, bootstrap, and progressive loading.
 *
 * Models are loaded with priority ordering (A-models first) and concurrent queue.
 * Each model becomes visible immediately as it loads (progressive streaming).
 * Secondary (non-architectural) models are lazy-loaded on demand.
 */

import { useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeGuid } from '@/lib/utils';
import { xktCacheService } from '@/services/xkt-cache-service';
import { getModelFromMemory, storeModelInMemory, getMemoryStats } from '@/hooks/useXktPreload';
import { applyArchitectColors } from '@/lib/architect-colors';
import { isRealTiling, getTilesToLoad } from '@/hooks/useFloorPriorityLoading';
import { INSIGHTS_COLOR_UPDATE_EVENT, type InsightsColorUpdateDetail } from '@/lib/viewer-events';
import type { GeometryManifest } from '@/lib/types';

export interface ModelInfo {
  model_id: string;
  model_name: string | null;
  storage_path: string;
  file_size: number | null;
  storey_fm_guid: string | null;
  is_chunk?: boolean;
  chunk_order?: number;
  parent_model_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

type ModelCandidate = ModelInfo & { synced_at?: string | null; source: 'db' | 'storage' };

type LoadPhase = 'init' | 'loading_sdk' | 'creating_viewer' | 'syncing' | 'bootstrapping' | 'loading_models' | 'ready' | 'error';

interface LoadProgress {
  loaded: number;
  total: number;
  /** Name of the model currently being loaded (progressive feedback) */
  currentModel?: string;
}

const getModelRecency = (model: Pick<ModelCandidate, 'updated_at' | 'created_at' | 'synced_at'>) =>
  new Date(model.updated_at || model.created_at || model.synced_at || 0).getTime();

const dedupeModelsByName = (items: ModelCandidate[]): ModelCandidate[] => {
  const unnamed: ModelCandidate[] = [];
  const named = new Map<string, ModelCandidate>();
  items.forEach((item) => {
    const key = item.model_name?.trim().toLowerCase();
    if (!key) { unnamed.push(item); return; }
    const existing = named.get(key);
    if (!existing || getModelRecency(item) >= getModelRecency(existing)) named.set(key, item);
  });
  return [...named.values(), ...unnamed];
};

const NON_ARCH_PREFIXES = ['BRAND', 'FIRE', 'V-', 'V_', 'VS-', 'VS_', 'EL-', 'EL_', 'MEP', 'SPRINKLER', 'K-', 'K_', 'R-', 'R_', 'S-', 'S_'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

const isArchitectural = (name: string | null) => {
  if (!name || UUID_RE.test(name)) return false;
  const upper = name.toUpperCase();
  if (NON_ARCH_PREFIXES.some(p => upper.startsWith(p))) return false;
  return upper.charAt(0) === 'A' || upper.includes('ARKITEKT');
};

export interface UseModelLoaderOptions {
  buildingFmGuid: string;
  isMobile: boolean;
}

export function useModelLoader({ buildingFmGuid, isMobile }: UseModelLoaderOptions) {
  const pendingInsightsColorRef = useRef<InsightsColorUpdateDetail | null>(null);

  /**
   * Fetch model metadata from DB (primary) and storage (fallback).
   * Returns deduplicated model list and storey data.
   */
  const fetchModelMetadata = useCallback(async () => {
    const [dbResult, storeyResult] = await Promise.all([
      supabase
        .from('xkt_models')
        .select('model_id, model_name, storage_path, file_size, storey_fm_guid, synced_at, is_chunk, chunk_order, parent_model_id, format, created_at, updated_at')
        .eq('building_fm_guid', buildingFmGuid)
        .order('updated_at', { ascending: false }),
      supabase
        .from('assets')
        .select('attributes')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('category', 'Building Storey'),
    ]);

    let dbModels: ModelCandidate[] = ((dbResult.data as any[]) ?? []).map((m) => ({ ...m, source: 'db' as const }));
    let models = dedupeModelsByName(dbModels);

    // Lazy storage fallback
    if (models.length === 0) {
      const storageResult = await supabase.storage
        .from('xkt-models')
        .list(buildingFmGuid, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

      if (!storageResult.error && storageResult.data) {
        const xktFiles = storageResult.data.filter((f: any) =>
          f.name?.toLowerCase().endsWith('.xkt') && !f.name?.toLowerCase().endsWith('_xkt.xkt')
        );
        models = dedupeModelsByName(xktFiles.map((file: any) => ({
          model_id: file.name.replace(/\.xkt$/i, ''),
          model_name: file.name.replace(/\.xkt$/i, ''),
          storage_path: `${buildingFmGuid}/${file.name}`,
          file_size: file.metadata?.size ?? null,
          storey_fm_guid: null,
          synced_at: null,
          source: 'storage' as const,
        })));
      }
    }

    // Resolve model names from storey data
    if (models.length > 0 && storeyResult.data?.length) {
      const assetPlusNames = new Map<string, string>();
      storeyResult.data.forEach((s: any) => {
        const attrs = typeof s.attributes === 'string' ? JSON.parse(s.attributes) : (s.attributes || {});
        const guid = attrs.parentBimObjectId;
        const name = attrs.parentCommonName;
        if (guid && name && !/^[0-9a-f]{8}-/i.test(name)) {
          assetPlusNames.set(guid, name);
          assetPlusNames.set(guid.toLowerCase(), name);
        }
      });
      if (assetPlusNames.size > 0) {
        models.forEach((m) => {
          const resolved = assetPlusNames.get(m.model_id) || assetPlusNames.get(m.model_id.toLowerCase());
          if (resolved && resolved !== m.model_name) {
            supabase.from('xkt_models')
              .update({ model_name: resolved })
              .eq('building_fm_guid', buildingFmGuid)
              .eq('model_id', m.model_id)
              .then(() => {});
            m.model_name = resolved;
          }
        });
      }
    }

    return { models, dbError: dbResult.error };
  }, [buildingFmGuid]);

  /**
   * Bootstrap models from Asset+ API when no local models exist.
   */
  const bootstrapFromAssetPlus = useCallback(async (): Promise<ModelCandidate[]> => {
    // Step 1: Server-side sync
    try {
      const { data: syncResult } = await supabase.functions.invoke('asset-plus-sync', {
        body: { action: 'sync-xkt-building', buildingFmGuid }
      });
      if (syncResult?.synced > 0) {
        const { data: freshModels } = await supabase
          .from('xkt_models')
          .select('model_id, model_name, storage_path, file_size, storey_fm_guid, synced_at, is_chunk, chunk_order, parent_model_id')
          .eq('building_fm_guid', buildingFmGuid)
          .order('file_size', { ascending: true });
        if (freshModels?.length) return freshModels.map((m: any) => ({ ...m, source: 'db' as const }));
      }
    } catch (e) {
      console.warn('[ModelLoader] Server sync failed:', e);
    }

    // Step 2: Client-side bootstrap
    try {
      const [tokenRes, configRes] = await Promise.all([
        supabase.functions.invoke('asset-plus-query', { body: { action: 'getToken', buildingFmGuid } }),
        supabase.functions.invoke('asset-plus-query', { body: { action: 'getConfig', buildingFmGuid } }),
      ]);
      const accessToken = tokenRes.data?.accessToken;
      const apiUrl = configRes.data?.apiUrl;
      const apiKey = configRes.data?.apiKey;
      if (!accessToken || !apiUrl || !apiKey) return [];

      const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
      const assetDbUrl = apiUrl.replace(/\/+$/, '');
      
      // Step 1: Discover models via GetAllRelatedModels (same as server-side)
      const candidateBases = [
        assetDbUrl, `${baseUrl}/asset`, baseUrl, `${baseUrl}/api/v1/AssetDB`,
      ];

      let discoveredModels: any[] | null = null;
      let workingBase: string | null = null;
      for (const base of [...new Set(candidateBases)]) {
        try {
          const url = `${base}/GetAllRelatedModels?fmguid=${buildingFmGuid}`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (res.ok) {
            const data = await res.json();
            const arr = Array.isArray(data) ? data : data?.models ?? data?.items ?? data?.data ?? null;
            if (arr?.length) { discoveredModels = arr; workingBase = base; break; }
          }
        } catch {}
      }

      if (!discoveredModels?.length || !workingBase) return [];
      
      // Step 2: Download each model via GetXktData with full identifier fallback chain
      const bootstrapped: ModelCandidate[] = [];
      
      // Get building parentBimObjectId from assets table for fallback
      let buildingParentBimObjId = '';
      try {
        const { data: buildingAsset } = await supabase
          .from('assets')
          .select('attributes')
          .eq('fm_guid', buildingFmGuid)
          .eq('category', 'Building')
          .maybeSingle();
        if (buildingAsset?.attributes) {
          const attrs = typeof buildingAsset.attributes === 'string' ? JSON.parse(buildingAsset.attributes) : buildingAsset.attributes;
          buildingParentBimObjId = (attrs as any)?.parentBimObjectId || (attrs as any)?.buildingBimObjectId || '';
        }
      } catch {}

      for (const model of discoveredModels) {
        const modelId = model.modelId || model.id || model.ModelId;
        const bimObjectId = model.bimObjectId || model.BimObjectId || '';
        const modelFmGuid = model.fmGuid || model.FmGuid || '';
        const externalGuid = model.externalGuid || model.ExternalGuid || '';
        if (!modelId) continue;
        
        // Build full identifier fallback chain (same as server-side sync)
        const idCombos: { param: string; value: string }[] = [
          { param: 'bimobjectid', value: bimObjectId },
          { param: 'externalguid', value: externalGuid },
          { param: 'bimobjectid', value: buildingParentBimObjId },
          { param: 'externalguid', value: modelFmGuid },
          { param: 'externalguid', value: buildingFmGuid },
        ];
        
        let xktData: ArrayBuffer | null = null;
        for (const combo of idCombos) {
          if (!combo.value) continue;
          const xktUrl = `${workingBase}/GetXktData?modelid=${modelId}&${combo.param}=${encodeURIComponent(combo.value)}&context=Building&apiKey=${apiKey}`;
          try {
            const xktRes = await fetch(xktUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
            if (!xktRes.ok) continue;
            const data = await xktRes.arrayBuffer();
            if (data.byteLength < 1024) continue;
            const firstByte = String.fromCharCode(new Uint8Array(data)[0]);
            if (firstByte === '<' || firstByte === '{') continue;
            xktData = data;
            break;
          } catch {}
        }
        
        if (!xktData) continue;
        
        storeModelInMemory(modelId, buildingFmGuid, xktData);
        const modelName = model.name || model.modelName || model.Name || modelId;
        xktCacheService.saveModelFromViewer(modelId, xktData, buildingFmGuid, modelName).catch(() => {});
        bootstrapped.push({
          model_id: modelId, model_name: modelName,
          storage_path: `${buildingFmGuid}/${modelId}.xkt`,
          file_size: xktData.byteLength, storey_fm_guid: null, source: 'db',
        });
      }
      return bootstrapped;
    } catch (e) {
      console.warn('[ModelLoader] Client-side bootstrap failed:', e);
      return [];
    }
  }, [buildingFmGuid]);

  /**
   * Load a single XKT model into the viewer (progressive — visible immediately on load).
   */
  const loadSingleModel = useCallback(async (
    model: ModelInfo,
    viewer: any,
    xktLoader: any,
    metadataFileSet: Set<string>,
  ): Promise<boolean> => {
    const modelId = model.model_id;
    const modelStart = performance.now();

    try {
      const metaPath = `${buildingFmGuid}/${modelId}_metadata.json`;
      let metaModelSrc: string | undefined;
      if (metadataFileSet.has(metaPath)) {
        const { data: metaUrl } = await supabase.storage
          .from('xkt-models')
          .createSignedUrl(metaPath, 3600);
        if (metaUrl?.signedUrl) metaModelSrc = metaUrl.signedUrl;
      }

      const waitForModel = (entity: any) =>
        new Promise<boolean>((resolve) => {
          let settled = false;
          const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
          entity?.on?.('loaded', () => done(true));
          entity?.on?.('error', (err: unknown) => { console.error(`[ModelLoader] Error: ${modelId}`, err); done(false); });
          setTimeout(() => done(false), 90_000);
        });

      const memData = getModelFromMemory(modelId, buildingFmGuid);
      if (memData) {
        const entity = xktLoader.load({ id: modelId, xkt: memData, edges: true, ...(metaModelSrc && { metaModelSrc }) });
        const ok = await waitForModel(entity);
        if (!ok) return false;
        // Check for empty model
        const loaded = viewer.scene?.models?.[modelId];
        const count = loaded?.numEntities ?? Object.keys(loaded?.objects || {}).length ?? 0;
        if (count === 0) { try { loaded?.destroy?.(); } catch {} return false; }
        console.log(`%c[ModelLoader] ✅ Memory → ${modelId} (${(memData.byteLength / 1024 / 1024).toFixed(1)} MB) ${Math.round(performance.now() - modelStart)}ms`, 'color:#22c55e;font-weight:bold');
        return true;
      }

      const { data: urlData } = await supabase.storage
        .from('xkt-models')
        .createSignedUrl(model.storage_path, 3600);
      if (!urlData?.signedUrl) return false;

      const shouldStream = (model.file_size ?? 0) > 30 * 1024 * 1024;
      if (shouldStream) {
        const entity = xktLoader.load({ id: modelId, src: urlData.signedUrl, edges: true, ...(metaModelSrc && { metaModelSrc }) });
        return await waitForModel(entity);
      }

      const resp = await fetch(urlData.signedUrl);
      if (!resp.ok) return false;
      const arrayBuf = await resp.arrayBuffer();
      const firstByte = arrayBuf.byteLength > 0 ? String.fromCharCode(new Uint8Array(arrayBuf)[0]) : '';
      if (arrayBuf.byteLength < 50_000 || firstByte === '<' || firstByte === '{') return false;

      storeModelInMemory(modelId, buildingFmGuid, arrayBuf);
      const entity = xktLoader.load({ id: modelId, xkt: arrayBuf, edges: true, ...(metaModelSrc && { metaModelSrc }) });
      const ok = await waitForModel(entity);
      if (!ok) return false;

      const loaded2 = viewer.scene?.models?.[modelId];
      const count2 = loaded2?.numEntities ?? Object.keys(loaded2?.objects || {}).length ?? 0;
      if (count2 === 0) { try { loaded2?.destroy?.(); } catch {} return false; }
      console.log(`%c[ModelLoader] 💾 Storage → ${modelId} (${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)} MB) ${Math.round(performance.now() - modelStart)}ms`, 'color:#3b82f6;font-weight:bold');
      return true;
    } catch (e) {
      console.warn(`[ModelLoader] Error loading ${modelId}:`, e);
      return false;
    }
  }, [buildingFmGuid]);

  /**
   * Run the full model loading pipeline with progressive visibility.
   * Each model is rendered as soon as it loads — no waiting for the full set.
   */
  const loadAllModels = useCallback(async (
    viewer: any,
    xktLoader: any,
    models: ModelCandidate[],
    onProgress: (progress: LoadProgress) => void,
    mountedRef: React.RefObject<boolean>,
  ): Promise<{ loaded: number; secondaryQueue: ModelInfo[]; chunkModels: ModelCandidate[]; hasRealTiles: boolean }> => {
    // Detect real per-storey tiles
    const chunkModels = models.filter(m => m.is_chunk && m.storey_fm_guid);
    const nonChunkModels = models.filter(m => !m.is_chunk);
    const uniqueChunkPaths = new Set(chunkModels.map(m => m.storage_path));
    const hasRealTiles = chunkModels.length >= 2 && uniqueChunkPaths.size > 1;

    let loadList: ModelInfo[];
    if (hasRealTiles) {
      const sortedChunks = [...chunkModels].sort((a, b) => (a.chunk_order ?? 0) - (b.chunk_order ?? 0));
      const initialIdx = Math.floor(sortedChunks.length / 2);
      const initialTiles = getTilesToLoad(
        sortedChunks.map(c => ({ modelId: c.model_id, modelName: c.model_name || c.model_id, storeyFmGuid: c.storey_fm_guid!, chunkOrder: c.chunk_order ?? 0, parentModelId: c.parent_model_id || '', storagePath: c.storage_path })),
        sortedChunks[initialIdx].storey_fm_guid!
      );
      const initialTileIds = new Set(initialTiles.map(t => t.modelId));
      loadList = [...nonChunkModels, ...chunkModels.filter(m => initialTileIds.has(m.model_id))];
      (window as any).__xktTileChunks = sortedChunks;
      (window as any).__xktTileLoadedIds = new Set(initialTileIds);
    } else {
      loadList = [...models];
    }

    // Priority sort: architectural first
    loadList.sort((a, b) => {
      const aA = isArchitectural(a.model_name) ? 0 : 1;
      const bA = isArchitectural(b.model_name) ? 0 : 1;
      if (aA !== bA) return aA - bA;
      return (a.model_name || a.model_id).localeCompare((b.model_name || b.model_id), 'sv');
    });

    // Split primary/secondary
    let secondaryQueue: ModelInfo[] = [];
    if (loadList.length > 1) {
      const aModels = loadList.filter(m => isArchitectural(m.model_name));
      const nonAModels = loadList.filter(m => !isArchitectural(m.model_name));
      if (aModels.length > 0 && nonAModels.length > 0) {
        secondaryQueue = nonAModels;
        loadList = aModels;
      }
    }

    if (loadList.length === 0) return { loaded: 0, secondaryQueue: [], chunkModels, hasRealTiles };

    // Pre-fetch metadata file list
    const metadataFileSet = new Set<string>();
    try {
      const loadModelIds = loadList.map(m => m.model_id);
      const { data: allFiles } = await supabase.storage.from('xkt-models').list(buildingFmGuid, { limit: 1000 });
      allFiles?.forEach((f: any) => {
        if (f.name?.endsWith('_metadata.json')) {
          const baseName = f.name.replace('_metadata.json', '');
          if (loadModelIds.some(id => id === baseName || id.toLowerCase() === baseName.toLowerCase())) {
            metadataFileSet.add(`${buildingFmGuid}/${f.name}`);
          }
        }
      });
    } catch {}

    // Progressive concurrent loading
    const CONCURRENT = isMobile ? 1 : 2;
    let loaded = 0;
    onProgress({ loaded: 0, total: loadList.length });

    const active = new Set<Promise<void>>();
    for (const model of loadList) {
      if (!mountedRef.current) break;
      onProgress({ loaded, total: loadList.length, currentModel: model.model_name || model.model_id });

      let promise: Promise<void>;
      promise = loadSingleModel(model, viewer, xktLoader, metadataFileSet).then((ok) => {
        loaded++;
        if (mountedRef.current) onProgress({ loaded, total: loadList.length });
      }).finally(() => active.delete(promise));
      active.add(promise);
      if (active.size >= CONCURRENT) await Promise.race(active);
    }
    await Promise.allSettled(Array.from(active));

    // Fallback: if A-models are empty, load secondary
    const sceneEntityCount = Object.values(viewer.scene?.models || {}).reduce((sum: number, m: any) => sum + (m?.numEntities ?? 0), 0);
    if (sceneEntityCount === 0 && secondaryQueue.length > 0) {
      loaded = 0;
      onProgress({ loaded: 0, total: secondaryQueue.length });
      const active2 = new Set<Promise<void>>();
      for (const model of secondaryQueue) {
        if (!mountedRef.current) break;
        let p: Promise<void>;
        p = loadSingleModel(model, viewer, xktLoader, metadataFileSet).then((ok) => {
          loaded++;
          if (mountedRef.current) onProgress({ loaded, total: secondaryQueue.length });
        }).finally(() => active2.delete(p));
        active2.add(p);
        if (active2.size >= CONCURRENT) await Promise.race(active2);
      }
      await Promise.allSettled(Array.from(active2));
      secondaryQueue = []; // consumed
    }

    return { loaded, secondaryQueue, chunkModels, hasRealTiles };
  }, [buildingFmGuid, isMobile, loadSingleModel]);

  return {
    fetchModelMetadata,
    bootstrapFromAssetPlus,
    loadAllModels,
    loadSingleModel,
    pendingInsightsColorRef,
    isArchitectural,
  };
}
