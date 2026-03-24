/**
 * Viewer Theme Hook
 * 
 * Applies custom color themes to the 3D viewer based on user-defined or system presets.
 * Optimized for performance: uses type-based batch coloring instead of per-entity iteration.
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
  background_color?: string | null;
  space_opacity: number;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_VIEWER_THEME_BACKGROUND = 'hsl(210 10% 91%)';

// Pre-computed RGB cache to avoid repeated hex parsing
const rgbCache = new Map<string, number[]>();

const hexToRgb = (hex: string): number[] => {
  const cached = rgbCache.get(hex);
  if (cached) return cached;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0.9, 0.9, 0.9];
  const rgb = [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
  rgbCache.set(hex, rgb);
  return rgb;
};

// Event names for theme changes
export const VIEWER_THEME_CHANGED_EVENT = 'VIEWER_THEME_CHANGED';
export const VIEWER_THEME_REQUESTED_EVENT = 'VIEWER_THEME_REQUESTED';

interface OriginalEdgeState {
  edgeColor: number[];
  edgeAlpha: number;
}

interface ViewerThemeState {
  activeThemeId: string | null;
  /** Only store edge material state — skip per-object storage for performance */
  originalEdge: OriginalEdgeState | null;
  originalBackground: string;
}

export function useViewerTheme() {
  const [themes, setThemes] = useState<ViewerTheme[]>([]);
  const [activeTheme, setActiveTheme] = useState<ViewerTheme | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const stateRef = useRef<ViewerThemeState>({
    activeThemeId: null,
    originalEdge: null,
    originalBackground: '',
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
      const typedData = (data || []) as unknown as ViewerTheme[];
      setThemes(typedData);
    } catch (err) {
      console.error('Failed to fetch viewer themes:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchThemes();
  }, [fetchThemes]);

  /**
   * Build a type→color index from the theme, then iterate objects ONCE.
   * This is significantly faster than the previous approach of looking up
   * each object's type in the color_mappings dict.
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
    
    // Store original edge material state once
    if (!state.originalEdge) {
      const edgeMaterial = scene.edgeMaterial;
      if (edgeMaterial) {
        state.originalEdge = {
          edgeColor: [...edgeMaterial.edgeColor],
          edgeAlpha: edgeMaterial.edgeAlpha,
        };
      }
      const container = document.getElementById('AssetPlusViewer') || document.querySelector('.native-viewer-canvas-parent') as HTMLElement;
      if (container) {
        state.originalBackground = container.style.background || '';
      }
    }

    // Apply configured background for theme
    const bgContainer = document.getElementById('AssetPlusViewer') || document.querySelector('.native-viewer-canvas-parent') as HTMLElement;
    if (bgContainer) {
      bgContainer.style.background = theme.background_color || DEFAULT_VIEWER_THEME_BACKGROUND;
    }

    // "Model Native Colour" — clear all colorization in one batch call
    if (isNativeColour) {
      // Use batch API to clear colorize on all objects at once
      const colorizedIds = scene.colorizedObjectIds;
      if (colorizedIds?.length > 0) {
        scene.setObjectsColorized(colorizedIds, false);
      }
      // Reset opacity for spaces that were made transparent
      const metaScene = xeokitViewer.metaScene;
      if (metaScene) {
        const objects = scene.objects;
        for (const objectId in objects) {
          const entity = objects[objectId];
          const mo = metaScene.metaObjects?.[objectId];
          if (entity && mo) {
            const ifcType = (mo.type || '').toLowerCase();
            if (ifcType === 'ifcspace') {
              entity.opacity = 1;
              entity.visible = false;
              entity.pickable = false;
            }
          }
        }
      }
      // Restore original edge settings
      if (scene.edgeMaterial && state.originalEdge) {
        scene.edgeMaterial.edgeColor = state.originalEdge.edgeColor;
        scene.edgeMaterial.edgeAlpha = state.originalEdge.edgeAlpha;
      }
      state.activeThemeId = theme.id;
      setActiveTheme(theme);
      window.dispatchEvent(new CustomEvent(VIEWER_THEME_CHANGED_EVENT, {
        detail: { themeId: theme.id, themeName: theme.name }
      }));
      return true;
    }

    // Apply edge settings from theme
    const edgeMaterial = scene.edgeMaterial;
    if (edgeMaterial && theme.edge_settings?.enabled) {
      const edgeColor = theme.edge_settings.edgeColor ? hexToRgb(theme.edge_settings.edgeColor) : [0.85, 0.84, 0.82];
      edgeMaterial.edgeColor = edgeColor;
      edgeMaterial.edgeAlpha = theme.edge_settings.edgeAlpha ?? 0.15;
      edgeMaterial.edgeWidth = theme.edge_settings.edgeWidth ?? 1;
    }

    // Pre-compute RGB values for all mappings (avoids hex parsing per-object)
    const precomputedMappings = new Map<string, { rgb: number[]; edges?: boolean; opacity?: number }>();
    for (const [type, mapping] of Object.entries(colorMappings)) {
      precomputedMappings.set(type, {
        rgb: hexToRgb(mapping.color),
        edges: mapping.edges,
        opacity: mapping.opacity,
      });
    }
    const defaultMapping = precomputedMappings.get('default');
    const spaceOpacity = theme.space_opacity ?? 0.25;

    // Single pass through objects — apply theme colors
    const metaScene = xeokitViewer.metaScene;
    const objects = scene.objects;
    
    if (metaScene && objects) {
      for (const objectId in objects) {
        const entity = objects[objectId];
        const metaObject = metaScene.metaObjects[objectId];
        if (!entity || !metaObject) continue;
        
        const ifcType = (metaObject.type || '').toLowerCase();
        const mapping = precomputedMappings.get(ifcType) || defaultMapping;
        
        if (mapping) {
          entity.colorize = mapping.rgb;
          if (mapping.edges !== undefined) entity.edges = mapping.edges;
          if (mapping.opacity !== undefined) {
            entity.opacity = mapping.opacity;
          } else if (ifcType === 'ifcspace') {
            entity.opacity = spaceOpacity;
          }
        }
      }
    }

    state.activeThemeId = theme.id;
    setActiveTheme(theme);
    
    window.dispatchEvent(new CustomEvent(VIEWER_THEME_CHANGED_EVENT, {
      detail: { themeId: theme.id, themeName: theme.name }
    }));
    
    return true;
  }, []);

  /**
   * Reset theme — clear colorization in batch
   */
  const resetTheme = useCallback((viewerRef: React.MutableRefObject<any>) => {
    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const scene = xeokitViewer?.scene;
    const state = stateRef.current;
    
    if (!scene) return;

    // Batch clear colorize
    const colorizedIds = scene.colorizedObjectIds;
    if (colorizedIds?.length > 0) {
      scene.setObjectsColorized(colorizedIds, false);
    }

    // Restore edge material
    if (scene.edgeMaterial && state.originalEdge) {
      scene.edgeMaterial.edgeColor = state.originalEdge.edgeColor;
      scene.edgeMaterial.edgeAlpha = state.originalEdge.edgeAlpha;
    }

    // Restore background
    const container = document.getElementById('AssetPlusViewer') || document.querySelector('.native-viewer-canvas-parent') as HTMLElement;
    if (container && state.originalBackground) {
      container.style.background = state.originalBackground;
    }

    state.activeThemeId = null;
    setActiveTheme(null);
  }, []);

  /**
   * Select a theme by ID
   */
  const selectTheme = useCallback((viewerRef: React.MutableRefObject<any>, themeId: string) => {
    const theme = themes.find(t => t.id === themeId);
    if (theme) {
      return applyTheme(viewerRef, theme);
    }
    return false;
  }, [themes, applyTheme]);

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
          background_color: theme.background_color,
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
        background_color: updates.background_color,
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
