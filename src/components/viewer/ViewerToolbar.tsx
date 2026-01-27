import React, { useState, useCallback, useEffect } from 'react';
import {
  Move,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize,
  Ruler,
  Focus,
  Scissors,
  MousePointer2,
  ChevronUp,
  ChevronDown,
  Cuboid,
  SquareDashed,
  MoreHorizontal,
  Settings,
  Sparkles,
  Hand,
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
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { getNavigationToolSettings, ToolConfig, TOOLBAR_SETTINGS_CHANGED_EVENT } from './ToolbarSettings';

interface ViewerToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  onOpenSettings?: () => void;
  flashOnSelectEnabled?: boolean;
  onToggleFlashOnSelect?: (enabled: boolean) => void;
  hoverHighlightEnabled?: boolean;
  onToggleHoverHighlight?: (enabled: boolean) => void;
  className?: string;
}

type ViewerTool = 'select' | 'measure' | 'slicer' | null;
type NavMode = 'orbit' | 'firstPerson' | 'planView';
type ViewMode = '3d' | '2d';

/**
 * Navigation-focused toolbar for the Asset+ 3D Viewer
 * Contains only navigation, zoom, and basic interaction tools
 * Visualization tools are in VisualizationToolbar (right side)
 */
const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  viewerRef,
  onOpenSettings,
  flashOnSelectEnabled = true,
  onToggleFlashOnSelect,
  hoverHighlightEnabled = false,
  onToggleHoverHighlight,
  className
}) => {
  const [activeTool, setActiveTool] = useState<ViewerTool>('select');
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [isExpanded, setIsExpanded] = useState(true);
  const [toolSettings, setToolSettings] = useState<ToolConfig[]>(getNavigationToolSettings());
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const isMobile = useIsMobile();

  // Reload settings when they change (both cross-tab and same-tab)
  useEffect(() => {
    const handleSettingsChange = () => {
      setToolSettings(getNavigationToolSettings());
    };
    // Listen for storage events (cross-tab)
    window.addEventListener('storage', handleSettingsChange);
    // Listen for custom event (same-tab)
    window.addEventListener(TOOLBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    return () => {
      window.removeEventListener('storage', handleSettingsChange);
      window.removeEventListener(TOOLBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    };
  }, []);

  // Get AssetView reference with safety checks
  const getAssetView = useCallback(() => {
    try {
      const assetView = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
      if (!assetView) {
        console.debug('AssetView not available');
      }
      return assetView;
    } catch (e) {
      console.debug('getAssetView error:', e);
      return null;
    }
  }, [viewerRef]);

  const getXeokitViewer = useCallback(() => {
    try {
      return getAssetView()?.viewer;
    } catch (e) {
      console.debug('getXeokitViewer error:', e);
      return null;
    }
  }, [getAssetView]);

  // Track viewer readiness
  useEffect(() => {
    const checkReady = () => {
      const viewer = getXeokitViewer();
      const ready = !!viewer?.scene;
      setIsViewerReady(ready);
      if (!ready) {
        // Reset tool state if viewer becomes unavailable
        setActiveTool('select');
      }
    };
    
    // Check immediately and after delays
    checkReady();
    const t1 = setTimeout(checkReady, 200);
    const t2 = setTimeout(checkReady, 500);
    const t3 = setTimeout(checkReady, 1000);
    
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [getXeokitViewer]);

  // Navigation controls with readiness check
  const handleResetView = useCallback(() => {
    if (!isViewerReady || isProcessing) return;
    
    const assetView = getAssetView();
    if (assetView) {
      assetView.viewFit(undefined, true);
    }
  }, [getAssetView, isViewerReady, isProcessing]);

  const handleZoomIn = useCallback(() => {
    if (!isViewerReady || isProcessing) return;
    
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
  }, [getXeokitViewer, isViewerReady, isProcessing]);

  const handleZoomOut = useCallback(() => {
    if (!isViewerReady || isProcessing) return;
    
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
  }, [getXeokitViewer, isViewerReady, isProcessing]);

  const handleViewFit = useCallback(() => {
    if (!isViewerReady || isProcessing) return;
    
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
  }, [viewerRef, isViewerReady, isProcessing]);

  // Navigation mode with debounce
  const handleNavModeChange = useCallback((mode: NavMode) => {
    if (!isViewerReady || isProcessing) return;
    
    const assetView = getAssetView();
    if (assetView) {
      assetView.setNavMode(mode);
      setNavMode(mode);
    }
  }, [getAssetView, isViewerReady, isProcessing]);

  // Tools - with proper state cleanup and debounce to prevent tool "sticking"
  const handleToolChange = useCallback((tool: ViewerTool) => {
    if (!isViewerReady || isProcessing) {
      console.debug('Viewer not ready for tool change');
      return;
    }
    
    setIsProcessing(true);
    
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
      // Reset to safe state
      setActiveTool('select');
    } finally {
      // Debounce - prevent rapid clicks
      setTimeout(() => setIsProcessing(false), 100);
    }
  }, [getAssetView, activeTool, isViewerReady, isProcessing]);

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

  const handleClearSlices = useCallback(() => {
    const assetView = getAssetView();
    if (assetView) {
      assetView.clearSlices?.();
    }
  }, [getAssetView]);

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

  // ToolButton with forwardRef to avoid React warning and viewer readiness check
  const ToolButton = React.forwardRef<
    HTMLButtonElement,
    {
      icon: React.ReactNode;
      label: string;
      onClick: () => void;
      active?: boolean;
      variant?: 'ghost' | 'secondary';
      toolId?: string;
      disabled?: boolean;
    }
  >(({ icon, label, onClick, active, variant = 'ghost', toolId, disabled }, ref) => {
    // Check visibility if toolId provided
    if (toolId && !isToolVisible(toolId)) return null;
    if (toolId && isToolInOverflow(toolId) && !isMobile) return null;
    
    const isDisabled = disabled || !isViewerReady || isProcessing;
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={ref}
            variant={active ? 'secondary' : variant}
            size="icon"
            className={cn(
              "h-8 w-8 sm:h-8 sm:w-8",
              isDisabled && "opacity-50 cursor-not-allowed"
            )}
            onClick={isDisabled ? undefined : onClick}
            disabled={isDisabled}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {isDisabled && !isViewerReady ? 'Väntar på viewer...' : label}
        </TooltipContent>
      </Tooltip>
    );
  });
  ToolButton.displayName = 'ToolButton';

  // Get overflow items for menu (navigation tools only - flash/hover shown as direct buttons)
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
        case 'zoomIn':
          items.push({ id: tool.id, label: 'Zooma in', icon: <ZoomIn className="h-4 w-4" />, onClick: handleZoomIn });
          break;
        case 'zoomOut':
          items.push({ id: tool.id, label: 'Zooma ut', icon: <ZoomOut className="h-4 w-4" />, onClick: handleZoomOut });
          break;
        case 'viewFit':
          items.push({ id: tool.id, label: 'Anpassa vy', icon: <Focus className="h-4 w-4" />, onClick: handleViewFit });
          break;
        case 'resetView':
          items.push({ id: tool.id, label: 'Återställ vy', icon: <Maximize className="h-4 w-4" />, onClick: handleResetView });
          break;
        case 'viewMode':
          items.push({ 
            id: tool.id, 
            label: viewMode === '3d' ? '2D-vy' : '3D-vy', 
            icon: viewMode === '3d' ? <SquareDashed className="h-4 w-4" /> : <Cuboid className="h-4 w-4" />, 
            onClick: () => handleViewModeChange(viewMode === '3d' ? '2d' : '3d'),
            active: viewMode === '2d'
          });
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

  // Desktop: Navigation-focused toolbar
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

        {/* View & Annotations Group */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            icon={viewMode === '3d' ? <SquareDashed className="h-4 w-4" /> : <Cuboid className="h-4 w-4" />}
            label={viewMode === '3d' ? '2D' : '3D'}
            onClick={() => handleViewModeChange(viewMode === '3d' ? '2d' : '3d')}
            active={viewMode === '2d'}
            toolId="viewMode"
          />
          {/* Flash and Hover toggles as buttons in main toolbar */}
          {isToolVisible('flashOnSelect') && !isToolInOverflow('flashOnSelect') && onToggleFlashOnSelect && (
            <ToolButton
              icon={<Sparkles className="h-4 w-4" />}
              label={flashOnSelectEnabled ? 'Flash vid markering (på)' : 'Flash vid markering (av)'}
              onClick={() => onToggleFlashOnSelect(!flashOnSelectEnabled)}
              active={flashOnSelectEnabled}
            />
          )}
          {isToolVisible('hoverHighlight') && !isToolInOverflow('hoverHighlight') && onToggleHoverHighlight && (
            <ToolButton
              icon={<Hand className="h-4 w-4" />}
              label={hoverHighlightEnabled ? 'Hover-highlight (på)' : 'Hover-highlight (av)'}
              onClick={() => onToggleHoverHighlight(!hoverHighlightEnabled)}
              active={hoverHighlightEnabled}
            />
          )}
        </div>

        {/* Overflow menu */}
        <OverflowMenu />
      </div>
    </TooltipProvider>
  );
};

export default ViewerToolbar;
