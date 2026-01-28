import React, { useCallback, useState, useEffect, useContext } from "react";
import { Layers, MessageSquare, MoreVertical, Palette, Plus, GripVertical, X, Scissors, Box, ChevronRight, Camera, SquareDashed, PaintBucket, Sun } from "lucide-react";

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
import CreateViewDialog from "./CreateViewDialog";
import { CLIP_HEIGHT_CHANGED_EVENT, VIEW_MODE_CHANGED_EVENT } from "@/hooks/useSectionPlaneClipping";
import { FORCE_SHOW_SPACES_EVENT } from "./RoomVisualizationPanel";
import { VIEW_MODE_REQUESTED_EVENT } from "@/lib/viewer-events";
import { ARCHITECT_MODE_REQUESTED_EVENT, ARCHITECT_MODE_CHANGED_EVENT, ARCHITECT_BACKGROUND_CHANGED_EVENT, ARCHITECT_BACKGROUND_PRESETS, type BackgroundPresetId } from "@/hooks/useArchitectViewMode";
import { AppContext } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import LightingControlsPanel from "./LightingControlsPanel";

interface VisualizationToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  buildingName?: string;
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
  /** Current visible model IDs for saved view capture */
  visibleModelIds?: string[];
  /** Current visible floor IDs for saved view capture */
  visibleFloorIds?: string[];
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
    buildingName,
    isViewerReady = true,
    className, 
    inline = false,
    onToggleVisualization,
    showVisualization = false,
    onAddAsset,
    onVisibleFloorsChange,
    visibleModelIds = [],
    visibleFloorIds = [],
  } = props;

  const { allData } = useContext(AppContext);

  const [isOpen, setIsOpen] = useState(false);
  const [showSpaces, setShowSpaces] = useState(false); // Default OFF per requirements
  const [showAnnotations, setShowAnnotations] = useState(false); // Default OFF per requirements
  const [toolSettings, setToolSettings] = useState<ToolConfig[]>(getVisualizationToolSettings());
  
  // Saved view dialog state
  const [showCreateViewDialog, setShowCreateViewDialog] = useState(false);
  const [pendingViewState, setPendingViewState] = useState<any>(null);
  const [isSavingView, setIsSavingView] = useState(false);
  
  // Active side-pop submenu state
  const [activeSubMenu, setActiveSubMenu] = useState<'models' | 'floors' | null>(null);
  
  // Clipping height state (for 2D floor plan view)
  const [clipHeight, setClipHeight] = useState(1.2); // Default 1.2m above floor
  const [is2DMode, setIs2DMode] = useState(false);
  
  // Architect view mode state
  const [isArchitectMode, setIsArchitectMode] = useState(false);
  const [architectBackground, setArchitectBackground] = useState<BackgroundPresetId>('sage');
  
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

  // Handle 2D/3D mode toggle from this menu
  const handle2DModeToggle = useCallback((enabled: boolean) => {
    const mode = enabled ? '2d' : '3d';
    // Dispatch request event for ViewerToolbar to handle
    window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, {
      detail: { mode }
    }));
  }, []);

  // Handle Architect mode toggle
  const handleArchitectModeToggle = useCallback((enabled: boolean) => {
    setIsArchitectMode(enabled);
    window.dispatchEvent(new CustomEvent(ARCHITECT_MODE_REQUESTED_EVENT, {
      detail: { enabled }
    }));
  }, []);
  // Handle background preset change
  const handleBackgroundChange = useCallback((presetId: BackgroundPresetId) => {
    setArchitectBackground(presetId);
    window.dispatchEvent(new CustomEvent(ARCHITECT_BACKGROUND_CHANGED_EVENT, {
      detail: { presetId }
    }));
  }, []);

  // Listen for architect mode changes (from external sources)
  useEffect(() => {
    const handleArchitectModeChange = (e: CustomEvent) => {
      setIsArchitectMode(e.detail?.enabled ?? false);
    };
    window.addEventListener(ARCHITECT_MODE_CHANGED_EVENT, handleArchitectModeChange as EventListener);
    return () => {
      window.removeEventListener(ARCHITECT_MODE_CHANGED_EVENT, handleArchitectModeChange as EventListener);
    };
  }, []);

  // Capture current view state for saving
  const captureViewState = useCallback(async () => {
    const viewer = viewerRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    
    if (!xeokitViewer || !buildingFmGuid) {
      toast({ title: "Kan inte skapa vy", description: "Viewer är inte redo", variant: "destructive" });
      return;
    }

    try {
      // Get screenshot from canvas directly (xeokit doesn't have getImage method)
      const canvas = xeokitViewer.scene?.canvas?.canvas;
      if (!canvas) {
        toast({ title: "Kan inte skapa vy", description: "Canvas inte tillgängligt", variant: "destructive" });
        return;
      }
      
      // Force a render before capturing
      xeokitViewer.scene?.render?.(true);
      const screenshotDataUrl = canvas.toDataURL('image/png');

      // Get camera state
      const camera = xeokitViewer.camera;
      const cameraState = {
        eye: [...camera.eye],
        look: [...camera.look],
        up: [...camera.up],
        projection: camera.projection,
      };

      // Get building name
      const building = allData.find((b: any) => b.fmGuid === buildingFmGuid && b.category === 'Building');
      const resolvedBuildingName = buildingName || building?.commonName || building?.name || 'Okänd byggnad';

      const viewState = {
        buildingFmGuid,
        buildingName: resolvedBuildingName,
        screenshotDataUrl,
        cameraEye: cameraState.eye,
        cameraLook: cameraState.look,
        cameraUp: cameraState.up,
        cameraProjection: cameraState.projection,
        viewMode: is2DMode ? '2d' : '3d',
        clipHeight,
        visibleModelIds,
        visibleFloorIds,
        showSpaces,
        showAnnotations,
        visualizationType: 'none', // Will be enhanced when RoomVisualizationPanel provides this
        visualizationMockData: false,
      };

      setPendingViewState(viewState);
      setShowCreateViewDialog(true);
    } catch (err) {
      console.error('Failed to capture view state:', err);
      toast({ title: "Fel", description: "Kunde inte fånga vyn", variant: "destructive" });
    }
  }, [viewerRef, buildingFmGuid, buildingName, allData, is2DMode, clipHeight, visibleModelIds, visibleFloorIds, showSpaces, showAnnotations]);

  // Save the view to database
  const handleSaveView = useCallback(async (name: string, description: string) => {
    if (!pendingViewState) return;

    setIsSavingView(true);
    try {
      // Upload screenshot to storage
      const viewId = crypto.randomUUID();
      const base64Data = pendingViewState.screenshotDataUrl.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });

      const { error: uploadError } = await supabase.storage
        .from('saved-view-screenshots')
        .upload(`${viewId}.png`, blob, { contentType: 'image/png' });

      if (uploadError) {
        console.error('Screenshot upload failed:', uploadError);
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('saved-view-screenshots')
        .getPublicUrl(`${viewId}.png`);

      // Insert saved view record
      const { error: insertError } = await supabase
        .from('saved_views')
        .insert({
          id: viewId,
          name,
          description: description || null,
          building_fm_guid: pendingViewState.buildingFmGuid,
          building_name: pendingViewState.buildingName,
          screenshot_url: urlData?.publicUrl || null,
          camera_eye: pendingViewState.cameraEye,
          camera_look: pendingViewState.cameraLook,
          camera_up: pendingViewState.cameraUp,
          camera_projection: pendingViewState.cameraProjection,
          view_mode: pendingViewState.viewMode,
          clip_height: pendingViewState.clipHeight,
          visible_model_ids: pendingViewState.visibleModelIds,
          visible_floor_ids: pendingViewState.visibleFloorIds,
          show_spaces: pendingViewState.showSpaces,
          show_annotations: pendingViewState.showAnnotations,
          visualization_type: pendingViewState.visualizationType,
          visualization_mock_data: pendingViewState.visualizationMockData,
        });

      if (insertError) {
        throw insertError;
      }

      toast({ title: "Vy sparad!", description: `"${name}" har sparats` });
      setShowCreateViewDialog(false);
      setPendingViewState(null);
    } catch (err) {
      console.error('Failed to save view:', err);
      toast({ title: "Fel", description: "Kunde inte spara vyn", variant: "destructive" });
      throw err;
    } finally {
      setIsSavingView(false);
    }
  }, [pendingViewState]);

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
                  {/* Architect View Mode Toggle */}
                  <div className="flex items-center justify-between py-1.5 sm:py-2">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div
                        className={cn(
                          "p-1 sm:p-1.5 rounded-md",
                          isArchitectMode
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        <PaintBucket className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </div>
                      <span className="text-xs sm:text-sm">Arkitektvy</span>
                    </div>
                    <Switch 
                      checked={isArchitectMode} 
                      onCheckedChange={handleArchitectModeToggle}
                      disabled={!isViewerReady}
                    />
                  </div>

                  {/* Background color palette - always visible */}
                  <div className="py-1.5 sm:py-2">
                    <div className="flex items-center gap-2 sm:gap-3 mb-2">
                      <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
                        <Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </div>
                      <span className="text-xs sm:text-sm">Bakgrundsfärg</span>
                    </div>
                    <div className="pl-8 sm:pl-10">
                      <div className="grid grid-cols-5 gap-1.5">
                        {ARCHITECT_BACKGROUND_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            title={preset.name}
                            onClick={() => handleBackgroundChange(preset.id as BackgroundPresetId)}
                            className={cn(
                              "w-5 h-5 sm:w-6 sm:h-6 rounded-md border-2 transition-all",
                              "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/50",
                              architectBackground === preset.id
                                ? "border-primary ring-2 ring-primary/30"
                                : "border-border/40"
                            )}
                            style={{
                              background: `linear-gradient(180deg, rgb(255, 255, 255) 0%, ${preset.bottom} 100%)`
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Lighting Controls */}
                  <LightingControlsPanel
                    viewerRef={viewerRef}
                    isViewerReady={isViewerReady}
                  />

                  <Separator className="my-2" />

                  {/* 2D Plan View Toggle */}
                  <div className="flex items-center justify-between py-1.5 sm:py-2">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div
                        className={cn(
                          "p-1 sm:p-1.5 rounded-md",
                          is2DMode
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        <SquareDashed className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </div>
                      <span className="text-xs sm:text-sm">2D/3D</span>
                    </div>
                    <Switch checked={is2DMode} onCheckedChange={handle2DModeToggle} />
                  </div>

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
              <div>
                <Label className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-1.5 sm:mb-2 block">
                  Åtgärder
                </Label>

                <div className="space-y-1">
                  {/* Create View button */}
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2 sm:gap-3 h-9 sm:h-10"
                    onClick={captureViewState}
                    disabled={!isViewerReady}
                  >
                    <div className="p-1 sm:p-1.5 rounded-md bg-primary/10 text-primary">
                      <Camera className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </div>
                    <span className="text-xs sm:text-sm">Skapa vy</span>
                  </Button>

                  {isToolVisible('addAsset') && onAddAsset && (
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
                  )}
                </div>
              </div>
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
          
          {/* Create View Dialog */}
          <CreateViewDialog
            open={showCreateViewDialog}
            onClose={() => {
              setShowCreateViewDialog(false);
              setPendingViewState(null);
            }}
            onSave={handleSaveView}
            viewState={pendingViewState}
            isSaving={isSavingView}
          />
        </TooltipProvider>
      )}
    </div>
  );
};

export default VisualizationToolbar;
