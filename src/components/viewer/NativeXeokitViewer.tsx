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
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, Box } from 'lucide-react';
import { getModelFromMemory, storeModelInMemory, getMemoryStats } from '@/hooks/useXktPreload';
import { INSIGHTS_COLOR_UPDATE_EVENT, type InsightsColorUpdateDetail } from '@/lib/viewer-events';
import { hslStringToRgbFloat } from '@/lib/visualization-utils';

const XEOKIT_CDN = 'https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.5/dist/xeokit-sdk.es.js';

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
}

type LoadPhase = 'init' | 'loading_sdk' | 'creating_viewer' | 'syncing' | 'loading_models' | 'ready' | 'error';

const NativeXeokitViewer: React.FC<NativeXeokitViewerProps> = ({
  buildingFmGuid,
  onClose,
  onViewerReady,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<any>(null);
  const [phase, setPhase] = useState<LoadPhase>('init');
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const initialize = useCallback(async () => {
    if (!canvasRef.current || !buildingFmGuid) return;

    const t0 = performance.now();

    try {
      // 1. Load xeokit SDK
      setPhase('loading_sdk');
      console.log('[NativeViewer] Loading xeokit SDK...');
      const sdk = await import(/* @vite-ignore */ XEOKIT_CDN);
      if (!mountedRef.current) return;
      console.log(`[NativeViewer] SDK loaded in ${Math.round(performance.now() - t0)}ms`);

      // 2. Create viewer
      setPhase('creating_viewer');
      const viewer = new sdk.Viewer({
        canvasElement: canvasRef.current,
        transparent: false,
        saoEnabled: true,
      });
      viewerRef.current = viewer;

      // Camera defaults
      viewer.camera.eye = [0, 20, 40];
      viewer.camera.look = [0, 0, 0];
      viewer.camera.up = [0, 1, 0];
      viewer.camera.projection = 'perspective';

      // NavCube
      if (sdk.NavCubePlugin) {
        const navCubeCanvas = document.createElement('canvas');
        navCubeCanvas.id = `native-navcube-${buildingFmGuid.substring(0, 8)}`;
        navCubeCanvas.style.cssText = 'position:absolute;bottom:60px;right:10px;width:150px;height:150px;pointer-events:auto;';
        canvasRef.current.parentElement?.appendChild(navCubeCanvas);
        new sdk.NavCubePlugin(viewer, { canvasElement: navCubeCanvas });
      }

      // FastNav
      if (sdk.FastNavPlugin) {
        new sdk.FastNavPlugin(viewer, {
          scaleCanvasResolution: true,
          scaleCanvasResolutionFactor: 0.6,
          hideEdges: true,
          hideSAO: true,
        });
      }

      // XKT Loader
      const xktLoader = new sdk.XKTLoaderPlugin(viewer);

      // 3. Fetch model list from DB
      setPhase('loading_models');
      let { data: models, error: dbError } = await supabase
        .from('xkt_models')
        .select('model_id, model_name, storage_path, file_size, storey_fm_guid, synced_at')
        .eq('building_fm_guid', buildingFmGuid)
        .order('file_size', { ascending: true });

      // Auto-sync fallback: if no models cached, trigger server-side sync from Asset+
      if (!dbError && (!models || models.length === 0)) {
        console.log('[NativeViewer] No cached models — triggering auto-sync from Asset+...');
        if (!mountedRef.current) return;
        setPhase('syncing');

        try {
          const { data: syncResult, error: syncError } = await supabase.functions.invoke('asset-plus-sync', {
            body: { action: 'sync-xkt-building', buildingFmGuid }
          });
          
          if (syncError) {
            console.warn('[NativeViewer] Auto-sync failed:', syncError);
          } else {
            console.log('[NativeViewer] Auto-sync result:', syncResult);
          }

          if (!mountedRef.current) return;

          // Re-fetch models after sync
          const refetch = await supabase
            .from('xkt_models')
            .select('model_id, model_name, storage_path, file_size, storey_fm_guid, synced_at')
            .eq('building_fm_guid', buildingFmGuid)
            .order('file_size', { ascending: true });
          
          models = refetch.data;
          dbError = refetch.error;
        } catch (e) {
          console.warn('[NativeViewer] Auto-sync error:', e);
        }
      }

      if (dbError || !models || models.length === 0) {
        console.warn('[NativeViewer] No models found for building', buildingFmGuid);
        setErrorMsg(`Inga XKT-modeller hittades för denna byggnad, varken lokalt eller från Asset+.`);
        setPhase('error');
        return;
      }

      // Staleness check: if oldest model > 7 days, trigger background refresh
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

      // A-model filter: only load architectural models initially
      // Filter strictly by model_name — UUID-based model_id is unreliable
      const NON_ARCH_PREFIXES = ['BRAND', 'FIRE', 'V-', 'V_', 'VS-', 'VS_', 'EL-', 'EL_', 'MEP', 'SPRINKLER'];
      const isArchitectural = (_id: string, name: string | null) => {
        if (!name) return true; // no name = assume architectural (safest default)
        const n = name.toUpperCase();
        // Exclude known non-architectural prefixes
        if (NON_ARCH_PREFIXES.some(p => n.startsWith(p))) return false;
        return true; // everything else loads by default
      };
      const archModels = models.filter((m: ModelInfo) => isArchitectural(m.model_id, m.model_name));
      const skipped = models.filter((m: ModelInfo) => !isArchitectural(m.model_id, m.model_name));
      const loadList = archModels.length > 0 ? archModels : models;

      if (skipped.length > 0) {
        console.log(`[NativeViewer] A-filter: Loading ${loadList.length}/${models.length} models, skipped: ${skipped.map((m: ModelInfo) => m.model_name || m.model_id).join(', ')}`);
      } else {
        console.log(`[NativeViewer] A-filter: All ${models.length} models match architectural filter`);
      }

      setLoadProgress({ loaded: 0, total: loadList.length });

      // 4. Load models concurrently (max 3)
      const CONCURRENT = 3;
      let loaded = 0;
      const queue = [...loadList] as ModelInfo[];

      const loadModel = async (model: ModelInfo) => {
        const modelStart = performance.now();
        const modelId = model.model_id;

        try {
          // Check memory cache first
          const memData = getModelFromMemory(modelId, buildingFmGuid);
          if (memData) {
            // Load from memory
            xktLoader.load({
              id: modelId,
              xkt: memData,
              edges: true,
            });
            const ms = Math.round(performance.now() - modelStart);
            console.log(`%c[NativeViewer] ✅ Memory → ${modelId} (${(memData.byteLength / 1024 / 1024).toFixed(1)} MB) ${ms}ms`, 'color:#22c55e;font-weight:bold');
          } else {
            // Get signed URL from storage
            const { data: urlData } = await supabase.storage
              .from('xkt-models')
              .createSignedUrl(model.storage_path, 3600);

            if (!urlData?.signedUrl) {
              console.warn(`[NativeViewer] No signed URL for ${modelId}`);
              return;
            }

            // Fetch binary
            const fetchStart = performance.now();
            const resp = await fetch(urlData.signedUrl);
            if (!resp.ok) {
              console.warn(`[NativeViewer] Fetch failed for ${modelId}: ${resp.status}`);
              return;
            }
            const arrayBuf = await resp.arrayBuffer();
            const fetchMs = Math.round(performance.now() - fetchStart);

            // Validate
            if (arrayBuf.byteLength < 50_000) {
              console.warn(`[NativeViewer] Skipping ${modelId} — too small (${arrayBuf.byteLength} bytes)`);
              return;
            }

            // Store in memory for next time
            storeModelInMemory(modelId, buildingFmGuid, arrayBuf);

            // Load into viewer
            xktLoader.load({
              id: modelId,
              xkt: arrayBuf,
              edges: true,
            });

            const totalMs = Math.round(performance.now() - modelStart);
            console.log(`%c[NativeViewer] 💾 Storage → ${modelId} (${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)} MB) fetch: ${fetchMs}ms, total: ${totalMs}ms`, 'color:#3b82f6;font-weight:bold');
          }
        } catch (e) {
          console.warn(`[NativeViewer] Error loading ${modelId}:`, e);
        }

        loaded++;
        if (mountedRef.current) {
          setLoadProgress({ loaded, total: models.length });
        }
      };

      // Process queue with concurrency control
      const active = new Set<Promise<void>>();
      for (const model of queue) {
        const p = loadModel(model).finally(() => active.delete(p));
        active.add(p);
        if (active.size >= CONCURRENT) {
          await Promise.race(active);
        }
      }
      await Promise.allSettled(Array.from(active));

      // 5. Fit camera to scene
      if (mountedRef.current && viewer.scene) {
        viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.5 });

        // Enable SAO after load
        if (viewer.scene.sao) {
          viewer.scene.sao.enabled = true;
          viewer.scene.sao.intensity = 0.15;
          viewer.scene.sao.bias = 0.5;
          viewer.scene.sao.scale = 1000;
        }
      }

      const totalTime = Math.round(performance.now() - t0);
      console.log(`%c[NativeViewer] 🎉 All ${loaded} models loaded in ${totalTime}ms`, 'color:#22c55e;font-weight:bold;font-size:14px');
      
      const memStats = getMemoryStats();
      console.log(`[NativeViewer] Memory: ${memStats.modelCount} models, ${(memStats.usedBytes / 1024 / 1024).toFixed(1)} MB / ${(memStats.maxBytes / 1024 / 1024).toFixed(0)} MB`);
      
      if (mountedRef.current) {
        setPhase('ready');
        onViewerReady?.(viewer);
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
      }
      // Clean up any NavCube canvas we added
      const nc = document.getElementById(`native-navcube-${buildingFmGuid.substring(0, 8)}`);
      nc?.remove();
    };
  }, [initialize]);

  // ── Listen for Insights color events (chart click → colorize model) ───
  useEffect(() => {
    const handler = (e: Event) => {
      const viewer = viewerRef.current;
      if (!viewer?.scene || !viewer?.metaScene) return;
      const detail = (e as CustomEvent<InsightsColorUpdateDetail>).detail;
      if (!detail?.colorMap) return;

      const scene = viewer.scene;
      const colorMap = detail.colorMap;

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

      // Colorize matching objects
      Object.entries(colorMap).forEach(([fmGuid, rgb]) => {
        // Find entities matching this fmGuid in metaScene
        const metaObjects = viewer.metaScene.metaObjects;
        if (!metaObjects) return;
        Object.values(metaObjects).forEach((mo: any) => {
          const sysId = (mo.originalSystemId || '').toLowerCase();
          if (sysId === fmGuid.toLowerCase() || sysId.replace(/-/g, '') === fmGuid.toLowerCase().replace(/-/g, '')) {
            const entity = scene.objects?.[mo.id];
            if (entity) {
              entity.xrayed = false;
              entity.visible = true;
              entity.colorize = rgb;
              entity.opacity = 0.85;
            }
            // Also colorize descendants (e.g. room contents)
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
          }
        });
      });

      console.log('[NativeViewer] Applied INSIGHTS_COLOR_UPDATE:', detail.mode, Object.keys(colorMap).length, 'entries');
    };

    window.addEventListener(INSIGHTS_COLOR_UPDATE_EVENT, handler);
    return () => window.removeEventListener(INSIGHTS_COLOR_UPDATE_EVENT, handler);
  }, []);

  return (
    <div className="relative w-full h-full bg-background">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ touchAction: 'none' }}
      />

      {/* Loading overlay */}
      {phase !== 'ready' && phase !== 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10">
          <Spinner className="h-8 w-8 mb-3" />
          <p className="text-sm text-muted-foreground font-medium">
            {phase === 'init' && 'Initierar...'}
            {phase === 'loading_sdk' && 'Laddar xeokit SDK...'}
            {phase === 'creating_viewer' && 'Skapar viewer...'}
            {phase === 'syncing' && 'Hämtar 3D-modeller från Asset+...'}
            {phase === 'loading_models' && (
              <>
                Laddar modeller ({loadProgress.loaded}/{loadProgress.total})
              </>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-1">
            <Box className="h-3 w-3" />
            Native xeokit viewer (prototype)
          </p>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 z-10 p-6 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mb-3" />
          <p className="text-sm text-destructive font-medium mb-2">Kunde inte ladda 3D-modellen</p>
          <p className="text-xs text-muted-foreground max-w-md">{errorMsg}</p>
        </div>
      )}

      {/* Badge */}
      {phase === 'ready' && (
        <div className="absolute top-2 left-2 bg-primary/10 text-primary text-[10px] px-2 py-0.5 rounded-full font-mono z-10">
          Native xeokit
        </div>
      )}
    </div>
  );
};

export default NativeXeokitViewer;
