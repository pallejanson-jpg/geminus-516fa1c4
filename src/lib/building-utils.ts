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
    }
  }
  return 0;
};
