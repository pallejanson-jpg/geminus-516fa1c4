/**
 * Hook for synchronizing camera between Ivion 360° viewer and 3D viewer.
 * 
 * Supports two modes:
 * 1. **SDK mode** (preferred): Uses NavVis Frontend API for real-time bi-directional sync
 *    - 360° → 3D: Polls getMainView().getImage() for position + viewing direction
 *    - 3D → 360°: Uses moveToImageId() for instant navigation
 * 
 * 2. **Iframe mode** (fallback): Limited sync via URL manipulation
 *    - 360° → 3D: Manual URL paste only (Ivion iframe doesn't emit postMessage events)
 *    - 3D → 360°: Changes iframe src with &image=XXX (causes full reload)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useViewerSync, LocalCoords } from '@/context/ViewerSyncContext';
import { supabase } from '@/integrations/supabase/client';
import type { BuildingOrigin } from '@/lib/coordinate-transform';
import type { IvionApi, IvionImage as SdkIvionImage } from '@/lib/ivion-sdk';

export interface IvionImage {
  id: number;
  location: { x: number; y: number; z: number };
  datasetId: number;
}

interface UseIvionCameraSyncOptions {
  /** Reference to the iframe element (for fallback mode) */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Reference to the Ivion SDK API (for SDK mode) */
  ivApiRef?: React.MutableRefObject<IvionApi | null>;
  /** Whether sync is enabled */
  enabled: boolean;
  /** Building origin for coordinate transformation */
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
  /** Navigate 3D to position from Ivion URL (manual fallback) */
  syncFrom360Url: (ivionUrl: string) => Promise<boolean>;
  /** Send subscribe command to iframe (no-op in SDK mode) */
  sendSubscribeCommand: () => void;
  /** Last sync source for status indicator */
  lastSyncSource: 'ivion' | '3d' | null;
  /** Whether automatic sync is active (SDK mode or postMessage working) */
  postMessageActive: boolean;
  /** Whether there was an error loading images */
  hasImageLoadError: boolean;
  /** Retry loading images from Ivion */
  retryLoadImages: () => Promise<void>;
}

const SYNC_POLL_INTERVAL_MS = 200;
const IFRAME_SYNC_THROTTLE_MS = 2000;

/**
 * Hook for 360° viewer camera synchronization.
 */
export function useIvionCameraSync({
  iframeRef,
  ivApiRef,
  enabled,
  buildingOrigin,
  ivionSiteId,
  buildingFmGuid,
}: UseIvionCameraSyncOptions): UseIvionCameraSyncResult {
  const { syncLocked, syncState, updateFromIvion } = useViewerSync();
  
  const [imageCache, setImageCache] = useState<IvionImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [hasImageLoadError, setHasImageLoadError] = useState(false);
  const [currentImageId, setCurrentImageId] = useState<number | null>(null);
  const [lastSyncSource, setLastSyncSource] = useState<'ivion' | '3d' | null>(null);
  const [sdkSyncActive, setSdkSyncActive] = useState(false);
  
  const lastSyncedImageIdRef = useRef<number | null>(null);
  const isSyncingRef = useRef(false);
  const syncThrottleRef = useRef<number>(0);

  // ─── Image cache loading (shared by both modes) ───────────────────
  
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
        console.log(`[Ivion Sync] Loaded ${data.images.length} images for site`);
      } else {
        console.warn('[Ivion Sync] No images returned:', data?.error || 'Unknown');
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

  // Load images on mount
  useEffect(() => {
    if (!enabled || !ivionSiteId) return;
    loadImages();
  }, [enabled, ivionSiteId, loadImages]);

  // ─── Nearest image finder (shared) ────────────────────────────────
  
  const findNearestImage = useCallback((pos: LocalCoords): IvionImage | null => {
    if (imageCache.length === 0) return null;
    
    let nearestImage: IvionImage | null = null;
    let nearestDist = Infinity;
    
    for (const img of imageCache) {
      const dx = img.location.x - pos.x;
      const dy = img.location.y - pos.y;
      const dz = img.location.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestImage = img;
      }
    }
    
    return nearestDist < 50 ? nearestImage : null;
  }, [imageCache]);

  // ─── SDK MODE: Bi-directional real-time sync ──────────────────────

  // SDK: Poll Ivion position (360° → 3D)
  useEffect(() => {
    const ivApi = ivApiRef?.current;
    if (!ivApi || !enabled || !syncLocked) {
      setSdkSyncActive(false);
      return;
    }

    setSdkSyncActive(true);
    console.log('[Ivion Sync] SDK mode: Starting position polling');
    
    let lastImageId: number | null = null;
    let lastLon: number | null = null;

    const pollPosition = () => {
      if (isSyncingRef.current) return;
      
      try {
        const mainView = ivApi.getMainView();
        if (!mainView) return;
        
        const image = mainView.getImage();
        const viewDir = mainView.currViewingDir;
        
        if (!image) return;
        
        // Check if position or view direction changed significantly
        const imageChanged = image.id !== lastImageId;
        const viewChanged = lastLon !== null && 
          Math.abs((viewDir?.lon ?? 0) - lastLon) > 0.05; // ~3° threshold
        
        if (imageChanged || viewChanged) {
          lastImageId = image.id;
          lastLon = viewDir?.lon ?? 0;
          
          const pos: LocalCoords = {
            x: image.location.x,
            y: image.location.y,
            z: image.location.z,
          };
          
          // Convert lon/lat radians to heading/pitch degrees
          const heading = (viewDir?.lon ?? 0) * (180 / Math.PI);
          const pitch = (viewDir?.lat ?? 0) * (180 / Math.PI);
          
          console.log('[Ivion Sync] SDK position:', { imageId: image.id, pos, heading: heading.toFixed(1) });
          
          updateFromIvion(pos, heading, pitch);
          setCurrentImageId(image.id);
          setLastSyncSource('ivion');
          lastSyncedImageIdRef.current = image.id;
        }
      } catch (e) {
        // SDK might not be fully ready yet, silently ignore
      }
    };

    const interval = setInterval(pollPosition, SYNC_POLL_INTERVAL_MS);
    
    // Also try to subscribe to pov.onChange if available
    let unsubscribe: (() => void) | void | undefined;
    try {
      if (ivApi.pov?.onChange) {
        unsubscribe = ivApi.pov.onChange(() => {
          pollPosition();
        });
        console.log('[Ivion Sync] SDK: Subscribed to pov.onChange');
      }
    } catch (e) {
      console.debug('[Ivion Sync] pov.onChange not available, using polling only');
    }

    return () => {
      clearInterval(interval);
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [ivApiRef?.current, enabled, syncLocked, updateFromIvion]);

  // SDK: Navigate Ivion from 3D position (3D → 360°)
  const syncToIvionSdk = useCallback(() => {
    const ivApi = ivApiRef?.current;
    if (!ivApi || !syncState.position) return;
    
    isSyncingRef.current = true;
    
    const nearestImage = findNearestImage(syncState.position);
    if (nearestImage && nearestImage.id !== lastSyncedImageIdRef.current) {
      lastSyncedImageIdRef.current = nearestImage.id;
      
      // Convert heading/pitch to radians for Ivion viewDir
      const viewDir = {
        lon: (syncState.heading * Math.PI) / 180,
        lat: (syncState.pitch * Math.PI) / 180,
      };
      
      console.log('[Ivion Sync] SDK: Moving to image', nearestImage.id, 'viewDir:', viewDir);
      
      ivApi.moveToImageId(nearestImage.id, viewDir, undefined)
        .then(() => {
          setCurrentImageId(nearestImage.id);
          setLastSyncSource('3d');
        })
        .catch((err) => {
          console.error('[Ivion Sync] SDK moveToImageId failed:', err);
        })
        .finally(() => {
          setTimeout(() => { isSyncingRef.current = false; }, 300);
        });
    } else {
      // Same image - try to update just the viewing direction
      try {
        const mainView = ivApi.getMainView();
        if (mainView?.updateOrientation) {
          mainView.updateOrientation({
            lon: (syncState.heading * Math.PI) / 180,
            lat: (syncState.pitch * Math.PI) / 180,
          });
        }
      } catch (e) {
        console.debug('[Ivion Sync] SDK updateOrientation not available');
      }
      setTimeout(() => { isSyncingRef.current = false; }, 100);
    }
  }, [ivApiRef?.current, syncState, findNearestImage]);

  // ─── IFRAME MODE: Limited fallback sync ───────────────────────────

  // Iframe: Navigate via URL (3D → 360°, causes full reload)
  const syncToIvionIframe = useCallback(() => {
    if (!iframeRef?.current || !syncState.position) return;
    
    const now = Date.now();
    if (now - syncThrottleRef.current < IFRAME_SYNC_THROTTLE_MS) return;
    syncThrottleRef.current = now;
    
    const nearestImage = findNearestImage(syncState.position);
    if (nearestImage && nearestImage.id !== lastSyncedImageIdRef.current) {
      lastSyncedImageIdRef.current = nearestImage.id;
      
      try {
        const currentUrl = new URL(iframeRef.current.src);
        currentUrl.searchParams.set('image', String(nearestImage.id));
        currentUrl.searchParams.set('vlon', ((syncState.heading * Math.PI) / 180).toFixed(2));
        currentUrl.searchParams.set('vlat', ((syncState.pitch * Math.PI) / 180).toFixed(2));
        
        console.log('[Ivion Sync] Iframe: Navigating to image:', nearestImage.id);
        iframeRef.current.src = currentUrl.toString();
        setCurrentImageId(nearestImage.id);
        setLastSyncSource('3d');
      } catch (err) {
        console.error('[Ivion Sync] Iframe URL update failed:', err);
      }
    }
  }, [iframeRef, syncState, findNearestImage]);

  // ─── Unified sync dispatch ────────────────────────────────────────
  
  const syncToIvion = useCallback(() => {
    if (ivApiRef?.current) {
      syncToIvionSdk();
    } else {
      syncToIvionIframe();
    }
  }, [ivApiRef?.current, syncToIvionSdk, syncToIvionIframe]);

  // No-op subscribe for iframe mode (Ivion doesn't support postMessage commands)
  const sendSubscribeCommand = useCallback(() => {
    // In SDK mode: not needed (we use direct API)
    // In iframe mode: postMessage subscribe doesn't work
    console.debug('[Ivion Sync] Subscribe command is no longer needed');
  }, []);

  // Manual URL sync (fallback for both modes)
  const syncFrom360Url = useCallback(async (ivionUrl: string): Promise<boolean> => {
    try {
      const url = new URL(ivionUrl);
      const imageIdStr = url.searchParams.get('image');
      
      if (!imageIdStr) {
        console.error('[Ivion Sync] No image parameter in URL');
        return false;
      }
      
      const vlon = parseFloat(url.searchParams.get('vlon') || '0');
      const vlat = parseFloat(url.searchParams.get('vlat') || '0');
      const heading = (vlon * 180) / Math.PI;
      const pitch = (vlat * 180) / Math.PI;
      const imageId = parseInt(imageIdStr, 10);
      
      // Try image cache first
      const cachedImage = imageCache.find(img => img.id === imageId);
      if (cachedImage) {
        const position: LocalCoords = {
          x: cachedImage.location.x,
          y: cachedImage.location.y,
          z: cachedImage.location.z,
        };
        updateFromIvion(position, heading, pitch);
        setCurrentImageId(imageId);
        setLastSyncSource('ivion');
        lastSyncedImageIdRef.current = imageId;
        return true;
      }
      
      // Fetch from API
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'get-image-position',
          imageId,
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
      
      updateFromIvion(position, heading, pitch);
      setCurrentImageId(imageId);
      setLastSyncSource('ivion');
      lastSyncedImageIdRef.current = imageId;
      
      return true;
    } catch (err) {
      console.error('[Ivion Sync] Failed to parse URL:', err);
      return false;
    }
  }, [buildingFmGuid, imageCache, updateFromIvion]);

  // Auto-sync when 3D camera changes (both modes)
  useEffect(() => {
    if (!enabled || !syncLocked) return;
    if (syncState.source !== '3d' || !syncState.position) return;
    if (isSyncingRef.current) return;
    if (imageCache.length === 0) return;
    
    // SDK mode: faster response
    const delay = ivApiRef?.current ? 200 : 500;
    
    const timer = setTimeout(() => {
      syncToIvion();
    }, delay);
    
    return () => clearTimeout(timer);
  }, [enabled, syncLocked, syncState, imageCache.length, syncToIvion, ivApiRef?.current]);

  return {
    imageCache,
    isLoadingImages,
    currentImageId,
    syncToIvion,
    syncFrom360Url,
    sendSubscribeCommand,
    lastSyncSource,
    postMessageActive: sdkSyncActive, // SDK active = auto-sync working
    hasImageLoadError,
    retryLoadImages,
  };
}
