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
  console.log(`XKT Memory: Cleared ${keysToDelete.length} models for building ${buildingFmGuid.substring(0, 8)}...`);
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

    // Skip preloading on mobile to prevent memory competition with 3D viewer
    const isMobile = window.innerWidth < 768 || /Android|iPhone|iPad/i.test(navigator.userAgent);
    if (isMobile) {
      console.log('XKT Preload: Skipped on mobile device');
      return;
    }
    
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

        // Actually fetch model data into memory for faster loading (XKT models only)
        // Cast to any to avoid type issues with new 'format' column not yet in generated types
        const { data: models } = await (supabase
          .from('xkt_models')
          .select('model_id, file_url, storage_path, file_size') as any)
          .eq('building_fm_guid', buildingFmGuid)
          .eq('format', 'xkt');

        if (models && models.length > 0) {
          // Sort models by size (smallest first for faster initial feedback)
          const sortedModels = [...models].sort((a, b) => 
            (a.file_size || 0) - (b.file_size || 0)
          );

          // Concurrent fetch with limit to avoid overwhelming the network
          const CONCURRENT_FETCHES = 3;
          const activePromises = new Set<Promise<void>>();
          let completedCount = 0;

          const fetchModel = async (model: typeof models[0]) => {
            try {
              const modelSize = model.file_size || 0;

              // Preload only models that can actually be stored in memory cache
              if (modelSize > MAX_SINGLE_MODEL_BYTES) {
                console.log(`XKT Preload: Skipping ${model.model_id} — too large for memory preload (${(modelSize / 1024 / 1024).toFixed(1)} MB)`);
                return;
              }

              // Skip models that are suspiciously small — likely corrupt cache entries (HTML/JSON error responses)
              if (modelSize > 0 && modelSize < 50_000) {
                console.warn(`XKT Preload: Skipping ${model.model_id} — file_size ${model.file_size} bytes is too small (likely corrupt)`);
                return;
              }

              // Skip if already in memory
              if (isModelInMemory(model.model_id, buildingFmGuid)) {
                console.log(`XKT Preload: ${model.model_id} already in memory`);
                return;
              }

              let url = model.file_url;
              if (!url && model.storage_path) {
                const { data: urlData } = await supabase.storage
                  .from('xkt-models')
                  .createSignedUrl(model.storage_path, 3600);
                url = urlData?.signedUrl;
              }

              if (url) {
                const response = await fetch(url);
                if (response.ok) {
                  const data = await response.arrayBuffer();
                  // Validate binary data — reject HTML/JSON error responses from expired signed URLs
                  const MIN_VALID_XKT_BYTES = 50_000;
                  const firstByte = data.byteLength > 0 ? String.fromCharCode(new Uint8Array(data)[0]) : '';
                  if (data.byteLength < MIN_VALID_XKT_BYTES || firstByte === '<' || firstByte === '{') {
                    console.warn(`XKT Preload: Skipping ${model.model_id} — invalid data (${data.byteLength} bytes, starts with '${firstByte}')`);
                    return;
                  }
                  storeModelInMemory(model.model_id, buildingFmGuid, data);
                  completedCount++;
                  console.log(`XKT Preload: ${completedCount}/${sortedModels.length} models loaded`);
                }
              }
            } catch (e) {
              console.warn(`XKT Preload: Failed to fetch ${model.model_id}:`, e);
            }
          };

          // Process models with strict concurrency control
          for (const model of sortedModels) {
            let promise: Promise<void>;
            promise = fetchModel(model).finally(() => {
              activePromises.delete(promise);
            });
            activePromises.add(promise);

            if (activePromises.size >= CONCURRENT_FETCHES) {
              await Promise.race(activePromises);
            }
          }

          // Wait for remaining fetches
          await Promise.allSettled(Array.from(activePromises));
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
