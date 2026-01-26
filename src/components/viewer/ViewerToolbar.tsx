import React, { useState, useCallback } from 'react';
import {
  Move,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize,
  Box,
  Eye,
  Ruler,
  Search,
  Layers,
  Focus,
  Scissors,
  Crosshair,
  Grid3X3,
  ChevronUp,
  ChevronDown,
  Cuboid,
  SquareDashed,
  Map,
  MoreHorizontal,
  MessageSquare,
  Plus,
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

interface ViewerToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  onToggleNavCube?: (visible: boolean) => void;
  onToggleMinimap?: (visible: boolean) => void;
  onPickCoordinate?: () => void;
  isPickMode?: boolean;
  className?: string;
}

type ViewerTool = 'select' | 'measure' | 'slicer' | null;
type NavMode = 'orbit' | 'firstPerson' | 'planView';
type ViewMode = '3d' | '2d';

/**
 * Custom toolbar for the Asset+ 3D Viewer
 * Mobile-optimized with 4 primary tools + overflow menu
 */
const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ viewerRef, onToggleNavCube, onToggleMinimap, onPickCoordinate, isPickMode, className }) => {
  const [activeTool, setActiveTool] = useState<ViewerTool>('select');
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [showSpaces, setShowSpaces] = useState(true);
  const [showNavCube, setShowNavCube] = useState(true);
  const [showMinimap, setShowMinimap] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  
  const isMobile = useIsMobile();

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

  // Tools - with null safety to prevent 'e.nextSibling' errors
  const handleToolChange = useCallback((tool: ViewerTool) => {
    try {
      const assetView = getAssetView();
      if (assetView && typeof assetView.useTool === 'function') {
        assetView.useTool(tool);
        setActiveTool(tool);
      } else {
        console.warn('AssetView not ready for tool change');
      }
    } catch (error) {
      console.warn('Tool change failed:', error);
    }
  }, [getAssetView]);

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

  const handleToggleNavCube = useCallback(() => {
    const newValue = !showNavCube;
    setShowNavCube(newValue);
    onToggleNavCube?.(newValue);
    
    const navCubeCanvas = document.getElementById('navCubeCanvas');
    if (navCubeCanvas) {
      navCubeCanvas.style.display = newValue ? 'block' : 'none';
    }
  }, [showNavCube, onToggleNavCube]);

  const handleToggleMinimap = useCallback(() => {
    const newValue = !showMinimap;
    setShowMinimap(newValue);
    onToggleMinimap?.(newValue);
  }, [showMinimap, onToggleMinimap]);

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
    }
  >(({ icon, label, onClick, active, variant = 'ghost' }, ref) => (
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
  ));
  ToolButton.displayName = 'ToolButton';

  // Mobile overflow menu items
  const MobileOverflowMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" side="top" className="w-48 bg-card border shadow-lg z-50">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Navigering</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => handleNavModeChange('orbit')} className={navMode === 'orbit' ? 'bg-accent' : ''}>
          <RotateCcw className="h-4 w-4 mr-2" /> Orbit (rotera)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleNavModeChange('firstPerson')} className={navMode === 'firstPerson' ? 'bg-accent' : ''}>
          <Move className="h-4 w-4 mr-2" /> Första person
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Verktyg</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => handleToolChange('select')} className={activeTool === 'select' ? 'bg-accent' : ''}>
          <Crosshair className="h-4 w-4 mr-2" /> Välj objekt
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleToolChange('measure')} className={activeTool === 'measure' ? 'bg-accent' : ''}>
          <Ruler className="h-4 w-4 mr-2" /> Mätverktyg
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleToolChange('slicer')} className={activeTool === 'slicer' ? 'bg-accent' : ''}>
          <Scissors className="h-4 w-4 mr-2" /> Snittplan
        </DropdownMenuItem>
        {activeTool === 'slicer' && (
          <DropdownMenuItem onClick={handleClearSlices}>
            <RotateCcw className="h-4 w-4 mr-2" /> Rensa snitt
          </DropdownMenuItem>
        )}
        
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Visning</DropdownMenuLabel>
        <DropdownMenuItem onClick={handleToggleXray}>
          <Eye className="h-4 w-4 mr-2" /> X-ray läge
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggleSpaces} className={showSpaces ? 'bg-accent' : ''}>
          <Layers className="h-4 w-4 mr-2" /> {showSpaces ? 'Dölj rum' : 'Visa rum'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggleNavCube} className={showNavCube ? 'bg-accent' : ''}>
          <Box className="h-4 w-4 mr-2" /> {showNavCube ? 'Dölj kub' : 'Visa kub'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggleMinimap} className={showMinimap ? 'bg-accent' : ''}>
          <Map className="h-4 w-4 mr-2" /> {showMinimap ? 'Dölj minimap' : 'Visa minimap'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggleAnnotations} className={showAnnotations ? 'bg-accent' : ''}>
          <MessageSquare className="h-4 w-4 mr-2" /> {showAnnotations ? 'Dölj annotationer' : 'Visa annotationer'}
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleShowObjectDetails}>
          <Search className="h-4 w-4 mr-2" /> Objektinfo
        </DropdownMenuItem>
        {onPickCoordinate && (
          <DropdownMenuItem onClick={onPickCoordinate} className={isPickMode ? 'bg-accent' : ''}>
            <Plus className="h-4 w-4 mr-2" /> {isPickMode ? 'Avbryt registrering' : 'Registrera tillgång'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setIsExpanded(false)}>
          <ChevronDown className="h-4 w-4 mr-2" /> Dölj verktygsfält
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Mobile toolbar: 4 primary + overflow
  if (isMobile) {
    return (
      <TooltipProvider delayDuration={300}>
        <div className={cn(
          "absolute bottom-3 left-1/2 -translate-x-1/2 z-20",
          "flex items-center gap-1 p-1.5 rounded-lg",
          "bg-card/95 backdrop-blur-sm border shadow-lg",
          className
        )}>
          {/* Primary tools: Zoom, Fit, 3D/2D toggle, Overflow */}
          <ToolButton
            icon={<ZoomIn className="h-4 w-4" />}
            label="Zooma in"
            onClick={handleZoomIn}
          />
          <ToolButton
            icon={<ZoomOut className="h-4 w-4" />}
            label="Zooma ut"
            onClick={handleZoomOut}
          />
          <ToolButton
            icon={<Focus className="h-4 w-4" />}
            label="Anpassa vy"
            onClick={handleViewFit}
          />
          
          <Separator orientation="vertical" className="h-5 mx-0.5" />
          
          <ToolButton
            icon={viewMode === '3d' ? <Cuboid className="h-4 w-4" /> : <SquareDashed className="h-4 w-4" />}
            label={viewMode === '3d' ? 'Byt till 2D' : 'Byt till 3D'}
            onClick={() => handleViewModeChange(viewMode === '3d' ? '2d' : '3d')}
            active={viewMode === '2d'}
          />
          
          <Separator orientation="vertical" className="h-5 mx-0.5" />
          
          <MobileOverflowMenu />
        </div>
      </TooltipProvider>
    );
  }

  // Desktop: Full toolbar
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
          />
          <ToolButton
            icon={<Move className="h-4 w-4" />}
            label="Första person (gå)"
            onClick={() => handleNavModeChange('firstPerson')}
            active={navMode === 'firstPerson'}
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Zoom Group */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<ZoomIn className="h-4 w-4" />}
            label="Zooma in"
            onClick={handleZoomIn}
          />
          <ToolButton
            icon={<ZoomOut className="h-4 w-4" />}
            label="Zooma ut"
            onClick={handleZoomOut}
          />
          <ToolButton
            icon={<Focus className="h-4 w-4" />}
            label="Anpassa vy"
            onClick={handleViewFit}
          />
          <ToolButton
            icon={<Maximize className="h-4 w-4" />}
            label="Återställ vy"
            onClick={handleResetView}
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Tools Group */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<Crosshair className="h-4 w-4" />}
            label="Välj objekt"
            onClick={() => handleToolChange('select')}
            active={activeTool === 'select'}
          />
          <ToolButton
            icon={<Ruler className="h-4 w-4" />}
            label="Mätverktyg"
            onClick={() => handleToolChange('measure')}
            active={activeTool === 'measure'}
          />
          <ToolButton
            icon={<Scissors className="h-4 w-4" />}
            label="Snittplan"
            onClick={() => handleToolChange('slicer')}
            active={activeTool === 'slicer'}
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
        />

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* View Options */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={<Eye className="h-4 w-4" />}
            label="X-ray läge"
            onClick={handleToggleXray}
          />
          <ToolButton
            icon={<Layers className="h-4 w-4" />}
            label="Visa/dölj rum"
            onClick={handleToggleSpaces}
            active={showSpaces}
          />
          <ToolButton
            icon={<Box className="h-4 w-4" />}
            label="Visa/dölj navigeringskub"
            onClick={handleToggleNavCube}
            active={showNavCube}
          />
          <ToolButton
            icon={<Map className="h-4 w-4" />}
            label="Visa/dölj minimap"
            onClick={handleToggleMinimap}
            active={showMinimap}
          />
          <ToolButton
            icon={<MessageSquare className="h-4 w-4" />}
            label="Visa/dölj annotationer"
            onClick={handleToggleAnnotations}
            active={showAnnotations}
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Object Info */}
        <ToolButton
          icon={<Search className="h-4 w-4" />}
          label="Objektinfo"
          onClick={handleShowObjectDetails}
        />

        {/* Add Asset (Pick Coordinate) */}
        {onPickCoordinate && (
          <ToolButton
            icon={<Plus className="h-4 w-4" />}
            label={isPickMode ? 'Avbryt registrering' : 'Registrera tillgång (klicka i 3D)'}
            onClick={onPickCoordinate}
            active={isPickMode}
          />
        )}

        {/* Collapse button */}
        <ToolButton
          icon={<ChevronDown className="h-4 w-4" />}
          label="Dölj verktygsfält"
          onClick={() => setIsExpanded(false)}
        />
      </div>
    </TooltipProvider>
  );
};

export default ViewerToolbar;
