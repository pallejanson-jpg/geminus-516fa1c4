import React, { useEffect, useState } from 'react';

/**
 * SyncTab — match each uploaded/corrected model against an EXISTING BIM
 * model in Geminus Plus (via GetAllRelatedModels) instead of the pipeline
 * silently creating a duplicate, then optionally push the corrected IFC
 * into a new revision of that model (createRevision + blob upload +
 * ProcessIfc, per server.js's /api/sync/push).
 *
 * The matching list (this component's main view) is read-only and safe.
 * The push button itself has NOT been exercised against the real staging
 * environment yet -- it makes a real, visible change in Geminus Plus, so
 * it asks for an explicit confirmation before calling through.
 */

interface RelatedModel {
  modelId: string;
  name: string;
  disciplineId: string;
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

export default function SyncTab({ sessionId, buildingFmguid, buildingName, modelNames }: SyncTabProps) {
  const [models, setModels] = useState<RelatedModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetModelId, setTargetModelId] = useState<Record<string, string>>({});
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
    const targetId = targetModelId[modelName];
    if (!targetId) return;
    const target = models?.find(m => m.modelId === targetId);
    if (!confirm(`This will create a new revision of "${target?.name ?? targetId}" in Geminus Plus and upload "${modelName}" into it. This is a real, visible change and has not been tested against production yet. Continue?`)) {
      return;
    }
    setPushing(prev => ({ ...prev, [modelName]: true }));
    setPushError(prev => ({ ...prev, [modelName]: '' }));
    setPushResult(prev => ({ ...prev, [modelName]: '' }));
    try {
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, modelName, targetModelId: targetId, targetRevisionId: target?.revisionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Push failed.');
      setPushResult(prev => ({ ...prev, [modelName]: `Uploaded — new revision ${json.revision?.revisionId ?? ''}.` }));
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
        data lands as a new revision of the right model instead of a duplicate.
      </p>

      {loading && <p className="muted">Fetching related BIM models…</p>}
      {error && <div className="error">{error}</div>}

      {models && (
        <>
          <table style={{ marginBottom: '1.25rem' }}>
            <thead><tr><th>Name</th><th>Model ID</th><th>Discipline ID</th><th>Revision ID</th></tr></thead>
            <tbody>
              {models.map(m => (
                <tr key={m.modelId}>
                  <td>{m.name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{m.modelId}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{m.disciplineId}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{m.revisionId}</td>
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
                      value={targetModelId[name] ?? ''}
                      onChange={e => setTargetModelId(prev => ({ ...prev, [name]: e.target.value }))}
                    >
                      <option value="">— Select a BIM model —</option>
                      {models.map(m => <option key={m.modelId} value={m.modelId}>{m.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <button
                      className="amber"
                      type="button"
                      disabled={!targetModelId[name] || pushing[name]}
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
