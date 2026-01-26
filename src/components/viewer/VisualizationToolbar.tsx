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
import { getVisualizationToolSettings, ToolConfig } from './ToolbarSettings';
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

  // Reload settings when they change
  useEffect(() => {
    const handleStorageChange = () => {
      setToolSettings(getVisualizationToolSettings());
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
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

  const getXeokitViewer = useCallback(() => {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }, [viewerRef]);

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
        className="w-80 sm:w-96 p-0 bg-card/95 backdrop-blur-sm"
      >
        <SheetHeader className="p-4 pb-2">
          <SheetTitle className="text-base">Vy-alternativ</SheetTitle>
        </SheetHeader>
        
        <ScrollArea className="h-[calc(100vh-80px)]">
          <div className="p-4 pt-0 space-y-4">
            {/* View Options Section */}
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

            {/* Visualization Section */}
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                Visualisering
              </Label>
              <div className="space-y-1">
                {onToggleTreeView && (
                  <ToolItem
                    id="treeView"
                    icon={<TreeDeciduous className="h-4 w-4" />}
                    label="Modellträd"
                    active={localTreeView}
                    onClick={handleToggleTreeView}
                  />
                )}
                {onToggleVisualization && (
                  <ToolItem
                    id="visualization"
                    icon={<Palette className="h-4 w-4" />}
                    label="Rumsvisualisering"
                    active={localVisualization}
                    onClick={handleToggleVisualization}
                  />
                )}
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
