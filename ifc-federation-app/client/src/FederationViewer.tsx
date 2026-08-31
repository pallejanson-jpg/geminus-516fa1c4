import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Layers, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';

/**
 * FederationViewer — ported from the main Geminus app's
 * src/components/geminus-tools/FederationViewer.tsx (Phase 6 of
 * docs/plans/ifc-federation-plan.md), rewritten against this app's plain
 * CSS instead of Tailwind/shadcn so it has no dependency on the main app's
 * design system. Behavior is otherwise identical — same xeokit SDK
 * bootstrap, same per-entity `.colorize`/`.xrayed`/`.opacity` API, same
 * model-level (not per-object) focus/fade linked to the matrix.
 *
 * Requires real .xkt files to show anything. This app has no IFC->XKT
 * conversion step yet (the main Geminus app has one, `ifc-to-xkt`, as a
 * Supabase edge function) — until that's wired in here too, `models` will
 * be empty and this renders its "no models yet" placeholder. Porting the
 * viewer and porting the conversion pipeline are two separate pieces of
 * work; this is only the former.
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
}

interface LoadState {
  status: 'idle' | 'loading-sdk' | 'loading-models' | 'ready' | 'error';
  error?: string;
}

function toHex([r, g, b]: [number, number, number]) {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export default function FederationViewer({ models, focusedModelName }: FederationViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<any>(null);
  const loadedEntitiesRef = useRef<Map<string, any>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [legendOpen, setLegendOpen] = useState(true);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());

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
        if (!cancelled) setLoadState({ status: 'error', error: `Kunde inte ladda xeokit-SDK: ${err?.message ?? err}` });
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

      const xktLoader = new sdk.XKTLoaderPlugin(viewer, { reuseGeometries: true });

      setLoadState({ status: 'loading-models' });
      try {
        await Promise.all(models.map(({ modelName, xktUrl, color }) =>
          new Promise<void>((resolve, reject) => {
            const entity = xktLoader.load({ id: modelName, src: xktUrl, edges: true });
            entity.on('loaded', () => {
              if (cancelled) return resolve();
              entity.colorize = [color[0] * 255, color[1] * 255, color[2] * 255];
              loadedEntitiesRef.current.set(modelName, entity);
              resolve();
            });
            entity.on('error', (msg: string) => reject(new Error(`${modelName}: ${msg}`)));
          })
        ));
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
          No models to show yet — requires converted .xkt files (see README).
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
            <span>Discipliner</span>
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
