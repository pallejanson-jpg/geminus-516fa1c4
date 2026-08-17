/**
 * NativeXeokitViewer — Prototype native xeokit viewer using XKTLoaderPlugin.
 *
 * Loads XKT models directly from Supabase Storage, bypassing the Geminus Plus Vue wrapper.
 * This eliminates the fetch interceptor hack and gives direct control over the loading pipeline.
 *
 * Architecture: Composed from three hooks:
 * - useXeokitInstance: SDK loading, viewer creation, camera setup, NavCube, FastNav
 * - useModelLoader: Model metadata, bootstrap, progressive concurrent loading
 * - useViewerEventListeners: All CustomEvent handlers (insights, alarms, annotations, etc.)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle } from 'lucide-react';
import { getMemoryStats } from '@/hooks/useXktPreload';
import { useIsMobile } from '@/hooks/use-mobile';
import { applyArchitectColors } from '@/lib/architect-colors';
import { emit, on, type InsightsColorUpdateDetail } from '@/lib/event-bus';
import { useXeokitInstance } from '@/hooks/useXeokitInstance';
import { useModelLoader, type ModelInfo } from '@/hooks/useModelLoader';
import { useViewerEventListeners } from '@/hooks/useViewerEventListeners';

type LoadPhase = 'init' | 'loading_sdk' | 'creating_viewer' | 'syncing' | 'bootstrapping' | 'loading_models' | 'ready' | 'error';

interface NativeXeokitViewerProps {
  buildingFmGuid: string;
  onClose?: () => void;
  onViewerReady?: (viewer: any) => void;
  /** When true, forces a re-download of XKT models from Geminus Plus before loading */
  forceBootstrap?: boolean;
  /** When true, skips the instant camera-fit-to-whole-model snap once loading completes — used when something else (e.g. indoor wayfinding) owns the camera. */
  suppressAutoFit?: boolean;
}

const NativeXeokitViewer: React.FC<NativeXeokitViewerProps> = ({
  buildingFmGuid,
  onClose,
  onViewerReady,
  forceBootstrap = false,
  suppressAutoFit = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isMobile = useIsMobile();
  const [phase, setPhase] = useState<LoadPhase>('init');
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0, currentModel: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const mountedRef = useRef(true);
  // Read via ref inside the (memoized) initialize() callback so a suppressAutoFit
  // change is always picked up, even though it isn't in initialize's own deps array.
  const suppressAutoFitRef = useRef(suppressAutoFit);
  suppressAutoFitRef.current = suppressAutoFit;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── webglcontextlost recovery: clean secondary models, surface recovery UI ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: Event) => {
      e.preventDefault();
      console.warn('[NativeViewer] webglcontextlost — destroying secondary models');
      try {
        const v = (window as any).__nativeXeokitViewer;
        if (v?.scene?.models) {
          for (const [id, m] of Object.entries(v.scene.models as Record<string, any>)) {
            const upper = String(id).toUpperCase();
            const isArch = upper.startsWith('A') || upper.includes('ARK') || upper.includes('ARCHITECT');
            if (!isArch) { try { (m as any).destroy?.(); } catch {} }
          }
        }
      } catch {}
      (window as any).__xeokitNativeColors = undefined;
      if (mountedRef.current) {
        setErrorMsg('GPU memory exhausted. The engineering models have been unloaded — reload to continue with the architectural model only.');
        setPhase('error');
      }
    };
    canvas.addEventListener('webglcontextlost', handler as any, false);
    return () => canvas.removeEventListener('webglcontextlost', handler as any);
  }, []);

  // ── Hook: xeokit instance lifecycle ──
  // ── Hook: xeokit instance lifecycle ──
  const { viewerRef, createInstance, destroy } = useXeokitInstance({
    canvasRef,
    buildingFmGuid,
    onContextLost: () => {
      if (mountedRef.current) {
        setErrorMsg('GPU memory exhausted. Try reloading the page.');
        setPhase('error');
      }
    },
  });

  // ── Hook: model loading pipeline ──
  const {
    fetchModelMetadata,
    bootstrapFromGeminusPlus,
    loadAllModels,
    loadSingleModel,
    pendingInsightsColorRef,
    isArchitectural,
  } = useModelLoader({ buildingFmGuid, isMobile });

  // ── Hook: all event listeners ──
  useViewerEventListeners({
    viewerRef,
    canvasRef,
    buildingFmGuid,
    pendingInsightsColorRef,
  });

  // Passive cleanup: reset stuck conversion jobs
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
        if (stuckJobs?.length) {
          for (const job of stuckJobs) {
            await supabase.from('conversion_jobs').update({
              status: 'error',
              error_message: 'Auto-reset: orphaned job detected by viewer',
              updated_at: new Date().toISOString(),
            }).eq('id', job.id);
          }
        }
      } catch {}
    };
    cleanupStuckJobs();
  }, [buildingFmGuid]);

  // ── Main initialization ──
  const initialize = useCallback(async () => {
    if (!canvasRef.current || !buildingFmGuid) return;
    const t0 = performance.now();

    try {
      // 1. Create viewer instance (SDK + plugins)
      setPhase('loading_sdk');
      const instance = await createInstance();
      if (!instance || !mountedRef.current) return;
      const { viewer, xktLoader } = instance;

      setPhase('creating_viewer');
      console.log(`[NativeViewer] SDK + viewer created in ${Math.round(performance.now() - t0)}ms`);

      // 2. Load models: try cache first, fall back to Geminus Plus if cache is empty
      let models: any[] = [];
      setPhase('syncing');

      // Try local cache first (fast path)
      console.log('[NativeViewer] Checking local cache...');
      const { models: cachedModels } = await fetchModelMetadata();
      if (!mountedRef.current) return;

      if (cachedModels && cachedModels.length > 0) {
        // Cache has models — use them
        models = cachedModels;
        console.log(`[NativeViewer] ✅ Loaded ${models.length} models from cache`);
      } else if (forceBootstrap) {
        // Cache is empty AND forceBootstrap is set: fetch from Geminus Plus
        console.log('[NativeViewer] Cache empty — fetching from Geminus Plus');
        const bootstrapped = await bootstrapFromGeminusPlus();
        if (!mountedRef.current) return;
        models = bootstrapped;
        console.log(`[NativeViewer] Got ${models.length} models from Geminus Plus`);
      } else {
        // Cache is empty AND forceBootstrap is false: still try Geminus Plus (first visit)
        console.log('[NativeViewer] Cache empty — trying Geminus Plus (first visit)');
        const bootstrapped = await bootstrapFromGeminusPlus();
        if (!mountedRef.current) return;
        models = bootstrapped;
        console.log(`[NativeViewer] Got ${models.length} models from Geminus Plus`);
      }

      if (models.length === 0) {
        setErrorMsg('No 3D models found for this building. Sync XKT models via Settings → Buildings, or upload an IFC file.');
        setPhase('error');
        return;
      }

      // 4. Load models progressively
      setPhase('loading_models');
      let { loaded, secondaryQueue, chunkModels, hasRealTiles } = await loadAllModels(
        viewer, xktLoader, models,
        (progress) => {
          if (mountedRef.current) setLoadProgress(prev => ({ ...prev, ...progress }));
        },
        mountedRef,
      );

      // 5. Post-load setup
      if (mountedRef.current && viewer.scene) {
        if (viewer.scene.sao) viewer.scene.sao.enabled = false;

        const allIds = viewer.scene.objectIds || [];
        
        // Check for empty scene — if A-model loaded but produced 0 entities,
        // force-load secondary models (e.g. RIV) immediately
        if (allIds.length === 0 && secondaryQueue.length > 0) {
          console.warn(`[NativeViewer] A-model produced 0 entities — loading ${secondaryQueue.length} secondary models as fallback`);
          const metadataFileSet = new Set<string>();
          for (const model of secondaryQueue) {
            if (!mountedRef.current) break;
            const ok = await loadSingleModel(model, viewer, xktLoader, metadataFileSet);
            if (ok) { loaded++; }
          }
          secondaryQueue = []; // consumed
        }

        // Re-read allIds after potential secondary load
        const finalIds = viewer.scene.objectIds || [];
        if (finalIds.length > 0) {
          (window as any).__colorFilterActive = false;
          viewer.scene.setObjectsXRayed(finalIds, false);
          try {
            const selected = viewer.scene.selectedObjectIds || [];
            if (selected.length > 0) viewer.scene.setObjectsSelected(selected, false);
          } catch {}
          try {
            const colorized = viewer.scene.colorizedObjectIds || [];
            if (colorized.length > 0) viewer.scene.setObjectsColorized(colorized, false);
          } catch {}
        }

        // Capture native model colors
        // Capture native colors BEFORE any palette is applied.
        // We store `null` (not [1,1,1]) when entity.colorize is not set, so that
        // restoring with `entity.colorize = null` uses the XKT-embedded material
        // colour rather than forcing white over it.
        const nativeColors = new Map<string, { color: number[] | null; opacity: number; edges: boolean }>();
        if (viewer.scene.objects) {
          for (const objId of finalIds) {
            const entity = viewer.scene.objects[objId];
            if (entity) {
              nativeColors.set(objId, {
                color: entity.colorize ? [...entity.colorize] : null,
                opacity: entity.opacity ?? 1,
                edges: entity.edges ?? true,
              });
            }
          }
        }
        (window as any).__xeokitNativeColors = nativeColors;

        // ── Color strategy ────────────────────────────────────────────────────
        // If the user has explicitly chosen "native model colors" (NONE_VALUE in
        // localStorage), skip architect colors entirely and let the XKT materials
        // render as-is. Objects without XKT material assignments are given a
        // neutral default so xeokit's internal red fallback doesn't show.
        //
        // Otherwise run red-detection: if the loaded model has no A-model or
        // >5 % of sampled objects are raw red, apply the architect palette.
        const savedTheme = localStorage.getItem('geminus-viewer-theme-id');
        // Only use native colors if explicitly set to 'none'; otherwise default to architect palette
        const userWantsNative = savedTheme === 'none';

        if (userWantsNative) {
          console.log('[NativeViewer] Native colors requested — skipping architect palette');
          // Clear any colorize overrides that might have been set by a previous
          // session, so objects use their XKT-embedded material colors.
          // Objects that xeokit would show as raw red (no XKT material) get a
          // neutral off-white so the view is readable.
          const NEUTRAL = [0.933, 0.929, 0.918]; // same as DEFAULT_COLOR in architect-colors.ts
          for (const id of finalIds) {
            const e = viewer.scene.objects?.[id];
            if (!e) continue;
            const c = e.colorize;
            const isRawRed = !c || (c[0] >= 0.95 && c[1] <= 0.1 && c[2] <= 0.1);
            if (isRawRed) {
              // No XKT material — apply neutral so view is readable
              e.colorize = NEUTRAL;
            } else {
              // Has an actual colorize from a previous architect-colors pass — clear it
              // so the XKT embedded material colour takes over
              e.colorize = null;
            }
          }
        } else {
          // Architect palette is the default look. The old red-detection heuristic
          // (sample 500 objects, keep native colors if <5% are red) let models with
          // genuinely red XKT materials (roofs, facade strips) through unstyled —
          // so always apply the palette unless the user explicitly chose native.
          console.log('[NativeViewer] Applying architect colors (default palette)');
          try { applyArchitectColors(viewer); } catch (e) { console.warn('[NativeViewer] applyArchitectColors failed', e); }
        }

        // Log AABB for diagnostics
        try {
          const aabb = viewer.scene.aabb;
          console.log(`[NativeViewer] Scene AABB: [${aabb?.map((v: number) => v.toFixed(1)).join(', ')}]`);
        } catch {}
      }

      const totalTime = Math.round(performance.now() - t0);
      console.log(`%c[NativeViewer] 🎉 All ${loaded} models loaded in ${totalTime}ms`, 'color:#22c55e;font-weight:bold;font-size:14px');
      const memStats = getMemoryStats();
      console.log(`[NativeViewer] Memory: ${memStats.modelCount} models, ${(memStats.usedBytes / 1024 / 1024).toFixed(1)} MB / ${(memStats.maxBytes / 1024 / 1024).toFixed(0)} MB`);

      if (mountedRef.current) {
        setPhase('ready');
        (window as any).__nativeXeokitViewer = viewer;
        onViewerReady?.(viewer);
        emit('VIEWER_MODELS_LOADED', { buildingFmGuid });

        // Build XKT entity ID → Faciliate FM GUID map via name matching.
        // Needed because Asset+ XKT GUIDs (Revit/IFC element IDs) differ from
        // Faciliate FM GUIDs. We bridge via storey/room names (unique per building).
        supabase
          .from('assets')
          .select('fm_guid, attributes')
          .eq('building_fm_guid', buildingFmGuid)
          .in('category', ['Building Storey', 'Space', 'IfcBuildingStorey', 'IfcSpace'])
          .then(({ data }) => {
            if (!data?.length) return;
            const metaObjects = viewer.metaScene?.metaObjects;
            if (!metaObjects) return;

            // Build name → XKT id maps from loaded metaObjects
            const storeyByName = new Map<string, string>();
            const spacesByName = new Map<string, string[]>();
            Object.values(metaObjects).forEach((mo: any) => {
              const name = (mo.name || '').toLowerCase().trim();
              if (!name) return;
              const t = (mo.type || '').toLowerCase();
              if (t.includes('buildingstorey') || t.includes('storey')) {
                storeyByName.set(name, mo.id);
              } else if (t === 'ifcspace' || t === 'space') {
                const arr = spacesByName.get(name) || [];
                arr.push(mo.id);
                spacesByName.set(name, arr);
              }
            });

            // Map: XKT entity id (normalized: lowercase, no dashes) → Faciliate fm_guid (normalized)
            // Keys must match normalizeGuid() output used in useViewerEventListeners
            const norm = (s: string) => s.toLowerCase().replace(/-/g, '');
            const xktToFm = new Map<string, string>();
            data.forEach((row: any) => {
              const fmGuid = norm(row.fm_guid || '');
              if (!fmGuid) return;
              const attrs = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : (row.attributes || {});
              const name = (attrs.commonName || attrs.levelName || attrs.roomName || '').toLowerCase().trim();
              if (!name) return;
              const cat = (attrs.category || attrs.objectTypeValue || '').toLowerCase();
              if (cat.includes('storey')) {
                const xktId = storeyByName.get(name);
                if (xktId) xktToFm.set(norm(xktId), fmGuid);
              } else if (cat.includes('space') || cat.includes('ifcspace')) {
                const ids = spacesByName.get(name);
                if (ids?.length === 1) xktToFm.set(norm(ids[0]), fmGuid); // unique name only
              }
            });

            if (xktToFm.size > 0) {
              (window as any).__xktIdToFmGuid = xktToFm;
              console.log(`[NativeViewer] Built XKT→FM GUID name-bridge: ${xktToFm.size} entries`);
            }
          })
          .catch(() => {});

        // Wire up virtual chunk floor filtering
        if (chunkModels.length > 0 && !hasRealTiles) {
          const virtualChunks = chunkModels
            .sort((a: any, b: any) => (a.chunk_order ?? 0) - (b.chunk_order ?? 0))
            .map((c: any) => ({
              modelId: c.model_id, modelName: c.model_name || c.model_id,
              storeyFmGuid: c.storey_fm_guid!, chunkOrder: c.chunk_order ?? 0,
              parentModelId: c.parent_model_id || '', storagePath: c.storage_path,
            }));
          (window as any).__xktVirtualChunks = virtualChunks;
        }

        // Instant viewFit (skip in split2d3d mode, or when something else — e.g. indoor
        // wayfinding — already owns the camera for this load)
        const isSplit2d3d = new URLSearchParams(window.location.search).get('mode') === 'split2d3d';
        if (!isSplit2d3d && !suppressAutoFitRef.current) {
          try {
            const aabb = viewer.scene?.aabb;
            if (aabb) viewer.cameraFlight.flyTo({ aabb, duration: 0 });
          } catch {}
        }

        // Re-apply pending insights color
        if (pendingInsightsColorRef.current) {
          const pending = pendingInsightsColorRef.current;
          (pendingInsightsColorRef as React.MutableRefObject<any>).current = null;
          setTimeout(() => {
            emit('INSIGHTS_COLOR_UPDATE', pending);
          }, 200);
        }
      }

      // 6. Secondary model queue (lazy-load on demand)
      if (secondaryQueue.length > 0) {
        (window as any).__secondaryModelQueue = secondaryQueue;
        (window as any).__loadSecondaryModel = async (modelInfo: any) => {
          if (!mountedRef.current || !viewerRef.current?.scene) return;
          const gl = canvasRef.current?.getContext('webgl2') || canvasRef.current?.getContext('webgl');
          if (gl?.isContextLost?.()) return;
          try {
            const metadataFileSet = new Set<string>(); // secondary models skip metadata
            const ok = await loadSingleModel(modelInfo, viewerRef.current, xktLoader, metadataFileSet);
            if (ok && mountedRef.current && viewerRef.current?.scene) {
              // Hide IfcSpace from non-A models
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
                    if (entity) { entity.visible = false; entity.pickable = false; }
                  }
                }
              }
              // Apply architect palette to new model entities (raw XKT materials often red)
              const savedTheme = localStorage.getItem('geminus-viewer-theme-id');
              if (savedTheme !== 'none' && !(window as any).__colorFilterActive) {
                try { applyArchitectColors(v); } catch {}
              }
            }
          } catch {}
        };
        window.dispatchEvent(new CustomEvent('SECONDARY_MODELS_AVAILABLE', {
          detail: { models: secondaryQueue.map(m => ({ model_id: m.model_id, model_name: m.model_name })) }
        }));
      }


    } catch (e) {
      console.error('[NativeViewer] Init error:', e);
      if (mountedRef.current) {
        setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
        setPhase('error');
      }
    }
  }, [buildingFmGuid, forceBootstrap, createInstance, fetchModelMetadata, bootstrapFromGeminusPlus, loadAllModels, loadSingleModel, onViewerReady, pendingInsightsColorRef, viewerRef]);

  // ── Stabilized effect: only re-run when buildingFmGuid changes ──
  // Uses a ref to always call the latest initialize without it being a dependency,
  // preventing the destroy→recreate flicker loop caused by unstable callback identities.
  const initRef = useRef(initialize);
  initRef.current = initialize;

  useEffect(() => {
    initRef.current();
    return () => { destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingFmGuid, destroy]);

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
