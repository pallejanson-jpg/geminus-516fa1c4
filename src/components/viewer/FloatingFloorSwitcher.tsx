import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFloorData, FloorInfo } from '@/hooks/useFloorData';
import { useFloorVisibility } from '@/hooks/useFloorVisibility';

// Re-export for backward compat
export type FloorPillInfo = FloorInfo;

interface FloatingFloorSwitcherProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  isViewerReady?: boolean;
  className?: string;
  compact?: boolean;
}

export const FLOOR_PILLS_TOGGLE_EVENT = 'FLOOR_PILLS_TOGGLE';

const MAX_VISIBLE_PILLS_DESKTOP = 12;
const MAX_VISIBLE_PILLS_MOBILE = 3;

const FloatingFloorSwitcher: React.FC<FloatingFloorSwitcherProps> = memo(({
  viewerRef,
  buildingFmGuid,
  isViewerReady = true,
  className,
  compact = false,
}) => {
  const isMobile = useIsMobile();
  const { floors } = useFloorData(viewerRef, buildingFmGuid);
  const { applyFloorVisibility, calculateFloorBounds } = useFloorVisibility(viewerRef);

  const [visibleFloorIds, setVisibleFloorIds] = useState<Set<string>>(new Set());
  const [isInitialized, setIsInitialized] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const isReceivingExternalEvent = useRef(false);

  // Listen for visibility toggle
  useEffect(() => {
    const handleToggle = (e: CustomEvent<{ visible: boolean }>) => {
      setIsVisible(e.detail.visible);
      localStorage.setItem('viewer-show-floor-pills', String(e.detail.visible));
    };
    window.addEventListener(FLOOR_PILLS_TOGGLE_EVENT, handleToggle as EventListener);
    return () => window.removeEventListener(FLOOR_PILLS_TOGGLE_EVENT, handleToggle as EventListener);
  }, []);

  // Initialize once floors arrive
  useEffect(() => {
    if (isInitialized || floors.length === 0 || !isViewerReady) return;

    const storageKey = `viewer-visible-floors-${buildingFmGuid}`;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const savedIds = JSON.parse(saved) as string[];
        const validIds = new Set(savedIds.filter(id => floors.some(f => f.id === id)));
        setVisibleFloorIds(validIds.size > 0 ? validIds : new Set(floors.map(f => f.id)));
      } catch {
        setVisibleFloorIds(new Set(floors.map(f => f.id)));
      }
    } else {
      setVisibleFloorIds(new Set(floors.map(f => f.id)));
    }
    setIsInitialized(true);
  }, [floors, isInitialized, isViewerReady, buildingFmGuid]);

  // Listen for external floor selection
  useEffect(() => {
    const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
      const { visibleMetaFloorIds, isAllFloorsVisible } = e.detail;
      const fromFilterPanel = !!(e.detail as any).fromFilterPanel;
      isReceivingExternalEvent.current = true;

      if (isAllFloorsVisible) {
        setVisibleFloorIds(new Set(floors.map(f => f.id)));
      } else if (visibleMetaFloorIds && visibleMetaFloorIds.length > 0) {
        const matching = floors
          .filter(f => visibleMetaFloorIds.some(metaId => f.id === metaId || f.metaObjectIds.includes(metaId)))
          .map(f => f.id);
        if (matching.length > 0) setVisibleFloorIds(new Set(matching));
      } else if (e.detail.visibleFloorFmGuids?.length > 0) {
        const matching = floors
          .filter(f => f.databaseLevelFmGuids.some(g =>
            e.detail.visibleFloorFmGuids!.some((vg: string) => vg.toLowerCase() === g.toLowerCase())
          ))
          .map(f => f.id);
        if (matching.length > 0) setVisibleFloorIds(new Set(matching));
      } else if (e.detail.floorId === null) {
        setVisibleFloorIds(new Set(floors.map(f => f.id)));
      } else if (e.detail.floorId) {
        const match = floors.find(f => f.id === e.detail.floorId || f.metaObjectIds.includes(e.detail.floorId!));
        if (match) setVisibleFloorIds(new Set([match.id]));
      }

      // If event came from filter panel, don't re-apply floor visibility
      // (filter panel already handles its own visibility logic)
      if (fromFilterPanel) {
        setTimeout(() => { isReceivingExternalEvent.current = false; }, 100);
        return;
      }

      setTimeout(() => { isReceivingExternalEvent.current = false; }, 100);
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, [floors]);

  // Apply visibility + save + dispatch event helper
  const applyAndDispatch = useCallback((newVisibleIds: Set<string>) => {
    applyFloorVisibility(floors, newVisibleIds);

    if (buildingFmGuid) {
      localStorage.setItem(`viewer-visible-floors-${buildingFmGuid}`, JSON.stringify(Array.from(newVisibleIds)));
    }

    const visibleFloors = floors.filter(f => newVisibleIds.has(f.id));
    const allFmGuids = visibleFloors.flatMap(f => f.databaseLevelFmGuids);
    const allMetaIds = visibleFloors.flatMap(f => f.metaObjectIds);
    const isSolo = newVisibleIds.size === 1;
    const soloFloorId = isSolo ? Array.from(newVisibleIds)[0] : null;
    const floor = soloFloorId ? floors.find(f => f.id === soloFloorId) : null;
    const bounds = soloFloorId ? calculateFloorBounds(soloFloorId) : null;

    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
      detail: {
        floorId: soloFloorId,
        floorName: floor?.name || null,
        bounds: bounds ? { minY: bounds.minY, maxY: bounds.maxY } : null,
        visibleMetaFloorIds: allMetaIds,
        visibleFloorFmGuids: allFmGuids,
        isAllFloorsVisible: newVisibleIds.size === floors.length,
      } as FloorSelectionEventDetail,
    }));
  }, [floors, applyFloorVisibility, calculateFloorBounds, buildingFmGuid]);

  // Pill click handler
  const handlePillClick = useCallback((floorId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const isMultiSelect = event.ctrlKey || event.metaKey;
    let newVisibleIds: Set<string>;

    if (isMultiSelect) {
      newVisibleIds = new Set(visibleFloorIds);
      if (newVisibleIds.has(floorId)) { if (newVisibleIds.size > 1) newVisibleIds.delete(floorId); }
      else newVisibleIds.add(floorId);
    } else {
      if (visibleFloorIds.size === 1 && visibleFloorIds.has(floorId)) {
        newVisibleIds = new Set(floors.map(f => f.id));
      } else {
        newVisibleIds = new Set([floorId]);
      }
    }

    setVisibleFloorIds(newVisibleIds);
    applyAndDispatch(newVisibleIds);
  }, [visibleFloorIds, floors, applyAndDispatch]);

  const handlePillDoubleClick = useCallback(() => {
    const allIds = new Set(floors.map(f => f.id));
    setVisibleFloorIds(allIds);
    applyAndDispatch(allIds);
  }, [floors, applyAndDispatch]);

  const getPillState = useCallback((floorId: string): 'active' | 'partial' | 'inactive' => {
    const isVis = visibleFloorIds.has(floorId);
    const isSolo = visibleFloorIds.size === 1;
    const isAllVisible = visibleFloorIds.size === floors.length;
    if (isSolo && isVis) return 'active';
    if (isVis && !isAllVisible) return 'partial';
    return 'inactive';
  }, [visibleFloorIds, floors.length]);

  const maxVisible = isMobile ? MAX_VISIBLE_PILLS_MOBILE : MAX_VISIBLE_PILLS_DESKTOP;
  const visiblePills = floors.slice(0, maxVisible);
  const overflowPills = floors.slice(maxVisible);
  const hasOverflow = overflowPills.length > 0;

  if (floors.length === 0 || !isViewerReady || !isVisible) return null;

  return (
    <div className={cn(
      'fixed z-20 items-center gap-1 w-auto',
      'pointer-events-auto',
      isMobile
        ? 'bottom-[3.5rem] left-1/2 -translate-x-1/2 flex flex-row bg-black/50 backdrop-blur-md rounded-full px-1 py-0.5 border border-white/10'
        : cn('left-3 flex flex-col', compact ? 'top-[100px] gap-px' : 'top-[140px]'),
      className
    )}>
      {visiblePills.map((floor) => {
        const state = getPillState(floor.id);
        return (
          <Tooltip key={floor.id}>
            <TooltipTrigger asChild>
              <Button
                type="button" variant="ghost" size="sm"
                onClick={(e) => handlePillClick(floor.id, e)}
                onDoubleClick={handlePillDoubleClick}
                className={cn(
                  isMobile
                    ? 'h-6 px-1.5 text-[9px] font-medium rounded-full'
                    : compact ? 'h-5 px-1 text-[7px] font-medium rounded' : 'h-6 px-1.5 min-w-[60px] text-[9px] sm:h-7 sm:px-2 sm:min-w-[60px] sm:text-xs font-medium rounded-md text-center justify-center',
                  'transition-all duration-150 w-auto shadow-sm',
                  state === 'active' && 'bg-primary text-primary-foreground shadow-md hover:bg-primary/90',
                  state === 'partial' && 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30',
                  state === 'inactive' && (isMobile
                    ? 'text-white/70 hover:text-white hover:bg-white/10'
                    : 'bg-background/90 backdrop-blur-sm text-muted-foreground border border-border/40 hover:bg-muted hover:text-foreground'),
                )}
              >
                <span className={cn(compact ? "text-[7px]" : "text-[9px] sm:text-xs", "truncate")}>{floor.name}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{floor.name}</p>
              <p className="text-xs text-muted-foreground">{state === 'active' ? 'Solo' : state === 'partial' ? 'Part of selection' : 'Not isolated'}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}

      {hasOverflow && (
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 min-w-[40px] text-[10px] sm:text-xs font-medium rounded-md bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-center">
              <span className="text-[10px]">+{overflowPills.length}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="center" side="left" sideOffset={8}>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {overflowPills.map((floor) => {
                const isFloorVisible = visibleFloorIds.has(floor.id);
                return (
                  <div key={floor.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-accent/50">
                    <Label htmlFor={`floor-overflow-${floor.id}`} className="text-sm cursor-pointer flex-1 truncate">{floor.name}</Label>
                    <Switch
                      id={`floor-overflow-${floor.id}`}
                      checked={isFloorVisible}
                      onCheckedChange={(checked) => {
                        const newSet = new Set(visibleFloorIds);
                        if (checked) newSet.add(floor.id);
                        else if (newSet.size > 1) newSet.delete(floor.id);
                        setVisibleFloorIds(newSet);
                        applyAndDispatch(newSet);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      <Button
        type="button" variant="ghost" size="sm"
        onClick={handlePillDoubleClick}
        title="Show all floors"
        className={cn(
          isMobile
            ? 'h-6 px-1.5 text-[9px] font-medium rounded-full'
            : compact ? 'h-5 px-1 text-[7px] font-medium rounded' : 'h-6 px-1.5 min-w-[32px] text-[8px] sm:h-7 sm:px-2 sm:min-w-[40px] sm:text-[9px] font-medium rounded-md',
          isMobile
            ? (visibleFloorIds.size === floors.length ? 'bg-primary/30 text-primary' : 'text-white/70 hover:text-white hover:bg-white/10')
            : cn('bg-background/70 backdrop-blur-sm text-muted-foreground border border-border/30 shadow-sm hover:bg-muted hover:text-foreground',
                  visibleFloorIds.size === floors.length && 'bg-primary/20 text-primary border-primary/40'),
        )}
      >
        All
      </Button>
    </div>
  );
});

FloatingFloorSwitcher.displayName = 'FloatingFloorSwitcher';

export default FloatingFloorSwitcher;
