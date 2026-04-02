import React, { useState, useEffect, useCallback, useMemo, forwardRef } from 'react';
import { Box, ChevronDown, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { emit } from '@/lib/event-bus';
import { useModelData, ModelInfo } from '@/hooks/useModelData';

// Re-export ModelInfo so existing imports keep working
export type { ModelInfo } from '@/hooks/useModelData';

interface ModelVisibilitySelectorProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  onVisibleModelsChange?: (visibleModelIds: string[]) => void;
  className?: string;
  listOnly?: boolean;
}

const ModelVisibilitySelector = forwardRef<HTMLDivElement, ModelVisibilitySelectorProps>(
  ({ viewerRef, buildingFmGuid, onVisibleModelsChange, className, listOnly = false }, ref) => {
    // ── Shared model data hook ────────────────────────────────────────────
    const { models, isLoading: isLoadingNames, applyModelVisibility } = useModelData(viewerRef, buildingFmGuid);

    const [visibleModelIds, setVisibleModelIds] = useState<Set<string>>(new Set());
    const [isExpanded, setIsExpanded] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [localStorageLoaded, setLocalStorageLoaded] = useState(false);

    const visibleModelIdsRef = React.useRef<Set<string>>(new Set());
    const modelsRef = React.useRef<ModelInfo[]>([]);

    React.useEffect(() => { visibleModelIdsRef.current = visibleModelIds; }, [visibleModelIds]);
    React.useEffect(() => { modelsRef.current = models; }, [models]);

    // Load from localStorage
    useEffect(() => {
      if (!buildingFmGuid || localStorageLoaded) return;
      const storageKey = `viewer-visible-models-${buildingFmGuid}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const savedIds = JSON.parse(saved) as string[];
          if (Array.isArray(savedIds) && savedIds.length > 0) {
            setVisibleModelIds(new Set(savedIds));
            visibleModelIdsRef.current = new Set(savedIds);
          }
        } catch { /* ignore */ }
      }
      setLocalStorageLoaded(true);
    }, [buildingFmGuid, localStorageLoaded]);

    // Save to localStorage
    useEffect(() => {
      if (!buildingFmGuid || !isInitialized || visibleModelIds.size === 0) return;
      const storageKey = `viewer-visible-models-${buildingFmGuid}`;
      localStorage.setItem(storageKey, JSON.stringify(Array.from(visibleModelIds)));
    }, [visibleModelIds, buildingFmGuid, isInitialized]);

    // Initialize selection when models arrive
    useEffect(() => {
      if (isInitialized || models.length === 0 || isLoadingNames) return;

      const validModelIds = new Set(models.map(m => m.id));
      const savedSelection = visibleModelIdsRef.current;
      const validSaved = new Set(Array.from(savedSelection).filter(id => validModelIds.has(id)));

      let idsToShow: Set<string>;

      if (validSaved.size > 0) {
        idsToShow = validSaved;
      } else {
        // Default: A-models only
        const aModelIds = new Set(
          models
            .filter(m => {
              const n = m.name.toLowerCase();
              return n.startsWith('a') || n.includes('a-modell') || n.includes('arkitekt');
            })
            .map(m => m.id)
        );
        idsToShow = aModelIds.size > 0 ? aModelIds : new Set(models.map(m => m.id));
      }

      setVisibleModelIds(idsToShow);
      applyModelVisibility(idsToShow);
      setIsInitialized(true);
    }, [models, isInitialized, applyModelVisibility, isLoadingNames]);


    // Broadcast model visibility changes so floor/filter hooks can react immediately
    useEffect(() => {
      if (!isInitialized) return;
      emit('MODEL_VISIBILITY_CHANGED', {
        buildingFmGuid,
        visibleModelIds: Array.from(visibleModelIds),
      });
    }, [visibleModelIds, isInitialized, buildingFmGuid]);

    const handleModelToggle = useCallback((modelId: string, checked: boolean) => {
      if (checked) {
        const model = modelsRef.current.find(m => m.id === modelId);
        if (model && !model.loaded) {
          window.dispatchEvent(new CustomEvent(MODEL_LOAD_REQUESTED_EVENT, { detail: { modelId } }));
        }
      }

      setVisibleModelIds(prev => {
        const newSet = new Set(prev);
        checked ? newSet.add(modelId) : newSet.delete(modelId);
        applyModelVisibility(newSet);
        onVisibleModelsChange?.(Array.from(newSet));
        return newSet;
      });
    }, [applyModelVisibility, onVisibleModelsChange]);

    const handleShowOnlyModel = useCallback((modelId: string) => {
      const newSet = new Set([modelId]);
      setVisibleModelIds(newSet);
      applyModelVisibility(newSet);
      onVisibleModelsChange?.([modelId]);
    }, [applyModelVisibility, onVisibleModelsChange]);

    const handleShowAll = useCallback(() => {
      const allIds = new Set(models.map(m => m.id));
      setVisibleModelIds(allIds);
      applyModelVisibility(allIds);
      onVisibleModelsChange?.(models.map(m => m.id));
    }, [applyModelVisibility, models, onVisibleModelsChange]);

    const allVisible = useMemo(() => models.length > 0 && visibleModelIds.size === models.length, [models, visibleModelIds]);
    const visibleCount = visibleModelIds.size;
    const totalCount = models.length;

    if (models.length === 0) return null;

    // ── Render ────────────────────────────────────────────────────────────
    const renderModelRow = (model: ModelInfo) => {
      const isVisible = visibleModelIds.has(model.id);
      const isSolo = visibleModelIds.size === 1 && isVisible;
      return (
        <div key={model.id} className={cn("flex items-center justify-between py-1 sm:py-1.5 px-1.5 sm:px-2 rounded-md transition-colors gap-1", isVisible ? (listOnly ? "bg-primary/10" : "bg-primary/5") : (listOnly ? "bg-muted/20" : "bg-muted/30"))}>
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
            <Switch checked={isVisible} onCheckedChange={(checked) => handleModelToggle(model.id, checked)} className="scale-75 sm:scale-90" />
            <span className={cn("text-xs sm:text-sm truncate", isVisible ? "text-foreground" : "text-muted-foreground")} title={model.name}>{model.shortName}</span>
          </div>
          {!isSolo && (
            <Button variant="ghost" size="sm" className="h-4 sm:h-5 px-1 sm:px-1.5 text-[9px] sm:text-[10px] text-muted-foreground hover:text-primary flex-shrink-0" onClick={() => handleShowOnlyModel(model.id)} title="Visa endast denna modell">Solo</Button>
          )}
        </div>
      );
    };

    if (listOnly) {
      return (
        <div className={cn("space-y-0.5 sm:space-y-1", className)} ref={ref}>
          <div className="space-y-0.5 sm:space-y-1 max-h-[40vh] overflow-y-auto pr-0.5 sm:pr-1">
            {models.map(renderModelRow)}
          </div>
          <div className="pt-1 border-t border-border/30">
            <Button variant="ghost" size="sm" className="w-full h-6 text-[10px] sm:text-xs" onClick={handleShowAll} disabled={allVisible}>Visa alla modeller</Button>
          </div>
        </div>
      );
    }

    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className={cn("space-y-1.5 sm:space-y-2", className)}>
        <div className="flex items-center justify-between gap-1" ref={ref}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-auto p-0 hover:bg-transparent justify-start gap-1 sm:gap-1.5 min-w-0 flex-1">
              <Box className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground flex-shrink-0" />
              <Label className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider cursor-pointer truncate">BIM-modeller</Label>
              <span className="text-[10px] sm:text-xs text-muted-foreground flex-shrink-0">({visibleCount}/{totalCount})</span>
              <ChevronDown className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <Button variant="ghost" size="sm" className="h-5 sm:h-6 px-1.5 sm:px-2 text-[10px] sm:text-xs flex-shrink-0" onClick={handleShowAll} disabled={allVisible}>Alla</Button>
        </div>
        <CollapsibleContent className="space-y-0.5 sm:space-y-1">
          <div className="space-y-0.5 sm:space-y-1 max-h-[200px] sm:max-h-[300px] overflow-y-auto pr-0.5 sm:pr-1">
            {models.map(renderModelRow)}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
);

ModelVisibilitySelector.displayName = 'ModelVisibilitySelector';

export default ModelVisibilitySelector;
