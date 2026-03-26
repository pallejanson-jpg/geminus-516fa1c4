/**
 * Shared building data utilities.
 * Extracted to avoid duplication across HomeLanding, PortfolioView, Viewer, etc.
 */

// ─── BIM model name detection ─────────────────────────────────────────────────

const MODEL_NAME_RE = /^(A|B|E|V|K|R|S|VS|EL|MEP|BRAND|FIRE|SPRINKLER)[\s\-_.]/i;
const MODEL_EXACT_RE = /^(A-MODELL|B-MODELL|E-MODELL|V-MODELL|ARK|ARKITEKT|A_MODELL|B_MODELL|E_MODELL|V_MODELL)$/i;

/** Returns true if the name looks like a BIM model discipline name (A-modell, B-modell, etc.) */
export const isModelName = (name: string | null | undefined): boolean => {
  if (!name) return false;
  const trimmed = name.trim();
  return MODEL_NAME_RE.test(trimmed) || MODEL_EXACT_RE.test(trimmed);
};

/** Returns true if the name belongs to an architectural (A) model. */
export const isAModelName = (name: string | null | undefined): boolean => {
  if (!name) return false;
  const upper = name.toUpperCase().trim();
  if (upper.includes('ARKITEKT') || upper.includes('A-MODELL') || upper.includes('A_MODELL') || upper.includes('A MODELL') || upper === 'ARK') return true;
  if (upper.charAt(0) === 'A' && (upper.length === 1 || /^A[\s\-_.]/.test(upper))) return true;
  return false;
};

/**
 * From allData, return the set of storey fmGuids whose parentCommonName
 * indicates an A-model. These are used to restrict spaces to A-model only.
 */
export const getAModelStoreyGuids = (allData: any[], buildingFmGuid: string): Set<string> => {
  const guids = new Set<string>();
  allData.forEach(item => {
    if (item.category !== 'Building Storey' || (item.buildingFmGuid || item.building_fm_guid) !== buildingFmGuid) return;
    const parentName = item.attributes?.parentCommonName || '';
    if (parentName && isAModelName(parentName)) guids.add(item.fmGuid || item.fm_guid);
  });
  return guids;
};

/** Extract NTA (net area) value from an asset's dynamic attributes map. */
export const extractNtaFromAttributes = (attributes: Record<string, any> | undefined): number => {
  if (!attributes) return 0;
  for (const key of Object.keys(attributes)) {
    if (key.toLowerCase().startsWith('nta')) {
      const ntaObj = attributes[key];
      if (ntaObj && typeof ntaObj === 'object' && typeof ntaObj.value === 'number') {
        return ntaObj.value;
      }
      // Direct numeric value
      const num = Number(ntaObj);
      if (num > 0) return num;
    }
  }
  return 0;
};

/**
 * Unified area extraction for a space object.
 * Handles all known shapes: NTA {value:N}, NTA direct number,
 * grossArea, gross_area, attributes.area.
 *
 * Use this as the single source of truth for area calculations.
 */
export const extractSpaceArea = (space: any): number => {
  if (!space) return 0;
  const attrs = space.attributes || {};

  // 1. NTA attribute (object or direct number)
  const ntaKey = Object.keys(attrs).find(k => k.toLowerCase().startsWith('nta'));
  if (ntaKey && attrs[ntaKey] != null) {
    const ntaVal = attrs[ntaKey];
    // Object shape: { value: number }
    if (typeof ntaVal === 'object' && typeof ntaVal.value === 'number') {
      return ntaVal.value;
    }
    const num = Number(ntaVal);
    if (num > 0) return num;
  }

  // 2. grossArea property (camelCase from allData)
  if (space.grossArea != null) {
    const num = Number(space.grossArea);
    if (num > 0) return num;
  }

  // 3. gross_area property (snake_case from DB)
  if (space.gross_area != null) {
    const num = Number(space.gross_area);
    if (num > 0) return num;
  }

  // 4. attributes.area fallback
  if (attrs.area != null) {
    const num = Number(attrs.area);
    if (num > 0) return num;
  }

  return 0;
};
