/**
 * Loads and caches the Ivion 360° image list for a site. Extracted out of
 * useIvionCameraSync.ts (which still uses this internally, unchanged) so
 * useViewerCoordinatorSplitSync.ts can get the same image cache without pulling in
 * that hook's own pose-sync effects too.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

export interface IvionImage {
  id: number;
  location: { x: number; y: number; z: number };
  datasetId: number;
  /** Not populated by the current get-images-for-site response — reserved for when
   *  the API starts tagging images with a floor (see docs/viewer-current-state-verified.md). */
  floorFmGuid?: string | null;
}

export interface UseIvionImageCacheResult {
  imageCache: IvionImage[];
  isLoadingImages: boolean;
  hasImageLoadError: boolean;
  retryLoadImages: () => Promise<void>;
}

export function useIvionImageCache(
  ivionSiteId: string,
  buildingFmGuid: string | undefined,
  enabled: boolean,
): UseIvionImageCacheResult {
  const [imageCache, setImageCache] = useState<IvionImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [hasImageLoadError, setHasImageLoadError] = useState(false);

  const loadImages = useCallback(async () => {
    if (!ivionSiteId) return;

    setIsLoadingImages(true);
    setHasImageLoadError(false);

    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'get-images-for-site',
          siteId: ivionSiteId,
          buildingFmGuid,
        },
      });

      if (error) {
        console.error('[Ivion Sync] Failed to load images:', error);
        setHasImageLoadError(true);
        return;
      }

      if (data?.success && data?.images?.length > 0) {
        setImageCache(data.images);
        setHasImageLoadError(false);
        logger.log(`[Ivion Sync] Loaded ${data.images.length} images for site`);
      } else {
        logger.warn('[Ivion Sync] No images returned:', data?.error || 'Unknown');
        setHasImageLoadError(true);
      }
    } catch (e) {
      console.error('[Ivion Sync] Failed to load images:', e);
      setHasImageLoadError(true);
    } finally {
      setIsLoadingImages(false);
    }
  }, [ivionSiteId, buildingFmGuid]);

  const retryLoadImages = useCallback(async () => {
    await loadImages();
  }, [loadImages]);

  useEffect(() => {
    if (!enabled || !ivionSiteId) return;
    loadImages();
  }, [enabled, ivionSiteId, loadImages]);

  return { imageCache, isLoadingImages, hasImageLoadError, retryLoadImages };
}
