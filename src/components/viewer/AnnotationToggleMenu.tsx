import React, { useState, useEffect, useCallback, useContext } from 'react';
import { Eye, EyeOff, ChevronDown, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { AppContext } from '@/context/AppContext';

interface AnnotationCategory {
  category: string;
  count: number;
  visible: boolean;
  color: string;
}

interface AnnotationToggleMenuProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;
  className?: string;
}

/**
 * Dropdown menu to toggle visibility of annotation categories in the 3D viewer
 */
const AnnotationToggleMenu: React.FC<AnnotationToggleMenuProps> = ({
  viewerRef,
  buildingFmGuid,
  className
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
    return null;
  }

  const visibleCount = categories.filter(c => c.visible).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="secondary" 
          size="sm" 
          className={cn("gap-2 shadow-lg bg-card/95 backdrop-blur-sm border", className)}
        >
          <Tag className="h-4 w-4" />
          <span className="hidden sm:inline">Annotationer</span>
          <span className="text-xs text-muted-foreground">
            ({visibleCount}/{categories.length})
          </span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Annotationstyper</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleToggleAll}
          >
            {allVisible ? (
              <>
                <EyeOff className="h-3 w-3 mr-1" />
                Dölj alla
              </>
            ) : (
              <>
                <Eye className="h-3 w-3 mr-1" />
                Visa alla
              </>
            )}
          </Button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {categories.map((cat) => (
          <DropdownMenuItem
            key={cat.category}
            className="flex items-center justify-between cursor-pointer"
            onSelect={(e) => {
              e.preventDefault();
              handleToggleCategory(cat.category);
            }}
          >
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full border"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-sm">{cat.category}</span>
              <span className="text-xs text-muted-foreground">({cat.count})</span>
            </div>
            <Switch
              checked={cat.visible}
              onCheckedChange={() => handleToggleCategory(cat.category)}
              className="scale-75"
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AnnotationToggleMenu;
