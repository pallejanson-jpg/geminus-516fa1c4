import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Layers, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';

/**
 * FederationViewer — loads server-converted XKT files via xeokit's
 * XKTLoaderPlugin, instead of parsing raw IFC live in the browser.
 *
 * Earlier versions of this component used WebIFCLoaderPlugin to parse IFC
 * directly client-side, avoiding a conversion step. Reverted (2026-09-08)
 * after direct testing confirmed that approach could hang for 150+ seconds
 * without completing, even on a small (2.2 MB) real file — a genuine,
 * unresolved bug in the web-ifc/xeokit integration, not just "single-
 * threaded parsing is slow" (multi-threading was tried and made it worse:
 * a real version incompatibility between the bundled SDK's web-ifc glue
 * code and the installed web-ifc package). Server-side conversion via
 * @xeokit/xeokit-convert (see ifc-federation/xkt-converter.js) is
 * deterministic (~18s for that same 2.2 MB file) and produces a compact
 * binary that XKTLoaderPlugin loads near-instantly — the same approach
 * the main Geminus app already uses.
 */

const XEOKIT_SDK_PATH = '/lib/xeokit/xeokit-sdk.es.js';

export interface FederationViewerModel {
  modelName: string;
  xktUrl: string;
  /** RGB, 0-1 range. */
  color: [number, number, number];
}

export interface FederationViewerProps {
  models: FederationViewerModel[];
  focusedModelName?: string | null;
  /**
   * IFC GlobalIds to highlight (e.g. objects that failed IDS validation).
   * XKTLoaderPlugin sets each Entity/MetaObject id directly to the IFC
   * entity's own GlobalId (same convention as the earlier WebIFCLoaderPlugin
   * approach), so these values can be passed straight to
   * `viewer.scene.setObjectsHighlighted`.
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

function fromHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Colorize every object belonging to one loaded model, overriding whatever native colour the IFC file's own materials specified. */
function applyModelColor(viewer: any, modelName: string, color: [number, number, number]) {
  const model = viewer.scene.models[modelName];
  if (!model) return;
  const objectIds = Object.keys(model.objects ?? {});
  // setObjectsColorized takes 0-1 multiplicative RGB factors (per the SDK's
  // own doc comment: "multiplied by the rendered pixel colors", default
  // (1,1,1)) -- NOT 0-255. Confirmed by testing: passing *255-scaled values
  // barely changed a yellow model's appearance (values >1 just clamp,
  // leaving the native colour's hue mostly intact) and turned pure red
  // input black (an out-of-range multiplier overflowing/wrapping somewhere
  // in the colour pipeline).
  if (objectIds.length > 0) viewer.scene.setObjectsColorized(objectIds, color);
}

export default function FederationViewer({ models, focusedModelName, highlightedGlobalIds }: FederationViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<any>(null);
  const loadedEntitiesRef = useRef<Map<string, any>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [legendOpen, setLegendOpen] = useState(true);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());
  // Per-model colour, user-overridable from the legend panel -- starts from
  // the `color` prop but can diverge once the user picks their own. Kept in
  // a ref too so the bootstrap effect (which only re-runs when the model
  // list itself changes) can read the latest value without needing
  // colorOverrides in its dependency array.
  const [colorOverrides, setColorOverrides] = useState<Record<string, [number, number, number]>>({});
  const colorOverridesRef = useRef(colorOverrides);
  colorOverridesRef.current = colorOverrides;

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!canvasRef.current || models.length === 0) return;

      setLoadState({ status: 'loading-sdk' });
      let sdk: any;
      try {
        if ((window as any).__xeokitSdk) {
          sdk = (window as any).__xeokitSdk;
        } else {
          sdk = await import(/* @vite-ignore */ `${XEOKIT_SDK_PATH}?v=3`);
          (window as any).__xeokitSdk = sdk;
        }
      } catch (err: any) {
        if (!cancelled) setLoadState({ status: 'error', error: `Could not load the 3D engine: ${err?.message ?? err}` });
        return;
      }
      if (cancelled) return;

      // dtxEnabled (data-texture rendering, a perf optimization) was
      // removed here: with it on, setObjectsColorized silently had no
      // visible effect (confirmed: the architect model rendered its native
      // IFC yellow despite the legend showing the intended muted colour,
      // and re-checking after 'ready' via the recolor effect below still
      // didn't fix it). The main app's own working viewer hook
      // (useFederationViewer.ts) doesn't set dtxEnabled either.
      const viewer = new sdk.Viewer({
        canvasElement: canvasRef.current,
        transparent: false,
        backgroundColor: [0.176, 0.176, 0.176],
      });
      viewer.camera.eye = [0, 20, 40];
      viewer.camera.look = [0, 0, 0];
      viewer.camera.up = [0, 1, 0];
      viewerRef.current = viewer;

      const xktLoader = new sdk.XKTLoaderPlugin(viewer, { reuseGeometries: true });

      setLoadState({ status: 'loading-models' });
      try {
        await Promise.all(models.map(({ modelName, xktUrl, color }) => {
          return new Promise<void>((resolve, reject) => {
            const entity = xktLoader.load({ id: modelName, src: xktUrl, edges: true });
            entity.on('loaded', () => {
              if (cancelled) return resolve();
              applyModelColor(viewer, modelName, colorOverridesRef.current[modelName] ?? color);
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
      viewerRef.current?.destroy?.();
      viewerRef.current = null;
      loadedEntitiesRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.map(m => m.xktUrl).join('|')]);

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

  // Re-colorize already-loaded models when the user picks a new colour from
  // the legend panel.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || loadState.status !== 'ready') return;
    for (const modelName of loadedEntitiesRef.current.keys()) {
      const model = models.find(m => m.modelName === modelName);
      if (model) applyModelColor(viewer, modelName, colorOverrides[modelName] ?? model.color);
    }
  }, [colorOverrides, loadState.status]);

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
          No models converted yet.
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
                const currentColor = colorOverrides[modelName] ?? color;
                return (
                  <div key={modelName} className="viewer-legend-row" style={{ opacity: !isFocused && !hidden ? 0.5 : 1 }}>
                    <input
                      type="color"
                      className="viewer-legend-swatch-input"
                      value={toHex(currentColor)}
                      title={`Change ${modelName}'s colour`}
                      onClick={e => e.stopPropagation()}
                      onChange={e => {
                        const next = fromHex(e.target.value);
                        setColorOverrides(prev => ({ ...prev, [modelName]: next }));
                      }}
                    />
                    <button className="viewer-legend-name-button" onClick={() => toggleModelVisibility(modelName)} type="button">
                      <span className="viewer-legend-name">{modelName}</span>
                      {hidden ? <EyeOff size={12} style={{ opacity: 0.6 }} /> : <Eye size={12} style={{ opacity: 0.6 }} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
