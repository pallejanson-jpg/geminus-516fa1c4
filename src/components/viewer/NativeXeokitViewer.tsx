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
import { useIsMobile } from '@/hooks/use-mobile';
import { INSIGHTS_COLOR_UPDATE_EVENT, type InsightsColorUpdateDetail } from '@/lib/viewer-events';

const XEOKIT_CDN = '/lib/xeokit/xeokit-sdk.es.js';

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

type ModelCandidate = ModelInfo & { synced_at?: string | null; source: 'db' | 'storage' };

type LoadPhase = 'init' | 'loading_sdk' | 'creating_viewer' | 'syncing' | 'loading_models' | 'ready' | 'error';

const NativeXeokitViewer: React.FC<NativeXeokitViewerProps> = ({
  buildingFmGuid,
  onClose,
  onViewerReady,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<any>(null);
  const isMobile = useIsMobile();
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
      const { data: modelsFromDb, error: dbErrorRaw } = await supabase
        .from('xkt_models')
        .select('model_id, model_name, storage_path, file_size, storey_fm_guid, synced_at')
        .eq('building_fm_guid', buildingFmGuid)
        .order('file_size', { ascending: true });
      let dbError: any = dbErrorRaw;
      let models: ModelCandidate[] = ((modelsFromDb as any[]) ?? []).map((m) => ({
        ...m,
        source: 'db' as const,
      }));

      // Supplement from storage folder to avoid stale/missing DB metadata
      // (xkt_models can lag behind actual files in xkt-models bucket)
      const mergedModels = new Map<string, ModelCandidate>();
      models.forEach((m) => mergedModels.set(m.model_id, m));

      try {
        const { data: storageFiles, error: storageListError } = await supabase.storage
          .from('xkt-models')
          .list(buildingFmGuid, {
            limit: 1000,
            sortBy: { column: 'name', order: 'asc' },
          });

        if (!storageListError && storageFiles) {
          const xktFiles = storageFiles.filter((f: any) =>
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
        } else if (storageListError) {
          console.warn('[NativeViewer] Storage list failed, continuing with DB models only:', storageListError.message);
        }
      } catch (storageError) {
        console.warn('[NativeViewer] Storage list fallback failed, continuing with DB models only:', storageError);
      }

      // Auto-sync fallback: if no models cached, OR no A-models found, trigger server-side sync from Asset+
      const hasAnyModels = models && models.length > 0;
      const namedModelsCheck = hasAnyModels ? models.filter((m: ModelCandidate) => {
        const name = m.model_name;
        if (!name || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name)) return false;
        return name.toUpperCase().charAt(0) === 'A';
      }) : [];
      
      const needsSync = !hasAnyModels || namedModelsCheck.length === 0;
      
      if (!dbError && needsSync) {
        const reason = !hasAnyModels ? 'no models at all' : 'no A-models found locally';
        console.log(`[NativeViewer] ${reason} — triggering sync from Asset+...`);
        if (!mountedRef.current) return;
        setPhase('syncing');

        try {
          const { data: syncResult, error: syncError } = await supabase.functions.invoke('asset-plus-sync', {
            body: { action: 'sync-xkt-building', buildingFmGuid, force: true }
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
          
          // Also re-check storage
          const { data: storageAfterSync } = await supabase.storage
            .from('xkt-models')
            .list(buildingFmGuid, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

          const remerged = new Map<string, ModelCandidate>();
          ((refetch.data as any[]) ?? []).forEach((m) => {
            remerged.set(m.model_id, { ...m, source: 'db' as const });
          });
          if (storageAfterSync) {
            storageAfterSync
              .filter((f: any) => f.name?.toLowerCase().endsWith('.xkt') && !f.name?.toLowerCase().endsWith('_xkt.xkt'))
              .forEach((file: any) => {
                const modelId = file.name.replace(/\.xkt$/i, '');
                if (!remerged.has(modelId)) {
                  remerged.set(modelId, {
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
          }
          
          models = Array.from(remerged.values());
          dbError = refetch.error;
          console.log(`[NativeViewer] After sync: ${models.length} models found`);
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

      // A-model filter: only load models whose name starts with "A" (architectural)
      // Non-architectural prefixes are excluded (BRAND, FIRE, V-, EL-, MEP, SPRINKLER, etc.)
      const NON_ARCH_PREFIXES = ['BRAND', 'FIRE', 'V-', 'V_', 'VS-', 'VS_', 'EL-', 'EL_', 'MEP', 'SPRINKLER', 'K-', 'K_', 'R-', 'R_', 'S-', 'S_'];
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
      const hasRealName = (name: string | null) => name && !UUID_RE.test(name);

      const isArchitectural = (_id: string, name: string | null) => {
        if (!hasRealName(name)) return false; // UUID or no name — can't determine, handle separately
        const upper = name!.toUpperCase();
        if (NON_ARCH_PREFIXES.some(p => upper.startsWith(p))) return false;
        if (upper.charAt(0) === 'A') return true;
        return false; // Unknown prefix — not architectural
      };

      // Separate models with real names vs UUID-only names
      const namedModels = models.filter((m: ModelCandidate) => hasRealName(m.model_name));
      const uuidModels = models.filter((m: ModelCandidate) => !hasRealName(m.model_name));

      let loadList: ModelInfo[];
      let backgroundList: ModelInfo[];

      if (namedModels.length > 0) {
        // Use strict name-based filtering: only A-prefixed architectural models
        const archModels = namedModels.filter((m: ModelCandidate) => isArchitectural(m.model_id, m.model_name));
        if (archModels.length > 0) {
          loadList = archModels;
        } else {
          // Smart fallback: no A-models found, but named models exist that aren't explicitly non-architectural
          // Load the largest non-excluded model (likely architectural with different naming in Asset+)
          const nonExcluded = namedModels.filter((m: ModelCandidate) => {
            const upper = (m.model_name || '').toUpperCase();
            return !NON_ARCH_PREFIXES.some(p => upper.startsWith(p));
          });
          if (nonExcluded.length > 0) {
            const sorted = [...nonExcluded].sort((a, b) => (b.file_size || 0) - (a.file_size || 0));
            loadList = [sorted[0]];
            console.warn(`[NativeViewer] No A-prefixed models — fallback to largest non-excluded: "${sorted[0].model_name}" (${((sorted[0].file_size || 0) / 1024 / 1024).toFixed(1)} MB)`);
          } else {
            loadList = [];
          }
        }
        backgroundList = []; // Strict mode: never auto-load secondary/non-A models
      } else {
        // UUID-only fallback: prioritize DB-known models first, ignore storage-only spillover when possible
        const dbUuidModels = uuidModels.filter((m: ModelCandidate) => m.source === 'db');
        const uuidPool = dbUuidModels.length > 0 ? dbUuidModels : uuidModels;
        const sorted = [...uuidPool].sort((a, b) => (b.file_size || 0) - (a.file_size || 0));

        loadList = sorted.length > 0 ? [sorted[0]] : [];
        backgroundList = []; // Strict mode

        console.log(`[NativeViewer] UUID fallback pool: ${uuidPool.length} (db=${dbUuidModels.length}, storage=${uuidModels.length - dbUuidModels.length})`);
      }

      if (loadList.length === 0) {
        const availableNames = models.map((m: ModelCandidate) => m.model_name || m.model_id).slice(0, 5).join(', ');
        console.warn(`[NativeViewer] No architectural (A) models matched filter. Available: ${availableNames}`);
        setErrorMsg(`Inga arkitekturmodeller (A-*) hittades. Tillgängliga modeller: ${availableNames}. Kontrollera att modellerna i Asset+ har korrekt namngivning.`);
        setPhase('error');
        return;
      }

      console.log(`[NativeViewer] A-filter (strict): Initial load ${loadList.length}/${models.length}. Secondary auto-load disabled.`);

      setLoadProgress({ loaded: 0, total: loadList.length });

      // 4. Load models with strict sequential loading (prevents xeokit parser OOM/crashes on large files)
      const CONCURRENT = 1;
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

      const loadModel = async (model: ModelInfo) => {
        const modelStart = performance.now();
        const modelId = model.model_id;

        try {
          const memData = getModelFromMemory(modelId, buildingFmGuid);

          if (memData) {
            console.log(`[NativeViewer] Loading from memory: ${modelId}, size: ${memData.byteLength}`);
            const entity = xktLoader.load({ id: modelId, xkt: memData, edges: true });
            const ok = await waitForModel(entity, modelId);
            if (!ok) return;

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
              const entity = xktLoader.load({ id: modelId, src: urlData.signedUrl, edges: true });
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

              const entity = xktLoader.load({ id: modelId, xkt: arrayBuf, edges: true });
              const ok = await waitForModel(entity, modelId);
              if (!ok) return;

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
      console.log(`%c[NativeViewer] 🎉 All ${loaded} A-models loaded in ${totalTime}ms`, 'color:#22c55e;font-weight:bold;font-size:14px');
      
      const memStats = getMemoryStats();
      console.log(`[NativeViewer] Memory: ${memStats.modelCount} models, ${(memStats.usedBytes / 1024 / 1024).toFixed(1)} MB / ${(memStats.maxBytes / 1024 / 1024).toFixed(0)} MB`);
      
      if (mountedRef.current) {
        setPhase('ready');
        onViewerReady?.(viewer);
      }

      // 6. Secondary/non-A auto-loading disabled in strict A-mode to avoid OOM/crashes
      if (backgroundList.length > 0) {
        console.log(`[NativeViewer] Secondary auto-load disabled (${backgroundList.length} models skipped)`);
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
