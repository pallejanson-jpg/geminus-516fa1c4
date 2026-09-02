import React, { useState, useEffect } from 'react';
import FederationViewer, { FederationViewerModel } from './FederationViewer';
import IdsRuleEditor from './IdsRuleEditor';
import SyncTab from './SyncTab';

interface DisciplineRow {
  id: number;
  name: string;
  file: File | null;
}

interface CanonicalStorey {
  fmguid: string;
  name: string | null;
  sequence: number | null;
}

interface ModelStorey {
  fmguid: string | null;
  name: string | null;
  globalId: string;
  lineId: string;
}

interface MatrixCell {
  modelStorey: ModelStorey;
  suggestedCanonicalFmguid: string;
  confidence: 'fmguid-match' | 'name-match';
}

interface MatrixRow {
  canonical: CanonicalStorey;
  cells: Record<string, MatrixCell | undefined>;
}

interface UnmatchedEntry {
  modelName: string;
  modelStorey: ModelStorey;
}

interface Matrix {
  canonicalStoreys: CanonicalStorey[];
  models: string[];
  rows: MatrixRow[];
  unmatched: UnmatchedEntry[];
}

interface CategoryCount {
  ifcType: string;
  total: number;
  withFmguid: number;
  missing: number;
}

interface IngestResult {
  sessionId: string;
  canonicalSource: 'geminus-plus' | 'architect-model';
  building: { fmguid: string; name: string | null } | null;
  buildingLookupWarning: string | null;
  canonicalStoreys: CanonicalStorey[];
  matrix: Matrix;
  guidValidation: {
    stats: { totalElements: number; storeyElements: number; hadFmguid: number; missing: number; duplicateGroups: number; duplicateElements: number };
    duplicates: Array<{ fmguid: string; locations: Array<{ modelName: string; ifcType: string; globalId: string; name: string | null }> }>;
    categories: CategoryCount[];
  };
}

type Overrides = Record<string, Record<string, string | null>>;

interface IdsFailedEntity {
  class: string;
  name: string | null;
  global_id: string;
  reason?: string;
}
interface IdsRequirementResult {
  description?: string;
  failed_entities?: IdsFailedEntity[];
}
interface IdsSpecResult {
  name: string;
  status: boolean;
  total_applicable: number;
  total_applicable_pass: number;
  total_applicable_fail: number;
  requirements?: IdsRequirementResult[];
}
interface IdsRuleResult {
  ruleId: string;
  ruleTitle: string;
  report: { specifications: IdsSpecResult[] } | null;
  error?: string;
}
type IdsResults = Record<string, IdsRuleResult[]>; // modelName -> rule results

const UNMAPPED = '__unmapped__';
let rowId = 0;

interface BuildingCheckResult {
  found: boolean;
  building?: { fmguid: string; name: string | null };
  storeys?: CanonicalStorey[];
}

interface BuildingOption {
  fmguid: string;
  name: string | null;
}

const NEW_BUILDING = '__new__';

type TabId = 'upload' | 'match' | 'fmguid' | 'ids' | 'viewer' | 'rules' | 'sync';
const TABS: { id: TabId; label: string }[] = [
  { id: 'upload', label: '1. Upload & analyze' },
  { id: 'match', label: '2. Storey matching' },
  { id: 'fmguid', label: '3. FMGUID generation' },
  { id: 'ids', label: '4. IDS validation' },
  { id: 'viewer', label: '5. 3D view' },
  { id: 'rules', label: '6. IDS rules' },
  { id: 'sync', label: '7. Sync to Geminus Plus' },
];

function masterLabel(result: IngestResult): string {
  return result.canonicalSource === 'geminus-plus'
    ? `Master (Geminus Plus${result.building?.name ? `: ${result.building.name}` : ''})`
    : 'Master (architect)';
}

// RGB (0-1 range) per model, cycled by upload order — architect first.
const VIEWER_PALETTE: Array<[number, number, number]> = [
  [0.72, 0.72, 0.80], // architect
  [0.95, 0.85, 0.10],
  [0.10, 0.42, 0.90],
  [0.10, 0.75, 0.65],
  [0.90, 0.18, 0.18],
  [0.65, 0.22, 0.85],
  [0.62, 0.52, 0.38],
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('upload');
  // The 3D view tab's content stays display:none until visited, so its
  // FederationViewer must be mounted lazily on first visit rather than
  // whenever `result` becomes available -- mounting it while the tab is
  // still hidden meant xeokit measured a 0x0 canvas at bootstrap time and
  // never recovered even after switching to the tab (confirmed: canvas
  // stuck permanently at width=0/height=0, models never rendered).
  const [viewerVisited, setViewerVisited] = useState(false);
  useEffect(() => { if (activeTab === 'viewer') setViewerVisited(true); }, [activeTab]);
  const [buildingIdentifier, setBuildingIdentifier] = useState('');
  const [architectFile, setArchitectFile] = useState<File | null>(null);
  const [disciplines, setDisciplines] = useState<DisciplineRow[]>([{ id: rowId++, name: '', file: null }]);

  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [buildingsLoading, setBuildingsLoading] = useState(true);
  const [buildingsError, setBuildingsError] = useState<string | null>(null);

  const [buildingCheck, setBuildingCheck] = useState<BuildingCheckResult | null>(null);
  const [checkingBuilding, setCheckingBuilding] = useState(false);
  const [buildingCheckError, setBuildingCheckError] = useState<string | null>(null);

  // Load the Geminus Plus building list once, so the user picks from a
  // dropdown instead of needing to already know a building's FMGUID.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/buildings');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not fetch the building list.');
        setBuildings(json.buildings);
      } catch (err: any) {
        setBuildingsError(err.message ?? String(err));
      } finally {
        setBuildingsLoading(false);
      }
    })();
  }, []);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100, combined upload+processing
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [confirmed, setConfirmed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [focusedModelName, setFocusedModelName] = useState<string | null>(null);

  // Built from the same File objects already sitting in this component's
  // upload state — the viewer loads IFC directly via WebIFCLoaderPlugin, so
  // no server-side XKT conversion step is needed. Only populated once an
  // analysis has actually run, so the model names line up with the matrix.
  const viewerModels: FederationViewerModel[] = React.useMemo(() => {
    if (!result) return [];
    const models: FederationViewerModel[] = [];
    if (architectFile) models.push({ modelName: 'architect', file: architectFile, color: VIEWER_PALETTE[0] });
    disciplines.forEach((row, i) => {
      if (row.file && row.name.trim()) {
        models.push({ modelName: row.name.trim(), file: row.file, color: VIEWER_PALETTE[(i + 1) % VIEWER_PALETTE.length] });
      }
    });
    return models;
  }, [result, architectFile, disciplines]);

  const [idsResults, setIdsResults] = useState<IdsResults | null>(null);
  const [validatingIds, setValidatingIds] = useState(false);
  const [idsError, setIdsError] = useState<string | null>(null);
  const [idsSuccessMessage, setIdsSuccessMessage] = useState<string | null>(null);
  const [exportingBcf, setExportingBcf] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // FMGUID generation is a separate, explicit step from analysis (see
  // /api/apply-fmguid) — the user picks which IFC categories to actually
  // mint FMGUIDs for, after seeing the per-category coverage report.
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [regenerateAllGuids, setRegenerateAllGuids] = useState(false);
  const [applyingFmguid, setApplyingFmguid] = useState(false);
  const [applyFmguidError, setApplyFmguidError] = useState<string | null>(null);
  const [fmguidSuccessMessage, setFmguidSuccessMessage] = useState<string | null>(null);

  // Every failing entity's IFC GlobalId across all IDS results, flat — the
  // viewer's metaobject/entity ids ARE the IFC GlobalId (WebIFCLoaderPlugin
  // sets them directly from IfcRoot.GlobalId, confirmed in the SDK source),
  // so this set can be passed straight to the viewer to highlight them.
  const failedGlobalIds: Set<string> = React.useMemo(() => {
    const ids = new Set<string>();
    if (!idsResults) return ids;
    for (const ruleResults of Object.values(idsResults)) {
      for (const { report } of ruleResults) {
        if (!report) continue;
        for (const spec of report.specifications) {
          for (const requirement of spec.requirements ?? []) {
            for (const failed of requirement.failed_entities ?? []) {
              ids.add(failed.global_id);
            }
          }
        }
      }
    }
    return ids;
  }, [idsResults]);

  function addDisciplineRow() {
    setDisciplines(prev => [...prev, { id: rowId++, name: '', file: null }]);
  }
  function removeDisciplineRow(id: number) {
    setDisciplines(prev => prev.filter(r => r.id !== id));
  }
  function updateDiscipline(id: number, patch: Partial<DisciplineRow>) {
    setDisciplines(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Shows the selected building's storey count immediately after picking it
  // from the dropdown — Geminus Plus wins over an uploaded architect model
  // as the source of truth automatically in /api/ingest whenever a building
  // is selected, but that would otherwise only become visible after the
  // full upload+analysis completes. Runs automatically on selection change
  // (see the <select> below), not behind a separate button — the dropdown
  // itself already proves the building exists, so there's nothing left to
  // "check" except how many storeys it has.
  async function checkBuilding(fmguid: string) {
    setBuildingCheckError(null);
    setBuildingCheck(null);
    if (!fmguid || fmguid === NEW_BUILDING) return;
    setCheckingBuilding(true);
    try {
      const res = await fetch('/api/lookup-building', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: fmguid }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not look up the building.');
      setBuildingCheck(json);
    } catch (err: any) {
      setBuildingCheckError(err.message ?? String(err));
    } finally {
      setCheckingBuilding(false);
    }
  }

  // Overall progress = upload phase (0-30, real byte progress via XHR) +
  // processing phase (30-100, real server-side progress via polling).
  // Uploads over localhost are typically fast even for huge files, so most
  // of the bar's visible movement happens during processing — but for a
  // slower network (once this is hosted on Render) the upload segment will
  // matter more, hence tracking it for real rather than assuming it's instant.
  function uploadWithProgress(form: FormData): Promise<{ jobId: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/ingest');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        setProgress(Math.round((e.loaded / e.total) * 30));
        setProgressLabel('Uploading files…');
      };
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(json);
          else reject(new Error(json.error || `Upload failed (HTTP ${xhr.status}).`));
        } catch {
          reject(new Error(`Unexpected server response (HTTP ${xhr.status}).`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload.'));
      xhr.send(form);
    });
  }

  async function pollJob(jobId: string): Promise<IngestResult> {
    while (true) {
      const res = await fetch(`/api/ingest/${jobId}`);
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || 'Could not fetch analysis status.');

      if (job.status === 'error') throw new Error(job.error || 'Analysis failed.');
      if (job.status === 'done') {
        setProgress(100);
        return job.result as IngestResult;
      }

      setProgress(30 + Math.round((job.progress ?? 0) * 0.7));
      setProgressLabel(job.stage || 'Processing…');
      await new Promise(r => setTimeout(r, 300));
    }
  }

  async function runAnalysis() {
    setError(null);
    setLoading(true);
    setProgress(0);
    setProgressLabel('Uploading files…');
    setResult(null);
    setConfirmed(false);
    setOverrides({});
    try {
      const validRows = disciplines.filter(r => r.file && r.name.trim());
      if (!architectFile && validRows.length === 0) {
        throw new Error('Upload at least one file (architect model or a discipline).');
      }

      const form = new FormData();
      if (buildingIdentifier.trim()) form.append('buildingIdentifier', buildingIdentifier.trim());
      if (architectFile) form.append('architectFile', architectFile);
      form.append('disciplineNames', JSON.stringify(validRows.map(r => r.name.trim())));
      for (const r of validRows) form.append('disciplineFiles', r.file as File);

      const { jobId } = await uploadWithProgress(form);
      setProgress(30);
      setProgressLabel('Processing…');
      const json = await pollJob(jobId);
      setResult(json);
      setSelectedCategories(new Set(json.guidValidation.categories.map((c: CategoryCount) => c.ifcType)));
      setActiveTab('match');
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  function effectiveTarget(modelName: string, cell: MatrixCell | undefined): string {
    if (!cell) return UNMAPPED;
    const override = overrides[modelName]?.[cell.modelStorey.globalId];
    if (override !== undefined) return override ?? UNMAPPED;
    return cell.suggestedCanonicalFmguid;
  }

  function setOverride(modelName: string, globalId: string, canonicalFmguid: string | null) {
    setOverrides(prev => ({ ...prev, [modelName]: { ...prev[modelName], [globalId]: canonicalFmguid } }));
  }

  async function confirmReconciliation() {
    if (!result) return;
    setError(null);
    try {
      const res = await fetch('/api/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: result.sessionId, overrides }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not confirm the mapping.');
      setConfirmed(true);
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  }

  async function exportFiles() {
    if (!result) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: result.sessionId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Export failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ifc-federation-export.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setExporting(false);
    }
  }

  function toggleCategory(ifcType: string) {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(ifcType)) next.delete(ifcType); else next.add(ifcType);
      return next;
    });
  }

  // Mints FMGUIDs only for the chosen categories (see /api/apply-fmguid) —
  // a category left unchecked keeps whatever it already had (missing stays
  // missing), so this can be re-run incrementally as the user reviews the
  // coverage report below.
  async function applyFmguid() {
    if (!result || selectedCategories.size === 0) return;
    setApplyingFmguid(true);
    setApplyFmguidError(null);
    setFmguidSuccessMessage(null);
    const categoriesRequested = [...selectedCategories];
    try {
      const res = await fetch('/api/apply-fmguid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: result.sessionId, categories: categoriesRequested, regenerateAll: regenerateAllGuids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not generate FMGUIDs.');
      setResult(prev => prev ? { ...prev, guidValidation: { ...prev.guidValidation, stats: json.stats, categories: json.categories } } : prev);
      const touched = (json.categories as { ifcType: string; total: number }[])
        .filter(c => categoriesRequested.includes(c.ifcType))
        .reduce((sum, c) => sum + c.total, 0);
      setFmguidSuccessMessage(`Done — FMGUID generated for ${categoriesRequested.length} categor${categoriesRequested.length === 1 ? 'y' : 'ies'} (${touched} objects).`);
    } catch (err: any) {
      setApplyFmguidError(err.message ?? String(err));
    } finally {
      setApplyingFmguid(false);
    }
  }

  // Runs every rule in Geminus's shared IDS rule library
  // (ifc-federation/ids-rules/*.ids) against every uploaded model's
  // original file. Independent of the storey-matching/FMGUID flow above —
  // can be run before, after, or without it.
  async function runIdsValidation() {
    if (!result) return;
    setValidatingIds(true);
    setIdsError(null);
    setIdsSuccessMessage(null);
    setIdsResults(null);
    try {
      const res = await fetch('/api/validate-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: result.sessionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'IDS validation failed.');
      setIdsResults(json.results);
      let totalSpecs = 0, totalPass = 0;
      for (const rules of Object.values(json.results as IdsResults)) {
        for (const r of rules) {
          if (!r.report) continue;
          for (const spec of r.report.specifications) { totalSpecs++; if (spec.status) totalPass++; }
        }
      }
      setIdsSuccessMessage(`Done — ${totalPass} of ${totalSpecs} checks passed.`);
    } catch (err: any) {
      setIdsError(err.message ?? String(err));
    } finally {
      setValidatingIds(false);
    }
  }

  async function exportBcfReport() {
    if (!result) return;
    setExportingBcf(true);
    setIdsError(null);
    try {
      const res = await fetch('/api/validate-ids/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: result.sessionId }),
      });
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json.empty) { setIdsError(json.message); return; }
        throw new Error(json.error || 'BCF export failed.');
      }
      if (!res.ok) throw new Error('BCF export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ids-validation-report.bcfzip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setIdsError(err.message ?? String(err));
    } finally {
      setExportingBcf(false);
    }
  }

  async function exportPdfReport() {
    if (!result) return;
    setExportingPdf(true);
    setIdsError(null);
    try {
      const res = await fetch('/api/validate-ids/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: result.sessionId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'PDF export failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'geminus-ids-validation-report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setIdsError(err.message ?? String(err));
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="app">
      <div className="app-header">
        <img src="/geminus-logo.png" alt="Geminus" />
        <h1>Geminus IFC Manager</h1>
      </div>
      <p className="subtitle">Match storeys and assign unique FMGUIDs across multiple discipline models.</p>

      <div className="tab-bar">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ display: activeTab === 'upload' ? undefined : 'none' }}>
        <h2>1. Upload models</h2>
        <label>Building in Geminus Plus</label>
        <select
          value={buildingIdentifier || NEW_BUILDING}
          disabled={buildingsLoading}
          onChange={e => {
            const fmguid = e.target.value;
            setBuildingIdentifier(fmguid === NEW_BUILDING ? '' : fmguid);
            checkBuilding(fmguid);
          }}
        >
          <option value={NEW_BUILDING}>{buildingsLoading ? 'Loading buildings…' : '— New building (not in Geminus Plus) —'}</option>
          {buildings.map(b => (
            <option key={b.fmguid} value={b.fmguid}>{b.name ?? b.fmguid}</option>
          ))}
        </select>
        {buildingsError && <div className="error" style={{ marginTop: '0.6rem' }}>Could not fetch the building list: {buildingsError}</div>}

        {checkingBuilding && <p className="muted" style={{ marginTop: '0.5rem' }}>Fetching storeys…</p>}
        {buildingCheckError && <div className="error" style={{ marginTop: '0.6rem' }}>{buildingCheckError}</div>}
        {buildingCheck?.found && (
          <div className="success" style={{ marginTop: '0.6rem' }}>
            <strong>{buildingCheck.building?.name ?? buildingCheck.building?.fmguid}</strong> has {buildingCheck.storeys?.length ?? 0} registered storeys in Geminus Plus.
            These storey names and FMGUIDs are used as the source of truth — any architect model uploaded alongside it is then treated as just another discipline, not the master.
          </div>
        )}

        <label>Architect model (required if the building is new)</label>
        <input type="file" accept=".ifc" onChange={e => setArchitectFile(e.target.files?.[0] ?? null)} />

        <label>Discipline models</label>
        {disciplines.map(row => (
          <div className="discipline-row" key={row.id}>
            <input
              type="text"
              placeholder="Name, e.g. Electrical"
              value={row.name}
              onChange={e => updateDiscipline(row.id, { name: e.target.value })}
            />
            <input type="file" accept=".ifc" onChange={e => updateDiscipline(row.id, { file: e.target.files?.[0] ?? null })} />
            <button className="secondary" onClick={() => removeDisciplineRow(row.id)} type="button">Remove</button>
          </div>
        ))}

        <div className="row-actions">
          <button className="secondary" onClick={addDisciplineRow} type="button" disabled={loading}>+ Add discipline</button>
          <button onClick={runAnalysis} disabled={loading} type="button">{loading ? 'Analyzing…' : 'Analyze'}</button>
        </div>

        {loading && (
          <div className="progress-wrap">
            <div className="progress-label">
              <span>{progressLabel}</span>
              <span className="pct">{progress}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>

      <div style={{ display: activeTab === 'match' ? undefined : 'none' }}>
      {!result && (
        <div className="card"><p className="muted">Run an analysis on the Upload tab first.</p></div>
      )}
      {result && (
        <>
          <div className="card">
            <h2>2. Results</h2>
            {result.buildingLookupWarning && <div className="error" style={{ marginBottom: '0.75rem' }}>{result.buildingLookupWarning}</div>}
            <p>
              Master: <strong>{masterLabel(result)}</strong>
            </p>
            <div className="stat-row">
              <div className="stat"><span className="n">{result.guidValidation.stats.totalElements}</span><span className="l">elements total</span></div>
              <div className="stat"><span className="n">{result.guidValidation.stats.missing}</span><span className="l">missing FMGUIDs</span></div>
              <div className="stat"><span className="n">{result.guidValidation.stats.duplicateGroups}</span><span className="l">duplicate groups</span></div>
              <div className="stat"><span className="n">{result.matrix.unmatched.length}</span><span className="l">unmatched storeys</span></div>
            </div>
          </div>

          <div className="card">
            <h2>3. Storey matching</h2>
            <p className="subtitle" style={{ marginBottom: '0.75rem' }}>
              Master: <strong>{masterLabel(result)}</strong> — every other model is matched against its storeys below.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Canonical storey (source of truth)</th>
                  {result.matrix.models.map(m => (
                    <th key={m} onMouseEnter={() => setFocusedModelName(m)} onMouseLeave={() => setFocusedModelName(null)}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.matrix.rows.map(row => (
                  <tr key={row.canonical.fmguid}>
                    <td>
                      {row.canonical.name ?? <span className="badge badge-unnamed">Unnamed</span>}
                    </td>
                    {result.matrix.models.map(modelName => {
                      const cell = row.cells[modelName];
                      if (!cell) return <td key={modelName} className="muted">— no match —</td>;
                      const target = effectiveTarget(modelName, cell);
                      const isOverridden = overrides[modelName]?.[cell.modelStorey.globalId] !== undefined;
                      return (
                        <td key={modelName}>
                          {cell.modelStorey.name ?? <em className="muted">(unnamed)</em>}
                          {isOverridden
                            ? <span className="badge badge-manual">Manually selected</span>
                            : <span className={`badge ${cell.confidence === 'fmguid-match' ? 'badge-fmguid' : 'badge-name'}`}>{cell.confidence === 'fmguid-match' ? 'FMGUID' : 'Name match'}</span>}
                          <select
                            value={target}
                            onChange={e => setOverride(modelName, cell.modelStorey.globalId, e.target.value === UNMAPPED ? null : e.target.value)}
                            disabled={confirmed}
                          >
                            <option value={UNMAPPED}>— No match —</option>
                            {result.canonicalStoreys.map(c => (
                              <option key={c.fmguid} value={c.fmguid}>{c.name ?? '(unnamed canonical storey)'}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {result.matrix.unmatched.length > 0 && (
              <>
                <h3 style={{ marginTop: '1.5rem' }}>Unmatched storeys — assign manually</h3>
                <table>
                  <thead><tr><th>Model</th><th>Storey in model</th><th>Assign to</th></tr></thead>
                  <tbody>
                    {result.matrix.unmatched.map(u => {
                      const target = overrides[u.modelName]?.[u.modelStorey.globalId] ?? UNMAPPED;
                      return (
                        <tr key={`${u.modelName}:${u.modelStorey.globalId}`}>
                          <td>{u.modelName}</td>
                          <td>{u.modelStorey.name ?? <em className="muted">(unnamed)</em>}</td>
                          <td>
                            <select
                              value={target}
                              onChange={e => setOverride(u.modelName, u.modelStorey.globalId, e.target.value === UNMAPPED ? null : e.target.value)}
                              disabled={confirmed}
                            >
                              <option value={UNMAPPED}>— No match —</option>
                              {result.canonicalStoreys.map(c => (
                                <option key={c.fmguid} value={c.fmguid}>{c.name ?? '(unnamed canonical storey)'}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

            {result.guidValidation.duplicates.length > 0 && (
              <>
                <h3 style={{ marginTop: '1.5rem' }}>Duplicate FMGUIDs (fixed automatically on export)</h3>
                <table>
                  <thead><tr><th>FMGUID</th><th>Occurrences</th></tr></thead>
                  <tbody>
                    {result.guidValidation.duplicates.slice(0, 25).map(d => (
                      <tr key={d.fmguid}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{d.fmguid}</td>
                        <td>{d.locations.map(l => `${l.modelName}/${l.name ?? l.ifcType}`).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.guidValidation.duplicates.length > 25 && (
                  <p className="muted">…and {result.guidValidation.duplicates.length - 25} more.</p>
                )}
              </>
            )}

            <div className="row-actions">
              <button className="amber" onClick={confirmReconciliation} disabled={confirmed} type="button">
                {confirmed ? 'Mapping confirmed ✓' : 'Confirm mapping'}
              </button>
              <button onClick={exportFiles} disabled={!confirmed || exporting} type="button">
                {exporting ? 'Exporting…' : 'Export corrected IFC files (.zip)'}
              </button>
            </div>
            {confirmed && <div className="success">The mapping has been confirmed. You can now export the corrected files.</div>}
          </div>
        </>
      )}
      </div>

      <div style={{ display: activeTab === 'fmguid' ? undefined : 'none' }}>
      {!result && (
        <div className="card"><p className="muted">Run an analysis on the Upload tab first.</p></div>
      )}
      {result && (
          <div className="card">
            <h2>3. FMGUID generation</h2>
            <p className="subtitle" style={{ marginBottom: '0.75rem' }}>
              Choose which IFC categories should get an FMGUID. A category left unchecked keeps whatever it already
              had — nothing is generated for it, and it won't appear in the exported files.
            </p>
            <table>
              <thead>
                <tr><th style={{ width: '2rem' }} /><th>Category</th><th>Total</th><th>Has FMGUID</th><th>Missing</th></tr>
              </thead>
              <tbody>
                {result.guidValidation.categories.map(c => (
                  <tr key={c.ifcType}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedCategories.has(c.ifcType)}
                        onChange={() => toggleCategory(c.ifcType)}
                      />
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{c.ifcType}</td>
                    <td>{c.total}</td>
                    <td>{c.withFmguid}</td>
                    <td>{c.missing > 0 ? <span className="badge badge-unnamed">{c.missing}</span> : c.missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400, color: 'var(--ink)', fontSize: '0.88rem', marginTop: '0.9rem' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={regenerateAllGuids}
                onChange={e => setRegenerateAllGuids(e.target.checked)}
              />
              Regenerate existing FMGUIDs too, not just missing ones
            </label>
            {applyFmguidError && <div className="error" style={{ marginTop: '0.75rem' }}>{applyFmguidError}</div>}
            <div className="row-actions">
              <button className="secondary" type="button" onClick={() => setSelectedCategories(new Set(result.guidValidation.categories.map(c => c.ifcType)))}>Select all</button>
              <button className="secondary" type="button" onClick={() => setSelectedCategories(new Set())}>Select none</button>
              <button onClick={applyFmguid} disabled={applyingFmguid || selectedCategories.size === 0} type="button">
                {applyingFmguid ? 'Generating…' : `Generate FMGUID for ${selectedCategories.size} categor${selectedCategories.size === 1 ? 'y' : 'ies'}`}
              </button>
            </div>

            {applyingFmguid && (
              <div className="progress-wrap">
                <div className="progress-label"><span>Generating FMGUID…</span></div>
                <div className="progress-track"><div className="progress-fill progress-indeterminate" /></div>
              </div>
            )}
            {fmguidSuccessMessage && <div className="success" style={{ marginTop: '0.75rem' }}>{fmguidSuccessMessage}</div>}
          </div>
      )}
      </div>

      <div style={{ display: activeTab === 'ids' ? undefined : 'none' }}>
      {!result && (
        <div className="card"><p className="muted">Run an analysis on the Upload tab first.</p></div>
      )}
      {result && (
          <div className="card">
            <h2>4. IDS validation</h2>
            <p className="subtitle" style={{ marginBottom: '0.75rem' }}>
              Checks information requirements (naming, required properties, etc.) against buildingSMART's IDS standard —
              runs against the corrected export (including the FMGUID categories generated above) and Geminus's shared rule library.
            </p>
            <div className="row-actions">
              <button onClick={runIdsValidation} disabled={validatingIds} type="button">
                {validatingIds ? 'Validating…' : 'Run IDS validation'}
              </button>
              {idsResults && (
                <button className="amber" onClick={exportBcfReport} disabled={exportingBcf} type="button">
                  {exportingBcf ? 'Building report…' : 'Download BCF report'}
                </button>
              )}
              {idsResults && (
                <button className="amber" onClick={exportPdfReport} disabled={exportingPdf} type="button">
                  {exportingPdf ? 'Building report…' : 'Download PDF report'}
                </button>
              )}
            </div>

            {validatingIds && (
              <div className="progress-wrap">
                <div className="progress-label"><span>Running IDS validation — this can take a while on large models…</span></div>
                <div className="progress-track"><div className="progress-fill progress-indeterminate" /></div>
              </div>
            )}
            {idsError && <div className="error" style={{ marginTop: '0.75rem' }}>{idsError}</div>}
            {idsSuccessMessage && <div className="success" style={{ marginTop: '0.75rem' }}>{idsSuccessMessage}</div>}

            {idsResults && (
              <>
                <table>
                  <thead>
                    <tr><th>Model</th><th>Rule</th><th>Result</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(idsResults).flatMap(([modelName, ruleResults]) =>
                      ruleResults.map(r => (
                        <tr key={`${modelName}-${r.ruleId}`}>
                          <td>{modelName}</td>
                          <td>{r.ruleTitle}</td>
                          <td>
                            {r.error ? (
                              <span className="badge badge-unnamed">Error: {r.error.split('\n')[0]}</span>
                            ) : (
                              r.report!.specifications.map(spec => (
                                <span key={spec.name} className={`badge ${spec.status ? 'badge-fmguid' : 'badge-unnamed'}`}>
                                  {spec.status ? 'Passed' : 'Failed'} ({spec.total_applicable_pass}/{spec.total_applicable})
                                </span>
                              ))
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {failedGlobalIds.size > 0 && (
                  <p className="muted" style={{ marginTop: '0.75rem' }}>
                    {failedGlobalIds.size} failing object{failedGlobalIds.size === 1 ? '' : 's'} — see the 3D view tab to highlight them on the model.
                  </p>
                )}
              </>
            )}
          </div>
      )}
      </div>

      <div style={{ display: activeTab === 'viewer' ? undefined : 'none' }}>
      {!result && (
        <div className="card"><p className="muted">Run an analysis on the Upload tab first.</p></div>
      )}
      {result && (
          <div className="card">
            <h2>5. 3D view</h2>
            <p className="subtitle" style={{ marginBottom: '0.75rem' }}>
              Hover a discipline in the matrix above (on the Storey matching tab) to focus it here and fade out the others — useful for checking whether the models actually align with each other.
              {failedGlobalIds.size > 0 && ' Objects that failed IDS validation are highlighted in red.'}
            </p>
            {viewerVisited && <FederationViewer models={viewerModels} focusedModelName={focusedModelName} highlightedGlobalIds={failedGlobalIds} />}
          </div>
      )}
      </div>

      <div style={{ display: activeTab === 'rules' ? undefined : 'none' }}>
        <div className="card">
          <h2>6. IDS rule library</h2>
          <IdsRuleEditor />
        </div>
      </div>

      <div style={{ display: activeTab === 'sync' ? undefined : 'none' }}>
        <div className="card">
          <h2>7. Sync to Geminus Plus</h2>
          {!result ? (
            <p className="muted">Run an analysis on the Upload tab first.</p>
          ) : (
            <SyncTab
              sessionId={result.sessionId}
              buildingFmguid={result.canonicalSource === 'geminus-plus' ? (result.building?.fmguid ?? null) : null}
              buildingName={result.building?.name ?? null}
              modelNames={result.matrix.models}
            />
          )}
        </div>
      </div>
    </div>
  );
}
