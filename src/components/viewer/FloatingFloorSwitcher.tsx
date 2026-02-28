import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFloorData, FloorInfo } from '@/hooks/useFloorData';

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
const MAX_VISIBLE_PILLS_MOBILE = 4;

const FloatingFloorSwitcher: React.FC<FloatingFloorSwitcherProps> = memo(({
  viewerRef,
  buildingFmGuid,
  isViewerReady = true,
  className,
  compact = false,
}) => {
  const isMobile = useIsMobile();

  // ── Shared floor data hook ────────────────────────────────────────────
  const { floors } = useFloorData(viewerRef, buildingFmGuid);

  const [visibleFloorIds, setVisibleFloorIds] = useState<Set<string>>(new Set());
  const [isInitialized, setIsInitialized] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [childrenMapCache, setChildrenMapCache] = useState<Map<string, string[]> | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const isReceivingExternalEvent = useRef(false);

  const getXeokitViewer = useCallback(() => {
    try { return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer; }
    catch { return null; }
  }, [viewerRef]);

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
      isReceivingExternalEvent.current = true;

      if (isAllFloorsVisible) {
        setVisibleFloorIds(new Set(floors.map(f => f.id)));
      } else if (visibleMetaFloorIds && visibleMetaFloorIds.length > 0) {
        const matching = floors
          .filter(f => visibleMetaFloorIds.some(metaId => f.id === metaId || f.metaObjectIds.includes(metaId)))
          .map(f => f.id);
        if (matching.length > 0) setVisibleFloorIds(new Set(matching));
      } else if (e.detail.floorId === null) {
        setVisibleFloorIds(new Set(floors.map(f => f.id)));
      } else if (e.detail.floorId) {
        const match = floors.find(f => f.id === e.detail.floorId || f.metaObjectIds.includes(e.detail.floorId!));
        if (match) setVisibleFloorIds(new Set([match.id]));
      }

      setTimeout(() => { isReceivingExternalEvent.current = false; }, 100);
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, [floors]);

  // Build children map
  const buildChildrenMap = useCallback(() => {
    if (childrenMapCache) return childrenMapCache;
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects) return new Map<string, string[]>();
    const metaObjects = viewer.metaScene.metaObjects;
    const childrenMap = new Map<string, string[]>();
    Object.values(metaObjects).forEach((metaObj: any) => {
      const parentId = metaObj.parent?.id;
      if (parentId) {
        if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
        childrenMap.get(parentId)!.push(metaObj.id);
      }
    });
    setChildrenMapCache(childrenMap);
    return childrenMap;
  }, [getXeokitViewer, childrenMapCache]);

  const getChildIdsOptimized = useCallback((metaObjId: string, childrenMap: Map<string, string[]>): string[] => {
    const ids: string[] = [metaObjId];
    (childrenMap.get(metaObjId) || []).forEach(childId => { ids.push(...getChildIdsOptimized(childId, childrenMap)); });
    return ids;
  }, []);

  const calculateFloorBounds = useCallback((floorId: string) => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene?.objects) return null;
    const floorMeta = viewer.metaScene.metaObjects[floorId];
    if (!floorMeta) return null;
    const getAllChildIds = (obj: any): string[] => {
      const ids: string[] = [obj.id];
      (obj.children || []).forEach((c: any) => { ids.push(...getAllChildIds(c)); });
      return ids;
    };
    const childIds = getAllChildIds(floorMeta);
    let minY = Infinity, maxY = -Infinity, valid = false;
    childIds.forEach(id => {
      const entity = viewer.scene.objects[id];
      if (entity?.aabb) { if (entity.aabb[1] < minY) minY = entity.aabb[1]; if (entity.aabb[4] > maxY) maxY = entity.aabb[4]; valid = true; }
    });
    return valid ? { minY, maxY } : null;
  }, [getXeokitViewer]);

  // Apply floor visibility (batch)
  const applyFloorVisibility = useCallback((newVisibleIds: Set<string>) => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;
    const scene = viewer.scene;
    const childrenMap = buildChildrenMap();
    const isSoloMode = newVisibleIds.size === 1;

    const idsToShow: string[] = [];
    floors.forEach(floor => {
      if (newVisibleIds.has(floor.id)) {
        floor.metaObjectIds.forEach(metaObjId => { idsToShow.push(...getChildIdsOptimized(metaObjId, childrenMap)); });
      }
    });

    if (idsToShow.length === 0) { console.warn('FloatingFloorSwitcher: no objects, aborting'); return; }

    if (scene.setObjectsVisible && scene.objectIds) {
      scene.setObjectsVisible(scene.objectIds, false);
      scene.setObjectsVisible(idsToShow, true);
    } else {
      const set = new Set(idsToShow);
      requestIdleCallback(() => {
        Object.entries(scene.objects || {}).forEach(([id, entity]: [string, any]) => {
          if (entity && typeof entity.visible !== 'undefined') entity.visible = set.has(id);
        });
      }, { timeout: 100 });
    }

    if (isSoloMode) {
      const metaObjects = viewer.metaScene?.metaObjects || {};
      Object.values(metaObjects).forEach((metaObj: any) => {
        if (metaObj.type?.toLowerCase() === 'ifccovering') {
          const entity = scene.objects?.[metaObj.id];
          if (entity) entity.visible = false;
        }
      });
    }

    if (buildingFmGuid) {
      localStorage.setItem(`viewer-visible-floors-${buildingFmGuid}`, JSON.stringify(Array.from(newVisibleIds)));
    }
  }, [getXeokitViewer, floors, buildChildrenMap, getChildIdsOptimized, buildingFmGuid]);

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
    applyFloorVisibility(newVisibleIds);

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
  }, [visibleFloorIds, floors, applyFloorVisibility, calculateFloorBounds]);

  const handlePillDoubleClick = useCallback(() => {
    const allIds = new Set(floors.map(f => f.id));
    setVisibleFloorIds(allIds);
    applyFloorVisibility(allIds);

    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
      detail: {
        floorId: null, floorName: null, bounds: null,
        visibleMetaFloorIds: floors.flatMap(f => f.metaObjectIds),
        visibleFloorFmGuids: floors.flatMap(f => f.databaseLevelFmGuids),
        isAllFloorsVisible: true,
      } as FloorSelectionEventDetail,
    }));
  }, [floors, applyFloorVisibility]);

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
      'fixed z-20 items-center gap-0.5 w-auto',
      'pointer-events-auto',
      isMobile
        ? 'bottom-28 left-1/2 -translate-x-1/2 flex flex-row'
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
                  compact ? 'h-5 px-1 text-[8px] font-medium rounded' : 'h-7 px-2 min-w-[40px] max-w-[120px] text-[10px] sm:text-xs font-medium rounded-md',
                  'transition-all duration-150 w-auto shadow-sm',
                  state === 'active' && 'bg-primary text-primary-foreground shadow-md hover:bg-primary/90',
                  state === 'partial' && 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30',
                  state === 'inactive' && 'bg-background/90 backdrop-blur-sm text-muted-foreground border border-border/40 hover:bg-muted hover:text-foreground',
                )}
              >
                <span className={cn(compact ? "text-[8px]" : "text-[10px] sm:text-xs", "truncate")}>{floor.name}</span>
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
                        applyFloorVisibility(newSet);

                        const vis = floors.filter(f => newSet.has(f.id));
                        const isSolo = newSet.size === 1;
                        const soloId = isSolo ? Array.from(newSet)[0] : null;
                        const soloFloor = soloId ? floors.find(f => f.id === soloId) : null;
                        const bounds = soloId ? calculateFloorBounds(soloId) : null;
                        window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
                          detail: {
                            floorId: soloId, floorName: soloFloor?.name || null,
                            bounds: bounds ? { minY: bounds.minY, maxY: bounds.maxY } : null,
                            visibleMetaFloorIds: vis.flatMap(f => f.metaObjectIds),
                            visibleFloorFmGuids: vis.flatMap(f => f.databaseLevelFmGuids),
                            isAllFloorsVisible: newSet.size === floors.length,
                          } as FloorSelectionEventDetail,
                        }));
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
          compact ? 'h-5 px-1 text-[7px] font-medium rounded' : 'h-7 px-2 min-w-[40px] text-[9px] font-medium rounded-md',
          'bg-background/70 backdrop-blur-sm text-muted-foreground border border-border/30 shadow-sm hover:bg-muted hover:text-foreground',
          visibleFloorIds.size === floors.length && 'bg-primary/20 text-primary border-primary/40',
        )}
      >
        All
      </Button>
    </div>
  );
});

FloatingFloorSwitcher.displayName = 'FloatingFloorSwitcher';

export default FloatingFloorSwitcher;
