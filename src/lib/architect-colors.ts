/**
 * Shared architect color palette for the 3D viewer.
 * Used at load time and after reset/show-all to maintain consistent coloring.
 */

export const IFC_TYPE_COLORS: Record<string, number[]> = {
  'ifcwall': [0.686, 0.667, 0.529],
  'ifcwallstandardcase': [0.761, 0.745, 0.635],
  'ifccurtainwall': [0.686, 0.667, 0.529],
  'ifcdoor': [0.357, 0.467, 0.420],
  'ifcdoorstandardcase': [0.357, 0.467, 0.420],
  'ifcwindow': [0.780, 0.780, 0.760],
  'ifcwindowstandardcase': [0.780, 0.780, 0.760],
  'ifcroof': [0.600, 0.608, 0.592],
  'ifcslab': [0.600, 0.608, 0.592],
  'ifcslabstandardcase': [0.600, 0.608, 0.592],
  'ifcslabelementedcase': [0.600, 0.608, 0.592],
  'ifccovering': [0.600, 0.608, 0.592],
  'ifcbeam': [0.800, 0.788, 0.729],
  'ifcbeamstandardcase': [0.800, 0.788, 0.729],
  'ifccolumn': [0.820, 0.808, 0.749],
  'ifccolumnstandardcase': [0.820, 0.808, 0.749],
  'ifcstair': [0.780, 0.769, 0.710],
  'ifcstairflight': [0.780, 0.769, 0.710],
  'ifcrailing': [0.741, 0.729, 0.671],
  'ifcfurnishingelement': [0.451, 0.545, 0.467],
  'ifcfurniture': [0.451, 0.545, 0.467],
  'ifcbuildingelementproxy': [0.451, 0.545, 0.467],
  'ifccasework': [0.451, 0.545, 0.467],
};

export const DEFAULT_COLOR = [0.933, 0.929, 0.918];
export const SPACE_COLOR = [0.722, 0.831, 0.890]; // Light blue #B8D4E3

/**
 * Apply architect color palette to all objects in the scene.
 * Spaces are pre-colored but hidden. All other objects get IFC-type-based colors.
 */
export function applyArchitectColors(viewer: any): { colorized: number; hiddenSpaces: number } {
  // Skip if a color filter is actively applied — don't overwrite user-applied colors
  if ((window as any).__colorFilterActive) return { colorized: 0, hiddenSpaces: 0 };
  const scene = viewer?.scene;
  const metaScene = viewer?.metaScene;
  if (!scene) return { colorized: 0, hiddenSpaces: 0 };

  let hiddenSpaces = 0;
  let colorized = 0;
  const processedIds = new Set<string>();

  // Phase 1: Colorize objects that have metaObject entries (IFC-type-based)
  if (metaScene?.metaObjects) {
    for (const [id, metaObj] of Object.entries(metaScene.metaObjects as Record<string, any>)) {
      const ifcType = (metaObj.type || '').toLowerCase();
      const objName = (metaObj.name || '').toLowerCase();
      const entity = scene.objects?.[id];
      if (!entity) continue;
      processedIds.add(id);

      const isSpace = ifcType.includes('ifcspace') || ifcType === 'ifc_space' || ifcType === 'space';
      const isAreaBlanket = objName === 'area' || objName === 'areas';
      if (isSpace || isAreaBlanket) {
        entity.colorize = SPACE_COLOR;
        entity.opacity = 0.3;
        entity.visible = false;
        entity.pickable = false;
        hiddenSpaces++;
        continue;
      }

      const color = IFC_TYPE_COLORS[ifcType] || DEFAULT_COLOR;
      entity.colorize = color;
      colorized++;
    }
  }

  // Phase 2: Apply DEFAULT_COLOR to any remaining scene objects without metaObject entries
  // This prevents raw red/uncolored objects from showing
  const allIds = scene.objectIds || [];
  for (const id of allIds) {
    if (processedIds.has(id)) continue;
    const entity = scene.objects?.[id];
    if (!entity) continue;
    entity.colorize = DEFAULT_COLOR;
    colorized++;
  }

  // Subtle edges for architectural look
  if (scene.edgeMaterial) {
    scene.edgeMaterial.edgeColor = [0.85, 0.84, 0.82];
    scene.edgeMaterial.edgeAlpha = 0.15;
    scene.edgeMaterial.edgeWidth = 1;
  }

  return { colorized, hiddenSpaces };
}

/**
 * Re-apply architect colors to visible objects only (after reset/show-all).
 * Same as applyArchitectColors but doesn't hide spaces — preserves current visibility.
 */
export function recolorArchitectObjects(viewer: any): number {
  const scene = viewer?.scene;
  const metaScene = viewer?.metaScene;
  if (!scene) return 0;

  let colorized = 0;
  const processedIds = new Set<string>();

  if (metaScene?.metaObjects) {
    for (const [id, metaObj] of Object.entries(metaScene.metaObjects as Record<string, any>)) {
      const ifcType = (metaObj.type || '').toLowerCase();
      const entity = scene.objects?.[id];
      if (!entity) continue;
      processedIds.add(id);

      const isSpace = ifcType.includes('ifcspace') || ifcType === 'ifc_space' || ifcType === 'space';
      if (isSpace) {
        entity.colorize = SPACE_COLOR;
        entity.opacity = 0.3;
        continue;
      }

      const color = IFC_TYPE_COLORS[ifcType] || DEFAULT_COLOR;
      entity.colorize = color;
      colorized++;
    }
  }

  // Colorize remaining objects without metaObject entries
  const allIds = scene.objectIds || [];
  for (const id of allIds) {
    if (processedIds.has(id)) continue;
    const entity = scene.objects?.[id];
    if (!entity) continue;
    entity.colorize = DEFAULT_COLOR;
    colorized++;
  }

  // Restore subtle edges
  if (scene.edgeMaterial) {
    scene.edgeMaterial.edgeColor = [0.85, 0.84, 0.82];
    scene.edgeMaterial.edgeAlpha = 0.15;
    scene.edgeMaterial.edgeWidth = 1;
  }

  return colorized;
}
