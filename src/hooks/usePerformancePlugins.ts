/**
 * usePerformancePlugins — Installs xeokit performance plugins after viewer init.
 *
 * 1. FastNavPlugin  — Lowers canvas resolution & hides edges/SAO during camera movement.
 * 2. ViewCullPlugin — Frustum culling, hides objects outside the camera view.
 * 3. LOD distance culling — Hides small objects when the camera is far away.
 *
 * All plugins are lazily loaded from the xeokit ES-module CDN so we don't add
 * to the initial bundle.
 */
import { useEffect, useRef } from 'react';

const XEOKIT_CDN = '/lib/xeokit/xeokit-sdk.es.js';

// Distance thresholds for LOD culling (shorter on mobile for performance)
const LOD_FAR_DISTANCE_DESKTOP = 50;
const LOD_FAR_DISTANCE_MOBILE = 30;
const LOD_CHECK_INTERVAL_MS = 500;

interface UsePerformancePluginsOptions {
  /** The xeokit Viewer instance (viewer.scene must exist) */
  viewerRef: React.MutableRefObject<any>;
  /** Set to true once the model has fully loaded */
  ready: boolean;
  /** Mobile devices get more aggressive settings */
  isMobile: boolean;
}

export function usePerformancePlugins({ viewerRef, ready, isMobile }: UsePerformancePluginsOptions) {
  const pluginsRef = useRef<{ fastNav?: any; viewCull?: any; lodInterval?: ReturnType<typeof setInterval> }>({});

  useEffect(() => {
    if (!ready) return;

    const getXeokitViewer = () => {
      const v = viewerRef.current;
      return v?.$refs?.AssetViewer?.$refs?.assetView?.viewer ?? null;
    };

    let cancelled = false;

    const install = async () => {
      const xeokitViewer = getXeokitViewer();
      if (!xeokitViewer?.scene) {
        console.debug('[perf-plugins] No xeokit viewer available');
        return;
      }

      try {
        // Dynamic import from xeokit CDN
        const sdkResponse = await fetch(XEOKIT_CDN);
        const sdkText = await sdkResponse.text();
        const sdkBlob = new Blob([sdkText], { type: 'application/javascript' });
        const sdkBlobUrl = URL.createObjectURL(sdkBlob);
        const sdk = await import(/* @vite-ignore */ sdkBlobUrl);
        URL.revokeObjectURL(sdkBlobUrl);
        if (cancelled) return;

        // 1. FastNavPlugin — SKIPPED: already installed by NativeXeokitViewer
        // Avoid double installation which wastes resources
        console.log('[perf-plugins] FastNavPlugin skipped (handled by NativeXeokitViewer)');

        // 2. ViewCullPlugin (frustum culling)
        if (sdk.ViewCullPlugin && !pluginsRef.current.viewCull) {
          pluginsRef.current.viewCull = new sdk.ViewCullPlugin(xeokitViewer, {
            maxTreeDepth: 20,
          });
          console.log('[perf-plugins] ViewCullPlugin installed');
        }
      } catch (e) {
        console.warn('[perf-plugins] Could not load xeokit SDK plugins:', e);
      }

      // 3. SAO (Scalable Ambient Obscurance) — soft contact shadows
      try {
        const sao = xeokitViewer.scene?.sao;
        const sceneObjectCount = xeokitViewer.scene?.objectIds?.length || Object.keys(xeokitViewer.scene?.objects || {}).length;
        const enableSao = !isMobile && sceneObjectCount <= 40000;

        if (sao && enableSao) {
          sao.enabled = true;
          sao.intensity = 0.12;
          sao.bias = 0.5;
          sao.scale = 500;
          sao.kernelRadius = 50;
          sao.minResolution = 0;
          sao.numSamples = 32;
          sao.blendFactor = 1.0;
          sao.blur = true;
          console.log('[perf-plugins] SAO enabled (desktop)', { objectCount: sceneObjectCount });
        } else if (sao) {
          sao.enabled = false;
          console.log('[perf-plugins] SAO disabled (mobile/heavy scene)', { objectCount: sceneObjectCount });
        }
      } catch (e) {
        console.debug('[perf-plugins] SAO setup error:', e);
      }

      // 3. LOD distance culling — hide small entities when camera is far
      // Enabled on all devices (mobile uses shorter distance)
      if (!pluginsRef.current.lodInterval) {
        const scene = xeokitViewer.scene;
        const objectCount = scene?.objectIds?.length || Object.keys(scene?.objects || {}).length;
        if (objectCount <= 50000) {
          // Use requestIdleCallback to avoid blocking rendering
          const runLodCull = () => {
            if (!scene?.camera || !scene.objects) return;
            const eye = scene.camera.eye;
            const objects = scene.objects;
            // Process in batches to avoid long frame stalls
            const ids = Object.keys(objects);
            let i = 0;
            const BATCH_SIZE = 2000;
            const processBatch = (deadline?: IdleDeadline) => {
              const end = Math.min(i + BATCH_SIZE, ids.length);
              for (; i < end; i++) {
                const entity = objects[ids[i]];
                if (!entity?.aabb) continue;
                const aabb = entity.aabb;
                const dx = aabb[3] - aabb[0];
                const dy = aabb[4] - aabb[1];
                const dz = aabb[5] - aabb[2];
                const size = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (size > 2) continue;
                const cx = (aabb[0] + aabb[3]) / 2;
                const cy = (aabb[1] + aabb[4]) / 2;
                const cz = (aabb[2] + aabb[5]) / 2;
                const dist = Math.sqrt(
                  (eye[0] - cx) ** 2 + (eye[1] - cy) ** 2 + (eye[2] - cz) ** 2
                );
                const lodDist = isMobile ? LOD_FAR_DISTANCE_MOBILE : LOD_FAR_DISTANCE_DESKTOP;
                entity.culled = dist > lodDist;
              }
              if (i < ids.length) {
                requestIdleCallback(processBatch, { timeout: 200 });
              }
            };
            if (typeof requestIdleCallback !== 'undefined') {
              requestIdleCallback(processBatch, { timeout: 200 });
            } else {
              processBatch();
            }
          };
          // Run LOD cull less frequently (every 1s instead of 500ms)
          pluginsRef.current.lodInterval = setInterval(runLodCull, 1000);
          console.log('[perf-plugins] LOD distance culling started (batched)', { objectCount });
        } else {
          console.log('[perf-plugins] LOD culling skipped — too many objects:', objectCount);
        }
      }
    };

    install();

    return () => {
      cancelled = true;
      if (pluginsRef.current.lodInterval) {
        clearInterval(pluginsRef.current.lodInterval);
        pluginsRef.current.lodInterval = undefined;
      }
      // Destroy plugins if they have a destroy method
      pluginsRef.current.viewCull?.destroy?.();
      pluginsRef.current.viewCull = undefined;
    };
  }, [ready, isMobile, viewerRef]);
}
