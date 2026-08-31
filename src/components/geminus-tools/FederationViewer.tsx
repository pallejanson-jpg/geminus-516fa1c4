import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Layers, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

/**
 * FederationViewer — Phase 6 of the IFC federation pipeline
 * (docs/plans/ifc-federation-plan.md).
 *
 * A small, self-contained xeokit viewer for the multi-discipline federation
 * workspace — deliberately NOT built as an extension of
 * GeminusPlusViewer.tsx (5,000+ lines, tightly coupled to the single-building
 * production viewer's DOM structure and event bus). Reuses the same xeokit
 * SDK bootstrap technique (`/lib/xeokit/xeokit-sdk.es.js`, `XKTLoaderPlugin`)
 * and the same per-entity `.colorize` / `.xrayed` / `.opacity` API already
 * used throughout `GeminusPlusViewer.tsx`, confirmed against that file.
 *
 * Scope, matching what the plan's Phase 6 goal actually needs (catching
 * *coordinate* misalignment between discipline models) rather than
 * over-building: each discipline loads as its own xeokit model with a
 * distinct colour, and the "focused" model (driven by the reconciliation
 * matrix — hovering/selecting a column) is shown at full opacity while every
 * other model fades. This is MODEL-level linked highlighting, not per-object
 * storey-level highlighting — going further would require mapping each
 * IFC GlobalId to its xeokit object ID, which needs metadata this pipeline
 * doesn't produce yet (see "Not built" below). Model-level is exactly enough
 * to visually confirm "is this discipline's geometry actually aligned with
 * the others", which is the stated purpose.
 *
 * Requires real .xkt files to render anything meaningful — verified in this
 * session that the component mounts, loads the SDK, and reaches the
 * "no models" / "loading" / "error" states correctly; NOT verified against
 * real federation XKT data (none was available in this session — the real
 * IFC test files used elsewhere in this pipeline were never converted to XKT).
 */

const XEOKIT_SDK_PATH = '/lib/xeokit/xeokit-sdk.es.js';

export interface FederationViewerModel {
  modelName: string;
  /** Signed URL or path to the .xkt file for this discipline's model. */
  xktUrl: string;
  /** RGB, 0-1 range, matching the app's existing colorize convention. */
  color: [number, number, number];
}

export interface FederationViewerProps {
  models: FederationViewerModel[];
  /** Model currently in focus (e.g. hovered/selected column in the reconciliation matrix). Others fade. */
  focusedModelName?: string | null;
  className?: string;
}

interface LoadState {
  status: 'idle' | 'loading-sdk' | 'loading-models' | 'ready' | 'error';
  error?: string;
}

function toHex([r, g, b]: [number, number, number]) {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export default function FederationViewer({ models, focusedModelName, className }: FederationViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<any>(null);
  const loadedEntitiesRef = useRef<Map<string, any>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [legendOpen, setLegendOpen] = useState(true);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());

  // ── Bootstrap viewer + load every discipline model once ──────────────────
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
    // Intentionally only re-runs if the set of models changes, not on every
    // focus change — focus is applied via the separate effect below without
    // re-loading geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.map(m => m.xktUrl).join('|')]);

  // ── Apply focus/fade + visibility without reloading models ────────────────
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
    <div className={cn('relative w-full h-full min-h-[400px] bg-[#2d2d2d] rounded-md overflow-hidden', className)}>
      <canvas ref={canvasRef} className="w-full h-full block" />

      {models.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
          Inga modeller att visa ännu.
        </div>
      )}

      {(loadState.status === 'loading-sdk' || loadState.status === 'loading-models') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white text-sm">
          <Spinner className="h-5 w-5" />
          {loadState.status === 'loading-sdk' ? 'Laddar 3D-motor…' : 'Laddar modeller…'}
        </div>
      )}

      {loadState.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-red-300 text-sm px-6 text-center">
          {loadState.error}
        </div>
      )}

      {models.length > 0 && (
        <div className="absolute top-3 right-3 z-20">
          <div className="bg-black/75 backdrop-blur-sm rounded-lg border border-white/10 text-white text-xs overflow-hidden shadow-lg">
            <button
              onClick={() => setLegendOpen(p => !p)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 w-full hover:bg-white/10 transition-colors"
              aria-expanded={legendOpen}
            >
              <Layers className="h-3 w-3 opacity-70" />
              <span className="font-medium">Discipliner</span>
              {legendOpen ? <ChevronUp className="h-3 w-3 ml-auto opacity-60" /> : <ChevronDown className="h-3 w-3 ml-auto opacity-60" />}
            </button>
            {legendOpen && (
              <div className="px-2.5 pb-2 space-y-1">
                {models.map(({ modelName, color }) => {
                  const hidden = hiddenModels.has(modelName);
                  const isFocused = !focusedModelName || focusedModelName === modelName;
                  return (
                    <button
                      key={modelName}
                      onClick={() => toggleModelVisibility(modelName)}
                      className={cn(
                        'flex items-center gap-2 w-full text-left px-1 py-0.5 rounded hover:bg-white/10 transition-colors',
                        !isFocused && !hidden && 'opacity-50',
                      )}
                    >
                      <span
                        className="h-2.5 w-4 rounded-sm shrink-0 border border-white/10"
                        style={{ backgroundColor: toHex(color) }}
                      />
                      <span className="truncate flex-1">{modelName}</span>
                      {hidden ? <EyeOff className="h-3 w-3 opacity-60" /> : <Eye className="h-3 w-3 opacity-60" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
