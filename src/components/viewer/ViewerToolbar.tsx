import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  Box,
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
import { 
  useSectionPlaneClipping, 
  FLOOR_SELECTION_CHANGED_EVENT, 
  VIEW_MODE_CHANGED_EVENT,
  CLIP_HEIGHT_CHANGED_EVENT,
  FloorSelectionEventDetail,
  ClipHeightEventDetail
} from '@/hooks/useSectionPlaneClipping';
import { VIEW_MODE_REQUESTED_EVENT, ViewModeRequestedDetail, VIEWER_TOOL_CHANGED_EVENT, type ViewerToolChangedDetail } from '@/lib/viewer-events';

interface ViewerToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  onOpenSettings?: () => void;
  flashOnSelectEnabled?: boolean;
  onToggleFlashOnSelect?: (enabled: boolean) => void;
  hoverHighlightEnabled?: boolean;
  onToggleHoverHighlight?: (enabled: boolean) => void;
  className?: string;
  /** When true, disables the select tool as default (for pick-mode navigation) */
  disableSelectTool?: boolean;
}

type ViewerTool = 'select' | 'measure' | 'slicer' | null;
type NavMode = 'orbit' | 'firstPerson' | 'planView';
type ViewMode = '3d' | '2d';

/**
 * Navigation-focused toolbar for the Asset+ 3D Viewer
 * Contains only navigation, zoom, and basic interaction tools
 * Visualization tools are in VisualizationToolbar (right side)
 * 
 * 2D mode now includes SectionPlane clipping at floor level (~1.2m above floor)
 * to create a clean floor plan view.
 */
const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  viewerRef,
  onOpenSettings,
  flashOnSelectEnabled = true,
  onToggleFlashOnSelect,
  hoverHighlightEnabled = false,
  onToggleHoverHighlight,
  className,
  disableSelectTool = false
}) => {
  // When disableSelectTool is true, start with no tool active (for pick-mode navigation)
  const [activeTool, setActiveTool] = useState<ViewerTool>(disableSelectTool ? null : 'select');
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [isExpanded, setIsExpanded] = useState(true);
  const [toolSettings, setToolSettings] = useState<ToolConfig[]>(getNavigationToolSettings());
  const [isViewerReady, setIsViewerReady] = useState(false);
  const toolChangeDebounceRef = useRef(false);
  const [currentFloorId, setCurrentFloorId] = useState<string | null>(null);
  const [settingsKey, setSettingsKey] = useState(0); // Force re-render key
  const [currentFloorBounds, setCurrentFloorBounds] = useState<{ minY: number; maxY: number } | null>(null);
  
  const isMobile = useIsMobile();
  
  // Track viewMode in a ref for event handlers
  const viewModeRef = useRef<ViewMode>(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  
  // SectionPlane clipping for 2D floor plan view
  const {
    applyFloorPlanClipping,
    applyGlobalFloorPlanClipping,
    applyCeilingClipping,
    removeSectionPlane,
    remove3DClipping,
    calculateFloorBounds,
    updateFloorCutHeight,
    update3DCeilingOffset
  } = useSectionPlaneClipping(
    viewerRef,
    { enabled: true, clipMode: 'floor', floorCutHeight: 1.2 }
  );

  // Reload settings when they change (both cross-tab and same-tab)
  useEffect(() => {
    const handleSettingsChange = () => {
      // Force complete re-render by updating both settings and key
      const newSettings = getNavigationToolSettings();
      console.log('[ViewerToolbar] Settings changed, overflow tools:', newSettings.filter(t => t.inOverflow).map(t => t.id));
      setToolSettings(newSettings);
      setSettingsKey(prev => prev + 1); // Force re-render
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

  // (isProcessing removed — replaced by per-action toolChangeDebounceRef)

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

  // Listen for floor selection changes from FloorVisibilitySelector
  useEffect(() => {
    const handleFloorChange = (e: CustomEvent<FloorSelectionEventDetail>) => {
      const { floorId, bounds, isAllFloorsVisible, visibleMetaFloorIds } = e.detail;
      setCurrentFloorId(floorId);
      setCurrentFloorBounds(bounds || null);
      
      // Determine if this is a solo floor selection (exactly one floor visible)
      const isSoloFloor = !isAllFloorsVisible && visibleMetaFloorIds && visibleMetaFloorIds.length === 1;
      const soloFloorId = isSoloFloor ? (visibleMetaFloorIds[0] || floorId) : null;
      
      if (viewModeRef.current === '2d') {
        // 2D mode: apply floor plan clipping (slab slice)
        if (floorId) {
          applyFloorPlanClipping(floorId);
        } else {
          // No specific floor selected - apply global clipping at scene base
          const viewer = getXeokitViewer();
          const sceneAABB = viewer?.scene?.getAABB?.();
          if (sceneAABB) {
            const baseHeight = sceneAABB[1]; // minY
            applyGlobalFloorPlanClipping(baseHeight);
          }
        }
      } else {
        // 3D mode: apply ceiling clipping when solo floor is visible
        if (soloFloorId) {
          console.log('[ViewerToolbar] 3D Solo mode - applying ceiling clipping for:', soloFloorId);
          applyCeilingClipping(soloFloorId);
        } else {
          // Multiple or all floors visible - remove 3D ceiling clipping
          console.log('[ViewerToolbar] 3D All floors - removing ceiling clipping');
          remove3DClipping();
        }
      }
    };
    
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
    return () => {
      window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
    };
  }, [applyFloorPlanClipping, applyGlobalFloorPlanClipping, applyCeilingClipping, remove3DClipping, getXeokitViewer]);

  // Listen for clip height changes from VisualizationToolbar slider
  useEffect(() => {
    const handleClipHeightChange = (e: CustomEvent<ClipHeightEventDetail>) => {
      const { height } = e.detail;
      updateFloorCutHeight(height);
    };
    
    window.addEventListener(CLIP_HEIGHT_CHANGED_EVENT, handleClipHeightChange as EventListener);
    return () => {
      window.removeEventListener(CLIP_HEIGHT_CHANGED_EVENT, handleClipHeightChange as EventListener);
    };
  }, [updateFloorCutHeight]);

  // Listen for 3D ceiling clip offset changes from VisualizationToolbar slider
  useEffect(() => {
    const handleClipHeight3DChange = (e: CustomEvent) => {
      const { offset } = e.detail || {};
      if (typeof offset === 'number') {
        update3DCeilingOffset(offset);
      }
    };
    
    // Import the event name from hook
    const CLIP_HEIGHT_3D_CHANGED_EVENT = 'CLIP_HEIGHT_3D_CHANGED';
    window.addEventListener(CLIP_HEIGHT_3D_CHANGED_EVENT, handleClipHeight3DChange as EventListener);
    return () => {
      window.removeEventListener(CLIP_HEIGHT_3D_CHANGED_EVENT, handleClipHeight3DChange as EventListener);
    };
  }, [update3DCeilingOffset]);

  // Listen for view mode requests from VisualizationToolbar (2D/3D switch)
  useEffect(() => {
    const handleViewModeRequest = (e: CustomEvent<ViewModeRequestedDetail>) => {
      const { mode } = e.detail;
      if (mode === '2d' || mode === '3d') {
        handleViewModeChange(mode);
      }
    };
    
    window.addEventListener(VIEW_MODE_REQUESTED_EVENT, handleViewModeRequest as EventListener);
    return () => {
      window.removeEventListener(VIEW_MODE_REQUESTED_EVENT, handleViewModeRequest as EventListener);
    };
  }, []);

  // Navigation controls with readiness check
  const handleResetView = useCallback(() => {
    if (!isViewerReady) return;
    
    const assetView = getAssetView();
    if (assetView) {
      assetView.viewFit(undefined, true);
    }
  }, [getAssetView, isViewerReady]);

  const handleZoomIn = useCallback(() => {
    if (!isViewerReady) return;
    
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
  }, [getXeokitViewer, isViewerReady]);

  const handleZoomOut = useCallback(() => {
    if (!isViewerReady) return;
    
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
  }, [getXeokitViewer, isViewerReady]);

  const handleViewFit = useCallback(() => {
    if (!isViewerReady) return;
    
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
  }, [viewerRef, isViewerReady]);

  // Navigation mode change
  const handleNavModeChange = useCallback((mode: NavMode) => {
    if (!isViewerReady) return;
    
    const assetView = getAssetView();
    if (assetView) {
      assetView.setNavMode(mode);
      setNavMode(mode);
    }
  }, [getAssetView, isViewerReady]);

  // Tools - with proper state cleanup, mutual exclusivity, and per-action debounce
  const handleToolChange = useCallback((tool: ViewerTool) => {
    if (!isViewerReady || toolChangeDebounceRef.current) {
      console.debug('Viewer not ready or debounced for tool change');
      return;
    }
    
    toolChangeDebounceRef.current = true;
    
    let newTool: ViewerTool;
    
    try {
      const assetView = getAssetView();
      if (assetView && typeof assetView.useTool === 'function') {
        // Always deactivate current tool first for clean state
        try {
          assetView.useTool(null);
        } catch (e) {
          console.debug('Tool deactivation:', e);
        }
        
        // Toggle behavior: if clicking the same tool, switch to select
        if (tool === activeTool) {
          assetView.useTool('select');
          newTool = 'select';
        } else {
          // Activate new tool
          assetView.useTool(tool);
          newTool = tool;
        }
        setActiveTool(newTool);
      } else {
        console.warn('AssetView not ready for tool change');
        newTool = activeTool;
      }
    } catch (error) {
      console.warn('Tool change failed:', error);
      // Reset to safe state
      newTool = 'select';
      setActiveTool('select');
    } finally {
      // Dispatch tool changed event for Virtual Twin pointer-events toggle
      window.dispatchEvent(new CustomEvent<ViewerToolChangedDetail>(VIEWER_TOOL_CHANGED_EVENT, {
        detail: { tool: newTool! },
      }));
      // Short debounce only for tool-change (useTool calls)
      setTimeout(() => { toolChangeDebounceRef.current = false; }, 150);
    }
  }, [getAssetView, activeTool, isViewerReady]);

  // Switch between 3D and 2D (top-down) view with SectionPlane clipping
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    const viewer = getXeokitViewer();
    if (!viewer) return;

    setViewMode(mode);
    
    // Emit view mode change event for other components
    window.dispatchEvent(new CustomEvent(VIEW_MODE_CHANGED_EVENT, { 
      detail: { mode, floorId: currentFloorId } 
    }));
    
    if (mode === '2d') {
      const camera = viewer.camera;
      const scene = viewer.scene;
      
      // Use floor bounds if a floor is selected, otherwise use scene bounds
      let targetBounds: number[] | null = null;
      let lookHeight: number;
      
      if (currentFloorId && currentFloorBounds) {
        // Calculate floor-specific bounds from metaScene
        const floorBounds = calculateFloorBounds(currentFloorId);
        if (floorBounds) {
          const floorChildIds = floorBounds.metaObjectIds;
          let minX = Infinity, maxX = -Infinity;
          let minZ = Infinity, maxZ = -Infinity;
          
          floorChildIds.forEach(id => {
            const entity = scene?.objects?.[id];
            if (entity?.aabb) {
              minX = Math.min(minX, entity.aabb[0]);
              maxX = Math.max(maxX, entity.aabb[3]);
              minZ = Math.min(minZ, entity.aabb[2]);
              maxZ = Math.max(maxZ, entity.aabb[5]);
            }
          });
          
          if (minX !== Infinity) {
            targetBounds = [minX, floorBounds.minY, minZ, maxX, floorBounds.maxY, maxZ];
          }
          lookHeight = floorBounds.minY + 1.2; // 1.2m above floor
        }
        
        // Apply floor plan clipping for 2D view
        applyFloorPlanClipping(currentFloorId);
      } else {
        // No specific floor - use scene bounds and apply global clipping
        targetBounds = scene?.getAABB?.();
        lookHeight = targetBounds ? (targetBounds[1] + targetBounds[4]) / 2 : 0;
        
        // Apply global clipping at scene base height
        if (targetBounds) {
          applyGlobalFloorPlanClipping(targetBounds[1]); // minY = base height
        }
      }
      
      if (!targetBounds) {
        targetBounds = scene?.getAABB?.();
      }
      
      if (camera && targetBounds) {
        const centerX = (targetBounds[0] + targetBounds[3]) / 2;
        const centerY = lookHeight || (targetBounds[1] + targetBounds[4]) / 2;
        const centerZ = (targetBounds[2] + targetBounds[5]) / 2;
        const height = Math.max(
          targetBounds[3] - targetBounds[0], 
          targetBounds[5] - targetBounds[2]
        ) * 1.5;
        
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
      // Switching to 3D mode - remove 2D clipping
      removeSectionPlane();
      
      // If a solo floor is selected, apply ceiling clipping for 3D mode
      if (currentFloorId) {
        console.log('[ViewerToolbar] Switching to 3D with solo floor - applying ceiling clipping');
        applyCeilingClipping(currentFloorId);
      }
      
      const camera = viewer.camera;
      if (camera) {
        camera.projection = 'perspective';
        const assetView = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
        if (assetView) {
          assetView.viewFit(undefined, true);
        }
      }
    }
  }, [getXeokitViewer, viewerRef, currentFloorId, currentFloorBounds, calculateFloorBounds, applyFloorPlanClipping, applyGlobalFloorPlanClipping, applyCeilingClipping, removeSectionPlane]);

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

  // Get tool order index from settings
  const getToolOrder = useCallback((toolId: string) => {
    const index = toolSettings.findIndex(t => t.id === toolId);
    return index === -1 ? 999 : index;
  }, [toolSettings]);

  // Get visible main toolbar tools in correct order
  const getOrderedMainTools = useCallback(() => {
    return toolSettings
      .filter(t => t.visible && !t.inOverflow)
      .map(t => t.id);
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
    
    const isDisabled = disabled || !isViewerReady;
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={ref}
            variant={active ? 'secondary' : variant}
            size="icon"
            className={cn(
              "h-8 w-8 sm:h-8 sm:w-8",
              isDisabled && "opacity-50 cursor-not-allowed",
              active && "ring-2 ring-primary bg-primary/10 text-primary"
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
  const getOverflowItems = useCallback(() => {
    const items: { id: string; label: string; icon: React.ReactNode; onClick: () => void; active?: boolean }[] = [];
    
    const overflowTools = toolSettings.filter(t => t.visible && t.inOverflow);
    console.log('[ViewerToolbar] Building overflow menu, tools:', overflowTools.map(t => t.id));
    
    overflowTools.forEach(tool => {
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
        case 'flashOnSelect':
          if (onToggleFlashOnSelect) {
            items.push({ 
              id: tool.id, 
              label: 'Flash vid markering', 
              icon: <Sparkles className="h-4 w-4" />, 
              onClick: () => onToggleFlashOnSelect(!flashOnSelectEnabled),
              active: flashOnSelectEnabled
            });
          }
          break;
        case 'hoverHighlight':
          if (onToggleHoverHighlight) {
            items.push({ 
              id: tool.id, 
              label: 'Hover-highlight', 
              icon: <Hand className="h-4 w-4" />, 
              onClick: () => onToggleHoverHighlight(!hoverHighlightEnabled),
              active: hoverHighlightEnabled
            });
          }
          break;
        case 'xray':
          items.push({
            id: tool.id,
            label: 'X-ray läge',
            icon: <Box className="h-4 w-4" />,
            onClick: () => {
              const viewer = getXeokitViewer();
              if (viewer?.scene) {
                const ids = viewer.scene.objectIds || [];
                // Detect current state with multiple fallbacks
                let currentlyXrayed = false;
                if (typeof viewer.scene.numXRayedObjects === 'number') {
                  currentlyXrayed = viewer.scene.numXRayedObjects > 0;
                } else {
                  try { currentlyXrayed = (viewer.scene.xrayedObjectIds?.length || 0) > 0; } catch {}
                }
                // Toggle with fallback
                if (typeof viewer.scene.setObjectsXRayed === 'function') {
                  viewer.scene.setObjectsXRayed(ids, !currentlyXrayed);
                } else {
                  const objects = viewer.scene.objects || {};
                  for (const id of Object.keys(objects)) {
                    const entity = objects[id];
                    if (entity?.isObject) entity.xrayed = !currentlyXrayed;
                  }
                }
              }
            },
            active: (() => {
              const viewer = getXeokitViewer();
              if (!viewer?.scene) return false;
              if (typeof viewer.scene.numXRayedObjects === 'number') {
                return viewer.scene.numXRayedObjects > 0;
              }
              try { return (viewer.scene.xrayedObjectIds?.length || 0) > 0; } catch { return false; }
            })()
          });
          break;
      }
    });
    
    return items;
  }, [toolSettings, navMode, activeTool, viewMode, flashOnSelectEnabled, hoverHighlightEnabled, onToggleFlashOnSelect, onToggleHoverHighlight, handleNavModeChange, handleToolChange, handleZoomIn, handleZoomOut, handleViewFit, handleResetView, handleViewModeChange]);

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
        <div 
          key={`mobile-toolbar-${settingsKey}`}
          className={cn(
            "absolute left-1/2 -translate-x-1/2 z-20",
            "flex items-center gap-1 p-1.5 rounded-lg",
            "bg-card/95 backdrop-blur-sm border shadow-lg",
            className
          )}
          style={{
            bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 12px) + 16px)',
          }}
        >
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

  // Desktop: Navigation-focused toolbar - render tools in order from settings
  const orderedTools = getOrderedMainTools();
  
  // Tool rendering functions
  const renderTool = (toolId: string) => {
    switch (toolId) {
      case 'orbit':
        return (
          <ToolButton
            key={toolId}
            icon={<RotateCcw className="h-4 w-4" />}
            label="Orbit (rotera)"
            onClick={() => handleNavModeChange('orbit')}
            active={navMode === 'orbit'}
            toolId="orbit"
          />
        );
      case 'firstPerson':
        return (
          <ToolButton
            key={toolId}
            icon={<Move className="h-4 w-4" />}
            label="Första person (gå)"
            onClick={() => handleNavModeChange('firstPerson')}
            active={navMode === 'firstPerson'}
            toolId="firstPerson"
          />
        );
      case 'zoomIn':
        return (
          <ToolButton
            key={toolId}
            icon={<ZoomIn className="h-4 w-4" />}
            label="Zooma in"
            onClick={handleZoomIn}
            toolId="zoomIn"
          />
        );
      case 'zoomOut':
        return (
          <ToolButton
            key={toolId}
            icon={<ZoomOut className="h-4 w-4" />}
            label="Zooma ut"
            onClick={handleZoomOut}
            toolId="zoomOut"
          />
        );
      case 'viewFit':
        return (
          <ToolButton
            key={toolId}
            icon={<Focus className="h-4 w-4" />}
            label="Anpassa vy"
            onClick={handleViewFit}
            toolId="viewFit"
          />
        );
      case 'resetView':
        return (
          <ToolButton
            key={toolId}
            icon={<Maximize className="h-4 w-4" />}
            label="Återställ vy"
            onClick={handleResetView}
            toolId="resetView"
          />
        );
      case 'select':
        return (
          <ToolButton
            key={toolId}
            icon={<MousePointer2 className="h-4 w-4" />}
            label="Välj objekt (CTRL för multi-select)"
            onClick={() => handleToolChange('select')}
            active={activeTool === 'select'}
            toolId="select"
          />
        );
      case 'measure':
        return (
          <ToolButton
            key={toolId}
            icon={<Ruler className="h-4 w-4" />}
            label="Mätverktyg"
            onClick={() => handleToolChange('measure')}
            active={activeTool === 'measure'}
            toolId="measure"
          />
        );
      case 'slicer':
        return (
          <React.Fragment key={toolId}>
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
          </React.Fragment>
        );
      case 'viewMode':
        return (
          <ToolButton
            key={toolId}
            icon={viewMode === '3d' ? <SquareDashed className="h-4 w-4" /> : <Cuboid className="h-4 w-4" />}
            label={viewMode === '3d' ? '2D' : '3D'}
            onClick={() => handleViewModeChange(viewMode === '3d' ? '2d' : '3d')}
            active={viewMode === '2d'}
            toolId="viewMode"
          />
        );
      case 'flashOnSelect':
        return onToggleFlashOnSelect ? (
          <ToolButton
            key={toolId}
            icon={<Sparkles className="h-4 w-4" />}
            label={flashOnSelectEnabled ? 'Flash vid markering (på)' : 'Flash vid markering (av)'}
            onClick={() => onToggleFlashOnSelect(!flashOnSelectEnabled)}
            active={flashOnSelectEnabled}
            toolId="flashOnSelect"
          />
        ) : null;
      case 'hoverHighlight':
        return onToggleHoverHighlight ? (
          <ToolButton
            key={toolId}
            icon={<Hand className="h-4 w-4" />}
            label={hoverHighlightEnabled ? 'Hover-highlight (på)' : 'Hover-highlight (av)'}
            onClick={() => onToggleHoverHighlight(!hoverHighlightEnabled)}
            active={hoverHighlightEnabled}
            toolId="hoverHighlight"
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div 
        key={`toolbar-${settingsKey}`}
        className={cn(
          "absolute bottom-4 left-1/2 -translate-x-1/2 z-20",
          "flex items-center gap-1 p-1.5 rounded-lg",
          "bg-card/95 backdrop-blur-sm border shadow-lg",
          className
        )}
      >
        {/* Render tools in user-defined order */}
        <div className="flex items-center gap-0.5">
          {orderedTools.map((toolId, index) => (
            <React.Fragment key={toolId}>
              {renderTool(toolId)}
              {/* Add separator after every 4th visible tool */}
              {(index + 1) % 4 === 0 && index < orderedTools.length - 1 && (
                <Separator orientation="vertical" className="h-6 mx-1" />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Overflow menu */}
        <OverflowMenu />
      </div>
    </TooltipProvider>
  );
};

export default ViewerToolbar;
