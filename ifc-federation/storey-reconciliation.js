/**
 * storey-reconciliation.js
 *
 * Phase 4 of the IFC federation pipeline (docs/plans/ifc-federation-plan.md).
 *
 * Builds the storey reconciliation matrix: canonical storeys (from Phase 1's
 * Geminus Plus lookup, or Phase 2's architect-model fallback) as rows,
 * uploaded discipline models as columns. Every cell is a pre-filled but
 * always-editable suggestion — per the plan's clarified rule (auto-suggest
 * is fine, silent auto-apply is not): FMGUID match first, then normalized
 * name similarity, never geometry/elevation (Phase 1 already confirmed no
 * reliable elevation field exists anyway).
 *
 * This module is UI-framework-agnostic: it produces plain data (the matrix)
 * and a pure write-back function. A table UI (or later, the xeokit-linked
 * viewer in Phase 6) renders/edits `matrix` and calls `applyReconciliation`
 * once the user confirms.
 */

import { parseStoreys } from './architect-model-template.js';

/**
 * Normalize a storey name for fuzzy comparison: lowercase, trim, and pull
 * out a leading/embedded floor number if present, so "Floor 01", "Plan 01",
 * "01 Etasje", "01" all reduce to the same key ("01").
 */
function normalizeStoreyName(name) {
  if (!name) return null;
  const trimmed = name.trim().toLowerCase();
  const numMatch = trimmed.match(/\d+/);
  return numMatch ? numMatch[0].replace(/^0+(?=\d)/, '') : trimmed;
}

/**
 * Parse one discipline model's raw storeys from its IFC text.
 * Returns [{ fmguid, name, globalId, lineId }] — same shape parseStoreys
 * already produces, just re-exported here under the vocabulary Phase 4 uses.
 */
function getModelStoreys(ifcText) {
  return parseStoreys(ifcText).map(s => ({
    fmguid: s.fmguid,
    name: s.name || null,
    globalId: s.globalId,
    lineId: s.lineId,
  }));
}

/**
 * Build the reconciliation matrix.
 *
 * @param {{fmguid, name, sequence}[]} canonicalStoreys - from Phase 1 or Phase 2
 * @param {{modelName: string, ifcText: string}[]} models
 * @returns {{
 *   canonicalStoreys: Array,
 *   models: string[],
 *   rows: Array<{
 *     canonical: { fmguid, name, sequence },
 *     cells: Record<string, { modelStorey, suggestedCanonicalFmguid, confidence } | null>
 *   }>,
 *   unmatched: Array<{ modelName, modelStorey }>  // model storeys with no canonical suggestion at all
 * }}
 */
function buildMatrix(canonicalStoreys, models) {
  const parsedModels = models.map(({ modelName, ifcText }) => ({
    modelName,
    storeys: getModelStoreys(ifcText),
  }));

  const canonicalByFmguid = new Map(canonicalStoreys.map(c => [c.fmguid, c]));
  const canonicalByNormName = new Map(
    canonicalStoreys
      .filter(c => c.name)
      .map(c => [normalizeStoreyName(c.name), c])
  );

  const rows = canonicalStoreys.map(canonical => ({ canonical, cells: {} }));
  const rowByFmguid = new Map(rows.map(r => [r.canonical.fmguid, r]));
  const unmatched = [];

  for (const { modelName, storeys } of parsedModels) {
    for (const modelStorey of storeys) {
      // 1. FMGUID match — highest confidence, e.g. a re-upload or a
      //    discipline that already carries the correct shared storey GUID.
      let canonical = modelStorey.fmguid ? canonicalByFmguid.get(modelStorey.fmguid) : null;
      let confidence = canonical ? 'fmguid-match' : null;

      // 2. Normalized name similarity — fallback suggestion only.
      if (!canonical) {
        const normName = normalizeStoreyName(modelStorey.name);
        canonical = normName ? canonicalByNormName.get(normName) : null;
        confidence = canonical ? 'name-match' : null;
      }

      if (canonical) {
        rowByFmguid.get(canonical.fmguid).cells[modelName] = {
          modelStorey,
          suggestedCanonicalFmguid: canonical.fmguid,
          confidence,
        };
      } else {
        // No suggestion at all — force explicit user action instead of guessing.
        unmatched.push({ modelName, modelStorey });
      }
    }
  }

  return {
    canonicalStoreys,
    models: models.map(m => m.modelName),
    rows,
    unmatched,
  };
}

/**
 * Apply user-confirmed mappings (write-back target, in memory).
 *
 * @param {ReturnType<typeof buildMatrix>} matrix
 * @param {Record<string, Record<string, string|null>>} overrides
 *   modelName -> modelStorey.globalId -> canonicalFmguid (or null to unmap).
 *   Only pass entries the user changed from the suggestion; anything not
 *   overridden keeps the matrix's suggested mapping.
 * @returns {Array<{ modelName, globalId, name, canonicalFmguid, canonicalName }>}
 *   Flat list of confirmed writes — one per model storey that ends up
 *   mapped to a canonical row. This is what Phase 7 (commit/export) stamps
 *   back into each IFC file (canonical name + FMGUID replacing the model's
 *   own values on that IFCBUILDINGSTOREY entity).
 */
function applyReconciliation(matrix, overrides = {}) {
  const writes = [];
  const canonicalByFmguid = new Map(matrix.canonicalStoreys.map(c => [c.fmguid, c]));

  const addWrite = (modelName, modelStorey, finalCanonicalFmguid) => {
    if (!finalCanonicalFmguid) return; // user explicitly left this unmapped
    const canonical = canonicalByFmguid.get(finalCanonicalFmguid);
    if (!canonical) return;

    writes.push({
      modelName,
      globalId: modelStorey.globalId,
      name: modelStorey.name,
      canonicalFmguid: canonical.fmguid,
      canonicalName: canonical.name,
    });
  };

  // Cells the auto-suggest already matched to a canonical row.
  for (const row of matrix.rows) {
    for (const modelName of matrix.models) {
      const cell = row.cells[modelName];
      if (!cell) continue;

      const override = overrides[modelName]?.[cell.modelStorey.globalId];
      const finalCanonicalFmguid = override !== undefined ? override : cell.suggestedCanonicalFmguid;
      addWrite(modelName, cell.modelStorey, finalCanonicalFmguid);
    }
  }

  // Storeys buildMatrix() couldn't suggest anything for — only reachable via
  // an explicit user override (there is no default suggestion to fall back
  // to), which is exactly the manual-assignment path the UI's "unmatched"
  // section exists for.
  for (const { modelName, modelStorey } of matrix.unmatched) {
    const override = overrides[modelName]?.[modelStorey.globalId];
    if (override === undefined) continue; // still genuinely unmatched — no write
    addWrite(modelName, modelStorey, override);
  }

  return writes;
}

export { buildMatrix, applyReconciliation, normalizeStoreyName, getModelStoreys };
