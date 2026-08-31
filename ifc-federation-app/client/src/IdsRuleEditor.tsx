import React, { useEffect, useState } from 'react';

/**
 * IdsRuleEditor — CRUD UI for the shared IDS rule library
 * (ifc-federation/ids-rules/*.ids), via the /api/ids-rules* endpoints in
 * server.js (backed by ifc-federation/ids-rules-editor.js).
 *
 * Scoped to the one rule shape the library actually uses: a single
 * specification with one Entity applicability facet (one IFC type) and one
 * Property requirement facet (propertySet + baseName + dataType +
 * cardinality). See ids-rules-editor.js's file comment for why a general
 * editor for all six IDS facet types isn't built here.
 */

interface RuleSummary {
  id: string;
  title: string;
}

interface RuleFields {
  id?: string;
  title: string;
  description: string;
  author: string;
  version: string;
  specName: string;
  ifcVersion: string;
  entityType: string;
  propertySet: string;
  baseName: string;
  dataType: string;
  cardinality: string;
}

const EMPTY_FIELDS: RuleFields = {
  title: '',
  description: '',
  author: '',
  version: '1.0',
  specName: '',
  ifcVersion: 'IFC4',
  entityType: '',
  propertySet: '',
  baseName: '',
  dataType: 'IFCTEXT',
  cardinality: 'required',
};

const COMMON_IFC_TYPES = [
  'IFCBUILDINGSTOREY', 'IFCWALL', 'IFCDOOR', 'IFCWINDOW', 'IFCSPACE',
  'IFCFLOWTERMINAL', 'IFCFLOWSEGMENT', 'IFCDISTRIBUTIONELEMENT', 'IFCFURNISHINGELEMENT',
];

export default function IdsRuleEditor() {
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null); // null = not editing, '__new__' = new rule
  const [fields, setFields] = useState<RuleFields>(EMPTY_FIELDS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadRules() {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const res = await fetch('/api/ids-rules/list');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load the rule library.');
      setRules(json.rules);
    } catch (err: any) {
      setRulesError(err.message ?? String(err));
    } finally {
      setRulesLoading(false);
    }
  }

  useEffect(() => { loadRules(); }, []);

  async function startEdit(id: string) {
    setSaveError(null);
    try {
      const res = await fetch(`/api/ids-rules/${encodeURIComponent(id)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load this rule.');
      setFields(json);
      setEditingId(id);
    } catch (err: any) {
      setSaveError(err.message ?? String(err));
    }
  }

  function startNew() {
    setSaveError(null);
    setFields({ ...EMPTY_FIELDS, id: '' });
    setEditingId('__new__');
  }

  function cancelEdit() {
    setEditingId(null);
    setFields(EMPTY_FIELDS);
    setSaveError(null);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const isNew = editingId === '__new__';
      const res = await fetch(isNew ? '/api/ids-rules' : `/api/ids-rules/${encodeURIComponent(editingId!)}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? { id: fields.id, ...fields } : fields),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save this rule.');
      await loadRules();
      cancelEdit();
    } catch (err: any) {
      setSaveError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(id: string) {
    setDeletingId(id);
    setRulesError(null);
    try {
      const res = await fetch(`/api/ids-rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not delete this rule.');
      if (editingId === id) cancelEdit();
      await loadRules();
    } catch (err: any) {
      setRulesError(err.message ?? String(err));
    } finally {
      setDeletingId(null);
    }
  }

  function updateField<K extends keyof RuleFields>(key: K, value: RuleFields[K]) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div>
      <p className="subtitle" style={{ marginBottom: '0.75rem' }}>
        Every rule here is run against every uploaded model during IDS validation above. Each rule checks that
        a given IFC type carries a specific property in a specific property set.
      </p>

      {rulesError && <div className="error" style={{ marginBottom: '0.75rem' }}>{rulesError}</div>}

      {rulesLoading ? (
        <p className="muted">Loading rules…</p>
      ) : (
        <table style={{ marginBottom: '1rem' }}>
          <thead>
            <tr><th>Title</th><th>File</th><th /></tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{r.id}</td>
                <td style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="secondary" type="button" onClick={() => startEdit(r.id)}>Edit</button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={deletingId === r.id}
                    onClick={() => { if (confirm(`Delete rule "${r.title}"? This cannot be undone.`)) deleteRule(r.id); }}
                  >
                    {deletingId === r.id ? 'Deleting…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan={3} className="muted">No rules in the library yet.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {editingId === null && (
        <button type="button" onClick={startNew}>+ New rule</button>
      )}

      {editingId !== null && (
        <div className="card" style={{ background: 'var(--ice)', marginTop: '0.5rem' }}>
          <h3 style={{ marginTop: 0 }}>{editingId === '__new__' ? 'New rule' : `Editing: ${editingId}`}</h3>

          {editingId === '__new__' && (
            <>
              <label>File name (no spaces, no extension needed)</label>
              <input type="text" placeholder="e.g. walls-fire-rating" value={fields.id ?? ''} onChange={e => updateField('id', e.target.value)} />
            </>
          )}

          <label>Title</label>
          <input type="text" placeholder="e.g. Walls must have a fire rating" value={fields.title} onChange={e => updateField('title', e.target.value)} />

          <label>Description (shown in the PDF/BCF report)</label>
          <input type="text" placeholder="Short explanation of why this rule exists" value={fields.description} onChange={e => updateField('description', e.target.value)} />

          <label>Author</label>
          <input type="text" placeholder="e.g. you@swg.com" value={fields.author} onChange={e => updateField('author', e.target.value)} />

          <label>Specification name</label>
          <input type="text" placeholder="e.g. All walls must have FireRating" value={fields.specName} onChange={e => updateField('specName', e.target.value)} />

          <div className="discipline-row">
            <div style={{ flex: 1 }}>
              <label>Applies to (IFC type)</label>
              <input list="ifc-type-options" type="text" placeholder="e.g. IFCWALL" value={fields.entityType} onChange={e => updateField('entityType', e.target.value.toUpperCase())} />
              <datalist id="ifc-type-options">
                {COMMON_IFC_TYPES.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div style={{ flex: 1 }}>
              <label>Cardinality</label>
              <select value={fields.cardinality} onChange={e => updateField('cardinality', e.target.value)}>
                <option value="required">Required</option>
                <option value="optional">Optional</option>
                <option value="prohibited">Prohibited</option>
              </select>
            </div>
          </div>

          <div className="discipline-row">
            <div style={{ flex: 1 }}>
              <label>Property set</label>
              <input type="text" placeholder="e.g. FM_Pset" value={fields.propertySet} onChange={e => updateField('propertySet', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Property name</label>
              <input type="text" placeholder="e.g. FmGuid" value={fields.baseName} onChange={e => updateField('baseName', e.target.value)} />
            </div>
          </div>

          {saveError && <div className="error" style={{ marginTop: '0.75rem' }}>{saveError}</div>}

          <div className="row-actions">
            <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rule'}</button>
            <button className="secondary" type="button" onClick={cancelEdit} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
