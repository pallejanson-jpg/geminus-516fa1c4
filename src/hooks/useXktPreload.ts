import { useEffect, useRef } from 'react';
import { xktCacheService } from '@/services/xkt-cache-service';
import { supabase } from '@/integrations/supabase/client';

// Global cache to persist preloaded buildings across component unmounts
const globalPreloadedBuildings = new Set<string>();

// In-memory cache for loaded XKT data to avoid re-fetching
const xktMemoryCache = new Map<string, ArrayBuffer>();

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
 * Store model in memory cache
 */
export function storeModelInMemory(modelId: string, buildingFmGuid: string, data: ArrayBuffer): void {
  const key = `${buildingFmGuid}/${modelId}`;
  xktMemoryCache.set(key, data);
  console.log(`XKT Memory: Stored ${modelId} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
}

/**
 * Clear memory cache for a building (call when switching buildings)
 */
export function clearBuildingFromMemory(buildingFmGuid: string): void {
  const keysToDelete: string[] = [];
  xktMemoryCache.forEach((_, key) => {
    if (key.startsWith(`${buildingFmGuid}/`)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => xktMemoryCache.delete(key));
  console.log(`XKT Memory: Cleared ${keysToDelete.length} models for building ${buildingFmGuid.substring(0, 8)}...`);
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
        // Use the on-demand cache service which triggers sync if needed
        const result = await xktCacheService.ensureBuildingModels(buildingFmGuid);
        
        if (result.syncing) {
          console.log('XKT Preload: Background sync triggered, models will be available on next load');
          globalPreloadedBuildings.add(buildingFmGuid);
          return;
        }

        if (!result.cached || result.count === 0) {
          console.log('XKT Preload: No cached models available');
          globalPreloadedBuildings.add(buildingFmGuid);
          return;
        }

        console.log(`XKT Preload: ${result.count} models found in cache, fetching binary data...`);

        // Actually fetch model data into memory for faster loading
        const { data: models } = await supabase
          .from('xkt_models')
          .select('model_id, file_url, storage_path')
          .eq('building_fm_guid', buildingFmGuid);

        if (models && models.length > 0) {
          // Preload model binaries into memory cache (limit concurrent fetches)
          const fetchPromises = models.slice(0, 3).map(async (model) => {
            try {
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
                  storeModelInMemory(model.model_id, buildingFmGuid, data);
                }
              }
            } catch (e) {
              console.warn(`XKT Preload: Failed to fetch ${model.model_id}:`, e);
            }
          });

          await Promise.allSettled(fetchPromises);
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
