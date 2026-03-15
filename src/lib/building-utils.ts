/**
 * Shared building data utilities.
 * Extracted to avoid duplication across HomeLanding and PortfolioView.
 */

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
