import React, { useState, useCallback, useRef } from 'react';
import {
  Upload, FileText, X, ChevronRight, AlertTriangle,
  CheckCircle2, Wrench, Download, RotateCcw, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  buildCanonicalStoreys,
  buildMatrix,
  applyReconciliation,
  validateFederation,
  repairFederation,
  type Matrix,
  type ValidationResult,
  type WriteItem,
  type CanonicalStorey,
} from '@/lib/ifc-pipeline';

// ── Types ────────────────────────────────────────────────────────────────────

interface LoadedModel {
  file: File;
  modelName: string;
  discipline: string;
  ifcText: string;
}

const DISCIPLINE_PATTERNS: [RegExp, string][] = [
  [/\b(ARK|ARCH|ARCHITECT)\b/i,           'Arkitektur'],
  [/\b(EL|ELEC|ELECTRICAL)\b/i,           'El'],
  [/\bVS\b/i,                              'VS (Rör)'],
  [/\b(LUF|HVAC|VENT)\b/i,                'Luft/HVAC'],
  [/\bKYL\b/i,                             'Kyla'],
  [/\b(BRAND|FIRE|SPRINKLER|SP)\b/i,      'Brand'],
  [/\bAUTO\b/i,                            'Automation'],
  [/\b(STRUCT|KONSTRUK|KONSTRUKSJON)\b/i, 'Konstruktion'],
];

function detectDiscipline(name: string): string {
  const normalized = name.replace(/[_\-.]/g, ' ').toUpperCase();
  for (const [re, label] of DISCIPLINE_PATTERNS) {
    if (re.test(normalized)) return label;
  }
  return 'Okänd';
}

const DISCIPLINE_COLORS: Record<string, string> = {
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

type Step = 'upload' | 'processing' | 'matrix';

// ── Upload step ───────────────────────────────────────────────────────────────

function UploadStep({
  models, onAdd, onRemove, architectIndex, onArchitectChange, onRun,
}: {
  models: LoadedModel[];
  onAdd: (files: FileList) => void;
  onRemove: (i: number) => void;
  architectIndex: number;
  onArchitectChange: (i: number) => void;
  onRun: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) onAdd(e.dataTransfer.files);
  }, [onAdd]);

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto py-10 px-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">IFC Federation</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ladda upp disciplinmodeller, granska storey-matchningar och validera FMGUID-integritet.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
          ${dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/60 hover:bg-muted/30'}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
      >
        <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">Dra och släpp IFC-filer hit</p>
        <p className="text-xs text-muted-foreground mt-1">eller klicka för att bläddra — flera filer stöds</p>
        <input
          ref={inputRef}
          type="file"
          accept=".ifc"
          multiple
          className="hidden"
          onChange={e => e.target.files && onAdd(e.target.files)}
        />
      </div>

      {/* File list */}
      {models.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {models.length} fil{models.length !== 1 ? 'er' : ''} laddad{models.length !== 1 ? 'e' : ''}
          </p>
          {models.map((m, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-3 py-2 rounded-md border transition-colors
                ${architectIndex === i ? 'border-accent bg-accent/5' : 'border-border bg-card'}`}
            >
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{m.modelName}</p>
                <p className="text-xs text-muted-foreground">{(m.file.size / 1024).toFixed(0)} KB</p>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DISCIPLINE_COLORS[m.discipline] ?? DISCIPLINE_COLORS['Okänd']}`}>
                {m.discipline}
              </span>
              <button
                className={`text-xs px-2 py-0.5 rounded border transition-colors flex-shrink-0
                  ${architectIndex === i
                    ? 'border-accent text-accent font-semibold'
                    : 'border-border text-muted-foreground hover:border-accent hover:text-accent'}`}
                onClick={e => { e.stopPropagation(); onArchitectChange(i); }}
                title="Markera som arkitektmodell (canonical källa)"
              >
                {architectIndex === i ? '★ Arkitekt' : 'Arkitekt?'}
              </button>
              <button
                className="text-muted-foreground hover:text-destructive transition-colors"
                onClick={e => { e.stopPropagation(); onRemove(i); }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}

          <div className="flex items-start gap-2 mt-1 text-xs text-muted-foreground bg-muted/30 rounded p-2">
            <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              Arkitektmodellen används som canonical källa för våningsnamn och FMGUIDs om byggnaden saknas i Geminus Plus.
            </span>
          </div>
        </div>
      )}

      <Button
        disabled={models.length === 0}
        onClick={onRun}
        className="self-start gap-2"
      >
        Kör pipeline <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ── Reconciliation matrix ─────────────────────────────────────────────────────

const CONFIDENCE_STYLES = {
  'fmguid-match': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  'name-match':   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
} as const;

function MatrixTable({
  matrix, overrides, onOverride,
}: {
  matrix: Matrix;
  overrides: Record<string, Record<string, string | null>>;
  onOverride: (modelName: string, globalId: string, fmguid: string | null) => void;
}) {
  const options: { value: string; label: string }[] = [
    { value: '__none__', label: '— ta bort mappning —' },
    ...matrix.canonicalStoreys.map(c => ({
      value: c.fmguid,
      label: c.name ?? `(namnlös: ${c.fmguid.slice(0, 8)}…)`,
    })),
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted/50">
            <th className="sticky left-0 z-10 bg-muted/80 px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap border-b border-border">
              Kanonisk våning
            </th>
            {matrix.models.map(m => (
              <th key={m} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap border-b border-border min-w-[180px]">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row, ri) => (
            <tr key={row.canonical.fmguid} className={ri % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
              <td className="sticky left-0 z-10 px-4 py-2.5 border-b border-border font-medium text-foreground whitespace-nowrap"
                  style={{ backgroundColor: ri % 2 === 0 ? 'hsl(var(--background))' : undefined }}>
                {row.canonical.name
                  ? row.canonical.name
                  : <span className="text-muted-foreground italic">namnlös — behöver namn</span>}
              </td>
              {matrix.models.map(modelName => {
                const cell = row.cells[modelName];
                const override = overrides[modelName]?.[cell?.modelStorey.globalId ?? ''];
                const effectiveFmguid = override !== undefined ? override : cell?.suggestedCanonicalFmguid;
                const confidence = cell?.confidence;

                return (
                  <td key={modelName} className="px-3 py-2 border-b border-border">
                    {cell ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-foreground text-sm truncate max-w-[120px]" title={cell.modelStorey.name}>
                            {cell.modelStorey.name || <span className="text-muted-foreground italic">namnlös</span>}
                          </span>
                          {confidence && (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${CONFIDENCE_STYLES[confidence]}`}>
                              {confidence === 'fmguid-match' ? 'FMGUID' : 'namn'}
                            </span>
                          )}
                        </div>
                        <Select
                          value={effectiveFmguid ?? '__none__'}
                          onValueChange={v => onOverride(modelName, cell.modelStorey.globalId, v === '__none__' ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-xs w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map(opt => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Unmatched section ─────────────────────────────────────────────────────────

function UnmatchedSection({
  matrix, canonicalStoreys, onMap,
}: {
  matrix: Matrix;
  canonicalStoreys: CanonicalStorey[];
  onMap: (modelName: string, globalId: string, fmguid: string | null) => void;
}) {
  if (matrix.unmatched.length === 0) return null;

  const options = [
    { value: '__none__', label: '— ta bort mappning —' },
    ...canonicalStoreys.map(c => ({
      value: c.fmguid,
      label: c.name ?? `(namnlös: ${c.fmguid.slice(0, 8)}…)`,
    })),
  ];

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <h3 className="text-sm font-semibold text-foreground">
          {matrix.unmatched.length} omatchad{matrix.unmatched.length !== 1 ? 'e' : ''} våning{matrix.unmatched.length !== 1 ? 'ar' : ''}
        </h3>
        <span className="text-xs text-muted-foreground">— kräver manuell mappning</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {matrix.unmatched.map((u, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2 bg-warning/5 border border-warning/20 rounded-md">
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground truncate block">{u.modelStorey.name || '(namnlös)'}</span>
              <span className="text-xs text-muted-foreground">{u.modelName}</span>
            </div>
            <Select
              defaultValue="__none__"
              onValueChange={v => onMap(u.modelName, u.modelStorey.globalId, v === '__none__' ? null : v)}
            >
              <SelectTrigger className="h-7 text-xs w-52">
                <SelectValue placeholder="Välj kanonisk våning…" />
              </SelectTrigger>
              <SelectContent>
                {options.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FMGUID validation panel ───────────────────────────────────────────────────

function ValidationPanel({
  validation, onRepair,
}: {
  validation: ValidationResult;
  onRepair: () => void;
}) {
  const { stats, duplicates } = validation;
  const hasIssues = stats.missing > 0 || stats.duplicateGroups > 0;

  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          {hasIssues
            ? <AlertTriangle className="h-4 w-4 text-warning" />
            : <CheckCircle2 className="h-4 w-4 text-success" />}
          FMGUID-validering
        </h3>
        {hasIssues && (
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={onRepair}>
            <Wrench className="h-3.5 w-3.5" /> Auto-reparera
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Element totalt', value: stats.totalElements },
          { label: 'Saknar FMGUID', value: stats.missing, warn: stats.missing > 0 },
          { label: 'Dubbletter (grupper)', value: stats.duplicateGroups, warn: stats.duplicateGroups > 0 },
        ].map(({ label, value, warn }) => (
          <div key={label} className="bg-muted/30 rounded p-2.5">
            <p className={`text-lg font-semibold tabular-nums ${warn ? 'text-warning' : 'text-foreground'}`}>{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {duplicates.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dubbletter</p>
          {duplicates.map(dup => (
            <div key={dup.fmguid} className="bg-destructive/5 border border-destructive/20 rounded p-2.5 text-xs">
              <p className="font-mono text-muted-foreground mb-1">{dup.fmguid}</p>
              {dup.locations.map((loc, i) => (
                <p key={i} className="text-foreground">
                  {loc.modelName} · {loc.ifcType} <span className="text-muted-foreground">"{loc.name}"</span>
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {!hasIssues && (
        <p className="text-xs text-success">Alla {stats.totalElements} element har unika FMGUIDs — inga problem hittades.</p>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function IfcFederationView() {
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('upload');
  const [models, setModels] = useState<LoadedModel[]>([]);
  const [architectIndex, setArchitectIndex] = useState(0);

  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Record<string, string | null>>>({});

  const handleAddFiles = useCallback(async (files: FileList) => {
    const loaded: LoadedModel[] = [];
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith('.ifc')) continue;
      const ifcText = await file.text();
      loaded.push({
        file,
        modelName: file.name,
        discipline: detectDiscipline(file.name),
        ifcText,
      });
    }
    if (!loaded.length) {
      toast({ title: 'Inga IFC-filer hittades', variant: 'destructive' });
      return;
    }
    setModels(prev => {
      const existing = new Set(prev.map(m => m.modelName));
      return [...prev, ...loaded.filter(l => !existing.has(l.modelName))];
    });
  }, [toast]);

  const handleRemove = useCallback((i: number) => {
    setModels(prev => {
      const next = prev.filter((_, idx) => idx !== i);
      return next;
    });
    setArchitectIndex(prev => (prev >= i && prev > 0 ? prev - 1 : prev));
  }, []);

  const handleRun = useCallback(async () => {
    if (!models.length) return;
    setStep('processing');
    setOverrides({});

    try {
      await new Promise(r => setTimeout(r, 0)); // yield to render spinner

      const archModel = models[architectIndex];
      const canonicalStoreys = buildCanonicalStoreys(archModel.ifcText);

      const modelInputs = models.map(m => ({ modelName: m.modelName, ifcText: m.ifcText }));
      const mat = buildMatrix(canonicalStoreys, modelInputs);
      const val = validateFederation(modelInputs);

      setMatrix(mat);
      setValidation(val);
      setStep('matrix');

      const issues = [];
      if (mat.unmatched.length) issues.push(`${mat.unmatched.length} omatchade våningar`);
      if (val.stats.duplicateGroups) issues.push(`${val.stats.duplicateGroups} FMGUID-dubbletter`);
      if (val.stats.missing) issues.push(`${val.stats.missing} element saknar FMGUID`);

      if (issues.length) {
        toast({ title: 'Pipeline klar — åtgärder krävs', description: issues.join(' · '), variant: 'destructive' });
      } else {
        toast({ title: 'Pipeline klar', description: 'Alla storeys matchade, inga FMGUID-problem.' });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Pipeline misslyckades', description: String(err), variant: 'destructive' });
      setStep('upload');
    }
  }, [models, architectIndex, toast]);

  const handleOverride = useCallback((modelName: string, globalId: string, fmguid: string | null) => {
    setOverrides(prev => ({
      ...prev,
      [modelName]: { ...(prev[modelName] ?? {}), [globalId]: fmguid },
    }));
  }, []);

  const handleRepair = useCallback(() => {
    if (!validation) return;
    repairFederation(validation);
    setValidation({ ...validation });
    toast({ title: 'FMGUID-reparation klar', description: 'Saknade och duplicerade FMGUIDs har åtgärdats i minnet.' });
  }, [validation, toast]);

  const handleConfirm = useCallback(() => {
    if (!matrix) return;
    const writes: WriteItem[] = applyReconciliation(matrix, overrides);
    const json = JSON.stringify(writes, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ifc-federation-writeback.json';
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: 'Exporterat',
      description: `${writes.length} storey-mappningar exporterade. Redo för Phase 7 write-back.`,
    });
  }, [matrix, overrides, toast]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (step === 'processing') {
    return (
      <div className="flex flex-col min-h-full bg-background items-center justify-center gap-4">
        <Spinner size="lg" />
        <p className="text-sm text-muted-foreground">Parsar {models.length} IFC-fil{models.length !== 1 ? 'er' : ''}…</p>
      </div>
    );
  }

  if (step === 'upload' || !matrix || !validation) {
    return (
      <div className="flex flex-col min-h-full bg-background overflow-y-auto">
        <UploadStep
          models={models}
          onAdd={handleAddFiles}
          onRemove={handleRemove}
          architectIndex={architectIndex}
          onArchitectChange={setArchitectIndex}
          onRun={handleRun}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-foreground">IFC Federation</h1>
          <div className="flex items-center gap-1.5">
            {matrix.models.map(m => {
              const disc = models.find(md => md.modelName === m)?.discipline ?? 'Okänd';
              return (
                <span key={m} className={`text-xs font-medium px-2 py-0.5 rounded-full ${DISCIPLINE_COLORS[disc] ?? DISCIPLINE_COLORS['Okänd']}`}>
                  {m.replace(/\.ifc$/i, '')}
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setStep('upload'); setMatrix(null); setValidation(null); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Börja om
          </Button>
          <Button size="sm" className="gap-1.5" onClick={handleConfirm}>
            <Download className="h-3.5 w-3.5" /> Bekräfta & exportera
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 flex flex-col gap-6">
        {/* Summary chips */}
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="outline" className="gap-1.5">
            <span className="text-muted-foreground">Kanonisk källa:</span>
            <span className="font-medium">Arkitektmodell ({matrix.canonicalStoreys.length} våningar)</span>
          </Badge>
          {matrix.unmatched.length === 0
            ? <Badge className="bg-success/15 text-success border-success/20"><CheckCircle2 className="h-3 w-3 mr-1" />Alla storeys matchade</Badge>
            : <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20"><AlertTriangle className="h-3 w-3 mr-1" />{matrix.unmatched.length} omatchade</Badge>
          }
          {validation.stats.duplicateGroups === 0 && validation.stats.missing === 0
            ? <Badge className="bg-success/15 text-success border-success/20"><CheckCircle2 className="h-3 w-3 mr-1" />FMGUID OK</Badge>
            : <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20"><AlertTriangle className="h-3 w-3 mr-1" />FMGUID-problem</Badge>
          }
        </div>

        {/* Two-column layout: matrix left, validation right */}
        <div className="flex gap-6 items-start">
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-foreground">Reconciliation Matrix</h2>
            <MatrixTable matrix={matrix} overrides={overrides} onOverride={handleOverride} />
            <UnmatchedSection matrix={matrix} canonicalStoreys={matrix.canonicalStoreys} onMap={handleOverride} />
          </div>

          <div className="w-80 flex-shrink-0">
            <h2 className="text-sm font-semibold text-foreground mb-3">FMGUID-validering</h2>
            <ValidationPanel validation={validation} onRepair={handleRepair} />
          </div>
        </div>
      </div>
    </div>
  );
}
