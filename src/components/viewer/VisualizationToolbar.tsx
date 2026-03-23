import React, { useCallback, useState, useEffect, useContext, useRef } from "react";
import { Layers, MessageSquare, MessageSquarePlus, MoreVertical, Palette, Plus, GripVertical, X, Scissors, Box, ChevronRight, Camera, SquareDashed, Settings, ChevronDown, Type, TreeDeciduous, Eye, Thermometer, Wind, Droplets, Users, Ruler } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFlashHighlight } from "@/hooks/useFlashHighlight";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { getVisualizationToolSettings, ToolConfig, TOOLBAR_SETTINGS_CHANGED_EVENT } from "./ToolbarSettings";
import FloorVisibilitySelector from "./FloorVisibilitySelector";
import ModelVisibilitySelector from "./ModelVisibilitySelector";
import SidePopPanel from "./SidePopPanel";
import XrayToggle from "./XrayToggle";
import AnnotationCategoryList from "./AnnotationCategoryList";
import CreateViewDialog from "./CreateViewDialog";
// InventoryPanel moved to NativeViewerShell for independent lifecycle
import CreateIssueDialog from "./CreateIssueDialog";
import FloatingIssueListPanel, { type BcfIssue } from "./FloatingIssueListPanel";
import IssueDetailSheet from "./IssueDetailSheet";
import ViewerThemeSelector from "./ViewerThemeSelector";
import { CLIP_HEIGHT_CHANGED_EVENT, VIEW_MODE_CHANGED_EVENT } from "@/hooks/useSectionPlaneClipping";
import { CLIP_HEIGHT_3D_CHANGED_EVENT } from "@/hooks/useSectionPlaneClipping";
import { FORCE_SHOW_SPACES_EVENT } from "./RoomVisualizationPanel";
import { VIEW_MODE_REQUESTED_EVENT, ISSUE_MARKER_CLICKED_EVENT, type IssueMarkerClickedDetail } from "@/lib/viewer-events";
import { ARCHITECT_BACKGROUND_CHANGED_EVENT, ARCHITECT_BACKGROUND_PRESETS, type BackgroundPresetId } from "@/hooks/useArchitectViewMode";
import { AppContext } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useBcfViewpoints } from "@/hooks/useBcfViewpoints";
import LightingControlsPanel from "./LightingControlsPanel";
import ObjectColorFilterPanel from "./ObjectColorFilterPanel";
import EdgeScrollIndicator from "@/components/common/EdgeScrollIndicator";
import { ROOM_LABELS_TOGGLE_EVENT, ROOM_LABELS_CONFIG_EVENT, type RoomLabelsConfigDetail } from "@/hooks/useRoomLabels";
import { useRoomLabelConfigs } from "@/hooks/useRoomLabelConfigs";
import { FLOOR_PILLS_TOGGLE_EVENT } from "./FloatingFloorSwitcher";
import { useIsMobile } from "@/hooks/use-mobile";
import { VISUALIZATION_QUICK_SELECT_EVENT } from "./VisualizationQuickBar";
import { VisualizationType, VISUALIZATION_CONFIGS } from "@/lib/visualization-utils";
// import { LEVEL_LABELS_TOGGLE_EVENT } from "@/hooks/useLevelLabels"; // disabled

const VIZ_LIST_ITEMS: { type: VisualizationType; icon: React.ElementType; label: string }[] = [
  { type: 'temperature', icon: Thermometer, label: 'Temperature' },
  { type: 'co2', icon: Wind, label: 'CO₂' },
  { type: 'humidity', icon: Droplets, label: 'Humidity' },
  { type: 'occupancy', icon: Users, label: 'Occupancy' },
  { type: 'area', icon: Ruler, label: 'Area (NTA)' },
];

/** Inline sub-component: clickable list of room visualization types */
const RoomVisualizationList: React.FC<{
  showVisualization: boolean;
  onToggleVisualization: (show: boolean) => void;
}> = ({ showVisualization, onToggleVisualization }) => {
  const [activeViz, setActiveViz] = React.useState<VisualizationType>('none');
  const [listOpen, setListOpen] = React.useState(false);

  // Stay in sync with external changes
  React.useEffect(() => {
    const handler = (e: CustomEvent) => {
      setActiveViz(e.detail?.visualizationType ?? 'none');
    };
    window.addEventListener('VISUALIZATION_STATE_CHANGED', handler as EventListener);
    return () => window.removeEventListener('VISUALIZATION_STATE_CHANGED', handler as EventListener);
  }, []);

  const toggle = (type: VisualizationType) => {
    const next = activeViz === type ? 'none' : type;
    setActiveViz(next);
    window.dispatchEvent(
      new CustomEvent(VISUALIZATION_QUICK_SELECT_EVENT, { detail: { type: next } })
    );
    // Auto-enable spaces when selecting a viz, disable when selecting none
    if (next !== 'none') {
      if (!showVisualization) onToggleVisualization(true);
      // Force show spaces
      window.dispatchEvent(new CustomEvent(FORCE_SHOW_SPACES_EVENT, { detail: { show: true } }));
    } else {
      if (showVisualization) onToggleVisualization(false);
      // Turn off spaces when None is selected
      window.dispatchEvent(new CustomEvent(FORCE_SHOW_SPACES_EVENT, { detail: { show: false } }));
    }
  };

  return (
    <Collapsible open={listOpen} onOpenChange={setListOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full py-1.5 sm:py-2 hover:bg-muted/50 rounded-md transition-colors px-1">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className={cn("p-1 sm:p-1.5 rounded-md", activeViz !== 'none' ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              <Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <span className="text-xs sm:text-sm font-medium">Color filter</span>
            {activeViz !== 'none' && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {VIZ_LIST_ITEMS.find(v => v.type === activeViz)?.label || activeViz}
              </Badge>
            )}
          </div>
          <ChevronDown className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            listOpen && "rotate-180"
          )} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-7 sm:ml-9 space-y-0.5 pb-1">
          {/* None option */}
          <button
            onClick={() => toggle('none' as VisualizationType)}
            className={cn(
              "flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs transition-colors",
              "hover:bg-muted/80",
              activeViz === 'none' ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
            )}
          >
            <X className="h-3.5 w-3.5" />
            <span>None</span>
          </button>
          {VIZ_LIST_ITEMS.map(({ type, icon: Icon, label }) => {
            const isActive = activeViz === type;
            return (
              <button
                key={type}
                onClick={() => toggle(type)}
                className={cn(
                  "flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs transition-colors",
                  "hover:bg-muted/80",
                  isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

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
  /** Controlled "Visa rum" (Show Spaces) state from parent */
  showSpaces?: boolean;
  /** Callback when "Visa rum" is toggled */
  onShowSpacesChange?: (show: boolean) => void;
  /** External open control (e.g. mobile settings button) */
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
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
    onToggleTreeView,
    showTreeView = false,
    onAddAsset,
    onVisibleFloorsChange,
    visibleModelIds = [],
    visibleFloorIds = [],
    showSpaces: externalShowSpaces,
    onShowSpacesChange,
    externalOpen,
    onExternalOpenChange,
  } = props;

  const isMobile = useIsMobile();
  const { allData } = useContext(AppContext);
  const { user, isAdmin } = useAuth();

  // BCF viewpoint hook
  const { captureViewpoint, captureScreenshot, getSelectedObjectIds, restoreViewpoint } = useBcfViewpoints({ viewerRef });
  
  // Flash highlight hook for visual feedback on selected objects
  const { flashEntitiesByIds } = useFlashHighlight();

  const [isOpen, setIsOpen] = useState(false);

  // Sync external open control (mobile settings button)
  useEffect(() => {
    if (externalOpen !== undefined) setIsOpen(externalOpen);
  }, [externalOpen]);

  // Notify parent when isOpen changes
  const handleSetIsOpen = useCallback((open: boolean) => {
    setIsOpen(open);
    onExternalOpenChange?.(open);
  }, [onExternalOpenChange]);

  // Use controlled state if provided, otherwise local state
  const [localShowSpaces, setLocalShowSpaces] = useState(false);
  const showSpaces = externalShowSpaces !== undefined ? externalShowSpaces : localShowSpaces;
  const [showAnnotations, setShowAnnotations] = useState(false); // Default OFF per requirements
  const [toolSettings, setToolSettings] = useState<ToolConfig[]>(getVisualizationToolSettings());
  
  // Saved view dialog state
  const [showCreateViewDialog, setShowCreateViewDialog] = useState(false);
  const [pendingViewState, setPendingViewState] = useState<any>(null);
  const [isSavingView, setIsSavingView] = useState(false);
  
  // BCF Issue dialog state
  const [showCreateIssueDialog, setShowCreateIssueDialog] = useState(false);
  const [pendingIssueState, setPendingIssueState] = useState<{ screenshot: string; viewpoint: any; selectedObjects: string[] } | null>(null);
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<BcfIssue | null>(null);
  const [showIssueDetail, setShowIssueDetail] = useState(false);
  
  // Independent issue list state - stays open even when main menu closes
  const [showIssueList, setShowIssueList] = useState(false);
  
  // Active side-pop submenu state
  const [activeSubMenu, setActiveSubMenu] = useState<'models' | 'floors' | 'annotations' | null>(null);
  
  // Clipping height state (for 2D floor plan view)
  const [clipHeight, setClipHeight] = useState(1.2); // Default 1.2m above floor
  const [is2DMode, setIs2DMode] = useState(false);
  
  // 3D ceiling clip offset state (for 3D solo floor mode)
  const [clipHeight3D, setClipHeight3D] = useState(0); // Default 0m offset from next floor
  const [isSoloFloor, setIsSoloFloor] = useState(false);
  
  // Viewer settings collapsible state
  const [viewerSettingsOpen, setViewerSettingsOpen] = useState(false);
  const [architectBackground, setArchitectBackground] = useState<BackgroundPresetId>('sage');
  const [showRoomLabels, setShowRoomLabels] = useState(false);
  const [activeRoomLabelConfigId, setActiveRoomLabelConfigId] = useState<string | null>(null);
  const [showFloorPills, setShowFloorPills] = useState(() => {
    return localStorage.getItem('viewer-show-floor-pills') !== 'false';
  });
  // const [showLevelLabels, setShowLevelLabels] = useState(true); // disabled
  
  // Room label configs from database
  const { configs: roomLabelConfigs, loading: loadingRoomLabelConfigs } = useRoomLabelConfigs();

  // Scroll indicator (external, on panel edge)
  const scrollWrapRef = useRef<HTMLDivElement | null>(null);
  const [scrollViewportEl, setScrollViewportEl] = useState<HTMLElement | null>(null);
  
  // Fixed sidebar position (right sidebar, no dragging)
  const sidebarWidth = typeof window !== 'undefined' && window.innerWidth >= 640 ? 320 : 288;
  const position = { x: (typeof window !== 'undefined' ? window.innerWidth - sidebarWidth : 800), y: 0 };
  
  // Touch swipe state for mobile close gesture
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchDelta, setTouchDelta] = useState(0);
  
  // Panel dimensions for side-pop positioning
  const panelWidth = sidebarWidth;

  // Grab Radix ScrollArea viewport so we can render a visible edge indicator (like in the reference screenshot)
  useEffect(() => {
    if (!isOpen) {
      setScrollViewportEl(null);
      return;
    }

    const t = window.setTimeout(() => {
      const vp = scrollWrapRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]",
      ) as HTMLElement | null;
      setScrollViewportEl(vp);
    }, 0);

    return () => window.clearTimeout(t);
  }, [isOpen]);

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
      const mode = e.detail?.mode;
      setIs2DMode(mode === '2d');
      // In 2D mode, solo floor detection is handled differently
      if (mode === '2d') {
        setIsSoloFloor(false);
      }
    };
    window.addEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChange as EventListener);
    return () => {
      window.removeEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChange as EventListener);
    };
  }, []);

  // Listen for floor selection changes to detect solo floor mode
  useEffect(() => {
    const handleFloorChange = (e: CustomEvent) => {
      const { isAllFloorsVisible, visibleMetaFloorIds } = e.detail || {};
      const solo = !isAllFloorsVisible && visibleMetaFloorIds && visibleMetaFloorIds.length === 1;
      setIsSoloFloor(solo);
    };
    window.addEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange as EventListener);
    return () => {
      window.removeEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange as EventListener);
    };
  }, []);

  // Listen for force show spaces from RoomVisualizationPanel
  useEffect(() => {
    const handleForceShowSpaces = (e: CustomEvent) => {
      const shouldShow = !!e.detail?.show;
      if (shouldShow !== showSpaces) {
        if (onShowSpacesChange) {
          onShowSpacesChange(shouldShow);
        } else {
          setLocalShowSpaces(shouldShow);
        }
        try {
          const assetViewer = viewerRef.current?.assetViewer;
          assetViewer?.onShowSpacesChanged?.(shouldShow);
        } catch (err) {
          console.debug("Force show spaces failed:", err);
        }
      }
    };
    window.addEventListener(FORCE_SHOW_SPACES_EVENT, handleForceShowSpaces as EventListener);
    return () => {
      window.removeEventListener(FORCE_SHOW_SPACES_EVENT, handleForceShowSpaces as EventListener);
    };
  }, [showSpaces, viewerRef, onShowSpacesChange]);

  // Listen for OPEN_ISSUE_LIST event (from context menu "Visa ärenden")
  useEffect(() => {
    const handler = () => setShowIssueList(true);
    window.addEventListener('OPEN_ISSUE_LIST', handler);
    return () => window.removeEventListener('OPEN_ISSUE_LIST', handler);
  }, []);

  // Handle clip height change
  const handleClipHeightChange = useCallback((value: number[]) => {
    const newHeight = value[0];
    setClipHeight(newHeight);
    
    // Emit event to update clipping in real-time
    window.dispatchEvent(new CustomEvent(CLIP_HEIGHT_CHANGED_EVENT, {
      detail: { height: newHeight }
    }));
  }, []);

  // Handle 3D ceiling clip offset change
  const handleClipHeight3DChange = useCallback((value: number[]) => {
    const newOffset = value[0];
    setClipHeight3D(newOffset);
    
    // Emit event to update 3D ceiling clipping in real-time
    window.dispatchEvent(new CustomEvent(CLIP_HEIGHT_3D_CHANGED_EVENT, {
      detail: { offset: newOffset }
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

  // Handle background preset change
  const handleBackgroundChange = useCallback((presetId: BackgroundPresetId) => {
    setArchitectBackground(presetId);
    window.dispatchEvent(new CustomEvent(ARCHITECT_BACKGROUND_CHANGED_EVENT, {
      detail: { presetId }
    }));
  }, []);

  // Handle room labels toggle with config
  const handleRoomLabelsToggle = useCallback((enabled: boolean, configId?: string) => {
    setShowRoomLabels(enabled);
    
    if (enabled && configId) {
      setActiveRoomLabelConfigId(configId);
      const config = roomLabelConfigs.find(c => c.id === configId);
      if (config) {
        // Dispatch config event first
        window.dispatchEvent(new CustomEvent(ROOM_LABELS_CONFIG_EVENT, {
          detail: {
            fields: config.fields,
            heightOffset: config.height_offset,
            fontSize: config.font_size,
            scaleWithDistance: config.scale_with_distance,
            clickAction: config.click_action,
            occlusionEnabled: config.occlusion_enabled,
            flatOnFloor: config.flat_on_floor,
          } as RoomLabelsConfigDetail
        }));
      }
    } else if (!enabled) {
      setActiveRoomLabelConfigId(null);
    }
    
    // Then dispatch enable/disable event
    window.dispatchEvent(new CustomEvent(ROOM_LABELS_TOGGLE_EVENT, {
      detail: { enabled }
    }));
  }, [roomLabelConfigs]);

  // Handle room label config selection
  const handleRoomLabelConfigSelect = useCallback((configId: string) => {
    if (configId === 'off') {
      handleRoomLabelsToggle(false);
    } else {
      handleRoomLabelsToggle(true, configId);
    }
  }, [handleRoomLabelsToggle]);

  // Capture current view state for saving
  const captureViewState = useCallback(async () => {
    const viewer = viewerRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    
    if (!xeokitViewer || !buildingFmGuid) {
      toast({ title: "Cannot create view", description: "Viewer is not ready", variant: "destructive" });
      return;
    }

    try {
      // Get screenshot from canvas directly (xeokit doesn't have getImage method)
      const canvas = xeokitViewer.scene?.canvas?.canvas;
      if (!canvas) {
        toast({ title: "Cannot create view", description: "Canvas not available", variant: "destructive" });
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
      const resolvedBuildingName = buildingName || building?.commonName || building?.name || 'Unknown building';

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
      toast({ title: "Error", description: "Could not capture view", variant: "destructive" });
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

      toast({ title: "View saved!", description: `"${name}" has been saved` });
      setShowCreateViewDialog(false);
      setPendingViewState(null);
    } catch (err) {
      console.error('Failed to save view:', err);
      toast({ title: "Error", description: "Could not save view", variant: "destructive" });
      throw err;
    } finally {
      setIsSavingView(false);
    }
  }, [pendingViewState]);

  // Capture issue state (BCF viewpoint + screenshot)
  const captureIssueState = useCallback(() => {
    const screenshot = captureScreenshot();
    const viewpoint = captureViewpoint();
    const selectedObjects = getSelectedObjectIds();

    if (!screenshot) {
      toast({ title: "Could not capture screenshot", variant: "destructive" });
      return;
    }

    setPendingIssueState({ screenshot, viewpoint, selectedObjects });
    setShowCreateIssueDialog(true);
  }, [captureScreenshot, captureViewpoint, getSelectedObjectIds]);

  // Submit issue to database
  const handleSubmitIssue = useCallback(async (data: {
    title: string;
    description: string;
    issueType: string;
    priority: string;
  }) => {
    if (!pendingIssueState || !user || !buildingFmGuid) {
      toast({ title: "Cannot create issue", variant: "destructive" });
      return;
    }

    setIsSubmittingIssue(true);
    try {
      const issueId = crypto.randomUUID();

      // Upload screenshot
      const base64Data = pendingIssueState.screenshot.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });

      const { error: uploadError } = await supabase.storage
        .from('issue-screenshots')
        .upload(`${issueId}.png`, blob, { contentType: 'image/png' });

      if (uploadError) {
        console.error('Screenshot upload failed:', uploadError);
      }

      const { data: urlData } = supabase.storage
        .from('issue-screenshots')
        .getPublicUrl(`${issueId}.png`);

      // Get building name
      const building = allData.find((b: any) => b.fmGuid === buildingFmGuid && b.category === 'Building');
      const resolvedBuildingName = buildingName || building?.commonName || building?.name || 'Unknown building';

      // Insert issue
      const { error: insertError } = await supabase.from('bcf_issues').insert({
        id: issueId,
        title: data.title,
        description: data.description || null,
        issue_type: data.issueType,
        priority: data.priority,
        status: 'open',
        viewpoint_json: pendingIssueState.viewpoint,
        screenshot_url: urlData?.publicUrl || null,
        building_fm_guid: buildingFmGuid,
        building_name: resolvedBuildingName,
        selected_object_ids: pendingIssueState.selectedObjects,
        reported_by: user.id,
      });

      if (insertError) throw insertError;

      toast({ title: "Issue created!", description: `"${data.title}" has been submitted` });
      setShowCreateIssueDialog(false);
      setPendingIssueState(null);
    } catch (err) {
      console.error('Failed to create issue:', err);
      toast({ title: "Could not create issue", variant: "destructive" });
    } finally {
      setIsSubmittingIssue(false);
    }
  }, [pendingIssueState, user, buildingFmGuid, buildingName, allData]);

  // Handle navigating to issue viewpoint with flash effect for selected objects
  const handleGoToIssueViewpoint = useCallback((viewpoint: any, fallbackObjectIds?: string[] | null) => {
    if (!viewpoint) return;
    
    restoreViewpoint(viewpoint, { duration: 1.0 });
    
    // Use BCF viewpoint selection if available, otherwise fall back to issue.selected_object_ids
    const bcfSelection = viewpoint.components?.selection?.map((s: any) => s.ifc_guid) || [];
    const selectedIds = bcfSelection.length > 0 ? bcfSelection : (fallbackObjectIds || []);
    
    if (selectedIds.length > 0) {
      setTimeout(() => {
        const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
        if (xeokitViewer?.scene) {
          const scene = xeokitViewer.scene;
          
          // 1. Ensure objects are visible
          scene.setObjectsVisible(selectedIds, true);
          
          // 2. Select the objects in 3D (clear previous selection first)
          scene.setObjectsSelected(scene.selectedObjectIds, false);
          scene.setObjectsSelected(selectedIds, true);
          
          // 3. Flash for visual feedback
          flashEntitiesByIds(scene, selectedIds, { 
            duration: 3000,
            color1: [1, 0.2, 0.2],
            color2: [1, 1, 1],
          });
        }
      }, 1100);
    }
  }, [restoreViewpoint, viewerRef, flashEntitiesByIds]);

  // Handle selecting an issue from the list
  const handleSelectIssue = useCallback((issue: BcfIssue) => {
    setSelectedIssue(issue);
    setShowIssueDetail(true);
    // Close the issue list to prevent overlap with the detail sheet
    setShowIssueList(false);
    
    // Navigate to the viewpoint if available with flash effect, pass selected_object_ids as fallback
    if (issue.viewpoint_json) {
      handleGoToIssueViewpoint(issue.viewpoint_json, issue.selected_object_ids);
    }
  }, [handleGoToIssueViewpoint]);

  // Listen for issue marker clicks from 3D viewer annotations
  useEffect(() => {
    const handler = async (e: Event) => {
      const { issueId } = (e as CustomEvent<IssueMarkerClickedDetail>).detail;
      // Fetch the full issue
      const { data: issue } = await supabase
        .from('bcf_issues')
        .select('*')
        .eq('id', issueId)
        .maybeSingle();
      if (issue) {
        handleSelectIssue(issue as BcfIssue);
      }
    };
    window.addEventListener(ISSUE_MARKER_CLICKED_EVENT, handler);
    return () => window.removeEventListener(ISSUE_MARKER_CLICKED_EVENT, handler);
  }, [handleSelectIssue]);

  // isAdmin now provided by useAuth() above

  // Tool visibility check
  const isToolVisible = useCallback((toolId: string) => {
    const setting = toolSettings.find(t => t.id === toolId);
    return setting?.visible ?? true;
  }, [toolSettings]);

  // Drag handlers removed — now a fixed right sidebar

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
      handleSetIsOpen(false); // Close panel on sufficient swipe
    }
    setTouchStart(null);
    setTouchDelta(0);
  }, [touchDelta]);

  const handleToggleSpaces = useCallback(() => {
    const newValue = !showSpaces;
    // Use callback if controlled, otherwise local state
    if (onShowSpacesChange) {
      onShowSpacesChange(newValue);
    } else {
      setLocalShowSpaces(newValue);
      try {
        const assetViewer = viewerRef.current?.assetViewer;
        assetViewer?.onShowSpacesChanged?.(newValue);
      } catch (e) {
        console.debug("Toggle spaces failed:", e);
      }
    }
  }, [viewerRef, showSpaces, onShowSpacesChange]);

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
    handleSetIsOpen(false);
    onAddAsset?.();
  }, [onAddAsset]);

  // Handle visible floors change from floor selector
  // Notify parent of floor changes (parent decides whether to reset showSpaces)
  const handleVisibleFloorsChange = useCallback((visibleFloorIds: string[]) => {
    console.log("Visible floors changed:", visibleFloorIds);
    onVisibleFloorsChange?.(visibleFloorIds);
  }, [onVisibleFloorsChange]);

  const containerClassName = cn(
    inline ? "" : "absolute top-4 right-4 z-20",
    isMobile && !isOpen && !inline ? "hidden" : "",
    className
  );

  // Shared content JSX used by both mobile Drawer and desktop sidebar
  const toolbarContent = (
    <div className="space-y-2 sm:space-y-3">
      {/* BIM Models - click to open side panel */}
      <div className="flex items-center justify-between py-1.5">
        <div className="flex items-center gap-2">
          <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
            <Box className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </div>
          <span className="text-xs sm:text-sm">BIM models</span>
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
          <span className="text-xs sm:text-sm">Floors</span>
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

      <Separator />

      {/* Visibility section */}
      <div>
        <Label className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-1.5 sm:mb-2 block">
          Visibility
        </Label>

        <div className="space-y-2 sm:space-y-3">
          {/* 2D Plan View Toggle */}
          <div className="flex items-center justify-between py-1.5 sm:py-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className={cn("p-1 sm:p-1.5 rounded-md", is2DMode ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <SquareDashed className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm">2D/3D</span>
            </div>
            <Switch checked={is2DMode} onCheckedChange={handle2DModeToggle} />
          </div>

          {/* Model Tree Toggle */}
          {onToggleTreeView && (
            <div className="flex items-center justify-between py-1.5 sm:py-2">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className={cn("p-1 sm:p-1.5 rounded-md", showTreeView ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  <TreeDeciduous className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <span className="text-xs sm:text-sm">Model tree</span>
              </div>
              <Switch checked={showTreeView} onCheckedChange={(checked) => onToggleTreeView(checked)} />
            </div>
          )}

          {isToolVisible('spaces') && (
            <>
            <div className="flex items-center justify-between py-1.5 sm:py-2">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className={cn("p-1 sm:p-1.5 rounded-md", showSpaces ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <span className="text-xs sm:text-sm">Show spaces</span>
              </div>
              <Switch checked={showSpaces} onCheckedChange={handleToggleSpaces} />
            </div>

            {/* Room Labels — shown under Show Spaces when spaces are active */}
            {showSpaces && (
              <div className="ml-7 sm:ml-9 space-y-1.5 pb-1">
                <div className="flex items-center gap-2">
                  <div className={cn("p-1 rounded-md", showRoomLabels ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                    <Type className="h-3 w-3" />
                  </div>
                  <span className="text-xs">Room labels</span>
                </div>
                <div className="pl-6">
                  {loadingRoomLabelConfigs ? (
                    <div className="text-xs text-muted-foreground">Loading...</div>
                  ) : (
                    <Select
                      value={showRoomLabels && activeRoomLabelConfigId ? activeRoomLabelConfigId : 'off'}
                      onValueChange={handleRoomLabelConfigSelect}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="Off" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        {roomLabelConfigs.map((config) => (
                          <SelectItem key={config.id} value={config.id}>
                            {config.name}{config.is_default ? ' (default)' : ''}
                          </SelectItem>
                        ))}
                        {roomLabelConfigs.length === 0 && (
                          <SelectItem value="__none" disabled>No configurations</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            )}
            </>
          )}

          {/* X-ray Toggle */}
          {isToolVisible('xray') && (
            <XrayToggle viewerRef={viewerRef} />
          )}

          {isToolVisible('annotations') && (
            <div className="flex items-center justify-between py-1.5 sm:py-2">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className={cn("p-1 sm:p-1.5 rounded-md", showAnnotations ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <span className="text-xs sm:text-sm">Show annotations</span>
              </div>
              <div className="flex items-center gap-1">
                <Switch checked={showAnnotations} onCheckedChange={handleToggleAnnotations} />
                <Button
                  variant={activeSubMenu === 'annotations' ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setActiveSubMenu(activeSubMenu === 'annotations' ? null : 'annotations')}
                >
                  <ChevronRight className={cn(
                    "h-3 w-3 transition-transform",
                    activeSubMenu === 'annotations' && "rotate-180"
                  )} />
                </Button>
              </div>
            </div>
          )}

          {isToolVisible('visualization') && onToggleVisualization && (
            <RoomVisualizationList
              showVisualization={showVisualization}
              onToggleVisualization={handleToggleVisualization}
            />
          )}
        </div>
      </div>

      <Separator />

      {/* Viewer Settings - Collapsible Section */}
      <Collapsible open={viewerSettingsOpen} onOpenChange={setViewerSettingsOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center justify-between w-full py-2 hover:bg-muted/50 rounded-md transition-colors px-1">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
                <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm font-medium">Viewer settings</span>
            </div>
            <ChevronDown className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              viewerSettingsOpen && "rotate-180"
            )} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          {/* Clip height slider */}
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center gap-2 sm:gap-3 mb-1">
              <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
                <Scissors className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm">Clip height (2D view)</span>
              <span className="text-xs font-medium ml-auto">{clipHeight.toFixed(1)}m</span>
            </div>
            <div className="pl-8 sm:pl-10">
              <Slider value={[clipHeight]} onValueChange={handleClipHeightChange} min={0.5} max={2.5} step={0.1} className="w-full" />
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Height above floor</p>
            </div>
          </div>

          {/* 3D Ceiling clip height slider */}
          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center gap-2 sm:gap-3 mb-1">
              <div className={cn("p-1 sm:p-1.5 rounded-md", isSoloFloor && !is2DMode ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <Box className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm">Ceiling clip (3D solo)</span>
              <span className="text-xs font-medium ml-auto">{clipHeight3D >= 0 ? '+' : ''}{clipHeight3D.toFixed(1)}m</span>
            </div>
            <div className="pl-8 sm:pl-10">
              <Slider value={[clipHeight3D]} onValueChange={handleClipHeight3DChange} min={-1.5} max={1.5} step={0.1} className="w-full" disabled={is2DMode || !isSoloFloor} />
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
                {isSoloFloor && !is2DMode ? "Offset from next floor level" : "Enabled when a single floor is isolated in 3D"}
              </p>
            </div>
          </div>

          {/* Room Labels moved to under Show Spaces toggle */}

          {/* Viewer Theme Selector */}
          <ViewerThemeSelector viewerRef={viewerRef} disabled={!isViewerReady} />

          {/* Background color palette */}
          <div className="py-1.5 sm:py-2">
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
                <Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm">Background color</span>
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
                      architectBackground === preset.id ? "border-primary ring-2 ring-primary/30" : "border-border/40"
                    )}
                    style={{ background: `linear-gradient(180deg, rgb(255, 255, 255) 0%, ${preset.bottom} 100%)` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Floor Pills Toggle */}
          <div className="flex items-center justify-between py-1.5 sm:py-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className={cn("p-1 sm:p-1.5 rounded-md", showFloorPills ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm">Floor switcher (pills)</span>
            </div>
            <Switch
              checked={showFloorPills}
              onCheckedChange={(checked) => {
                setShowFloorPills(checked);
                localStorage.setItem('viewer-show-floor-pills', String(checked));
                window.dispatchEvent(new CustomEvent(FLOOR_PILLS_TOGGLE_EVENT, { detail: { visible: checked } }));
              }}
            />
          </div>

          {/* Lighting Controls */}
          <LightingControlsPanel viewerRef={viewerRef} isViewerReady={isViewerReady} />

          {/* Object Color Filter Rules */}
          <ObjectColorFilterPanel viewerRef={viewerRef} buildingFmGuid={buildingFmGuid} />
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* Actions section */}
      <div>
        <Label className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-1.5 sm:mb-2 block">
          Actions
        </Label>

        <div className="space-y-1">
          {/* Create View button */}
          <Button variant="outline" className="w-full justify-start gap-2 sm:gap-3 h-9 sm:h-10" onClick={captureViewState} disabled={!isViewerReady}>
            <div className="p-1 sm:p-1.5 rounded-md bg-primary/10 text-primary">
              <Camera className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <span className="text-xs sm:text-sm">Create view</span>
          </Button>

          {/* Create Issue button */}
          {isToolVisible('issues') && (
            <Button variant="outline" className="w-full justify-start gap-2 sm:gap-3 h-9 sm:h-10" onClick={captureIssueState} disabled={!isViewerReady}>
              <div className="p-1 sm:p-1.5 rounded-md bg-primary/10 text-primary">
                <MessageSquarePlus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm">Create issue</span>
            </Button>
          )}

          {/* Issue List button */}
          {isToolVisible('issues') && (
            <Button
              variant="outline"
              className={cn("w-full justify-between gap-2 sm:gap-3 h-9 sm:h-10", showIssueList && "bg-primary/10 border-primary/30")}
              onClick={() => setShowIssueList(!showIssueList)}
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className={cn("p-1 sm:p-1.5 rounded-md", showIssueList ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <span className="text-xs sm:text-sm">Issues</span>
              </div>
              <ChevronRight className={cn("h-3 w-3 transition-transform", showIssueList && "rotate-180")} />
            </Button>
          )}

          {/* Asset Panel button — dispatches event to parent */}
          <Button
            variant="outline"
            className="w-full justify-between gap-2 sm:gap-3 h-9 sm:h-10"
            onClick={() => window.dispatchEvent(new CustomEvent('TOGGLE_ASSET_PANEL'))}
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1 sm:p-1.5 rounded-md bg-muted text-muted-foreground">
                <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm">Asset panel</span>
            </div>
            <ChevronRight className="h-3 w-3" />
          </Button>

          {isToolVisible('addAsset') && onAddAsset && (
            <Button variant="outline" className="w-full justify-start gap-2 sm:gap-3 h-9 sm:h-10" onClick={handleAddAsset}>
              <div className="p-1 sm:p-1.5 rounded-md bg-primary/10 text-primary">
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm">Register asset</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );

    return (
      <div className={containerClassName}>
        {/* Trigger button - positioned at top right */}
        {!isOpen && (
          <Button
            variant="secondary"
            size="icon"
            title="Display"
            onClick={() => handleSetIsOpen(true)}
            className={cn(
              "shadow-lg bg-card/95 backdrop-blur-sm border",
              "h-8 w-8 sm:h-10 sm:w-10",
            )}
          >
            <MoreVertical className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
        )}

        {/* Mobile: Bottom Drawer */}
        {isOpen && isMobile && (
          <Drawer open={isOpen} onOpenChange={handleSetIsOpen}>
            <DrawerContent className="max-h-[92dvh]">
              <DrawerHeader className="py-2 px-3">
                <DrawerTitle className="text-sm">Display</DrawerTitle>
              </DrawerHeader>
              <div className="px-3 pb-3 overflow-y-auto max-h-[85dvh]">
                {toolbarContent}
              </div>
            </DrawerContent>
          </Drawer>
        )}

        {/* Desktop: Fixed right sidebar panel */}
        {isOpen && !isMobile && (
          <>
            {/* Backdrop — click outside to close */}
            <div className="fixed inset-0 z-[59]" onClick={() => handleSetIsOpen(false)} />
            <div className="fixed right-0 top-0 h-full w-[288px] sm:w-[320px] z-[60] bg-card border-l border-border flex flex-col text-white [&_*]:text-inherit [&_.text-muted-foreground]:text-white/60 [&_.text-foreground]:text-white">
            <TooltipProvider delayDuration={300}>
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-3 border-b shrink-0">
                <span className="font-medium text-sm">Display</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => handleSetIsOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Content - scrollable */}
              <div ref={scrollWrapRef} className="relative flex-1 min-h-0 overflow-hidden">
                <ScrollArea className="h-full p-3">
                  {toolbarContent}
                </ScrollArea>

                {/* Always-visible edge indicator on the panel's right edge */}
                <EdgeScrollIndicator viewport={scrollViewportEl} />
              </div>
            </TooltipProvider>
            </div>
          
          {/* Side-pop panel for BIM Models */}
          <SidePopPanel
            isOpen={activeSubMenu === 'models'}
            onClose={() => setActiveSubMenu(null)}
            title="BIM models"
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
            title="Floors"
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
          
          {/* Side-pop panel for Annotation Categories */}
          <SidePopPanel
            isOpen={activeSubMenu === 'annotations'}
            onClose={() => setActiveSubMenu(null)}
            title="Annotation types"
            parentPosition={position}
            parentWidth={panelWidth}
          >
            <AnnotationCategoryList
              viewerRef={viewerRef}
              buildingFmGuid={buildingFmGuid}
            />
          </SidePopPanel>
          
          {/* Floating Issue List Panel */}
          <FloatingIssueListPanel
            isOpen={showIssueList}
            onClose={() => setShowIssueList(false)}
            buildingFmGuid={buildingFmGuid}
            onSelectIssue={handleSelectIssue}
            onCreateIssue={captureIssueState}
            parentPosition={position}
            parentWidth={panelWidth}
          />
          
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
          
          {/* Create Issue Dialog */}
          <CreateIssueDialog
            open={showCreateIssueDialog}
            onClose={() => {
              setShowCreateIssueDialog(false);
              setPendingIssueState(null);
            }}
            onSubmit={handleSubmitIssue}
            screenshotUrl={pendingIssueState?.screenshot}
            buildingName={buildingName}
            isSubmitting={isSubmittingIssue}
            selectedObjectIds={pendingIssueState?.selectedObjects}
          />
          
          {/* Issue Detail Sheet */}
          <IssueDetailSheet
            issue={selectedIssue}
            open={showIssueDetail}
            onClose={() => {
              setShowIssueDetail(false);
              setSelectedIssue(null);
            }}
            onGoToViewpoint={handleGoToIssueViewpoint}
            isAdmin={isAdmin}
          />
        </>
        )}

        {/* Mobile: Side-pop panels rendered as Drawers (handled inside SidePopPanel) */}
        {isOpen && isMobile && (
          <>
            <SidePopPanel
              isOpen={activeSubMenu === 'models'}
              onClose={() => setActiveSubMenu(null)}
              title="BIM models"
              parentPosition={position}
              parentWidth={panelWidth}
            >
              <ModelVisibilitySelector viewerRef={viewerRef} buildingFmGuid={buildingFmGuid} listOnly={true} />
            </SidePopPanel>

            <SidePopPanel
              isOpen={activeSubMenu === 'floors'}
              onClose={() => setActiveSubMenu(null)}
              title="Floors"
              parentPosition={position}
              parentWidth={panelWidth}
            >
              <FloorVisibilitySelector viewerRef={viewerRef} buildingFmGuid={buildingFmGuid} isViewerReady={isViewerReady} onVisibleFloorsChange={handleVisibleFloorsChange} enableClipping={true} listOnly={true} />
            </SidePopPanel>

            <SidePopPanel
              isOpen={activeSubMenu === 'annotations'}
              onClose={() => setActiveSubMenu(null)}
              title="Annotation types"
              parentPosition={position}
              parentWidth={panelWidth}
            >
              <AnnotationCategoryList viewerRef={viewerRef} buildingFmGuid={buildingFmGuid} />
            </SidePopPanel>



            <FloatingIssueListPanel isOpen={showIssueList} onClose={() => setShowIssueList(false)} buildingFmGuid={buildingFmGuid} onSelectIssue={handleSelectIssue} onCreateIssue={captureIssueState} parentPosition={position} parentWidth={panelWidth} />

            <CreateViewDialog open={showCreateViewDialog} onClose={() => { setShowCreateViewDialog(false); setPendingViewState(null); }} onSave={handleSaveView} viewState={pendingViewState} isSaving={isSavingView} />

            <CreateIssueDialog open={showCreateIssueDialog} onClose={() => { setShowCreateIssueDialog(false); setPendingIssueState(null); }} onSubmit={handleSubmitIssue} screenshotUrl={pendingIssueState?.screenshot} buildingName={buildingName} isSubmitting={isSubmittingIssue} selectedObjectIds={pendingIssueState?.selectedObjects} />

            <IssueDetailSheet issue={selectedIssue} open={showIssueDetail} onClose={() => { setShowIssueDetail(false); setSelectedIssue(null); }} onGoToViewpoint={handleGoToIssueViewpoint} isAdmin={isAdmin} />
          </>
        )}
      </div>
    );
};

export default VisualizationToolbar;
