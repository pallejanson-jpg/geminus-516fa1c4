import React, { useState, useEffect, useCallback, useMemo, forwardRef } from 'react';
import { Layers, ChevronDown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface FloorInfo {
  id: string;
  fmGuid: string;
  name: string;
  shortName: string;
  viewerMetaObjectId: string;
  databaseLevelFmGuid?: string;
}

interface FloorVisibilitySelectorProps {
  viewerRef: React.MutableRefObject<any>;
  onVisibleFloorsChange?: (visibleFloorIds: string[]) => void;
  className?: string;
}

/**
 * Multi-select floor visibility selector with switches.
 * Collapsed by default - expands when user clicks to select floors.
 * Controls which floors are visible in the 3D viewer.
 */
const FloorVisibilitySelector = forwardRef<HTMLDivElement, FloorVisibilitySelectorProps>(
  ({ viewerRef, onVisibleFloorsChange, className }, ref) => {
    const [floors, setFloors] = useState<FloorInfo[]>([]);
    const [visibleFloorIds, setVisibleFloorIds] = useState<Set<string>>(new Set());
    const [isExpanded, setIsExpanded] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    // Get XEOkit viewer
    const getXeokitViewer = useCallback(() => {
      try {
        return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      } catch (e) {
        return null;
      }
    }, [viewerRef]);

    // Extract floors from metaScene - only once
    const extractFloors = useCallback(() => {
      const viewer = getXeokitViewer();
      if (!viewer?.metaScene?.metaObjects) return [];

      const metaObjects = viewer.metaScene.metaObjects;
      const extractedFloors: FloorInfo[] = [];

      Object.values(metaObjects).forEach((metaObject: any) => {
        const type = metaObject?.type?.toLowerCase();
        if (type === 'ifcbuildingstorey') {
          const name = metaObject.name || 'Unknown Floor';
          const shortMatch = name.match(/(\d+)/);
          const shortName = shortMatch ? shortMatch[1] : name.substring(0, 4);
          
          extractedFloors.push({
            id: metaObject.id,
            fmGuid: metaObject.originalSystemId || metaObject.id,
            name,
            shortName,
            viewerMetaObjectId: metaObject.id,
            databaseLevelFmGuid: metaObject.originalSystemId || metaObject.id,
          });
        }
      });

      extractedFloors.sort((a, b) => {
        const numA = parseInt(a.shortName) || 0;
        const numB = parseInt(b.shortName) || 0;
        return numA - numB;
      });

      return extractedFloors;
    }, [getXeokitViewer]);

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

    // Apply visibility changes to 3D viewer
    const applyFloorVisibility = useCallback((visibleIds: Set<string>) => {
      const viewer = getXeokitViewer();
      if (!viewer?.scene) return;

      const scene = viewer.scene;
      const metaObjects = viewer.metaScene?.metaObjects || {};

      floors.forEach(floor => {
        const isVisible = visibleIds.has(floor.id);
        const floorMetaObject = metaObjects[floor.viewerMetaObjectId];
        if (!floorMetaObject) return;

        const getChildIds = (metaObj: any): string[] => {
          const ids: string[] = [metaObj.id];
          const children = Object.values(metaObjects).filter(
            (m: any) => m.parent?.id === metaObj.id
          );
          children.forEach((child: any) => {
            ids.push(...getChildIds(child));
          });
          return ids;
        };

        const objectIds = getChildIds(floorMetaObject);
        
        objectIds.forEach(id => {
          const entity = scene.objects?.[id];
          if (entity) {
            entity.visible = isVisible;
          }
        });
      });
    }, [getXeokitViewer, floors]);

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
          onVisibleFloorsChange(visibleFloors.map(f => f.databaseLevelFmGuid || f.id));
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
          onVisibleFloorsChange([floor.databaseLevelFmGuid || floor.id]);
        }
      }
    }, [applyFloorVisibility, floors, onVisibleFloorsChange]);

    const handleShowAll = useCallback(() => {
      const allIds = new Set(floors.map(f => f.id));
      setVisibleFloorIds(allIds);
      applyFloorVisibility(allIds);
      
      if (onVisibleFloorsChange) {
        onVisibleFloorsChange(floors.map(f => f.databaseLevelFmGuid || f.id));
      }
    }, [applyFloorVisibility, floors, onVisibleFloorsChange]);

    const allVisible = useMemo(() => 
      floors.length > 0 && visibleFloorIds.size === floors.length,
      [floors, visibleFloorIds]
    );

    const visibleCount = visibleFloorIds.size;
    const totalCount = floors.length;

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
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
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
