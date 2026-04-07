/**
 * useXeokitInstance — Creates and manages the xeokit Viewer lifecycle.
 *
 * Handles: SDK loading, Viewer creation, camera defaults, NavCube,
 * FastNav, WebGL context loss, and cleanup on unmount.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

const XEOKIT_CDN = '/lib/xeokit/xeokit-sdk.es.js';

interface UseXeokitInstanceOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  buildingFmGuid: string;
  onContextLost?: () => void;
}

interface XeokitInstanceResult {
  viewer: any;
  sdk: any;
  xktLoader: any;
  gltfLoader: any | null;
}

export function useXeokitInstance({ canvasRef, buildingFmGuid, onContextLost }: UseXeokitInstanceOptions) {
  const viewerRef = useRef<any>(null);
  const sdkRef = useRef<any>(null);
  const xktLoaderRef = useRef<any>(null);
  const gltfLoaderRef = useRef<any>(null);
  const isMobile = useIsMobile();
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  const createInstance = useCallback(async (): Promise<XeokitInstanceResult | null> => {
    if (!canvasRef.current) return null;

    // 1. Load SDK (cached after first load)
    let sdk: any;
    if ((window as any).__xeokitSdk) {
      sdk = (window as any).__xeokitSdk;
    } else {
      const sdkResponse = await fetch(XEOKIT_CDN);
      const sdkText = await sdkResponse.text();
      const sdkBlob = new Blob([sdkText], { type: 'application/javascript' });
      const sdkBlobUrl = URL.createObjectURL(sdkBlob);
      sdk = await import(/* @vite-ignore */ sdkBlobUrl);
      URL.revokeObjectURL(sdkBlobUrl);
      (window as any).__xeokitSdk = sdk;
    }

    // 2. Create viewer
    const viewer = new sdk.Viewer({
      canvasElement: canvasRef.current,
      transparent: true,
      saoEnabled: false,
      entityOffsetsEnabled: true,
      dtxEnabled: true,
      pbrEnabled: false,
    });

    // WebGL context loss handling
    const canvas = canvasRef.current;
    canvas.addEventListener('webglcontextlost', (e: Event) => {
      e.preventDefault();
      console.error('[useXeokitInstance] ⚠️ WebGL context lost');
      onContextLost?.();
    });
    canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());

    // Expose SectionPlane class globally
    if (sdk.SectionPlane) {
      (window as any).__xeokitSectionPlaneClass = sdk.SectionPlane;
    }

    // 3. Camera defaults
    viewer.camera.eye = [0, 20, 40];
    viewer.camera.look = [0, 0, 0];
    viewer.camera.up = [0, 1, 0];
    viewer.camera.projection = 'perspective';

    // 4. Camera control tuning
    if (viewer.cameraControl) {
      const cc = viewer.cameraControl;
      let speedMultiplier = 1;
      try {
        const stored = localStorage.getItem('viewer-nav-speed');
        if (stored) speedMultiplier = parseInt(stored) / 100;
      } catch {}
      speedMultiplier = Math.max(0.25, Math.min(3, speedMultiplier));

      const navTuning = isMobileRef.current
        ? {
            dragRotationRate: 45, rotationInertia: 0.15,
            touchPanRate: 0.08, panInertia: 0.15,
            touchDollyRate: 0.06, mouseWheelDollyRate: 15, keyboardDollyRate: 2,
          }
        : {
            dragRotationRate: 120 * speedMultiplier, rotationInertia: 0.85,
            touchPanRate: 0.3 * speedMultiplier, panInertia: 0.7,
            touchDollyRate: 0.15 * speedMultiplier, mouseWheelDollyRate: 50 * speedMultiplier, keyboardDollyRate: 5 * speedMultiplier,
          };

      Object.assign(cc, navTuning);
      cc.followPointer = true;

      // Mobile-specific touch optimizations
      if (isMobileRef.current) {
        cc.smartPivot = true;           // orbit around touched surface point
        cc.dollyMinSpeed = 0.02;        // prevent zoom jumps on slow pinches
        cc.dollyProximityThreshold = 15; // slow zoom near surfaces
        cc.panRightClick = false;       // irrelevant on touch
        cc.firstPerson = false;         // orbit mode default for touch
        if (cc.pointerEnabled !== undefined) cc.pointerEnabled = true;
      }

      // Double-click flyTo stability guard
      cc.on('doublePickedSurface', (pickResult: any) => {
        if (!pickResult?.worldPos) return;
        const [px, py, pz] = pickResult.worldPos;
        if (isNaN(px) || isNaN(py) || isNaN(pz)) return;
        const eyeY = viewer.camera?.eye?.[1] ?? 0;
        if (Math.abs(py - eyeY) > 50) return;
        viewer.cameraFlight.flyTo({
          eye: [px - 5, py + 5, pz - 5],
          look: pickResult.worldPos,
          up: [0, 1, 0],
          duration: 0.5,
        });
      });
      cc.on('doublePickedNothing', () => { /* no-op */ });
    }

    // 5. NavCube
    {
      const navCubeCanvas = document.createElement('canvas');
      navCubeCanvas.id = `native-navcube-${buildingFmGuid.substring(0, 8)}`;
      navCubeCanvas.style.cssText = 'position:absolute;bottom:60px;right:10px;width:150px;height:150px;pointer-events:auto;';
      const parentEl = canvasRef.current?.parentElement;
      if (parentEl) parentEl.appendChild(navCubeCanvas);

      if (!(window as any).NavCubePlugin) {
        await new Promise<void>((resolve) => {
          const script = document.createElement('script');
          script.src = '/lib/xeokit/NavCubePlugin.js?v=3';
          script.onload = () => resolve();
          script.onerror = () => resolve();
          document.head.appendChild(script);
        });
      }
      const CustomNavCube = (window as any).NavCubePlugin;
      if (CustomNavCube) {
        new CustomNavCube(viewer, { canvasElement: navCubeCanvas });
      } else if (sdk.NavCubePlugin) {
        new sdk.NavCubePlugin(viewer, { canvasElement: navCubeCanvas });
      }
    }

    // 6. FastNav
    const fastNavEnabled = (() => {
      try {
        const stored = localStorage.getItem('viewer-fastnav-enabled');
        return stored === 'true';
      } catch { return false; }
    })();
    if (sdk.FastNavPlugin && fastNavEnabled) {
      new sdk.FastNavPlugin(viewer, {
        scaleCanvasResolution: true,
        scaleCanvasResolutionFactor: 0.6,
        hideEdges: true,
        hideSAO: true,
        delayBeforeRestore: true,
        delayBeforeRestoreSeconds: isMobileRef.current ? 0.5 : 0.3,
      });
    }

    // 7. Loaders
    const xktLoader = new sdk.XKTLoaderPlugin(viewer, { reuseGeometries: true });
    let gltfLoader: any = null;
    if (sdk.GLTFLoaderPlugin) {
      gltfLoader = new sdk.GLTFLoaderPlugin(viewer);
    }

    viewerRef.current = viewer;
    sdkRef.current = sdk;
    xktLoaderRef.current = xktLoader;
    gltfLoaderRef.current = gltfLoader;

    return { viewer, sdk, xktLoader, gltfLoader };
  }, [buildingFmGuid, canvasRef, onContextLost]);

  const destroy = useCallback(() => {
    if (viewerRef.current) {
      try { viewerRef.current.destroy(); } catch (e) {
        console.debug('[useXeokitInstance] Viewer destroy error:', e);
      }
      viewerRef.current = null;
      (window as any).__nativeXeokitViewer = null;
      (window as any).__xktTileChunks = null;
      (window as any).__xktTileLoadedIds = null;
    }
    const nc = document.getElementById(`native-navcube-${buildingFmGuid.substring(0, 8)}`);
    nc?.remove();
  }, [buildingFmGuid]);

  return { viewerRef, sdkRef, xktLoaderRef, gltfLoaderRef, createInstance, destroy };
}
