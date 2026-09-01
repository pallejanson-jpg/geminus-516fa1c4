/**
 * federation-guid-validator.js
 *
 * Phase 5 of the IFC federation pipeline (docs/plans/ifc-federation-plan.md).
 *
 * Runs FMGUID validation ACROSS all discipline models uploaded for one
 * building, not per file — that's the part existing code doesn't do yet.
 * ifc-fmguid-prep/index.ts already does presence-check + generation for a
 * single file; this module reuses the same STEP-text parsing approach
 * (ported from there, and from architect-model-template.js's narrower
 * storey-only version) but extended to all product types, and adds the
 * genuinely new piece: a global `FMGUID -> [locations]` map across every
 * uploaded model, so a duplicate ANYWHERE in the federation is caught.
 *
 * Business rules enforced here (see plan):
 *  - IfcBuildingStorey is the one entity type allowed to share an FMGUID
 *    across models — never flagged as a duplicate.
 *  - Every other object's FMGUID must be globally unique. Missing -> generate.
 *    Duplicate -> hard blocker, re-minted (never treated as legitimate in v1).
 */

import { readFile } from 'node:fs/promises';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { deriveFmGuidFromIfcGuid } from './deterministic-guid.js';

// Same product-type allowlist as ifc-fmguid-prep/index.ts.
const IFC_PRODUCT_TYPES = new Set([
  'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCZONE',
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCCURTAINWALL',
  'IFCDOOR', 'IFCWINDOW',
  'IFCSLAB', 'IFCROOF', 'IFCSTAIR', 'IFCSTAIRFLIGHT',
  'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCCOLUMN', 'IFCBEAM', 'IFCMEMBER',
  'IFCPLATE', 'IFCCOVERING', 'IFCRAILING',
  'IFCFURNISHINGELEMENT', 'IFCFURNITURE',
  'IFCFLOWTERMINAL', 'IFCFLOWSEGMENT', 'IFCFLOWFITTING',
  'IFCFLOWCONTROLLER', 'IFCFLOWMOVINGDEVICE',
  'IFCFLOWSTORAGEDEVICE', 'IFCFLOWTREATMENTDEVICE',
  'IFCENERGYCONVERSIONDEVICE',
  'IFCPIPESEGMENT', 'IFCPIPEFITTING',
  'IFCDUCTSEGMENT', 'IFCDUCTFITTING',
  'IFCCABLECARRIERSEGMENT', 'IFCCABLESEGMENT',
  'IFCBUILDINGELEMENTPROXY',
  'IFCALARM', 'IFCSENSOR', 'IFCACTUATOR',
  'IFCDISTRIBUTIONELEMENT', 'IFCELECTRICALELEMENT',
  'IFCMEDICALDEVICE', 'IFCPROTECTIVEDEVICE',
  'IFCSWITCHINGDEVICE', 'IFCTRANSFORMER',
  'IFCLIGHTFIXTURE', 'IFCOUTLET',
]);

function extractFirstAttr(attrs) {
  const m = attrs.match(/^'([^']+)'/);
  return m ? m[1] : '';
}

function extractNameAttr(attrs) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of attrs) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  if (parts.length >= 3) {
    const raw = parts[2].trim();
    const m = raw.match(/^'([^']*)'$/);
    return m ? m[1] : (raw === '$' ? '' : raw);
  }
  return '';
}

/**
 * Parse one model's IFC text into { lineId, ifcType, globalId, name, fmguid }[].
 * `onProgress(fraction)` is optional and cosmetic; the periodic
 * `await yieldToEventLoop()` alongside it is NOT cosmetic — see
 * architect-model-template.js's parseStoreys for why a purely synchronous
 * version of this loop makes a Node HTTP server unable to answer its own
 * progress-polling endpoint while this runs (confirmed in practice).
 */
async function parseElements(ifcText, onProgress) {
  const elements = [];
  const propMap = new Map();
  const psetProps = new Map();
  const elementPsets = new Map();

  const lines = ifcText.split(/\r?\n/);
  let buffer = '';
  const entities = [];

  const total = lines.length;
  const reportEvery = Math.max(1, Math.floor(total / 100));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i % reportEvery === 0) {
      onProgress?.(i / total);
      await yieldToEventLoop();
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('//')) continue;
    buffer += ' ' + trimmed;
    if (trimmed.endsWith(';')) {
      const entityLine = buffer.trim();
      buffer = '';
      const m = entityLine.match(/^#(\d+)\s*=\s*([A-Z][A-Z0-9]*)\s*\(([^]*)\)\s*;$/);
      if (m) entities.push({ lineId: m[1], rest: `${m[2]}|${m[3]}` });
    }
  }
  onProgress?.(1);

  for (const { lineId, rest } of entities) {
    const pipeIdx = rest.indexOf('|');
    const ifcType = rest.substring(0, pipeIdx).toUpperCase();
    const attrs = rest.substring(pipeIdx + 1);

    if (IFC_PRODUCT_TYPES.has(ifcType)) {
      const globalId = extractFirstAttr(attrs);
      const name = extractNameAttr(attrs);
      if (globalId) elements.push({ lineId, ifcType, globalId, name, fmguid: null });
    } else if (ifcType === 'IFCPROPERTYSINGLEVALUE') {
      const parts = attrs.split(',').map(s => s.trim());
      if (parts.length >= 3) {
        const rawName = parts[0].replace(/^'|'$/g, '');
        let rawValue = parts[2];
        const vm = rawValue.match(/IFC[A-Z]+\('([^']*)'\)/i);
        if (vm) rawValue = vm[1];
        else rawValue = rawValue.replace(/^'|'$/g, '');
        propMap.set(lineId, { name: rawName, value: rawValue });
      }
    } else if (ifcType === 'IFCPROPERTYSET') {
      const refMatch = attrs.match(/\(([^)]*)\)\s*$/);
      if (refMatch) {
        const refs = refMatch[1].split(',').map(r => r.trim().replace(/^#/, '')).filter(Boolean);
        psetProps.set(lineId, refs);
      }
    } else if (ifcType === 'IFCRELDEFINESBYPROPERTIES') {
      const parts = attrs.split(',').map(s => s.trim());
      if (parts.length >= 6) {
        const relObjs = parts[4];
        const psetRef = parts[5].replace(/^#/, '');
        const objRefs = [...relObjs.matchAll(/#(\d+)/g)].map(m => m[1]);
        for (const objRef of objRefs) {
          if (!elementPsets.has(objRef)) elementPsets.set(objRef, []);
          elementPsets.get(objRef).push(psetRef);
        }
      }
    }
  }

  for (const el of elements) {
    const psetIds = elementPsets.get(el.lineId) || [];
    outer:
    for (const psetId of psetIds) {
      const propIds = psetProps.get(psetId) || [];
      for (const propId of propIds) {
        const prop = propMap.get(propId);
        if (prop && prop.name.toLowerCase() === 'fmguid' && prop.value) {
          el.fmguid = prop.value;
          break outer;
        }
      }
    }
  }

  return elements;
}

/**
 * Validate FMGUIDs across the whole federation.
 *
 * @param {{ modelName: string, ifcText: string }[]} models
 * @param {{ onProgress?: (modelName: string, overallFraction: number) => void }} [opts]
 *   Optional, cosmetic only. `overallFraction` (0-1) is weighted by each
 *   model's text length relative to the federation's total, so a UI
 *   progress bar advances proportionally to how much text has actually
 *   been parsed — not just "1 of N files done", which would jump unevenly
 *   for a federation mixing a 276 MB architect file with a 2 MB one.
 * @returns {{
 *   elements: Array<{ modelName, lineId, ifcType, globalId, name, fmguid, isStorey }>,
 *   duplicates: Array<{ fmguid, locations: Array<{ modelName, ifcType, globalId, name }> }>,
 *   stats: { totalElements, storeyElements, hadFmguid, missing, duplicateGroups, duplicateElements }
 * }}
 */
async function validateFederation(models, opts = {}) {
  const { onProgress } = opts;
  const totalChars = models.reduce((sum, m) => sum + m.ifcText.length, 0) || 1;

  const elements = [];
  let charsDoneBefore = 0;
  for (const { modelName, ifcText } of models) {
    const modelChars = ifcText.length;
    const parsed = await (onProgress
      ? parseElements(ifcText, (fraction) => onProgress(modelName, (charsDoneBefore + fraction * modelChars) / totalChars))
      : parseElements(ifcText));
    for (const el of parsed) {
      elements.push({ modelName, ...el, isStorey: el.ifcType === 'IFCBUILDINGSTOREY' });
    }
    charsDoneBefore += modelChars;
  }
  onProgress?.(null, 1);

  return { elements, ...computeValidationStats(elements) };
}

/**
 * Recomputes `duplicates`/`stats` from the current state of `elements` —
 * shared by `validateFederation()` (first pass, after parsing) and callers
 * that mutate `elements` afterward (e.g. /api/apply-fmguid, after
 * `repairFederation` scoped to a chosen set of categories) and need fresh
 * numbers reflecting those mutations.
 */
function computeValidationStats(elements) {
  // Global map, storeys excluded — they're allowed (expected) to repeat.
  const byFmguid = new Map();
  for (const el of elements) {
    if (el.isStorey || !el.fmguid) continue;
    if (!byFmguid.has(el.fmguid)) byFmguid.set(el.fmguid, []);
    byFmguid.get(el.fmguid).push(el);
  }

  const duplicates = [];
  for (const [fmguid, locations] of byFmguid) {
    if (locations.length > 1) {
      duplicates.push({
        fmguid,
        locations: locations.map(({ modelName, ifcType, globalId, name }) => ({ modelName, ifcType, globalId, name })),
      });
    }
  }

  const missing = elements.filter(el => !el.fmguid).length;
  const hadFmguid = elements.filter(el => el.fmguid).length;

  return {
    duplicates,
    stats: {
      totalElements: elements.length,
      storeyElements: elements.filter(el => el.isStorey).length,
      hadFmguid,
      missing,
      duplicateGroups: duplicates.length,
      duplicateElements: duplicates.reduce((sum, d) => sum + d.locations.length, 0),
    },
  };
}

/**
 * Apply repairs to a `validateFederation()` result, in place on `elements`.
 * Storeys are always left untouched — their shared-FMGUID reconciliation is
 * Phase 4's job, not this one's.
 *
 * @param {ReturnType<typeof validateFederation>} result
 * @param {{ regenerateAll?: boolean }} [opts]
 *   Default behavior (`regenerateAll: false`, or omitted) respects any
 *   FMGUID an object already carries:
 *    - Missing FMGUID -> generate a new one.
 *    - Duplicate (non-storey) FMGUID -> keep the first occurrence's existing
 *      value, re-mint a fresh one for every later occurrence. No "same
 *      object in two models" exception in v1 (per plan) — every duplicate
 *      is treated as an error.
 *   `regenerateAll: true` instead mints a brand-new FMGUID for every
 *   non-storey object regardless of what it already had — for the case
 *   where existing FMGUIDs in the source files are not trusted and a clean
 *   slate is wanted instead of a minimal patch.
 *
 *   Every freshly-minted FMGUID (missing, forced-regenerate, or a
 *   duplicate's later occurrence) is derived from that element's own
 *   IfcGuid (see deterministic-guid.js), not random: if this same model
 *   comes back later re-exported with the same IfcGuid on this object, the
 *   same FMGUID must come out again, or downstream systems will think it's
 *   a new object. This also means a duplicate caused by two DIFFERENT
 *   elements accidentally sharing one existing FMGUID value resolves
 *   correctly (each keeps/gets its own IfcGuid-derived identity), while a
 *   duplicate caused by two elements sharing the same native IfcGuid (a
 *   real, confirmed case — see ifc-writer.js's buildIndex note) consistently
 *   derives the same value for both, matching how the writer already treats
 *   that situation.
 * Returns the same `elements` array, now with every non-storey FMGUID unique
 * and every missing FMGUID filled in.
 */
function repairFederation({ elements }, opts = {}) {
  const { regenerateAll = false, includeTypes = null } = opts;
  const seenNonStorey = new Set();

  for (const el of elements) {
    if (el.isStorey) continue;
    // includeTypes lets the caller scope generation to a chosen subset of
    // categories (e.g. from the IDS validation tab's per-category picker) —
    // an element outside that set is left exactly as parsed, whether that
    // means keeping an existing FMGUID or staying missing.
    if (includeTypes && !includeTypes.has(el.ifcType)) continue;

    if (regenerateAll || !el.fmguid || seenNonStorey.has(el.fmguid)) {
      // Missing, forced-regenerate, or a duplicate's later occurrence — mint
      // deterministically from this element's own IfcGuid.
      el.fmguid = deriveFmGuidFromIfcGuid(el.globalId);
    }
    seenNonStorey.add(el.fmguid);
  }

  return elements;
}

/**
 * Per-IFC-type breakdown of FMGUID coverage, for the "which categories have
 * FMGUID and which don't" report — storeys excluded (they're handled by the
 * separate storey-reconciliation flow, not this per-object one).
 * @returns {Array<{ ifcType: string, total: number, withFmguid: number, missing: number }>}
 *   Sorted by ifcType.
 */
function categoryCounts(elements) {
  const byType = new Map();
  for (const el of elements) {
    if (el.isStorey) continue;
    if (!byType.has(el.ifcType)) byType.set(el.ifcType, { ifcType: el.ifcType, total: 0, withFmguid: 0, missing: 0 });
    const c = byType.get(el.ifcType);
    c.total++;
    if (el.fmguid) c.withFmguid++;
    else c.missing++;
  }
  return [...byType.values()].sort((a, b) => a.ifcType.localeCompare(b.ifcType));
}

export { validateFederation, repairFederation, parseElements, categoryCounts, computeValidationStats };

// ── Manual CLI check: node ifc-federation/federation-guid-validator.js <file1.ifc> <file2.ifc> ... ──
import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filePaths = process.argv.slice(2);
  if (filePaths.length < 1) {
    console.error('Usage: node ifc-federation/federation-guid-validator.js <file1.ifc> [file2.ifc ...]');
    process.exit(1);
  }

  (async () => {
    const models = await Promise.all(filePaths.map(async (filePath) => ({
      modelName: filePath,
      ifcText: await readFile(filePath, 'utf8'),
    })));

    const result = await validateFederation(models);
    console.log(`Total elements: ${result.stats.totalElements} (storeys: ${result.stats.storeyElements})`);
    console.log(`Had FmGuid: ${result.stats.hadFmguid}  Missing: ${result.stats.missing}`);
    console.log(`Duplicate FMGUID groups: ${result.stats.duplicateGroups} (${result.stats.duplicateElements} elements affected)`);

    for (const dup of result.duplicates) {
      console.log(`\n  DUPLICATE ${dup.fmguid}:`);
      for (const loc of dup.locations) {
        console.log(`    - ${loc.modelName} :: ${loc.ifcType} "${loc.name}" (${loc.globalId})`);
      }
    }

    repairFederation(result);
    const nonStoreyGuids = result.elements.filter(el => !el.isStorey).map(el => el.fmguid);
    const uniqueCount = new Set(nonStoreyGuids).size;
    console.log(`\nAfter repair: ${nonStoreyGuids.length} non-storey elements, ${uniqueCount} unique FMGUIDs (${uniqueCount === nonStoreyGuids.length ? 'OK' : 'STILL DUPLICATED'})`);
  })().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
