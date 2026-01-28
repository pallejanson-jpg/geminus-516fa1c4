import React, { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';

interface AnnotationCategory {
  category: string;
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
 * Used inside SidePopPanel as a flyout from the main VisualizationToolbar.
 */
const AnnotationCategoryList: React.FC<AnnotationCategoryListProps> = ({
  viewerRef,
  buildingFmGuid,
}) => {
  const [categories, setCategories] = useState<AnnotationCategory[]>([]);
  const [symbolColors, setSymbolColors] = useState<Record<string, string>>({});
  const [allVisible, setAllVisible] = useState(true);

  // Fetch annotation symbols for colors
  useEffect(() => {
    const fetchSymbols = async () => {
      const { data } = await supabase
        .from('annotation_symbols')
        .select('category, color');
      
      if (data) {
        const colorMap: Record<string, string> = {};
        data.forEach(s => {
          colorMap[s.category] = s.color;
        });
        setSymbolColors(colorMap);
      }
    };
    fetchSymbols();
  }, []);

  // Fetch asset categories with annotations for this building
  useEffect(() => {
    const fetchCategories = async () => {
      if (!buildingFmGuid) return;

      // Get unique asset types for this building that have annotations
      const { data } = await supabase
        .from('assets')
        .select('asset_type, category')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('category', 'Instance')
        .eq('annotation_placed', true);

      if (data) {
        // Group by asset_type or category
        const typeCount: Record<string, number> = {};
        data.forEach(asset => {
          const type = asset.asset_type || 'Övrigt';
          typeCount[type] = (typeCount[type] || 0) + 1;
        });

        const cats: AnnotationCategory[] = Object.entries(typeCount).map(([type, count]) => ({
          category: type,
          count,
          visible: true,
          color: symbolColors[type] || '#3B82F6',
        }));

        setCategories(cats);
      }
    };
    fetchCategories();
  }, [buildingFmGuid, symbolColors]);

  // Toggle a specific category
  const handleToggleCategory = useCallback((category: string) => {
    setCategories(prev => prev.map(c => {
      if (c.category === category) {
        const newVisible = !c.visible;
        
        // Toggle annotations in viewer
        try {
          const viewer = viewerRef.current;
          if (viewer?.annotationsPlugin) {
            const annotations = viewer.annotationsPlugin.annotations || {};
            Object.values(annotations).forEach((annotation: any) => {
              // Check if annotation belongs to this category
              if (annotation.cfg?.category === category || 
                  annotation.entity?.meta?.assetType === category) {
                annotation.markerShown = newVisible;
                annotation.labelShown = newVisible;
              }
            });
          }
        } catch (e) {
          console.debug('Could not toggle annotations:', e);
        }
        
        return { ...c, visible: newVisible };
      }
      return c;
    }));
  }, [viewerRef]);

  // Toggle all categories
  const handleToggleAll = useCallback(() => {
    const newVisible = !allVisible;
    setAllVisible(newVisible);
    
    setCategories(prev => prev.map(c => ({ ...c, visible: newVisible })));
    
    // Toggle all annotations in viewer
    try {
      const viewer = viewerRef.current;
      if (viewer?.annotationsPlugin) {
        const annotations = viewer.annotationsPlugin.annotations || {};
        Object.values(annotations).forEach((annotation: any) => {
          annotation.markerShown = newVisible;
          annotation.labelShown = newVisible;
        });
      }
    } catch (e) {
      console.debug('Could not toggle all annotations:', e);
    }
  }, [allVisible, viewerRef]);

  if (categories.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        Inga annotationer i denna byggnad
      </p>
    );
  }

  const visibleCount = categories.filter(c => c.visible).length;

  return (
    <div className="space-y-2">
      {/* Show/Hide All button */}
      <div className="flex items-center justify-between pb-2 border-b">
        <span className="text-xs text-muted-foreground">
          {visibleCount}/{categories.length} synliga
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
              Dölj alla
            </>
          ) : (
            <>
              <Eye className="h-3 w-3" />
              Visa alla
            </>
          )}
        </Button>
      </div>
      
      {/* Category list */}
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
            <span className="text-xs">{cat.category}</span>
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
