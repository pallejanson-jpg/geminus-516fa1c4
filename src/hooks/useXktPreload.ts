import { useEffect, useRef } from 'react';
import { xktCacheService } from '@/services/xkt-cache-service';
import { supabase } from '@/integrations/supabase/client';

// Global cache to persist preloaded buildings across component unmounts
const globalPreloadedBuildings = new Set<string>();

// In-memory cache for loaded XKT data to avoid re-fetching
const xktMemoryCache = new Map<string, ArrayBuffer>();

// Track total memory usage (approximate)
let totalMemoryBytes = 0;
const MAX_MEMORY_BYTES = 200 * 1024 * 1024; // 200 MB limit
const MAX_SINGLE_MODEL_BYTES = 30 * 1024 * 1024; // Skip memory caching for models > 30MB

/**
 * Check if a model is already loaded in memory
 */
export function isModelInMemory(modelId: string, buildingFmGuid: string): boolean {
  const key = `${buildingFmGuid}/${modelId}`;
  return xktMemoryCache.has(key);
}

/**
 * Get model from memory cache
 */
export function getModelFromMemory(modelId: string, buildingFmGuid: string): ArrayBuffer | null {
  const key = `${buildingFmGuid}/${modelId}`;
  return xktMemoryCache.get(key) || null;
}

/**
 * Store model in memory cache with memory limit enforcement
 */
export function storeModelInMemory(modelId: string, buildingFmGuid: string, data: ArrayBuffer): void {
  const key = `${buildingFmGuid}/${modelId}`;
  
  // Skip if already cached
  if (xktMemoryCache.has(key)) {
    return;
  }

  // Skip very large models to avoid cache thrashing
  if (data.byteLength > MAX_SINGLE_MODEL_BYTES) {
    console.log(`XKT Memory: Skipping ${modelId} — too large (${(data.byteLength / 1024 / 1024).toFixed(1)} MB > ${MAX_SINGLE_MODEL_BYTES / 1024 / 1024} MB limit)`);
    return;
  }
  
  // Check if adding this would exceed memory limit
  if (totalMemoryBytes + data.byteLength > MAX_MEMORY_BYTES) {
    // Evict oldest entries until we have space
    const entries = Array.from(xktMemoryCache.entries());
    while (totalMemoryBytes + data.byteLength > MAX_MEMORY_BYTES && entries.length > 0) {
      const [oldKey, oldData] = entries.shift()!;
      xktMemoryCache.delete(oldKey);
      totalMemoryBytes -= oldData.byteLength;
      console.log(`XKT Memory: Evicted ${oldKey} to make room`);
    }
  }
  
  xktMemoryCache.set(key, data);
  totalMemoryBytes += data.byteLength;
  console.log(`XKT Memory: Stored ${modelId} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB, total: ${(totalMemoryBytes / 1024 / 1024).toFixed(2)} MB)`);
}

/**
 * Clear memory cache for a building (call when switching buildings)
 */
export function clearBuildingFromMemory(buildingFmGuid: string): void {
  const keysToDelete: string[] = [];
  xktMemoryCache.forEach((data, key) => {
    if (key.startsWith(`${buildingFmGuid}/`)) {
      keysToDelete.push(key);
      totalMemoryBytes -= data.byteLength;
    }
  });
  keysToDelete.forEach(key => xktMemoryCache.delete(key));
  // Also remove from the preload guard so next preload fetches fresh data
  globalPreloadedBuildings.delete(buildingFmGuid);
  console.log(`XKT Memory: Cleared ${keysToDelete.length} models for building ${buildingFmGuid.substring(0, 8)}... (preload guard reset)`);
}

/**
 * Get current memory usage stats
 */
export function getMemoryStats(): { usedBytes: number; maxBytes: number; modelCount: number } {
  return {
    usedBytes: totalMemoryBytes,
    maxBytes: MAX_MEMORY_BYTES,
    modelCount: xktMemoryCache.size,
  };
}

/**
 * Clear all memory cache
 */
export function clearAllMemory(): void {
  xktMemoryCache.clear();
  totalMemoryBytes = 0;
  console.log('XKT Memory: Cleared all cached models');
}

/**
 * Hook to preload XKT models in the background when a building is selected
 * This significantly reduces load times when the user opens the 3D viewer
 * 
 * Uses on-demand sync: if no cached models exist in database, triggers background sync
 */
export function useXktPreload(buildingFmGuid: string | null | undefined) {
  const preloadStartedRef = useRef(false);

  useEffect(() => {
    if (!buildingFmGuid) return;

    // Detect mobile for lower concurrency (but still preload — A-model priority keeps it safe)
    const isMobile = window.innerWidth < 768 || /Android|iPhone|iPad/i.test(navigator.userAgent);
    
    // Prevent duplicate preloads - check global cache
    if (globalPreloadedBuildings.has(buildingFmGuid)) {
      console.log(`XKT Preload: ${buildingFmGuid.substring(0, 8)}... already preloaded`);
      return;
    }

    // Prevent duplicate trigger within same component instance
    if (preloadStartedRef.current) return;
    preloadStartedRef.current = true;
    
    const preloadModels = async () => {
      console.log(`XKT Preload: Starting background preload for building ${buildingFmGuid.substring(0, 8)}...`);
      
      try {
        // Check what's already cached in database
        const result = await xktCacheService.ensureBuildingModels(buildingFmGuid);
        
        if (!result.cached || result.count === 0) {
          console.log('XKT Preload: No cached models - will cache on first 3D view');
          globalPreloadedBuildings.add(buildingFmGuid);
          return;
        }

        console.log(`XKT Preload: ${result.count} models found in database, fetching binary data...`);

        // Fetch model metadata including names for A-model prioritization
        const { data: models } = await (supabase
          .from('xkt_models')
          .select('model_id, model_name, file_url, storage_path, file_size') as any)
          .eq('building_fm_guid', buildingFmGuid)
          .eq('format', 'xkt');

        if (models && models.length > 0) {
          // Resolve model names from Asset+ Building Storey objects (same logic as useModelNames)
          try {
            const { data: storeys } = await supabase
              .from('assets')
              .select('attributes')
              .eq('building_fm_guid', buildingFmGuid)
              .eq('category', 'Building Storey');

            if (storeys && storeys.length > 0) {
              const assetPlusNames = new Map<string, string>();
              storeys.forEach((s: any) => {
                const attrs = typeof s.attributes === 'string' ? JSON.parse(s.attributes) : (s.attributes || {});
                const guid = attrs.parentBimObjectId;
                const name = attrs.parentCommonName;
                if (guid && name && !/^[0-9a-f]{8}-/i.test(name)) {
                  assetPlusNames.set(guid, name);
                  assetPlusNames.set(guid.toLowerCase(), name);
                }
              });

              if (assetPlusNames.size > 0) {
                console.log(`XKT Preload: Resolved ${assetPlusNames.size / 2} model names from Asset+ storeys`);
                models.forEach((m: any) => {
                  const resolved = assetPlusNames.get(m.model_id) || assetPlusNames.get(m.model_id.toLowerCase());
                  if (resolved && resolved !== m.model_name) {
                    m.model_name = resolved;
                  }
                });
              }
            }
          } catch (e) {
            console.debug('XKT Preload: Asset+ name resolution failed:', e);
          }

          // Split into A-models (priority) and secondary models
          // Use NON_ARCH_PREFIXES exclusion + UUID heuristic (largest = architectural)
          const NON_ARCH_PREFIXES = ['BRAND', 'FIRE', 'V-', 'V_', 'VS-', 'VS_', 'EL-', 'EL_', 'MEP', 'SPRINKLER', 'K-', 'K_', 'R-', 'R_', 'S-', 'S_'];
          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
          const hasRealName = (name: string | null) => name && !UUID_RE.test(name);
          const isAModel = (name: string | null) => {
            if (!hasRealName(name)) return false;
            const upper = name!.toUpperCase();
            if (NON_ARCH_PREFIXES.some(p => upper.startsWith(p))) return false;
            return upper.charAt(0) === 'A';
          };

          const namedModels = models.filter((m: any) => hasRealName(m.model_name));
          const uuidModels = models.filter((m: any) => !hasRealName(m.model_name));

          let aModels: any[];
          let secondaryModels: any[];

          if (namedModels.length > 0) {
            aModels = namedModels.filter((m: any) => isAModel(m.model_name));
            if (aModels.length === 0) {
              // Smart fallback: load largest named model not in exclusion list
              const nonExcluded = namedModels.filter((m: any) => {
                const upper = (m.model_name || '').toUpperCase();
                return !NON_ARCH_PREFIXES.some(p => upper.startsWith(p));
              });
              if (nonExcluded.length > 0) {
                const sorted = [...nonExcluded].sort((a: any, b: any) => (b.file_size || 0) - (a.file_size || 0));
                aModels = [sorted[0]];
                console.warn(`XKT Preload: No A-prefixed models — fallback to largest non-excluded: "${sorted[0].model_name}"`);
              }
            }
            secondaryModels = []; // Strict mode: never preload secondary/non-A models
          } else {
            // All UUID-named: largest = architectural priority
            const sorted = [...uuidModels].sort((a: any, b: any) => (b.file_size || 0) - (a.file_size || 0));
            aModels = sorted.length > 0 ? [sorted[0]] : [];
            secondaryModels = [];
          }

          // Sort each group by size (smallest first for preload)
          const sortBySize = (a: any, b: any) => (a.file_size || 0) - (b.file_size || 0);
          aModels.sort(sortBySize);
          secondaryModels.sort(sortBySize);

          console.log(`XKT Preload: ${aModels.length} A-models (priority), ${secondaryModels.length} secondary`);

          // Batch-generate all signed URLs in parallel, then fetch binary data
          const fetchModel = async (model: typeof models[0], signedUrl?: string) => {
            try {
              const modelSize = model.file_size || 0;

              if (modelSize > MAX_SINGLE_MODEL_BYTES) return;
              if (modelSize > 0 && modelSize < 50_000) return;
              if (isModelInMemory(model.model_id, buildingFmGuid)) return;

              const url = signedUrl || model.file_url;
              if (!url) return;

              const response = await fetch(url);
              if (response.ok) {
                const data = await response.arrayBuffer();
                const firstByte = data.byteLength > 0 ? String.fromCharCode(new Uint8Array(data)[0]) : '';
                if (data.byteLength < 50_000 || firstByte === '<' || firstByte === '{') return;
                storeModelInMemory(model.model_id, buildingFmGuid, data);
              }
            } catch (e) {
              console.warn(`XKT Preload: Failed to fetch ${model.model_id}:`, e);
            }
          };

          // Pre-generate all signed URLs in one parallel batch
          const modelsNeedingUrl = [...aModels, ...secondaryModels].filter(
            (m: any) => !m.file_url && m.storage_path && !isModelInMemory(m.model_id, buildingFmGuid)
              && (m.file_size || 0) <= MAX_SINGLE_MODEL_BYTES && (m.file_size || 0) >= 50_000
          );

          const signedUrlMap = new Map<string, string>();
          if (modelsNeedingUrl.length > 0) {
            const urlPromises = modelsNeedingUrl.map(async (m: any) => {
              const { data: urlData } = await supabase.storage
                .from('xkt-models')
                .createSignedUrl(m.storage_path, 3600);
              if (urlData?.signedUrl) signedUrlMap.set(m.model_id, urlData.signedUrl);
            });
            await Promise.allSettled(urlPromises);
            console.log(`XKT Preload: Batch-generated ${signedUrlMap.size} signed URLs`);
          }

          const fetchBatch = async (batch: typeof models, concurrency: number) => {
            const activePromises = new Set<Promise<void>>();
            for (const model of batch) {
              const url = model.file_url || signedUrlMap.get(model.model_id);
              let promise: Promise<void>;
              promise = fetchModel(model, url).finally(() => activePromises.delete(promise));
              activePromises.add(promise);
              if (activePromises.size >= concurrency) {
                await Promise.race(activePromises);
              }
            }
            await Promise.allSettled(Array.from(activePromises));
          };

          // Phase 1: Fetch A-models (lower concurrency on mobile)
          await fetchBatch(aModels, isMobile ? 1 : 3);
          console.log(`XKT Preload: ✅ A-models preloaded`);

          // Phase 2 disabled: do NOT preload secondary/non-A models in strict A-mode
          if (secondaryModels.length > 0) {
            console.log(`XKT Preload: Secondary preload disabled (${secondaryModels.length} models skipped)`);
          }
        }

        // Mark building as preloaded in global cache
        globalPreloadedBuildings.add(buildingFmGuid);
        console.log(`XKT Preload: Background preload complete for ${buildingFmGuid.substring(0, 8)}...`);
      } catch (error) {
        console.warn('XKT Preload: Error during preload:', error);
        // Still mark as attempted to avoid repeated failures
        globalPreloadedBuildings.add(buildingFmGuid);
      }
    };

    // Start preload immediately (no delay) to maximize cache hit chance
    preloadModels();
  }, [buildingFmGuid]);
}
