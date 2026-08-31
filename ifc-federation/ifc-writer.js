/**
 * ifc-writer.js
 *
 * Phase 7 of the IFC federation pipeline (docs/plans/ifc-federation-plan.md).
 *
 * Writes confirmed data back into an IFC file, in place, as plain STEP text —
 * the same representation Phase 2/5 already parse (this pipeline never used
 * `web-ifc`; there is no reason to introduce it just to write). Two kinds of
 * write, both driven by data already produced by earlier phases:
 *
 *  - Storey write-back (Phase 4's `applyReconciliation()` output): stamp the
 *    canonical name + FMGUID into a matched `IfcBuildingStorey`'s Name
 *    attribute and `FmGuid` property.
 *  - Object-level FMGUID write-back (Phase 5's `repairFederation()` output):
 *    stamp a generated/re-minted FMGUID into an element's `FmGuid` property.
 *
 * Both cases reduce to the same primitive: "ensure element with this
 * GlobalId has an `FmGuid` property set to this value" (create the
 * property/pset/rel chain if it doesn't exist yet, otherwise overwrite the
 * existing value), plus, for storeys only, "and also set its Name attribute."
 *
 * Caveat shared with every other phase's parser: this operates on the
 * reconstructed single-line form of each entity. STEP doesn't require any
 * particular line-wrapping, so this is semantically safe, but a real
 * multi-line-formatted export will come out reformatted (one line per
 * entity) rather than byte-identical. Not yet verified against a real
 * Revit/other-tool export — see the Phase 2/5 caveins, same caveat applies.
 */

import { randomUUID } from 'node:crypto';

/** Same first-attribute / attribute-splitting helpers as the other modules. */
function splitAttrs(attrs) {
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
  return parts;
}

function unquote(raw) {
  const m = raw.match(/^'([^']*)'$/);
  return m ? m[1] : raw;
}

function quote(value) {
  return `'${String(value).replace(/'/g, "\\'")}'`;
}

/**
 * Locate every entity in the IFC text, tracking the original line range
 * (start/end index into `lines`) so it can be replaced verbatim, plus the
 * concatenated single-line form used for parsing (same approach as
 * ifc-fmguid-prep/index.ts, architect-model-template.js, federation-guid-validator.js).
 */
function locateEntities(ifcText) {
  const lines = ifcText.split(/\r?\n/);
  const entities = [];
  let buffer = '';
  let startLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('//')) continue;
    if (startLineIdx === -1) startLineIdx = i;
    buffer += ' ' + trimmed;
    if (trimmed.endsWith(';')) {
      const entityLine = buffer.trim();
      buffer = '';
      const m = entityLine.match(/^#(\d+)\s*=\s*([A-Z][A-Z0-9]*)\s*\(([^]*)\)\s*;$/);
      if (m) {
        entities.push({
          lineId: m[1],
          ifcType: m[2].toUpperCase(),
          attrsText: m[3],
          startLineIdx,
          endLineIdx: i,
        });
      }
      startLineIdx = -1;
    }
  }

  return { lines, entities };
}

function serializeEntity(entity) {
  return `#${entity.lineId}=${entity.ifcType}(${entity.attrsText});`;
}

function nextLineId(entities) {
  let max = 0;
  for (const e of entities) max = Math.max(max, parseInt(e.lineId, 10));
  return max;
}

/** Find the line index of the last `ENDSEC;` (end of the DATA section) to insert new entities before it. */
function findDataSectionEnd(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === 'ENDSEC;') return i;
  }
  return lines.length; // fallback: append at the very end
}

/**
 * Build O(1)-lookup indices over `entities` once, up front, instead of
 * re-scanning the whole entity list for every write. A real IFC file easily
 * has tens of thousands of entities; without this, `ensureFmGuid` scanning
 * `entities` (and every IFCRELDEFINESBYPROPERTIES in it) per assignment made
 * a full federation-wide write pass effectively O(elements × entities) —
 * confirmed to hang for minutes on a single real 2.2 MB / ~1,100-element
 * discipline file before this fix. With the index this is O(entities) to
 * build plus O(1) (amortized) per write.
 */
function buildIndex(entities) {
  const byLineId = new Map(entities.map(e => [e.lineId, e]));
  // globalId -> entity[], NOT a single entity: confirmed against a real
  // Science Tower export that the same native IFC GlobalId can legitimately
  // appear on two distinct entities (e.g. two separate IFCFLOWTERMINAL lines,
  // different line numbers, identical GlobalId — 147 such pairs in one real
  // 2.4 MB file alone). A single-entity map silently picked one arbitrarily,
  // leaving the other with no FmGuid written at all — a real data-loss bug,
  // not a hypothetical one.
  const byGlobalId = new Map();
  const relsByElementLineId = new Map();

  for (const e of entities) {
    const firstAttr = splitAttrs(e.attrsText)[0];
    if (firstAttr) {
      const gid = unquote(firstAttr);
      if (gid && gid !== firstAttr) { // only real quoted GlobalIds, not e.g. "$"
        if (!byGlobalId.has(gid)) byGlobalId.set(gid, []);
        byGlobalId.get(gid).push(e);
      }
    }

    if (e.ifcType === 'IFCRELDEFINESBYPROPERTIES') {
      const relAttrs = splitAttrs(e.attrsText);
      if (relAttrs.length < 6) continue;
      const objRefs = [...relAttrs[4].matchAll(/#(\d+)/g)].map(m => m[1]);
      for (const objRef of objRefs) {
        if (!relsByElementLineId.has(objRef)) relsByElementLineId.set(objRef, []);
        relsByElementLineId.get(objRef).push(e);
      }
    }
  }

  return { entities, byLineId, byGlobalId, relsByElementLineId, nextId: nextLineId(entities) };
}

/**
 * Ensure ONE specific entity has an `FmGuid` property set to `fmguid`.
 * Mutates `index` in place (including appending new entities and indexing
 * them) and returns { created: boolean }.
 */
function ensureFmGuidOnEntity(index, element, fmguid) {
  // Walk IFCRELDEFINESBYPROPERTIES -> IFCPROPERTYSET -> IFCPROPERTYSINGLEVALUE
  // to see if an FmGuid property is already wired to this element.
  for (const rel of index.relsByElementLineId.get(element.lineId) ?? []) {
    const relAttrs = splitAttrs(rel.attrsText);
    const psetRef = relAttrs[5].replace(/^#/, '');
    const pset = index.byLineId.get(psetRef);
    if (!pset || pset.ifcType !== 'IFCPROPERTYSET') continue;

    const refMatch = pset.attrsText.match(/\(([^)]*)\)\s*$/);
    const propRefs = refMatch ? refMatch[1].split(',').map(r => r.trim().replace(/^#/, '')).filter(Boolean) : [];

    for (const propRef of propRefs) {
      const prop = index.byLineId.get(propRef);
      if (!prop || prop.ifcType !== 'IFCPROPERTYSINGLEVALUE') continue;
      const propAttrs = splitAttrs(prop.attrsText);
      if (unquote(propAttrs[0]).toLowerCase() !== 'fmguid') continue;

      // Found the existing FmGuid property — overwrite its value in place.
      propAttrs[2] = `IFCTEXT(${quote(fmguid)})`;
      prop.attrsText = propAttrs.join(',');
      return { created: false };
    }
  }

  // No existing FmGuid property chain — create one and wire it up.
  // Reuse the element's own OwnerHistory reference (2nd attribute) so the
  // new entities point at a valid, already-defined owner history.
  const elementAttrs = splitAttrs(element.attrsText);
  const ownerHistoryRef = elementAttrs[1] ?? '$';

  const propId = String(++index.nextId);
  const psetId = String(++index.nextId);
  const relId = String(++index.nextId);

  const propEntity = { lineId: propId, ifcType: 'IFCPROPERTYSINGLEVALUE', attrsText: `${quote('FmGuid')},$,IFCTEXT(${quote(fmguid)}),$` };
  const psetEntity = { lineId: psetId, ifcType: 'IFCPROPERTYSET', attrsText: `${quote(randomUUID())},${ownerHistoryRef},${quote('FM_Pset')},'',(#${propId})` };
  const relEntity = { lineId: relId, ifcType: 'IFCRELDEFINESBYPROPERTIES', attrsText: `${quote(randomUUID())},${ownerHistoryRef},$,$,(#${element.lineId}),#${psetId}` };

  index.entities.push(propEntity, psetEntity, relEntity);
  index.byLineId.set(propId, propEntity);
  index.byLineId.set(psetId, psetEntity);
  index.byLineId.set(relId, relEntity);
  if (!index.relsByElementLineId.has(element.lineId)) index.relsByElementLineId.set(element.lineId, []);
  index.relsByElementLineId.get(element.lineId).push(relEntity);

  return { created: true };
}

/**
 * Ensure EVERY entity with `globalId` has an `FmGuid` property set to
 * `fmguid` — plural because a native IFC GlobalId can legitimately be shared
 * by more than one entity in a real file (see `buildIndex`'s note). Applying
 * the same value to all of them is the safe default: it guarantees no entity
 * silently ends up with nothing written, at the cost of those entities then
 * sharing an FMGUID the same way storeys intentionally do — an acceptable
 * trade-off for a case business rule 3 didn't anticipate (that rule assumes
 * "same GlobalId" implies "same object", which usually holds but isn't
 * guaranteed by the IFC spec).
 */
function ensureFmGuid(index, globalId, fmguid) {
  const matches = index.byGlobalId.get(globalId);
  if (!matches || matches.length === 0) return { created: false, error: `No entity found with GlobalId ${globalId}` };

  let created = false;
  for (const element of matches) {
    if (ensureFmGuidOnEntity(index, element, fmguid).created) created = true;
  }
  return { created };
}

/** Set the Name attribute (3rd, index 2) on every entity with `globalId`. */
function setName(index, globalId, name) {
  const matches = index.byGlobalId.get(globalId);
  if (!matches || matches.length === 0) return { error: `No entity found with GlobalId ${globalId}` };

  for (const element of matches) {
    const attrs = splitAttrs(element.attrsText);
    if (attrs.length < 3) return { error: `Entity ${globalId} has too few attributes to hold a Name` };
    attrs[2] = quote(name);
    element.attrsText = attrs.join(',');
  }
  return {};
}

/**
 * Apply Phase 4's storey write-back list and/or Phase 5's object-level GUID
 * repairs to one model's IFC text. Returns the rewritten text.
 *
 * @param {string} ifcText
 * @param {object} writes
 * @param {Array<{globalId, canonicalFmguid, canonicalName}>} [writes.storeyWrites]
 *   Entries from applyReconciliation() belonging to THIS file only (filter
 *   by modelName before calling — this function is single-file).
 * @param {Array<{globalId, fmguid}>} [writes.guidAssignments]
 *   Non-storey elements from repairFederation() belonging to THIS file only.
 */
function applyFederationWrites(ifcText, { storeyWrites = [], guidAssignments = [] } = {}) {
  const { lines, entities } = locateEntities(ifcText);
  const index = buildIndex(entities);
  const report = { storeysWritten: 0, guidsWritten: 0, guidsCreated: 0, errors: [] };

  for (const write of storeyWrites) {
    const nameResult = setName(index, write.globalId, write.canonicalName ?? '');
    if (nameResult.error) { report.errors.push(nameResult.error); continue; }
    const guidResult = ensureFmGuid(index, write.globalId, write.canonicalFmguid);
    if (guidResult.error) { report.errors.push(guidResult.error); continue; }
    if (guidResult.created) report.guidsCreated++;
    report.storeysWritten++;
  }

  for (const assignment of guidAssignments) {
    const result = ensureFmGuid(index, assignment.globalId, assignment.fmguid);
    if (result.error) { report.errors.push(result.error); continue; }
    if (result.created) report.guidsCreated++;
    report.guidsWritten++;
  }

  // Rebuild the file: replace each original entity's line range with its
  // (possibly modified) single-line form, in original line order, then
  // append brand-new entities just before the DATA section's ENDSEC.
  const byStartLine = new Map(entities.filter(e => e.startLineIdx !== undefined).map(e => [e.startLineIdx, e]));
  const consumedThrough = new Map(entities.filter(e => e.endLineIdx !== undefined).map(e => [e.startLineIdx, e.endLineIdx]));

  const outputLines = [];
  let i = 0;
  while (i < lines.length) {
    const entity = byStartLine.get(i);
    if (entity) {
      outputLines.push(serializeEntity(entity));
      i = consumedThrough.get(i) + 1;
    } else {
      outputLines.push(lines[i]);
      i++;
    }
  }

  const newEntities = entities.filter(e => e.startLineIdx === undefined);
  let finalLines = outputLines;
  if (newEntities.length > 0) {
    // Real federations can generate tens of thousands of brand-new entities
    // (e.g. every element in a file with zero pre-existing FmGuid properties
    // needs a new property/pset/rel triplet). `Array.prototype.splice(i, 0,
    // ...items)` passes each item as a call argument — confirmed to throw
    // "Maximum call stack size exceeded" once `newEntities` reaches roughly
    // this order of magnitude. `concat` takes whole arrays as arguments
    // instead of spreading their contents onto the call stack, so it has no
    // such limit.
    const insertAt = findDataSectionEnd(outputLines);
    finalLines = outputLines.slice(0, insertAt).concat(newEntities.map(serializeEntity), outputLines.slice(insertAt));
  }

  return { ifcText: finalLines.join('\n'), report };
}

export { applyFederationWrites, locateEntities };
