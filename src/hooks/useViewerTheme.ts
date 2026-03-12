/**
 * Viewer Theme Hook
 * 
 * Applies custom color themes to the 3D viewer based on user-defined or system presets.
 * Extends the architect view mode functionality to support multiple customizable themes.
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Types for color mappings stored in database
export interface ThemeColorMapping {
  color: string;
  edges?: boolean;
  opacity?: number;
}

export interface ViewerTheme {
  id: string;
  name: string;
  is_system: boolean;
  color_mappings: Record<string, ThemeColorMapping>;
  edge_settings: Record<string, any>;
  space_opacity: number;
  created_at: string;
  updated_at: string;
}

// Convert hex color to RGB array [0-1]
const hexToRgb = (hex: string): number[] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0.9, 0.9, 0.9];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
};

// Event names for theme changes
export const VIEWER_THEME_CHANGED_EVENT = 'VIEWER_THEME_CHANGED';
export const VIEWER_THEME_REQUESTED_EVENT = 'VIEWER_THEME_REQUESTED';

interface ViewerThemeState {
  activeThemeId: string | null;
  originalColors: Map<string, { color: number[]; opacity: number; edges: boolean }>;
  originalBackground: string;
  originalEdgeColor: number[];
  originalEdgeAlpha: number;
}

export function useViewerTheme() {
  const [themes, setThemes] = useState<ViewerTheme[]>([]);
  const [activeTheme, setActiveTheme] = useState<ViewerTheme | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const stateRef = useRef<ViewerThemeState>({
    activeThemeId: null,
    originalColors: new Map(),
    originalBackground: '',
    originalEdgeColor: [0, 0, 0],
    originalEdgeAlpha: 1,
  });

  // Fetch themes from database
  const fetchThemes = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('viewer_themes')
        .select('*')
        .order('is_system', { ascending: false })
        .order('name');
      
      if (error) throw error;
      
      // Type assertion since Supabase types might not be updated yet
      const typedData = (data || []) as unknown as ViewerTheme[];
      setThemes(typedData);
    } catch (err) {
      console.error('Failed to fetch viewer themes:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load themes on mount
  useEffect(() => {
    fetchThemes();
  }, [fetchThemes]);

  /**
   * Apply a theme to the scene
   */
  const applyTheme = useCallback((viewerRef: React.MutableRefObject<any>, theme: ViewerTheme) => {
    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const scene = xeokitViewer?.scene;
    
    if (!scene) {
      console.warn('Cannot apply theme: scene not ready');
      return false;
    }

    const state = stateRef.current;
    const colorMappings = theme.color_mappings || {};
    const isNativeColour = theme.name === 'Model Native Colour' || Object.keys(colorMappings).length === 0;
    
    // Store original colors if not already stored
    if (state.originalColors.size === 0) {
      const objects = scene.objects;
      for (const objectId in objects) {
        const entity = objects[objectId];
        if (entity) {
          state.originalColors.set(objectId, {
            color: entity.colorize ? [...entity.colorize] : [1, 1, 1],
            opacity: entity.opacity ?? 1,
            edges: entity.edges ?? true,
          });
        }
      }
      const edgeMaterial = scene.edgeMaterial;
      if (edgeMaterial) {
        state.originalEdgeColor = [...edgeMaterial.edgeColor];
        state.originalEdgeAlpha = edgeMaterial.edgeAlpha;
      }
      const container = document.getElementById('AssetPlusViewer');
      if (container) {
        state.originalBackground = container.style.background || '';
      }
    }

    // "Model Native Colour" — restore original model colors (no architect palette)
    if (isNativeColour) {
      console.log('Applying Model Native Colour: restoring original model colors');
      for (const [objectId, original] of state.originalColors) {
        const entity = scene.objects[objectId];
        if (entity) {
          entity.colorize = original.color;
          entity.opacity = original.opacity;
          entity.edges = original.edges;
        }
      }
      // Disable edges for cleaner native look
      if (scene.edgeMaterial) {
        scene.edgeMaterial.edgeAlpha = 0;
      }
      state.activeThemeId = theme.id;
      setActiveTheme(theme);
      window.dispatchEvent(new CustomEvent(VIEWER_THEME_CHANGED_EVENT, {
        detail: { themeId: theme.id, themeName: theme.name }
      }));
      return true;
    }

    console.log('Applying viewer theme:', theme.name);

    // Store original colors if not already stored
    if (state.originalColors.size === 0) {
      const objects = scene.objects;
      for (const objectId in objects) {
        const entity = objects[objectId];
        if (entity) {
          state.originalColors.set(objectId, {
            color: entity.colorize ? [...entity.colorize] : [1, 1, 1],
            opacity: entity.opacity ?? 1,
            edges: entity.edges ?? true,
          });
        }
      }
      
      // Store original edge material
      const edgeMaterial = scene.edgeMaterial;
      if (edgeMaterial) {
        state.originalEdgeColor = [...edgeMaterial.edgeColor];
        state.originalEdgeAlpha = edgeMaterial.edgeAlpha;
      }
      
      // Store original background
      const container = document.getElementById('AssetPlusViewer');
      if (container) {
        state.originalBackground = container.style.background || '';
      }
    }

    // Apply subtle edge settings for cleaner look
    const edgeMaterial = scene.edgeMaterial;
    if (edgeMaterial && theme.edge_settings?.enabled) {
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
        
        // Get IFC type and find matching color mapping
        const ifcType = (metaObject.type || '').toLowerCase();
        const mapping = colorMappings[ifcType] || colorMappings['default'];
        
        if (mapping) {
          // Apply color
          entity.colorize = hexToRgb(mapping.color);
          
          // Apply edges setting
          if (mapping.edges !== undefined) {
            entity.edges = mapping.edges;
          }
          
          // Apply opacity for spaces
          if (ifcType === 'ifcspace' && mapping.opacity !== undefined) {
            entity.opacity = mapping.opacity;
          } else if (ifcType === 'ifcspace') {
            entity.opacity = theme.space_opacity ?? 0.25;
          }
        }
      }
    }

    state.activeThemeId = theme.id;
    setActiveTheme(theme);
    
    window.dispatchEvent(new CustomEvent(VIEWER_THEME_CHANGED_EVENT, {
      detail: { themeId: theme.id, themeName: theme.name }
    }));
    
    console.log('Viewer theme applied:', theme.name);
    return true;
  }, []);

  /**
   * Reset theme to original colors
   */
  const resetTheme = useCallback((viewerRef: React.MutableRefObject<any>) => {
    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const scene = xeokitViewer?.scene;
    const state = stateRef.current;
    
    if (!scene || state.originalColors.size === 0) {
      return;
    }

    console.log('Resetting viewer theme to original colors...');

    // Restore edge material
    if (scene.edgeMaterial) {
      scene.edgeMaterial.edgeColor = state.originalEdgeColor;
      scene.edgeMaterial.edgeAlpha = state.originalEdgeAlpha;
    }

    // Restore background
    const container = document.getElementById('AssetPlusViewer');
    if (container && state.originalBackground) {
      container.style.background = state.originalBackground;
    }

    // Restore original colors
    for (const [objectId, original] of state.originalColors) {
      const entity = scene.objects[objectId];
      if (entity) {
        entity.colorize = original.color;
        entity.opacity = original.opacity;
        entity.edges = original.edges;
      }
    }

    // Clear stored state
    state.originalColors.clear();
    state.activeThemeId = null;
    setActiveTheme(null);
    
    console.log('Viewer theme reset complete');
  }, []);

  /**
   * Select a theme by ID
   */
  const selectTheme = useCallback((viewerRef: React.MutableRefObject<any>, themeId: string) => {
    const theme = themes.find(t => t.id === themeId);
    if (theme) {
      // First reset if we have a different theme active
      if (stateRef.current.activeThemeId && stateRef.current.activeThemeId !== themeId) {
        resetTheme(viewerRef);
      }
      return applyTheme(viewerRef, theme);
    }
    return false;
  }, [themes, applyTheme, resetTheme]);

  /**
   * Create a new theme
   */
  const createTheme = useCallback(async (theme: Omit<ViewerTheme, 'id' | 'created_at' | 'updated_at'>) => {
    const { data, error } = await supabase
      .from('viewer_themes')
      .insert({
        name: theme.name,
        is_system: false,
        color_mappings: theme.color_mappings as unknown as Record<string, unknown>,
        edge_settings: theme.edge_settings as unknown as Record<string, unknown>,
        space_opacity: theme.space_opacity,
      } as any)
      .select()
      .single();
    
    if (error) throw error;
    await fetchThemes();
    return data as unknown as ViewerTheme;
  }, [fetchThemes]);

  /**
   * Update an existing theme
   */
  const updateTheme = useCallback(async (id: string, updates: Partial<ViewerTheme>) => {
    const { error } = await supabase
      .from('viewer_themes')
      .update({
        name: updates.name,
        color_mappings: updates.color_mappings as unknown as Record<string, unknown>,
        edge_settings: updates.edge_settings as unknown as Record<string, unknown>,
        space_opacity: updates.space_opacity,
      } as any)
      .eq('id', id);
    
    if (error) throw error;
    await fetchThemes();
  }, [fetchThemes]);

  /**
   * Delete a theme
   */
  const deleteTheme = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('viewer_themes')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    await fetchThemes();
  }, [fetchThemes]);

  return {
    themes,
    activeTheme,
    isLoading,
    fetchThemes,
    applyTheme,
    resetTheme,
    selectTheme,
    createTheme,
    updateTheme,
    deleteTheme,
    getActiveThemeId: () => stateRef.current.activeThemeId,
  };
}
