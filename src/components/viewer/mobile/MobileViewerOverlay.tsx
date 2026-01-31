import React, { useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronDown, TreeDeciduous, Layers, Eye, EyeOff, Home, X, Menu, Settings2, Box, Tag, LayoutDashboard, Palette, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import ViewerTreePanel from '../ViewerTreePanel';

export interface MobileFloorInfo {
  id: string;
  fmGuid: string;
  name: string;
  visible: boolean;
}

export interface MobileModelInfo {
  id: string;
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
  // New props for additional visualization tools
  is2DMode?: boolean;
  onToggle2DMode?: (is2D: boolean) => void;
  showAnnotations?: boolean;
  onShowAnnotationsChange?: (show: boolean) => void;
  showRoomLabels?: boolean;
  onShowRoomLabelsChange?: (show: boolean) => void;
  onOpenVisualizationPanel?: () => void;
  models?: MobileModelInfo[];
  onModelToggle?: (modelId: string, visible: boolean) => void;
  // Controlled tree state
  treeSelectedId?: string | null;
  onTreeSelectedIdChange?: (id: string | null) => void;
  treeExpandedIds?: Set<string>;
  onTreeExpandedIdsChange?: (ids: Set<string>) => void;
}

/**
 * Mobile overlay UI for the 3D viewer.
 * Header with back/tree buttons + hamburger for visualization drawer on right.
 * Bottom toolbar is handled by ViewerToolbar.
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
  // New props
  is2DMode = false,
  onToggle2DMode,
  showAnnotations = false,
  onShowAnnotationsChange,
  showRoomLabels = false,
  onShowRoomLabelsChange,
  onOpenVisualizationPanel,
  models = [],
  onModelToggle,
  // Tree state
  treeSelectedId,
  onTreeSelectedIdChange,
  treeExpandedIds,
  onTreeExpandedIdsChange,
}) => {
  const [showFloorsDrawer, setShowFloorsDrawer] = useState(false);
  const [showTreeOverlay, setShowTreeOverlay] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  
  // Collapsible section states
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [viewerSettingsOpen, setViewerSettingsOpen] = useState(false);

  // Count visible floors
  const visibleFloorCount = useMemo(() => 
    floors.filter(f => f.visible).length, 
    [floors]
  );

  // Count visible models
  const visibleModelCount = useMemo(() =>
    models.filter(m => m.visible).length,
    [models]
  );

  // Toggle all floors
  const handleToggleAllFloors = useCallback((visible: boolean) => {
    floors.forEach(floor => {
      onFloorToggle(floor.id, visible);
    });
  }, [floors, onFloorToggle]);

  // Toggle all models
  const handleToggleAllModels = useCallback((visible: boolean) => {
    models.forEach(model => {
      onModelToggle?.(model.id, visible);
    });
  }, [models, onModelToggle]);

  // Handle tree node selection
  const handleTreeNodeSelect = useCallback((nodeId: string, fmGuid?: string) => {
    console.log('Mobile tree node selected:', nodeId, fmGuid);
    onTreeSelectedIdChange?.(nodeId);
  }, [onTreeSelectedIdChange]);

  return (
    <>
      {/* Compact Header - absolute positioned over the canvas */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between p-2 bg-gradient-to-b from-background/90 to-transparent">
        {/* Left side: Back button */}
        {onClose && (
          <Button variant="secondary" size="icon" onClick={onClose} className="h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        
        {/* Center: Building name */}
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
        
        {/* Right side: Tree + Settings hamburger */}
        <div className="flex gap-1.5">
          <Button 
            variant={showTreeOverlay ? 'default' : 'secondary'} 
            size="icon" 
            className="h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border"
            onClick={() => setShowTreeOverlay(!showTreeOverlay)}
            disabled={!isViewerReady}
          >
            <TreeDeciduous className="h-4 w-4" />
          </Button>
          
          <Button 
            variant={showSettingsDrawer ? 'default' : 'secondary'} 
            size="icon" 
            className="h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border"
            onClick={() => setShowSettingsDrawer(true)}
            disabled={!isViewerReady}
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>
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
                selectedId={treeSelectedId}
                onSelectedIdChange={onTreeSelectedIdChange}
                expandedIds={treeExpandedIds}
                onExpandedIdsChange={onTreeExpandedIdsChange}
              />
            </div>
          </div>
        </>
      )}

      {/* Right-side Settings/Visualization Drawer */}
      <Sheet open={showSettingsDrawer} onOpenChange={setShowSettingsDrawer}>
        <SheetContent side="right" className="w-[300px] sm:w-[340px] p-0">
          <SheetHeader className="p-4 pb-2 border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4" />
              View Settings
            </SheetTitle>
          </SheetHeader>
          
          <ScrollArea className="flex-1 h-[calc(100vh-80px)]">
            <div className="p-4 space-y-3">
              
              {/* DISPLAY Section - Always visible toggles */}
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Display</Label>
                
                {/* 2D/3D Toggle */}
                {onToggle2DMode && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="2d-toggle" className="flex items-center gap-2 text-sm">
                      <LayoutDashboard className="h-4 w-4" />
                      <span>2D View</span>
                    </Label>
                    <Switch
                      id="2d-toggle"
                      checked={is2DMode}
                      onCheckedChange={onToggle2DMode}
                      disabled={!isViewerReady}
                    />
                  </div>
                )}
                
                {/* Show Spaces Toggle */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="spaces-toggle" className="flex items-center gap-2 text-sm">
                    {showSpaces ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    <span>Show Spaces</span>
                  </Label>
                  <Switch
                    id="spaces-toggle"
                    checked={showSpaces}
                    onCheckedChange={onShowSpacesChange}
                    disabled={!isViewerReady}
                  />
                </div>
                
                {/* Show Annotations Toggle */}
                {onShowAnnotationsChange && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="annotations-toggle" className="flex items-center gap-2 text-sm">
                      <Tag className="h-4 w-4" />
                      <span>Annotations</span>
                    </Label>
                    <Switch
                      id="annotations-toggle"
                      checked={showAnnotations}
                      onCheckedChange={onShowAnnotationsChange}
                      disabled={!isViewerReady}
                    />
                  </div>
                )}
                
                {/* Room Labels Toggle */}
                {onShowRoomLabelsChange && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="labels-toggle" className="flex items-center gap-2 text-sm">
                      <Tag className="h-4 w-4" />
                      <span>Room Labels</span>
                    </Label>
                    <Switch
                      id="labels-toggle"
                      checked={showRoomLabels}
                      onCheckedChange={onShowRoomLabelsChange}
                      disabled={!isViewerReady}
                    />
                  </div>
                )}
                
                {/* Room Visualization Link */}
                {onOpenVisualizationPanel && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-between h-9 text-sm"
                    onClick={() => {
                      onOpenVisualizationPanel();
                      setShowSettingsDrawer(false);
                    }}
                    disabled={!isViewerReady}
                  >
                    <span className="flex items-center gap-2">
                      <Palette className="h-4 w-4" />
                      Room Visualization
                    </span>
                    <ChevronDown className="h-4 w-4 -rotate-90" />
                  </Button>
                )}
              </div>
              
              <Separator />
              
              {/* FLOORS Section - Collapsible */}
              <Collapsible open={floorsOpen} onOpenChange={setFloorsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between h-10 px-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4" />
                      <span className="font-medium text-sm">Floors</span>
                      {floors.length > 0 && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          {visibleFloorCount}/{floors.length}
                        </Badge>
                      )}
                    </div>
                    <ChevronDown className={cn(
                      "h-4 w-4 transition-transform",
                      floorsOpen && "rotate-180"
                    )} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pl-2 pt-2 space-y-2">
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => handleToggleAllFloors(true)}
                        disabled={!isViewerReady || floors.length === 0}
                      >
                        <Check className="h-3 w-3 mr-1" /> All
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => handleToggleAllFloors(false)}
                        disabled={!isViewerReady || floors.length === 0}
                      >
                        <X className="h-3 w-3 mr-1" /> None
                      </Button>
                    </div>
                    
                    <div className="space-y-1 max-h-[180px] overflow-y-auto">
                      {floors.map((floor) => (
                        <Button
                          key={floor.id}
                          variant={floor.visible ? 'default' : 'outline'}
                          size="sm"
                          className={cn(
                            "w-full justify-start h-8 text-xs",
                            !floor.visible && "text-muted-foreground"
                          )}
                          onClick={() => onFloorToggle(floor.id, !floor.visible)}
                        >
                          <Layers className="h-3 w-3 mr-2" />
                          <span className="flex-1 text-left truncate">{floor.name}</span>
                          {floor.visible ? (
                            <Eye className="h-3 w-3 ml-1" />
                          ) : (
                            <EyeOff className="h-3 w-3 ml-1" />
                          )}
                        </Button>
                      ))}
                      
                      {floors.length === 0 && (
                        <div className="text-center text-muted-foreground py-3">
                          <Layers className="h-5 w-5 mx-auto mb-1 opacity-50" />
                          <p className="text-xs">No floors found</p>
                        </div>
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              
              {/* BIM MODELS Section - Collapsible */}
              {models.length > 0 && onModelToggle && (
                <>
                  <Separator />
                  <Collapsible open={modelsOpen} onOpenChange={setModelsOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between h-10 px-2">
                        <div className="flex items-center gap-2">
                          <Box className="h-4 w-4" />
                          <span className="font-medium text-sm">BIM Models</span>
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                            {visibleModelCount}/{models.length}
                          </Badge>
                        </div>
                        <ChevronDown className={cn(
                          "h-4 w-4 transition-transform",
                          modelsOpen && "rotate-180"
                        )} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="pl-2 pt-2 space-y-2">
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="flex-1 h-7 text-xs"
                            onClick={() => handleToggleAllModels(true)}
                            disabled={!isViewerReady}
                          >
                            <Check className="h-3 w-3 mr-1" /> All
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="flex-1 h-7 text-xs"
                            onClick={() => handleToggleAllModels(false)}
                            disabled={!isViewerReady}
                          >
                            <X className="h-3 w-3 mr-1" /> None
                          </Button>
                        </div>
                        
                        <div className="space-y-1 max-h-[150px] overflow-y-auto">
                          {models.map((model) => (
                            <Button
                              key={model.id}
                              variant={model.visible ? 'default' : 'outline'}
                              size="sm"
                              className={cn(
                                "w-full justify-start h-8 text-xs",
                                !model.visible && "text-muted-foreground"
                              )}
                              onClick={() => onModelToggle(model.id, !model.visible)}
                            >
                              <Box className="h-3 w-3 mr-2" />
                              <span className="flex-1 text-left truncate">{model.name}</span>
                              {model.visible ? (
                                <Eye className="h-3 w-3 ml-1" />
                              ) : (
                                <EyeOff className="h-3 w-3 ml-1" />
                              )}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </>
              )}
              
              <Separator />
              
              {/* Reset Camera */}
              <Button 
                variant="outline" 
                className="w-full h-10"
                onClick={() => {
                  onResetCamera();
                  setShowSettingsDrawer(false);
                }}
                disabled={!isViewerReady}
              >
                <Home className="h-4 w-4 mr-2" />
                Reset Camera
              </Button>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Floors Drawer (legacy - kept for direct floor access if needed) */}
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
