/**
 * Hook for synchronizing camera between Ivion 360° viewer and 3D viewer.
 * 
 * Strategy: Bi-directional automatic sync
 * - 3D → 360°: Find nearest Ivion image, update iframe URL with &image=XXX
 * - 360° → 3D: Listen for postMessage events from Ivion iframe
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
  /** Callback when iframe loads - triggers subscribe command */
  onIframeLoad?: () => void;
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
  /** Send subscribe command to iframe */
  sendSubscribeCommand: () => void;
  /** Last sync source for status indicator */
  lastSyncSource: 'ivion' | '3d' | null;
  /** Whether postMessage sync is working */
  postMessageActive: boolean;
  /** Whether there was an error loading images */
  hasImageLoadError: boolean;
  /** Retry loading images from Ivion */
  retryLoadImages: () => Promise<void>;
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
  const [hasImageLoadError, setHasImageLoadError] = useState(false);
  const [currentImageId, setCurrentImageId] = useState<number | null>(null);
  const [lastSyncSource, setLastSyncSource] = useState<'ivion' | '3d' | null>(null);
  const [postMessageActive, setPostMessageActive] = useState(false);
  
  // Track last synced image to avoid loops
  const lastSyncedImageIdRef = useRef<number | null>(null);
  const isSyncingRef = useRef(false);
  const syncThrottleRef = useRef<number>(0);
  const postMessageReceivedRef = useRef(false);
  const SYNC_THROTTLE_MS = 2000; // Minimum time between URL updates

  // Load images function - reusable for retry
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
      
      if (data?.success && data?.images && data.images.length > 0) {
        setImageCache(data.images);
        setHasImageLoadError(false);
        console.log(`[Ivion Sync] Loaded ${data.images.length} images for site (${data.processedDatasets}/${data.totalDatasets} datasets)`);
      } else {
        console.warn('[Ivion Sync] No images returned:', data?.error || 'Unknown error');
        setHasImageLoadError(true);
      }
    } catch (e) {
      console.error('[Ivion Sync] Failed to load images:', e);
      setHasImageLoadError(true);
    } finally {
      setIsLoadingImages(false);
    }
  }, [ivionSiteId, buildingFmGuid]);

  // Retry function exposed to UI
  const retryLoadImages = useCallback(async () => {
    await loadImages();
  }, [loadImages]);

  // 1. Load all images for the site on mount
  useEffect(() => {
    if (!enabled || !ivionSiteId) return;
    loadImages();
  }, [enabled, ivionSiteId, loadImages]);

  // 2. Send subscribe command to iframe to enable camera events
  const sendSubscribeCommand = useCallback(() => {
    if (!iframeRef.current?.contentWindow) {
      console.log('[Ivion Sync] No iframe to send subscribe command');
      return;
    }

    // NavVis may support different command formats - try multiple
    const subscribeCommands = [
      { type: 'navvis-command', action: 'subscribe' },
      { type: 'navvis-command', action: 'subscribe', events: ['camera-changed', 'image-changed'] },
      { type: 'navvis-subscribe', events: ['cameraUpdate', 'imageChange'] },
      { type: 'subscribe', events: ['camera', 'navigation'] },
    ];

    console.log('[Ivion Sync] Sending subscribe commands to iframe');
    
    subscribeCommands.forEach((cmd, i) => {
      try {
        iframeRef.current?.contentWindow?.postMessage(cmd, '*');
      } catch (e) {
        console.warn(`[Ivion Sync] Failed to send command ${i}:`, e);
      }
    });
  }, [iframeRef]);

  // 3. Listen for postMessage events from Ivion iframe (360° → 3D sync)
  useEffect(() => {
    if (!enabled || !syncLocked) return;

    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      
      // Skip non-object messages
      if (!data || typeof data !== 'object') return;

      // Log all messages for debugging (only first time)
      if (!postMessageReceivedRef.current && data.type) {
        console.log('[Ivion Sync] Received postMessage:', data);
      }

      // NavVis event format
      if (data?.type === 'navvis-event') {
        console.log('[Ivion Sync] NavVis event:', data.event, data.data);
        postMessageReceivedRef.current = true;
        setPostMessageActive(true);
        
        if (data.event === 'camera-changed' || data.event === 'image-changed') {
          const eventData = data.data || {};
          const imageId = eventData.imageId || eventData.image;
          const heading = eventData.yaw ?? eventData.heading ?? 0;
          const pitch = eventData.pitch ?? 0;
          
          if (imageId && imageId !== lastSyncedImageIdRef.current) {
            await handleIvionImageChange(imageId, heading, pitch);
          }
        }
        return;
      }

      // Alternative formats - direct camera/image data
      if (data?.imageId || data?.currentImage || data?.image) {
        const imageId = data.imageId || data.currentImage || data.image;
        console.log('[Ivion Sync] Direct image data:', imageId);
        postMessageReceivedRef.current = true;
        setPostMessageActive(true);
        
        if (imageId !== lastSyncedImageIdRef.current) {
          const heading = data.heading ?? data.yaw ?? 0;
          const pitch = data.pitch ?? 0;
          await handleIvionImageChange(imageId, heading, pitch);
        }
        return;
      }

      // Camera position update
      if (data?.camera?.position || data?.position) {
        console.log('[Ivion Sync] Camera position data:', data);
        postMessageReceivedRef.current = true;
        setPostMessageActive(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [enabled, syncLocked, buildingFmGuid]);

  // Handle image change from Ivion - fetch position and update 3D
  const handleIvionImageChange = useCallback(async (imageId: number, heading: number, pitch: number) => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      console.log('[Ivion Sync] Handling image change:', imageId);
      
      // Fetch image position from API
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'get-image-position',
          imageId,
          buildingFmGuid,
        },
      });

      if (error) {
        console.error('[Ivion Sync] Failed to get image position:', error);
        return;
      }

      if (data?.success && data?.location) {
        const position: LocalCoords = {
          x: data.location.x,
          y: data.location.y,
          z: data.location.z,
        };

        // Convert heading/pitch from radians if needed
        const headingDeg = Math.abs(heading) > Math.PI * 2 ? heading : (heading * 180) / Math.PI;
        const pitchDeg = Math.abs(pitch) > Math.PI * 2 ? pitch : (pitch * 180) / Math.PI;

        console.log('[Ivion Sync] Updating 3D viewer from Ivion image:', imageId, position);
        updateFromIvion(position, headingDeg, pitchDeg);
        setCurrentImageId(imageId);
        setLastSyncSource('ivion');
        lastSyncedImageIdRef.current = imageId;
      }
    } catch (e) {
      console.error('[Ivion Sync] Failed to handle image change:', e);
    } finally {
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 500);
    }
  }, [buildingFmGuid, updateFromIvion]);

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
      setLastSyncSource('3d');
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
      setLastSyncSource('ivion');
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
    sendSubscribeCommand,
    lastSyncSource,
    postMessageActive,
    hasImageLoadError,
    retryLoadImages,
  };
}
