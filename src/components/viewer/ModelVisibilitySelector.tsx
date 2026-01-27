import React, { useState, useEffect, useCallback, useMemo, forwardRef } from 'react';
import { Box, ChevronDown, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

export interface ModelInfo {
  id: string;
  name: string;
  shortName: string;
}

interface ModelVisibilitySelectorProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  onVisibleModelsChange?: (visibleModelIds: string[]) => void;
  className?: string;
}

/**
 * Multi-select BIM model visibility selector with switches.
 * Collapsed by default - expands when user clicks to select models.
 * Controls which models are visible in the 3D viewer.
 * Fetches model names from Asset+ API for user-friendly display.
 */
const ModelVisibilitySelector = forwardRef<HTMLDivElement, ModelVisibilitySelectorProps>(
  ({ viewerRef, buildingFmGuid, onVisibleModelsChange, className }, ref) => {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [visibleModelIds, setVisibleModelIds] = useState<Set<string>>(new Set());
    const [isExpanded, setIsExpanded] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [modelNamesMap, setModelNamesMap] = useState<Map<string, string>>(new Map());
    const [isLoadingNames, setIsLoadingNames] = useState(false);

  // Helper to extract model ID from xktFileUrl
  const extractModelIdFromUrl = (xktFileUrl: string): string => {
    const fileName = xktFileUrl.split('/').pop() || '';
    return fileName.replace('.xkt', '');
  };

  // Fetch model names from Asset+ API
  useEffect(() => {
    if (!buildingFmGuid) return;

    const fetchModelNames = async () => {
      setIsLoadingNames(true);
      try {
        const [tokenResult, configResult] = await Promise.all([
          supabase.functions.invoke('asset-plus-query', { body: { action: 'getToken' } }),
          supabase.functions.invoke('asset-plus-query', { body: { action: 'getConfig' } })
        ]);

        const accessToken = tokenResult.data?.accessToken;
        const apiUrl = configResult.data?.apiUrl;
        const apiKey = configResult.data?.apiKey;

        if (!accessToken || !apiUrl) {
          setIsLoadingNames(false);
          return;
        }

        // Build base URL for 3D API
        const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
        const response = await fetch(
          `${baseUrl}/api/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (response.ok) {
          const apiModels = await response.json();
          const nameMap = new Map<string, string>();
          console.debug("Asset+ GetModels response:", apiModels);
          
          apiModels.forEach((m: any) => {
            // Primary: map model.id to name
            if (m.id && m.name) {
              nameMap.set(m.id, m.name);
              // Also try lowercase version
              nameMap.set(m.id.toLowerCase(), m.name);
            }
            // Secondary: extract filename from xktFileUrl and map to name
            if (m.xktFileUrl && m.name) {
              const fileId = extractModelIdFromUrl(m.xktFileUrl);
              nameMap.set(fileId, m.name);
              nameMap.set(fileId.toLowerCase(), m.name);
              // Also with .xkt extension
              nameMap.set(fileId + '.xkt', m.name);
              nameMap.set(fileId.toLowerCase() + '.xkt', m.name);
            }
          });
          
          console.debug("Model names map:", Object.fromEntries(nameMap));
          setModelNamesMap(nameMap);
        } else {
          console.debug("Asset+ GetModels failed:", response.status);
        }
      } catch (e) {
        console.debug("Failed to fetch model names from Asset+:", e);
      } finally {
        setIsLoadingNames(false);
      }
    };

    fetchModelNames();
  }, [buildingFmGuid]);

    // Get XEOkit viewer
    const getXeokitViewer = useCallback(() => {
      try {
        return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      } catch (e) {
        return null;
      }
    }, [viewerRef]);

    // Extract models from scene with friendly names from API
    const extractModels = useCallback(() => {
      const viewer = getXeokitViewer();
      if (!viewer?.scene?.models) return [];

      const sceneModels = viewer.scene.models;
      const extractedModels: ModelInfo[] = [];

      Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
        const rawName = model.id || modelId;
        // Try multiple matching strategies for model names
        const matchedName = modelNamesMap.get(modelId) 
          || modelNamesMap.get(modelId.toLowerCase())
          || modelNamesMap.get(rawName)
          || modelNamesMap.get(rawName.toLowerCase())
          || modelNamesMap.get(rawName.replace(/\.xkt$/i, ''))
          || modelNamesMap.get(rawName.replace(/\.xkt$/i, '').toLowerCase());
        
        const friendlyName = matchedName || rawName.replace(/\.xkt$/i, '').replace(/-/g, ' ');
        const shortName = friendlyName.length > 30 ? friendlyName.substring(0, 30) + '...' : friendlyName;

        if (!matchedName && modelNamesMap.size > 0) {
          console.debug("No API name match for model:", modelId, "rawName:", rawName);
        }

        extractedModels.push({
          id: modelId,
          name: friendlyName,
          shortName,
        });
      });

      // Sort alphabetically
      extractedModels.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

      return extractedModels;
    }, [getXeokitViewer, modelNamesMap]);

    // Apply visibility changes to 3D viewer
    const applyModelVisibility = useCallback((visibleIds: Set<string>) => {
      const viewer = getXeokitViewer();
      if (!viewer?.scene?.models) return;

      const sceneModels = viewer.scene.models;

      Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
        const isVisible = visibleIds.has(modelId);
        
        // Set visibility on all objects in this model
        if (model.objects) {
          Object.values(model.objects).forEach((obj: any) => {
            if (obj && typeof obj.visible !== 'undefined') {
              obj.visible = isVisible;
            }
          });
        }
        
        // Also try setting on the model itself if it supports it
        if (typeof model.visible !== 'undefined') {
          model.visible = isVisible;
        }
      });
    }, [getXeokitViewer]);

    // Load models once and set only A-models visible by default
    // Wait for model names to be loaded before initializing
    useEffect(() => {
      if (isInitialized || isLoadingNames) return;

      const checkModels = () => {
        const newModels = extractModels();
        if (newModels.length > 0) {
          setModels(newModels);
          
          // Filter to only A-models as default
          const aModelIds = new Set(
            newModels
              .filter(m => {
                const nameLower = m.name.toLowerCase();
                return nameLower.startsWith('a') || nameLower.includes('a-modell') || nameLower.includes('arkitekt');
              })
              .map(m => m.id)
          );
          
          // If no A-models found, show all
          const idsToShow = aModelIds.size > 0 ? aModelIds : new Set(newModels.map(m => m.id));
          setVisibleModelIds(idsToShow);
          
          // Apply visibility immediately
          applyModelVisibility(idsToShow);
          setIsInitialized(true);
        }
      };

      checkModels();
      
      // Only retry a few times, not forever
      let attempts = 0;
      const maxAttempts = 10;
      const interval = setInterval(() => {
        if (isInitialized || attempts >= maxAttempts) {
          clearInterval(interval);
          return;
        }
        checkModels();
        attempts++;
      }, 500);

      return () => clearInterval(interval);
    }, [extractModels, isInitialized, applyModelVisibility, isLoadingNames]);

    // Re-extract models with updated names when modelNamesMap changes (after API fetch)
    useEffect(() => {
      if (!isInitialized || modelNamesMap.size === 0) return;
      
      const updatedModels = extractModels();
      if (updatedModels.length > 0) {
        setModels(updatedModels);
      }
    }, [modelNamesMap, isInitialized, extractModels]);

    const handleModelToggle = useCallback((modelId: string, checked: boolean) => {
      setVisibleModelIds(prev => {
        const newSet = new Set(prev);
        if (checked) {
          newSet.add(modelId);
        } else {
          newSet.delete(modelId);
        }
        
        applyModelVisibility(newSet);
        
        if (onVisibleModelsChange) {
          onVisibleModelsChange(Array.from(newSet));
        }
        
        return newSet;
      });
    }, [applyModelVisibility, onVisibleModelsChange]);

    const handleShowOnlyModel = useCallback((modelId: string) => {
      const newSet = new Set([modelId]);
      setVisibleModelIds(newSet);
      applyModelVisibility(newSet);
      
      if (onVisibleModelsChange) {
        onVisibleModelsChange([modelId]);
      }
    }, [applyModelVisibility, onVisibleModelsChange]);

    const handleShowAll = useCallback(() => {
      const allIds = new Set(models.map(m => m.id));
      setVisibleModelIds(allIds);
      applyModelVisibility(allIds);
      
      if (onVisibleModelsChange) {
        onVisibleModelsChange(models.map(m => m.id));
      }
    }, [applyModelVisibility, models, onVisibleModelsChange]);

    const allVisible = useMemo(() => 
      models.length > 0 && visibleModelIds.size === models.length,
      [models, visibleModelIds]
    );

    const visibleCount = visibleModelIds.size;
    const totalCount = models.length;

    // Don't show if only one model or no models
    if (models.length <= 1) {
      return null;
    }

    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className={cn("space-y-2", className)}>
        <div className="flex items-center justify-between" ref={ref}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 hover:bg-transparent justify-start gap-1.5"
            >
              <Box className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs text-muted-foreground uppercase tracking-wider cursor-pointer">
                BIM-modeller
              </Label>
              <span className="text-xs text-muted-foreground ml-1">
                ({visibleCount}/{totalCount})
              </span>
              <ChevronDown className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                isExpanded && "rotate-180"
              )} />
            </Button>
          </CollapsibleTrigger>
          
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleShowAll}
            disabled={allVisible}
          >
            Visa alla
          </Button>
        </div>

        <CollapsibleContent className="space-y-1">
          <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
            {models.map((model) => {
              const isVisible = visibleModelIds.has(model.id);
              const isSolo = visibleModelIds.size === 1 && isVisible;
              
              return (
                <div
                  key={model.id}
                  className={cn(
                    "flex items-center justify-between py-1.5 px-2 rounded-md transition-colors",
                    isVisible ? "bg-primary/5" : "bg-muted/30"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Switch
                      checked={isVisible}
                      onCheckedChange={(checked) => handleModelToggle(model.id, checked)}
                      className="scale-90"
                    />
                    <span 
                      className={cn(
                        "text-sm truncate",
                        isVisible ? "text-foreground" : "text-muted-foreground"
                      )}
                      title={model.name}
                    >
                      {model.shortName}
                    </span>
                  </div>
                  
                  {!isSolo && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-primary"
                      onClick={() => handleShowOnlyModel(model.id)}
                      title="Visa endast denna modell"
                    >
                      Solo
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
);

ModelVisibilitySelector.displayName = 'ModelVisibilitySelector';

export default ModelVisibilitySelector;
