import React, { useState, useCallback, useEffect } from 'react';
import {
  Eye,
  Layers,
  Box,
  Map,
  MessageSquare,
  MoreVertical,
  Search,
  Info,
  Plus,
  TreeDeciduous,
  Palette,
  Settings,
  Building2,
  Layers3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getVisualizationToolSettings, ToolConfig, TOOLBAR_SETTINGS_CHANGED_EVENT } from './ToolbarSettings';
import ViewerTreePanel from './ViewerTreePanel';

interface VisualizationToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  onToggleNavCube?: (visible: boolean) => void;
  onToggleMinimap?: (visible: boolean) => void;
  onToggleTreeView?: (visible: boolean) => void;
  onToggleVisualization?: (visible: boolean) => void;
  onPickCoordinate?: () => void;
  onShowProperties?: () => void;
  onOpenSettings?: () => void;
  isPickMode?: boolean;
  showTreeView?: boolean;
  showVisualization?: boolean;
  showNavCube?: boolean;
  showMinimap?: boolean;
  className?: string;
  // New: inline mode for header integration
  inline?: boolean;
}

/**
 * Right-side visualization toolbar for the Asset+ 3D Viewer
 * Contains view options, visualization controls, and object info tools
 * Can be rendered inline (for header) or absolute positioned
 */
const VisualizationToolbar: React.FC<VisualizationToolbarProps> = ({
  viewerRef,
  onToggleNavCube,
  onToggleMinimap,
  onToggleTreeView,
  onToggleVisualization,
  onPickCoordinate,
  onShowProperties,
  onOpenSettings,
  isPickMode,
  showTreeView,
  showVisualization,
  showNavCube = true,
  showMinimap = false,
  className,
  inline = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showSpaces, setShowSpaces] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [localNavCube, setLocalNavCube] = useState(showNavCube);
  const [localMinimap, setLocalMinimap] = useState(showMinimap);
  const [localTreeView, setLocalTreeView] = useState(showTreeView || false);
  const [localVisualization, setLocalVisualization] = useState(showVisualization || false);
  const [toolSettings, setToolSettings] = useState<ToolConfig[]>(getVisualizationToolSettings());
  
  // BIM models and floors state
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; visible: boolean }[]>([]);
  const [availableFloors, setAvailableFloors] = useState<{ id: string; name: string; visible: boolean }[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isViewerReady, setIsViewerReady] = useState(false);

  // Reload settings when they change (both cross-tab and same-tab)
  useEffect(() => {
    const handleSettingsChange = () => {
      setToolSettings(getVisualizationToolSettings());
    };
    window.addEventListener('storage', handleSettingsChange);
    window.addEventListener(TOOLBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    return () => {
      window.removeEventListener('storage', handleSettingsChange);
      window.removeEventListener(TOOLBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    };
  }, []);

  // Sync with parent props
  useEffect(() => {
    setLocalNavCube(showNavCube);
  }, [showNavCube]);

  useEffect(() => {
    setLocalMinimap(showMinimap);
  }, [showMinimap]);

  useEffect(() => {
    setLocalTreeView(showTreeView || false);
  }, [showTreeView]);

  useEffect(() => {
    setLocalVisualization(showVisualization || false);
  }, [showVisualization]);

  // Fixed: Use correct ref chain for XEOKit access
  const getXeokitViewer = useCallback(() => {
    try {
      const assetViewer = viewerRef.current?.$refs?.AssetViewer;
      return assetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      console.debug('getXeokitViewer error:', e);
      return null;
    }
  }, [viewerRef]);

  // Check viewer readiness
  useEffect(() => {
    const checkReady = () => {
      const viewer = getXeokitViewer();
      setIsViewerReady(!!viewer?.scene);
    };
    
    // Check immediately and after delays to catch async initialization
    checkReady();
    const t1 = setTimeout(checkReady, 200);
    const t2 = setTimeout(checkReady, 500);
    const t3 = setTimeout(checkReady, 1000);
    
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [getXeokitViewer, isOpen]);

  const isToolVisible = useCallback((toolId: string) => {
    const setting = toolSettings.find(t => t.id === toolId);
    return setting?.visible ?? true;
  }, [toolSettings]);

  // Toggle functions
  const handleToggleSpaces = useCallback(() => {
    try {
      const viewer = viewerRef.current?.assetViewer;
      if (viewer && typeof viewer.onShowSpacesChanged === 'function') {
        const newValue = !showSpaces;
        viewer.onShowSpacesChanged(newValue);
        setShowSpaces(newValue);
      }
    } catch (error) {
      console.warn('Toggle spaces failed:', error);
    }
  }, [viewerRef, showSpaces]);

  const handleToggleXray = useCallback(() => {
    try {
      const viewer = getXeokitViewer();
      if (viewer?.scene) {
        const scene = viewer.scene;
        const objectIds = Object.keys(scene.objects || {});
        if (objectIds.length > 0) {
          const firstObj = scene.objects[objectIds[0]];
          const newXray = !firstObj?.xrayed;
          objectIds.forEach(id => {
            const obj = scene.objects[id];
            if (obj) obj.xrayed = newXray;
          });
        }
      }
    } catch (error) {
      console.warn('Toggle X-ray failed:', error);
    }
  }, [getXeokitViewer]);

  const handleToggleNavCube = useCallback(() => {
    const newValue = !localNavCube;
    setLocalNavCube(newValue);
    onToggleNavCube?.(newValue);
  }, [localNavCube, onToggleNavCube]);

  const handleToggleMinimap = useCallback(() => {
    const newValue = !localMinimap;
    setLocalMinimap(newValue);
    onToggleMinimap?.(newValue);
  }, [localMinimap, onToggleMinimap]);

  const handleToggleTreeView = useCallback(() => {
    const newValue = !localTreeView;
    setLocalTreeView(newValue);
    onToggleTreeView?.(newValue);
  }, [localTreeView, onToggleTreeView]);

  const handleToggleVisualization = useCallback(() => {
    const newValue = !localVisualization;
    setLocalVisualization(newValue);
    onToggleVisualization?.(newValue);
  }, [localVisualization, onToggleVisualization]);

  const handleToggleAnnotations = useCallback(() => {
    try {
      const viewer = viewerRef.current?.assetViewer;
      if (viewer && typeof viewer.onToggleAnnotation === 'function') {
        const newValue = !showAnnotations;
        viewer.onToggleAnnotation(newValue);
        setShowAnnotations(newValue);
      }
    } catch (error) {
      console.warn('Toggle annotations failed:', error);
    }
  }, [viewerRef, showAnnotations]);

  // Fetch available models and floors when sheet opens
  useEffect(() => {
    if (!isOpen) return;
    
    setIsLoadingData(true);
    
    // Use timeout to ensure viewer is fully ready
    const timer = setTimeout(() => {
      try {
        const xeokitViewer = getXeokitViewer();
        
        // Get models from XEOKit metaScene (more reliable than Asset+ API)
        if (xeokitViewer?.metaScene?.metaModels) {
          const metaModels = xeokitViewer.metaScene.metaModels;
          const models = Object.values(metaModels).map((m: any) => {
            // Check if model objects are visible
            const modelId = m.id;
            const sceneModel = xeokitViewer.scene?.models?.[modelId];
            return {
              id: modelId,
              name: m.id || 'Model',
              visible: sceneModel?.visible !== false,
            };
          });
          setAvailableModels(models);
        }
        
        // Get floors from metaScene
        if (xeokitViewer?.metaScene) {
          const metaObjects = xeokitViewer.metaScene.metaObjects || {};
          const floors: { id: string; name: string; visible: boolean }[] = [];
          
          Object.values(metaObjects).forEach((obj: any) => {
            if (obj.type === 'IfcBuildingStorey') {
              const sceneObject = xeokitViewer.scene?.objects?.[obj.id];
              floors.push({
                id: obj.id,
                name: obj.name || obj.id,
                visible: sceneObject?.visible !== false,
              });
            }
          });
          
          // Sort floors by name (often includes floor number)
          floors.sort((a, b) => a.name.localeCompare(b.name, 'sv', { numeric: true }));
          setAvailableFloors(floors);
        }
      } catch (e) {
        console.debug('Failed to fetch models/floors:', e);
      } finally {
        setIsLoadingData(false);
      }
    }, 150);
    
    return () => clearTimeout(timer);
  }, [isOpen, getXeokitViewer]);

  // Toggle model visibility
  const handleToggleModel = useCallback((modelId: string) => {
    try {
      const viewer = viewerRef.current;
      const assetViewer = viewer?.$refs?.AssetViewer;
      
      if (assetViewer && typeof assetViewer.setModelVisibility === 'function') {
        const model = availableModels.find(m => m.id === modelId);
        if (model) {
          assetViewer.setModelVisibility(modelId, !model.visible);
          setAvailableModels(prev => prev.map(m => 
            m.id === modelId ? { ...m, visible: !m.visible } : m
          ));
        }
      }
    } catch (e) {
      console.debug('Toggle model failed:', e);
    }
  }, [viewerRef, availableModels]);

  // Toggle floor visibility
  const handleToggleFloor = useCallback((floorId: string) => {
    try {
      const xeokitViewer = getXeokitViewer();
      if (!xeokitViewer?.metaScene) return;
      
      const floor = availableFloors.find(f => f.id === floorId);
      if (!floor) return;
      
      const newVisible = !floor.visible;
      
      // Get all objects that belong to this floor (children of the storey)
      const metaObject = xeokitViewer.metaScene.metaObjects[floorId];
      if (metaObject) {
        const objectIds = metaObject.getObjectIDsInSubtree?.() || [floorId];
        objectIds.forEach((id: string) => {
          const sceneObj = xeokitViewer.scene?.objects?.[id];
          if (sceneObj) {
            sceneObj.visible = newVisible;
          }
        });
      }
      
      setAvailableFloors(prev => prev.map(f => 
        f.id === floorId ? { ...f, visible: newVisible } : f
      ));
    } catch (e) {
      console.debug('Toggle floor failed:', e);
    }
  }, [getXeokitViewer, availableFloors]);

  const handleShowObjectDetails = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer) {
      viewer.onShowObjectDetailsButtonClick?.();
    }
  }, [viewerRef]);

  // Tool item component
  const ToolItem = ({ 
    id, 
    icon, 
    label, 
    active, 
    onClick 
  }: { 
    id: string;
    icon: React.ReactNode; 
    label: string; 
    active?: boolean;
    onClick: () => void;
  }) => {
    if (!isToolVisible(id)) return null;
    
    return (
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-1.5 rounded-md",
            active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}>
            {icon}
          </div>
          <span className="text-sm">{label}</span>
        </div>
        <Switch 
          checked={active} 
          onCheckedChange={onClick}
        />
      </div>
    );
  };

  // Button item component (for actions, not toggles)
  const ButtonItem = ({ 
    id,
    icon, 
    label,
    active,
    onClick 
  }: { 
    id: string;
    icon: React.ReactNode; 
    label: string;
    active?: boolean;
    onClick: () => void;
  }) => {
    if (!isToolVisible(id)) return null;
    
    return (
      <Button 
        variant={active ? "secondary" : "ghost"} 
        className="w-full justify-start gap-3 h-10"
        onClick={() => {
          onClick();
          setIsOpen(false);
        }}
      >
        <div className={cn(
          "p-1 rounded-md",
          active ? "bg-primary/10 text-primary" : ""
        )}>
          {icon}
        </div>
        <span className="text-sm">{label}</span>
      </Button>
    );
  };

  // The trigger button - can be used inline or absolute
  const TriggerButton = (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button 
            variant="secondary" 
            size="icon"
            className={cn(
              "shadow-lg bg-card/95 backdrop-blur-sm border",
              "h-8 w-8 sm:h-10 sm:w-10"
            )}
          >
            <MoreVertical className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Vy-alternativ</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        {TriggerButton}
      </SheetTrigger>
      
      <SheetContent 
        side="right" 
        className="w-80 sm:w-96 p-0 bg-card/95 backdrop-blur-sm z-[60]"
      >
        <SheetHeader className="p-4 pb-2">
          <SheetTitle className="text-base">Vy-alternativ</SheetTitle>
        </SheetHeader>
        
        <ScrollArea className="h-[calc(100vh-80px)]">
          <div className="p-4 pt-0 space-y-4">
            {/* Viewer status indicator */}
            {!isViewerReady && (
              <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-md px-3 py-2 flex items-center gap-2">
                <div className="h-3 w-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                Väntar på viewer...
              </div>
            )}
            
            {/* Loading indicator */}
            {isLoadingData && isViewerReady && (
              <div className="text-xs text-muted-foreground italic py-2 flex items-center gap-2">
                <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Laddar modelldata...
              </div>
            )}
            
            {/* View Options Section - Always visible */}
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                Vyalternativ
              </Label>
              <div className="space-y-1">
                <ToolItem
                  id="xray"
                  icon={<Eye className="h-4 w-4" />}
                  label="X-ray läge"
                  onClick={handleToggleXray}
                />
                <ToolItem
                  id="spaces"
                  icon={<Layers className="h-4 w-4" />}
                  label="Visa rum"
                  active={showSpaces}
                  onClick={handleToggleSpaces}
                />
                <ToolItem
                  id="navCube"
                  icon={<Box className="h-4 w-4" />}
                  label="Navigationskub"
                  active={localNavCube}
                  onClick={handleToggleNavCube}
                />
                <ToolItem
                  id="minimap"
                  icon={<Map className="h-4 w-4" />}
                  label="Minimap"
                  active={localMinimap}
                  onClick={handleToggleMinimap}
                />
                <ToolItem
                  id="annotations"
                  icon={<MessageSquare className="h-4 w-4" />}
                  label="Annotationer"
                  active={showAnnotations}
                  onClick={handleToggleAnnotations}
                />
              </div>
            </div>

            <Separator />

            {/* Visualization Section - Always show both items */}
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                Visualisering
              </Label>
              <div className="space-y-1">
                <ToolItem
                  id="treeView"
                  icon={<TreeDeciduous className="h-4 w-4" />}
                  label="Modellträd"
                  active={localTreeView}
                  onClick={handleToggleTreeView}
                />
                <ToolItem
                  id="visualization"
                  icon={<Palette className="h-4 w-4" />}
                  label="Rumsvisualisering"
                  active={localVisualization}
                  onClick={handleToggleVisualization}
                />
              </div>
            </div>

            <Separator />

            {/* Embedded Tree Navigator */}
            {localTreeView && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                    Navigator
                  </Label>
                  <div className="border rounded-lg overflow-hidden max-h-[40vh]">
                    <ViewerTreePanel 
                      viewerRef={viewerRef}
                      isVisible={true}
                      onClose={() => handleToggleTreeView()}
                      embedded={true}
                    />
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* BIM Models Section */}
            {isToolVisible('bimModels') && availableModels.length > 0 && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5" />
                      BIM-modeller
                    </div>
                  </Label>
                  <div className="space-y-1">
                    {availableModels.map(model => (
                      <div key={model.id} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "p-1.5 rounded-md",
                            model.visible ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                          )}>
                            <Building2 className="h-4 w-4" />
                          </div>
                          <span className="text-sm truncate max-w-[180px]" title={model.name}>
                            {model.name}
                          </span>
                        </div>
                        <Switch 
                          checked={model.visible} 
                          onCheckedChange={() => handleToggleModel(model.id)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Floors Section */}
            {isToolVisible('floors') && availableFloors.length > 0 && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                    <div className="flex items-center gap-2">
                      <Layers3 className="h-3.5 w-3.5" />
                      Våningsplan
                    </div>
                  </Label>
                  <div className="space-y-1">
                    {availableFloors.map(floor => (
                      <div key={floor.id} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "p-1.5 rounded-md",
                            floor.visible ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                          )}>
                            <Layers3 className="h-4 w-4" />
                          </div>
                          <span className="text-sm truncate max-w-[180px]" title={floor.name}>
                            {floor.name}
                          </span>
                        </div>
                        <Switch 
                          checked={floor.visible} 
                          onCheckedChange={() => handleToggleFloor(floor.id)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Object Data Section */}
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                Objektdata
              </Label>
              <div className="space-y-1">
                <ButtonItem
                  id="objectInfo"
                  icon={<Search className="h-4 w-4" />}
                  label="Objektinfo (Asset+)"
                  onClick={handleShowObjectDetails}
                />
                {onShowProperties && (
                  <ButtonItem
                    id="properties"
                    icon={<Info className="h-4 w-4" />}
                    label="Egenskaper"
                    onClick={onShowProperties}
                  />
                )}
                {onPickCoordinate && (
                  <ButtonItem
                    id="addAsset"
                    icon={<Plus className="h-4 w-4" />}
                    label={isPickMode ? 'Avbryt registrering' : 'Registrera tillgång'}
                    active={isPickMode}
                    onClick={onPickCoordinate}
                  />
                )}
              </div>
            </div>

            <Separator />

            {/* Settings Section */}
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                Inställningar
              </Label>
              {onOpenSettings && (
                <ButtonItem
                  id="settings"
                  icon={<Settings className="h-4 w-4" />}
                  label="Anpassa verktygsfält"
                  onClick={onOpenSettings}
                />
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default VisualizationToolbar;
