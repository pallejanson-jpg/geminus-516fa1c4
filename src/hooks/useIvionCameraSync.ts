/**
 * Hook for synchronizing camera between Ivion 360° viewer and 3D viewer.
 * 
 * Strategy: URL-based navigation via image IDs
 * - 3D → 360°: Find nearest Ivion image, update iframe URL with &image=XXX
 * - 360° → 3D: Parse image ID from manual URL input, fetch position from API
 * 
 * NavVis Ivion URL format:
 * https://swg.iv.navvis.com/?site={siteId}&vlon={yaw_rad}&vlat={pitch_rad}&fov={fov}&image={imageId}
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useViewerSync, LocalCoords } from '@/context/ViewerSyncContext';
import { supabase } from '@/integrations/supabase/client';
import type { BuildingOrigin } from '@/lib/coordinate-transform';

export interface IvionImage {
  id: number;
  location: { x: number; y: number; z: number };
  datasetId: number;
}

interface UseIvionCameraSyncOptions {
  /** Reference to the iframe element */
  iframeRef: React.RefObject<HTMLIFrameElement>;
  /** Whether sync is enabled */
  enabled: boolean;
  /** Building origin for coordinate transformation (not used for image-based sync) */
  buildingOrigin?: BuildingOrigin | null;
  /** Ivion site ID for fetching images */
  ivionSiteId: string;
  /** Building FM GUID for token auth */
  buildingFmGuid?: string;
}

interface UseIvionCameraSyncResult {
  /** Cached images for the site */
  imageCache: IvionImage[];
  /** Whether images are loading */
  isLoadingImages: boolean;
  /** Current Ivion image ID */
  currentImageId: number | null;
  /** Navigate 360° to nearest image from 3D position */
  syncToIvion: () => void;
  /** Navigate 3D to position from Ivion URL */
  syncFrom360Url: (ivionUrl: string) => Promise<boolean>;
}

/**
 * Hook for 360° viewer camera synchronization via image-based URL navigation.
 */
export function useIvionCameraSync({
  iframeRef,
  enabled,
  buildingOrigin,
  ivionSiteId,
  buildingFmGuid,
}: UseIvionCameraSyncOptions): UseIvionCameraSyncResult {
  const { syncLocked, syncState, updateFromIvion } = useViewerSync();
  
  // Cache of all images for finding nearest
  const [imageCache, setImageCache] = useState<IvionImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [currentImageId, setCurrentImageId] = useState<number | null>(null);
  
  // Track last synced image to avoid loops
  const lastSyncedImageIdRef = useRef<number | null>(null);
  const isSyncingRef = useRef(false);
  const syncThrottleRef = useRef<number>(0);
  const SYNC_THROTTLE_MS = 2000; // Minimum time between URL updates

  // 1. Load all images for the site on mount
  useEffect(() => {
    if (!enabled || !ivionSiteId) return;
    
    const loadImages = async () => {
      setIsLoadingImages(true);
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
          return;
        }
        
        if (data?.success && data?.images) {
          setImageCache(data.images);
          console.log(`[Ivion Sync] Loaded ${data.images.length} images for site (${data.processedDatasets}/${data.totalDatasets} datasets)`);
        }
      } catch (e) {
        console.error('[Ivion Sync] Failed to load images:', e);
      } finally {
        setIsLoadingImages(false);
      }
    };
    
    loadImages();
  }, [enabled, ivionSiteId, buildingFmGuid]);

  // Find nearest image to a position
  const findNearestImage = useCallback((pos: LocalCoords): IvionImage | null => {
    if (imageCache.length === 0) return null;
    
    let nearestImage: IvionImage | null = null;
    let nearestDist = Infinity;
    
    for (const img of imageCache) {
      // Ivion coordinates: {x, y, z} in meters
      // BIM coordinates: {x, y, z} in meters
      // May need offset adjustment per building
      const dx = img.location.x - pos.x;
      const dy = img.location.y - pos.y;
      const dz = img.location.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestImage = img;
      }
    }
    
    // Only return if within reasonable distance (50m)
    return nearestDist < 50 ? nearestImage : null;
  }, [imageCache]);

  // Navigate Ivion to nearest image based on current 3D position
  const syncToIvion = useCallback(() => {
    if (!iframeRef.current || !syncState.position) {
      console.log('[Ivion Sync] Cannot sync: no iframe or position');
      return;
    }
    
    // Throttle updates
    const now = Date.now();
    if (now - syncThrottleRef.current < SYNC_THROTTLE_MS) {
      console.log('[Ivion Sync] Throttled');
      return;
    }
    
    const nearestImage = findNearestImage(syncState.position);
    if (!nearestImage) {
      console.log('[Ivion Sync] No nearby image found');
      return;
    }
    
    // Don't update if same image
    if (nearestImage.id === lastSyncedImageIdRef.current) {
      console.log('[Ivion Sync] Same image, skipping');
      return;
    }
    
    syncThrottleRef.current = now;
    lastSyncedImageIdRef.current = nearestImage.id;
    isSyncingRef.current = true;
    
    try {
      const currentUrl = new URL(iframeRef.current.src);
      currentUrl.searchParams.set('image', String(nearestImage.id));
      
      // Convert heading/pitch to radians for vlon/vlat
      const vlonRad = (syncState.heading * Math.PI) / 180;
      const vlatRad = (syncState.pitch * Math.PI) / 180;
      currentUrl.searchParams.set('vlon', vlonRad.toFixed(2));
      currentUrl.searchParams.set('vlat', vlatRad.toFixed(2));
      
      console.log('[Ivion Sync] Navigating to image:', nearestImage.id, 'at distance:', 
        Math.sqrt(
          Math.pow(nearestImage.location.x - syncState.position.x, 2) +
          Math.pow(nearestImage.location.y - syncState.position.y, 2) +
          Math.pow(nearestImage.location.z - syncState.position.z, 2)
        ).toFixed(1), 'm');
      
      iframeRef.current.src = currentUrl.toString();
      setCurrentImageId(nearestImage.id);
    } catch (err) {
      console.error('[Ivion Sync] Failed to update iframe URL:', err);
    }
    
    // Clear syncing flag after delay
    setTimeout(() => {
      isSyncingRef.current = false;
    }, 1500);
  }, [iframeRef, syncState, findNearestImage]);

  // Parse Ivion URL and sync 3D to that position
  const syncFrom360Url = useCallback(async (ivionUrl: string): Promise<boolean> => {
    try {
      const url = new URL(ivionUrl);
      const imageId = url.searchParams.get('image');
      
      if (!imageId) {
        console.error('[Ivion Sync] No image parameter in URL');
        return false;
      }
      
      // Parse view angles
      const vlon = parseFloat(url.searchParams.get('vlon') || '0');
      const vlat = parseFloat(url.searchParams.get('vlat') || '0');
      
      // Convert radians to degrees
      const heading = (vlon * 180) / Math.PI;
      const pitch = (vlat * 180) / Math.PI;
      
      // Fetch image position from API
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'get-image-position',
          imageId: parseInt(imageId, 10),
          buildingFmGuid,
        },
      });
      
      if (error || !data?.success) {
        console.error('[Ivion Sync] Failed to get image position:', error || data?.error);
        return false;
      }
      
      const position: LocalCoords = {
        x: data.location.x,
        y: data.location.y,
        z: data.location.z,
      };
      
      console.log('[Ivion Sync] Syncing from 360° URL:', { imageId, position, heading, pitch });
      
      // Update sync context - 3D viewer will react
      updateFromIvion(position, heading, pitch);
      setCurrentImageId(parseInt(imageId, 10));
      lastSyncedImageIdRef.current = parseInt(imageId, 10);
      
      return true;
    } catch (err) {
      console.error('[Ivion Sync] Failed to parse Ivion URL:', err);
      return false;
    }
  }, [buildingFmGuid, updateFromIvion]);

  // Auto-sync when 3D camera changes (if sync is locked)
  useEffect(() => {
    if (!enabled || !syncLocked) return;
    if (syncState.source !== '3d' || !syncState.position) return;
    if (isSyncingRef.current) return;
    if (imageCache.length === 0) return;
    
    // Debounce auto-sync
    const timer = setTimeout(() => {
      syncToIvion();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [enabled, syncLocked, syncState, imageCache.length, syncToIvion]);

  return {
    imageCache,
    isLoadingImages,
    currentImageId,
    syncToIvion,
    syncFrom360Url,
  };
}
