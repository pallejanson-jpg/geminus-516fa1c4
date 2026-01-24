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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface ViewerToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  onToggleNavCube?: (visible: boolean) => void;
  onToggleMinimap?: (visible: boolean) => void;
  className?: string;
}

type ViewerTool = 'select' | 'measure' | 'slicer' | null;
type NavMode = 'orbit' | 'firstPerson' | 'planView';
type ViewMode = '3d' | '2d';

/**
 * Custom toolbar for the Asset+ 3D Viewer
 * Centered at the bottom with all viewer controls
 */
const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ viewerRef, onToggleNavCube, onToggleMinimap, className }) => {
  const [activeTool, setActiveTool] = useState<ViewerTool>('select');
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [showSpaces, setShowSpaces] = useState(true);
  const [showNavCube, setShowNavCube] = useState(true);
  const [showMinimap, setShowMinimap] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

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
      // Move eye 20% closer to look point
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
      // Move eye 25% further from look point
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

  // Tools
  const handleToolChange = useCallback((tool: ViewerTool) => {
    const assetView = getAssetView();
    if (assetView) {
      assetView.useTool(tool);
      setActiveTool(tool);
    }
  }, [getAssetView]);

  // View modes
  const handleToggleSpaces = useCallback(() => {
    const viewer = viewerRef.current?.assetViewer;
    if (viewer) {
      const newValue = !showSpaces;
      viewer.onShowSpacesChanged?.(newValue);
      setShowSpaces(newValue);
    }
  }, [viewerRef, showSpaces]);

  const handleToggleNavCube = useCallback(() => {
    const newValue = !showNavCube;
    setShowNavCube(newValue);
    onToggleNavCube?.(newValue);
    
    // Toggle visibility via CSS
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

  // Switch between 3D and 2D (top-down) view
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    const viewer = getXeokitViewer();
    if (!viewer) return;

    setViewMode(mode);
    
    if (mode === '2d') {
      // Switch to top-down orthographic view
      const camera = viewer.camera;
      const scene = viewer.scene;
      const aabb = scene?.getAABB?.();
      
      if (camera && aabb) {
        // Calculate center and extent
        const centerX = (aabb[0] + aabb[3]) / 2;
        const centerY = (aabb[1] + aabb[4]) / 2;
        const centerZ = (aabb[2] + aabb[5]) / 2;
        const height = Math.max(aabb[3] - aabb[0], aabb[5] - aabb[2]) * 1.5;
        
        // Set camera to look straight down
        viewer.cameraFlight.flyTo({
          eye: [centerX, centerY + height, centerZ],
          look: [centerX, centerY, centerZ],
          up: [0, 0, -1],
          duration: 0.5,
          orthoScale: height
        });
        
        // Switch to orthographic projection
        camera.projection = 'ortho';
      }
    } else {
      // Switch back to 3D perspective view
      const camera = viewer.camera;
      if (camera) {
        camera.projection = 'perspective';
        
        // Reset to orbit view
        const assetView = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
        if (assetView) {
          assetView.viewFit(undefined, true);
        }
      }
    }
  }, [getXeokitViewer, viewerRef]);

  const handleToggleXray = useCallback(() => {
    const viewer = getXeokitViewer();
    if (viewer?.scene) {
      const scene = viewer.scene;
      // Toggle X-ray on all objects
      const objectIds = Object.keys(scene.objects);
      const firstObj = scene.objects[objectIds[0]];
      const newXray = !firstObj?.xrayed;
      objectIds.forEach(id => {
        const obj = scene.objects[id];
        if (obj) obj.xrayed = newXray;
      });
    }
  }, [getXeokitViewer]);

  const handleClearSlices = useCallback(() => {
    const assetView = getAssetView();
    if (assetView) {
      assetView.clearSlices?.();
    }
  }, [getAssetView]);

  // Show object details
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
          Visa verktygsfält
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn(
        "absolute bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 z-20",
        "flex items-center gap-0.5 sm:gap-1 p-1 sm:p-1.5 rounded-lg",
        "bg-card/95 backdrop-blur-sm border shadow-lg",
        "max-w-[95vw] overflow-x-auto",
        className
      )}>
        {/* Navigation Group */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={navMode === 'orbit' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={() => handleNavModeChange('orbit')}
              >
                <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Orbit (rotera)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={navMode === 'firstPerson' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={() => handleNavModeChange('firstPerson')}
              >
                <Move className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Första person (gå)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={navMode === 'planView' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={() => handleNavModeChange('planView')}
              >
                <Grid3X3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Planvy</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-5 sm:h-6 mx-0.5 sm:mx-1 flex-shrink-0" />

        {/* Zoom Group */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={handleZoomIn}
              >
                <ZoomIn className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Zooma in</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={handleZoomOut}
              >
                <ZoomOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Zooma ut</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={handleViewFit}
              >
                <Focus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Anpassa vy</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={handleResetView}
              >
                <Maximize className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Återställ vy</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-5 sm:h-6 mx-0.5 sm:mx-1 flex-shrink-0" />

        {/* Tools Group */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTool === 'select' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={() => handleToolChange('select')}
              >
                <Crosshair className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Välj objekt</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTool === 'measure' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={() => handleToolChange('measure')}
              >
                <Ruler className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Mätverktyg</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTool === 'slicer' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={() => handleToolChange('slicer')}
              >
                <Scissors className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Snittplan</TooltipContent>
          </Tooltip>

          {activeTool === 'slicer' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8"
                  onClick={handleClearSlices}
                >
                  <RotateCcw className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Rensa snitt</TooltipContent>
            </Tooltip>
          )}
        </div>

        <Separator orientation="vertical" className="h-5 sm:h-6 mx-0.5 sm:mx-1 flex-shrink-0" />

        {/* View Mode: 3D/2D */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === '3d' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={() => handleViewModeChange('3d')}
              >
                <Cuboid className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">3D-vy</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === '2d' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={() => handleViewModeChange('2d')}
              >
                <SquareDashed className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">2D-vy (toppvy)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-5 sm:h-6 mx-0.5 sm:mx-1 flex-shrink-0" />

        {/* View Options */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={handleToggleXray}
              >
                <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">X-ray läge</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showSpaces ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={handleToggleSpaces}
              >
                <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Visa/dölj rum</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showNavCube ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={handleToggleNavCube}
              >
                <Box className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Visa/dölj navigeringskub</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showMinimap ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={handleToggleMinimap}
              >
                <Map className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Visa/dölj minimap</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-5 sm:h-6 mx-0.5 sm:mx-1 flex-shrink-0" />

        {/* Object Info */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 sm:h-8 sm:w-8"
              onClick={handleShowObjectDetails}
            >
              <Search className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Objektinfo</TooltipContent>
        </Tooltip>

        {/* Collapse button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 sm:h-8 sm:w-8 ml-0.5 sm:ml-1"
              onClick={() => setIsExpanded(false)}
            >
              <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Dölj verktygsfält</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};

export default ViewerToolbar;
