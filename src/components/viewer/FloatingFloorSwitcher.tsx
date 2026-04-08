import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { emit, on, type FloorSelectionEventDetail } from '@/lib/event-bus';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFloorData, FloorInfo } from '@/hooks/useFloorData';
import { useFloorVisibility } from '@/hooks/useFloorVisibility';
import { Layers } from 'lucide-react';

// Re-export for backward compat
export type FloorPillInfo = FloorInfo;

interface FloatingFloorSwitcherProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  isViewerReady?: boolean;
  className?: string;
  compact?: boolean;
}

/** @deprecated Use emit('FLOOR_PILLS_TOGGLE', ...) from event-bus */
export const FLOOR_PILLS_TOGGLE_EVENT = 'FLOOR_PILLS_TOGGLE';

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
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const isReceivingExternalEvent = useRef(false);

  // Listen for visibility toggle
  useEffect(() => {
    return on('FLOOR_PILLS_TOGGLE', (detail) => {
      setIsVisible(detail.visible);
      localStorage.setItem('viewer-show-floor-pills', String(detail.visible));
    });
  }, []);

  // Initialize once floors arrive — always start with "All floors"
  useEffect(() => {
    if (isInitialized || floors.length === 0 || !isViewerReady) return;

    // Always default to all floors on viewer entry
    setVisibleFloorIds(new Set(floors.map(f => f.id)));
    setIsInitialized(true);
  }, [floors, isInitialized, isViewerReady, buildingFmGuid]);

  // Listen for external floor selection
  useEffect(() => {
    return on('FLOOR_SELECTION_CHANGED', (detail) => {
      const { visibleMetaFloorIds, isAllFloorsVisible } = detail;
      const fromFilterPanel = !!(detail as any).fromFilterPanel;
      isReceivingExternalEvent.current = true;

      if (isAllFloorsVisible) {
        setVisibleFloorIds(new Set(floors.map(f => f.id)));
      } else if (visibleMetaFloorIds && visibleMetaFloorIds.length > 0) {
        const matching = floors
          .filter(f => visibleMetaFloorIds.some(metaId => f.id === metaId || f.metaObjectIds.includes(metaId)))
          .map(f => f.id);
        if (matching.length > 0) setVisibleFloorIds(new Set(matching));
      } else if (detail.visibleFloorFmGuids?.length > 0) {
        const matching = floors
          .filter(f => f.databaseLevelFmGuids.some(g =>
            detail.visibleFloorFmGuids!.some((vg: string) => vg.toLowerCase() === g.toLowerCase())
          ))
          .map(f => f.id);
        if (matching.length > 0) setVisibleFloorIds(new Set(matching));
      } else if (detail.floorId === null) {
        setVisibleFloorIds(new Set(floors.map(f => f.id)));
      } else if (detail.floorId) {
        const match = floors.find(f => f.id === detail.floorId || f.metaObjectIds.includes(detail.floorId!));
        if (match) setVisibleFloorIds(new Set([match.id]));
      }

      if (fromFilterPanel) {
        setTimeout(() => { isReceivingExternalEvent.current = false; }, 100);
        return;
      }

      setTimeout(() => { isReceivingExternalEvent.current = false; }, 100);
    });
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
    const selectedFloorId = isSolo ? Array.from(newVisibleIds)[0] : null;
    const soloFloorId = isSolo ? (allMetaIds[0] ?? selectedFloorId) : null;
    const floor = selectedFloorId ? floors.find(f => f.id === selectedFloorId) : null;
    const bounds = soloFloorId ? calculateFloorBounds(soloFloorId) : null;

    emit('FLOOR_SELECTION_CHANGED', {
      floorId: soloFloorId,
      floorName: floor?.name || null,
      bounds: bounds ? { minY: bounds.minY, maxY: bounds.maxY } : null,
      visibleMetaFloorIds: allMetaIds,
      visibleFloorFmGuids: allFmGuids,
      isAllFloorsVisible: newVisibleIds.size === floors.length,
      isSoloFloor: isSolo,
      skipClipping: !isSolo,
    } as FloorSelectionEventDetail);
  }, [floors, applyFloorVisibility, calculateFloorBounds, buildingFmGuid]);

  // Floor select handler
  const handleFloorSelect = useCallback((floorId: string) => {
    let newVisibleIds: Set<string>;

    if (visibleFloorIds.size === 1 && visibleFloorIds.has(floorId)) {
      // Clicking already-solo floor → show all
      newVisibleIds = new Set(floors.map(f => f.id));
    } else {
      newVisibleIds = new Set([floorId]);
    }

    setVisibleFloorIds(newVisibleIds);
    applyAndDispatch(newVisibleIds);
  }, [visibleFloorIds, floors, applyAndDispatch]);

  const handleShowAll = useCallback(() => {
    const allIds = new Set(floors.map(f => f.id));
    setVisibleFloorIds(allIds);
    applyAndDispatch(allIds);
  }, [floors, applyAndDispatch]);

  // Current floor label for the icon
  const currentFloorLabel = (() => {
    if (visibleFloorIds.size === floors.length || visibleFloorIds.size === 0) return null;
    if (visibleFloorIds.size === 1) {
      const id = Array.from(visibleFloorIds)[0];
      return floors.find(f => f.id === id)?.shortName || null;
    }
    return `${visibleFloorIds.size}`;
  })();

  if (floors.length === 0 || !isViewerReady || !isVisible) return null;

  return (
    <div className={cn(
      'absolute z-40 pointer-events-auto',
      className
    )}>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 rounded-full px-3 gap-1.5',
              'bg-black/50 backdrop-blur-md border border-white/10',
              'text-white/80 hover:text-white hover:bg-black/60',
              'shadow-lg transition-all duration-150',
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            {currentFloorLabel && (
              <span className="text-xs font-medium">{currentFloorLabel}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-48 p-1.5 max-h-[50dvh] overflow-y-auto"
          align="center"
          side="top"
          sideOffset={8}
        >
          <div className="space-y-0.5">
            {floors.map((floor) => {
              const isActive = visibleFloorIds.size === 1 && visibleFloorIds.has(floor.id);
              return (
                <button
                  key={floor.id}
                  onClick={() => handleFloorSelect(floor.id)}
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors',
                    'hover:bg-accent/50 cursor-pointer',
                    isActive && 'bg-primary/15 text-primary font-medium',
                  )}
                >
                  {floor.name}
                </button>
              );
            })}
            <div className="border-t border-border my-1" />
            <button
              onClick={handleShowAll}
              className={cn(
                'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors',
                'hover:bg-accent/50 cursor-pointer',
                visibleFloorIds.size === floors.length && 'bg-primary/15 text-primary font-medium',
              )}
            >
              All floors
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});

FloatingFloorSwitcher.displayName = 'FloatingFloorSwitcher';

export default FloatingFloorSwitcher;
