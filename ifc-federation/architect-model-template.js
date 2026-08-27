/**
 * architect-model-template.js
 *
 * Phase 2 of the IFC federation pipeline (docs/plans/ifc-federation-plan.md).
 *
 * Fallback path for when Phase 1 (geminus-plus-lookup.js) finds no existing
 * building in Geminus Plus: the uploaded architect IFC model becomes the
 * authoritative storey structure instead. Produces the same canonical shape
 * as Phase 1 — [{ fmguid, name, sequence }] — so the reconciliation matrix
 * (Phase 4) doesn't need to know which source it came from.
 *
 * The IFC text-parsing logic (parseIfcText) is ported near-verbatim from
 * supabase/functions/ifc-fmguid-prep/index.ts, which already does this same
 * job (detect existing FmGuid property, generate one when absent) for ALL
 * product types. This module narrows that same parser to IFCBUILDINGSTOREY
 * specifically, since Phase 2 only cares about the storey structure — object-
 * level FMGUID handling (all product types) stays in ifc-fmguid-prep / a
 * later cross-model pass (Phase 5).
 *
 * Confirmed IFC property name is `FmGuid` (case-insensitive match), not
 * `FM_GUID` — see ifc-fmguid-prep/index.ts:204.
 */

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Same first-attribute / name-attribute extraction as ifc-fmguid-prep/index.ts.
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
  // GlobalId, OwnerHistory, Name — Name is index 2
  if (parts.length >= 3) {
    const raw = parts[2].trim();
    const m = raw.match(/^'([^']*)'$/);
    return m ? m[1] : (raw === '$' ? '' : raw);
  }
  return '';
}

/**
 * Parse IFC STEP text and return every IFCBUILDINGSTOREY entity with its
 * GlobalId, Name, and (if present) FmGuid property value.
 *
 * Same three-pass approach as ifc-fmguid-prep/index.ts: collect property
 * values, collect which properties belong to which property set, collect
 * which property sets are attached to which element via
 * IFCRELDEFINESBYPROPERTIES, then resolve FmGuid per storey.
 */
function parseStoreys(ifcText) {
  const storeys = [];
  const propMap = new Map();       // prop line id -> { name, value }
  const psetProps = new Map();     // pset line id -> [prop line ids]
  const elementPsets = new Map();  // element line id -> [pset line ids]

  const lines = ifcText.split(/\r?\n/);
  let buffer = '';
  const entities = [];

  for (const line of lines) {
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

  for (const { lineId, rest } of entities) {
    const pipeIdx = rest.indexOf('|');
    const ifcType = rest.substring(0, pipeIdx).toUpperCase();
    const attrs = rest.substring(pipeIdx + 1);

    if (ifcType === 'IFCBUILDINGSTOREY') {
      const globalId = extractFirstAttr(attrs);
      const name = extractNameAttr(attrs);
      if (globalId) storeys.push({ lineId, globalId, name });
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

  for (const storey of storeys) {
    storey.fmguid = null;
    const psetIds = elementPsets.get(storey.lineId) || [];
    outer:
    for (const psetId of psetIds) {
      const propIds = psetProps.get(psetId) || [];
      for (const propId of propIds) {
        const prop = propMap.get(propId);
        if (prop && prop.name.toLowerCase() === 'fmguid' && prop.value) {
          storey.fmguid = prop.value;
          break outer;
        }
      }
    }
  }

  return storeys;
}

/**
 * Build the canonical storey list from an architect IFC model.
 * Storeys with no FmGuid property get a freshly generated one — this becomes
 * the reference value every other discipline model must align to (business
 * rule: storeys are the one entity type allowed to share an FMGUID).
 *
 * No `sequence` is derivable from text parsing alone (and, per Phase 1
 * findings, no reliable elevation field exists in Geminus Plus either) —
 * `sequence` is always `null` here, matching the shape from
 * geminus-plus-lookup.js's getStoreysForBuilding().
 */
function buildCanonicalStoreys(ifcText) {
  const parsed = parseStoreys(ifcText);
  return parsed.map(s => ({
    fmguid: s.fmguid ?? randomUUID(),
    name: s.name || null,
    sequence: null,
  }));
}

async function getArchitectStoreysFromFile(filePath) {
  const ifcText = await readFile(filePath, 'utf8');
  return buildCanonicalStoreys(ifcText);
}

export { buildCanonicalStoreys, getArchitectStoreysFromFile, parseStoreys };

// ── Manual CLI check: node ifc-federation/architect-model-template.js <path-to.ifc> ──
import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node ifc-federation/architect-model-template.js <path-to.ifc>');
    process.exit(1);
  }

  getArchitectStoreysFromFile(filePath)
    .then(storeys => {
      console.log(`Storeys (${storeys.length}):`);
      for (const s of storeys) {
        console.log(`  ${s.fmguid}  ${s.name ?? '(unnamed)'}`);
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}
