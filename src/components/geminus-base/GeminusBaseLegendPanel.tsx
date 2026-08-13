/**
 * GeminusBaseLegendPanel — replicates the FM Access legend (right-hand panel).
 *
 * Driven by the HDC presentation API (reverse-engineered from FM Access):
 *   GET  /api/presentation/json
 *     → available presentations (Utrymme - Rumsnamn / Rumsfunktion / Golvmaterial,
 *       Hyresobjekt, sensor overlays, Brandceller, ...)
 *   POST /api/presentation/json/{drawingId}/{presentationId}?contextObjects=...
 *     → { filters: [{ id, label, count, summaryValue, toolset.style }], spots: [...] }
 *       filters are the legend rows (label + SVG fill color + count + area m²)
 *
 * drawingId resolution for a floor node:
 *   POST /api/statistics/links/json/9  body [{ classId, objectId, perspectiveId: 8 }]
 *     → defaultObject { classId, objectId }        (the floor's drawing object)
 *   GET  /api/object/list/json/{classId}/{objectId}
 *     → contentId                                   (= drawingId)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Layers, ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LegendPresentation {
  presentationId: number;
  presentationName: string;
  layerId?: number;
  typeName?: string;
  countColumn?: boolean;
  spotAreaColumn?: boolean;
  seq?: number;
}

export interface LegendFilter {
  id: number;
  label: string;
  count?: number;
  summaryValue?: number;
  style?: Record<string, string>;
  spotObjects: Array<{ classId: number; objectId: number }>;
}

interface GeminusBaseLegendPanelProps {
  /** Selected floor (classId 105) — legend needs a drawing context */
  floorNode: { classId: number; objectId: number } | null;
  /** Called when a presentation's filters have loaded (for viewer coloring) */
  onPresentationApplied?: (presentationId: number, filters: LegendFilter[]) => void;
  /** Called when the legend is cleared */
  onCleared?: () => void;
  /** Called when a legend row is clicked (e.g. highlight those rooms) */
  onFilterClicked?: (filter: LegendFilter) => void;
  className?: string;
}

// ── API helpers (via geminus-base-query proxy) ────────────────────────────────

async function proxy(path: string, method = 'GET', body?: object): Promise<any> {
  const { data, error } = await supabase.functions.invoke('geminus-base-query', {
    body: { action: 'proxy', path, method, ...(body ? { body } : {}) },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || `Proxy ${path} failed (${data?.status})`);
  return data.data;
}

async function resolveDrawingId(floor: { classId: number; objectId: number }): Promise<number | null> {
  // Primary: the floor's perspective-9 children include the drawing node with
  // contentType 2 and contentId = drawingId (works even without a default object)
  try {
    const p9 = await proxy(`/api/perspective/json/9/${floor.classId}/${floor.objectId}`);
    const drawing = (p9?.children ?? []).find((c: any) => c.contentType === 2 && c.contentId);
    if (drawing?.contentId) return drawing.contentId;
  } catch { /* fall through */ }

  // Fallback: statistics defaultObject → object metadata → contentId
  const stats = await proxy('/api/statistics/links/json/9', 'POST', [
    { classId: floor.classId, objectId: floor.objectId, perspectiveId: 8 },
  ] as any);
  const def = stats?.defaultObject;
  if (!def?.classId || !def?.objectId) return null;
  const obj = await proxy(`/api/object/list/json/${def.classId}/${def.objectId}`);
  return obj?.contentType === 2 && obj?.contentId ? obj.contentId : null;
}

// ── Component ─────────────────────────────────────────────────────────────────

const GeminusBaseLegendPanel: React.FC<GeminusBaseLegendPanelProps> = ({
  floorNode, onPresentationApplied, onCleared, onFilterClicked, className,
}) => {
  const [presentations, setPresentations] = useState<LegendPresentation[]>([]);
  const [drawingId, setDrawingId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [filters, setFilters] = useState<LegendFilter[]>([]);
  const [loading, setLoading] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  // Load presentation list once
  useEffect(() => {
    proxy('/api/presentation/json')
      .then(d => {
        const list: LegendPresentation[] = d?.list ?? [];
        setPresentations([...list].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)));
      })
      .catch(e => setError(e.message));
  }, []);

  // Resolve drawingId when the floor changes; reset active presentation
  useEffect(() => {
    setDrawingId(null);
    setActiveId(null);
    setFilters([]);
    if (!floorNode) return;
    const seq = ++reqSeq.current;
    resolveDrawingId(floorNode)
      .then(id => { if (reqSeq.current === seq) setDrawingId(id); })
      .catch(() => { if (reqSeq.current === seq) setDrawingId(null); });
  }, [floorNode?.classId, floorNode?.objectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPresentation = useCallback(async (p: LegendPresentation) => {
    if (!drawingId || !floorNode) return;
    if (activeId === p.presentationId) {
      // Toggle off
      setActiveId(null);
      setFilters([]);
      onCleared?.();
      return;
    }
    setLoading(true);
    setError(null);
    setActiveId(p.presentationId);
    try {
      const ctx = `${floorNode.objectId},${floorNode.classId};${floorNode.objectId},${floorNode.classId},S`;
      const d = await proxy(
        `/api/presentation/json/${drawingId}/${p.presentationId}?contextObjects=${encodeURIComponent(ctx)}`,
        'POST',
      );
      const spotsByFilter = new Map<number, Array<{ classId: number; objectId: number }>>();
      for (const s of (d?.spots ?? [])) {
        if (!spotsByFilter.has(s.filterId)) spotsByFilter.set(s.filterId, []);
        spotsByFilter.get(s.filterId)!.push({ classId: s.classId, objectId: s.objectId });
      }
      const rows: LegendFilter[] = (d?.filters ?? []).map((f: any) => ({
        id: f.id,
        label: f.label ?? f.toolset?.objectName ?? String(f.id),
        count: f.count,
        summaryValue: f.summaryValue,
        style: f.toolset?.style ?? f.style,
        spotObjects: spotsByFilter.get(f.id) ?? [],
      }));
      rows.sort((a, b) => a.label.localeCompare(b.label, 'sv'));
      setFilters(rows);
      onPresentationApplied?.(p.presentationId, rows);
    } catch (e: any) {
      setError(e.message);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }, [drawingId, floorNode, activeId, onPresentationApplied, onCleared]);

  const fmtArea = (v?: number) =>
    typeof v === 'number' ? `${v.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} m²` : '';

  if (!floorNode) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-1.5 shrink-0">
          <Layers size={12} className="text-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Legend</span>
        </div>
        <p className="text-xs text-muted-foreground p-3">Select a floor to show the legend.</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-1.5 shrink-0">
        <Layers size={12} className="text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Legend</span>
        {loading && <Loader2 size={11} className="animate-spin text-muted-foreground ml-auto" />}
        {activeId !== null && !loading && (
          <button
            onClick={() => { setActiveId(null); setFilters([]); onCleared?.(); }}
            className="ml-auto text-muted-foreground hover:text-foreground"
            title="Clear legend"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Presentation picker */}
        <button
          onClick={() => setListOpen(o => !o)}
          className="w-full flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent/50"
        >
          {listOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Presentations
        </button>
        {listOpen && (
          <div className="pb-1">
            {presentations.map(p => (
              <button
                key={p.presentationId}
                disabled={!drawingId}
                onClick={() => applyPresentation(p)}
                className={cn(
                  'w-full text-left px-4 py-1 text-xs transition-colors truncate',
                  activeId === p.presentationId
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent disabled:opacity-40',
                )}
                title={p.presentationName}
              >
                {p.presentationName}
              </button>
            ))}
            {presentations.length === 0 && !error && (
              <p className="px-4 py-1 text-xs text-muted-foreground">Loading…</p>
            )}
          </div>
        )}

        {error && <p className="px-3 py-1 text-xs text-destructive">{error}</p>}

        {/* Legend rows */}
        {filters.length > 0 && (
          <div className="border-t border-border mt-1 pt-1">
            {filters.map(f => (
              <button
                key={f.id}
                onClick={() => onFilterClicked?.(f)}
                className="w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent/50 text-left"
              >
                <span
                  className="h-3 w-3 rounded-sm border border-border shrink-0"
                  style={{
                    backgroundColor: f.style?.fill || '#888',
                    opacity: f.style?.['fill-opacity'] ? Math.min(1, parseFloat(f.style['fill-opacity']) + 0.4) : 0.8,
                  }}
                />
                <span className="truncate flex-1" title={f.label}>{f.label}</span>
                {typeof f.count === 'number' && (
                  <span className="text-muted-foreground shrink-0">{f.count}</span>
                )}
                {f.summaryValue !== undefined && (
                  <span className="text-muted-foreground shrink-0 text-[10px]">{fmtArea(f.summaryValue)}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {activeId !== null && !loading && filters.length === 0 && (
          <p className="px-3 py-1 text-xs text-muted-foreground">No data for this presentation on this floor.</p>
        )}
      </div>
    </div>
  );
};

export default GeminusBaseLegendPanel;
