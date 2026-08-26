/**
 * useXeokitInstance — Creates and manages the xeokit Viewer lifecycle.
 *
 * Handles: SDK loading, Viewer creation, camera defaults, NavCube,
 * FastNav, WebGL context loss, and cleanup on unmount.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { logger } from '@/lib/logger';

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
      // Direct ESM import from the static /public path — allows browser HTTP caching.
      // Use a version-stamped query param so stale bundles get busted on SDK upgrades.
      sdk = await import(/* @vite-ignore */ `${XEOKIT_CDN}?v=3`);
      (window as any).__xeokitSdk = sdk;
    }

    // 2. Create viewer
    // devicePixelRatio is CRITICAL for sharp rendering on HiDPI/Retina displays.
    // Without it xeokit defaults to DPR=1, rendering at half (or third) physical
    // resolution and upscaling via CSS — the primary cause of blur.
    const viewer = new sdk.Viewer({
      canvasElement: canvasRef.current,
      transparent: false,          // opaque canvas = no alpha compositing overhead, sharper edges
      backgroundColor: [0.176, 0.176, 0.176], // match NativeViewerShell gradient mid-point (#2D2D2D)
      saoEnabled: false,           // disabled during loading — enabled after models load to avoid GPU stalls
      entityOffsetsEnabled: true,
      dtxEnabled: true,
      pbrEnabled: false,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2), // cap at 2× to protect GPU on 3× screens
    });

    // Edge material — visible, crisp architectural edges
    if (viewer.scene?.edgeMaterial) {
      viewer.scene.edgeMaterial.edgeColor = [0.20, 0.20, 0.20];
      viewer.scene.edgeMaterial.edgeAlpha = 0.6;
      viewer.scene.edgeMaterial.edgeWidth = 1;
    }

    // SAO (Scalable Ambient Obscurance) — depth perception in dense models.
    // FastNav disables SAO during camera movement and re-enables at stop.
    // User can toggle via localStorage['viewer-sao-enabled'] = 'false'.
    const saoDisabled = (() => {
      try { return localStorage.getItem('viewer-sao-enabled') === 'false'; } catch { return false; }
    })();
    if (viewer.scene?.sao) {
      viewer.scene.sao.enabled = !saoDisabled;
      viewer.scene.sao.numSamples = 16;
      viewer.scene.sao.kernelRadius = 100;
      viewer.scene.sao.intensity = 0.18;
      viewer.scene.sao.bias = 0.5;
      viewer.scene.sao.scale = 1000;
      viewer.scene.sao.blurEnabled = true;
      viewer.scene.sao.blurRadius = 8;
      viewer.scene.sao.blurStdDev = 4;
    }

    // Suppress context menu on the canvas (right-click should orbit, not show browser menu).
    // NativeXeokitViewer owns webglcontextlost recovery — no duplicate listener here.
    const canvas = canvasRef.current;
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

    // 5. NavCube + SectionPlanes overview canvas (sibling canvases in the viewer container)
    {
      // Section planes overview — hidden by default, SectionPlanesPlugin manages visibility
      const spOverviewCanvas = document.createElement('canvas');
      spOverviewCanvas.id = `native-sectionplanes-overview-${buildingFmGuid.substring(0, 8)}`;
      spOverviewCanvas.style.cssText = 'position:absolute;bottom:220px;right:10px;width:120px;height:120px;pointer-events:none;display:none;';
      canvasRef.current?.parentElement?.appendChild(spOverviewCanvas);

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
        // NavCubePlugin.js uses document.getElementById(cfg.canvasId), needs ID string
        new CustomNavCube(viewer, { canvasId: navCubeCanvas.id });
      } else if (sdk.NavCubePlugin) {
        new sdk.NavCubePlugin(viewer, { canvasElement: navCubeCanvas });
      }
    }

    // 6. FastNav — on by default; users can opt out via localStorage
    // Drops canvas resolution during camera movement for smooth interaction,
    // then restores full quality when the camera stops.
    const fastNavDisabled = (() => {
      try { return localStorage.getItem('viewer-fastnav-enabled') === 'false'; } catch { return false; }
    })();
    if (sdk.FastNavPlugin && !fastNavDisabled) {
      new sdk.FastNavPlugin(viewer, {
        scaleCanvasResolution: true,
        scaleCanvasResolutionFactor: isMobileRef.current ? 0.5 : 0.6,
        hideEdges: true,
        hideSAO: true,
        delayBeforeRestore: true,
        delayBeforeRestoreSeconds: isMobileRef.current ? 0.5 : 0.25,
      });
    }

    // 6b. ViewCullPlugin — kd-tree frustum culling, reduces GPU draw calls on large models.
    // maxTreeDepth=8 (2^8=256 leaf nodes) is safe up to ~150k entities and avoids the
    // memory/build-time blowup that maxTreeDepth=20 (1M nodes) causes on large models.
    if (sdk.ViewCullPlugin) {
      new sdk.ViewCullPlugin(viewer, { maxTreeDepth: 8 });
    }

    // 6c. BCFViewpointsPlugin — save/restore camera + section planes + object states in BCF format
    if (sdk.BCFViewpointsPlugin) {
      const bcf = new sdk.BCFViewpointsPlugin(viewer, {});
      (window as any).__xeokitBCF = bcf;
    }

    // 6d. SectionPlanesPlugin — interactive drag-gizmos for section planes.
    // Exposes via window so useSectionPlaneClipping can create/destroy planes through it.
    if (sdk.SectionPlanesPlugin) {
      const sectionPlanesPlugin = new sdk.SectionPlanesPlugin(viewer, {
        overviewCanvasId: `native-sectionplanes-overview-${buildingFmGuid.substring(0, 8)}`,
      });
      (window as any).__xeokitSectionPlanesPlugin = sectionPlanesPlugin;
    }
    // Keep bare SectionPlane class available as fallback (used by useSectionPlaneClipping)
    if (sdk.SectionPlane) {
      (window as any).__xeokitSectionPlaneClass = sdk.SectionPlane;
    }

    // 7. Loaders
    const xktLoader = new sdk.XKTLoaderPlugin(viewer, { reuseGeometries: true });
    let gltfLoader: any = null;
    if (sdk.GLTFLoaderPlugin) {
      gltfLoader = new sdk.GLTFLoaderPlugin(viewer);
    }

    // LASLoaderPlugin — pointcloud support (LAS/LAZ files)
    if (sdk.LASLoaderPlugin) {
      const lasLoader = new sdk.LASLoaderPlugin(viewer, {});
      (window as any).__xeokitLASLoader = lasLoader;
    }

    // DPR resize: re-size canvas when moving between screens with different pixel ratios.
    // window.matchMedia('(resolution: Xdpi)') fires when the DPR changes (e.g. drag to
    // external monitor). Update the viewer's devicePixelRatio so it stays sharp.
    const dprMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handleDprChange = () => {
      const newDpr = Math.min(window.devicePixelRatio || 1, 2);
      try {
        if (viewer.scene?.canvas?.canvas) {
          viewer.scene.canvas.canvas.setAttribute('data-dpr', String(newDpr));
        }
        if (typeof viewer.scene?.setDevicePixelRatio === 'function') {
          viewer.scene.setDevicePixelRatio(newDpr);
        } else if (viewer.scene?.canvas) {
          // Fallback: trigger canvas resize which picks up new CSS px dimensions
          viewer.scene.canvas._needsUpdate = true;
          viewer.scene._needsUpdate = true;
        }
      } catch { /* ignore if scene is already destroyed */ }
    };
    dprMediaQuery.addEventListener('change', handleDprChange);
    // Attach cleanup to canvas contextmenu (already listened on) for teardown consistency
    const origCanvasRef = canvasRef.current;

    viewerRef.current = viewer;
    sdkRef.current = sdk;
    xktLoaderRef.current = xktLoader;
    gltfLoaderRef.current = gltfLoader;

    // Store dprMediaQuery cleanup on the viewer object so destroy() can remove it
    viewer.__dprCleanup = () => dprMediaQuery.removeEventListener('change', handleDprChange);

    return { viewer, sdk, xktLoader, gltfLoader };
  }, [buildingFmGuid, canvasRef, onContextLost]);

  const destroy = useCallback(() => {
    if (viewerRef.current) {
      try { viewerRef.current.__dprCleanup?.(); } catch {}
      try { viewerRef.current.destroy(); } catch (e) {
        logger.debug('[useXeokitInstance] Viewer destroy error:', e);
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
