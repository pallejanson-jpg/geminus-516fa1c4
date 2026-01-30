import React, { useState, useCallback, useMemo } from 'react';
import { ChevronLeft, TreeDeciduous, Layers, Eye, EyeOff, Home, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import ViewerTreePanel from '../ViewerTreePanel';

export interface MobileFloorInfo {
  id: string;
  fmGuid: string;
  name: string;
  visible: boolean;
}

interface MobileViewerOverlayProps {
  onClose?: () => void;
  viewerInstanceRef: React.RefObject<any>;
  buildingName?: string;
  showSpaces: boolean;
  onShowSpacesChange: (show: boolean) => void;
  floors: MobileFloorInfo[];
  onFloorToggle: (floorId: string, visible: boolean) => void;
  onResetCamera: () => void;
  isViewerReady: boolean;
}

/**
 * Mobile overlay UI for the 3D viewer.
 * This component provides a touch-optimized interface that overlays the existing viewer.
 * The actual 3D canvas is rendered by the parent AssetPlusViewer.
 */
const MobileViewerOverlay: React.FC<MobileViewerOverlayProps> = ({
  onClose,
  viewerInstanceRef,
  buildingName,
  showSpaces,
  onShowSpacesChange,
  floors,
  onFloorToggle,
  onResetCamera,
  isViewerReady,
}) => {
  const [showFloorsDrawer, setShowFloorsDrawer] = useState(false);
  const [showTreeOverlay, setShowTreeOverlay] = useState(false);

  // Count visible floors
  const visibleFloorCount = useMemo(() => 
    floors.filter(f => f.visible).length, 
    [floors]
  );

  // Toggle all floors
  const handleToggleAllFloors = useCallback((visible: boolean) => {
    floors.forEach(floor => {
      onFloorToggle(floor.id, visible);
    });
  }, [floors, onFloorToggle]);

  // Handle tree node selection
  const handleTreeNodeSelect = useCallback((nodeId: string, fmGuid?: string) => {
    console.log('Mobile tree node selected:', nodeId, fmGuid);
  }, []);

  return (
    <>
      {/* Compact Header - absolute positioned over the canvas */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between p-2 bg-gradient-to-b from-background/90 to-transparent">
        {onClose && (
          <Button variant="secondary" size="icon" onClick={onClose} className="h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        
        <div className="flex-1 mx-2 text-center">
          <h1 className="text-sm font-medium truncate text-foreground drop-shadow-sm">
            {buildingName || '3D Viewer'}
          </h1>
          {isViewerReady && floors.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {visibleFloorCount} of {floors.length} floors
            </p>
          )}
        </div>
        
        <Button 
          variant={showTreeOverlay ? 'default' : 'secondary'} 
          size="icon" 
          className="h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border"
          onClick={() => setShowTreeOverlay(!showTreeOverlay)}
          disabled={!isViewerReady}
        >
          <TreeDeciduous className="h-4 w-4" />
        </Button>
      </div>

      {/* TreeView sliding overlay from left */}
      {showTreeOverlay && (
        <>
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/40 z-40"
            onClick={() => setShowTreeOverlay(false)}
          />
          
          {/* Tree panel */}
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-80 z-50 bg-card/98 backdrop-blur-md border-r shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-3 border-b">
              <div className="flex items-center gap-2">
                <TreeDeciduous className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Model Tree</span>
              </div>
              <Button 
                variant="ghost" 
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowTreeOverlay(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="flex-1 overflow-hidden">
              <ViewerTreePanel
                viewerRef={viewerInstanceRef}
                isVisible={showTreeOverlay}
                onClose={() => setShowTreeOverlay(false)}
                onNodeSelect={handleTreeNodeSelect}
                embedded={true}
                showVisibilityCheckboxes={true}
                startFromStoreys={true}
              />
            </div>
          </div>
        </>
      )}

      {/* Bottom Action Bar */}
      <div className="absolute bottom-0 left-0 right-0 z-30 flex items-center justify-around p-2 bg-gradient-to-t from-background/95 to-transparent gap-1">
        <Button 
          variant={showSpaces ? 'default' : 'secondary'} 
          size="sm" 
          className="flex-1 h-11 bg-card/95 backdrop-blur-sm shadow-md border"
          onClick={() => onShowSpacesChange(!showSpaces)}
          disabled={!isViewerReady}
        >
          {showSpaces ? <Eye className="h-4 w-4 mr-1.5" /> : <EyeOff className="h-4 w-4 mr-1.5" />}
          <span className="text-xs">Spaces</span>
        </Button>
        
        <Button 
          variant="secondary" 
          size="sm" 
          className="flex-1 h-11 bg-card/95 backdrop-blur-sm shadow-md border"
          onClick={() => setShowFloorsDrawer(true)}
          disabled={!isViewerReady || floors.length === 0}
        >
          <Layers className="h-4 w-4 mr-1.5" />
          <span className="text-xs">Floors</span>
          {floors.length > 0 && visibleFloorCount < floors.length && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {visibleFloorCount}
            </Badge>
          )}
        </Button>
        
        <Button 
          variant="secondary" 
          size="sm" 
          className="flex-1 h-11 bg-card/95 backdrop-blur-sm shadow-md border"
          onClick={onResetCamera}
          disabled={!isViewerReady}
        >
          <Home className="h-4 w-4 mr-1.5" />
          <span className="text-xs">Reset</span>
        </Button>
      </div>

      {/* Floors Drawer */}
      <Drawer open={showFloorsDrawer} onOpenChange={setShowFloorsDrawer}>
        <DrawerContent className="max-h-[70vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="flex items-center justify-between">
              <span>Select Floors</span>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleToggleAllFloors(true)}
                >
                  Show All
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleToggleAllFloors(false)}
                >
                  Hide All
                </Button>
              </div>
            </DrawerTitle>
          </DrawerHeader>
          
          <ScrollArea className="flex-1 px-4 pb-6">
            <div className="space-y-2">
              {floors.map((floor) => (
                <Button
                  key={floor.id}
                  variant={floor.visible ? 'default' : 'outline'}
                  className={cn(
                    "w-full justify-start h-12",
                    !floor.visible && "text-muted-foreground"
                  )}
                  onClick={() => onFloorToggle(floor.id, !floor.visible)}
                >
                  <Layers className="h-4 w-4 mr-3" />
                  <span className="flex-1 text-left truncate">{floor.name}</span>
                  {floor.visible ? (
                    <Eye className="h-4 w-4 ml-2" />
                  ) : (
                    <EyeOff className="h-4 w-4 ml-2" />
                  )}
                </Button>
              ))}
              
              {floors.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No floors found</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default MobileViewerOverlay;
