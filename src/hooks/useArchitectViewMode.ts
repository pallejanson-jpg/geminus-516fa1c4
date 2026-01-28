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
  furniture: [0.890, 0.882, 0.863],      // #E3E1DC
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
};

// Background gradient colors
const BACKGROUND_GRADIENT = {
  top: 'rgb(255, 255, 255)',           // White
  bottom: 'rgb(223, 236, 220)',        // #DFECDC
};

export interface ArchitectViewModeState {
  isActive: boolean;
  originalColors: Map<string, { color: number[]; opacity: number }>;
  originalBackground: string;
  originalEdgeColor: number[];
  originalEdgeAlpha: number;
}

export function useArchitectViewMode() {
  const stateRef = useRef<ArchitectViewModeState>({
    isActive: false,
    originalColors: new Map(),
    originalBackground: '',
    originalEdgeColor: [0, 0, 0],
    originalEdgeAlpha: 1,
  });

  /**
   * Apply architect view mode to the scene
   */
  const applyArchitectMode = useCallback((viewerRef: React.MutableRefObject<any>) => {
    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const scene = xeokitViewer?.scene;
    
    if (!scene) {
      console.warn('Cannot apply architect mode: scene not ready');
      return false;
    }

    const state = stateRef.current;
    
    // Already active
    if (state.isActive) {
      return true;
    }

    console.log('Applying architect view mode...');

    // Store original background
    const container = document.getElementById('AssetPlusViewer');
    if (container) {
      state.originalBackground = container.style.background || '';
      // Apply gradient background
      container.style.background = `linear-gradient(180deg, ${BACKGROUND_GRADIENT.top} 0%, ${BACKGROUND_GRADIENT.bottom} 100%)`;
    }

    // Store and modify edge rendering for smoother lines
    const edgeMaterial = scene.edgeMaterial;
    if (edgeMaterial) {
      state.originalEdgeColor = [...edgeMaterial.edgeColor];
      state.originalEdgeAlpha = edgeMaterial.edgeAlpha;
      
      // Softer, lighter edges
      edgeMaterial.edgeColor = [0.7, 0.7, 0.68];
      edgeMaterial.edgeAlpha = 0.4;
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
        
        // Store original color and opacity
        if (entity.colorize) {
          state.originalColors.set(objectId, {
            color: [...entity.colorize],
            opacity: entity.opacity ?? 1,
          });
        }
        
        // Get IFC type and find matching color
        const ifcType = (metaObject.type || '').toLowerCase();
        const newColor = IFC_TYPE_COLORS[ifcType] || ARCHITECT_COLORS.default;
        
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

    // Restore original colors
    if (scene?.objects) {
      for (const [objectId, original] of state.originalColors) {
        const entity = scene.objects[objectId];
        if (entity) {
          entity.colorize = original.color;
          entity.opacity = original.opacity;
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

  return {
    isActive: () => stateRef.current.isActive,
    applyArchitectMode,
    removeArchitectMode,
    toggleArchitectMode,
  };
}

// Event for requesting architect mode change
export const ARCHITECT_MODE_REQUESTED_EVENT = 'ARCHITECT_MODE_REQUESTED';
export const ARCHITECT_MODE_CHANGED_EVENT = 'ARCHITECT_MODE_CHANGED';
