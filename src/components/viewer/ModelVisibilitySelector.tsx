import React, { useState, useEffect, useCallback, useMemo, useContext, forwardRef } from 'react';
import { Box, ChevronDown, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useModelNames } from '@/hooks/useModelNames';
import { MODEL_LOAD_REQUESTED_EVENT } from '@/lib/viewer-events';
import { AppContext } from '@/context/AppContext';

const isGuid = (str: string): boolean =>
  !!str && str.length >= 20 && /^[0-9a-f]{8}[-]?[0-9a-f]{4}/i.test(str);

export interface ModelInfo {
  id: string;
  name: string;
  shortName: string;
  loaded?: boolean; // Whether the model is currently loaded in xeokit scene
}

interface ModelVisibilitySelectorProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  onVisibleModelsChange?: (visibleModelIds: string[]) => void;
  className?: string;
  /** When true, renders only the toggle list without header/collapsible wrapper */
  listOnly?: boolean;
}

/**
 * Multi-select BIM model visibility selector with switches.
 * Collapsed by default - expands when user clicks to select models.
 * Controls which models are visible in the 3D viewer.
 * Fetches model names from Asset+ API for user-friendly display.
 */
const ModelVisibilitySelector = forwardRef<HTMLDivElement, ModelVisibilitySelectorProps>(
  ({ viewerRef, buildingFmGuid, onVisibleModelsChange, className, listOnly = false }, ref) => {
    const { allData } = useContext(AppContext);
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [visibleModelIds, setVisibleModelIds] = useState<Set<string>>(new Set());
    const [isExpanded, setIsExpanded] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [localStorageLoaded, setLocalStorageLoaded] = useState(false);

    // Use shared hook for model name resolution
    const { modelNamesMap, isLoading: isLoadingNames } = useModelNames(buildingFmGuid);

    // Build source name map from Asset+ data (same logic as ViewerFilterPanel sources)
    // Maps parentBimObjectId → parentCommonName (the BIM model name)
    const assetPlusSources = useMemo(() => {
      const map = new Map<string, string>(); // parentBimObjectId → parentCommonName
      if (!allData || !buildingFmGuid) return map;
      allData
        .filter((a: any) =>
          (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid &&
          (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey')
        )
        .forEach((a: any) => {
          const attrs = a.attributes || {};
          const guid = attrs.parentBimObjectId;
          const name = attrs.parentCommonName;
          if (guid && name && !isGuid(name)) {
            map.set(guid, name);
          }
        });
      return map;
    }, [allData, buildingFmGuid]);

    // Also build storey fmGuid/name → parentCommonName for xeokit matching
    const storeyLookup = useMemo(() => {
      const byGuid = new Map<string, { parentName: string; sourceGuid: string }>();
      const byName = new Map<string, { parentName: string; sourceGuid: string }>();
      if (!allData || !buildingFmGuid) return { byGuid, byName };
      allData
        .filter((a: any) =>
          (a.buildingFmGuid || a.building_fm_guid) === buildingFmGuid &&
          (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey')
        )
        .forEach((a: any) => {
          const attrs = a.attributes || {};
          const fmGuid = (a.fmGuid || a.fm_guid || '').toLowerCase();
          const name = (a.commonName || a.common_name || a.name || '').toLowerCase().trim();
          const parentName = attrs.parentCommonName;
          const sourceGuid = attrs.parentBimObjectId || '';
          if (parentName && !isGuid(parentName)) {
            if (fmGuid) byGuid.set(fmGuid, { parentName, sourceGuid });
            if (fmGuid) byGuid.set(fmGuid.replace(/-/g, ''), { parentName, sourceGuid });
            if (name) byName.set(name, { parentName, sourceGuid });
          }
        });
      return { byGuid, byName };
    }, [allData, buildingFmGuid]);
    
    // Stable refs to preserve selection across re-renders
    const visibleModelIdsRef = React.useRef<Set<string>>(new Set());
    const modelsRef = React.useRef<ModelInfo[]>([]);
    
    // Sync refs with state
    React.useEffect(() => {
      visibleModelIdsRef.current = visibleModelIds;
    }, [visibleModelIds]);
    
    React.useEffect(() => {
      modelsRef.current = models;
    }, [models]);

    // Load saved selection from localStorage
    useEffect(() => {
      if (!buildingFmGuid || localStorageLoaded) return;
      
      const storageKey = `viewer-visible-models-${buildingFmGuid}`;
      const saved = localStorage.getItem(storageKey);
      
      if (saved) {
        try {
          const savedIds = JSON.parse(saved) as string[];
          if (Array.isArray(savedIds) && savedIds.length > 0) {
            console.debug("Restoring saved model selection:", savedIds);
            setVisibleModelIds(new Set(savedIds));
            visibleModelIdsRef.current = new Set(savedIds);
          }
        } catch (e) {
          console.debug("Failed to parse saved model selection:", e);
        }
      }
      setLocalStorageLoaded(true);
    }, [buildingFmGuid, localStorageLoaded]);

    // Save selection to localStorage when it changes
    useEffect(() => {
      if (!buildingFmGuid || !isInitialized || visibleModelIds.size === 0) return;
      
      const storageKey = `viewer-visible-models-${buildingFmGuid}`;
      localStorage.setItem(storageKey, JSON.stringify(Array.from(visibleModelIds)));
    }, [visibleModelIds, buildingFmGuid, isInitialized]);

    // Derive dbModels from the shared modelNamesMap
    const dbModels = useMemo(() => {
      if (modelNamesMap.size === 0) return [];
      // Deduplicate: collect unique names (skip lowercase duplicates)
      const seen = new Set<string>();
      const result: { id: string; name: string; fileName: string }[] = [];
      for (const [key, name] of modelNamesMap.entries()) {
        if (key !== key.toLowerCase()) continue; // skip non-lowercase entries to avoid dupes
        if (seen.has(name)) continue;
        seen.add(name);
        const fileName = key.endsWith('.xkt') ? key : key + '.xkt';
        result.push({ id: key, name, fileName });
      }
      return result;
    }, [modelNamesMap]);

    // Get XEOkit viewer
    const getXeokitViewer = useCallback(() => {
      try {
        return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      } catch (e) {
        return null;
      }
    }, [viewerRef]);

    // Extract models from scene with friendly names from API/database
    // Also include models from database that aren't loaded yet
    const extractModels = useCallback(() => {
      const viewer = getXeokitViewer();
      const sceneModels = viewer?.scene?.models || {};
      const extractedModels: ModelInfo[] = [];
      const processedFileNames = new Set<string>();

      // First, process models actually loaded in the scene
      Object.entries(sceneModels).forEach(([modelId, model]: [string, any]) => {
        // modelId is typically the filename from XKT loader (e.g., "abc123.xkt" or "abc123")
        const rawName = model.id || modelId;
        const fileName = rawName.endsWith('.xkt') ? rawName : rawName + '.xkt';
        const fileNameWithoutExt = fileName.replace(/\.xkt$/i, '');
        
        processedFileNames.add(fileName.toLowerCase());
        processedFileNames.add(fileNameWithoutExt.toLowerCase());
        
        // Try multiple matching strategies - prioritize file_name matching from xkt_models
        let matchedName: string | undefined;
        
        // Strategy 1: Exact file_name match (primary for synced XKT models)
        matchedName = modelNamesMap.get(fileName);
        
        // Strategy 2: File name without extension
        if (!matchedName) matchedName = modelNamesMap.get(fileNameWithoutExt);
        
        // Strategy 3: Case-insensitive file name
        if (!matchedName) matchedName = modelNamesMap.get(fileName.toLowerCase());
        if (!matchedName) matchedName = modelNamesMap.get(fileNameWithoutExt.toLowerCase());
        
        // Strategy 4: Try modelId directly (for API-based names)
        if (!matchedName) matchedName = modelNamesMap.get(modelId);
        if (!matchedName) matchedName = modelNamesMap.get(modelId.toLowerCase());
        
        // Strategy 5: Partial match search
        if (!matchedName && modelNamesMap.size > 0) {
          for (const [key, value] of modelNamesMap.entries()) {
            const keyClean = key.replace(/\.xkt$/i, '').toLowerCase();
            const idClean = fileNameWithoutExt.toLowerCase();
            if (keyClean.includes(idClean) || idClean.includes(keyClean)) {
              matchedName = value;
              break;
            }
          }
        }
        
        // Strategy 6: Match via xeokit metaScene — find IfcBuildingStorey in this model,
        // then look up parentCommonName from Asset+ data (by guid AND name)
        if (!matchedName && (storeyLookup.byGuid.size > 0 || storeyLookup.byName.size > 0)) {
          const viewer = getXeokitViewer();
          const metaObjects = viewer?.metaScene?.metaObjects;
          if (metaObjects && model.objects) {
            const modelObjKeys = Object.keys(model.objects);
            for (let k = 0; k < Math.min(modelObjKeys.length, 500); k++) {
              const mo = metaObjects[modelObjKeys[k]];
              if (mo?.type === 'IfcBuildingStorey') {
                const sysId = (mo.originalSystemId || '').toLowerCase();
                const moName = (mo.name || '').toLowerCase().trim();
                // Try by guid
                const byGuid = storeyLookup.byGuid.get(sysId) || storeyLookup.byGuid.get(sysId.replace(/-/g, ''));
                if (byGuid) matchedName = byGuid.parentName;
                // Try by name
                if (!matchedName) {
                  const byName = storeyLookup.byName.get(moName);
                  if (byName) matchedName = byName.parentName;
                }
                if (matchedName) break;
              }
            }
          }
        }
        
        // Fallback: show "Loading..." if still fetching names, otherwise format nicely
        const friendlyName = matchedName || 
          (isLoadingNames ? 'Loading...' : fileNameWithoutExt.replace(/-/g, ' '));
        const shortName = friendlyName.length > 30 ? friendlyName.substring(0, 30) + '...' : friendlyName;

        extractedModels.push({
          id: modelId,
          name: friendlyName,
          shortName,
          loaded: true,
        });
      });

      // Second, add models from database that aren't loaded yet
      dbModels.forEach(dbModel => {
        const fileNameLower = dbModel.fileName.toLowerCase();
        const fileNameWithoutExt = dbModel.fileName.replace(/\.xkt$/i, '').toLowerCase();
        
        // Check if this model is already in the list (loaded in scene)
        if (processedFileNames.has(fileNameLower) || processedFileNames.has(fileNameWithoutExt)) {
          return;
        }
        
        const name = dbModel.name || dbModel.fileName.replace(/\.xkt$/i, '').replace(/-/g, ' ');
        const shortName = name.length > 30 ? name.substring(0, 27) + '...' : name;
        
        extractedModels.push({
          id: dbModel.fileName || dbModel.id,
          name: name,
          shortName: shortName,
          loaded: false, // Not loaded in scene yet
        });
      });

      // Sort alphabetically
      extractedModels.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

      return extractedModels;
    }, [getXeokitViewer, modelNamesMap, dbModels, isLoadingNames, storeyLookup]);

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

    // Load models once and set visible based on localStorage or default to A-models
    // Wait for model names to be loaded before initializing
    useEffect(() => {
      if (isInitialized || isLoadingNames) return;

      const checkModels = () => {
        const newModels = extractModels();
        if (newModels.length > 0) {
          setModels(newModels);
          
          // Check if localStorage already loaded a selection
          const savedSelection = visibleModelIdsRef.current;
          const validModelIds = new Set(newModels.map(m => m.id));
          const validSavedSelection = new Set(
            Array.from(savedSelection).filter(id => validModelIds.has(id))
          );
          
          let idsToShow: Set<string>;
          
          if (validSavedSelection.size > 0) {
            // Use saved selection
            idsToShow = validSavedSelection;
          } else {
            // Default: Filter to only A-models
            const aModelIds = new Set(
              newModels
                .filter(m => {
                  const nameLower = m.name.toLowerCase();
                  return nameLower.startsWith('a') || nameLower.includes('a-modell') || nameLower.includes('arkitekt');
                })
                .map(m => m.id)
            );
            
            // If no A-models found, show all
            idsToShow = aModelIds.size > 0 ? aModelIds : new Set(newModels.map(m => m.id));
          }
          
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
    // IMPORTANT: Preserve existing selection when updating model list
    useEffect(() => {
      if (!isInitialized || modelNamesMap.size === 0) return;
      
      const updatedModels = extractModels();
      if (updatedModels.length > 0) {
        // Preserve existing selection by matching IDs
        const currentSelection = visibleModelIdsRef.current;
        const updatedIds = new Set(updatedModels.map(m => m.id));
        
        // Keep selections that still exist in updated list
        const preservedSelection = new Set(
          Array.from(currentSelection).filter(id => updatedIds.has(id))
        );
        
        // If selections were preserved, update state with them
        if (preservedSelection.size > 0 && preservedSelection.size !== currentSelection.size) {
          setVisibleModelIds(preservedSelection);
          applyModelVisibility(preservedSelection);
        }
        
        setModels(updatedModels);
      }
    }, [modelNamesMap, isInitialized, extractModels, applyModelVisibility]);

    const handleModelToggle = useCallback((modelId: string, checked: boolean) => {
      // If toggling ON a non-loaded model, request it to be loaded
      if (checked) {
        const model = modelsRef.current.find(m => m.id === modelId);
        if (model && !model.loaded) {
          window.dispatchEvent(new CustomEvent(MODEL_LOAD_REQUESTED_EVENT, {
            detail: { modelId }
          }));
        }
      }

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

    // Don't render if no models found
    if (models.length === 0) {
      return null;
    }

    // listOnly mode: render just the toggle list without header/collapsible
    if (listOnly) {
      return (
        <div className={cn("space-y-0.5 sm:space-y-1", className)} ref={ref}>
          <div className="space-y-0.5 sm:space-y-1 max-h-[40vh] overflow-y-auto pr-0.5 sm:pr-1">
            {models.map((model) => {
              const isVisible = visibleModelIds.has(model.id);
              const isSolo = visibleModelIds.size === 1 && isVisible;
              
              return (
                <div
                  key={model.id}
                  className={cn(
                    "flex items-center justify-between py-1 sm:py-1.5 px-1.5 sm:px-2 rounded-md transition-colors gap-1",
                    isVisible ? "bg-primary/10" : "bg-muted/20"
                  )}
                >
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                    <Switch
                      checked={isVisible}
                      onCheckedChange={(checked) => handleModelToggle(model.id, checked)}
                      className="scale-75 sm:scale-90"
                    />
                    <span 
                      className={cn(
                        "text-xs sm:text-sm truncate",
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
                      className="h-4 sm:h-5 px-1 sm:px-1.5 text-[9px] sm:text-[10px] text-muted-foreground hover:text-primary flex-shrink-0"
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
          
          {/* Show All button at bottom */}
          <div className="pt-1 border-t border-border/30">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-6 text-[10px] sm:text-xs"
              onClick={handleShowAll}
              disabled={allVisible}
            >
              Visa alla modeller
            </Button>
          </div>
        </div>
      );
    }

    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className={cn("space-y-1.5 sm:space-y-2", className)}>
        <div className="flex items-center justify-between gap-1" ref={ref}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 hover:bg-transparent justify-start gap-1 sm:gap-1.5 min-w-0 flex-1"
            >
              <Box className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground flex-shrink-0" />
              <Label className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider cursor-pointer truncate">
                BIM-modeller
              </Label>
              <span className="text-[10px] sm:text-xs text-muted-foreground flex-shrink-0">
                ({visibleCount}/{totalCount})
              </span>
              <ChevronDown className={cn(
                "h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground transition-transform flex-shrink-0",
                isExpanded && "rotate-180"
              )} />
            </Button>
          </CollapsibleTrigger>
          
          <Button
            variant="ghost"
            size="sm"
            className="h-5 sm:h-6 px-1.5 sm:px-2 text-[10px] sm:text-xs flex-shrink-0"
            onClick={handleShowAll}
            disabled={allVisible}
          >
            Alla
          </Button>
        </div>

        <CollapsibleContent className="space-y-0.5 sm:space-y-1">
          <div className="space-y-0.5 sm:space-y-1 max-h-[200px] sm:max-h-[300px] overflow-y-auto pr-0.5 sm:pr-1">
            {models.map((model) => {
              const isVisible = visibleModelIds.has(model.id);
              const isSolo = visibleModelIds.size === 1 && isVisible;
              
              return (
                <div
                  key={model.id}
                  className={cn(
                    "flex items-center justify-between py-1 sm:py-1.5 px-1.5 sm:px-2 rounded-md transition-colors gap-1",
                    isVisible ? "bg-primary/5" : "bg-muted/30"
                  )}
                >
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                    <Switch
                      checked={isVisible}
                      onCheckedChange={(checked) => handleModelToggle(model.id, checked)}
                      className="scale-75 sm:scale-90"
                    />
                    <span 
                      className={cn(
                        "text-xs sm:text-sm truncate",
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
                      className="h-4 sm:h-5 px-1 sm:px-1.5 text-[9px] sm:text-[10px] text-muted-foreground hover:text-primary flex-shrink-0"
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
