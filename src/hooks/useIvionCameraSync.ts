/**
 * Hook for synchronizing camera between Ivion 360° viewer and sync context.
 * Uses postMessage communication with the Ivion iframe.
 * 
 * NavVis Ivion Frontend API:
 * - Events: 'navvis-event' with event type 'camera-changed'
 * - Commands: 'navvis-command' with action 'moveToGeoLocation'
 */

import { useEffect, useRef, useCallback } from 'react';
import { useViewerSync, LocalCoords } from '@/context/ViewerSyncContext';
import {
  localToGeo,
  geoToLocal,
  bimToGeoHeading,
  geoToBimHeading,
  normalizeHeading,
  type BuildingOrigin,
} from '@/lib/coordinate-transform';

interface UseIvionCameraSyncOptions {
  /** Reference to the iframe element */
  iframeRef: React.RefObject<HTMLIFrameElement>;
  /** Whether sync is enabled */
  enabled: boolean;
  /** Building origin for coordinate transformation */
  buildingOrigin: BuildingOrigin | null;
  /** Ivion origin URL for postMessage security */
  ivionOrigin: string;
}

interface IvionCameraEvent {
  type: 'navvis-event';
  event: 'camera-changed';
  data: {
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
  };
}

/**
 * Hook for 360° viewer camera synchronization via postMessage.
 */
export function useIvionCameraSync({
  iframeRef,
  enabled,
  buildingOrigin,
  ivionOrigin,
}: UseIvionCameraSyncOptions): void {
  const { syncLocked, syncState, updateFromIvion } = useViewerSync();
  
  // Track if we're currently in the middle of a sync operation
  const isSyncing = useRef(false);
  const lastMessageTime = useRef(0);
  const MESSAGE_THROTTLE_MS = 200;

  // Listen for messages from Ivion iframe
  useEffect(() => {
    if (!enabled || !syncLocked) return;

    const handleMessage = (event: MessageEvent) => {
      // Security check: verify origin
      if (!ivionOrigin || !event.origin.includes(new URL(ivionOrigin).hostname)) {
        return;
      }

      // Check if this is a NavVis camera event
      const data = event.data as IvionCameraEvent;
      if (data?.type !== 'navvis-event' || data?.event !== 'camera-changed') {
        return;
      }

      // Throttle messages
      const now = Date.now();
      if (now - lastMessageTime.current < MESSAGE_THROTTLE_MS) return;
      lastMessageTime.current = now;

      // Don't process if we're currently syncing to avoid loops
      if (isSyncing.current) return;

      const { lat, lng, heading, pitch } = data.data;

      console.log('[Ivion Sync] Received camera event:', { lat, lng, heading, pitch });

      // Transform to local coordinates if we have origin data
      if (buildingOrigin) {
        const localPos = geoToLocal({ lat, lng }, buildingOrigin);
        const bimHeading = geoToBimHeading(heading, buildingOrigin.rotation);

        console.log('[Ivion Sync] Transformed to local:', { localPos, bimHeading });
        updateFromIvion(localPos, bimHeading, pitch);
      } else {
        // Fallback: use raw coordinates (won't be accurate but allows basic sync)
        const localPos: LocalCoords = { x: lng * 100000, y: 1.6, z: lat * 100000 };
        updateFromIvion(localPos, heading, pitch);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [enabled, syncLocked, buildingOrigin, ivionOrigin, updateFromIvion]);

  // Send navigation commands to Ivion when 3D viewer updates
  useEffect(() => {
    if (!enabled || !syncLocked) return;
    if (syncState.source !== '3d' || !syncState.position) return;
    if (!iframeRef.current?.contentWindow) return;

    // Prevent feedback loop
    isSyncing.current = true;

    console.log('[Ivion Sync] Sending to Ivion:', syncState);

    // Transform to geographic coordinates
    let lat: number, lng: number, heading: number;

    if (buildingOrigin) {
      const geo = localToGeo(syncState.position, buildingOrigin);
      lat = geo.lat;
      lng = geo.lng;
      heading = bimToGeoHeading(syncState.heading, buildingOrigin.rotation);
    } else {
      // Fallback: rough conversion (won't be accurate)
      lat = syncState.position.z / 100000;
      lng = syncState.position.x / 100000;
      heading = syncState.heading;
    }

    // Send moveToGeoLocation command to Ivion
    const command = {
      type: 'navvis-command',
      action: 'moveToGeoLocation',
      params: {
        lat,
        lng,
        heading: normalizeHeading(heading),
        pitch: syncState.pitch,
      },
    };

    console.log('[Ivion Sync] Posting command:', command);
    
    try {
      iframeRef.current.contentWindow.postMessage(command, '*');
    } catch (err) {
      console.error('[Ivion Sync] Failed to post message:', err);
    }

    // Clear syncing flag after a delay
    setTimeout(() => {
      isSyncing.current = false;
    }, 500);
  }, [enabled, syncLocked, syncState, iframeRef, buildingOrigin]);
}
