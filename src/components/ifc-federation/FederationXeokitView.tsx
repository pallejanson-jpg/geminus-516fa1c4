/**
 * FederationXeokitView — Fas 6
 *
 * Split-layout 3D viewer for IFC Federation:
 *   Left panel  — canonical storey list; click → highlight storey across all models
 *   Right panel — xeokit canvas with WebIFCLoaderPlugin
 *   Top bar     — per-discipline visibility toggles + reset camera
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff, RotateCcw, Layers3, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useFederationViewer, type FedModel } from '@/hooks/useFederationViewer';
import type { Matrix } from '@/lib/ifc-pipeline';

// ── Discipline colours (CSS, must mirror hook RGB) ────────────────────────────

const DISC_CSS: Record<string, string> = {
  'Arkitektur':   'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  'El':           'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  'VS (Rör)':     'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'Luft/HVAC':    'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  'Kyla':         'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  'Brand':        'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  'Automation':   'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  'Konstruktion': 'bg-stone-100 text-stone-800 dark:bg-stone-900/40 dark:text-stone-300',
  'Okänd':        'bg-muted text-muted-foreground',
};

interface Props {
  models: { file: File; modelName: string; discipline: string }[];
  matrix: Matrix;
  onBack: () => void;
}

export default function FederationXeokitView({ models, matrix, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { state, loadModels, highlightStorey, clearHighlight, setModelVisible, selectedStoreyName } =
    useFederationViewer(canvasRef);

  // Per-discipline visibility state (keyed by modelId)
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(models.map((_, i) => [`model_${i}`, true]))
  );

  // Build FedModel list once
  const fedModels: FedModel[] = models.map((m, i) => ({
    modelId: `model_${i}`,
    modelName: m.modelName,
    discipline: m.discipline,
    file: m.file,
  }));

  // Kick off loading on mount
  useEffect(() => {
    if (fedModels.length > 0) loadModels(fedModels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleVisibility = useCallback((modelId: string) => {
    setVisible(prev => {
      const next = { ...prev, [modelId]: !prev[modelId] };
      setModelVisible(modelId, next[modelId]);
      return next;
    });
  }, [setModelVisible]);

  const handleStoreyClick = useCallback((name: string | null) => {
    if (name && name === selectedStoreyName) {
      clearHighlight();
    } else {
      highlightStorey(name);
    }
  }, [highlightStorey, clearHighlight, selectedStoreyName]);

  // Unique canonical storeys from matrix
  const canonicalStoreys = matrix.canonicalStoreys;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background z-10 flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 h-8 text-xs">
          <ChevronLeft className="h-3.5 w-3.5" />
          Matrisen
        </Button>
        <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Layers3 className="h-4 w-4 text-accent" />
          3D Federation
        </span>
        <div className="flex-1" />

        {/* Per-discipline toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {fedModels.map(m => (
            <button
              key={m.modelId}
              onClick={() => toggleVisibility(m.modelId)}
              className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border transition-opacity
                ${visible[m.modelId] ? '' : 'opacity-40'}
                ${DISC_CSS[m.discipline] ?? DISC_CSS['Okänd']}`}
              title={`Visa/dölj: ${m.modelName}`}
            >
              {visible[m.modelId]
                ? <Eye className="h-3 w-3 flex-shrink-0" />
                : <EyeOff className="h-3 w-3 flex-shrink-0" />}
              {m.modelName.replace(/\.ifc$/i, '')}
            </button>
          ))}
        </div>

        <Button
          variant="ghost" size="sm"
          onClick={clearHighlight}
          disabled={!selectedStoreyName}
          className="gap-1.5 h-8 text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Återställ
        </Button>
      </div>

      {/* Body: left panel + canvas */}
      <div className="flex flex-1 min-h-0">
        {/* Storey panel */}
        <div className="w-56 flex-shrink-0 border-r border-border overflow-y-auto bg-card">
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Kanoniska våningar
            </p>
            {state.status === 'ready' && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Klicka för att markera
              </p>
            )}
          </div>
          <div className="flex flex-col">
            {canonicalStoreys.map((cs) => {
              const isSelected = selectedStoreyName === cs.name;
              return (
                <button
                  key={cs.fmguid}
                  onClick={() => handleStoreyClick(cs.name)}
                  disabled={state.status !== 'ready'}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-border/50 transition-colors
                    ${isSelected
                      ? 'bg-accent/15 text-accent font-semibold'
                      : 'text-foreground hover:bg-muted/40'}`}
                >
                  {cs.name ?? (
                    <span className="text-muted-foreground italic text-xs">namnlös</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Canvas area */}
        <div className="flex-1 relative min-w-0">
          {/* Loading overlay */}
          {(state.status === 'init' || state.status === 'loading') && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 gap-3 pointer-events-none">
              <Spinner size="lg" />
              <p className="text-sm text-muted-foreground">
                {state.status === 'init'
                  ? 'Startar xeokit…'
                  : `Laddar modell ${state.loadedCount + 1} / ${state.totalCount}…`}
              </p>
            </div>
          )}

          {state.status === 'error' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <p className="text-sm text-destructive">{state.error}</p>
            </div>
          )}

          <canvas
            ref={canvasRef}
            className="w-full h-full block"
            style={{ display: 'block' }}
          />
        </div>
      </div>
    </div>
  );
}
