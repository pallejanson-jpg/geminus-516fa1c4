import React, { useState, useEffect, useCallback, useMemo, forwardRef, useRef } from 'react';
import { Layers, ChevronDown, Scissors } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { FLOOR_SELECTION_CHANGED_EVENT } from '@/lib/viewer-events';
import type { FloorSelectionEventDetail } from '@/lib/event-bus';
import { useFloorData, FloorInfo } from '@/hooks/useFloorData';
import { useFloorVisibility } from '@/hooks/useFloorVisibility';

// Re-export FloorInfo so existing imports keep working
export type { FloorInfo } from '@/hooks/useFloorData';

interface FloorVisibilitySelectorProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  isViewerReady?: boolean;
  onVisibleFloorsChange?: (visibleFloorIds: string[]) => void;
  enableClipping?: boolean;
  className?: string;
  listOnly?: boolean;
  initialFloorFmGuid?: string;
}

const FloorVisibilitySelector = forwardRef<HTMLDivElement, FloorVisibilitySelectorProps>(
  ({ viewerRef, buildingFmGuid, isViewerReady = true, onVisibleFloorsChange, enableClipping = true, className, listOnly = false, initialFloorFmGuid }, ref) => {
    const { floors, isLoading: floorsLoading } = useFloorData(viewerRef, buildingFmGuid);
    const { applyFloorVisibility, calculateFloorBounds } = useFloorVisibility(viewerRef);

    const [visibleFloorIds, setVisibleFloorIds] = useState<Set<string>>(new Set());
    const [isExpanded, setIsExpanded] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [clippingEnabled, setClippingEnabled] = useState(false);
    const [localStorageLoaded, setLocalStorageLoaded] = useState(false);
    
    const initialVisibilityAppliedRef = useRef(false);
    const isReceivingExternalEvent = useRef(false);
    const visibleFloorIdsRef = React.useRef<Set<string>>(new Set());
    const floorsRef = React.useRef<FloorInfo[]>([]);
    
    React.useEffect(() => { visibleFloorIdsRef.current = visibleFloorIds; }, [visibleFloorIds]);
    React.useEffect(() => { floorsRef.current = floors; }, [floors]);

    // Restore from localStorage
    useEffect(() => {
      if (!buildingFmGuid || localStorageLoaded) return;
      if (!initialFloorFmGuid) {
        const storageKey = `viewer-visible-floors-${buildingFmGuid}`;
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {
            const ids = JSON.parse(saved);
            if (Array.isArray(ids) && ids.length > 0) {
              setVisibleFloorIds(new Set(ids));
            }
          } catch { /* ignore */ }
        }
      }
      setLocalStorageLoaded(true);
    }, [buildingFmGuid, localStorageLoaded, initialFloorFmGuid]);

    // Save to localStorage
    useEffect(() => {
      if (!buildingFmGuid || !isInitialized || visibleFloorIds.size === 0) return;
      const storageKey = `viewer-visible-floors-${buildingFmGuid}`;
      localStorage.setItem(storageKey, JSON.stringify(Array.from(visibleFloorIds)));
    }, [visibleFloorIds, buildingFmGuid, isInitialized]);

    const isClippingActive = false; // Clipping state managed by ViewerToolbar

    // ── Initialize selection when floors arrive ───────────────────────────
    useEffect(() => {
      if (isInitialized || !localStorageLoaded || floors.length === 0) return;

      const validFloorIds = new Set(floors.map(f => f.id));

      // Priority 1: initialFloorFmGuid
      if (initialFloorFmGuid) {
        const match = floors.find(f =>
          f.databaseLevelFmGuids.some(g => g.toLowerCase() === initialFloorFmGuid.toLowerCase()) ||
          f.id.toLowerCase() === initialFloorFmGuid.toLowerCase()
        );
        if (match) {
          setVisibleFloorIds(new Set([match.id]));
          setIsInitialized(true);
          return;
        }
      }

      // Priority 2: localStorage
      const savedSelection = visibleFloorIdsRef.current;
      const validSaved = new Set(Array.from(savedSelection).filter(id => validFloorIds.has(id)));

      if (validSaved.size > 0) {
        setVisibleFloorIds(validSaved);
      } else {
        setVisibleFloorIds(validFloorIds);
      }
      setIsInitialized(true);
    }, [floors, isInitialized, localStorageLoaded, initialFloorFmGuid]);

    // Apply visibility using shared utility
    const applyVisibility = useCallback((visibleIds: Set<string>) => {
      applyFloorVisibility(floors, visibleIds);
      window.dispatchEvent(new CustomEvent('FLOOR_VISIBILITY_APPLIED'));
    }, [applyFloorVisibility, floors]);

    // Listen for external floor selection
    useEffect(() => {
      const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
        if (isReceivingExternalEvent.current) return;
        const { visibleMetaFloorIds, isAllFloorsVisible } = e.detail;
        isReceivingExternalEvent.current = true;

        if (isAllFloorsVisible) {
          const allIds = new Set(floorsRef.current.map(f => f.id));
          setVisibleFloorIds(allIds);
          applyVisibility(allIds);
          setClippingEnabled(false);
        } else if (visibleMetaFloorIds && visibleMetaFloorIds.length > 0) {
          const matchingIds = new Set(
            floorsRef.current
              .filter(f => visibleMetaFloorIds.some(metaId => f.id === metaId || f.metaObjectIds.includes(metaId)))
              .map(f => f.id)
          );
          if (matchingIds.size > 0) {
            setVisibleFloorIds(matchingIds);
            applyVisibility(matchingIds);
            if (matchingIds.size === 1) setClippingEnabled(true);
          }
        } else if (e.detail.visibleFloorFmGuids?.length > 0) {
          const fmMatchIds = new Set(
            floorsRef.current
              .filter(f => f.databaseLevelFmGuids.some(g =>
                e.detail.visibleFloorFmGuids!.some((vg: string) => vg.toLowerCase() === g.toLowerCase())
              ))
              .map(f => f.id)
          );
          if (fmMatchIds.size > 0) {
            setVisibleFloorIds(fmMatchIds);
            applyVisibility(fmMatchIds);
            if (fmMatchIds.size === 1) setClippingEnabled(true);
          }
        }

        setTimeout(() => { isReceivingExternalEvent.current = false; }, 100);
      };
      window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
      return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    }, [applyVisibility]);

    // Apply initial visibility
    useEffect(() => {
      if (!isInitialized || floors.length === 0 || visibleFloorIds.size === 0) return;
      if (initialVisibilityAppliedRef.current) return;
      initialVisibilityAppliedRef.current = true;

      const timeoutId = setTimeout(() => {
        applyVisibility(visibleFloorIds);

        const visibleFloors = floors.filter(f => visibleFloorIds.has(f.id));
        const allFmGuids = visibleFloors.flatMap(f => f.databaseLevelFmGuids);
        const allMetaIds = visibleFloors.flatMap(f => f.metaObjectIds);
        const isAllVisible = visibleFloorIds.size === floors.length;
        const isSolo = visibleFloorIds.size === 1;
        const soloFloorId = isSolo ? Array.from(visibleFloorIds)[0] : null;
        const soloFloor = soloFloorId ? floors.find(f => f.id === soloFloorId) : null;
        const bounds = soloFloorId ? calculateFloorBounds(soloFloorId) : null;

        if (isSolo) setClippingEnabled(true);

        isReceivingExternalEvent.current = true;
        window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
          detail: {
            floorId: soloFloorId,
            floorName: soloFloor?.name || null,
            bounds: bounds ? { minY: bounds.minY, maxY: bounds.maxY } : null,
            visibleMetaFloorIds: allMetaIds,
            visibleFloorFmGuids: allFmGuids,
            isAllFloorsVisible: isAllVisible,
          } as FloorSelectionEventDetail,
        }));
        setTimeout(() => { isReceivingExternalEvent.current = false; }, 100);
      }, 100);

      return () => clearTimeout(timeoutId);
    }, [isInitialized, floors, visibleFloorIds, applyVisibility, calculateFloorBounds]);

    // ── Handlers ──────────────────────────────────────────────────────────
    const emitFloorEvent = useCallback((newSet: Set<string>) => {
      const visibleFloors = floors.filter(f => newSet.has(f.id));
      const allFmGuids = visibleFloors.flatMap(f => f.databaseLevelFmGuids);
      const allMetaIds = visibleFloors.flatMap(f => f.metaObjectIds);
      const isAllVisible = newSet.size === floors.length;
      const isSolo = newSet.size === 1;
      const soloFloorId = isSolo ? Array.from(newSet)[0] : null;
      const soloFloor = soloFloorId ? floors.find(f => f.id === soloFloorId) : null;
      const bounds = soloFloorId ? calculateFloorBounds(soloFloorId) : null;

      if (isSolo) setClippingEnabled(true);

      isReceivingExternalEvent.current = true;
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
        detail: {
          floorId: soloFloorId,
          floorName: soloFloor?.name || null,
          bounds: bounds ? { minY: bounds.minY, maxY: bounds.maxY } : null,
          visibleMetaFloorIds: allMetaIds,
          visibleFloorFmGuids: allFmGuids,
          isAllFloorsVisible: isAllVisible,
        } as FloorSelectionEventDetail,
      }));
      setTimeout(() => { isReceivingExternalEvent.current = false; }, 100);

      if (onVisibleFloorsChange) onVisibleFloorsChange(allFmGuids);
    }, [floors, calculateFloorBounds, onVisibleFloorsChange]);

    const handleFloorToggle = useCallback((floorId: string, checked: boolean) => {
      setVisibleFloorIds(prev => {
        const newSet = new Set(prev);
        checked ? newSet.add(floorId) : newSet.delete(floorId);
        applyVisibility(newSet);
        emitFloorEvent(newSet);
        return newSet;
      });
    }, [applyVisibility, emitFloorEvent]);

    const handleShowOnlyFloor = useCallback((floorId: string) => {
      const newSet = new Set([floorId]);
      setVisibleFloorIds(newSet);
      applyVisibility(newSet);
      setClippingEnabled(true);
      emitFloorEvent(newSet);
    }, [applyVisibility, emitFloorEvent]);

    const handleShowAll = useCallback(() => {
      const allIds = new Set(floors.map(f => f.id));
      setVisibleFloorIds(allIds);
      applyVisibility(allIds);
      emitFloorEvent(allIds);
    }, [applyVisibility, floors, emitFloorEvent]);

    const allVisible = useMemo(() => floors.length > 0 && visibleFloorIds.size === floors.length, [floors, visibleFloorIds]);
    const visibleCount = visibleFloorIds.size;
    const totalCount = floors.length;

    if (!isViewerReady || floorsLoading) {
      return (
        <div className={cn("space-y-2", className)} ref={ref}>
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Floors</Label>
            <span className="text-xs text-muted-foreground/70 ml-1 italic">(Loading…)</span>
          </div>
        </div>
      );
    }

    if (floors.length === 0) return null;

    // listOnly mode
    if (listOnly) {
      const soloFloorId = visibleFloorIds.size === 1 ? Array.from(visibleFloorIds)[0] : null;
      const currentMode: 'all' | 'solo' | 'multi' = allVisible ? 'all' : soloFloorId ? 'solo' : 'multi';

      const handleModeChange = (mode: 'all' | 'solo' | 'multi') => {
        if (mode === 'all') handleShowAll();
        else if (mode === 'solo' && floors.length > 0) handleShowOnlyFloor(floors[0].id);
      };

      return (
        <div className={cn("space-y-2", className)} ref={ref}>
          <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
            {(['all', 'solo', 'multi'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                className={cn(
                  "flex-1 text-[11px] font-medium py-1 px-1.5 rounded-md transition-all",
                  currentMode === mode
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                {mode === 'all' ? 'Alla' : mode === 'solo' ? 'Solo' : 'Multi'}
              </button>
            ))}
          </div>

          {currentMode !== 'all' && (
            <div className="space-y-0.5 max-h-[40vh] overflow-y-auto pr-0.5">
              {floors.map((floor) => {
                const isVisible = visibleFloorIds.has(floor.id);
                const isActiveSolo = currentMode === 'solo' && soloFloorId === floor.id;

                if (currentMode === 'solo') {
                  return (
                    <button
                      key={floor.id}
                      onClick={() => handleShowOnlyFloor(floor.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all border",
                        isActiveSolo
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      {floor.name}
                    </button>
                  );
                }

                return (
                  <div
                    key={floor.id}
                    className={cn(
                      "flex items-center justify-between py-1.5 px-2 rounded-md transition-colors",
                      isVisible ? "bg-primary/10" : "bg-muted/20"
                    )}
                  >
                    <span className={cn("text-xs sm:text-sm truncate flex-1", isVisible ? "text-foreground" : "text-muted-foreground")}>
                      {floor.name}
                    </span>
                    <Switch checked={isVisible} onCheckedChange={(checked) => handleFloorToggle(floor.id, checked)} className="scale-75" />
                  </div>
                );
              })}
            </div>
          )}

          {currentMode === 'multi' && !allVisible && (
            <div className="pt-1 border-t border-border/30">
              <Button variant="ghost" size="sm" className="w-full h-6 text-[10px] sm:text-xs" onClick={handleShowAll}>
                Show all floors
              </Button>
            </div>
          )}
        </div>
      );
    }

    return (
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className={cn("space-y-1.5 sm:space-y-2", className)}>
        <div className="flex items-center justify-between gap-1" ref={ref}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-auto p-0 hover:bg-transparent justify-start gap-1 sm:gap-1.5 min-w-0 flex-1">
              <Layers className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground flex-shrink-0" />
              <Label className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider cursor-pointer truncate">Floors</Label>
              <span className="text-[10px] sm:text-xs text-muted-foreground flex-shrink-0">({visibleCount}/{totalCount})</span>
              <ChevronDown className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
            {enableClipping && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={clippingEnabled ? "secondary" : "ghost"}
                    size="sm"
                    className={cn("h-5 w-5 sm:h-6 sm:w-auto px-1 sm:px-1.5", clippingEnabled && "text-primary", isClippingActive && "ring-1 ring-primary")}
                    onClick={() => setClippingEnabled(!clippingEnabled)}
                  >
                    <Scissors className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">{clippingEnabled ? 'Klippning aktiverad' : 'Aktivera klippning'}</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Button variant="ghost" size="sm" className="h-5 sm:h-6 px-1.5 sm:px-2 text-[10px] sm:text-xs" onClick={handleShowAll} disabled={allVisible}>Alla</Button>
          </div>
        </div>

        <CollapsibleContent className="space-y-0.5 sm:space-y-1">
          <div className="space-y-0.5 sm:space-y-1 max-h-[200px] sm:max-h-[300px] overflow-y-auto pr-0.5 sm:pr-1">
            {floors.map((floor) => {
              const isVisible = visibleFloorIds.has(floor.id);
              const isSolo = visibleFloorIds.size === 1 && isVisible;
              return (
                <div key={floor.id} className={cn("flex items-center justify-between py-1 sm:py-1.5 px-1.5 sm:px-2 rounded-md transition-colors gap-1", isVisible ? "bg-primary/5" : "bg-muted/30")}>
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                    <Switch checked={isVisible} onCheckedChange={(checked) => handleFloorToggle(floor.id, checked)} className="scale-75 sm:scale-90" />
                    <span className={cn("text-xs sm:text-sm truncate", isVisible ? "text-foreground" : "text-muted-foreground")}>{floor.name}</span>
                  </div>
                  {!isSolo && (
                    <Button variant="ghost" size="sm" className="h-4 sm:h-5 px-1 sm:px-1.5 text-[9px] sm:text-[10px] text-muted-foreground hover:text-primary flex-shrink-0" onClick={() => handleShowOnlyFloor(floor.id)} title="Show only this floor">Solo</Button>
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

FloorVisibilitySelector.displayName = 'FloorVisibilitySelector';

export default FloorVisibilitySelector;
