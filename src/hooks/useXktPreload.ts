import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { xktCacheService } from '@/services/xkt-cache-service';

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
        // First, get access token and config
        const [tokenResult, configResult] = await Promise.all([
          supabase.functions.invoke('asset-plus-query', {
            body: { action: 'getToken' }
          }),
          supabase.functions.invoke('asset-plus-query', {
            body: { action: 'getConfig' }
          })
        ]);

        const accessToken = tokenResult.data?.accessToken;
        const apiUrl = configResult.data?.apiUrl;
        const apiKey = configResult.data?.apiKey;

        if (!accessToken || !apiUrl) {
          console.log('XKT Preload: Missing token or API URL, skipping');
          return;
        }

        // The Asset+ 3D API uses a different base path
        // Normalize URL: remove /api/v1/AssetDB if present, use base domain
        const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
        
        // Fetch available models for the building using correct endpoint
        const modelsUrl = `${baseUrl}/api/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
        console.log(`XKT Preload: Fetching models from ${modelsUrl}`);
        
        const modelsResponse = await fetch(modelsUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          }
        });

        if (!modelsResponse.ok) {
          console.log(`XKT Preload: Failed to fetch models list (${modelsResponse.status})`);
          // Mark as attempted to avoid repeated failures
          globalPreloadedBuildings.add(buildingFmGuid);
          return;
        }

        const models = await modelsResponse.json();
        
        if (!Array.isArray(models) || models.length === 0) {
          console.log('XKT Preload: No models found for building');
          globalPreloadedBuildings.add(buildingFmGuid);
          return;
        }

        // Filter to only models starting with "a" (the default filter)
        const aPrefixModels = models.filter((m: any) => 
          (m?.name || "").toLowerCase().startsWith("a")
        );

        console.log(`XKT Preload: Found ${models.length} models, ${aPrefixModels.length} with 'a' prefix`);

        // Preload models one at a time to avoid overwhelming the network
        for (const model of aPrefixModels.slice(0, 5)) { // Limit to first 5 models
          try {
            const modelId = model.id || model.name;
            
            // Check if already in memory
            if (isModelInMemory(modelId, buildingFmGuid)) {
              console.log(`XKT Preload: ${modelId} already in memory`);
              continue;
            }
            
            // Check if already cached in storage
            const cacheResult = await xktCacheService.checkCache(modelId, buildingFmGuid);
            if (cacheResult.cached && cacheResult.url) {
              console.log(`XKT Preload: ${modelId} found in storage cache`);
              // Load from cache into memory
              try {
                const cacheResponse = await fetch(cacheResult.url);
                if (cacheResponse.ok) {
                  const data = await cacheResponse.arrayBuffer();
                  storeModelInMemory(modelId, buildingFmGuid, data);
                }
              } catch (e) {
                console.debug('XKT Preload: Could not load from cache:', e);
              }
              continue;
            }

            // Get the XKT URL for this model
            const xktUrl = model.xktUrl || `${baseUrl}/api/threed/GetXkt?modelId=${modelId}&apiKey=${apiKey}`;
            
            // Fetch and cache the model
            console.log(`XKT Preload: Fetching ${modelId}...`);
            const response = await fetch(xktUrl, {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
              }
            });

            if (response.ok) {
              const data = await response.arrayBuffer();
              
              // Store in memory for immediate use
              storeModelInMemory(modelId, buildingFmGuid, data);
              
              // Store in persistent cache (async, don't wait)
              xktCacheService.storeModel(modelId, data, buildingFmGuid).then(() => {
                console.log(`XKT Preload: Cached ${modelId} to storage`);
              }).catch(e => {
                console.debug('XKT Preload: Storage cache failed:', e);
              });
            }
          } catch (modelError) {
            // Don't fail the whole preload for one model
            console.warn('XKT Preload: Error preloading model:', modelError);
          }
        }

        // Mark building as preloaded in global cache
        globalPreloadedBuildings.add(buildingFmGuid);
        console.log(`XKT Preload: Background preload complete for ${buildingFmGuid.substring(0, 8)}...`);
      } catch (error) {
        console.warn('XKT Preload: Error during preload:', error);
      }
    };

    // Start preload immediately (no delay) to maximize cache hit chance
    preloadModels();
  }, [buildingFmGuid]);
}
