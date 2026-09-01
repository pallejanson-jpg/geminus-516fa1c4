import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Layers, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import * as WebIFC from 'web-ifc';

/**
 * FederationViewer — loads raw uploaded IFC files directly via xeokit's
 * WebIFCLoaderPlugin (backed by the `web-ifc` WASM module), instead of
 * requiring a pre-converted .xkt file. This trades some load-time
 * performance on very large files (parsing + tessellation happens in the
 * browser, not pre-baked on a server) for skipping the IFC->XKT conversion
 * pipeline entirely — the standalone app has no such pipeline, and building
 * one is a separate, bigger piece of work than just wiring this in.
 *
 * `models[].file` is the same File object the user picked in the upload
 * form (App.tsx) — turned into a blob URL here and fed straight to the
 * loader, so no server round-trip is needed to view a model.
 */

const XEOKIT_SDK_PATH = '/lib/xeokit/xeokit-sdk.es.js';
const WEB_IFC_WASM_PATH = '/lib/xeokit/';

export interface FederationViewerModel {
  modelName: string;
  file: File;
  /** RGB, 0-1 range. */
  color: [number, number, number];
}

export interface FederationViewerProps {
  models: FederationViewerModel[];
  focusedModelName?: string | null;
  /**
   * IFC GlobalIds to highlight (e.g. objects that failed IDS validation).
   * Works because WebIFCLoaderPlugin sets each Entity/MetaObject id directly
   * to the IFC entity's own GlobalId (confirmed in the SDK source), so these
   * values can be passed straight to `viewer.scene.setObjectsHighlighted`.
   */
  highlightedGlobalIds?: Set<string>;
}

interface LoadState {
  status: 'idle' | 'loading-sdk' | 'loading-models' | 'ready' | 'error';
  error?: string;
}

function toHex([r, g, b]: [number, number, number]) {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export default function FederationViewer({ models, focusedModelName, highlightedGlobalIds }: FederationViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<any>(null);
  const loadedEntitiesRef = useRef<Map<string, any>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [legendOpen, setLegendOpen] = useState(true);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const blobUrls: string[] = [];

    async function bootstrap() {
      if (!canvasRef.current || models.length === 0) return;

      setLoadState({ status: 'loading-sdk' });
      let sdk: any;
      let ifcApi: any;
      try {
        if ((window as any).__xeokitSdk) {
          sdk = (window as any).__xeokitSdk;
        } else {
          sdk = await import(/* @vite-ignore */ `${XEOKIT_SDK_PATH}?v=3`);
          (window as any).__xeokitSdk = sdk;
        }
        ifcApi = new WebIFC.IfcAPI();
        ifcApi.SetWasmPath(WEB_IFC_WASM_PATH);
        await ifcApi.Init();
      } catch (err: any) {
        if (!cancelled) setLoadState({ status: 'error', error: `Could not load the 3D engine: ${err?.message ?? err}` });
        return;
      }
      if (cancelled) return;

      const viewer = new sdk.Viewer({
        canvasElement: canvasRef.current,
        transparent: false,
        backgroundColor: [0.176, 0.176, 0.176],
        dtxEnabled: true,
      });
      viewer.camera.eye = [0, 20, 40];
      viewer.camera.look = [0, 0, 0];
      viewer.camera.up = [0, 1, 0];
      viewerRef.current = viewer;

      // WebIFCDefaultDataSource isn't exported by this SDK build, and its
      // default cache-busting (appending `?_=<timestamp>` to every src URL)
      // silently breaks blob: URLs, which don't support query strings --
      // confirmed by a failed XHR (status 0) purely from that suffix. This
      // minimal custom data source just fetches the blob URL as-is.
      const ifcLoader = new sdk.WebIFCLoaderPlugin(viewer, {
        WebIFC,
        IfcAPI: ifcApi,
        dataSource: {
          getIFC(src: string, ok: (buf: ArrayBuffer) => void, error: (msg: any) => void) {
            fetch(src).then(r => r.arrayBuffer()).then(ok).catch(error);
          },
        },
      });

      setLoadState({ status: 'loading-models' });
      try {
        await Promise.all(models.map(({ modelName, file, color }) => {
          const blobUrl = URL.createObjectURL(file);
          blobUrls.push(blobUrl);
          return new Promise<void>((resolve, reject) => {
            const entity = ifcLoader.load({ id: modelName, src: blobUrl, edges: true });
            entity.on('loaded', () => {
              if (cancelled) return resolve();
              entity.colorize = [color[0] * 255, color[1] * 255, color[2] * 255];
              loadedEntitiesRef.current.set(modelName, entity);
              resolve();
            });
            entity.on('error', (msg: string) => reject(new Error(`${modelName}: ${msg}`)));
          });
        }));
        if (!cancelled) {
          viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0 });
          setLoadState({ status: 'ready' });
        }
      } catch (err: any) {
        if (!cancelled) setLoadState({ status: 'error', error: err?.message ?? String(err) });
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      blobUrls.forEach(url => URL.revokeObjectURL(url));
      viewerRef.current?.destroy?.();
      viewerRef.current = null;
      loadedEntitiesRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.map(m => `${m.modelName}:${m.file.name}:${m.file.size}`).join('|')]);

  useEffect(() => {
    for (const [modelName, entity] of loadedEntitiesRef.current) {
      const hidden = hiddenModels.has(modelName);
      entity.visible = !hidden;
      if (hidden) continue;

      const isFocused = !focusedModelName || focusedModelName === modelName;
      entity.xrayed = !isFocused;
      entity.opacity = isFocused ? 1 : 0.25;
    }
  }, [focusedModelName, hiddenModels, loadState.status]);

  // Highlight IDS-validation-failed objects, by IFC GlobalId, once the scene
  // is loaded. Re-applied whenever the failing-id set changes (e.g. after
  // re-running IDS validation) so it always reflects the latest results.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || loadState.status !== 'ready') return;

    viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
    if (!highlightedGlobalIds || highlightedGlobalIds.size === 0) return;

    const existing = new Set(viewer.scene.objectIds as string[]);
    const valid = [...highlightedGlobalIds].filter(id => existing.has(id));
    if (valid.length > 0) viewer.scene.setObjectsHighlighted(valid, true);
  }, [highlightedGlobalIds, loadState.status]);

  const toggleModelVisibility = useCallback((modelName: string) => {
    setHiddenModels(prev => {
      const next = new Set(prev);
      if (next.has(modelName)) next.delete(modelName); else next.add(modelName);
      return next;
    });
  }, []);

  return (
    <div className="viewer-shell">
      <canvas ref={canvasRef} className="viewer-canvas" />

      {models.length === 0 && (
        <div className="viewer-overlay viewer-overlay-muted">
          No models to show yet — upload and analyze at least one IFC file above.
        </div>
      )}

      {(loadState.status === 'loading-sdk' || loadState.status === 'loading-models') && (
        <div className="viewer-overlay viewer-overlay-dark">
          {loadState.status === 'loading-sdk' ? 'Loading 3D engine…' : 'Loading models…'}
        </div>
      )}

      {loadState.status === 'error' && (
        <div className="viewer-overlay viewer-overlay-error">{loadState.error}</div>
      )}

      {models.length > 0 && (
        <div className="viewer-legend">
          <button className="viewer-legend-toggle" onClick={() => setLegendOpen(p => !p)} aria-expanded={legendOpen} type="button">
            <Layers size={12} style={{ opacity: 0.7 }} />
            <span>Disciplines</span>
            {legendOpen ? <ChevronUp size={12} style={{ marginLeft: 'auto', opacity: 0.6 }} /> : <ChevronDown size={12} style={{ marginLeft: 'auto', opacity: 0.6 }} />}
          </button>
          {legendOpen && (
            <div className="viewer-legend-body">
              {models.map(({ modelName, color }) => {
                const hidden = hiddenModels.has(modelName);
                const isFocused = !focusedModelName || focusedModelName === modelName;
                return (
                  <button
                    key={modelName}
                    onClick={() => toggleModelVisibility(modelName)}
                    className="viewer-legend-row"
                    style={{ opacity: !isFocused && !hidden ? 0.5 : 1 }}
                    type="button"
                  >
                    <span className="viewer-legend-swatch" style={{ backgroundColor: toHex(color) }} />
                    <span className="viewer-legend-name">{modelName}</span>
                    {hidden ? <EyeOff size={12} style={{ opacity: 0.6 }} /> : <Eye size={12} style={{ opacity: 0.6 }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
