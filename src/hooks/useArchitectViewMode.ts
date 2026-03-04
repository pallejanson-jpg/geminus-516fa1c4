/**
 * Architect View Mode Hook
 * 
 * Applies a stylized architectural visualization with specific colors:
 * - Facade walls: #D9D8C1
 * - Interior walls: #F8F8F6
 * - Doors: #D4E4DF
 * - Roofs/Slabs: #B6B2A4
 * - Spaces (rooms): #E5E4E3 with 75% transparency
 * - Background: gradient from white to #DFECDC
 * - Smooth edges
 */

import { useCallback, useRef } from 'react';

// Color definitions (hex to RGB 0-1)
const ARCHITECT_COLORS = {
  facadeWall: [0.686, 0.667, 0.529],     // #AFAA87
  interiorWall: [0.761, 0.745, 0.635],   // #C2BEA2
  door: [0.357, 0.467, 0.420],           // #5B776B
  roof: [0.600, 0.608, 0.592],           // #999B97
  slab: [0.600, 0.608, 0.592],           // #999B97
  space: [0.898, 0.894, 0.890],          // #E5E4E3
  window: [0.392, 0.490, 0.541],         // #647D8A
  beam: [0.800, 0.788, 0.729],           // #CCC9BA
  column: [0.820, 0.808, 0.749],         // #D1CEBF
  stair: [0.780, 0.769, 0.710],          // #C7C4B5
  railing: [0.741, 0.729, 0.671],        // #BDBAAB
  furniture: [0.451, 0.545, 0.467],      // #738B77
  default: [0.933, 0.929, 0.918],        // #EEE
};

// IFC types to color mapping
const IFC_TYPE_COLORS: Record<string, number[]> = {
  // Walls
  'ifcwall': ARCHITECT_COLORS.facadeWall,
  'ifcwallstandardcase': ARCHITECT_COLORS.interiorWall,
  'ifccurtainwall': ARCHITECT_COLORS.facadeWall,
  
  // Doors and windows
  'ifcdoor': ARCHITECT_COLORS.door,
  'ifcdoorstandardcase': ARCHITECT_COLORS.door,
  'ifcwindow': ARCHITECT_COLORS.window,
  'ifcwindowstandardcase': ARCHITECT_COLORS.window,
  
  // Roofs and slabs
  'ifcroof': ARCHITECT_COLORS.roof,
  'ifcslab': ARCHITECT_COLORS.slab,
  'ifcslabstandardcase': ARCHITECT_COLORS.slab,
  'ifcslabelementedcase': ARCHITECT_COLORS.slab,
  'ifccovering': ARCHITECT_COLORS.roof,
  
  // Spaces
  'ifcspace': ARCHITECT_COLORS.space,
  
  // Structural elements
  'ifcbeam': ARCHITECT_COLORS.beam,
  'ifcbeamstandardcase': ARCHITECT_COLORS.beam,
  'ifccolumn': ARCHITECT_COLORS.column,
  'ifccolumnstandardcase': ARCHITECT_COLORS.column,
  
  // Other elements
  'ifcstair': ARCHITECT_COLORS.stair,
  'ifcstairflight': ARCHITECT_COLORS.stair,
  'ifcrailing': ARCHITECT_COLORS.railing,
  'ifcfurnishingelement': ARCHITECT_COLORS.furniture,
  'ifcfurniture': ARCHITECT_COLORS.furniture,
  'ifcbuildingelementproxy': ARCHITECT_COLORS.furniture, // Entourage (people, trees, etc.)
  'ifccasework': ARCHITECT_COLORS.furniture,             // Casework (cabinets, etc.)
};

// Background color presets - all gradients from white to color
export const ARCHITECT_BACKGROUND_PRESETS = [
  // Neutrals row
  { id: 'white', name: 'Vit', bottom: 'rgb(255, 255, 255)' },
  { id: 'light-gray', name: 'Ljusgrå', bottom: 'rgb(230, 230, 230)' },
  { id: 'gray', name: 'Grå', bottom: 'rgb(180, 180, 180)' },
  { id: 'dark-gray', name: 'Mörkgrå', bottom: 'rgb(120, 120, 120)' },
  { id: 'charcoal', name: 'Antracit', bottom: 'rgb(60, 60, 60)' },
  
  // Colors row 1 - Light pastels
  { id: 'mint', name: 'Mint', bottom: 'rgb(200, 235, 220)' },
  { id: 'sage', name: 'Salvia', bottom: 'rgb(223, 236, 220)' }, // Original green
  { id: 'sky', name: 'Himmel', bottom: 'rgb(210, 230, 245)' },
  { id: 'lavender', name: 'Lavendel', bottom: 'rgb(230, 220, 245)' },
  { id: 'blush', name: 'Rouge', bottom: 'rgb(245, 225, 230)' },
  
  // Colors row 2 - Warm tones
  { id: 'cream', name: 'Grädde', bottom: 'rgb(250, 245, 235)' },
  { id: 'sand', name: 'Sand', bottom: 'rgb(240, 230, 210)' },
  { id: 'peach', name: 'Persika', bottom: 'rgb(255, 220, 200)' },
  { id: 'coral', name: 'Korall', bottom: 'rgb(255, 200, 180)' },
  { id: 'terracotta', name: 'Terrakotta', bottom: 'rgb(230, 180, 160)' },
  
  // Colors row 3 - Cool tones  
  { id: 'ice', name: 'Is', bottom: 'rgb(225, 240, 250)' },
  { id: 'powder', name: 'Puder', bottom: 'rgb(200, 220, 240)' },
  { id: 'steel', name: 'Stål', bottom: 'rgb(180, 200, 220)' },
  { id: 'slate', name: 'Skiffer', bottom: 'rgb(160, 180, 200)' },
  { id: 'ocean', name: 'Ocean', bottom: 'rgb(140, 180, 200)' },
];

export type BackgroundPresetId = typeof ARCHITECT_BACKGROUND_PRESETS[number]['id'];

export interface ArchitectViewModeState {
  isActive: boolean;
  originalColors: Map<string, { color: number[]; opacity: number; edges: boolean }>;
  originalBackground: string;
  originalEdgeColor: number[];
  originalEdgeAlpha: number;
  originalEdgesEnabled: boolean;
  currentBackgroundPreset: BackgroundPresetId;
}

export function useArchitectViewMode() {
  const stateRef = useRef<ArchitectViewModeState>({
    isActive: false,
    originalColors: new Map(),
    originalBackground: '',
    originalEdgeColor: [0, 0, 0],
    originalEdgeAlpha: 1,
    originalEdgesEnabled: true,
    currentBackgroundPreset: 'light-gray', // Default gray
  });

  /**
   * Apply background preset
   */
  const applyBackgroundPreset = useCallback((presetId: BackgroundPresetId) => {
    const preset = ARCHITECT_BACKGROUND_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    const container = document.getElementById('AssetPlusViewer');
    if (container) {
      // All presets are gradients from white to the bottom color
      container.style.background = `linear-gradient(180deg, rgb(255, 255, 255) 0%, ${preset.bottom} 100%)`;
    }
    stateRef.current.currentBackgroundPreset = presetId;
  }, []);

  /**
   * Apply architect view mode to the scene
   */
  const applyArchitectMode = useCallback((viewerRef: React.MutableRefObject<any>, backgroundPreset?: BackgroundPresetId) => {
    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const scene = xeokitViewer?.scene;
    
    if (!scene) {
      console.warn('Cannot apply architect mode: scene not ready');
      return false;
    }

    const state = stateRef.current;
    const presetId = backgroundPreset || state.currentBackgroundPreset;
    const preset = ARCHITECT_BACKGROUND_PRESETS.find(p => p.id === presetId) || ARCHITECT_BACKGROUND_PRESETS[0];
    
    // Already active
    if (state.isActive) {
      return true;
    }

    console.log('Applying architect view mode...');

    // Store original background
    const container = document.getElementById('AssetPlusViewer');
    if (container) {
      state.originalBackground = container.style.background || '';
      // Apply gradient background (white to color)
      container.style.background = `linear-gradient(180deg, rgb(255, 255, 255) 0%, ${preset.bottom} 100%)`;
      state.currentBackgroundPreset = presetId;
    }

    // Store and modify edge rendering - disable most edges for cleaner look
    const edgeMaterial = scene.edgeMaterial;
    if (edgeMaterial) {
      state.originalEdgeColor = [...edgeMaterial.edgeColor];
      state.originalEdgeAlpha = edgeMaterial.edgeAlpha;
      state.originalEdgesEnabled = scene.edgesEnabled ?? true;
      
      // Very subtle edges - almost invisible for clean architectural look
      edgeMaterial.edgeColor = [0.85, 0.84, 0.82];
      edgeMaterial.edgeAlpha = 0.15;
      edgeMaterial.edgeWidth = 1;
    }

    // Iterate through all objects and apply colors
    const metaScene = xeokitViewer.metaScene;
    const objects = scene.objects;
    
    if (metaScene && objects) {
      for (const objectId in objects) {
        const entity = objects[objectId];
        const metaObject = metaScene.metaObjects[objectId];
        
        if (!entity || !metaObject) continue;
        
        // Store original color, opacity, and edge visibility
        state.originalColors.set(objectId, {
          color: entity.colorize ? [...entity.colorize] : [1, 1, 1],
          opacity: entity.opacity ?? 1,
          edges: entity.edges ?? true,
        });
        
        // Get IFC type and find matching color
        const ifcType = (metaObject.type || '').toLowerCase();
        const newColor = IFC_TYPE_COLORS[ifcType] || ARCHITECT_COLORS.default;
        
        // Disable edges on most objects for cleaner look
        // Only keep edges on walls, doors, windows for definition
        const keepEdges = ['ifcwall', 'ifcwallstandardcase', 'ifcdoor', 'ifcdoorstandardcase', 
                          'ifcwindow', 'ifcwindowstandardcase', 'ifccurtainwall'].includes(ifcType);
        entity.edges = keepEdges;
        
        // Apply new color
        entity.colorize = newColor;
        
        // Apply transparency to spaces
        if (ifcType === 'ifcspace') {
          entity.opacity = 0.25; // 75% transparent = 25% opaque
        }
      }
    }

    state.isActive = true;
    console.log('Architect view mode applied');
    return true;
  }, []);

  /**
   * Remove architect view mode and restore original colors
   */
  const removeArchitectMode = useCallback((viewerRef: React.MutableRefObject<any>) => {
    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const scene = xeokitViewer?.scene;
    
    const state = stateRef.current;
    
    if (!state.isActive) {
      return;
    }

    console.log('Removing architect view mode...');

    // Restore background
    const container = document.getElementById('AssetPlusViewer');
    if (container && state.originalBackground) {
      container.style.background = state.originalBackground;
    }

    // Restore edge material
    if (scene?.edgeMaterial) {
      scene.edgeMaterial.edgeColor = state.originalEdgeColor;
      scene.edgeMaterial.edgeAlpha = state.originalEdgeAlpha;
    }

    // Restore original colors and edges
    if (scene?.objects) {
      for (const [objectId, original] of state.originalColors) {
        const entity = scene.objects[objectId];
        if (entity) {
          entity.colorize = original.color;
          entity.opacity = original.opacity;
          entity.edges = original.edges;
        }
      }
    }

    // Clear stored state
    state.originalColors.clear();
    state.isActive = false;
    console.log('Architect view mode removed');
  }, []);

  /**
   * Toggle architect view mode
   */
  const toggleArchitectMode = useCallback((viewerRef: React.MutableRefObject<any>, enabled: boolean) => {
    if (enabled) {
      return applyArchitectMode(viewerRef);
    } else {
      removeArchitectMode(viewerRef);
      return true;
    }
  }, [applyArchitectMode, removeArchitectMode]);

  /**
   * Change background preset while in architect mode
   */
  const setBackgroundPreset = useCallback((viewerRef: React.MutableRefObject<any>, presetId: BackgroundPresetId) => {
    const state = stateRef.current;
    if (state.isActive) {
      applyBackgroundPreset(presetId);
    }
    state.currentBackgroundPreset = presetId;
  }, [applyBackgroundPreset]);

  return {
    isActive: () => stateRef.current.isActive,
    getCurrentBackgroundPreset: () => stateRef.current.currentBackgroundPreset,
    applyArchitectMode,
    removeArchitectMode,
    toggleArchitectMode,
    setBackgroundPreset,
    applyBackgroundPreset,
  };
}

// Events for architect mode
export const ARCHITECT_MODE_REQUESTED_EVENT = 'ARCHITECT_MODE_REQUESTED';
export const ARCHITECT_MODE_CHANGED_EVENT = 'ARCHITECT_MODE_CHANGED';
export const ARCHITECT_BACKGROUND_CHANGED_EVENT = 'ARCHITECT_BACKGROUND_CHANGED';
