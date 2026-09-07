import React, { useEffect, useState } from 'react';

/**
 * SyncTab — match each uploaded/corrected model against an EXISTING BIM
 * object in Geminus Plus (via GetAllRelatedModels) instead of the pipeline
 * silently creating a duplicate, then optionally push the corrected IFC as
 * a new file for that object (server.js's /api/sync/push, following the
 * real upload sequence captured from Geminus Plus's own UI -- see
 * ifc-federation/geminus-plus-sync.js's file comment).
 *
 * Matched by `bimObjectId`, not `modelId` -- a BIM object that has never
 * had a file uploaded ("New" status) has no modelId yet from
 * GetAllRelatedModels, but always has a bimObjectId (confirmed against
 * real staging data), and the real upload flow uses bimObjectId as the
 * ModelId value anyway.
 *
 * The matching list (this component's main view) is read-only and safe.
 * The push button makes a real, visible change in Geminus Plus, so it asks
 * for an explicit confirmation before calling through.
 */

interface RelatedModel {
  modelId: string | null;
  name: string;
  disciplineId: string | null;
  revisionId: string;
  bimObjectId: string;
  status: number;
}

interface SyncTabProps {
  sessionId: string;
  buildingFmguid: string | null;
  buildingName: string | null;
  modelNames: string[];
}

const STATUS_LABELS: Record<number, string> = { 0: 'New', 1: 'Draft', 2: 'Cancelled', 3: 'Publishing', 4: 'Published' };

export default function SyncTab({ sessionId, buildingFmguid, buildingName, modelNames }: SyncTabProps) {
  const [models, setModels] = useState<RelatedModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetBimObjectId, setTargetBimObjectId] = useState<Record<string, string>>({});
  const [pushing, setPushing] = useState<Record<string, boolean>>({});
  const [pushResult, setPushResult] = useState<Record<string, string>>({});
  const [pushError, setPushError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!buildingFmguid) return;
    setLoading(true);
    setError(null);
    fetch(`/api/sync/related-models?buildingFmguid=${encodeURIComponent(buildingFmguid)}`)
      .then(res => res.json().then(json => { if (!res.ok) throw new Error(json.error || 'Could not fetch related BIM models.'); return json; }))
      .then(json => setModels(json.models))
      .catch(err => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
  }, [buildingFmguid]);

  if (!buildingFmguid) {
    return (
      <p className="muted">
        Select a building from Geminus Plus on the Upload tab first — matching against existing BIM
        models requires knowing which building they belong to.
      </p>
    );
  }

  async function push(modelName: string) {
    const targetId = targetBimObjectId[modelName];
    if (!targetId) return;
    const target = models?.find(m => m.bimObjectId === targetId);
    if (!confirm(`This will upload "${modelName}" as a new file for "${target?.name ?? targetId}" in Geminus Plus. This is a real, visible change. Continue?`)) {
      return;
    }
    setPushing(prev => ({ ...prev, [modelName]: true }));
    setPushError(prev => ({ ...prev, [modelName]: '' }));
    setPushResult(prev => ({ ...prev, [modelName]: '' }));
    try {
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, modelName, targetBimObjectId: targetId, targetName: target?.name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Push failed.');
      setPushResult(prev => ({ ...prev, [modelName]: `Uploaded — revision ${json.revisionId}, file ${json.fileId}.` }));
    } catch (err: any) {
      setPushError(prev => ({ ...prev, [modelName]: err.message ?? String(err) }));
    } finally {
      setPushing(prev => ({ ...prev, [modelName]: false }));
    }
  }

  return (
    <div>
      <p className="subtitle" style={{ marginBottom: '0.75rem' }}>
        Building: <strong>{buildingName ?? buildingFmguid}</strong>. Existing BIM models found in Geminus Plus for
        this building are listed below — pick a match for each uploaded model before pushing, so the corrected
        data lands on the right object instead of creating a duplicate.
      </p>

      {loading && <p className="muted">Fetching related BIM models…</p>}
      {error && <div className="error">{error}</div>}

      {models && (
        <>
          <table style={{ marginBottom: '1.25rem' }}>
            <thead><tr><th>Name</th><th>Status</th><th>BIM Object ID</th><th>Discipline ID</th></tr></thead>
            <tbody>
              {models.map(m => (
                <tr key={m.bimObjectId}>
                  <td>{m.name}</td>
                  <td>{STATUS_LABELS[m.status] ?? m.status}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{m.bimObjectId}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{m.disciplineId ?? '—'}</td>
                </tr>
              ))}
              {models.length === 0 && <tr><td colSpan={4} className="muted">No existing BIM models found for this building.</td></tr>}
            </tbody>
          </table>

          <h3>Match &amp; push uploaded models</h3>
          <table>
            <thead><tr><th>Uploaded model</th><th>Match to</th><th /></tr></thead>
            <tbody>
              {modelNames.map(name => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>
                    <select
                      value={targetBimObjectId[name] ?? ''}
                      onChange={e => setTargetBimObjectId(prev => ({ ...prev, [name]: e.target.value }))}
                    >
                      <option value="">— Select a BIM model —</option>
                      {models.map(m => <option key={m.bimObjectId} value={m.bimObjectId}>{m.name} ({STATUS_LABELS[m.status] ?? m.status})</option>)}
                    </select>
                  </td>
                  <td>
                    <button
                      className="amber"
                      type="button"
                      disabled={!targetBimObjectId[name] || pushing[name]}
                      onClick={() => push(name)}
                    >
                      {pushing[name] ? 'Pushing…' : 'Push'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {Object.entries(pushResult).map(([name, msg]) => msg && <div key={name} className="success" style={{ marginTop: '0.75rem' }}>{name}: {msg}</div>)}
          {Object.entries(pushError).map(([name, msg]) => msg && <div key={name} className="error" style={{ marginTop: '0.75rem' }}>{name}: {msg}</div>)}
        </>
      )}
    </div>
  );
}
