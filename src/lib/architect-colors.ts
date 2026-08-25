/**
 * Shared architect color palette for the 3D viewer.
 * Used at load time and after reset/show-all to maintain consistent coloring.
 */

import { logger } from '@/lib/logger';

// ── Architectural Standard palette ───────────────────────────────────────────
// Based on buildingSMART / Revit de facto conventions (no official ISO color
// standard exists for BIM visualization). Walls are neutral concrete grey;
// glazing is distinctly blue; structure uses steel tones; furniture is warm sage.
export const IFC_TYPE_COLORS: Record<string, number[]> = {
  // ── Walls — neutral concrete grey (NCS S 2005-N/B range) ─────────────────
  'ifcwall':             [0.780, 0.773, 0.757],
  'ifcwallstandardcase': [0.780, 0.773, 0.757],
  'ifccurtainwall':      [0.776, 0.871, 0.918], // glazed curtain wall — glass blue
  // ── Glazing — sky blue (universally recognised as glass) ─────────────────
  'ifcdoor':             [0.631, 0.545, 0.439], // warm wood/brown
  'ifcdoorstandardcase': [0.631, 0.545, 0.439],
  'ifcwindow':           [0.686, 0.839, 0.902], // glass blue
  'ifcwindowstandardcase': [0.686, 0.839, 0.902],
  // ── Horizontal structure — warm grey (concrete slab) ─────────────────────
  'ifcroof':             [0.596, 0.580, 0.557],
  'ifcslab':             [0.808, 0.796, 0.773],
  'ifcslabstandardcase': [0.808, 0.796, 0.773],
  'ifcslabelementedcase': [0.808, 0.796, 0.773],
  'ifccovering':         [0.863, 0.855, 0.843], // ceiling tile — very light
  // ── Vertical structure — structural steel / concrete (darker) ─────────────
  'ifcbeam':             [0.608, 0.643, 0.690], // steel blue-grey
  'ifcbeamstandardcase': [0.608, 0.643, 0.690],
  'ifccolumn':           [0.573, 0.573, 0.573], // concrete column — neutral grey
  'ifccolumnstandardcase': [0.573, 0.573, 0.573],
  // ── Stairs / circulation ──────────────────────────────────────────────────
  'ifcstair':            [0.757, 0.745, 0.722],
  'ifcstairflight':      [0.757, 0.745, 0.722],
  'ifcrailing':          [0.612, 0.624, 0.643], // metallic grey
  // ── Furniture / fitout — warm sage green ─────────────────────────────────
  'ifcfurnishingelement': [0.502, 0.573, 0.502],
  'ifcfurniture':         [0.502, 0.573, 0.502],
  'ifcbuildingelementproxy': [0.710, 0.698, 0.678],
  'ifccasework':          [0.580, 0.537, 0.467], // cabinetry — warm wood
  // ── VVS / Sanitary (copper/brass tones) ─────────────────────────────────
  'ifcpipesegment': [0.65, 0.55, 0.45],
  'ifcpipefitting': [0.65, 0.55, 0.45],
  'ifcpipeconnection': [0.65, 0.55, 0.45],
  'ifcvalve': [0.55, 0.50, 0.45],
  'ifcflowcontroller': [0.55, 0.50, 0.45],
  'ifcflowinstrument': [0.60, 0.55, 0.48],
  'ifcflowmeter': [0.60, 0.55, 0.48],
  'ifcflowmovingdevice': [0.60, 0.55, 0.48],
  'ifcpump': [0.55, 0.48, 0.42],
  'ifccompressor': [0.55, 0.48, 0.42],
  'ifcfan': [0.60, 0.60, 0.65],
  'ifcsanitaryterminal': [0.80, 0.80, 0.78],
  'ifcflowterminal': [0.70, 0.70, 0.68],
  'ifcwasteterminal': [0.72, 0.72, 0.70],
  'ifcstoragetank': [0.58, 0.52, 0.46],
  'ifcflowstoragedevice': [0.58, 0.52, 0.46],
  'ifcinterceptor': [0.58, 0.52, 0.46],
  'ifcfilter': [0.60, 0.55, 0.48],
  'ifcelectricflowstoragedevice': [0.58, 0.52, 0.46],
  // ── HVAC / Ventilation (blue-grey tones) ────────────────────────────────
  'ifcductsegment': [0.55, 0.65, 0.72],
  'ifcductfitting': [0.55, 0.65, 0.72],
  'ifcductsilencer': [0.58, 0.67, 0.74],
  'ifcairterminal': [0.65, 0.75, 0.80],
  'ifcairterminalbox': [0.60, 0.70, 0.76],
  'ifcairtoairheatrecovery': [0.52, 0.62, 0.68],
  'ifccoil': [0.52, 0.62, 0.68],
  'ifcchiller': [0.52, 0.62, 0.68],
  'ifccoolingtower': [0.52, 0.62, 0.68],
  'ifcboiler': [0.60, 0.40, 0.30],
  'ifcheatexchanger': [0.52, 0.62, 0.68],
  'ifchumidifier': [0.60, 0.70, 0.76],
  'ifcunitarycontrolelement': [0.65, 0.72, 0.78],
  'ifcunitaryequipment': [0.58, 0.65, 0.72],
  'ifcspaceheater': [0.75, 0.50, 0.35],
  'ifcevaporator': [0.52, 0.62, 0.68],
  'ifccondenser': [0.52, 0.62, 0.68],
  'ifcevaporativecooler': [0.55, 0.65, 0.72],
  'ifcmedicaldevice': [0.80, 0.80, 0.80],
  // ── Electrical (warm yellow/amber tones) ────────────────────────────────
  'ifccablesegment': [0.72, 0.60, 0.25],
  'ifccablecarriersegment': [0.68, 0.58, 0.28],
  'ifccablecarrierfitting': [0.68, 0.58, 0.28],
  'ifccarriersegment': [0.68, 0.58, 0.28],
  'ifcelectricappliance': [0.85, 0.78, 0.55],
  'ifcelectricgenerator': [0.80, 0.65, 0.30],
  'ifcelectricmotor': [0.78, 0.62, 0.28],
  'ifcelectricdistributionboard': [0.70, 0.55, 0.22],
  'ifcdistributionboard': [0.70, 0.55, 0.22],
  'ifcelectrictimecontrol': [0.75, 0.65, 0.35],
  'ifclightfixture': [0.95, 0.90, 0.60],
  'ifclamp': [0.95, 0.90, 0.60],
  'ifcoutlet': [0.82, 0.76, 0.50],
  'ifcswitchingdevice': [0.78, 0.70, 0.42],
  'ifcprotectivedevice': [0.72, 0.55, 0.30],
  'ifcprotectivedevicetrippingunit': [0.72, 0.55, 0.30],
  'ifcjunctionbox': [0.72, 0.62, 0.35],
  'ifcmotorconnection': [0.78, 0.62, 0.28],
  'ifctransformer': [0.70, 0.55, 0.25],
  'ifcsolardevice': [0.68, 0.72, 0.40],
  'ifcaudiovisualappliance': [0.70, 0.70, 0.70],
  'ifccommunicationsappliance': [0.70, 0.70, 0.70],
  'ifcalarm': [0.90, 0.35, 0.25],
  'ifcsensor': [0.75, 0.72, 0.65],
  'ifcactuator': [0.72, 0.68, 0.55],
  'ifccontroller': [0.72, 0.70, 0.60],
  'ifcfiresuppressionterminal': [0.90, 0.30, 0.20],
  // ── Fire / Safety (red tones) ────────────────────────────────────────────
  'ifcfireelement': [0.88, 0.30, 0.22],
  // ── Structural steel (blue-grey) ─────────────────────────────────────────
  'ifcmember': [0.65, 0.68, 0.72],
  'ifcmemberstandardcase': [0.65, 0.68, 0.72],
  'ifcplate': [0.65, 0.68, 0.72],
  'ifcplatestandardcase': [0.65, 0.68, 0.72],
  'ifctendon': [0.60, 0.62, 0.65],
  'ifctendonanchor': [0.60, 0.62, 0.65],
  'ifcreinforcingbar': [0.55, 0.55, 0.60],
  'ifcreinforcingmesh': [0.55, 0.55, 0.60],
  // ── Site / Civil ─────────────────────────────────────────────────────────
  'ifcsite': [0.60, 0.70, 0.55],
  'ifcroad': [0.55, 0.55, 0.55],
  'ifcearthworksfill': [0.65, 0.60, 0.50],
  'ifcgeomodel': [0.65, 0.60, 0.50],
};

export const DEFAULT_COLOR = [0.800, 0.792, 0.776]; // neutral warm grey for unknown types
export const SPACE_COLOR = [0.733, 0.847, 0.902];  // light sky blue — habitable space

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

  // Get all object IDs for later phases
  let allIds: string[] = [];
  try {
    allIds = scene.objectIds || [];
  } catch {
    // objectIds getter can throw if internal map is null
  }

  // CRITICAL: Batch operations FIRST to clear XKT material conflicts (essential!)
  // The order matters: disable colorized → set colorize → enable colorized
  if (allIds.length > 0) {
    try {
      logger.log(`[applyArchitectColors] Batch-resetting colorize for ${allIds.length} entities...`);
      scene.setObjectsColorized(allIds, null);  // null resets colorize to material default (API takes RGB array or null, NOT boolean)
      scene.setObjectsVisible(allIds, true);
      scene.setObjectsOpacity(allIds, 1);
      logger.log(`[applyArchitectColors] ✓ Batch baseline complete`);
    } catch (e) {
      logger.warn('[applyArchitectColors] Error in batch operations:', e);
    }
  }

  // Phase 1: Group metaObjects by IFC type, then call setObjectsColorized once per group.
  // One batch call per type (~20-30 types) vs one dirty-flag per entity (~20k+).
  if (metaScene?.metaObjects) {
    // bucket: ifcType → entity IDs
    const typeGroups = new Map<string, string[]>();
    const spaceIds: string[] = [];
    const areaIds: string[] = [];

    for (const [id, metaObj] of Object.entries(metaScene.metaObjects as Record<string, any>)) {
      if (!scene.objects?.[id]) continue;
      processedIds.add(id);
      const ifcType = (metaObj.type || '').toLowerCase();
      const objName = (metaObj.name || '').toLowerCase();

      const isSpace = ifcType.includes('ifcspace') || ifcType === 'ifc_space' || ifcType === 'space';
      const isAreaBlanket = objName === 'area' || objName === 'areas';

      if (isSpace) {
        spaceIds.push(id);
      } else if (isAreaBlanket) {
        areaIds.push(id);
      } else {
        if (!typeGroups.has(ifcType)) typeGroups.set(ifcType, []);
        typeGroups.get(ifcType)!.push(id);
      }
    }

    // Apply spaces — hidden, light blue, non-pickable
    if (spaceIds.length > 0) {
      scene.setObjectsColorized(spaceIds, SPACE_COLOR);
      scene.setObjectsOpacity(spaceIds, 0.3);
      scene.setObjectsVisible(spaceIds, false);
      scene.setObjectsPickable(spaceIds, false);
      hiddenSpaces += spaceIds.length;
    }
    // Area blankets behave like spaces
    if (areaIds.length > 0) {
      scene.setObjectsColorized(areaIds, SPACE_COLOR);
      scene.setObjectsOpacity(areaIds, 0.3);
      scene.setObjectsVisible(areaIds, false);
      scene.setObjectsPickable(areaIds, false);
      hiddenSpaces += areaIds.length;
    }
    // One batch call per IFC type
    for (const [ifcType, ids] of typeGroups) {
      const color = IFC_TYPE_COLORS[ifcType] || DEFAULT_COLOR;
      scene.setObjectsColorized(ids, color);
      scene.setObjectsVisible(ids, true);
      scene.setObjectsOpacity(ids, 1.0);
      colorized += ids.length;
    }
  }

  logger.log(`[applyArchitectColors] Phase 1 (batch): colorized ${colorized}, spaces ${hiddenSpaces}`);

  // Phase 2: Apply DEFAULT_COLOR to scene objects without metaObject entries (no IFC type).
  if (!allIds || allIds.length === 0) {
    try { allIds = scene.objectIds || []; } catch { /* objectIds getter can throw if internal map is null */ }
  }
  const unclassified = allIds.filter(id => !processedIds.has(id));
  if (unclassified.length > 0) {
    scene.setObjectsColorized(unclassified, DEFAULT_COLOR);
    scene.setObjectsVisible(unclassified, true);
    scene.setObjectsOpacity(unclassified, 1.0);
    colorized += unclassified.length;
  }
  logger.log(`[applyArchitectColors] Phase 2 (batch): ${unclassified.length} unclassified objects (total: ${colorized})`);

  // Edge material: crisp dark edges improve depth cues and overall sharpness
  try {
    const edgeMat = scene.edgeMaterial;
    if (edgeMat) {
      edgeMat.edgeColor = [0.20, 0.20, 0.20];
      edgeMat.edgeAlpha = 0.6;
      edgeMat.edgeWidth = 1;
    }
  } catch { /* edgeMaterial getter throws if scene is destroyed */ }

  // CRITICAL: Force scene re-render after all color assignments
  // This ensures xeokit actually applies the color changes to the GPU
  try {
    logger.log('[applyArchitectColors] Forcing scene update...');
    // Force scene render by triggering a camera update (minimal change)
    if (scene.camera) {
      const cam = scene.camera;
      cam.eye = [...cam.eye];  // Trigger setter without changing position
    }
    // Also force scene re-upload by clearing renderer caches if available
    if (scene.renderer) {
      scene.renderer.reset?.();
    }
  } catch (e) {
    logger.warn('[applyArchitectColors] Error forcing scene update:', e);
  }

  // Safety fallback: if ALL visible entities were hidden (e.g. model only has IfcSpace),
  // make spaces visible so the user sees something instead of an empty viewport
  const totalEntities = allIds.length;
  if (hiddenSpaces > 0 && colorized === 0 && hiddenSpaces >= totalEntities) {
    logger.warn('[ArchitectColors] All entities are IfcSpace — making spaces visible as fallback');
    if (metaScene?.metaObjects) {
      for (const [id, metaObj] of Object.entries(metaScene.metaObjects as Record<string, any>)) {
        const ifcType = ((metaObj as any).type || '').toLowerCase();
        const isSpace = ifcType.includes('ifcspace') || ifcType === 'ifc_space' || ifcType === 'space';
        if (isSpace) {
          const entity = scene.objects?.[id];
          if (entity) {
            entity.visible = true;
            entity.pickable = true;
            entity.opacity = 0.6;
          }
        }
      }
    }
    // Also make visible any entities without metaObject that were hidden
    for (const id of allIds) {
      const entity = scene.objects?.[id];
      if (entity && !entity.visible) {
        entity.visible = true;
        entity.opacity = 0.6;
      }
    }
  }

  return { colorized, hiddenSpaces };
}

/**
 * Re-apply architect colors to visible objects only (after reset/show-all).
 * Same as applyArchitectColors but doesn't hide spaces — preserves current visibility.
 */
export function recolorArchitectObjects(viewer: any): number {
  // Skip if a color filter is actively applied
  if ((window as any).__colorFilterActive) return 0;
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
  let allIds: string[] = [];
  try { allIds = scene.objectIds || []; } catch { /* objectIds getter can throw if internal map is null */ }
  for (const id of allIds) {
    if (processedIds.has(id)) continue;
    const entity = scene.objects?.[id];
    if (!entity) continue;
    entity.colorize = DEFAULT_COLOR;
    colorized++;
  }

  // Restore subtle edges
  try {
    const edgeMat = scene.edgeMaterial;
    if (edgeMat) {
      edgeMat.edgeColor = [0.85, 0.84, 0.82];
      edgeMat.edgeAlpha = 0.15;
      edgeMat.edgeWidth = 1;
    }
  } catch { /* edgeMaterial getter throws if scene is destroyed */ }

  return colorized;
}
