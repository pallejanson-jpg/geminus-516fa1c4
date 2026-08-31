import React, { useMemo, useState } from 'react';
import { Check, HelpCircle, Pencil, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';

// ─── Types ──────────────────────────────────────────────────────────────────
// Mirrors the plain-data shape produced by ifc-federation/storey-reconciliation.js
// (buildMatrix / applyReconciliation). Parsing runs server-side (Node); this
// component only renders and edits the already-computed matrix.

export interface CanonicalStorey {
  fmguid: string;
  name: string | null;
  sequence: number | null;
}

export interface ModelStorey {
  fmguid: string | null;
  name: string | null;
  globalId: string;
  lineId: string;
}

export type MatchConfidence = 'fmguid-match' | 'name-match';

export interface MatrixCell {
  modelStorey: ModelStorey;
  suggestedCanonicalFmguid: string;
  confidence: MatchConfidence;
}

export interface MatrixRow {
  canonical: CanonicalStorey;
  cells: Record<string, MatrixCell | undefined>;
}

export interface UnmatchedEntry {
  modelName: string;
  modelStorey: ModelStorey;
}

export interface ReconciliationMatrix {
  canonicalStoreys: CanonicalStorey[];
  models: string[];
  rows: MatrixRow[];
  unmatched: UnmatchedEntry[];
}

/** modelName -> modelStorey.globalId -> canonicalFmguid | null (unmapped) */
export type Overrides = Record<string, Record<string, string | null>>;

export interface StoreyReconciliationMatrixProps {
  matrix: ReconciliationMatrix;
  /** Called when the user edits a canonical storey's display name inline. */
  onCanonicalNameChange?: (fmguid: string, newName: string) => void;
  /** Called with the accumulated overrides once the user confirms the mapping. */
  onConfirm: (overrides: Overrides) => void;
  confirming?: boolean;
  /** Called on hover-enter/leave of a model's column header — lets a linked
   *  viewer (Phase 6's FederationViewer) fade in/out that discipline. Passes
   *  `null` on leave. */
  onModelHover?: (modelName: string | null) => void;
}

const UNMAPPED = '__unmapped__';

function ConfidenceBadge({ confidence }: { confidence: MatchConfidence }) {
  if (confidence === 'fmguid-match') {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px]">
        <Check className="h-3 w-3" /> FMGUID
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
      <HelpCircle className="h-3 w-3" /> Namnlikhet
    </Badge>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function StoreyReconciliationMatrix({
  matrix,
  onCanonicalNameChange,
  onConfirm,
  confirming = false,
  onModelHover,
}: StoreyReconciliationMatrixProps) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [editingFmguid, setEditingFmguid] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  // Cell -> selected canonical fmguid, taking any override into account.
  const effectiveTarget = (modelName: string, cell: MatrixCell | undefined): string => {
    const override = overrides[modelName]?.[cell?.modelStorey.globalId ?? ''];
    if (override !== undefined) return override ?? UNMAPPED;
    return cell?.suggestedCanonicalFmguid ?? UNMAPPED;
  };

  const setOverride = (modelName: string, globalId: string, canonicalFmguid: string | null) => {
    setOverrides(prev => ({
      ...prev,
      [modelName]: { ...prev[modelName], [globalId]: canonicalFmguid },
    }));
  };

  const startEditingName = (row: MatrixRow) => {
    setEditingFmguid(row.canonical.fmguid);
    setNameDraft(row.canonical.name ?? '');
  };

  const commitName = (fmguid: string) => {
    const trimmed = nameDraft.trim();
    if (trimmed) onCanonicalNameChange?.(fmguid, trimmed);
    setEditingFmguid(null);
  };

  const canonicalOptions = matrix.canonicalStoreys;

  const totalMapped = useMemo(() => {
    let count = 0;
    for (const row of matrix.rows) {
      for (const modelName of matrix.models) {
        const cell = row.cells[modelName];
        if (cell && effectiveTarget(modelName, cell) !== UNMAPPED) count++;
      }
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, overrides]);

  const hasUnnamedCanonical = matrix.rows.some(r => !r.canonical.name);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Våningsmatchning</h3>
          <p className="text-xs text-muted-foreground">
            Bekräfta vilken våning i varje disciplinmodell som motsvarar varje kanonisk våning.
            Förslag är automatiska (FMGUID i första hand, namnlikhet i andra) men aldrig tillämpade förrän du bekräftar.
          </p>
        </div>
        <Button size="sm" onClick={() => onConfirm(overrides)} disabled={confirming}>
          {confirming ? 'Sparar…' : `Bekräfta mappning (${totalMapped})`}
        </Button>
      </div>

      {hasUnnamedCanonical && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            En eller flera kanoniska våningar saknar namn i Geminus Plus. Detta är inte ett fel i uppladdningen —
            källdatan saknar namnet. Skriv in ett namn direkt i tabellen för att åtgärda.
          </span>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[180px]">Kanonisk våning</TableHead>
              {matrix.models.map(modelName => (
                <TableHead
                  key={modelName}
                  className="min-w-[220px]"
                  onMouseEnter={() => onModelHover?.(modelName)}
                  onMouseLeave={() => onModelHover?.(null)}
                >
                  {modelName}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrix.rows.map(row => (
              <TableRow key={row.canonical.fmguid}>
                <TableCell>
                  {editingFmguid === row.canonical.fmguid ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={nameDraft}
                        onChange={e => setNameDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitName(row.canonical.fmguid);
                          if (e.key === 'Escape') setEditingFmguid(null);
                        }}
                        className="h-8 text-sm"
                      />
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => commitName(row.canonical.fmguid)}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditingName(row)}
                      className="group flex items-center gap-1.5 text-left"
                      title="Klicka för att redigera namn"
                    >
                      {row.canonical.name ? (
                        <span className="font-medium text-sm">{row.canonical.name}</span>
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">Namnlös — behöver namn</Badge>
                      )}
                      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </button>
                  )}
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {row.canonical.fmguid}
                  </div>
                </TableCell>

                {matrix.models.map(modelName => {
                  const cell = row.cells[modelName];
                  const target = effectiveTarget(modelName, cell);
                  const isOverridden = cell
                    ? overrides[modelName]?.[cell.modelStorey.globalId] !== undefined
                    : false;

                  if (!cell) {
                    return (
                      <TableCell key={modelName} className="text-xs text-muted-foreground italic">
                        (ingen våning i denna modell matchar ännu)
                      </TableCell>
                    );
                  }

                  return (
                    <TableCell key={modelName}>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{cell.modelStorey.name ?? <em className="text-muted-foreground">(namnlös)</em>}</span>
                          {!isOverridden && <ConfidenceBadge confidence={cell.confidence} />}
                          {isOverridden && <Badge className="text-[10px]">Manuellt vald</Badge>}
                        </div>
                        <Select
                          value={target}
                          onValueChange={value =>
                            setOverride(modelName, cell.modelStorey.globalId, value === UNMAPPED ? null : value)
                          }
                        >
                          <SelectTrigger className="h-7 text-xs w-full max-w-[220px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNMAPPED}>— Ingen matchning —</SelectItem>
                            {canonicalOptions.map(c => (
                              <SelectItem key={c.fmguid} value={c.fmguid}>
                                {c.name ?? '(namnlös kanonisk våning)'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {matrix.unmatched.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">
            Omatchade våningar ({matrix.unmatched.length}) — tilldela manuellt
          </h4>
          <div className="rounded-md border divide-y">
            {matrix.unmatched.map((u, i) => {
              const key = `${u.modelName}:${u.modelStorey.globalId}`;
              const target = overrides[u.modelName]?.[u.modelStorey.globalId] ?? UNMAPPED;
              return (
                <div key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">{u.modelName}:</span>{' '}
                    {u.modelStorey.name ?? <em className="text-muted-foreground">(namnlös)</em>}
                  </div>
                  <Select
                    value={target}
                    onValueChange={value =>
                      setOverride(u.modelName, u.modelStorey.globalId, value === UNMAPPED ? null : value)
                    }
                  >
                    <SelectTrigger className="h-7 text-xs w-[220px]">
                      <SelectValue placeholder="Välj kanonisk våning…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNMAPPED}>— Ingen matchning —</SelectItem>
                      {canonicalOptions.map(c => (
                        <SelectItem key={c.fmguid} value={c.fmguid}>
                          {c.name ?? '(namnlös kanonisk våning)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
