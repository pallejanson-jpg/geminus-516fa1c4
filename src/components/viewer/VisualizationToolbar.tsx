import React, { useCallback, useState, useEffect } from "react";
import { Layers, MessageSquare, MoreVertical, Palette, Plus, GripVertical, X, Scissors, Box, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getVisualizationToolSettings, ToolConfig, TOOLBAR_SETTINGS_CHANGED_EVENT } from "./ToolbarSettings";
import FloorVisibilitySelector from "./FloorVisibilitySelector";
import ModelVisibilitySelector from "./ModelVisibilitySelector";
import SidePopPanel from "./SidePopPanel";
import { CLIP_HEIGHT_CHANGED_EVENT, VIEW_MODE_CHANGED_EVENT } from "@/hooks/useSectionPlaneClipping";
import { FORCE_SHOW_SPACES_EVENT } from "./RoomVisualizationPanel";

interface VisualizationToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  isViewerReady?: boolean;
  onToggleNavCube?: (visible: boolean) => void;
  onToggleMinimap?: (visible: boolean) => void;
  onToggleTreeView?: (visible: boolean) => void;
  onToggleVisualization?: (visible: boolean) => void;
  onAddAsset?: () => void;
  onPickCoordinate?: () => void;
  onShowProperties?: () => void;
  onOpenSettings?: () => void;
  onVisibleFloorsChange?: (visibleFloorIds: string[]) => void;
  isPickMode?: boolean;
  showTreeView?: boolean;
  showVisualization?: boolean;
  showNavCube?: boolean;
  showMinimap?: boolean;
  className?: string;
  inline?: boolean;
}

/**
 * VisualizationToolbar with configurable tools based on ToolbarSettings.
 * Renders as a floating, draggable panel when opened.
 * Includes floor visibility selector with multi-select switches.
 * Features swipe-to-close on mobile and semi-transparent frosted glass effect.
 */
const VisualizationToolbar: React.FC<VisualizationToolbarProps> = (props) => {
  const { 
    viewerRef,
    buildingFmGuid,
    isViewerReady = true,
    className, 
    inline = false,
    onToggleVisualization,
    showVisualization = false,
    onAddAsset,
    onVisibleFloorsChange,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [showSpaces, setShowSpaces] = useState(false); // Default OFF per requirements
  const [showAnnotations, setShowAnnotations] = useState(false); // Default OFF per requirements
  const [toolSettings, setToolSettings] = useState<ToolConfig[]>(getVisualizationToolSettings());
  
  // Active side-pop submenu state
  const [activeSubMenu, setActiveSubMenu] = useState<'models' | 'floors' | null>(null);
  
  // Clipping height state (for 2D floor plan view)
  const [clipHeight, setClipHeight] = useState(1.2); // Default 1.2m above floor
  const [is2DMode, setIs2DMode] = useState(false);
  
  // Draggable panel state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  // Touch swipe state for mobile close gesture
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchDelta, setTouchDelta] = useState(0);
  
  // Panel dimensions for side-pop positioning
  const panelWidth = typeof window !== 'undefined' && window.innerWidth >= 640 ? 320 : 280;

  // Initialize position when panel opens
  useEffect(() => {
    if (isOpen && position.x === 0 && position.y === 0) {
      // Position to the left of the trigger button (top-right area)
      const initialX = typeof window !== 'undefined' ? window.innerWidth - 420 : 200;
      setPosition({ x: initialX, y: 60 });
    }
  }, [isOpen, position.x, position.y]);

  // Reload settings when they change
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

  // Listen for view mode changes to show/hide clipping slider
  useEffect(() => {
    const handleViewModeChange = (e: CustomEvent) => {
      setIs2DMode(e.detail?.mode === '2d');
    };
    window.addEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChange as EventListener);
    return () => {
      window.removeEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChange as EventListener);
    };
  }, []);

  // Listen for force show spaces from RoomVisualizationPanel
  useEffect(() => {
    const handleForceShowSpaces = (e: CustomEvent) => {
      if (e.detail?.show && !showSpaces) {
        setShowSpaces(true);
        try {
          const assetViewer = viewerRef.current?.assetViewer;
          assetViewer?.onShowSpacesChanged?.(true);
        } catch (err) {
          console.debug("Force show spaces failed:", err);
        }
      }
    };
    window.addEventListener(FORCE_SHOW_SPACES_EVENT, handleForceShowSpaces as EventListener);
    return () => {
      window.removeEventListener(FORCE_SHOW_SPACES_EVENT, handleForceShowSpaces as EventListener);
    };
  }, [showSpaces, viewerRef]);

  // Handle clip height change
  const handleClipHeightChange = useCallback((value: number[]) => {
    const newHeight = value[0];
    setClipHeight(newHeight);
    
    // Emit event to update clipping in real-time
    window.dispatchEvent(new CustomEvent(CLIP_HEIGHT_CHANGED_EVENT, {
      detail: { height: newHeight }
    }));
  }, []);

  // Tool visibility check
  const isToolVisible = useCallback((toolId: string) => {
    const setting = toolSettings.find(t => t.id === toolId);
    return setting?.visible ?? true;
  }, [toolSettings]);

  // Drag handlers (desktop)
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select, [role="switch"]')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 400, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragOffset.y)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Touch swipe handlers (mobile close gesture)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientY);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStart === null) return;
    const delta = e.touches[0].clientY - touchStart;
    setTouchDelta(Math.max(0, delta)); // Only track downward swipes
  }, [touchStart]);

  const handleTouchEnd = useCallback(() => {
    if (touchDelta > 80) {
      setIsOpen(false); // Close panel on sufficient swipe
    }
    setTouchStart(null);
    setTouchDelta(0);
  }, [touchDelta]);

  const handleToggleSpaces = useCallback(() => {
    const newValue = !showSpaces;
    setShowSpaces(newValue);
    try {
      const assetViewer = viewerRef.current?.assetViewer;
      assetViewer?.onShowSpacesChanged?.(newValue);
    } catch (e) {
      console.debug("Toggle spaces failed:", e);
    }
  }, [viewerRef, showSpaces]);

  const handleToggleAnnotations = useCallback(() => {
    const newValue = !showAnnotations;
    setShowAnnotations(newValue);
    try {
      const assetViewer = viewerRef.current?.assetViewer;
      assetViewer?.onToggleAnnotation?.(newValue);
    } catch (e) {
      console.debug("Toggle annotations failed:", e);
    }
  }, [viewerRef, showAnnotations]);

  const handleToggleVisualization = useCallback(() => {
    onToggleVisualization?.(!showVisualization);
  }, [onToggleVisualization, showVisualization]);

  const handleAddAsset = useCallback(() => {
    setIsOpen(false);
    onAddAsset?.();
  }, [onAddAsset]);

  // Handle visible floors change from floor selector
  const handleVisibleFloorsChange = useCallback((visibleFloorIds: string[]) => {
    console.log("Visible floors changed:", visibleFloorIds);
    onVisibleFloorsChange?.(visibleFloorIds);
  }, [onVisibleFloorsChange]);

  const containerClassName = cn(
    inline ? "" : "absolute top-4 right-4 z-20",
    className
  );

  return (
    <div className={containerClassName}>
      {/* Trigger button */}
      <Button
        variant="secondary"
        size="icon"
        title="Visning"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "shadow-lg bg-card/95 backdrop-blur-sm border",
          "h-8 w-8 sm:h-10 sm:w-10",
          isOpen && "ring-2 ring-primary"
        )}
      >
        <MoreVertical className="h-4 w-4 sm:h-5 sm:w-5" />
      </Button>

      {/* Floating draggable panel - responsive positioning with transparency */}
      {isOpen && (
        <TooltipProvider delayDuration={300}>
          <div
            className={cn(
              "fixed z-[60] border rounded-lg shadow-xl",
              // Enhanced semi-transparent frosted glass effect
              "bg-card/60 backdrop-blur-md",
              "max-h-[70vh] sm:max-h-[80vh] flex flex-col",
              "transition-all duration-150",
              // Mobile: bottom sheet style with safe area
              "left-2 right-2 bottom-16 sm:inset-auto",
              // Desktop: fixed-width draggable panel (narrower for side-pop architecture)
              "sm:w-72 md:w-80",
              isDragging && "cursor-grabbing opacity-90"
            )}
            style={{ 
              // Swipe transform on mobile
              transform: touchDelta > 0 ? `translateY(${touchDelta}px)` : undefined,
              opacity: touchDelta > 0 ? Math.max(0.3, 1 - (touchDelta / 200)) : undefined,
              // Only apply position on desktop (>= 640px)
              ...(typeof window !== 'undefined' && window.innerWidth >= 640 ? {
                left: position.x,
                top: position.y,
                right: 'auto',
                bottom: 'auto'
              } : {})
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
          {/* Swipe indicator bar (mobile only) */}
          <div className="sm:hidden flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
          
          {/* Header - Draggable on desktop */}
          <div
            className="flex items-center justify-between px-2.5 pb-2.5 sm:p-3 border-b cursor-grab select-none"
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-muted-foreground hidden sm:block" />
              <span className="font-medium text-sm">Visning</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 sm:h-6 sm:w-6"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4 sm:h-3 sm:w-3" />
            </Button>
          </div>

          {/* Content - compact height for side-pop architecture */}
          <ScrollArea className="flex-1 min-h-0 p-2.5 sm:p-3">
            <div className="space-y-2 sm:space-y-3">
              {/* BIM Models - click to open side panel */}
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
                    <Box className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </div>
                  <span className="text-xs sm:text-sm">BIM-modeller</span>
                </div>
                <Button
                  variant={activeSubMenu === 'models' ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => setActiveSubMenu(activeSubMenu === 'models' ? null : 'models')}
                >
                  <ChevronRight className={cn(
                    "h-3 w-3 transition-transform",
                    activeSubMenu === 'models' && "rotate-180"
                  )} />
                </Button>
              </div>

              {/* Floors - click to open side panel */}
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
                    <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </div>
                  <span className="text-xs sm:text-sm">Våningsplan</span>
                </div>
                <Button
                  variant={activeSubMenu === 'floors' ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => setActiveSubMenu(activeSubMenu === 'floors' ? null : 'floors')}
                  disabled={!isViewerReady}
                >
                  <ChevronRight className={cn(
                    "h-3 w-3 transition-transform",
                    activeSubMenu === 'floors' && "rotate-180"
                  )} />
                </Button>
              </div>

              {/* Clipping height slider - visible when 2D mode is active */}
              {is2DMode && (
                <div className="space-y-2 sm:space-y-3">
                  <Label className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider block">
                    Klipphöjd (2D-vy)
                  </Label>
                  <div className="space-y-1.5 sm:space-y-2">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="p-1 sm:p-1.5 rounded-md bg-primary/10 text-primary">
                        <Scissors className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </div>
                      <div className="flex-1">
                        <Slider
                          value={[clipHeight]}
                          onValueChange={handleClipHeightChange}
                          min={0.5}
                          max={2.5}
                          step={0.1}
                          className="w-full"
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-medium w-10 sm:w-12 text-right">
                        {clipHeight.toFixed(1)}m
                      </span>
                    </div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">
                      Höjd ovanför golv
                    </p>
                  </div>
                </div>
              )}

              <Separator />

              {/* Visibility section */}
              <div>
                <Label className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-1.5 sm:mb-2 block">
                  Visa
                </Label>

                <div className="space-y-0.5 sm:space-y-1">
                  {isToolVisible('spaces') && (
                    <div className="flex items-center justify-between py-1.5 sm:py-2">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div
                          className={cn(
                            "p-1 sm:p-1.5 rounded-md",
                            showSpaces
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </div>
                        <span className="text-xs sm:text-sm">Visa rum</span>
                      </div>
                      <Switch checked={showSpaces} onCheckedChange={handleToggleSpaces} />
                    </div>
                  )}

                  {isToolVisible('annotations') && (
                    <div className="flex items-center justify-between py-1.5 sm:py-2">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div
                          className={cn(
                            "p-1 sm:p-1.5 rounded-md",
                            showAnnotations
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </div>
                        <span className="text-xs sm:text-sm">Visa annotationer</span>
                      </div>
                      <Switch checked={showAnnotations} onCheckedChange={handleToggleAnnotations} />
                    </div>
                  )}

                  {isToolVisible('visualization') && onToggleVisualization && (
                    <div className="flex items-center justify-between py-1.5 sm:py-2">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div
                          className={cn(
                            "p-1 sm:p-1.5 rounded-md",
                            showVisualization
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </div>
                        <span className="text-xs sm:text-sm">Rumsvisualisering</span>
                      </div>
                      <Switch checked={showVisualization} onCheckedChange={handleToggleVisualization} />
                    </div>
                  )}
                </div>
              </div>

              {/* Actions section */}
              {isToolVisible('addAsset') && onAddAsset && (
                <div>
                  <Label className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-1.5 sm:mb-2 block">
                    Åtgärder
                  </Label>

                  <div className="space-y-1">
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2 sm:gap-3 h-9 sm:h-10"
                      onClick={handleAddAsset}
                    >
                      <div className="p-1 sm:p-1.5 rounded-md bg-primary/10 text-primary">
                        <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </div>
                      <span className="text-xs sm:text-sm">Registrera tillgång</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          </div>
          
          {/* Side-pop panel for BIM Models */}
          <SidePopPanel
            isOpen={activeSubMenu === 'models'}
            onClose={() => setActiveSubMenu(null)}
            title="BIM-modeller"
            parentPosition={position}
            parentWidth={panelWidth}
          >
            <ModelVisibilitySelector
              viewerRef={viewerRef}
              buildingFmGuid={buildingFmGuid}
              listOnly={true}
            />
          </SidePopPanel>
          
          {/* Side-pop panel for Floors */}
          <SidePopPanel
            isOpen={activeSubMenu === 'floors'}
            onClose={() => setActiveSubMenu(null)}
            title="Våningsplan"
            parentPosition={position}
            parentWidth={panelWidth}
          >
            <FloorVisibilitySelector
              viewerRef={viewerRef}
              buildingFmGuid={buildingFmGuid}
              isViewerReady={isViewerReady}
              onVisibleFloorsChange={handleVisibleFloorsChange}
              enableClipping={true}
              listOnly={true}
            />
          </SidePopPanel>
        </TooltipProvider>
      )}
    </div>
  );
};

export default VisualizationToolbar;
