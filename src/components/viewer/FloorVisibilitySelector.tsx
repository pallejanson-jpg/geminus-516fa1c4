import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Layers } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface FloorInfo {
  id: string;
  fmGuid: string;
  name: string;
  shortName: string;
  // These are viewer IDs from metaScene - critical for 3D visibility
  viewerMetaObjectId: string;
  // Database level_fm_guid for room filtering (may differ from viewer ID)
  databaseLevelFmGuid?: string;
}

interface FloorVisibilitySelectorProps {
  viewerRef: React.MutableRefObject<any>;
  onVisibleFloorsChange?: (visibleFloorIds: string[]) => void;
  className?: string;
}

/**
 * Multi-select floor visibility selector with switches.
 * Controls which floors are visible in the 3D viewer and provides
 * visible floor IDs for room filtering.
 */
const FloorVisibilitySelector: React.FC<FloorVisibilitySelectorProps> = ({
  viewerRef,
  onVisibleFloorsChange,
  className,
}) => {
  const [floors, setFloors] = useState<FloorInfo[]>([]);
  const [visibleFloorIds, setVisibleFloorIds] = useState<Set<string>>(new Set());

  // Get XEOkit viewer
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  // Extract floors from metaScene
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
        
        // The viewer metaObject.id is what we use for 3D visibility
        extractedFloors.push({
          id: metaObject.id,
          fmGuid: metaObject.originalSystemId || metaObject.id,
          name,
          shortName,
          viewerMetaObjectId: metaObject.id,
          // This will be matched against database level_fm_guid
          databaseLevelFmGuid: metaObject.originalSystemId || metaObject.id,
        });
      }
    });

    // Sort by name (typically floors are numbered)
    extractedFloors.sort((a, b) => {
      const numA = parseInt(a.shortName) || 0;
      const numB = parseInt(b.shortName) || 0;
      return numA - numB;
    });

    return extractedFloors;
  }, [getXeokitViewer]);

  // Load floors and set all visible by default
  useEffect(() => {
    const checkFloors = () => {
      const newFloors = extractFloors();
      if (newFloors.length > 0 && newFloors.length !== floors.length) {
        setFloors(newFloors);
        // All floors visible by default
        const allIds = new Set(newFloors.map(f => f.id));
        setVisibleFloorIds(allIds);
      }
    };

    checkFloors();
    const interval = setInterval(() => {
      if (floors.length === 0) checkFloors();
    }, 1000);

    return () => clearInterval(interval);
  }, [extractFloors, floors.length]);

  // Apply visibility changes to 3D viewer
  const applyFloorVisibility = useCallback((visibleIds: Set<string>) => {
    const viewer = getXeokitViewer();
    if (!viewer?.scene) return;

    const scene = viewer.scene;
    const metaObjects = viewer.metaScene?.metaObjects || {};

    // For each floor, show/hide all its child objects
    floors.forEach(floor => {
      const isVisible = visibleIds.has(floor.id);
      
      // Get all objects that belong to this floor
      const floorMetaObject = metaObjects[floor.viewerMetaObjectId];
      if (!floorMetaObject) return;

      // Recursively get all child object IDs
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
      
      // Apply visibility to all objects in this floor
      objectIds.forEach(id => {
        const entity = scene.objects?.[id];
        if (entity) {
          entity.visible = isVisible;
        }
      });
    });
  }, [getXeokitViewer, floors]);

  // Handle floor toggle
  const handleFloorToggle = useCallback((floorId: string, checked: boolean) => {
    setVisibleFloorIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(floorId);
      } else {
        newSet.delete(floorId);
      }
      
      // Apply visibility in 3D
      applyFloorVisibility(newSet);
      
      // Notify parent with visible floor IDs for room filtering
      if (onVisibleFloorsChange) {
        const visibleFloors = floors.filter(f => newSet.has(f.id));
        // Pass the database-compatible GUIDs for room filtering
        onVisibleFloorsChange(visibleFloors.map(f => f.databaseLevelFmGuid || f.id));
      }
      
      return newSet;
    });
  }, [applyFloorVisibility, floors, onVisibleFloorsChange]);

  // Show only one floor (solo mode)
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

  // Show all floors
  const handleShowAll = useCallback(() => {
    const allIds = new Set(floors.map(f => f.id));
    setVisibleFloorIds(allIds);
    applyFloorVisibility(allIds);
    
    if (onVisibleFloorsChange) {
      onVisibleFloorsChange(floors.map(f => f.databaseLevelFmGuid || f.id));
    }
  }, [applyFloorVisibility, floors, onVisibleFloorsChange]);

  // Calculate if all are visible
  const allVisible = useMemo(() => 
    floors.length > 0 && visibleFloorIds.size === floors.length,
    [floors, visibleFloorIds]
  );

  if (floors.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" />
          Våningsplan
        </Label>
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
    </div>
  );
};

export default FloorVisibilitySelector;
