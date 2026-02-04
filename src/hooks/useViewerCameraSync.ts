/**
 * Hook for synchronizing camera between 3D viewer and sync context.
 * Used by AssetPlusViewer to broadcast and receive camera changes.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useViewerSync, LocalCoords } from '@/context/ViewerSyncContext';
import {
  calculateHeadingFromCamera,
  calculatePitchFromCamera,
  calculateLookFromHeadingPitch,
} from '@/lib/coordinate-transform';

interface UseViewerCameraSyncOptions {
  /** Reference to the xeokit viewer instance */
  viewerRef: React.MutableRefObject<any>;
  /** Whether sync is enabled */
  enabled: boolean;
  /** Callback when camera sync is received from 360° viewer */
  onSyncReceived?: (position: LocalCoords, heading: number, pitch: number) => void;
}

interface UseViewerCameraSyncReturn {
  /** Manually broadcast camera position (call after user interaction) */
  broadcastCamera: () => void;
}

/**
 * Hook for 3D viewer camera synchronization.
 * 
 * This hook:
 * 1. Listens to xeokit camera changes and broadcasts to sync context
 * 2. Receives sync updates from 360° viewer and can trigger flyTo
 */
export function useViewerCameraSync({
  viewerRef,
  enabled,
  onSyncReceived,
}: UseViewerCameraSyncOptions): UseViewerCameraSyncReturn {
  const { syncLocked, syncState, updateFrom3D, buildingContext } = useViewerSync();
  
  // Track if we're currently in the middle of a sync operation to prevent loops
  const isSyncing = useRef(false);
  const lastBroadcastTime = useRef(0);
  const BROADCAST_THROTTLE_MS = 200;

  // Get xeokit viewer from AssetPlus viewer
  const getXeokitViewer = useCallback(() => {
    const viewer = viewerRef.current;
    return viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }, [viewerRef]);

  // Broadcast current camera position to sync context
  const broadcastCamera = useCallback(() => {
    if (!enabled || !syncLocked || isSyncing.current) return;

    const now = Date.now();
    if (now - lastBroadcastTime.current < BROADCAST_THROTTLE_MS) return;
    lastBroadcastTime.current = now;

    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer?.scene?.camera) return;

    const camera = xeokitViewer.scene.camera;
    const eye = camera.eye;
    const look = camera.look;

    const position: LocalCoords = {
      x: eye[0],
      y: eye[1],
      z: eye[2],
    };

    const heading = calculateHeadingFromCamera(eye, look);
    const pitch = calculatePitchFromCamera(eye, look);

    console.log('[3D Sync] Broadcasting camera:', { position, heading, pitch });
    updateFrom3D(position, heading, pitch);
  }, [enabled, syncLocked, getXeokitViewer, updateFrom3D]);

  // Listen for camera changes and broadcast
  useEffect(() => {
    if (!enabled || !syncLocked) return;

    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer?.scene?.camera) return;

    const camera = xeokitViewer.scene.camera;

    // Handler for camera matrix changes
    const handleCameraChange = () => {
      // Don't broadcast if we're currently receiving a sync
      if (isSyncing.current) return;
      broadcastCamera();
    };

    // Subscribe to camera events
    const viewMatrixSub = camera.on('viewMatrix', handleCameraChange);

    return () => {
      camera.off(viewMatrixSub);
    };
  }, [enabled, syncLocked, getXeokitViewer, broadcastCamera]);

  // React to sync state changes from 360° viewer
  useEffect(() => {
    if (!enabled || !syncLocked) return;
    if (syncState.source !== 'ivion' || !syncState.position) return;

    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer?.scene?.camera) return;

    // Prevent feedback loop
    isSyncing.current = true;

    console.log('[3D Sync] Received from Ivion:', syncState);

    // Call the callback if provided (for custom fly-to behavior)
    if (onSyncReceived) {
      onSyncReceived(syncState.position, syncState.heading, syncState.pitch);
    } else {
      // Default behavior: fly to the position
      const camera = xeokitViewer.scene.camera;
      const eye = [syncState.position.x, syncState.position.y, syncState.position.z];
      const look = calculateLookFromHeadingPitch(eye, syncState.heading, syncState.pitch);

      // Use CameraFlightAnimation if available
      const cameraFlight = xeokitViewer.cameraFlight;
      if (cameraFlight) {
        cameraFlight.flyTo(
          {
            eye,
            look,
            up: [0, 1, 0],
            duration: 0.5,
          },
          () => {
            isSyncing.current = false;
          }
        );
      } else {
        // Fallback to direct camera set
        camera.eye = eye;
        camera.look = look;
        camera.up = [0, 1, 0];
        setTimeout(() => {
          isSyncing.current = false;
        }, 100);
      }
    }
  }, [enabled, syncLocked, syncState, getXeokitViewer, onSyncReceived]);

  return { broadcastCamera };
}
