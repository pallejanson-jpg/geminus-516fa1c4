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
import { applyArchitectColors } from '@/lib/architect-colors';
import { INSIGHTS_COLOR_UPDATE_EVENT, INSIGHTS_COLOR_RESET_EVENT, ALARM_ANNOTATIONS_SHOW_EVENT, type InsightsColorUpdateDetail, type AlarmAnnotationsShowDetail } from '@/lib/viewer-events';

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
  // Store pending insights color event to re-apply after models load
  const pendingInsightsColorRef = useRef<InsightsColorUpdateDetail | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const initialize = useCallback(async () => {
    if (!canvasRef.current || !buildingFmGuid) return;

    const t0 = performance.now();

    try {
      // 1. Load SDK + fetch model metadata in PARALLEL
      setPhase('loading_sdk');
      console.log('[NativeViewer] Loading SDK + metadata in parallel...');

      const sdkPromise = (async () => {
        const sdkResponse = await fetch(XEOKIT_CDN);
        const sdkText = await sdkResponse.text();
        const sdkBlob = new Blob([sdkText], { type: 'application/javascript' });
        const sdkBlobUrl = URL.createObjectURL(sdkBlob);
        const sdk = await import(/* @vite-ignore */ sdkBlobUrl);
        URL.revokeObjectURL(sdkBlobUrl);
        return sdk;
      })();

      const dbPromise = supabase
        .from('xkt_models')
        .select('model_id, model_name, storage_path, file_size, storey_fm_guid, synced_at')
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
        saoEnabled: true,
        entityOffsetsEnabled: true,
      });
      viewerRef.current = viewer;

      // Camera defaults
      viewer.camera.eye = [0, 20, 40];
      viewer.camera.look = [0, 0, 0];
      viewer.camera.up = [0, 1, 0];
      viewer.camera.projection = 'perspective';

      // NavCube — load custom neutral-styled plugin via script tag
      {
        const navCubeCanvas = document.createElement('canvas');
        navCubeCanvas.id = `native-navcube-${buildingFmGuid.substring(0, 8)}`;
        navCubeCanvas.style.cssText = 'position:absolute;bottom:60px;right:10px;width:150px;height:150px;pointer-events:auto;';
        canvasRef.current.parentElement?.appendChild(navCubeCanvas);

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

      // Resolve model names from Asset+ Building Storey objects (same logic as useModelNames)
      // XKT files store GUIDs, but the real model names (like "A-40.1") are in the assets table
      if (models.length > 0) {
        try {
          const { data: storeys } = await supabase
            .from('assets')
            .select('attributes')
            .eq('building_fm_guid', buildingFmGuid)
            .eq('category', 'Building Storey');

          if (storeys && storeys.length > 0) {
            const assetPlusNames = new Map<string, string>();
            storeys.forEach((s: any) => {
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
                  m.model_name = resolved;
                }
              });
            }
          }
        } catch (e) {
          console.debug('[NativeViewer] Asset+ name resolution failed, continuing with DB names:', e);
        }
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
        console.warn('[NativeViewer] No models found for building', buildingFmGuid, 'dbError:', dbError);
        setErrorMsg(`Inga XKT-modeller hittades för byggnad ${buildingFmGuid.substring(0, 8)}. Kontrollera att modeller har synkats.`);
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

      if (loadList.length === 0) {
        console.warn('[NativeViewer] No models found at all for building', buildingFmGuid);
        setErrorMsg('Inga XKT-modeller hittades för denna byggnad.');
        setPhase('error');
        return;
      }

      console.log(`[NativeViewer] Loading ${loadList.length}/${models.length} models (A-models prioritized)`);
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

        // Apply architectural IFC-type-based coloring to all objects
        const scene = viewer.scene;
        const allIds = scene.objectIds || [];
        if (allIds.length > 0) {
          scene.setObjectsXRayed(allIds, false);
        }

        // Use shared architect color utility
        const { colorized, hiddenSpaces } = applyArchitectColors(viewer);
        console.log(`[NativeViewer] Colorized ${colorized} objects, hidden ${hiddenSpaces} IfcSpace objects`);
      }

      const totalTime = Math.round(performance.now() - t0);
      console.log(`%c[NativeViewer] 🎉 All ${loaded} A-models loaded in ${totalTime}ms`, 'color:#22c55e;font-weight:bold;font-size:14px');
      
      const memStats = getMemoryStats();
      console.log(`[NativeViewer] Memory: ${memStats.modelCount} models, ${(memStats.usedBytes / 1024 / 1024).toFixed(1)} MB / ${(memStats.maxBytes / 1024 / 1024).toFixed(0)} MB`);
      
      if (mountedRef.current) {
        setPhase('ready');
        (window as any).__nativeXeokitViewer = viewer;
        onViewerReady?.(viewer);
        // Re-apply any pending insights color event that arrived before models loaded
        if (pendingInsightsColorRef.current) {
          const pending = pendingInsightsColorRef.current;
          pendingInsightsColorRef.current = null;
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(INSIGHTS_COLOR_UPDATE_EVENT, { detail: pending }));
          }, 200);
        }
      }

      // All models loaded in priority order above — no secondary queue needed

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
      }
      // Clean up any NavCube canvas we added
      const nc = document.getElementById(`native-navcube-${buildingFmGuid.substring(0, 8)}`);
      nc?.remove();
    };
  }, [initialize]);

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

      // Normalize a guid for comparison (lowercase, no dashes)
      const norm = (s: string) => (s || '').toLowerCase().replace(/-/g, '');

      // Build a lookup of normalized fmGuid → rgb for fast matching
      const fmGuidLookup = new Map<string, [number, number, number]>();
      Object.entries(colorMap).forEach(([key, rgb]) => {
        fmGuidLookup.set(norm(key), rgb);
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
        // Match by fmGuid via originalSystemId or mo.id, with name-based fallback
        const isRoomMode = mode === 'room_spaces' || mode === 'room_type' || mode === 'room_types';
        const isFloorMode = mode.startsWith('energy_floor');
        const nameColorMap = detail.nameColorMap || {};

        Object.values(metaObjects).forEach((mo: any) => {
          const sysId = norm(mo.originalSystemId || '');
          const moId = norm(mo.id || '');
          const moName = (mo.name || '').toLowerCase().trim();
          // Try fmGuid match first, then name-based fallback
          let rgb = fmGuidLookup.get(sysId) || fmGuidLookup.get(moId);
          if (!rgb && moName && nameColorMap[moName]) {
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

      const norm = (s: string) => (s || '').toLowerCase().replace(/-/g, '');

      // Build lookup of alarm fmGuids and their room fmGuids
      const alarmGuids = new Set(detail.alarms.map(a => norm(a.fmGuid)));
      const roomGuids = new Set(detail.alarms.filter(a => a.roomFmGuid).map(a => norm(a.roomFmGuid!)));

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

      Object.values(metaObjects).forEach((mo: any) => {
        const sysId = norm(mo.originalSystemId || '');
        const moId = norm(mo.id || '');

        if (alarmGuids.has(sysId) || alarmGuids.has(moId)) {
          const entity = scene.objects?.[mo.id];
          if (entity) {
            entity.xrayed = false;
            entity.visible = true;
            entity.colorize = alarmColor;
            entity.opacity = 1.0;
            matchedIds.push(mo.id);
          }
        } else if (roomGuids.has(sysId) || roomGuids.has(moId)) {
          const entity = scene.objects?.[mo.id];
          if (entity) {
            entity.xrayed = false;
            entity.visible = true;
            entity.colorize = roomColor;
            entity.opacity = 0.6;
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

  return (
    <div className="relative w-full h-full">
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

    </div>
  );
};

export default NativeXeokitViewer;
