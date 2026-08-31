import React, { useState, useEffect } from 'react';
import FederationViewer, { FederationViewerModel } from './FederationViewer';

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

interface IngestResult {
  sessionId: string;
  canonicalSource: 'geminus-plus' | 'architect-model';
  building: { fmguid: string; name: string | null } | null;
  canonicalStoreys: CanonicalStorey[];
  matrix: Matrix;
  guidValidation: {
    stats: { totalElements: number; storeyElements: number; hadFmguid: number; missing: number; duplicateGroups: number; duplicateElements: number };
    duplicates: Array<{ fmguid: string; locations: Array<{ modelName: string; ifcType: string; globalId: string; name: string | null }> }>;
  };
}

type Overrides = Record<string, Record<string, string | null>>;

interface IdsSpecResult {
  name: string;
  status: boolean;
  total_applicable: number;
  total_applicable_pass: number;
  total_applicable_fail: number;
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

export default function App() {
  const [buildingIdentifier, setBuildingIdentifier] = useState('');
  const [architectFile, setArchitectFile] = useState<File | null>(null);
  const [disciplines, setDisciplines] = useState<DisciplineRow[]>([{ id: rowId++, name: '', file: null }]);
  const [regenerateAllGuids, setRegenerateAllGuids] = useState(false);

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

  // Empty until IFC->XKT conversion exists in this app (the main Geminus app
  // has one, `ifc-to-xkt`, as a Supabase edge function — porting that is
  // separate work from porting the viewer itself). Placeholder colours are
  // ready to use the moment real xktUrls are available per model.
  const viewerModels: FederationViewerModel[] = [];

  const [idsResults, setIdsResults] = useState<IdsResults | null>(null);
  const [validatingIds, setValidatingIds] = useState(false);
  const [idsError, setIdsError] = useState<string | null>(null);
  const [exportingBcf, setExportingBcf] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

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
      form.append('regenerateAllGuids', String(regenerateAllGuids));
      for (const r of validRows) form.append('disciplineFiles', r.file as File);

      const { jobId } = await uploadWithProgress(form);
      setProgress(30);
      setProgressLabel('Processing…');
      const json = await pollJob(jobId);
      setResult(json);
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

  // Runs every rule in Geminus's shared IDS rule library
  // (ifc-federation/ids-rules/*.ids) against every uploaded model's
  // original file. Independent of the storey-matching/FMGUID flow above —
  // can be run before, after, or without it.
  async function runIdsValidation() {
    if (!result) return;
    setValidatingIds(true);
    setIdsError(null);
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
        <h1>IFC Federation</h1>
      </div>
      <p className="subtitle">Match storeys and assign unique FMGUIDs across multiple discipline models.</p>

      <div className="card">
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

        <label style={{ marginTop: '1.2rem' }}>Object FMGUID (rooms, assets, etc.)</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400, color: 'var(--ink)', fontSize: '0.88rem', marginTop: '0.3rem' }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={regenerateAllGuids}
            onChange={e => setRegenerateAllGuids(e.target.checked)}
          />
          Regenerate all object FMGUIDs, even existing ones
        </label>
        <p className="muted" style={{ marginTop: '0.3rem', fontSize: '0.8rem' }}>
          {regenerateAllGuids
            ? 'Every room/object gets a new FMGUID, regardless of what it already had.'
            : 'Default: existing FMGUIDs on rooms/objects are kept. Only missing or duplicate FMGUIDs are fixed.'}
        </p>

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

      {error && <div className="error">{error}</div>}

      {result && (
        <>
          <div className="card">
            <h2>2. Results</h2>
            <p>
              Source for canonical storeys:{' '}
              <strong>{result.canonicalSource === 'geminus-plus' ? `Geminus Plus (${result.building?.name ?? result.building?.fmguid})` : 'Architect model (new building)'}</strong>
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
            <table>
              <thead>
                <tr>
                  <th>Canonical storey</th>
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

          <div className="card">
            <h2>4. 3D view</h2>
            <p className="subtitle" style={{ marginBottom: '0.75rem' }}>
              Hover a discipline in the matrix above to focus it here and fade out the others — useful for checking whether the models actually align with each other.
            </p>
            <FederationViewer models={viewerModels} focusedModelName={focusedModelName} />
          </div>

          <div className="card">
            <h2>5. IDS validation</h2>
            <p className="subtitle" style={{ marginBottom: '0.75rem' }}>
              Checks information requirements (naming, required properties, etc.) against buildingSMART's IDS standard —
              independent of the FMGUID handling above. Runs against Geminus's shared rule library.
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

            {idsError && <div className="error" style={{ marginTop: '0.75rem' }}>{idsError}</div>}

            {idsResults && (
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
            )}
          </div>
        </>
      )}
    </div>
  );
}
