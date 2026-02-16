import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { useIsMobile } from '@/hooks/use-mobile';

export interface FloorPillInfo {
  id: string;
  name: string;
  shortName: string;
  metaObjectIds: string[];
  databaseLevelFmGuids: string[];
}

interface FloatingFloorSwitcherProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  isViewerReady?: boolean;
  className?: string;
}

// Event for visibility toggle from settings
export const FLOOR_PILLS_TOGGLE_EVENT = 'FLOOR_PILLS_TOGGLE';

// Constants for responsive design
const MAX_VISIBLE_PILLS_DESKTOP = 10;
const MAX_VISIBLE_PILLS_MOBILE = 4;

/**
 * Floating floor switcher with pill buttons overlaid on the 3D viewer.
 * Vertical layout, draggable, positioned near right menu by default.
 * Provides 1-click floor isolation with visual feedback.
 */
const FloatingFloorSwitcher: React.FC<FloatingFloorSwitcherProps> = memo(({
  viewerRef,
  buildingFmGuid,
  isViewerReady = true,
  className,
}) => {
  const isMobile = useIsMobile();
  const [floors, setFloors] = useState<FloorPillInfo[]>([]);
  const [visibleFloorIds, setVisibleFloorIds] = useState<Set<string>>(new Set());
  const [floorNamesMap, setFloorNamesMap] = useState<Map<string, string>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [childrenMapCache, setChildrenMapCache] = useState<Map<string, string[]> | null>(null);


  // Visibility state (controlled from VisualizationToolbar settings)
  const [isVisible, setIsVisible] = useState(() => {
    return localStorage.getItem('viewer-show-floor-pills') === 'true';
  });

  // Ref to track if we're receiving an external event (to prevent dispatch loops)
  const isReceivingExternalEvent = useRef(false);

  // Get XEOkit viewer
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);


  // Listen for visibility toggle events from settings
  useEffect(() => {
    const handleToggle = (e: CustomEvent<{ visible: boolean }>) => {
      setIsVisible(e.detail.visible);
      localStorage.setItem('viewer-show-floor-pills', String(e.detail.visible));
    };
    window.addEventListener(FLOOR_PILLS_TOGGLE_EVENT, handleToggle as EventListener);
    return () => {
      window.removeEventListener(FLOOR_PILLS_TOGGLE_EVENT, handleToggle as EventListener);
    };
  }, []);


  // Fetch floor names from database
  useEffect(() => {
    if (!buildingFmGuid) return;

    const fetchFloorNames = async () => {
      try {
        const { data: dbFloors, error } = await supabase
          .from('assets')
          .select('fm_guid, name, common_name')
          .eq('building_fm_guid', buildingFmGuid)
          .eq('category', 'Building Storey');

        if (!error && dbFloors && dbFloors.length > 0) {
          const nameMap = new Map<string, string>();
          dbFloors.forEach((f) => {
            const displayName = f.common_name || f.name || null;
            if (!displayName) return; // Skip - will get sequential naming
            nameMap.set(f.fm_guid, displayName);
            nameMap.set(f.fm_guid.toLowerCase(), displayName);
            nameMap.set(f.fm_guid.toUpperCase(), displayName);
          });
          setFloorNamesMap(nameMap);
        }
      } catch (e) {
        console.debug('FloatingFloorSwitcher: Failed to fetch floor names:', e);
      }
    };

    fetchFloorNames();
  }, [buildingFmGuid]);

  // Extract floors from metaScene
  const extractFloors = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects) return [];

    const metaObjects = viewer.metaScene.metaObjects;
    const floorsByName = new Map<string, FloorPillInfo>();

    Object.values(metaObjects).forEach((metaObject: any) => {
      const type = metaObject?.type?.toLowerCase();
      if (type === 'ifcbuildingstorey') {
        const fmGuid = metaObject.originalSystemId || metaObject.id;
        
        const dbName = floorNamesMap.get(fmGuid) || 
                       floorNamesMap.get(fmGuid.toLowerCase()) ||
                       floorNamesMap.get(fmGuid.toUpperCase());
        
        let displayName = metaObject.name || 'Unknown Floor';
        if (dbName) {
          displayName = dbName;
        } else if (displayName.match(/^[0-9A-Fa-f-]{30,}$/)) {
          displayName = `__GUID_PLACEHOLDER__`;
        }
        
        // Extract short name (number or first few chars)
        const shortMatch = displayName.match(/(\d+)/);
        const shortName = shortMatch ? shortMatch[1] : displayName.substring(0, 8);
        
        if (floorsByName.has(displayName)) {
          const existing = floorsByName.get(displayName)!;
          existing.metaObjectIds.push(metaObject.id);
          if (!existing.databaseLevelFmGuids.includes(fmGuid)) {
            existing.databaseLevelFmGuids.push(fmGuid);
          }
        } else {
          floorsByName.set(displayName, {
            id: metaObject.id,
            name: displayName,
            shortName,
            metaObjectIds: [metaObject.id],
            databaseLevelFmGuids: [fmGuid],
          });
        }
      }
    });

    const extractedFloors = Array.from(floorsByName.values());
    extractedFloors.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

    // Replace GUID placeholders with sequential "Plan X" names
    let unknownIndex = 1;
    extractedFloors.forEach(floor => {
      if (floor.name === '__GUID_PLACEHOLDER__') {
        floor.name = `Plan ${unknownIndex}`;
        floor.shortName = String(unknownIndex);
        unknownIndex++;
      }
    });

    return extractedFloors;
  }, [getXeokitViewer, floorNamesMap]);

  // Initialize floors
  useEffect(() => {
    if (isInitialized || !isViewerReady) return;

    const checkFloors = () => {
      const newFloors = extractFloors();
      if (newFloors.length > 0) {
        setFloors(newFloors);
        
        // Load saved selection from localStorage
        const storageKey = `viewer-visible-floors-${buildingFmGuid}`;
        const saved = localStorage.getItem(storageKey);
        
        if (saved) {
          try {
            const savedIds = JSON.parse(saved) as string[];
            const validIds = new Set(savedIds.filter(id => 
              newFloors.some(f => f.id === id)
            ));
            if (validIds.size > 0) {
              setVisibleFloorIds(validIds);
            } else {
              setVisibleFloorIds(new Set(newFloors.map(f => f.id)));
            }
          } catch (e) {
            setVisibleFloorIds(new Set(newFloors.map(f => f.id)));
          }
        } else {
          setVisibleFloorIds(new Set(newFloors.map(f => f.id)));
        }
        
        setIsInitialized(true);
      }
    };

    checkFloors();
    
    let attempts = 0;
    const maxAttempts = 10;
    const interval = setInterval(() => {
      if (isInitialized || attempts >= maxAttempts) {
        clearInterval(interval);
        return;
      }
      checkFloors();
      attempts++;
    }, 500);

    return () => clearInterval(interval);
  }, [extractFloors, isInitialized, isViewerReady, buildingFmGuid]);

  // Re-extract when names map updates
  useEffect(() => {
    if (!isInitialized || floorNamesMap.size === 0) return;
    
    const updatedFloors = extractFloors();
    if (updatedFloors.length > 0) {
      setFloors(updatedFloors);
    }
  }, [floorNamesMap, isInitialized, extractFloors]);

  // Listen for external floor selection changes (from ViewerTreePanel, FloorVisibilitySelector, etc.)
  useEffect(() => {
    const handleFloorChange = (e: CustomEvent<FloorSelectionEventDetail>) => {
      const { visibleMetaFloorIds, isAllFloorsVisible } = e.detail;
      
      // Mark that we're receiving an external event
      isReceivingExternalEvent.current = true;
      
      if (isAllFloorsVisible) {
        // All floors visible
        setVisibleFloorIds(new Set(floors.map(f => f.id)));
      } else if (visibleMetaFloorIds && visibleMetaFloorIds.length > 0) {
        // Match visible floors by ID
        const matchingIds = floors
          .filter(f => visibleMetaFloorIds.some(metaId => 
            f.id === metaId || f.metaObjectIds.includes(metaId)
          ))
          .map(f => f.id);
        
        if (matchingIds.length > 0) {
          setVisibleFloorIds(new Set(matchingIds));
        }
      } else if (e.detail.floorId === null) {
        // Fallback: All floors visible
        setVisibleFloorIds(new Set(floors.map(f => f.id)));
      } else if (e.detail.floorId) {
        // Single floor
        const matchingFloor = floors.find(f => 
          f.id === e.detail.floorId || f.metaObjectIds.includes(e.detail.floorId!)
        );
        if (matchingFloor) {
          setVisibleFloorIds(new Set([matchingFloor.id]));
        }
      }
      
      // Reset flag after a tick
      setTimeout(() => {
        isReceivingExternalEvent.current = false;
      }, 100);
    };
    
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
    return () => {
      window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
    };
  }, [floors]);

  // Build children map for visibility changes
  const buildChildrenMap = useCallback(() => {
    if (childrenMapCache) return childrenMapCache;
    
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects) return new Map<string, string[]>();

    const metaObjects = viewer.metaScene.metaObjects;
    const childrenMap = new Map<string, string[]>();

    Object.values(metaObjects).forEach((metaObj: any) => {
      const parentId = metaObj.parent?.id;
      if (parentId) {
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(metaObj.id);
      }
    });

    setChildrenMapCache(childrenMap);
    return childrenMap;
  }, [getXeokitViewer, childrenMapCache]);

  // Get all child IDs recursively
  const getChildIdsOptimized = useCallback((metaObjId: string, childrenMap: Map<string, string[]>): string[] => {
    const ids: string[] = [metaObjId];
    const children = childrenMap.get(metaObjId) || [];
    children.forEach(childId => {
      ids.push(...getChildIdsOptimized(childId, childrenMap));
    });
    return ids;
  }, []);

  // Calculate floor bounds for clipping
  const calculateFloorBounds = useCallback((floorId: string) => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene?.objects) return null;

    const metaObjects = viewer.metaScene.metaObjects;
    const scene = viewer.scene;
    const floorMeta = metaObjects[floorId];

    if (!floorMeta) return null;

    const getAllChildIds = (metaObj: any): string[] => {
      const ids: string[] = [metaObj.id];
      (metaObj.children || []).forEach((child: any) => {
        ids.push(...getAllChildIds(child));
      });
      return ids;
    };

    const childIds = getAllChildIds(floorMeta);
    
    let minY = Infinity;
    let maxY = -Infinity;
    let hasValidBounds = false;

    childIds.forEach(id => {
      const entity = scene.objects[id];
      if (entity?.aabb) {
        const aabb = entity.aabb;
        if (aabb[1] < minY) minY = aabb[1];
        if (aabb[4] > maxY) maxY = aabb[4];
        hasValidBounds = true;
      }
    });

    if (!hasValidBounds) return null;

    return { minY, maxY };
  }, [getXeokitViewer]);

  // Apply floor visibility to viewer
  const applyFloorVisibility = useCallback((newVisibleIds: Set<string>) => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    const scene = viewer.scene;
    const childrenMap = buildChildrenMap();
    const isSoloMode = newVisibleIds.size === 1;
    
    const idsToShow: string[] = [];
    
    floors.forEach(floor => {
      if (newVisibleIds.has(floor.id)) {
        floor.metaObjectIds.forEach(metaObjId => {
          idsToShow.push(...getChildIdsOptimized(metaObjId, childrenMap));
        });
      }
    });
    
    // SAFETY: Abort if no objects to show -- prevents blacking out
    if (idsToShow.length === 0) {
      console.warn('FloatingFloorSwitcher.applyFloorVisibility: no objects found for selected floors, aborting');
      return;
    }
    
    const idsToShowSet = new Set(idsToShow);
    
    if (scene.setObjectsVisible && scene.objectIds) {
      scene.setObjectsVisible(scene.objectIds, false);
      scene.setObjectsVisible(idsToShow, true);
    } else {
      requestIdleCallback(() => {
        Object.entries(scene.objects || {}).forEach(([id, entity]: [string, any]) => {
          if (entity && typeof entity.visible !== 'undefined') {
            entity.visible = idsToShowSet.has(id);
          }
        });
      }, { timeout: 100 });
    }
    
    // Hide IfcCovering in solo mode
    if (isSoloMode) {
      const metaObjects = viewer.metaScene?.metaObjects || {};
      Object.values(metaObjects).forEach((metaObj: any) => {
        if (metaObj.type?.toLowerCase() === 'ifccovering') {
          const entity = scene.objects?.[metaObj.id];
          if (entity) {
            entity.visible = false;
          }
        }
      });
    }
    
    // Save to localStorage
    if (buildingFmGuid) {
      const storageKey = `viewer-visible-floors-${buildingFmGuid}`;
      localStorage.setItem(storageKey, JSON.stringify(Array.from(newVisibleIds)));
    }
  }, [getXeokitViewer, floors, buildChildrenMap, getChildIdsOptimized, buildingFmGuid]);

  // Handle pill click
  const handlePillClick = useCallback((floorId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    const isMultiSelect = event.ctrlKey || event.metaKey;
    
    let newVisibleIds: Set<string>;
    
    if (isMultiSelect) {
      // Toggle this floor in selection
      newVisibleIds = new Set(visibleFloorIds);
      if (newVisibleIds.has(floorId)) {
        // Don't allow deselecting the last floor
        if (newVisibleIds.size > 1) {
          newVisibleIds.delete(floorId);
        }
      } else {
        newVisibleIds.add(floorId);
      }
    } else {
      // Solo mode - show only this floor
      if (visibleFloorIds.size === 1 && visibleFloorIds.has(floorId)) {
        // Already solo on this floor - show all
        newVisibleIds = new Set(floors.map(f => f.id));
      } else {
        newVisibleIds = new Set([floorId]);
      }
    }
    
    setVisibleFloorIds(newVisibleIds);
    applyFloorVisibility(newVisibleIds);
    
    // Calculate complete event data
    const visibleFloors = floors.filter(f => newVisibleIds.has(f.id));
    const allFmGuids = visibleFloors.flatMap(f => f.databaseLevelFmGuids);
    const allMetaIds = visibleFloors.flatMap(f => f.metaObjectIds);
    const isAllVisible = newVisibleIds.size === floors.length;
    const isSolo = newVisibleIds.size === 1;
    
    const soloFloorId = isSolo ? Array.from(newVisibleIds)[0] : null;
    const floor = soloFloorId ? floors.find(f => f.id === soloFloorId) : null;
    const bounds = soloFloorId ? calculateFloorBounds(soloFloorId) : null;
    
    const eventDetail: FloorSelectionEventDetail = {
      floorId: soloFloorId,
      floorName: floor?.name || null,
      bounds: bounds ? { minY: bounds.minY, maxY: bounds.maxY } : null,
      visibleMetaFloorIds: allMetaIds,
      visibleFloorFmGuids: allFmGuids,
      isAllFloorsVisible: isAllVisible,
    };
    
    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: eventDetail }));
  }, [visibleFloorIds, floors, applyFloorVisibility, calculateFloorBounds]);

  // Handle double-click to show all
  const handlePillDoubleClick = useCallback(() => {
    const allIds = new Set(floors.map(f => f.id));
    setVisibleFloorIds(allIds);
    applyFloorVisibility(allIds);
    
    // Calculate complete event data for all floors
    const allFmGuids = floors.flatMap(f => f.databaseLevelFmGuids);
    const allMetaIds = floors.flatMap(f => f.metaObjectIds);
    
    const eventDetail: FloorSelectionEventDetail = {
      floorId: null,
      floorName: null,
      bounds: null,
      visibleMetaFloorIds: allMetaIds,
      visibleFloorFmGuids: allFmGuids,
      isAllFloorsVisible: true,
    };
    window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: eventDetail }));
  }, [floors, applyFloorVisibility]);

  // Determine pill state
  const getPillState = useCallback((floorId: string): 'active' | 'partial' | 'inactive' => {
    const isVisible = visibleFloorIds.has(floorId);
    const isSolo = visibleFloorIds.size === 1;
    const isAllVisible = visibleFloorIds.size === floors.length;
    
    if (isSolo && isVisible) return 'active';
    if (isVisible && !isAllVisible) return 'partial';
    return 'inactive';
  }, [visibleFloorIds, floors.length]);

  // Responsive pill display
  const maxVisible = isMobile ? MAX_VISIBLE_PILLS_MOBILE : MAX_VISIBLE_PILLS_DESKTOP;
  const visiblePills = floors.slice(0, maxVisible);
  const overflowPills = floors.slice(maxVisible);
  const hasOverflow = overflowPills.length > 0;

  // Don't render if no floors or not visible
  if (floors.length === 0 || !isViewerReady || !isVisible) {
    return null;
  }

  return (
    <div 
      className={cn(
        'fixed left-3 top-[140px] z-20 flex flex-col items-center gap-0.5 p-0.5 rounded-lg h-auto w-auto',
        'bg-background/80 backdrop-blur-sm border border-border/50 shadow-lg',
        'pointer-events-auto',
        className
      )}
    >

      {/* Vertical pills */}
      {visiblePills.map((floor) => {
        const state = getPillState(floor.id);
        
        return (
          <Tooltip key={floor.id}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => handlePillClick(floor.id, e)}
                onDoubleClick={handlePillDoubleClick}
                className={cn(
                  'h-7 w-8 sm:h-7 sm:w-9 p-0 text-[10px] sm:text-xs font-medium rounded-full',
                  'transition-all duration-150',
                  state === 'active' && [
                    'bg-primary text-primary-foreground',
                    'ring-2 ring-primary/30',
                    'hover:bg-primary/90',
                  ],
                  state === 'partial' && [
                    'bg-primary/20 text-primary border border-primary/50',
                    'hover:bg-primary/30',
                  ],
                  state === 'inactive' && [
                    'bg-muted/50 text-muted-foreground',
                    'hover:bg-muted hover:text-foreground',
                  ],
                )}
              >
                <span className="text-[10px] sm:text-xs">
                  {floor.shortName}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>{floor.name}</p>
              <p className="text-xs text-muted-foreground">
                {state === 'active' ? 'Solo' : state === 'partial' ? 'Del av selektion' : 'Ej isolerad'}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}

      {/* Overflow menu */}
      {hasOverflow && (
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 w-8 sm:h-7 sm:w-9 p-0 text-[10px] sm:text-xs font-medium rounded-full',
                'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
                'flex items-center justify-center',
              )}
            >
              <span className="text-[10px]">+{overflowPills.length}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent 
            className="w-56 p-2" 
            align="center" 
            side="left"
            sideOffset={8}
          >
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {overflowPills.map((floor) => {
                const isFloorVisible = visibleFloorIds.has(floor.id);
                
                return (
                  <div 
                    key={floor.id}
                    className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-accent/50"
                  >
                    <Label 
                      htmlFor={`floor-overflow-${floor.id}`}
                      className="text-sm cursor-pointer flex-1 truncate"
                    >
                      {floor.name}
                    </Label>
                    <Switch
                      id={`floor-overflow-${floor.id}`}
                      checked={isFloorVisible}
                      onCheckedChange={(checked) => {
                        const newSet = new Set(visibleFloorIds);
                        if (checked) {
                          newSet.add(floor.id);
                        } else if (newSet.size > 1) {
                          newSet.delete(floor.id);
                        }
                        setVisibleFloorIds(newSet);
                        applyFloorVisibility(newSet);
                        
                        // Dispatch event
                        const visibleFloors = floors.filter(f => newSet.has(f.id));
                        const allFmGuids = visibleFloors.flatMap(f => f.databaseLevelFmGuids);
                        const allMetaIds = visibleFloors.flatMap(f => f.metaObjectIds);
                        const isSolo = newSet.size === 1;
                        const soloFloorId = isSolo ? Array.from(newSet)[0] : null;
                        const soloFloor = soloFloorId ? floors.find(f => f.id === soloFloorId) : null;
                        const bounds = soloFloorId ? calculateFloorBounds(soloFloorId) : null;
                        
                        const eventDetail: FloorSelectionEventDetail = {
                          floorId: soloFloorId,
                          floorName: soloFloor?.name || null,
                          bounds: bounds ? { minY: bounds.minY, maxY: bounds.maxY } : null,
                          visibleMetaFloorIds: allMetaIds,
                          visibleFloorFmGuids: allFmGuids,
                          isAllFloorsVisible: newSet.size === floors.length,
                        };
                        window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: eventDetail }));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Removed "Alla" button — double-click any pill to show all floors */}
    </div>
  );
});

FloatingFloorSwitcher.displayName = 'FloatingFloorSwitcher';

export default FloatingFloorSwitcher;
