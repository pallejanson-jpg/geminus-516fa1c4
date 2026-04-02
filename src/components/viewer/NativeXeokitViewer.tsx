/**
 * NativeXeokitViewer — Prototype native xeokit viewer using XKTLoaderPlugin.
 *
 * Loads XKT models directly from Supabase Storage, bypassing the Asset+ Vue wrapper.
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
import { INSIGHTS_COLOR_UPDATE_EVENT } from '@/lib/viewer-events';
import { useXeokitInstance } from '@/hooks/useXeokitInstance';
import { useModelLoader, type ModelInfo } from '@/hooks/useModelLoader';
import { useViewerEventListeners } from '@/hooks/useViewerEventListeners';

type LoadPhase = 'init' | 'loading_sdk' | 'creating_viewer' | 'syncing' | 'bootstrapping' | 'loading_models' | 'ready' | 'error';

interface NativeXeokitViewerProps {
  buildingFmGuid: string;
  onClose?: () => void;
  onViewerReady?: (viewer: any) => void;
}

const NativeXeokitViewer: React.FC<NativeXeokitViewerProps> = ({
  buildingFmGuid,
  onClose,
  onViewerReady,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isMobile = useIsMobile();
  const [phase, setPhase] = useState<LoadPhase>('init');
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0, currentModel: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
    bootstrapFromAssetPlus,
    loadAllModels,
    loadSingleModel,
    deferStalenessCheck,
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

      // 2. Fetch model metadata
      let { models, dbError } = await fetchModelMetadata();
      if (!mountedRef.current) return;

      // 3. Bootstrap if no models
      if (dbError || !models || models.length === 0) {
        setPhase('syncing');
        const bootstrapped = await bootstrapFromAssetPlus();
        if (bootstrapped.length > 0) {
          models = bootstrapped;
        } else {
          setErrorMsg('No 3D models found for this building. Sync XKT models via Settings → Buildings, or upload an IFC file.');
          setPhase('error');
          return;
        }
        if (!mountedRef.current) return;
      }

      // 4. Load models progressively
      setPhase('loading_models');
      const { loaded, secondaryQueue, chunkModels, hasRealTiles } = await loadAllModels(
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
        if (allIds.length > 0) {
          (window as any).__colorFilterActive = false;
          viewer.scene.setObjectsXRayed(allIds, false);
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
        const nativeColors = new Map<string, { color: number[]; opacity: number; edges: boolean }>();
        if (viewer.scene.objects) {
          for (const objId of allIds) {
            const entity = viewer.scene.objects[objId];
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

        // Apply architect colors + saved theme
        applyArchitectColors(viewer);
        try {
          const savedThemeId = localStorage.getItem('viewer-active-theme-id');
          if (savedThemeId) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('VIEWER_THEME_REQUESTED', { detail: { themeId: savedThemeId } }));
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
        window.dispatchEvent(new CustomEvent('VIEWER_MODELS_LOADED', { detail: { buildingFmGuid } }));

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

        // Instant viewFit (skip in split2d3d mode)
        const isSplit2d3d = new URLSearchParams(window.location.search).get('mode') === 'split2d3d';
        if (!isSplit2d3d) {
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
            window.dispatchEvent(new CustomEvent(INSIGHTS_COLOR_UPDATE_EVENT, { detail: pending }));
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
              applyArchitectColors(viewerRef.current);
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
            }
          } catch {}
        };
        window.dispatchEvent(new CustomEvent('SECONDARY_MODELS_AVAILABLE', {
          detail: { models: secondaryQueue.map(m => ({ model_id: m.model_id, model_name: m.model_name })) }
        }));
      }

      // Deferred staleness check
      deferStalenessCheck(models);

    } catch (e) {
      console.error('[NativeViewer] Init error:', e);
      if (mountedRef.current) {
        setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
        setPhase('error');
      }
    }
  }, [buildingFmGuid, createInstance, fetchModelMetadata, bootstrapFromAssetPlus, loadAllModels, loadSingleModel, deferStalenessCheck, onViewerReady, pendingInsightsColorRef, viewerRef]);

  useEffect(() => {
    initialize();
    return () => { destroy(); };
  }, [initialize, destroy]);

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
