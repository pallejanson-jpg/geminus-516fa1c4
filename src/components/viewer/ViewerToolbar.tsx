import React, { useState, useCallback, useEffect } from 'react';
import {
  Move,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize,
  Box,
  Eye,
  Ruler,
  Layers,
  Focus,
  Scissors,
  MousePointer2,
  ChevronUp,
  ChevronDown,
  Cuboid,
  SquareDashed,
  Map,
  MoreHorizontal,
  MessageSquare,
  Plus,
  Search,
  Info,
  Settings,
  TreeDeciduous,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { getToolbarSettings, ToolConfig } from './ToolbarSettings';

interface ViewerToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  onToggleNavCube?: (visible: boolean) => void;
  onToggleMinimap?: (visible: boolean) => void;
  onToggleTreeView?: (visible: boolean) => void;
  onPickCoordinate?: () => void;
  onShowProperties?: () => void;
  onOpenSettings?: () => void;
  isPickMode?: boolean;
  showTreeView?: boolean;
  className?: string;
}

type ViewerTool = 'select' | 'measure' | 'slicer' | null;
type NavMode = 'orbit' | 'firstPerson' | 'planView';
type ViewMode = '3d' | '2d';

/**
 * Custom toolbar for the Asset+ 3D Viewer
 * Configurable with overflow menu and user settings
 */
const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  viewerRef,
  onToggleNavCube,
  onToggleMinimap,
  onToggleTreeView,
  onPickCoordinate,
  onShowProperties,
  onOpenSettings,
  isPickMode,
  showTreeView,
  className
}) => {
  const [activeTool, setActiveTool] = useState<ViewerTool>('select');
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [showSpaces, setShowSpaces] = useState(true);
  const [showNavCube, setShowNavCube] = useState(true);
  const [showMinimap, setShowMinimap] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [toolSettings, setToolSettings] = useState<ToolConfig[]>(getToolbarSettings());
  
  const isMobile = useIsMobile();

  // Reload settings when they change
  useEffect(() => {
    const handleStorageChange = () => {
      setToolSettings(getToolbarSettings());
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Get AssetView reference
  const getAssetView = useCallback(() => {
    return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
  }, [viewerRef]);

  const getXeokitViewer = useCallback(() => {
    return getAssetView()?.viewer;
  }, [getAssetView]);

  // Navigation controls
  const handleResetView = useCallback(() => {
    const assetView = getAssetView();
    if (assetView) {
      assetView.viewFit(undefined, true);
    }
  }, [getAssetView]);

  const handleZoomIn = useCallback(() => {
    const viewer = getXeokitViewer();
    if (viewer?.cameraFlight) {
      const camera = viewer.camera;
      const look = camera.look;
      const eye = camera.eye;
      const newEye = [
        eye[0] + (look[0] - eye[0]) * 0.2,
        eye[1] + (look[1] - eye[1]) * 0.2,
        eye[2] + (look[2] - eye[2]) * 0.2,
      ];
      viewer.cameraFlight.flyTo({ eye: newEye, look, duration: 0.3 });
    }
  }, [getXeokitViewer]);

  const handleZoomOut = useCallback(() => {
    const viewer = getXeokitViewer();
    if (viewer?.cameraFlight) {
      const camera = viewer.camera;
      const look = camera.look;
      const eye = camera.eye;
      const newEye = [
        eye[0] - (look[0] - eye[0]) * 0.25,
        eye[1] - (look[1] - eye[1]) * 0.25,
        eye[2] - (look[2] - eye[2]) * 0.25,
      ];
      viewer.cameraFlight.flyTo({ eye: newEye, look, duration: 0.3 });
    }
  }, [getXeokitViewer]);

  const handleViewFit = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer?.assetViewer?.$refs?.assetView) {
      const assetView = viewer.assetViewer.$refs.assetView;
      const selectedItems = assetView.selectedItemIds;
      if (selectedItems?.length > 0) {
        assetView.viewFit(selectedItems, false);
      } else {
        assetView.viewFit(undefined, true);
      }
    }
  }, [viewerRef]);

  // Navigation mode
  const handleNavModeChange = useCallback((mode: NavMode) => {
    const assetView = getAssetView();
    if (assetView) {
      assetView.setNavMode(mode);
      setNavMode(mode);
    }
  }, [getAssetView]);

  // Tools - with proper state cleanup to prevent tool "sticking"
  const handleToolChange = useCallback((tool: ViewerTool) => {
    try {
      const assetView = getAssetView();
      if (assetView && typeof assetView.useTool === 'function') {
        // First deactivate current tool if switching
        if (activeTool && activeTool !== tool) {
          try {
            assetView.useTool(null);
          } catch (e) {
            console.debug('Tool deactivation:', e);
          }
        }
        // Then activate new tool
        assetView.useTool(tool);
        setActiveTool(tool);
      } else {
        console.warn('AssetView not ready for tool change');
      }
    } catch (error) {
      console.warn('Tool change failed:', error);
    }
  }, [getAssetView, activeTool]);

  // View modes - with null safety
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

  // Fixed: Remove direct DOM manipulation to prevent 'nextSibling' crash
  const handleToggleNavCube = useCallback(() => {
    const newValue = !showNavCube;
    setShowNavCube(newValue);
    onToggleNavCube?.(newValue);
  }, [showNavCube, onToggleNavCube]);

  const handleToggleMinimap = useCallback(() => {
    const newValue = !showMinimap;
    setShowMinimap(newValue);
    onToggleMinimap?.(newValue);
  }, [showMinimap, onToggleMinimap]);

  const handleToggleTreeView = useCallback(() => {
    onToggleTreeView?.(!showTreeView);
  }, [showTreeView, onToggleTreeView]);

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

  // Switch between 3D and 2D (top-down) view
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    const viewer = getXeokitViewer();
    if (!viewer) return;

    setViewMode(mode);
    
    if (mode === '2d') {
      const camera = viewer.camera;
      const scene = viewer.scene;
      const aabb = scene?.getAABB?.();
      
      if (camera && aabb) {
        const centerX = (aabb[0] + aabb[3]) / 2;
        const centerY = (aabb[1] + aabb[4]) / 2;
        const centerZ = (aabb[2] + aabb[5]) / 2;
        const height = Math.max(aabb[3] - aabb[0], aabb[5] - aabb[2]) * 1.5;
        
        viewer.cameraFlight.flyTo({
          eye: [centerX, centerY + height, centerZ],
          look: [centerX, centerY, centerZ],
          up: [0, 0, -1],
          duration: 0.5,
          orthoScale: height
        });
        
        camera.projection = 'ortho';
      }
    } else {
      const camera = viewer.camera;
      if (camera) {
        camera.projection = 'perspective';
        const assetView = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
        if (assetView) {
          assetView.viewFit(undefined, true);
        }
      }
    }
  }, [getXeokitViewer, viewerRef]);

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

  const handleClearSlices = useCallback(() => {
    const assetView = getAssetView();
    if (assetView) {
      assetView.clearSlices?.();
    }
  }, [getAssetView]);

  const handleShowObjectDetails = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer) {
      viewer.onShowObjectDetailsButtonClick?.();
    }
  }, [viewerRef]);

  // Tool visibility check based on settings
  const isToolVisible = useCallback((toolId: string) => {
    const setting = toolSettings.find(t => t.id === toolId);
    return setting?.visible ?? true;
  }, [toolSettings]);

  const isToolInOverflow = useCallback((toolId: string) => {
    const setting = toolSettings.find(t => t.id === toolId);
    return setting?.inOverflow ?? false;
  }, [toolSettings]);

  if (!isExpanded) {
    return (
      <div className={cn("absolute bottom-4 left-1/2 -translate-x-1/2 z-20", className)}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsExpanded(true)}
          className="shadow-lg bg-card/95 backdrop-blur-sm border"
        >
          <ChevronUp className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">Visa verktygsfält</span>
          <span className="sm:hidden">Verktyg</span>
        </Button>
      </div>
    );
  }

  // ToolButton with forwardRef to avoid React warning
  const ToolButton = React.forwardRef<
    HTMLButtonElement,
    {
      icon: React.ReactNode;
      label: string;
      onClick: () => void;
      active?: boolean;
      variant?: 'ghost' | 'secondary';
      toolId?: string;
    }
  >(({ icon, label, onClick, active, variant = 'ghost', toolId }, ref) => {
    // Check visibility if toolId provided
    if (toolId && !isToolVisible(toolId)) return null;
    if (toolId && isToolInOverflow(toolId) && !isMobile) return null;
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={ref}
            variant={active ? 'secondary' : variant}
            size="icon"
            className="h-8 w-8 sm:h-8 sm:w-8"
            onClick={onClick}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    );
  });
  ToolButton.displayName = 'ToolButton';

  // Get overflow items for menu
  const getOverflowItems = () => {
    const items: { id: string; label: string; icon: React.ReactNode; onClick: () => void; active?: boolean }[] = [];
    
    toolSettings.filter(t => t.visible && t.inOverflow).forEach(tool => {
      switch (tool.id) {
        case 'orbit':
          items.push({ id: tool.id, label: 'Orbit (rotera)', icon: <RotateCcw className="h-4 w-4" />, onClick: () => handleNavModeChange('orbit'), active: navMode === 'orbit' });
          break;
        case 'firstPerson':
          items.push({ id: tool.id, label: 'Första person', icon: <Move className="h-4 w-4" />, onClick: () => handleNavModeChange('firstPerson'), active: navMode === 'firstPerson' });
          break;
        case 'select':
          items.push({ id: tool.id, label: 'Välj objekt', icon: <MousePointer2 className="h-4 w-4" />, onClick: () => handleToolChange('select'), active: activeTool === 'select' });
          break;
        case 'measure':
          items.push({ id: tool.id, label: 'Mätverktyg', icon: <Ruler className="h-4 w-4" />, onClick: () => handleToolChange('measure'), active: activeTool === 'measure' });
          break;
        case 'slicer':
          items.push({ id: tool.id, label: 'Snittplan', icon: <Scissors className="h-4 w-4" />, onClick: () => handleToolChange('slicer'), active: activeTool === 'slicer' });
          break;
        case 'xray':
          items.push({ id: tool.id, label: 'X-ray läge', icon: <Eye className="h-4 w-4" />, onClick: handleToggleXray });
          break;
        case 'spaces':
          items.push({ id: tool.id, label: showSpaces ? 'Dölj rum' : 'Visa rum', icon: <Layers className="h-4 w-4" />, onClick: handleToggleSpaces, active: showSpaces });
          break;
        case 'navCube':
          items.push({ id: tool.id, label: showNavCube ? 'Dölj kub' : 'Visa kub', icon: <Box className="h-4 w-4" />, onClick: handleToggleNavCube, active: showNavCube });
          break;
        case 'minimap':
          items.push({ id: tool.id, label: showMinimap ? 'Dölj minimap' : 'Visa minimap', icon: <Map className="h-4 w-4" />, onClick: handleToggleMinimap, active: showMinimap });
          break;
        case 'annotations':
          items.push({ id: tool.id, label: showAnnotations ? 'Dölj annotationer' : 'Visa annotationer', icon: <MessageSquare className="h-4 w-4" />, onClick: handleToggleAnnotations, active: showAnnotations });
          break;
        case 'objectInfo':
          items.push({ id: tool.id, label: 'Objektinfo (Asset+)', icon: <Search className="h-4 w-4" />, onClick: handleShowObjectDetails });
          break;
        case 'properties':
          if (onShowProperties) {
            items.push({ id: tool.id, label: 'Egenskaper (Lovable)', icon: <Info className="h-4 w-4" />, onClick: onShowProperties });
          }
          break;
        case 'addAsset':
          if (onPickCoordinate) {
            items.push({ id: tool.id, label: isPickMode ? 'Avbryt registrering' : 'Registrera tillgång', icon: <Plus className="h-4 w-4" />, onClick: onPickCoordinate, active: isPickMode });
          }
          break;
        case 'treeView':
          if (onToggleTreeView) {
            items.push({ id: tool.id, label: showTreeView ? 'Dölj modellträd' : 'Visa modellträd', icon: <TreeDeciduous className="h-4 w-4" />, onClick: handleToggleTreeView, active: showTreeView });
          }
          break;
      }
    });
    
    return items;
  };

  // Overflow menu
  const OverflowMenu = () => {
    const items = getOverflowItems();
    if (items.length === 0 && !onOpenSettings) return null;
    
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="w-52 bg-card border shadow-lg z-50">
          {items.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Fler verktyg</DropdownMenuLabel>
              {items.map(item => (
                <DropdownMenuItem 
                  key={item.id}
                  onClick={item.onClick}
                  className={item.active ? 'bg-accent' : ''}
                >
                  {item.icon}
                  <span className="ml-2">{item.label}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          
          {onOpenSettings && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenSettings}>
                <Settings className="h-4 w-4" />
                <span className="ml-2">Anpassa verktygsfält...</span>
              </DropdownMenuItem>
            </>
          )}
          
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsExpanded(false)}>
            <ChevronDown className="h-4 w-4" />
            <span className="ml-2">Dölj verktygsfält</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Mobile toolbar: compact primary + overflow
  if (isMobile) {
    return (
      <TooltipProvider delayDuration={300}>
        <div className={cn(
          "absolute bottom-3 left-1/2 -translate-x-1/2 z-20",
          "flex items-center gap-1 p-1.5 rounded-lg",
          "bg-card/95 backdrop-blur-sm border shadow-lg",
          className
        )}>
          <ToolButton
            icon={<ZoomIn className="h-4 w-4" />}
            label="Zooma in"
            onClick={handleZoomIn}
            toolId="zoomIn"
          />
          <ToolButton
            icon={<ZoomOut className="h-4 w-4" />}
            label="Zooma ut"
            onClick={handleZoomOut}
            toolId="zoomOut"
          />
          <ToolButton
            icon={<Focus className="h-4 w-4" />}
            label="Anpassa vy"
            onClick={handleViewFit}
            toolId="viewFit"
          />
          
          <Separator orientation="vertical" className="h-5 mx-0.5" />
          
          <ToolButton
            icon={<MousePointer2 className="h-4 w-4" />}
            label="Välj objekt (CTRL för multi-select)"
            onClick={() => handleToolChange('select')}
            active={activeTool === 'select'}
            toolId="select"
          />
          
          <ToolButton
            icon={viewMode === '3d' ? <Cuboid className="h-4 w-4" /> : <SquareDashed className="h-4 w-4" />}
            label={viewMode === '3d' ? 'Byt till 2D' : 'Byt till 3D'}
            onClick={() => handleViewModeChange(viewMode === '3d' ? '2d' : '3d')}
            active={viewMode === '2d'}
            toolId="viewMode"
          />
          
          <Separator orientation="vertical" className="h-5 mx-0.5" />
          
          <OverflowMenu />
        </div>
      </TooltipProvider>
    );
  }

  // Desktop: Full toolbar with configurable visibility
  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 z-20",
        "flex items-center gap-1 p-1.5 rounded-lg",
        "bg-card/95 backdrop-blur-sm border shadow-lg",
        className
      )}>
        {/* Navigation Group */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<RotateCcw className="h-4 w-4" />}
            label="Orbit (rotera)"
            onClick={() => handleNavModeChange('orbit')}
            active={navMode === 'orbit'}
            toolId="orbit"
          />
          <ToolButton
            icon={<Move className="h-4 w-4" />}
            label="Första person (gå)"
            onClick={() => handleNavModeChange('firstPerson')}
            active={navMode === 'firstPerson'}
            toolId="firstPerson"
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Zoom Group */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<ZoomIn className="h-4 w-4" />}
            label="Zooma in"
            onClick={handleZoomIn}
            toolId="zoomIn"
          />
          <ToolButton
            icon={<ZoomOut className="h-4 w-4" />}
            label="Zooma ut"
            onClick={handleZoomOut}
            toolId="zoomOut"
          />
          <ToolButton
            icon={<Focus className="h-4 w-4" />}
            label="Anpassa vy"
            onClick={handleViewFit}
            toolId="viewFit"
          />
          <ToolButton
            icon={<Maximize className="h-4 w-4" />}
            label="Återställ vy"
            onClick={handleResetView}
            toolId="resetView"
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Tools Group */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<MousePointer2 className="h-4 w-4" />}
            label="Välj objekt (CTRL för multi-select)"
            onClick={() => handleToolChange('select')}
            active={activeTool === 'select'}
            toolId="select"
          />
          <ToolButton
            icon={<Ruler className="h-4 w-4" />}
            label="Mätverktyg"
            onClick={() => handleToolChange('measure')}
            active={activeTool === 'measure'}
            toolId="measure"
          />
          <ToolButton
            icon={<Scissors className="h-4 w-4" />}
            label="Snittplan"
            onClick={() => handleToolChange('slicer')}
            active={activeTool === 'slicer'}
            toolId="slicer"
          />
          {activeTool === 'slicer' && (
            <ToolButton
              icon={<RotateCcw className="h-3 w-3" />}
              label="Rensa snitt"
              onClick={handleClearSlices}
            />
          )}
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* View Mode: 3D/2D toggle */}
        <ToolButton
          icon={viewMode === '3d' ? <SquareDashed className="h-4 w-4" /> : <Cuboid className="h-4 w-4" />}
          label={viewMode === '3d' ? '2D' : '3D'}
          onClick={() => handleViewModeChange(viewMode === '3d' ? '2d' : '3d')}
          active={viewMode === '2d'}
          toolId="viewMode"
        />

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* View Options */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<Eye className="h-4 w-4" />}
            label="X-ray läge"
            onClick={handleToggleXray}
            toolId="xray"
          />
          <ToolButton
            icon={<Layers className="h-4 w-4" />}
            label="Visa/dölj rum"
            onClick={handleToggleSpaces}
            active={showSpaces}
            toolId="spaces"
          />
          <ToolButton
            icon={<Box className="h-4 w-4" />}
            label="Visa/dölj navigeringskub"
            onClick={handleToggleNavCube}
            active={showNavCube}
            toolId="navCube"
          />
          <ToolButton
            icon={<Map className="h-4 w-4" />}
            label="Visa/dölj minimap"
            onClick={handleToggleMinimap}
            active={showMinimap}
            toolId="minimap"
          />
          <ToolButton
            icon={<MessageSquare className="h-4 w-4" />}
            label="Visa/dölj annotationer"
            onClick={handleToggleAnnotations}
            active={showAnnotations}
            toolId="annotations"
          />
          {onToggleTreeView && (
            <ToolButton
              icon={<TreeDeciduous className="h-4 w-4" />}
              label="Visa/dölj modellträd"
              onClick={handleToggleTreeView}
              active={showTreeView}
              toolId="treeView"
            />
          )}
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Object Info & Properties */}
        <ToolButton
          icon={<Search className="h-4 w-4" />}
          label="Objektinfo (Asset+)"
          onClick={handleShowObjectDetails}
          toolId="objectInfo"
        />
        
        {onShowProperties && (
          <ToolButton
            icon={<Info className="h-4 w-4" />}
            label="Egenskaper (Lovable)"
            onClick={onShowProperties}
            toolId="properties"
          />
        )}

        {/* Add Asset (Pick Coordinate) */}
        {onPickCoordinate && (
          <ToolButton
            icon={<Plus className="h-4 w-4" />}
            label={isPickMode ? 'Avbryt registrering' : 'Registrera tillgång (klicka i 3D)'}
            onClick={onPickCoordinate}
            active={isPickMode}
            toolId="addAsset"
          />
        )}

        {/* Overflow menu */}
        <OverflowMenu />
      </div>
    </TooltipProvider>
  );
};

export default ViewerToolbar;
