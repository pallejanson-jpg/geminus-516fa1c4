import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface ModelInfo {
  id: string;
  name: string;
  type: string;
  loaded: boolean;
}

interface ModelSelectorProps {
  viewerRef: React.MutableRefObject<any>;
  onModelToggle?: (model: ModelInfo, visible: boolean) => void;
  className?: string;
}

/**
 * Model selector dropdown for toggling BIM model visibility
 * Safely handles Asset+ viewer API to avoid DOM manipulation errors
 */
const ModelSelector: React.FC<ModelSelectorProps> = ({
  viewerRef,
  onModelToggle,
  className
}) => {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [visibleModels, setVisibleModels] = useState<Set<string>>(new Set());

  // Safely get the XEOkit viewer
  const getXeokitViewer = useCallback(() => {
    try {
      const viewer = viewerRef.current;
      if (!viewer) return null;
      
      // Check if refs exist before accessing
      const assetViewer = viewer.$refs?.AssetViewer;
      if (!assetViewer) return null;
      
      const assetView = assetViewer.$refs?.assetView;
      if (!assetView) return null;
      
      return assetView.viewer || null;
    } catch (e) {
      console.debug('Could not get XEOkit viewer:', e);
      return null;
    }
  }, [viewerRef]);

  // Extract available models from the scene
  const extractModels = useCallback(() => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer?.scene?.models) return [];

    const extractedModels: ModelInfo[] = [];
    const loadedModels = new Set<string>();

    try {
      Object.entries(xeokitViewer.scene.models || {}).forEach(([id, model]: [string, any]) => {
        if (model) {
          // Extract model name from id or use default
          const name = model.name || id.split('/').pop() || id;
          const type = getModelType(name);
          
          extractedModels.push({
            id,
            name,
            type,
            loaded: true,
          });
          loadedModels.add(id);
        }
      });
    } catch (e) {
      console.debug('Error extracting models:', e);
    }

    // Initialize visibility state for all loaded models
    setVisibleModels(loadedModels);

    return extractedModels;
  }, [getXeokitViewer]);

  // Determine model type from name
  const getModelType = (name: string): string => {
    const lowerName = name.toLowerCase();
    if (lowerName.startsWith('a') || lowerName.includes('arkitekt')) return 'A-modell';
    if (lowerName.startsWith('e') || lowerName.includes('el')) return 'E-modell';
    if (lowerName.startsWith('v') || lowerName.includes('vvs')) return 'V-modell';
    if (lowerName.startsWith('k') || lowerName.includes('konstruktion')) return 'K-modell';
    if (lowerName.startsWith('b') || lowerName.includes('bygg')) return 'B-modell';
    return 'Modell';
  };

  // Toggle model visibility safely
  const handleToggleModel = useCallback((model: ModelInfo) => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer?.scene?.models?.[model.id]) {
      console.warn('Model not found in scene:', model.id);
      return;
    }

    try {
      const sceneModel = xeokitViewer.scene.models[model.id];
      const newVisible = !visibleModels.has(model.id);
      
      // Toggle visibility of all objects in the model
      if (sceneModel.objects) {
        Object.values(sceneModel.objects).forEach((obj: any) => {
          if (obj && typeof obj.visible !== 'undefined') {
            obj.visible = newVisible;
          }
        });
      }

      // Update state
      setVisibleModels(prev => {
        const next = new Set(prev);
        if (newVisible) {
          next.add(model.id);
        } else {
          next.delete(model.id);
        }
        return next;
      });

      onModelToggle?.(model, newVisible);
    } catch (e) {
      console.warn('Error toggling model visibility:', e);
    }
  }, [getXeokitViewer, visibleModels, onModelToggle]);

  // Load models when viewer is ready
  useEffect(() => {
    const checkModels = () => {
      const newModels = extractModels();
      if (newModels.length > 0 && newModels.length !== models.length) {
        setModels(newModels);
      }
    };

    // Initial check with delay to ensure viewer is ready
    const timeout = setTimeout(checkModels, 500);
    
    // Periodic check
    const interval = setInterval(() => {
      if (models.length === 0) checkModels();
    }, 1000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [extractModels, models.length]);

  if (models.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="secondary" 
          size="sm" 
          className={cn("gap-2", className)}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <span className="hidden sm:inline">Modeller ({models.length})</span>
              <span className="sm:hidden">{models.length}</span>
              <ChevronDown className="h-3 w-3" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          BIM-modeller
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => handleToggleModel(model)}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex flex-col">
              <span className="font-medium text-sm">{model.type}</span>
              <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                {model.name}
              </span>
            </div>
            {visibleModels.has(model.id) && (
              <Check className="h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ModelSelector;
