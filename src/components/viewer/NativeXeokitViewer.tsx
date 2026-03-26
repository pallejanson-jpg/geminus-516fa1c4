/**
 * NativeXeokitViewer — Prototype native xeokit viewer using XKTLoaderPlugin.
 * 
 * Loads XKT models directly from Supabase Storage, bypassing the Asset+ Vue wrapper.
 * This eliminates the fetch interceptor hack and gives direct control over the loading pipeline.
 * 
 * Enable via ?viewer=native URL parameter or localStorage: viewer-engine=native
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeGuid } from '@/lib/utils';
import { AlertCircle, Box } from 'lucide-react';
import { xktCacheService } from '@/services/xkt-cache-service';
import { getModelFromMemory, storeModelInMemory, getMemoryStats } from '@/hooks/useXktPreload';
import { useIsMobile } from '@/hooks/use-mobile';
import { applyArchitectColors } from '@/lib/architect-colors';
import { isRealTiling, getTilesToLoad } from '@/hooks/useFloorPriorityLoading';
import { INSIGHTS_COLOR_UPDATE_EVENT, INSIGHTS_COLOR_RESET_EVENT, ALARM_ANNOTATIONS_SHOW_EVENT, LOAD_SAVED_VIEW_EVENT, type InsightsColorUpdateDetail, type AlarmAnnotationsShowDetail } from '@/lib/viewer-events';
import { FORCE_SHOW_SPACES_EVENT } from '@/components/viewer/RoomVisualizationPanel';
import type { GeometryManifest } from '@/lib/types';

const XEOKIT_CDN = '/lib/xeokit/xeokit-sdk.es.js';

/** Project a 3D world position to 2D canvas coordinates */
function worldToCanvas(viewer: any, worldPos: number[]): [number, number, number] | null {
  try {
    const camera = viewer.scene?.camera;
    if (!camera) return null;
    const canvas = viewer.scene.canvas?.canvas;
    if (!canvas) return null;
    // Use xeokit's built-in projection
    const projMatrix = camera.projMatrix;
    const viewMatrix = camera.viewMatrix;
    if (!projMatrix || !viewMatrix) return null;
    // Manual MVP transform
    const v = [worldPos[0], worldPos[1], worldPos[2], 1];
    const mv = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      mv[r] = viewMatrix[r] * v[0] + viewMatrix[r + 4] * v[1] + viewMatrix[r + 8] * v[2] + viewMatrix[r + 12] * v[3];
    }
    const clip = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      clip[r] = projMatrix[r] * mv[0] + projMatrix[r + 4] * mv[1] + projMatrix[r + 8] * mv[2] + projMatrix[r + 12] * mv[3];
    }
    if (clip[3] <= 0) return null;
    const ndc = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return [(ndc[0] + 1) * 0.5 * w, (1 - ndc[1]) * 0.5 * h, clip[3]];
  } catch {
    return null;
  }
}

interface NativeXeokitViewerProps {
  buildingFmGuid: string;
  onClose?: () => void;
  /** Called when the xeokit Viewer instance is ready */
  onViewerReady?: (viewer: any) => void;
}

interface ModelInfo {
  model_id: string;
  model_name: string | null;
  storage_path: string;
  file_size: number | null;
  storey_fm_guid: string | null;
  is_chunk?: boolean;
  chunk_order?: number;
  parent_model_id?: string | null;
}

type ModelCandidate = ModelInfo & { synced_at?: string | null; source: 'db' | 'storage' };

type LoadPhase = 'init' | 'loading_sdk' | 'creating_viewer' | 'syncing' | 'bootstrapping' | 'loading_models' | 'ready' | 'error';

const NativeXeokitViewer: React.FC<NativeXeokitViewerProps> = ({
  buildingFmGuid,
  onClose,
  onViewerReady,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<any>(null);
  const isMobile = useIsMobile();
  // Use ref for isMobile to avoid re-creating initialize callback when it changes
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const [phase, setPhase] = useState<LoadPhase>('init');
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState('');
  const mountedRef = useRef(true);
  // Store pending insights color event to re-apply after models load
  const pendingInsightsColorRef = useRef<InsightsColorUpdateDetail | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Passive cleanup: reset any stuck conversion jobs for this building on mount
  useEffect(() => {
    if (!buildingFmGuid) return;
    const cleanupStuckJobs = async () => {
      try {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: stuckJobs } = await supabase
          .from('conversion_jobs')
          .select('id, model_name')
          .eq('building_fm_guid', buildingFmGuid)
          .eq('status', 'processing')
          .lt('updated_at', fiveMinAgo);
        if (stuckJobs && stuckJobs.length > 0) {
          for (const job of stuckJobs) {
            await supabase.from('conversion_jobs').update({
              status: 'error',
              error_message: 'Auto-reset: orphaned job detected by viewer',
              updated_at: new Date().toISOString(),
            }).eq('id', job.id);
            console.warn(`[NativeViewer] Auto-reset stuck job: ${job.id} (${job.model_name})`);
          }
        }
      } catch (err) {
        console.warn('[NativeViewer] Failed to cleanup stuck jobs:', err);
      }
    };
    cleanupStuckJobs();
  }, [buildingFmGuid]);

  const initialize = useCallback(async () => {
    if (!canvasRef.current || !buildingFmGuid) return;

    const t0 = performance.now();

    try {
      // 1. Load SDK + fetch model metadata in PARALLEL
      setPhase('loading_sdk');
      console.log('[NativeViewer] Loading SDK + metadata in parallel...');

      const sdkPromise = (async () => {
        // Reuse cached SDK if already loaded (saves 3-5s on subsequent mounts)
        if ((window as any).__xeokitSdk) {
          console.log('[NativeViewer] Reusing cached SDK from window.__xeokitSdk');
          return (window as any).__xeokitSdk;
        }
        const sdkResponse = await fetch(XEOKIT_CDN);
        const sdkText = await sdkResponse.text();
        const sdkBlob = new Blob([sdkText], { type: 'application/javascript' });
        const sdkBlobUrl = URL.createObjectURL(sdkBlob);
        const sdk = await import(/* @vite-ignore */ sdkBlobUrl);
        URL.revokeObjectURL(sdkBlobUrl);
        // Expose SDK globally so SplitPlanView can reuse the same module
        (window as any).__xeokitSdk = sdk;
        return sdk;
      })();

      const dbPromise = supabase
        .from('xkt_models')
        .select('model_id, model_name, storage_path, file_size, storey_fm_guid, synced_at, is_chunk, chunk_order, parent_model_id, format')
        .eq('building_fm_guid', buildingFmGuid)
        .order('file_size', { ascending: true });

      const storagePromise = supabase.storage
        .from('xkt-models')
        .list(buildingFmGuid, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

      const storeyPromise = supabase
        .from('assets')
        .select('attributes')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('category', 'Building Storey');

      const [sdk, dbResult, storageResult, storeyResult] = await Promise.all([
        sdkPromise, dbPromise, storagePromise, storeyPromise,
      ]);

      if (!mountedRef.current) return;
      console.log(`[NativeViewer] SDK + metadata loaded in ${Math.round(performance.now() - t0)}ms`);

      // 2. Create viewer immediately
      setPhase('creating_viewer');
      const viewer = new sdk.Viewer({
        canvasElement: canvasRef.current,
        transparent: true,
        saoEnabled: false,  // Disabled: SAO causes "Invalid framebuffer" on large models
        entityOffsetsEnabled: true,
        dtxEnabled: true,   // Data textures: ~50% faster loading, ~40% less memory
        pbrEnabled: false,  // PBR unnecessary for BIM — saves GPU overhead
      });

      // WebGL context loss handling — detect GPU crash and show retry UI
      const canvas = canvasRef.current;
      canvas.addEventListener('webglcontextlost', (e: Event) => {
        e.preventDefault();
        console.error('[NativeViewer] ⚠️ WebGL context lost');
        if (mountedRef.current) {
          setErrorMsg('GPU memory exhausted. Try reloading the page.');
          setPhase('error');
        }
      });
      // Suppress browser context menu on right-click (used for pan)
      canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());
      viewerRef.current = viewer;

      // Expose SectionPlane class globally so useSectionPlaneClipping can create planes
      if (sdk.SectionPlane) {
        (window as any).__xeokitSectionPlaneClass = sdk.SectionPlane;
        console.log('[NativeViewer] SectionPlane class exposed globally');
      }

      // Camera defaults
      viewer.camera.eye = [0, 20, 40];
      viewer.camera.look = [0, 0, 0];
      viewer.camera.up = [0, 1, 0];
      viewer.camera.projection = 'perspective';

      // Slow down navigation for smoother control (extra aggressive on mobile one-finger)
      if (viewer.cameraControl) {
        const cc = viewer.cameraControl;

        // Read user speed multiplier from localStorage
        let speedMultiplier = 1;
        try {
          const stored = localStorage.getItem('viewer-nav-speed');
          if (stored) speedMultiplier = parseInt(stored) / 100;
        } catch {}
        speedMultiplier = Math.max(0.25, Math.min(3, speedMultiplier));

        const navTuning = isMobileRef.current
          ? {
              dragRotationRate: 70,
              rotationInertia: 0.88,
              touchPanRate: 0.14,
              panInertia: 0.82,
              touchDollyRate: 0.09,
              mouseWheelDollyRate: 35,
              keyboardDollyRate: 4,
            }
          : {
              dragRotationRate: 120 * speedMultiplier,
              rotationInertia: 0.85,
              touchPanRate: 0.3 * speedMultiplier,
              panInertia: 0.7,
              touchDollyRate: 0.15 * speedMultiplier,
              mouseWheelDollyRate: 50 * speedMultiplier,
              keyboardDollyRate: 5 * speedMultiplier,
            };

        cc.dragRotationRate = navTuning.dragRotationRate;
        cc.rotationInertia = navTuning.rotationInertia;
        cc.touchPanRate = navTuning.touchPanRate;
        cc.panInertia = navTuning.panInertia;
        cc.touchDollyRate = navTuning.touchDollyRate;
        cc.mouseWheelDollyRate = navTuning.mouseWheelDollyRate;
        cc.keyboardDollyRate = navTuning.keyboardDollyRate;
        cc.followPointer = true;

        // Double-click flyTo stability guard
        // Prevent being thrown to wrong position when pickSurface fails
        cc.on('doublePickedSurface', (pickResult: any) => {
          if (!pickResult?.worldPos) return;
          const [px, py, pz] = pickResult.worldPos;
          if (isNaN(px) || isNaN(py) || isNaN(pz)) return;
          // Sanity check: reject picks >50m vertically from current eye
          const eyeY = viewer.camera?.eye?.[1] ?? 0;
          if (Math.abs(py - eyeY) > 50) {
            console.warn('[NativeViewer] Rejected double-click flyTo: target too far vertically', { py, eyeY });
            return;
          }
          viewer.cameraFlight.flyTo({
            eye: [px - 5, py + 5, pz - 5],
            look: pickResult.worldPos,
            up: [0, 1, 0],
            duration: 0.5,
          });
        });

        // When doublePickedNothing fires, do NOT fly — this prevents the "thrown to scene center" issue
        cc.on('doublePickedNothing', () => {
          // Intentionally no-op — prevents default flyTo on empty space double-click
        });
      }

      // NavCube — load custom neutral-styled plugin via script tag
      {
        const navCubeCanvas = document.createElement('canvas');
        navCubeCanvas.id = `native-navcube-${buildingFmGuid.substring(0, 8)}`;
        navCubeCanvas.style.cssText = 'position:absolute;bottom:60px;right:10px;width:150px;height:150px;pointer-events:auto;';
        const parentEl = canvasRef.current?.parentElement;
        if (parentEl) {
          parentEl.appendChild(navCubeCanvas);
        } else {
          console.warn('[NativeViewer] NavCube: no parent element for canvas');
        }

        let usedCustom = false;
        if (!(window as any).NavCubePlugin) {
          // Load the custom NavCube script
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
          usedCustom = true;
          console.log('[NativeViewer] Custom NavCube loaded');
        } else if (sdk.NavCubePlugin) {
          new sdk.NavCubePlugin(viewer, { canvasElement: navCubeCanvas });
          console.log('[NativeViewer] Fallback SDK NavCube');
        }
      }

      // FastNav — respect user setting from localStorage
      const fastNavEnabled = (() => {
        try {
          const stored = localStorage.getItem('viewer-fastnav-enabled');
          if (stored === null) return true; // default ON
          return stored === 'true';
        } catch { return true; }
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
        console.log('[NativeViewer] FastNav enabled');
      } else {
        console.log('[NativeViewer] FastNav disabled by user setting');
      }

      // XKT Loader
      const xktLoader = new sdk.XKTLoaderPlugin(viewer, {
        reuseGeometries: false,  // Better for unique BIM geometry — fewer draw calls
      });

      // GLTFLoaderPlugin for manifest-driven GLB chunk loading
      let gltfLoader: any = null;
      if (sdk.GLTFLoaderPlugin) {
        gltfLoader = new sdk.GLTFLoaderPlugin(viewer);
        console.log('[NativeViewer] GLTFLoaderPlugin available for manifest-driven loading');
      }

      // Manifest-driven GLB loading is deferred to after waitForModel is defined (see below)
      let manifestLoaded = false;

      // 3. Process pre-fetched model metadata (already loaded in parallel above)
      setPhase('loading_models');
      let dbError: any = dbResult.error;
      let models: ModelCandidate[] = ((dbResult.data as any[]) ?? []).map((m) => ({
        ...m,
        source: 'db' as const,
      }));

      // Merge storage files
      const mergedModels = new Map<string, ModelCandidate>();
      models.forEach((m) => mergedModels.set(m.model_id, m));

      if (!storageResult.error && storageResult.data) {
        const xktFiles = storageResult.data.filter((f: any) =>
          f.name?.toLowerCase().endsWith('.xkt') && !f.name?.toLowerCase().endsWith('_xkt.xkt')
        );

        xktFiles.forEach((file: any) => {
          const modelId = file.name.replace(/\.xkt$/i, '');
          if (!mergedModels.has(modelId)) {
            mergedModels.set(modelId, {
              model_id: modelId,
              model_name: modelId,
              storage_path: `${buildingFmGuid}/${file.name}`,
              file_size: file.metadata?.size ?? null,
              storey_fm_guid: null,
              synced_at: null,
              source: 'storage',
            });
          }
        });

        models = Array.from(mergedModels.values());
        console.log(`[NativeViewer] Model sources → DB: ${(models || []).filter((m: any) => !!m.synced_at).length}, Storage: ${xktFiles.length}, Merged: ${models.length}`);
      } else if (storageResult.error) {
        console.warn('[NativeViewer] Storage list failed, continuing with DB models only:', storageResult.error.message);
      }

      // Resolve model names from pre-fetched storey data
      if (models.length > 0 && storeyResult.data && storeyResult.data.length > 0) {
        const assetPlusNames = new Map<string, string>();
        storeyResult.data.forEach((s: any) => {
          const attrs = typeof s.attributes === 'string' ? JSON.parse(s.attributes) : (s.attributes || {});
          const guid = attrs.parentBimObjectId;
          const name = attrs.parentCommonName;
          if (guid && name && !/^[0-9a-f]{8}-/i.test(name)) {
            assetPlusNames.set(guid, name);
            assetPlusNames.set(guid.toLowerCase(), name);
          }
        });

        if (assetPlusNames.size > 0) {
          console.log(`[NativeViewer] Resolved ${assetPlusNames.size / 2} model names from Asset+ storeys`);
          models.forEach((m) => {
            const resolved = assetPlusNames.get(m.model_id) || assetPlusNames.get(m.model_id.toLowerCase());
            if (resolved && resolved !== m.model_name) {
              console.log(`[NativeViewer] Name resolution: "${m.model_name}" → "${resolved}"`);
              // Persist resolved name back to xkt_models for future loads
              supabase.from('xkt_models')
                .update({ model_name: resolved })
                .eq('building_fm_guid', buildingFmGuid)
                .eq('model_id', m.model_id)
                .then(({ error }) => {
                  if (!error) console.log(`[NativeViewer] Persisted model name "${resolved}" to DB`);
                });
              m.model_name = resolved;
            }
          });
        }
      }

      // ── BOOTSTRAP: If no local models, attempt server-sync then client-side fetch ──
      if (dbError || !models || models.length === 0) {
        console.log('[NativeViewer] No local models found — attempting bootstrap...');
        setPhase('syncing');

        // Step 1: Try server-side sync
        let bootstrapSuccess = false;
        try {
          const { data: syncResult } = await supabase.functions.invoke('asset-plus-sync', {
            body: { action: 'sync-xkt-building', buildingFmGuid }
          });

          if (syncResult?.synced > 0) {
            console.log(`[NativeViewer] Server sync succeeded: ${syncResult.synced} models`);
            // Re-fetch models from DB
            const { data: freshModels } = await supabase
              .from('xkt_models')
              .select('model_id, model_name, storage_path, file_size, storey_fm_guid, synced_at, is_chunk, chunk_order, parent_model_id')
              .eq('building_fm_guid', buildingFmGuid)
              .order('file_size', { ascending: true });
            if (freshModels && freshModels.length > 0) {
              models = freshModels.map((m: any) => ({ ...m, source: 'db' as const }));
              bootstrapSuccess = true;
            }
          } else {
            console.log('[NativeViewer] Server sync returned 0 models, trying client-side bootstrap...');
          }
        } catch (e) {
          console.warn('[NativeViewer] Server sync failed:', e);
        }

        // Step 2: Client-side bootstrap — fetch XKT directly from Asset+ API via browser
        if (!bootstrapSuccess) {
          try {
            // Get auth token and API config
            const [tokenRes, configRes] = await Promise.all([
              supabase.functions.invoke('asset-plus-query', { body: { action: 'getToken', buildingFmGuid } }),
              supabase.functions.invoke('asset-plus-query', { body: { action: 'getConfig', buildingFmGuid } }),
            ]);

            const accessToken = tokenRes.data?.accessToken;
            const apiUrl = configRes.data?.apiUrl;
            const apiKey = configRes.data?.apiKey;

            if (accessToken && apiUrl && apiKey) {
              // Discover 3D endpoint from browser (not blocked like edge functions)
              const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
              const assetDbUrl = apiUrl.replace(/\/+$/, '');
              const candidatePaths = [
                `${baseUrl}/api/threed/GetModels`,
                `${baseUrl}/threed/GetModels`,
                `${assetDbUrl}/api/threed/GetModels`,
                `${assetDbUrl}/threed/GetModels`,
                `${assetDbUrl}/GetModels`,
                `${baseUrl}/api/v1/threed/GetModels`,
              ];

              let discoveredModels: any[] | null = null;
              for (const basePath of candidatePaths) {
                try {
                  const url = `${basePath}?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
                  console.log(`[NativeViewer] Bootstrap: trying ${basePath}`);
                  const res = await fetch(url, {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                  });
                  if (res.ok) {
                    const data = await res.json();
                    // Accept multiple response shapes
                    const modelArray = Array.isArray(data) ? data
                      : Array.isArray(data?.models) ? data.models
                      : Array.isArray(data?.items) ? data.items
                      : Array.isArray(data?.data) ? data.data
                      : null;
                    if (modelArray && modelArray.length > 0) {
                      console.log(`[NativeViewer] Bootstrap: found ${modelArray.length} models at ${basePath}`);
                      discoveredModels = modelArray;
                      break;
                    }
                  }
                } catch (e) {
                  console.debug(`[NativeViewer] Bootstrap endpoint failed: ${basePath}`, e);
                }
              }

              if (discoveredModels && discoveredModels.length > 0) {
                console.log(`[NativeViewer] Bootstrap: downloading ${discoveredModels.length} XKT models...`);
                let bootstrapLoaded = 0;
                const bootstrappedModels: ModelCandidate[] = [];

                for (const model of discoveredModels) {
                  const xktUrl = model.xktFileUrl || model.xkt_file_url || model.fileUrl || model.url;
                  if (!xktUrl) continue;

                  const modelId = model.id || model.modelId || xktUrl.split('/').pop()?.replace('.xkt', '') || `model_${Date.now()}`;
                  let fullXktUrl = xktUrl;
                  if (xktUrl.startsWith('/')) {
                    fullXktUrl = baseUrl + xktUrl;
                  }

                  try {
                    console.log(`[NativeViewer] Bootstrap: fetching ${modelId}...`);
                    const xktRes = await fetch(fullXktUrl, {
                      headers: { "Authorization": `Bearer ${accessToken}` }
                    });

                    if (!xktRes.ok) continue;
                    const xktData = await xktRes.arrayBuffer();
                    if (xktData.byteLength < 1024) continue;

                    // Check it's actually binary XKT, not HTML error page
                    const firstByte = String.fromCharCode(new Uint8Array(xktData)[0]);
                    if (firstByte === '<' || firstByte === '{') continue;

                    // Store in memory cache for immediate use
                    storeModelInMemory(modelId, buildingFmGuid, xktData);

                    // Save to backend in background (non-blocking)
                    const modelName = model.name || model.modelName || modelId;
                    xktCacheService.saveModelFromViewer(modelId, xktData, buildingFmGuid, modelName)
                      .then(ok => { if (ok) console.log(`[NativeViewer] Bootstrap: cached ${modelId} to backend`); });

                    const fileName = `${modelId}.xkt`;
                    bootstrappedModels.push({
                      model_id: modelId,
                      model_name: modelName,
                      storage_path: `${buildingFmGuid}/${fileName}`,
                      file_size: xktData.byteLength,
                      storey_fm_guid: null,
                      source: 'db',
                    });

                    bootstrapLoaded++;
                    console.log(`[NativeViewer] Bootstrap: loaded ${modelId} (${(xktData.byteLength / 1024 / 1024).toFixed(1)} MB)`);
                  } catch (e) {
                    console.warn(`[NativeViewer] Bootstrap: failed to fetch ${modelId}:`, e);
                  }
                }

                if (bootstrappedModels.length > 0) {
                  models = bootstrappedModels;
                  bootstrapSuccess = true;
                  console.log(`[NativeViewer] Bootstrap: successfully loaded ${bootstrapLoaded} models`);
                }
              }
            } else {
              console.warn('[NativeViewer] Bootstrap: missing Asset+ credentials');
            }
          } catch (e) {
            console.warn('[NativeViewer] Client-side bootstrap failed:', e);
          }
        }

        if (!bootstrapSuccess) {
          console.warn('[NativeViewer] Bootstrap failed — no models available');
          setErrorMsg('No 3D models found for this building. Sync XKT models via Settings → Buildings, or upload an IFC file.');
          setPhase('error');
          return;
        }

        // Continue with bootstrapped models
        if (!mountedRef.current) return;
        setPhase('loading_models');
      }

      // Staleness check: deferred to avoid competing with model loading
      const deferStalenessCheck = () => {
        const STALE_MS = 7 * 24 * 60 * 60 * 1000;
        const oldestSync = models.reduce((oldest: string | null, m: any) => {
          if (!oldest || (m.synced_at && m.synced_at < oldest)) return m.synced_at;
          return oldest;
        }, null as string | null);
        
        if (oldestSync && (Date.now() - new Date(oldestSync).getTime()) > STALE_MS) {
          console.log('[NativeViewer] Models are stale (>7d), triggering background refresh...');
          supabase.functions.invoke('asset-plus-sync', {
            body: { action: 'sync-xkt-building', buildingFmGuid, force: true }
          }).then(({ data }) => {
            if (data?.synced > 0) {
              console.log(`[NativeViewer] Background refresh: ${data.synced} models updated`);
            }
          }).catch(() => {});
        }
      };
      // Defer staleness check to after models are loaded
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(deferStalenessCheck, { timeout: 10000 });
      } else {
        setTimeout(deferStalenessCheck, 5000);
      }

      // ── Detect real per-storey tiles (Phase 2) ──
      const chunkModels = models.filter(m => m.is_chunk && m.storey_fm_guid);
      const nonChunkModels = models.filter(m => !m.is_chunk);
      const uniqueChunkPaths = new Set(chunkModels.map(m => m.storage_path));
      const hasRealTiles = chunkModels.length >= 2 && uniqueChunkPaths.size > 1;

      if (hasRealTiles) {
        console.log(`[NativeViewer] 🧩 Real per-storey tiles detected: ${chunkModels.length} tiles with ${uniqueChunkPaths.size} unique paths`);
        // Load non-chunk models (structure, facade) normally + first storey tile
        const sortedChunks = [...chunkModels].sort((a, b) => (a.chunk_order ?? 0) - (b.chunk_order ?? 0));
        // Pick the middle floor as the initial view (most useful for navigation)
        const initialIdx = Math.floor(sortedChunks.length / 2);
        const initialTiles = getTilesToLoad(
          sortedChunks.map(c => ({
            modelId: c.model_id,
            modelName: c.model_name || c.model_id,
            storeyFmGuid: c.storey_fm_guid!,
            chunkOrder: c.chunk_order ?? 0,
            parentModelId: c.parent_model_id || '',
            storagePath: c.storage_path,
          })),
          sortedChunks[initialIdx].storey_fm_guid!
        );
        const initialTileIds = new Set(initialTiles.map(t => t.modelId));
        // Only load non-chunks + initial tiles
        models = [
          ...nonChunkModels,
          ...chunkModels.filter(m => initialTileIds.has(m.model_id)),
        ];
        console.log(`[NativeViewer] Loading ${nonChunkModels.length} base models + ${initialTileIds.size} initial tiles (of ${chunkModels.length} total)`);

        // Store full chunk list for dynamic floor switching
        (window as any).__xktTileChunks = sortedChunks;
        (window as any).__xktTileLoadedIds = new Set(initialTileIds);
      }

      // Load all available models, but prioritize architectural models first in queue.
      const NON_ARCH_PREFIXES = ['BRAND', 'FIRE', 'V-', 'V_', 'VS-', 'VS_', 'EL-', 'EL_', 'MEP', 'SPRINKLER', 'K-', 'K_', 'R-', 'R_', 'S-', 'S_'];
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

      const isArchitectural = (name: string | null) => {
        if (!name || UUID_RE.test(name)) return false;
        const upper = name.toUpperCase();
        if (NON_ARCH_PREFIXES.some(p => upper.startsWith(p))) return false;
        return upper.charAt(0) === 'A' || upper.includes('ARKITEKT');
      };

      const loadList: ModelInfo[] = [...models].sort((a, b) => {
        const aArch = isArchitectural(a.model_name) ? 0 : 1;
        const bArch = isArchitectural(b.model_name) ? 0 : 1;
        if (aArch !== bArch) return aArch - bArch;
        return (a.model_name || a.model_id).localeCompare((b.model_name || b.model_id), 'sv');
      });

      // Split into primary (A-models) and secondary (rest) for lazy loading on ALL devices
      let secondaryQueue: ModelInfo[] = [];
      if (loadList.length > 1) {
        const aModels = loadList.filter(m => isArchitectural(m.model_name));
        const nonAModels = loadList.filter(m => !isArchitectural(m.model_name));
        if (aModels.length > 0 && nonAModels.length > 0) {
          console.log(`[NativeViewer] Loading ${aModels.length} A-models first, ${nonAModels.length} secondary models will lazy-load`);
          secondaryQueue = nonAModels;
          loadList.length = 0;
          loadList.push(...aModels);
        }
      }

      if (loadList.length === 0) {
        console.warn('[NativeViewer] No models found at all for building', buildingFmGuid);
        setErrorMsg('No 3D models found for this building. Sync XKT models via Settings → Buildings, or upload an IFC file.');
        setPhase('error');
        return;
      }

      console.log(`[NativeViewer] Loading ${loadList.length}/${models.length} models (A-models prioritized)`);
      setLoadProgress({ loaded: 0, total: loadList.length });

      // 4. Load models — desktop uses 2 concurrent, mobile stays at 1
      const CONCURRENT = isMobileRef.current ? 1 : 2;
      let loaded = 0;
      const queue = [...loadList] as ModelInfo[];

      const waitForModel = (entity: any, modelId: string) =>
        new Promise<boolean>((resolve) => {
          let settled = false;
          const done = (ok: boolean) => {
            if (settled) return;
            settled = true;
            resolve(ok);
          };

          entity?.on?.('loaded', () => done(true));
          entity?.on?.('error', (err: unknown) => {
            console.error(`[NativeViewer] Model error for ${modelId}:`, err);
            done(false);
          });

          // Safety timeout so one bad model never blocks the whole queue
          setTimeout(() => done(false), 90_000);
        });

      // ── Pre-fetch metadata file list — only check for models in loadList ──
      const metadataFileSet = new Set<string>();
      try {
        // Only check metadata for models we're actually about to load (A-models)
        const loadModelIds = loadList.map(m => m.model_id);
        const { data: allFiles } = await supabase.storage
          .from('xkt-models')
          .list(buildingFmGuid, { limit: 1000 });
        if (allFiles) {
          allFiles.forEach((f: any) => {
            if (f.name?.endsWith('_metadata.json')) {
              // Only include metadata files relevant to models in loadList
              const baseName = f.name.replace('_metadata.json', '');
              if (loadModelIds.some(id => id === baseName || id.toLowerCase() === baseName.toLowerCase())) {
                metadataFileSet.add(`${buildingFmGuid}/${f.name}`);
              }
            }
          });
        }
        console.log(`[NativeViewer] Batch metadata check: found ${metadataFileSet.size} metadata files for ${loadList.length} models`);
      } catch { /* continue without metadata */ }

      // ── Check for geometry manifest (GLB from ACC pipeline) ──
      try {
        const { data: manifestFiles2 } = await supabase.storage
          .from('xkt-models')
          .list(buildingFmGuid, { limit: 100 });

        const hasManifest = manifestFiles2?.some((f: any) => f.name === '_geometry_manifest.json');

        if (hasManifest && gltfLoader) {
          console.log('[NativeViewer] 📋 Geometry manifest found — loading GLB');
          const { data: manifestUrl } = await supabase.storage
            .from('xkt-models')
            .createSignedUrl(`${buildingFmGuid}/_geometry_manifest.json`, 3600);

          if (manifestUrl?.signedUrl) {
            const manifestRes = await fetch(manifestUrl.signedUrl);
            if (manifestRes.ok) {
              const manifest: GeometryManifest = await manifestRes.json();
              console.log(`[NativeViewer] Manifest: ${manifest.chunks.length} storey entries, format=${manifest.format}, fallback=${!!manifest.fallback}`);

              // Check if we have real per-storey chunk URLs or just metadata
              const hasRealChunkUrls = manifest.chunks.some(c => c.url && c.url.length > 0);

              if (hasRealChunkUrls) {
                // Load per-storey GLB chunks
                const sortedChunks = [...manifest.chunks].filter(c => c.url).sort((a, b) => a.priority - b.priority);
                setLoadProgress({ loaded: 0, total: sortedChunks.length });

                let chunkLoaded = 0;
                for (const chunk of sortedChunks) {
                  if (!mountedRef.current) break;
                  try {
                    const { data: chunkUrl } = await supabase.storage
                      .from('xkt-models')
                      .createSignedUrl(chunk.url, 3600);

                    if (chunkUrl?.signedUrl) {
                      const chunkId = `${manifest.modelId}_${chunk.storeyGuid.substring(0, 8)}`;
                      const entity = gltfLoader.load({ id: chunkId, src: chunkUrl.signedUrl, edges: true });
                      await waitForModel(entity, chunkId);
                      chunkLoaded++;
                      setLoadProgress({ loaded: chunkLoaded, total: sortedChunks.length });
                      console.log(`[NativeViewer] GLB chunk loaded: ${chunk.storeyName} (${chunk.elementCount} elements)`);
                    }
                  } catch (e) {
                    console.warn(`[NativeViewer] GLB chunk failed: ${chunk.storeyName}`, e);
                  }
                }

                if (chunkLoaded > 0) {
                  manifestLoaded = true;
                  console.log(`%c[NativeViewer] ✅ ${chunkLoaded}/${sortedChunks.length} GLB chunks loaded`, 'color:#22c55e;font-weight:bold');
                }
              } else if (manifest.fallback?.url) {
                // Load monolithic fallback GLB + use manifest metadata for storey visibility
                console.log(`[NativeViewer] Loading monolithic fallback GLB: ${manifest.fallback.url}`);
                setLoadProgress({ loaded: 0, total: 1 });

                const { data: fallbackUrl } = await supabase.storage
                  .from('xkt-models')
                  .createSignedUrl(manifest.fallback.url, 3600);

                if (fallbackUrl?.signedUrl) {
                  const fallbackId = `${manifest.modelId}_full_glb`;
                  const entity = gltfLoader.load({ id: fallbackId, src: fallbackUrl.signedUrl, edges: true });
                  const ok = await waitForModel(entity, fallbackId);
                  if (ok) {
                    manifestLoaded = true;
                    setLoadProgress({ loaded: 1, total: 1 });
                    console.log(`%c[NativeViewer] ✅ Monolithic fallback GLB loaded`, 'color:#22c55e;font-weight:bold');
                  }
                }
              }

              if (manifestLoaded) {
                (window as any).__geometryManifest = manifest;
              }
            }
          }
        }
      } catch (e) {
        console.debug('[NativeViewer] Manifest check skipped:', e);
      }

      // If manifest GLB chunks loaded successfully, skip XKT model loading
      if (manifestLoaded) {
        console.log('[NativeViewer] Manifest GLB chunks loaded — skipping XKT model queue');
        // Apply architect colors and finalize
        if (viewer.scene) {
          const { colorized, hiddenSpaces } = applyArchitectColors(viewer);
          console.log(`[NativeViewer] Colorized ${colorized} objects, hidden ${hiddenSpaces} IfcSpace objects`);
        }
        const totalTime = Math.round(performance.now() - t0);
        console.log(`%c[NativeViewer] 🎉 Manifest-driven GLB loading complete in ${totalTime}ms`, 'color:#22c55e;font-weight:bold;font-size:14px');
        if (mountedRef.current) {
          setPhase('ready');
          (window as any).__nativeXeokitViewer = viewer;
          onViewerReady?.(viewer);
          window.dispatchEvent(new CustomEvent('VIEWER_MODELS_LOADED', { detail: { buildingFmGuid } }));
          try {
            const aabb = viewer.scene?.aabb;
            if (aabb) viewer.cameraFlight.flyTo({ aabb, duration: 0 });
          } catch {}
        }
        return;
      }

      const loadModel = async (model: ModelInfo) => {
        const modelStart = performance.now();
        const modelId = model.model_id;

        try {
          const memData = getModelFromMemory(modelId, buildingFmGuid);

          // Check for metadata.json using pre-fetched list (no per-model network calls)
          const metaStoragePath = model.storage_path.replace(/\.xkt$/i, '_metadata.json');
          let metaModelSrc: string | undefined;
          if (metadataFileSet.has(metaStoragePath)) {
            try {
              const { data: metaUrl } = await supabase.storage
                .from('xkt-models')
                .createSignedUrl(metaStoragePath, 3600);
              if (metaUrl?.signedUrl) {
                metaModelSrc = metaUrl.signedUrl;
                console.log(`[NativeViewer] MetaModel JSON found for ${modelId}`);
              }
            } catch { /* continue without */ }
          }

          if (memData) {
            console.log(`[NativeViewer] Loading from memory: ${modelId}, size: ${memData.byteLength}`);
            const loadOpts: any = { id: modelId, xkt: memData, edges: true };
            if (metaModelSrc) loadOpts.metaModelSrc = metaModelSrc;
            const entity = xktLoader.load(loadOpts);
            const ok = await waitForModel(entity, modelId);
            if (!ok) return;

            // Check if the loaded model has any visible geometry — skip "orphan" models
            const loadedModel = viewer.scene?.models?.[modelId];
            const objectCount = loadedModel?.numEntities ?? Object.keys(loadedModel?.objects || {}).length ?? 0;
            if (objectCount === 0) {
              console.warn(`[NativeViewer] Skipping empty/orphan model: ${modelId} (0 entities)`);
              try { loadedModel?.destroy?.(); } catch {}
              return;
            }

            const ms = Math.round(performance.now() - modelStart);
            console.log(`%c[NativeViewer] ✅ Memory → ${modelId} (${(memData.byteLength / 1024 / 1024).toFixed(1)} MB) ${ms}ms`, 'color:#22c55e;font-weight:bold');
          } else {
            const { data: urlData } = await supabase.storage
              .from('xkt-models')
              .createSignedUrl(model.storage_path, 3600);

            if (!urlData?.signedUrl) {
              console.warn(`[NativeViewer] No signed URL for ${modelId}`);
              return;
            }

            // Stream very large models directly from URL to reduce JS heap pressure
            const shouldStreamByUrl = (model.file_size ?? 0) > 30 * 1024 * 1024;

            if (shouldStreamByUrl) {
              console.log(`[NativeViewer] Streaming large model via src: ${modelId} (${((model.file_size ?? 0) / 1024 / 1024).toFixed(1)} MB)`);
              const streamOpts: any = { id: modelId, src: urlData.signedUrl, edges: true };
              if (metaModelSrc) streamOpts.metaModelSrc = metaModelSrc;
              const entity = xktLoader.load(streamOpts);
              const ok = await waitForModel(entity, modelId);
              if (!ok) return;
            } else {
              const fetchStart = performance.now();
              const resp = await fetch(urlData.signedUrl);
              if (!resp.ok) {
                console.warn(`[NativeViewer] Fetch failed for ${modelId}: ${resp.status}`);
                return;
              }

              const arrayBuf = await resp.arrayBuffer();
              const fetchMs = Math.round(performance.now() - fetchStart);
              const firstByte = arrayBuf.byteLength > 0 ? String.fromCharCode(new Uint8Array(arrayBuf)[0]) : '';

              if (arrayBuf.byteLength < 50_000 || firstByte === '<' || firstByte === '{') {
                console.warn(`[NativeViewer] Skipping ${modelId} — invalid binary (${arrayBuf.byteLength} bytes, starts with '${firstByte}')`);
                return;
              }

              storeModelInMemory(modelId, buildingFmGuid, arrayBuf);

              const bufLoadOpts: any = { id: modelId, xkt: arrayBuf, edges: true };
              if (metaModelSrc) bufLoadOpts.metaModelSrc = metaModelSrc;
              const entity = xktLoader.load(bufLoadOpts);
              const ok = await waitForModel(entity, modelId);
              if (!ok) return;

              // Check if the loaded model has any visible geometry — skip "orphan" models
              const loadedModel2 = viewer.scene?.models?.[modelId];
              const objCount2 = loadedModel2?.numEntities ?? Object.keys(loadedModel2?.objects || {}).length ?? 0;
              if (objCount2 === 0) {
                console.warn(`[NativeViewer] Skipping empty/orphan model: ${modelId} (0 entities)`);
                try { loadedModel2?.destroy?.(); } catch {}
                return;
              }

              const totalMs = Math.round(performance.now() - modelStart);
              console.log(`%c[NativeViewer] 💾 Storage → ${modelId} (${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)} MB) fetch: ${fetchMs}ms, total: ${totalMs}ms`, 'color:#3b82f6;font-weight:bold');
            }
          }
        } catch (e) {
          console.warn(`[NativeViewer] Error loading ${modelId}:`, e);
        }

        loaded++;
        if (mountedRef.current) {
          setLoadProgress({ loaded, total: loadList.length });
        }
      };

      // Process queue with strict concurrency control
      const active = new Set<Promise<void>>();
      for (const model of queue) {
        let promise: Promise<void>;
        promise = loadModel(model).finally(() => {
          active.delete(promise);
        });
        active.add(promise);

        if (active.size >= CONCURRENT) {
          await Promise.race(active);
        }
      }
      await Promise.allSettled(Array.from(active));

      // 5. Camera: instant viewFit as fallback (no animation) if no saved start view arrives within 500ms
      if (mountedRef.current && viewer.scene) {
        // SAO disabled — causes "Invalid framebuffer" and WebGL context loss on large models
        if (viewer.scene.sao) {
          viewer.scene.sao.enabled = false;
        }

        // Apply architectural IFC-type-based coloring to all objects
        const scene = viewer.scene;
        const allIds = scene.objectIds || [];
        if (allIds.length > 0) {
          scene.setObjectsXRayed(allIds, false);
        }

        // Capture native model colors BEFORE applying architect palette
        // so "Model Native Colour" theme can restore them correctly
        const nativeColors = new Map<string, { color: number[]; opacity: number; edges: boolean }>();
        if (scene.objects) {
          for (const objId of allIds) {
            const entity = scene.objects[objId];
            if (entity) {
              nativeColors.set(objId, {
                color: entity.colorize ? [...entity.colorize] : [1, 1, 1],
                opacity: entity.opacity ?? 1,
                edges: entity.edges ?? true,
              });
            }
          }
        }
        (window as any).__xeokitNativeColors = nativeColors;

        // Use shared architect color utility
        const { colorized, hiddenSpaces } = applyArchitectColors(viewer);
        console.log(`[NativeViewer] Colorized ${colorized} objects, hidden ${hiddenSpaces} IfcSpace objects`);

        // Immediately apply saved theme to avoid visible flash of architect colors
        try {
          const savedThemeId = localStorage.getItem('viewer-active-theme-id');
          if (savedThemeId) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('VIEWER_THEME_REQUESTED', {
                detail: { themeId: savedThemeId }
              }));
            }, 50);
          }
        } catch {}
      }

      const totalTime = Math.round(performance.now() - t0);
      console.log(`%c[NativeViewer] 🎉 All ${loaded} A-models loaded in ${totalTime}ms`, 'color:#22c55e;font-weight:bold;font-size:14px');
      
      const memStats = getMemoryStats();
      console.log(`[NativeViewer] Memory: ${memStats.modelCount} models, ${(memStats.usedBytes / 1024 / 1024).toFixed(1)} MB / ${(memStats.maxBytes / 1024 / 1024).toFixed(0)} MB`);
      
      if (mountedRef.current) {
        setPhase('ready');
        (window as any).__nativeXeokitViewer = viewer;
        onViewerReady?.(viewer);
        // Dispatch VIEWER_MODELS_LOADED for hooks like useObjectMoveMode
        window.dispatchEvent(new CustomEvent('VIEWER_MODELS_LOADED', { detail: { buildingFmGuid } }));

        // Wire up virtual chunk floor filtering for Asset+ buildings
        // (buildings with storey chunks but same XKT file — visibility filtering)
        if (chunkModels.length > 0 && !hasRealTiles) {
          const virtualChunks = chunkModels
            .sort((a, b) => (a.chunk_order ?? 0) - (b.chunk_order ?? 0))
            .map(c => ({
              modelId: c.model_id,
              modelName: c.model_name || c.model_id,
              storeyFmGuid: c.storey_fm_guid!,
              chunkOrder: c.chunk_order ?? 0,
              parentModelId: c.parent_model_id || '',
              storagePath: c.storage_path,
            }));
          (window as any).__xktVirtualChunks = virtualChunks;
          console.log(`[NativeViewer] 🏗️ Virtual chunk floor filtering available: ${virtualChunks.length} storeys`);
        }

        // Always perform instant viewFit after models load (duration: 0, no animation)
        // If a saved start view exists, NativeViewerShell will apply it on top of this.
        // Skip viewFit in split2d3d mode — floor isolation handles camera positioning
        const isSplit2d3d = new URLSearchParams(window.location.search).get('mode') === 'split2d3d';
        if (!isSplit2d3d) {
          try {
            const aabb = viewer.scene?.aabb;
            if (aabb) {
              viewer.cameraFlight.flyTo({ aabb, duration: 0 });
              console.log('[NativeViewer] Applied instant viewFit (duration: 0)');
            }
          } catch (e) { console.warn('[NativeViewer] viewFit failed:', e); }
        } else {
          console.log('[NativeViewer] Skipped viewFit — split2d3d mode active');
        }

        // Re-apply any pending insights color event that arrived before models loaded
        if (pendingInsightsColorRef.current) {
          const pending = pendingInsightsColorRef.current;
          pendingInsightsColorRef.current = null;
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(INSIGHTS_COLOR_UPDATE_EVENT, { detail: pending }));
          }, 200);
        }
      }

      // 6. Store secondary models and auto lazy-load them in background (no spinner, no blocking)
      if (secondaryQueue.length > 0) {
        (window as any).__secondaryModelQueue = secondaryQueue;
        (window as any).__loadSecondaryModel = async (modelInfo: any) => {
          if (!mountedRef.current || !viewerRef.current?.scene) return;
          const gl = canvasRef.current?.getContext('webgl2') || canvasRef.current?.getContext('webgl');
          if (gl?.isContextLost?.()) { console.warn('[NativeViewer] WebGL context lost'); return; }
          try {
            await loadModel(modelInfo);
            if (mountedRef.current && viewerRef.current?.scene) {
              applyArchitectColors(viewerRef.current);
              // Hide IfcSpace entities from non-A models (spaces should only come from A-model)
              const v = viewerRef.current;
              const metaObjs = v.metaScene?.metaObjects;
              if (metaObjs) {
                const loadedModel = v.scene.models?.[modelInfo.model_id];
                const objs = loadedModel?.objects || {};
                const objIds = Array.isArray(objs) ? objs.map((e: any) => e.id).filter(Boolean) : Object.keys(objs);
                for (const objId of objIds) {
                  const mo = metaObjs[objId];
                  if (mo && (mo.type || '').toLowerCase() === 'ifcspace') {
                    const entity = v.scene.objects?.[objId];
                    if (entity) {
                      entity.visible = false;
                      entity.pickable = false;
                    }
                  }
                }
              }
            }
          } catch (e) { console.warn(`[NativeViewer] On-demand model load failed: ${modelInfo.model_id}`, e); }
        };
        console.log(`[NativeViewer] ${secondaryQueue.length} secondary models available — will load on demand via Filter menu`);
        window.dispatchEvent(new CustomEvent('SECONDARY_MODELS_AVAILABLE', {
          detail: { models: secondaryQueue.map(m => ({ model_id: m.model_id, model_name: m.model_name })) }
        }));
        // No auto-loading: secondary models are loaded on-demand when the user
        // opens the Filter menu or explicitly selects a model.
      }

    } catch (e) {
      console.error('[NativeViewer] Init error:', e);
      if (mountedRef.current) {
        setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
        setPhase('error');
      }
    }
  }, [buildingFmGuid]);

  useEffect(() => {
    initialize();

    return () => {
      // Destroy viewer
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch (e) {
          console.debug('[NativeViewer] Viewer destroy error:', e);
        }
        viewerRef.current = null;
        (window as any).__nativeXeokitViewer = null;
        (window as any).__xktTileChunks = null;
        (window as any).__xktTileLoadedIds = null;
      }
      // Clean up any NavCube canvas we added
      const nc = document.getElementById(`native-navcube-${buildingFmGuid.substring(0, 8)}`);
      nc?.remove();
    };
  }, [initialize]);

  useEffect(() => {
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<{ modelId?: string }>).detail;
      const requestedModelId = detail?.modelId?.replace(/\.xkt$/i, '');
      if (!requestedModelId) return;

      const sceneModels = viewerRef.current?.scene?.models || {};
      if (sceneModels[requestedModelId]) return;

      const secondaryQueue: Array<ModelInfo & { model_id?: string }> = (window as any).__secondaryModelQueue || [];
      const requestedModel = secondaryQueue.find((model: any) => {
        const candidateId = (model.model_id || model.id || '').replace(/\.xkt$/i, '');
        return candidateId === requestedModelId;
      });

      if (!requestedModel) {
        console.warn(`[NativeViewer] Deferred model not found in secondary queue: ${requestedModelId}`);
        return;
      }

      try {
        await (window as any).__loadSecondaryModel?.(requestedModel);
      } catch (error) {
        console.warn(`[NativeViewer] Failed deferred load for ${requestedModelId}:`, error);
      }
    };

    window.addEventListener('MODEL_LOAD_REQUESTED', handler);
    return () => window.removeEventListener('MODEL_LOAD_REQUESTED', handler);
  }, []);

  // ── Listen for FLOOR_TILE_SWITCH (dynamic tile loading for real per-storey tiles) ──
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.tiles || !detail?.floorFmGuid) return;

      const viewer = viewerRef.current;
      if (!viewer?.scene) return;

      const allChunks: ModelCandidate[] = (window as any).__xktTileChunks || [];
      const loadedIds: Set<string> = (window as any).__xktTileLoadedIds || new Set();
      if (allChunks.length === 0) return;

      const tilesToLoad = detail.tiles as Array<{ modelId: string; storagePath?: string }>;
      const neededIds = new Set(tilesToLoad.map((t: any) => t.modelId));

      // Unload tiles that are no longer needed (not in active+adjacent)
      for (const loadedId of loadedIds) {
        if (!neededIds.has(loadedId)) {
          const model = viewer.scene.models?.[loadedId];
          if (model) {
            try { model.destroy(); } catch {}
            console.log(`[NativeViewer] 🧩 Unloaded tile: ${loadedId}`);
          }
          loadedIds.delete(loadedId);
        }
      }

      // Load new tiles
      for (const tile of tilesToLoad) {
        if (loadedIds.has(tile.modelId)) continue;

        const chunk = allChunks.find((c: any) => c.model_id === tile.modelId);
        if (!chunk) continue;

        try {
          const { data: urlData } = await supabase.storage
            .from('xkt-models')
            .createSignedUrl(chunk.storage_path, 3600);

          if (urlData?.signedUrl) {
            const sdk = (window as any).__xeokitSdk;
            if (!sdk) continue;

            const xktLoader = new sdk.XKTLoaderPlugin(viewer);
            const entity = xktLoader.load({ id: tile.modelId, src: urlData.signedUrl, edges: true });

            await new Promise<void>((resolve) => {
              entity?.on?.('loaded', () => resolve());
              entity?.on?.('error', () => resolve());
              setTimeout(resolve, 60000);
            });

            loadedIds.add(tile.modelId);
            applyArchitectColors(viewer);
            console.log(`[NativeViewer] 🧩 Loaded tile: ${tile.modelId}`);
          }
        } catch (err) {
          console.warn(`[NativeViewer] Failed to load tile ${tile.modelId}:`, err);
        }
      }
    };

    window.addEventListener('FLOOR_TILE_SWITCH', handler);
    return () => window.removeEventListener('FLOOR_TILE_SWITCH', handler);
  }, []);

  // ── Listen for Insights color events (chart click → colorize model) ───
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<InsightsColorUpdateDetail>).detail;
      if (!detail?.colorMap) return;

      const viewer = viewerRef.current;
      if (!viewer?.scene || !viewer?.metaScene) {
        // Viewer not ready yet — store for later
        pendingInsightsColorRef.current = detail;
        console.log('[NativeViewer] INSIGHTS_COLOR_UPDATE received but viewer not ready — queued');
        return;
      }

      const scene = viewer.scene;
      const colorMap = detail.colorMap;
      let matchCount = 0;
      const mode = detail.mode || '';

      // X-ray everything first
      const xrayMat = scene.xrayMaterial;
      if (xrayMat) {
        xrayMat.fill = true;
        xrayMat.fillAlpha = 0.15;
        xrayMat.fillColor = [0.55, 0.55, 0.6];
        xrayMat.edges = true;
        xrayMat.edgeAlpha = 0.3;
      }
      scene.setObjectsXRayed(scene.objectIds, true);

      const metaObjects = viewer.metaScene.metaObjects;
      if (!metaObjects) return;

      // Helper: un-xray + colorize an entity and its descendants
      const colorizeEntity = (mo: any, rgb: [number, number, number]) => {
        const entity = scene.objects?.[mo.id];
        if (entity) {
          entity.xrayed = false;
          entity.visible = true;
          entity.colorize = rgb;
          entity.opacity = 0.85;
          matchCount++;
        }
        const collectDescendants = (obj: any) => {
          obj.children?.forEach((child: any) => {
            const childEntity = scene.objects?.[child.id];
            if (childEntity) {
              childEntity.xrayed = false;
              childEntity.visible = true;
              childEntity.colorize = rgb;
              childEntity.opacity = 0.85;
            }
            collectDescendants(child);
          });
        };
        collectDescendants(mo);
      };

      // Use shared normalizeGuid for comparison

      // Build a lookup of normalized fmGuid → rgb for fast matching
      const fmGuidLookup = new Map<string, [number, number, number]>();
      Object.entries(colorMap).forEach(([key, rgb]) => {
        fmGuidLookup.set(normalizeGuid(key), rgb);
      });

      if (mode === 'asset_category' || mode === 'asset_categories') {
        // colorMap is keyed by asset type name (e.g. "Alarm", "FireExtinguisher")
        const typeColorLookup = new Map<string, [number, number, number]>();
        Object.entries(colorMap).forEach(([typeName, rgb]) => {
          typeColorLookup.set(typeName.toLowerCase(), rgb);
          typeColorLookup.set(('ifc' + typeName).toLowerCase(), rgb);
        });
        Object.values(metaObjects).forEach((mo: any) => {
          const ifcType = (mo.type || '').toLowerCase();
          const strippedType = ifcType.replace(/^ifc/, '');
          const rgb = typeColorLookup.get(ifcType) || typeColorLookup.get(strippedType);
          if (rgb) {
            colorizeEntity(mo, rgb);
          }
        });
      } else {
        // Match by fmGuid via originalSystemId or mo.id
        const isRoomMode = mode === 'room_spaces' || mode === 'room_type' || mode === 'room_types';
        const isFloorMode = mode.startsWith('energy_floor');
        const nameColorMap = detail.nameColorMap || {};
        // For floor-specific modes (energy_floor), use STRICT guid-only matching (no name fallback)
        // to prevent coloring rooms on wrong floors that happen to share names
        const useStrictGuidMode = isFloorMode;

        Object.values(metaObjects).forEach((mo: any) => {
          const sysId = normalizeGuid(mo.originalSystemId || '');
          const moId = normalizeGuid(mo.id || '');
          const moName = (mo.name || '').toLowerCase().trim();
          // Try fmGuid match first
          let rgb = fmGuidLookup.get(sysId) || fmGuidLookup.get(moId);
          // Name-based fallback only when NOT in strict guid mode
          if (!rgb && !useStrictGuidMode && moName && nameColorMap[moName]) {
            rgb = nameColorMap[moName];
          }
          if (rgb) {
            if (isRoomMode) {
              const entity = scene.objects?.[mo.id];
              if (entity) { entity.visible = true; entity.pickable = true; }
            }
            colorizeEntity(mo, rgb);
            
            if (isFloorMode) {
              const colorizeAllChildren = (obj: any) => {
                obj.children?.forEach((child: any) => {
                  const childEntity = scene.objects?.[child.id];
                  if (childEntity) {
                    childEntity.xrayed = false;
                    childEntity.visible = true;
                    childEntity.colorize = rgb!;
                    childEntity.opacity = 0.85;
                    matchCount++;
                  }
                  colorizeAllChildren(child);
                });
              };
              colorizeAllChildren(mo);
            }
          }
        });
      }

      console.log('[NativeViewer] Applied INSIGHTS_COLOR_UPDATE:', mode, Object.keys(colorMap).length, 'entries,', matchCount, 'entities matched');
    };

    window.addEventListener(INSIGHTS_COLOR_UPDATE_EVENT, handler);
    return () => window.removeEventListener(INSIGHTS_COLOR_UPDATE_EVENT, handler);
  }, []);

  // ── Listen for FORCE_SHOW_SPACES (toggle IfcSpace visibility for Insights/Visualization) ───
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const show = detail?.show ?? true;
      const viewer = viewerRef.current;
      if (!viewer?.scene || !viewer?.metaScene?.metaObjects) return;

      // Respect explicit user toggle-off
      if (show && (window as any).__spacesUserExplicitOff) return;

      const metaObjects = viewer.metaScene.metaObjects;
      const scene = viewer.scene;
      // Track force-show state globally so filter panel can respect it
      (window as any).__spacesForceVisible = show;

      // Light blue default for spaces: RGB 184, 212, 227 → normalized
      const SPACE_DEFAULT_COLOR: [number, number, number] = [184 / 255, 212 / 255, 227 / 255];
      const SPACE_DEFAULT_OPACITY = 0.25;

      // Read current floor filter to only show spaces on visible floors
      const floorFilterRaw = (detail?.floorGuids as string[] | undefined) ?? [];
      // Fallback: check if there's a global floor selection
      let visibleFloorKeys: Set<string> | null = null;
      if (floorFilterRaw.length > 0) {
        visibleFloorKeys = new Set(floorFilterRaw.map((g: string) => g.toLowerCase().replace(/-/g, '')));
      }

      Object.values(metaObjects).forEach((mo: any) => {
        const ifcType = (mo.type || '').toLowerCase();
        if (ifcType === 'ifcspace' || ifcType === 'ifc_space' || ifcType === 'space') {
          const entity = scene.objects?.[mo.id];
          if (entity) {
            // Check floor filter
            let belongsToVisibleFloor = true;
            if (visibleFloorKeys && visibleFloorKeys.size > 0) {
              belongsToVisibleFloor = false;
              let current = mo;
              while (current?.parent) {
                current = current.parent;
                if (current?.type?.toLowerCase() === 'ifcbuildingstorey') {
                  const storeyGuid = (current.originalSystemId || current.id || '').toLowerCase().replace(/-/g, '');
                  belongsToVisibleFloor = visibleFloorKeys.has(storeyGuid);
                  break;
                }
              }
            }

            if (show && belongsToVisibleFloor) {
              entity.visible = true;
              entity.pickable = true;
              entity.colorize = SPACE_DEFAULT_COLOR;
              entity.opacity = SPACE_DEFAULT_OPACITY;
            } else if (!show) {
              entity.visible = false;
              entity.pickable = false;
              entity.colorize = null;
              entity.opacity = 1.0;
            }
          }
        }
      });
      console.log('[NativeViewer] FORCE_SHOW_SPACES:', show, visibleFloorKeys ? `(${visibleFloorKeys.size} floors)` : '(all floors)');
    };

    window.addEventListener(FORCE_SHOW_SPACES_EVENT, handler);
    return () => window.removeEventListener(FORCE_SHOW_SPACES_EVENT, handler);
  }, []);

  // ── Listen for Insights color reset (tab change → restore architect colors) ───
  useEffect(() => {
    const handler = () => {
      const viewer = viewerRef.current;
      if (!viewer?.scene) return;
      const scene = viewer.scene;
      // Un-xray everything
      scene.setObjectsXRayed(scene.objectIds, false);
      // Restore architect color palette
      applyArchitectColors(viewer);
      console.log('[NativeViewer] INSIGHTS_COLOR_RESET — restored architect colors');
    };
    window.addEventListener(INSIGHTS_COLOR_RESET_EVENT, handler);
    return () => window.removeEventListener(INSIGHTS_COLOR_RESET_EVENT, handler);
  }, []);

  // ── Listen for Alarm annotation events (fly-to + highlight alarm entities) ───
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AlarmAnnotationsShowDetail>).detail;
      if (!detail?.alarms?.length) return;

      const viewer = viewerRef.current;
      if (!viewer?.scene || !viewer?.metaScene) {
        console.log('[NativeViewer] ALARM_ANNOTATIONS_SHOW received but viewer not ready');
        return;
      }

      const scene = viewer.scene;
      const metaObjects = viewer.metaScene.metaObjects;
      if (!metaObjects) return;

      // Build lookup of alarm fmGuids and their room fmGuids
      const alarmGuids = new Set(detail.alarms.map(a => normalizeGuid(a.fmGuid)));
      const roomGuids = new Set(detail.alarms.filter(a => a.roomFmGuid).map(a => normalizeGuid(a.roomFmGuid!)));

      // X-ray everything, then highlight matching entities
      const xrayMat = scene.xrayMaterial;
      if (xrayMat) {
        xrayMat.fill = true;
        xrayMat.fillAlpha = 0.15;
        xrayMat.fillColor = [0.55, 0.55, 0.6];
        xrayMat.edges = true;
        xrayMat.edgeAlpha = 0.3;
      }
      scene.setObjectsXRayed(scene.objectIds, true);

      const matchedIds: string[] = [];
      const alarmColor: [number, number, number] = [0.9, 0.2, 0.15]; // Red
      const roomColor: [number, number, number] = [1.0, 0.6, 0.2];   // Orange

      // First pass: try to match alarm entities directly
      Object.values(metaObjects).forEach((mo: any) => {
        const sysId = normalizeGuid(mo.originalSystemId || '');
        const moId = normalizeGuid(mo.id || '');

        if (alarmGuids.has(sysId) || alarmGuids.has(moId)) {
          const entity = scene.objects?.[mo.id];
          if (entity) {
            entity.xrayed = false;
            entity.visible = true;
            entity.colorize = alarmColor;
            entity.opacity = 1.0;
            matchedIds.push(mo.id);
          }
        }
      });

      // Second pass: match rooms (always, for context highlighting)
      // Build a name-based lookup for room matching fallback
      const roomNameGuids = new Set<string>();
      detail.alarms.forEach(a => {
        if (a.roomFmGuid) roomNameGuids.add(normalizeGuid(a.roomFmGuid));
      });

      Object.values(metaObjects).forEach((mo: any) => {
        if (mo.type !== 'IfcSpace') return;
        const sysId = normalizeGuid(mo.originalSystemId || '');
        const moId = normalizeGuid(mo.id || '');

        if (roomGuids.has(sysId) || roomGuids.has(moId)) {
          const entity = scene.objects?.[mo.id];
          if (entity) {
            entity.xrayed = false;
            entity.visible = true;
            entity.pickable = true;
            entity.colorize = matchedIds.length === 0 ? alarmColor : roomColor;
            entity.opacity = matchedIds.length === 0 ? 0.8 : 0.6;
            matchedIds.push(mo.id);
          }
        }
      });

      // Fly to matched entities
      if (detail.flyTo && matchedIds.length > 0) {
        viewer.cameraFlight?.flyTo({ aabb: scene.getAABB(matchedIds), duration: 1.0 });
      }

      console.log('[NativeViewer] ALARM_ANNOTATIONS_SHOW:', detail.alarms.length, 'alarms,', matchedIds.length, 'entities matched');
    };

    window.addEventListener(ALARM_ANNOTATIONS_SHOW_EVENT, handler);
    return () => window.removeEventListener(ALARM_ANNOTATIONS_SHOW_EVENT, handler);
  }, []);

  // ── Listen for TOGGLE_ANNOTATIONS (show/hide annotation markers from assets) ───
  // ── Listen for NAV_SPEED_CHANGED (master) and NAV_SPEED_GRANULAR (per-axis) ───
  useEffect(() => {
    const masterHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const speed = detail?.speed ?? 100;
      const multiplier = Math.max(0.25, Math.min(3, speed / 100));
      const viewer = viewerRef.current;
      if (!viewer?.cameraControl) return;
      const cc = viewer.cameraControl;
      const isMob = isMobileRef.current;
      if (isMob) {
        cc.dragRotationRate = 70 * multiplier;
        cc.touchPanRate = 0.14 * multiplier;
        cc.touchDollyRate = 0.09 * multiplier;
      } else {
        cc.dragRotationRate = 120 * multiplier;
        cc.touchPanRate = 0.3 * multiplier;
        cc.touchDollyRate = 0.15 * multiplier;
        cc.mouseWheelDollyRate = 50 * multiplier;
        cc.keyboardDollyRate = 5 * multiplier;
      }
      console.log('[NativeViewer] NAV_SPEED_CHANGED:', speed, '% →', multiplier, 'x');
    };

    const granularHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const viewer = viewerRef.current;
      if (!viewer?.cameraControl) return;
      const cc = viewer.cameraControl;
      const isMob = isMobileRef.current;
      const zM = Math.max(0.25, Math.min(3, (detail?.zoom ?? 100) / 100));
      const pM = Math.max(0.25, Math.min(3, (detail?.pan ?? 100) / 100));
      const rM = Math.max(0.25, Math.min(3, (detail?.rotate ?? 100) / 100));
      if (isMob) {
        cc.dragRotationRate = 70 * rM;
        cc.touchPanRate = 0.14 * pM;
        cc.touchDollyRate = 0.09 * zM;
      } else {
        cc.dragRotationRate = 120 * rM;
        cc.touchPanRate = 0.3 * pM;
        cc.touchDollyRate = 0.15 * zM;
        cc.mouseWheelDollyRate = 50 * zM;
        cc.keyboardDollyRate = 5 * zM;
      }
      console.log('[NativeViewer] NAV_SPEED_GRANULAR: zoom', detail?.zoom, 'pan', detail?.pan, 'rotate', detail?.rotate);
    };

    const fastNavHandler = (e: Event) => {
      const enabled = (e as CustomEvent).detail?.enabled ?? false;
      const viewer = viewerRef.current;
      if (!viewer?.scene) return;
      // FastNav: reduce quality during interaction for snappier feel
      viewer.scene.pbrEnabled = !enabled;
      if (viewer.scene.canvas) {
        viewer.scene.canvas.gl?.flush?.();
      }
      console.log('[NativeViewer] FastNav:', enabled ? 'ON' : 'OFF');
    };

    window.addEventListener('NAV_SPEED_CHANGED', masterHandler);
    window.addEventListener('NAV_SPEED_GRANULAR', granularHandler);
    window.addEventListener('FASTNAV_TOGGLE', fastNavHandler);

    // Apply initial FastNav state
    try {
      const fn = localStorage.getItem('viewer-fastnav-enabled');
      if (fn === 'true') {
        const viewer = viewerRef.current;
        if (viewer?.scene) viewer.scene.pbrEnabled = false;
      }
    } catch {}

    return () => {
      window.removeEventListener('NAV_SPEED_CHANGED', masterHandler);
      window.removeEventListener('NAV_SPEED_GRANULAR', granularHandler);
      window.removeEventListener('FASTNAV_TOGGLE', fastNavHandler);
    };
  }, []);

  useEffect(() => {
    let markerContainer: HTMLDivElement | null = null;
    let cameraUnsubs: Array<() => void> = [];

    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const show = detail?.show ?? true;
      const visibleCategories: string[] | undefined = detail?.visibleCategories;
      const viewer = viewerRef.current;

      // Hide existing markers when toggling off
      if (!show && markerContainer) {
        markerContainer.style.display = 'none';
        return;
      }

      // When showing: always destroy and recreate all markers so all categories are present
      if (markerContainer) {
        cameraUnsubs.forEach(fn => fn());
        cameraUnsubs = [];
        markerContainer.remove();
        markerContainer = null;
      }

      if (!show) return;
      if (!viewer?.scene) return;

      // Fetch annotation assets — include both annotation_placed=true AND created_in_model=false
      try {
        const { data: annotations } = await supabase
          .from('assets')
          .select('fm_guid, common_name, name, asset_type, coordinate_x, coordinate_y, coordinate_z, symbol_id')
          .eq('building_fm_guid', buildingFmGuid)
          .or('annotation_placed.eq.true,created_in_model.eq.false');

        if (!annotations?.length) {
          console.log('[NativeViewer] No annotation assets found');
          return;
        }

        // Create ALL markers, then apply category filter as visibility
        const catSet = visibleCategories && visibleCategories.length > 0
          ? new Set(visibleCategories)
          : null;
        const filtered = annotations;

        // Fetch symbol colors
        const symbolIds = [...new Set(filtered.filter(a => a.symbol_id).map(a => a.symbol_id!))];
        let symbolColors = new Map<string, string>();
        if (symbolIds.length > 0) {
          const { data: symbols } = await supabase
            .from('annotation_symbols')
            .select('id, color, name')
            .in('id', symbolIds);
          symbols?.forEach(s => symbolColors.set(s.id, s.color));
        }

        // Create or reuse container
        const canvas = viewer.scene.canvas?.canvas;
        if (!canvas) return;
        const parent = canvas.parentElement;
        if (!parent) return;

        if (markerContainer) {
          markerContainer.remove();
        }

        const container = document.createElement('div');
        container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:30;overflow:hidden;';
        parent.appendChild(container);
        markerContainer = container;

        // Create marker elements
        filtered.forEach(ann => {
          const color = ann.symbol_id ? (symbolColors.get(ann.symbol_id) || '#3b82f6') : '#3b82f6';
          const label = ann.common_name || ann.name || 'Annotation';
          const marker = document.createElement('div');
          marker.style.cssText = `position:absolute;pointer-events:auto;cursor:pointer;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;color:white;background:${color};white-space:nowrap;transform:translate(-50%,-100%);box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
          marker.textContent = label;
          marker.title = label;
          marker.dataset.category = ann.asset_type || 'Other';
          // Apply category visibility filter
          const markerCat = ann.asset_type || 'Other';
          if (catSet && !catSet.has(markerCat)) {
            marker.style.display = 'none';
            marker.dataset.catHidden = 'true';
          } else {
            marker.dataset.catHidden = 'false';
          }
          container.appendChild(marker);

          // Position update function
          const updatePos = () => {
            if (!viewer.scene?.canvas) return;
            // If hidden by category filter, keep hidden
            if (marker.dataset.catHidden === 'true') {
              marker.style.display = 'none';
              return;
            }
            let wx = ann.coordinate_x || 0;
            let wy = ann.coordinate_y || 0;
            let wz = ann.coordinate_z || 0;
            // If no real position, try to place at room center
            if (wx === 0 && wy === 0 && wz === 0 && ann.fm_guid) {
              // Try to find the parent room from the scene
              const roomGuid = (ann as any).in_room_fm_guid || (ann as any).level_fm_guid;
              if (roomGuid) {
                const metaObjects = viewer.metaScene?.metaObjects || {};
                for (const mo of Object.values(metaObjects) as any[]) {
                  const sysId = (mo.originalSystemId || '').toLowerCase();
                  if (sysId === roomGuid.toLowerCase()) {
                    const entity = viewer.scene.objects?.[mo.id];
                    if (entity?.aabb) {
                      wx = (entity.aabb[0] + entity.aabb[3]) / 2;
                      wy = (entity.aabb[1] + entity.aabb[4]) / 2;
                      wz = (entity.aabb[2] + entity.aabb[5]) / 2;
                    }
                    break;
                  }
                }
              }
              // Still (0,0,0) — skip this marker
              if (wx === 0 && wy === 0 && wz === 0) {
                marker.style.display = 'none';
                return;
              }
            }
            const worldPos = [wx, wy, wz];
            const canvasPos = viewer.scene.camera
              ? worldToCanvas(viewer, worldPos)
              : null;
            if (canvasPos && canvasPos[2] > 0) {
              marker.style.left = canvasPos[0] + 'px';
              marker.style.top = canvasPos[1] + 'px';
              marker.style.display = 'block';
            } else {
              marker.style.display = 'none';
            }
          };

          // Update on camera changes
          const unsub = viewer.scene.camera?.on?.('matrix', updatePos);
          if (unsub) cameraUnsubs.push(() => viewer.scene.camera?.off?.('matrix', unsub));
          updatePos();
        });

        console.log('[NativeViewer] TOGGLE_ANNOTATIONS: created', filtered.length, 'markers');
      } catch (err) {
        console.warn('[NativeViewer] Failed to load annotations:', err);
      }
    };

    window.addEventListener('TOGGLE_ANNOTATIONS', handler);
    return () => {
      window.removeEventListener('TOGGLE_ANNOTATIONS', handler);
      cameraUnsubs.forEach(fn => fn());
      if (markerContainer) {
        markerContainer.remove();
      }
    };
  }, [buildingFmGuid]);


  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ touchAction: 'none' }}
      />


      {/* Error state */}
      {phase === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 z-10 p-6 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mb-3" />
          <p className="text-sm text-destructive font-medium mb-2">Failed to load 3D model</p>
          <p className="text-xs text-muted-foreground max-w-md mb-4">{errorMsg}</p>
          <button
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm hover:opacity-90"
            onClick={() => { setPhase('init'); initialize(); }}
          >
            Try Again
          </button>
        </div>
      )}

    </div>
  );
};

export default NativeXeokitViewer;
