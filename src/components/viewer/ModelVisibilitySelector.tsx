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
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [visibleModelIds, setVisibleModelIds] = useState<Set<string>>(new Set());
    const [isExpanded, setIsExpanded] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [modelNamesMap, setModelNamesMap] = useState<Map<string, string>>(new Map());
    const [isLoadingNames, setIsLoadingNames] = useState(false);
    const [localStorageLoaded, setLocalStorageLoaded] = useState(false);
    const [dbModels, setDbModels] = useState<{id: string; name: string; fileName: string}[]>([]);
    
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

  // Helper to extract model ID from xktFileUrl
  const extractModelIdFromUrl = (xktFileUrl: string): string => {
    const fileName = xktFileUrl.split('/').pop() || '';
    return fileName.replace('.xkt', '');
  };

  // Fetch model names and list from database - all models for this building
  useEffect(() => {
    if (!buildingFmGuid) return;

    const fetchModelNames = async () => {
      setIsLoadingNames(true);
      try {
        // First, try to get model names from local database (xkt_models table)
        const { data: dbModelData, error: dbError } = await supabase
          .from('xkt_models')
          .select('model_id, model_name, file_name')
          .eq('building_fm_guid', buildingFmGuid);

        if (!dbError && dbModelData && dbModelData.length > 0) {
          console.debug("Using model names from database:", dbModelData);
          const nameMap = new Map<string, string>();
          
          // Store DB models list for combining with scene models
          setDbModels(dbModelData.map(m => ({
            id: m.model_id || m.file_name || '',
            name: m.model_name || m.file_name || m.model_id || '',
            fileName: m.file_name || ''
          })));
          
          dbModelData.forEach((m) => {
            // Primary: Map file_name -> model_name (most reliable for XEOkit matching)
            if (m.file_name && m.model_name) {
              nameMap.set(m.file_name, m.model_name);
              nameMap.set(m.file_name.toLowerCase(), m.model_name);
              
              // Also without extension
              const fileId = m.file_name.replace(/\.xkt$/i, '');
              nameMap.set(fileId, m.model_name);
              nameMap.set(fileId.toLowerCase(), m.model_name);
            }
            // Secondary: Map model_id -> model_name
            if (m.model_id && m.model_name) {
              nameMap.set(m.model_id, m.model_name);
              nameMap.set(m.model_id.toLowerCase(), m.model_name);
            }
          });
          
          setModelNamesMap(nameMap);
          setIsLoadingNames(false);
          return;
        } else {
          // Clear dbModels if nothing found
          setDbModels([]);
        }

        // Fall back to Asset+ API if database has no data
        console.debug("No models in database, falling back to Asset+ API");
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

          // Populate dbModels from API so all models appear in the list
          setDbModels(apiModels.map((m: any) => ({
            id: m.id || '',
            name: m.name || '',
            fileName: m.xktFileUrl
              ? extractModelIdFromUrl(m.xktFileUrl) + '.xkt'
              : (m.id || '')
          })));
          
          apiModels.forEach((m: any) => {
            // Primary: map model.id to name
            if (m.id && m.name) {
              nameMap.set(m.id, m.name);
              nameMap.set(m.id.toLowerCase(), m.name);
            }
            // Secondary: extract filename from xktFileUrl and map to name
            if (m.xktFileUrl && m.name) {
              const fileId = extractModelIdFromUrl(m.xktFileUrl);
              nameMap.set(fileId, m.name);
              nameMap.set(fileId.toLowerCase(), m.name);
              nameMap.set(fileId + '.xkt', m.name);
              nameMap.set(fileId.toLowerCase() + '.xkt', m.name);
            }
          });
          
          console.debug("Model names map:", Object.fromEntries(nameMap));
          setModelNamesMap(nameMap);
          
          // Persist API model names to xkt_models table for future loads
          try {
            for (const m of apiModels) {
              if (!m.name) continue;
              const fileName = m.xktFileUrl
                ? extractModelIdFromUrl(m.xktFileUrl) + '.xkt'
                : (m.id || '');
              if (!fileName) continue;
              
              await supabase.from('xkt_models').upsert({
                building_fm_guid: buildingFmGuid,
                model_id: m.id || fileName,
                model_name: m.name,
                file_name: fileName,
                storage_path: m.xktFileUrl || '',
                source_url: m.xktFileUrl || null,
              }, { onConflict: 'model_id' }).then(({ error }) => {
                if (error) console.debug("Failed to cache model name:", m.name, error.message);
              });
            }
            console.debug("Model names persisted to database");
          } catch (persistErr) {
            console.debug("Failed to persist model names:", persistErr);
          }
        } else {
          console.debug("Asset+ GetModels failed:", response.status);
        }
      } catch (e) {
        console.debug("Failed to fetch model names:", e);
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
        
        // Strategy 5: Partial match search for complex URLs
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
        
        // Strategy 6: Extract name from metaScene IfcProject root
        // Each loaded model has a root IfcProject meta-object with a human-readable name
        if (!matchedName && viewer?.metaScene) {
          try {
            const metaModel = viewer.metaScene.metaModels?.[modelId];
            if (metaModel?.rootMetaObject) {
              const rootObj = metaModel.rootMetaObject;
              if (rootObj.type === 'IfcProject' && rootObj.name && !rootObj.name.match(/^[0-9A-Fa-f-]{30,}$/)) {
                matchedName = rootObj.name;
                console.debug("Strategy 6 (metaScene IfcProject) matched:", modelId, "->", matchedName);
              }
            }
            // Fallback: search all metaObjects for IfcProject belonging to this model
            if (!matchedName) {
              const metaObjects = viewer.metaScene.metaObjects || {};
              for (const metaObj of Object.values(metaObjects) as any[]) {
                if (metaObj.type === 'IfcProject' && metaObj.metaModel?.id === modelId) {
                  if (metaObj.name && !metaObj.name.match(/^[0-9A-Fa-f-]{30,}$/)) {
                    matchedName = metaObj.name;
                    console.debug("Strategy 6b (metaObjects search) matched:", modelId, "->", matchedName);
                  }
                  break;
                }
              }
            }
          } catch (e) {
            console.debug("Strategy 6 failed for model:", modelId, e);
          }
        }
        
        // Improved fallback: show "Laddar..." if still fetching names, otherwise format nicely
        const friendlyName = matchedName || 
          (isLoadingNames ? 'Laddar...' : fileNameWithoutExt.replace(/-/g, ' '));
        const shortName = friendlyName.length > 30 ? friendlyName.substring(0, 30) + '...' : friendlyName;

        if (!matchedName && modelNamesMap.size > 0) {
          console.debug("No name match for model:", modelId, "tried:", fileName, fileNameWithoutExt);
        }

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
    }, [getXeokitViewer, modelNamesMap, dbModels, isLoadingNames]);

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
