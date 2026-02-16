/**
 * One-directional camera sync hook for Virtual Twin mode.
 * 
 * Polls the Ivion SDK's current image position and viewing direction,
 * applies the Ivion-to-BIM transform, and sets the xeokit camera directly.
 * 
 * Unlike the Split View sync (bi-directional via ViewerSyncContext),
 * this is strictly one-way: Ivion drives, xeokit follows.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { IvionApi } from '@/lib/ivion-sdk';
import { resolveMainView } from '@/lib/ivion-sdk';
import { ivionToBim, ivionHeadingToBim, type IvionBimTransform, IDENTITY_TRANSFORM } from '@/lib/ivion-bim-transform';
import { calculateLookFromHeadingPitch } from '@/lib/coordinate-transform';

interface UseVirtualTwinSyncOptions {
  /** Reference to the Ivion SDK API */
  ivApiRef: React.MutableRefObject<IvionApi | null>;
  /** Reference to the Asset+ viewer instance (contains xeokit internally) */
  viewerInstanceRef: React.MutableRefObject<any>;
  /** Ivion-to-BIM coordinate transform */
  transform: IvionBimTransform;
  /** Whether sync is active */
  enabled: boolean;
  /** FOV to set on the xeokit camera (degrees) */
  fov?: number;
}

interface UseVirtualTwinSyncResult {
  /** Whether sync loop is actively running */
  isActive: boolean;
  /** Current Ivion image ID being viewed */
  currentImageId: number | null;
}

/**
 * Hook that continuously syncs the xeokit camera to match the Ivion panorama pose.
 */
export function useVirtualTwinSync({
  ivApiRef,
  viewerInstanceRef,
  transform,
  enabled,
  fov = 90,
}: UseVirtualTwinSyncOptions): UseVirtualTwinSyncResult {
  const [isActive, setIsActive] = useState(false);
  const [currentImageId, setCurrentImageId] = useState<number | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastImageIdRef = useRef<number | null>(null);
  const lastLonRef = useRef<number | null>(null);
  const lastLatRef = useRef<number | null>(null);
  // Keep transform in a ref so the polling loop always uses the latest
  const transformRef = useRef<IvionBimTransform>(transform);
  transformRef.current = transform;

  const getXeokitViewer = useCallback(() => {
    try {
      return viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer ?? null;
    } catch {
      return null;
    }
  }, [viewerInstanceRef]);

  useEffect(() => {
    if (!enabled) {
      setIsActive(false);
      return;
    }

    let running = true;

    const poll = () => {
      if (!running) return;

      try {
        const ivApi = ivApiRef.current;
        const xeokitViewer = getXeokitViewer();
        if (!ivApi || !xeokitViewer?.scene?.camera) {
          animFrameRef.current = requestAnimationFrame(poll);
          return;
        }

        const mainView = resolveMainView(ivApi);
        if (!mainView) {
          animFrameRef.current = requestAnimationFrame(poll);
          return;
        }

        const image = mainView.getImage();
        const viewDir = mainView.currViewingDir;

        if (!image) {
          animFrameRef.current = requestAnimationFrame(poll);
          return;
        }

        // Check for meaningful change (position or view direction)
        const lon = viewDir?.lon ?? 0;
        const lat = viewDir?.lat ?? 0;
        const imageChanged = image.id !== lastImageIdRef.current;
        const viewChanged =
          lastLonRef.current !== null &&
          (Math.abs(lon - (lastLonRef.current ?? 0)) > 0.01 ||
           Math.abs(lat - (lastLatRef.current ?? 0)) > 0.01);

        if (imageChanged || viewChanged) {
          lastImageIdRef.current = image.id;
          lastLonRef.current = lon;
          lastLatRef.current = lat;

          const t = transformRef.current;

          // Transform position from Ivion space to BIM space
          const bimPos = ivionToBim(image.location, t);

          // Convert Ivion lon/lat (radians) to heading/pitch (degrees)
          const headingDeg = lon * (180 / Math.PI);
          const pitchDeg = lat * (180 / Math.PI);

          // Apply rotation transform to heading
          const bimHeading = ivionHeadingToBim(headingDeg, t);

          const eye: [number, number, number] = [bimPos.x, bimPos.y, bimPos.z];
          const look = calculateLookFromHeadingPitch(eye, bimHeading, pitchDeg) as [number, number, number];

          const camera = xeokitViewer.scene.camera;
          camera.eye = eye;
          camera.look = look;
          camera.up = [0, 1, 0];

          // Match FOV
          if (camera.perspective) {
            camera.perspective.fov = fov;
          }

          setCurrentImageId(image.id);
          setIsActive(true);
        }
      } catch (e) {
        // SDK might not be fully ready yet
      }

      animFrameRef.current = requestAnimationFrame(poll);
    };

    animFrameRef.current = requestAnimationFrame(poll);

    return () => {
      running = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [enabled, ivApiRef, getXeokitViewer, fov]);

  return { isActive, currentImageId };
}
