/**
 * Browser-compatible IFC federation pipeline logic.
 * Ported from ifc-federation/*.js — Node-specific APIs replaced with Web APIs.
 * crypto.randomUUID() is available in all modern browsers (Chrome 92+, Firefox 95+).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CanonicalStorey {
  fmguid: string;
  name: string | null;
  sequence: number | null;
}

export interface ModelInput {
  modelName: string;
  ifcText: string;
}

export interface StoreyResult {
  lineId: string;
  globalId: string;
  name: string;
  fmguid: string | null;
}

export interface MatrixCell {
  modelStorey: StoreyResult;
  suggestedCanonicalFmguid: string;
  confidence: 'fmguid-match' | 'name-match';
}

export interface MatrixRow {
  canonical: CanonicalStorey;
  cells: Record<string, MatrixCell | null>;
}

export interface Matrix {
  canonicalStoreys: CanonicalStorey[];
  models: string[];
  rows: MatrixRow[];
  unmatched: { modelName: string; modelStorey: StoreyResult }[];
}

export interface ElementResult {
  modelName: string;
  lineId: string;
  ifcType: string;
  globalId: string;
  name: string;
  fmguid: string | null;
  isStorey: boolean;
}

export interface DuplicateGroup {
  fmguid: string;
  locations: { modelName: string; ifcType: string; globalId: string; name: string }[];
}

export interface ValidationResult {
  elements: ElementResult[];
  duplicates: DuplicateGroup[];
  stats: {
    totalElements: number;
    storeyElements: number;
    hadFmguid: number;
    missing: number;
    duplicateGroups: number;
    duplicateElements: number;
  };
}

export interface WriteItem {
  modelName: string;
  globalId: string;
  name: string;
  canonicalFmguid: string;
  canonicalName: string | null;
}

// ── STEP text parser helpers ──────────────────────────────────────────────────

function extractFirstAttr(attrs: string): string {
  const m = attrs.match(/^'([^']+)'/);
  return m ? m[1] : '';
}

function extractNameAttr(attrs: string): string {
  const parts: string[] = [];
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

interface RawEntity { lineId: string; ifcType: string; attrs: string }

function parseRawEntities(ifcText: string): RawEntity[] {
  const entities: RawEntity[] = [];
  const lines = ifcText.split(/\r?\n/);
  let buffer = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('//')) continue;
    buffer += ' ' + trimmed;
    if (trimmed.endsWith(';')) {
      const entityLine = buffer.trim();
      buffer = '';
      const m = entityLine.match(/^#(\d+)\s*=\s*([A-Z][A-Z0-9]*)\s*\(([^]*)\)\s*;$/);
      if (m) entities.push({ lineId: m[1], ifcType: m[2].toUpperCase(), attrs: m[3] });
    }
  }
  return entities;
}

// Resolve FmGuid properties for a set of elements from shared prop/pset/rel maps
function resolveFmGuids(
  elements: { lineId: string; fmguid: string | null }[],
  propMap: Map<string, { name: string; value: string }>,
  psetProps: Map<string, string[]>,
  elementPsets: Map<string, string[]>,
): void {
  for (const el of elements) {
    const psetIds = elementPsets.get(el.lineId) ?? [];
    outer:
    for (const psetId of psetIds) {
      const propIds = psetProps.get(psetId) ?? [];
      for (const propId of propIds) {
        const prop = propMap.get(propId);
        if (prop && prop.name.toLowerCase() === 'fmguid' && prop.value) {
          el.fmguid = prop.value;
          break outer;
        }
      }
    }
  }
}

function buildPropMaps(entities: RawEntity[]): {
  propMap: Map<string, { name: string; value: string }>;
  psetProps: Map<string, string[]>;
  elementPsets: Map<string, string[]>;
} {
  const propMap = new Map<string, { name: string; value: string }>();
  const psetProps = new Map<string, string[]>();
  const elementPsets = new Map<string, string[]>();

  for (const { lineId, ifcType, attrs } of entities) {
    if (ifcType === 'IFCPROPERTYSINGLEVALUE') {
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
        const refs = refMatch[1].split(',').map((r: string) => r.trim().replace(/^#/, '')).filter(Boolean);
        psetProps.set(lineId, refs);
      }
    } else if (ifcType === 'IFCRELDEFINESBYPROPERTIES') {
      const parts = attrs.split(',').map(s => s.trim());
      if (parts.length >= 6) {
        const relObjs = parts[4];
        const psetRef = parts[5].replace(/^#/, '');
        const objRefs = [...relObjs.matchAll(/#(\d+)/g)].map((m: RegExpMatchArray) => m[1]);
        for (const objRef of objRefs) {
          if (!elementPsets.has(objRef)) elementPsets.set(objRef, []);
          elementPsets.get(objRef)!.push(psetRef);
        }
      }
    }
  }

  return { propMap, psetProps, elementPsets };
}

// ── Storey parsing (Phase 2 equivalent) ──────────────────────────────────────

export function parseStoreys(ifcText: string): StoreyResult[] {
  const entities = parseRawEntities(ifcText);
  const storeys: { lineId: string; globalId: string; name: string; fmguid: string | null }[] = [];

  for (const { lineId, ifcType, attrs } of entities) {
    if (ifcType === 'IFCBUILDINGSTOREY') {
      const globalId = extractFirstAttr(attrs);
      const name = extractNameAttr(attrs);
      if (globalId) storeys.push({ lineId, globalId, name, fmguid: null });
    }
  }

  const { propMap, psetProps, elementPsets } = buildPropMaps(entities);
  resolveFmGuids(storeys, propMap, psetProps, elementPsets);
  return storeys as StoreyResult[];
}

export function buildCanonicalStoreys(ifcText: string): CanonicalStorey[] {
  return parseStoreys(ifcText).map(s => ({
    fmguid: s.fmguid ?? crypto.randomUUID(),
    name: s.name || null,
    sequence: null,
  }));
}

// ── Storey reconciliation matrix (Phase 4 data) ───────────────────────────────

function normalizeStoreyName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim().toLowerCase();
  const numMatch = trimmed.match(/\d+/);
  return numMatch ? numMatch[0].replace(/^0+(?=\d)/, '') : trimmed;
}

export function buildMatrix(canonicalStoreys: CanonicalStorey[], models: ModelInput[]): Matrix {
  const parsedModels = models.map(({ modelName, ifcText }) => ({
    modelName,
    storeys: parseStoreys(ifcText).map(s => ({
      fmguid: s.fmguid,
      name: s.name || null,
      globalId: s.globalId,
      lineId: s.lineId,
    })),
  }));

  const canonicalByFmguid = new Map(canonicalStoreys.map(c => [c.fmguid, c]));
  const canonicalByNormName = new Map(
    canonicalStoreys
      .filter(c => c.name)
      .map(c => [normalizeStoreyName(c.name), c])
  );

  const rows: MatrixRow[] = canonicalStoreys.map(canonical => ({ canonical, cells: {} }));
  const rowByFmguid = new Map(rows.map(r => [r.canonical.fmguid, r]));
  const unmatched: Matrix['unmatched'] = [];

  for (const { modelName, storeys } of parsedModels) {
    for (const modelStorey of storeys) {
      let canonical: CanonicalStorey | undefined;
      let confidence: MatrixCell['confidence'] | null = null;

      if (modelStorey.fmguid) {
        canonical = canonicalByFmguid.get(modelStorey.fmguid);
        if (canonical) confidence = 'fmguid-match';
      }
      if (!canonical) {
        const normName = normalizeStoreyName(modelStorey.name);
        canonical = normName ? canonicalByNormName.get(normName) : undefined;
        if (canonical) confidence = 'name-match';
      }

      if (canonical && confidence) {
        rowByFmguid.get(canonical.fmguid)!.cells[modelName] = {
          modelStorey: modelStorey as StoreyResult,
          suggestedCanonicalFmguid: canonical.fmguid,
          confidence,
        };
      } else {
        unmatched.push({ modelName, modelStorey: modelStorey as StoreyResult });
      }
    }
  }

  return { canonicalStoreys, models: models.map(m => m.modelName), rows, unmatched };
}

export function applyReconciliation(
  matrix: Matrix,
  overrides: Record<string, Record<string, string | null>> = {},
): WriteItem[] {
  const writes: WriteItem[] = [];
  for (const row of matrix.rows) {
    for (const modelName of matrix.models) {
      const cell = row.cells[modelName];
      if (!cell) continue;
      const override = overrides[modelName]?.[cell.modelStorey.globalId];
      const finalFmguid = override !== undefined ? override : cell.suggestedCanonicalFmguid;
      if (!finalFmguid) continue;
      const canonical = matrix.canonicalStoreys.find(c => c.fmguid === finalFmguid);
      if (!canonical) continue;
      writes.push({
        modelName,
        globalId: cell.modelStorey.globalId,
        name: cell.modelStorey.name,
        canonicalFmguid: canonical.fmguid,
        canonicalName: canonical.name,
      });
    }
  }
  return writes;
}

// ── FMGUID validation across models (Phase 5) ────────────────────────────────

const IFC_PRODUCT_TYPES = new Set([
  'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCZONE',
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCCURTAINWALL',
  'IFCDOOR', 'IFCWINDOW', 'IFCSLAB', 'IFCROOF',
  'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAMP', 'IFCRAMPFLIGHT',
  'IFCCOLUMN', 'IFCBEAM', 'IFCMEMBER', 'IFCPLATE',
  'IFCCOVERING', 'IFCRAILING', 'IFCFURNISHINGELEMENT', 'IFCFURNITURE',
  'IFCFLOWTERMINAL', 'IFCFLOWSEGMENT', 'IFCFLOWFITTING',
  'IFCFLOWCONTROLLER', 'IFCFLOWMOVINGDEVICE',
  'IFCFLOWSTORAGEDEVICE', 'IFCFLOWTREATMENTDEVICE',
  'IFCENERGYCONVERSIONDEVICE', 'IFCPIPESEGMENT', 'IFCPIPEFITTING',
  'IFCDUCTSEGMENT', 'IFCDUCTFITTING',
  'IFCCABLECARRIERSEGMENT', 'IFCCABLESEGMENT',
  'IFCBUILDINGELEMENTPROXY', 'IFCALARM', 'IFCSENSOR', 'IFCACTUATOR',
  'IFCDISTRIBUTIONELEMENT', 'IFCELECTRICALELEMENT',
  'IFCMEDICALDEVICE', 'IFCPROTECTIVEDEVICE',
  'IFCSWITCHINGDEVICE', 'IFCTRANSFORMER',
  'IFCLIGHTFIXTURE', 'IFCOUTLET',
]);

function parseElementsForModel(modelName: string, ifcText: string): ElementResult[] {
  const entities = parseRawEntities(ifcText);
  const elements: (ElementResult & { fmguid: string | null })[] = [];

  for (const { lineId, ifcType, attrs } of entities) {
    if (IFC_PRODUCT_TYPES.has(ifcType)) {
      const globalId = extractFirstAttr(attrs);
      const name = extractNameAttr(attrs);
      if (globalId) {
        elements.push({
          modelName, lineId, ifcType, globalId, name,
          fmguid: null,
          isStorey: ifcType === 'IFCBUILDINGSTOREY',
        });
      }
    }
  }

  const { propMap, psetProps, elementPsets } = buildPropMaps(entities);
  resolveFmGuids(elements, propMap, psetProps, elementPsets);
  return elements;
}

export function validateFederation(models: ModelInput[]): ValidationResult {
  const elements: ElementResult[] = [];
  for (const { modelName, ifcText } of models) {
    elements.push(...parseElementsForModel(modelName, ifcText));
  }

  const byFmguid = new Map<string, ElementResult[]>();
  for (const el of elements) {
    if (el.isStorey || !el.fmguid) continue;
    if (!byFmguid.has(el.fmguid)) byFmguid.set(el.fmguid, []);
    byFmguid.get(el.fmguid)!.push(el);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [fmguid, locations] of byFmguid) {
    if (locations.length > 1) {
      duplicates.push({
        fmguid,
        locations: locations.map(({ modelName, ifcType, globalId, name }) => ({ modelName, ifcType, globalId, name })),
      });
    }
  }

  const missing = elements.filter(el => !el.fmguid).length;
  return {
    elements,
    duplicates,
    stats: {
      totalElements: elements.length,
      storeyElements: elements.filter(el => el.isStorey).length,
      hadFmguid: elements.filter(el => el.fmguid).length,
      missing,
      duplicateGroups: duplicates.length,
      duplicateElements: duplicates.reduce((n, d) => n + d.locations.length, 0),
    },
  };
}

export function repairFederation(result: { elements: ElementResult[] }): ElementResult[] {
  const seen = new Set<string>();
  for (const el of result.elements) {
    if (el.isStorey) continue;
    if (!el.fmguid) {
      el.fmguid = crypto.randomUUID();
      seen.add(el.fmguid);
      continue;
    }
    if (seen.has(el.fmguid)) {
      el.fmguid = crypto.randomUUID();
    }
    seen.add(el.fmguid);
  }
  return result.elements;
}
