import React, { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';

interface AnnotationCategory {
  category: string;       // Internal key (asset_type)
  displayName: string;    // Swedish display name from symbol
  count: number;
  visible: boolean;
  color: string;
}

interface AnnotationCategoryListProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
}

/**
 * List component to toggle visibility of annotation categories in the 3D viewer.
 * Uses Swedish display names from annotation_symbols table.
 * Used inside SidePopPanel as a flyout from the main VisualizationToolbar.
 */
const AnnotationCategoryList: React.FC<AnnotationCategoryListProps> = ({
  viewerRef,
  buildingFmGuid,
}) => {
  const [categories, setCategories] = useState<AnnotationCategory[]>([]);
  const [allVisible, setAllVisible] = useState(true);

  // Fetch asset categories with annotations for this building
  useEffect(() => {
    const fetchCategories = async () => {
      if (!buildingFmGuid) return;

      // Get assets with placed annotations OR alarm types for this building
      const { data: assets } = await supabase
        .from('assets')
        .select('asset_type, symbol_id')
        .eq('building_fm_guid', buildingFmGuid)
        .or('annotation_placed.eq.true,asset_type.eq.IfcAlarm');

      // Get all symbols for Swedish names and colors
      const { data: symbols } = await supabase
        .from('annotation_symbols')
        .select('id, name, color');

      const symbolById = new Map(symbols?.map(s => [s.id, s]) || []);

      if (assets) {
        // Group by asset_type and get Swedish names from symbols
        const typeInfo: Record<string, { count: number; displayName: string; color: string }> = {};
        
        assets.forEach(asset => {
          const symbol = asset.symbol_id ? symbolById.get(asset.symbol_id) : null;
          const key = asset.asset_type || 'Övrigt';
          
          if (!typeInfo[key]) {
            typeInfo[key] = {
              count: 0,
              displayName: symbol?.name || key,  // Use Swedish name from symbol
              color: symbol?.color || '#3B82F6',
            };
          }
          typeInfo[key].count++;
        });

        const cats: AnnotationCategory[] = Object.entries(typeInfo).map(([type, info]) => ({
          category: type,
          displayName: info.displayName,
          count: info.count,
          visible: true,
          color: info.color,
        }));

        setCategories(cats);
      }
    };
    fetchCategories();
  }, [buildingFmGuid]);

  // Toggle a specific category
  const handleToggleCategory = useCallback((category: string) => {
    setCategories(prev => {
      const updated = prev.map(c => {
        if (c.category === category) {
          return { ...c, visible: !c.visible };
        }
        return c;
      });
      
      // Dispatch TOGGLE_ANNOTATIONS with updated visible categories for NativeXeokitViewer
      const visibleCats = updated.filter(c => c.visible).map(c => c.category);
      window.dispatchEvent(new CustomEvent('TOGGLE_ANNOTATIONS', {
        detail: { show: visibleCats.length > 0, visibleCategories: visibleCats },
      }));
      
      // Also try legacy local annotations plugin
      try {
        const localPlugin = viewerRef.current?.localAnnotationsPlugin;
        if (localPlugin?.annotations) {
          const targetCat = updated.find(c => c.category === category);
          Object.values(localPlugin.annotations).forEach((annotation: any) => {
            if (annotation.category === category) {
              annotation.markerShown = targetCat?.visible ?? true;
              if (annotation.markerElement) {
                annotation.markerElement.style.display = (targetCat?.visible ?? true) ? 'flex' : 'none';
              }
            }
          });
        }
      } catch (e) {
        console.debug('Could not toggle local annotations:', e);
      }
      
      return updated;
    });
  }, [viewerRef]);

  // Toggle all categories
  const handleToggleAll = useCallback(() => {
    const newVisible = !allVisible;
    setAllVisible(newVisible);
    
    setCategories(prev => prev.map(c => ({ ...c, visible: newVisible })));
    
    // Toggle all annotations in the LOCAL annotations manager
    try {
      const localPlugin = viewerRef.current?.localAnnotationsPlugin;
      if (localPlugin?.annotations) {
        Object.values(localPlugin.annotations).forEach((annotation: any) => {
          annotation.markerShown = newVisible;
          if (annotation.markerElement) {
            annotation.markerElement.style.display = newVisible ? 'flex' : 'none';
          }
        });
      }
    } catch (e) {
      console.debug('Could not toggle all local annotations:', e);
    }
  }, [allVisible, viewerRef]);

  if (categories.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        No annotations in this building
      </p>
    );
  }

  const visibleCount = categories.filter(c => c.visible).length;

  return (
    <div className="space-y-2">
      {/* Show/Hide All button */}
      <div className="flex items-center justify-between pb-2 border-b">
        <span className="text-xs text-muted-foreground">
          {visibleCount}/{categories.length} visible
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={handleToggleAll}
        >
          {allVisible ? (
            <>
              <EyeOff className="h-3 w-3" />
              Hide all
            </>
          ) : (
            <>
              <Eye className="h-3 w-3" />
              Show all
            </>
          )}
        </Button>
      </div>
      
      {/* Category list with Swedish display names */}
      {categories.map((cat) => (
        <div
          key={cat.category}
          className="flex items-center justify-between py-1.5"
        >
          <div className="flex items-center gap-2">
            <div 
              className="w-2.5 h-2.5 rounded-full border"
              style={{ backgroundColor: cat.color }}
            />
            <span className="text-xs">{cat.displayName}</span>
            <span className="text-[10px] text-muted-foreground">({cat.count})</span>
          </div>
          <Switch
            checked={cat.visible}
            onCheckedChange={() => handleToggleCategory(cat.category)}
            className="scale-75"
          />
        </div>
      ))}
    </div>
  );
};

export default AnnotationCategoryList;
