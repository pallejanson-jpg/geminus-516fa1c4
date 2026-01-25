import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { xktCacheService } from '@/services/xkt-cache-service';

/**
 * Hook to preload XKT models in the background when a building is selected
 * This significantly reduces load times when the user opens the 3D viewer
 */
export function useXktPreload(buildingFmGuid: string | null | undefined) {
  const preloadStartedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!buildingFmGuid) return;
    
    // Prevent duplicate preloads for the same building
    if (preloadStartedRef.current.has(buildingFmGuid)) {
      return;
    }
    
    const preloadModels = async () => {
      preloadStartedRef.current.add(buildingFmGuid);
      
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

        // Fetch available models for the building
        const modelsUrl = `${apiUrl}/api/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
        const modelsResponse = await fetch(modelsUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          }
        });

        if (!modelsResponse.ok) {
          console.log('XKT Preload: Failed to fetch models list');
          return;
        }

        const models = await modelsResponse.json();
        
        if (!Array.isArray(models) || models.length === 0) {
          console.log('XKT Preload: No models found for building');
          return;
        }

        // Filter to only models starting with "a" (the default filter)
        const aPrefixModels = models.filter((m: any) => 
          (m?.name || "").toLowerCase().startsWith("a")
        );

        console.log(`XKT Preload: Starting background preload for ${aPrefixModels.length} models`);

        // Preload models one at a time to avoid overwhelming the network
        for (const model of aPrefixModels.slice(0, 5)) { // Limit to first 5 models
          try {
            const modelId = model.id || model.name;
            
            // Check if already cached
            const cacheResult = await xktCacheService.checkCache(modelId, buildingFmGuid);
            if (cacheResult.cached) {
              console.log(`XKT Preload: ${modelId} already cached`);
              continue;
            }

            // Get the XKT URL for this model
            const xktUrl = model.xktUrl || `${apiUrl}/api/threed/GetXkt?modelId=${modelId}&apiKey=${apiKey}`;
            
            // Fetch and cache the model
            console.log(`XKT Preload: Fetching ${modelId}...`);
            const response = await fetch(xktUrl, {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
              }
            });

            if (response.ok) {
              const data = await response.arrayBuffer();
              await xktCacheService.storeModel(modelId, data, buildingFmGuid);
              console.log(`XKT Preload: Cached ${modelId} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
            }
          } catch (modelError) {
            // Don't fail the whole preload for one model
            console.warn('XKT Preload: Error preloading model:', modelError);
          }
        }

        console.log('XKT Preload: Background preload complete');
      } catch (error) {
        console.warn('XKT Preload: Error during preload:', error);
      }
    };

    // Start preload after a short delay to not interfere with UI rendering
    const timeoutId = setTimeout(preloadModels, 1000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [buildingFmGuid]);
}
