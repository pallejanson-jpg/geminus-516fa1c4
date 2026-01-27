import React, { useState, useEffect, useCallback, useMemo, forwardRef } from 'react';
import { Layers, ChevronDown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

export interface FloorInfo {
  id: string;  // Representative ID for the group
  name: string;
  shortName: string;
  metaObjectIds: string[];  // All metaObject IDs with this name (from all models)
  databaseLevelFmGuids: string[];  // All database fmGuids for this floor
}

interface FloorVisibilitySelectorProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  isViewerReady?: boolean;
  onVisibleFloorsChange?: (visibleFloorIds: string[]) => void;
  className?: string;
}

/**
 * Multi-select floor visibility selector with switches.
 * Collapsed by default - expands when user clicks to select floors.
 * Controls which floors are visible in the 3D viewer.
 * Blocks interaction until viewer is ready to prevent UI freezing.
 */
const FloorVisibilitySelector = forwardRef<HTMLDivElement, FloorVisibilitySelectorProps>(
  ({ viewerRef, buildingFmGuid, isViewerReady = true, onVisibleFloorsChange, className }, ref) => {
    const [floors, setFloors] = useState<FloorInfo[]>([]);
    const [visibleFloorIds, setVisibleFloorIds] = useState<Set<string>>(new Set());
    const [isExpanded, setIsExpanded] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [childrenMapCache, setChildrenMapCache] = useState<Map<string, string[]> | null>(null);
    const [floorNamesMap, setFloorNamesMap] = useState<Map<string, string>>(new Map());

    // Get XEOkit viewer
    const getXeokitViewer = useCallback(() => {
      try {
        return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      } catch (e) {
        return null;
      }
    }, [viewerRef]);

    // Fetch floor names from database
    useEffect(() => {
      if (!buildingFmGuid) return;

      const fetchFloorNames = async () => {
        try {
          const { data: floors, error } = await supabase
            .from('assets')
            .select('fm_guid, name, common_name')
            .eq('building_fm_guid', buildingFmGuid)
            .eq('category', 'Building Storey');

          if (!error && floors && floors.length > 0) {
            const nameMap = new Map<string, string>();
            floors.forEach((f) => {
              const displayName = f.common_name || f.name || f.fm_guid;
              nameMap.set(f.fm_guid, displayName);
              nameMap.set(f.fm_guid.toLowerCase(), displayName);
              nameMap.set(f.fm_guid.toUpperCase(), displayName);
            });
            setFloorNamesMap(nameMap);
          }
        } catch (e) {
          console.debug('Failed to fetch floor names:', e);
        }
      };

      fetchFloorNames();
    }, [buildingFmGuid]);

    // Extract floors from metaScene - group by name to deduplicate across models
    const extractFloors = useCallback(() => {
      const viewer = getXeokitViewer();
      if (!viewer?.metaScene?.metaObjects) return [];

      const metaObjects = viewer.metaScene.metaObjects;
      const floorsByName = new Map<string, FloorInfo>();

      Object.values(metaObjects).forEach((metaObject: any) => {
        const type = metaObject?.type?.toLowerCase();
        if (type === 'ifcbuildingstorey') {
          // Get fmGuid from originalSystemId or use metaObject.id
          const fmGuid = metaObject.originalSystemId || metaObject.id;
          
          // Try to get a nice name from database first, then fall back to metaObject.name
          const dbName = floorNamesMap.get(fmGuid) || 
                         floorNamesMap.get(fmGuid.toLowerCase()) ||
                         floorNamesMap.get(fmGuid.toUpperCase());
          
          // Use database name, or clean up the raw name if it looks like a GUID
          let displayName = metaObject.name || 'Unknown Floor';
          if (dbName) {
            displayName = dbName;
          } else if (displayName.match(/^[0-9A-Fa-f-]{30,}$/)) {
            // Name looks like a GUID, try to extract something useful
            displayName = `Våningsplan ${fmGuid.substring(0, 8)}`;
          }
          
          const shortMatch = displayName.match(/(\d+)/);
          const shortName = shortMatch ? shortMatch[1] : displayName.substring(0, 10);
          
          if (floorsByName.has(displayName)) {
            // Add this metaObject to existing group
            const existing = floorsByName.get(displayName)!;
            existing.metaObjectIds.push(metaObject.id);
            if (!existing.databaseLevelFmGuids.includes(fmGuid)) {
              existing.databaseLevelFmGuids.push(fmGuid);
            }
          } else {
            // Create new group
            floorsByName.set(displayName, {
              id: metaObject.id,  // First ID as representative
              name: displayName,
              shortName,
              metaObjectIds: [metaObject.id],
              databaseLevelFmGuids: [fmGuid],
            });
          }
        }
      });

      // Convert to array and sort alphabetically by name
      const extractedFloors = Array.from(floorsByName.values());
      extractedFloors.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

      return extractedFloors;
    }, [getXeokitViewer, floorNamesMap]);

    // Load floors once and set all visible by default
    useEffect(() => {
      if (isInitialized) return;

      const checkFloors = () => {
        const newFloors = extractFloors();
        if (newFloors.length > 0) {
          setFloors(newFloors);
          const allIds = new Set(newFloors.map(f => f.id));
          setVisibleFloorIds(allIds);
          setIsInitialized(true);
        }
      };

      checkFloors();
      
      // Only retry a few times, not forever
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
    }, [extractFloors, isInitialized]);

    // Re-extract floors when floor names map is updated (after DB fetch)
    useEffect(() => {
      if (!isInitialized || floorNamesMap.size === 0) return;
      
      const updatedFloors = extractFloors();
      if (updatedFloors.length > 0) {
        setFloors(updatedFloors);
      }
    }, [floorNamesMap, isInitialized, extractFloors]);

    // Build parent-to-children map ONCE for fast lookups (O(n) instead of O(n*m))
    const buildChildrenMap = useCallback(() => {
      if (childrenMapCache) return childrenMapCache;
      
      const viewer = getXeokitViewer();
      if (!viewer?.metaScene?.metaObjects) return new Map<string, string[]>();

      const metaObjects = viewer.metaScene.metaObjects;
      const childrenMap = new Map<string, string[]>();

      // Single pass through all objects to build parent->children map
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

    // Optimized recursive function using cached children map
    const getChildIdsOptimized = useCallback((metaObjId: string, childrenMap: Map<string, string[]>): string[] => {
      const ids: string[] = [metaObjId];
      const children = childrenMap.get(metaObjId) || [];
      children.forEach(childId => {
        ids.push(...getChildIdsOptimized(childId, childrenMap));
      });
      return ids;
    }, []);

    // Apply visibility changes to 3D viewer (optimized batch approach)
    const applyFloorVisibility = useCallback((visibleIds: Set<string>) => {
      const viewer = getXeokitViewer();
      if (!viewer?.scene) return;

      const scene = viewer.scene;
      const childrenMap = buildChildrenMap();
      
      // Collect ALL object IDs to show (batch approach for performance)
      const idsToShow: string[] = [];
      
      floors.forEach(floor => {
        if (visibleIds.has(floor.id)) {
          // Collect all child IDs for visible floors
          floor.metaObjectIds.forEach(metaObjId => {
            idsToShow.push(...getChildIdsOptimized(metaObjId, childrenMap));
          });
        }
      });
      
      const idsToShowSet = new Set(idsToShow);
      
      // Use XEOkit batch API if available, otherwise use requestIdleCallback
      if (scene.setObjectsVisible && scene.objectIds) {
        // Native batch update - much faster!
        scene.setObjectsVisible(scene.objectIds, false);
        scene.setObjectsVisible(idsToShow, true);
      } else {
        // Fallback with requestIdleCallback to avoid blocking UI
        requestIdleCallback(() => {
          Object.entries(scene.objects || {}).forEach(([id, entity]: [string, any]) => {
            if (entity && typeof entity.visible !== 'undefined') {
              entity.visible = idsToShowSet.has(id);
            }
          });
        }, { timeout: 100 });
      }
    }, [getXeokitViewer, floors, buildChildrenMap, getChildIdsOptimized]);

    const handleFloorToggle = useCallback((floorId: string, checked: boolean) => {
      setVisibleFloorIds(prev => {
        const newSet = new Set(prev);
        if (checked) {
          newSet.add(floorId);
        } else {
          newSet.delete(floorId);
        }
        
        applyFloorVisibility(newSet);
        
        if (onVisibleFloorsChange) {
          const visibleFloors = floors.filter(f => newSet.has(f.id));
          // Collect all fmGuids from all visible floors
          const allFmGuids = visibleFloors.flatMap(f => f.databaseLevelFmGuids);
          onVisibleFloorsChange(allFmGuids);
        }
        
        return newSet;
      });
    }, [applyFloorVisibility, floors, onVisibleFloorsChange]);

    const handleShowOnlyFloor = useCallback((floorId: string) => {
      const newSet = new Set([floorId]);
      setVisibleFloorIds(newSet);
      applyFloorVisibility(newSet);
      
      if (onVisibleFloorsChange) {
        const floor = floors.find(f => f.id === floorId);
        if (floor) {
          onVisibleFloorsChange(floor.databaseLevelFmGuids);
        }
      }
    }, [applyFloorVisibility, floors, onVisibleFloorsChange]);

    const handleShowAll = useCallback(() => {
      const allIds = new Set(floors.map(f => f.id));
      setVisibleFloorIds(allIds);
      applyFloorVisibility(allIds);
      
      if (onVisibleFloorsChange) {
        // Collect all fmGuids from all floors
        const allFmGuids = floors.flatMap(f => f.databaseLevelFmGuids);
        onVisibleFloorsChange(allFmGuids);
      }
    }, [applyFloorVisibility, floors, onVisibleFloorsChange]);

    const allVisible = useMemo(() => 
      floors.length > 0 && visibleFloorIds.size === floors.length,
      [floors, visibleFloorIds]
    );

    const visibleCount = visibleFloorIds.size;
    const totalCount = floors.length;

    // Show loading placeholder if viewer is not ready
    if (!isViewerReady) {
      return (
        <div className={cn("space-y-2", className)} ref={ref}>
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">
              Våningsplan
            </Label>
            <span className="text-xs text-muted-foreground/70 ml-1 italic">
              (Laddar...)
            </span>
          </div>
        </div>
      );
    }

    if (floors.length === 0) {
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
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs text-muted-foreground uppercase tracking-wider cursor-pointer">
                Våningsplan
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
            {floors.map((floor) => {
              const isVisible = visibleFloorIds.has(floor.id);
              const isSolo = visibleFloorIds.size === 1 && isVisible;
              
              return (
                <div
                  key={floor.id}
                  className={cn(
                    "flex items-center justify-between py-1.5 px-2 rounded-md transition-colors",
                    isVisible ? "bg-primary/5" : "bg-muted/30"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Switch
                      checked={isVisible}
                      onCheckedChange={(checked) => handleFloorToggle(floor.id, checked)}
                      className="scale-90"
                    />
                    <span className={cn(
                      "text-sm truncate",
                      isVisible ? "text-foreground" : "text-muted-foreground"
                    )}>
                      {floor.name}
                    </span>
                  </div>
                  
                  {!isSolo && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-primary"
                      onClick={() => handleShowOnlyFloor(floor.id)}
                      title="Visa endast detta våningsplan"
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

FloorVisibilitySelector.displayName = 'FloorVisibilitySelector';

export default FloorVisibilitySelector;
