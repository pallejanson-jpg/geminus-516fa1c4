import React, { useState, useEffect, useCallback, useContext, useRef } from "react";
import {
  Layers, MessageSquare, MessageSquarePlus, Palette, Plus, X, Scissors,
  Box, ChevronDown, Camera, SquareDashed, Settings, Type, TreeDeciduous, Eye, EyeOff, Check, Settings2,
  Pin, PinOff
} from "lucide-react";
import { useFlashHighlight } from "@/hooks/useFlashHighlight";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { getVisualizationToolSettings, ToolConfig, TOOLBAR_SETTINGS_CHANGED_EVENT } from "./ToolbarSettings";
import FloorVisibilitySelector from "./FloorVisibilitySelector";
import ModelVisibilitySelector from "./ModelVisibilitySelector";
import AnnotationCategoryList from "./AnnotationCategoryList";
import CreateViewDialog from "./CreateViewDialog";
import CreateIssueDialog from "./CreateIssueDialog";
import FloatingIssueListPanel, { type BcfIssue } from "./FloatingIssueListPanel";
import IssueDetailSheet from "./IssueDetailSheet";
import ViewerThemeSelector from "./ViewerThemeSelector";
import RoomVisualizationPanel from "./RoomVisualizationPanel";
import XrayToggle from "./XrayToggle";
import LightingControlsPanel from "./LightingControlsPanel";
import { CLIP_HEIGHT_CHANGED_EVENT, VIEW_MODE_CHANGED_EVENT } from "@/hooks/useSectionPlaneClipping";
import { CLIP_HEIGHT_3D_CHANGED_EVENT } from "@/hooks/useSectionPlaneClipping";
import { FORCE_SHOW_SPACES_EVENT } from "./RoomVisualizationPanel";
import { VIEW_MODE_REQUESTED_EVENT } from "@/lib/viewer-events";
import { ARCHITECT_BACKGROUND_CHANGED_EVENT, ARCHITECT_BACKGROUND_PRESETS, type BackgroundPresetId } from "@/hooks/useArchitectViewMode";
import { AppContext } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useBcfViewpoints } from "@/hooks/useBcfViewpoints";
import { ROOM_LABELS_TOGGLE_EVENT, ROOM_LABELS_CONFIG_EVENT, type RoomLabelsConfigDetail } from "@/hooks/useRoomLabels";
import { useRoomLabelConfigs } from "@/hooks/useRoomLabelConfigs";
import { FLOOR_PILLS_TOGGLE_EVENT } from "./FloatingFloorSwitcher";
import { MINIMAP_TOGGLE_EVENT } from "@/lib/viewer-events";
import { Map } from "lucide-react";

interface ViewerRightPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
  buildingName?: string;
  isViewerReady?: boolean;
  showSpaces?: boolean;
  onShowSpacesChange?: (show: boolean) => void;
  visibleFloorFmGuids?: string[];
  onVisibleFloorsChange?: (visibleFloorIds: string[]) => void;
  visibleModelIds?: string[];
  visibleFloorIds?: string[];
  onToggleTreeView?: (visible: boolean) => void;
  showTreeView?: boolean;
  onAddAsset?: () => void;
  initialFloorFmGuid?: string;
  /** Controlled annotation visibility from parent */
  showAnnotations?: boolean;
  /** Callback when annotations toggle changes */
  onShowAnnotationsChange?: (show: boolean) => void;
}

/**
 * Sheet-based right side panel for the 3D viewer.
 * Consolidates all viewer tools: BIM models, floors, display toggles,
 * room visualization, viewer settings, and actions.
 */
const ViewerRightPanel: React.FC<ViewerRightPanelProps> = ({
  isOpen,
  onOpenChange,
  viewerRef,
  buildingFmGuid,
  buildingName,
  isViewerReady = true,
  showSpaces: externalShowSpaces,
  onShowSpacesChange,
  visibleFloorFmGuids,
  onVisibleFloorsChange,
  visibleModelIds = [],
  visibleFloorIds = [],
  onToggleTreeView,
  showTreeView = false,
  onAddAsset,
  initialFloorFmGuid,
  showAnnotations: externalShowAnnotations,
  onShowAnnotationsChange,
}) => {
  const { allData } = useContext(AppContext);
  const { user, isAdmin } = useAuth();
  const isMobile = useIsMobile();

  // BCF viewpoint hook
  const { captureViewpoint, captureScreenshot, getSelectedObjectIds, restoreViewpoint } = useBcfViewpoints({ viewerRef });
  const { flashEntitiesByIds } = useFlashHighlight();

  // Use controlled state if provided, otherwise local state
  const [localShowSpaces, setLocalShowSpaces] = useState(false);
  const showSpaces = externalShowSpaces !== undefined ? externalShowSpaces : localShowSpaces;
  // Use controlled annotation state if provided, otherwise local state
  const [localShowAnnotations, setLocalShowAnnotations] = useState(false);
  const showAnnotations = externalShowAnnotations !== undefined ? externalShowAnnotations : localShowAnnotations;
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
  const [showIssueList, setShowIssueList] = useState(false);

  // Collapsible section states
  const [modelsOpen, setModelsOpen] = useState(false);
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);       // Collapsed by default
  const [roomVizOpen, setRoomVizOpen] = useState(false);       // Collapsed by default
  const [actionsOpen, setActionsOpen] = useState(false);        // Collapsed by default

  // Clipping height state
  const [clipHeight, setClipHeight] = useState(1.2);
  const [is2DMode, setIs2DMode] = useState(false);
  const [clipHeight3D, setClipHeight3D] = useState(0);
  const [isSoloFloor, setIsSoloFloor] = useState(false);

  // Viewer settings collapsible state
  const [viewerSettingsOpen, setViewerSettingsOpen] = useState(false);
  const [architectBackground, setArchitectBackground] = useState<BackgroundPresetId>('sage');
  const [showRoomLabels, setShowRoomLabels] = useState(false);
  const [activeRoomLabelConfigId, setActiveRoomLabelConfigId] = useState<string | null>(null);
  const [showFloorPills, setShowFloorPills] = useState(() => {
    return localStorage.getItem('viewer-show-floor-pills') !== 'false';
  });

  // Pinned state - persisted in localStorage
  const [isPinned, setIsPinned] = useState(() => {
    return localStorage.getItem('viewer-right-panel-pinned') === 'true';
  });

  const togglePinned = useCallback(() => {
    setIsPinned(prev => {
      const next = !prev;
      localStorage.setItem('viewer-right-panel-pinned', String(next));
      return next;
    });
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && isPinned) return; // Don't close when pinned
    onOpenChange(open);
  }, [isPinned, onOpenChange]);

  const { configs: roomLabelConfigs, loading: loadingRoomLabelConfigs } = useRoomLabelConfigs();

  // Tool visibility check
  const isToolVisible = useCallback((toolId: string) => {
    const setting = toolSettings.find(t => t.id === toolId);
    return setting?.visible ?? true;
  }, [toolSettings]);

  // Handlers
  const handleClipHeightChange = useCallback((value: number[]) => {
    const newHeight = value[0];
    setClipHeight(newHeight);
    window.dispatchEvent(new CustomEvent(CLIP_HEIGHT_CHANGED_EVENT, { detail: { height: newHeight } }));
  }, []);

  const handleClipHeight3DChange = useCallback((value: number[]) => {
    const newOffset = value[0];
    setClipHeight3D(newOffset);
    window.dispatchEvent(new CustomEvent(CLIP_HEIGHT_3D_CHANGED_EVENT, { detail: { offset: newOffset } }));
  }, []);

  const handle2DModeToggle = useCallback((enabled: boolean) => {
    window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: enabled ? '2d' : '3d' } }));
  }, []);

  const handleBackgroundChange = useCallback((presetId: BackgroundPresetId) => {
    setArchitectBackground(presetId);
    window.dispatchEvent(new CustomEvent(ARCHITECT_BACKGROUND_CHANGED_EVENT, { detail: { presetId } }));
  }, []);

  const handleRoomLabelsToggle = useCallback((enabled: boolean, configId?: string) => {
    setShowRoomLabels(enabled);
    if (enabled && configId) {
      setActiveRoomLabelConfigId(configId);
      const config = roomLabelConfigs.find(c => c.id === configId);
      if (config) {
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
    window.dispatchEvent(new CustomEvent(ROOM_LABELS_TOGGLE_EVENT, { detail: { enabled } }));
  }, [roomLabelConfigs]);

  const handleRoomLabelConfigSelect = useCallback((configId: string) => {
    if (configId === 'off') handleRoomLabelsToggle(false);
    else handleRoomLabelsToggle(true, configId);
  }, [handleRoomLabelsToggle]);

  const handleToggleSpaces = useCallback(() => {
    const newValue = !showSpaces;
    if (onShowSpacesChange) {
      onShowSpacesChange(newValue);
    } else {
      setLocalShowSpaces(newValue);
      try {
        viewerRef.current?.assetViewer?.onShowSpacesChanged?.(newValue);
      } catch (e) { /* ignore */ }
    }
  }, [viewerRef, showSpaces, onShowSpacesChange]);

  const handleToggleAnnotations = useCallback(() => {
    const newValue = !showAnnotations;
    if (onShowAnnotationsChange) {
      onShowAnnotationsChange(newValue);
    } else {
      setLocalShowAnnotations(newValue);
    }
    try {
      viewerRef.current?.assetViewer?.onToggleAnnotation?.(newValue);
    } catch (e) { /* ignore */ }
  }, [viewerRef, showAnnotations, onShowAnnotationsChange]);

  const handleVisibleFloorsChange = useCallback((floorIds: string[]) => {
    onVisibleFloorsChange?.(floorIds);
  }, [onVisibleFloorsChange]);

  // Capture current view state for saving
  const captureViewState = useCallback(async () => {
    const viewer = viewerRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer || !buildingFmGuid) {
      toast({ title: "Kan inte skapa vy", description: "Viewer är inte redo", variant: "destructive" });
      return;
    }
    try {
      const canvas = xeokitViewer.scene?.canvas?.canvas;
      if (!canvas) {
        toast({ title: "Kan inte skapa vy", description: "Canvas inte tillgängligt", variant: "destructive" });
        return;
      }
      xeokitViewer.scene?.render?.(true);
      const screenshotDataUrl = canvas.toDataURL('image/png');
      const camera = xeokitViewer.camera;
      const building = allData.find((b: any) => b.fmGuid === buildingFmGuid && b.category === 'Building');
      const resolvedBuildingName = buildingName || building?.commonName || building?.name || 'Okänd byggnad';
      const viewState = {
        buildingFmGuid,
        buildingName: resolvedBuildingName,
        screenshotDataUrl,
        cameraEye: [...camera.eye],
        cameraLook: [...camera.look],
        cameraUp: [...camera.up],
        cameraProjection: camera.projection,
        viewMode: is2DMode ? '2d' : '3d',
        clipHeight,
        visibleModelIds,
        visibleFloorIds,
        showSpaces,
        showAnnotations,
        visualizationType: 'none',
        visualizationMockData: false,
      };
      setPendingViewState(viewState);
      setShowCreateViewDialog(true);
    } catch (err) {
      console.error('Failed to capture view state:', err);
      toast({ title: "Fel", description: "Kunde inte fånga vyn", variant: "destructive" });
    }
  }, [viewerRef, buildingFmGuid, buildingName, allData, is2DMode, clipHeight, visibleModelIds, visibleFloorIds, showSpaces, showAnnotations]);

  const handleSaveView = useCallback(async (name: string, description: string) => {
    if (!pendingViewState) return;
    setIsSavingView(true);
    try {
      const viewId = crypto.randomUUID();
      const base64Data = pendingViewState.screenshotDataUrl.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      const { error: uploadError } = await supabase.storage.from('saved-view-screenshots').upload(`${viewId}.png`, blob, { contentType: 'image/png' });
      if (uploadError) console.error('Screenshot upload failed:', uploadError);
      const { data: urlData } = supabase.storage.from('saved-view-screenshots').getPublicUrl(`${viewId}.png`);
      const { error: insertError } = await supabase.from('saved_views').insert({
        id: viewId, name, description: description || null,
        building_fm_guid: pendingViewState.buildingFmGuid, building_name: pendingViewState.buildingName,
        screenshot_url: urlData?.publicUrl || null,
        camera_eye: pendingViewState.cameraEye, camera_look: pendingViewState.cameraLook,
        camera_up: pendingViewState.cameraUp, camera_projection: pendingViewState.cameraProjection,
        view_mode: pendingViewState.viewMode, clip_height: pendingViewState.clipHeight,
        visible_model_ids: pendingViewState.visibleModelIds, visible_floor_ids: pendingViewState.visibleFloorIds,
        show_spaces: pendingViewState.showSpaces, show_annotations: pendingViewState.showAnnotations,
        visualization_type: pendingViewState.visualizationType, visualization_mock_data: pendingViewState.visualizationMockData,
      });
      if (insertError) throw insertError;
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

  // Issue creation
  const captureIssueState = useCallback(() => {
    const screenshot = captureScreenshot();
    const viewpoint = captureViewpoint();
    const selectedObjects = getSelectedObjectIds();
    if (!screenshot) { toast({ title: "Kunde inte ta skärmdump", variant: "destructive" }); return; }
    setPendingIssueState({ screenshot, viewpoint, selectedObjects });
    setShowCreateIssueDialog(true);
  }, [captureScreenshot, captureViewpoint, getSelectedObjectIds]);

  const handleSubmitIssue = useCallback(async (data: { title: string; description: string; issueType: string; priority: string }) => {
    if (!pendingIssueState || !user || !buildingFmGuid) {
      toast({ title: "Kan inte skapa ärende", variant: "destructive" }); return;
    }
    setIsSubmittingIssue(true);
    try {
      const issueId = crypto.randomUUID();
      const base64Data = pendingIssueState.screenshot.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      const { error: uploadError } = await supabase.storage.from('issue-screenshots').upload(`${issueId}.png`, blob, { contentType: 'image/png' });
      if (uploadError) console.error('Screenshot upload failed:', uploadError);
      const { data: urlData } = supabase.storage.from('issue-screenshots').getPublicUrl(`${issueId}.png`);
      const building = allData.find((b: any) => b.fmGuid === buildingFmGuid && b.category === 'Building');
      const resolvedBuildingName = buildingName || building?.commonName || building?.name || 'Okänd byggnad';
      const { error: insertError } = await supabase.from('bcf_issues').insert({
        id: issueId, title: data.title, description: data.description || null,
        issue_type: data.issueType, priority: data.priority, status: 'open',
        viewpoint_json: pendingIssueState.viewpoint, screenshot_url: urlData?.publicUrl || null,
        building_fm_guid: buildingFmGuid, building_name: resolvedBuildingName,
        selected_object_ids: pendingIssueState.selectedObjects, reported_by: user.id,
      });
      if (insertError) throw insertError;
      toast({ title: "Ärende skapat!", description: `"${data.title}" har skickats` });
      setShowCreateIssueDialog(false);
      setPendingIssueState(null);
    } catch (err) {
      console.error('Failed to create issue:', err);
      toast({ title: "Kunde inte skapa ärende", variant: "destructive" });
    } finally {
      setIsSubmittingIssue(false);
    }
  }, [pendingIssueState, user, buildingFmGuid, buildingName, allData]);

  const handleGoToIssueViewpoint = useCallback((viewpoint: any) => {
    if (!viewpoint) return;
    restoreViewpoint(viewpoint, { duration: 1.0 });
    if (viewpoint.components?.selection?.length > 0) {
      const selectedIds = viewpoint.components.selection.map((s: any) => s.ifc_guid);
      setTimeout(() => {
        const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
        if (xeokitViewer?.scene) {
          const scene = xeokitViewer.scene;
          scene.setObjectsVisible(selectedIds, true);
          scene.setObjectsSelected(scene.selectedObjectIds, false);
          scene.setObjectsSelected(selectedIds, true);
          flashEntitiesByIds(scene, selectedIds, { duration: 3000, color1: [1, 0.2, 0.2], color2: [1, 1, 1] });
        }
      }, 1100);
    }
  }, [restoreViewpoint, viewerRef, flashEntitiesByIds]);

  const handleSelectIssue = useCallback((issue: BcfIssue) => {
    setSelectedIssue(issue);
    setShowIssueDetail(true);
    if (issue.viewpoint_json) handleGoToIssueViewpoint(issue.viewpoint_json);
  }, [handleGoToIssueViewpoint]);

  return (
    <>
      <Sheet open={isOpen} onOpenChange={handleOpenChange} modal={isMobile}>
        <SheetContent side="right" className="w-[280px] sm:w-[320px] md:w-[340px] p-0 bg-card backdrop-blur-md [&>button:last-child]:hidden">
          <SheetHeader className="p-4 pb-2 border-b">
            <SheetTitle className="flex items-center justify-between text-base">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Visning
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={togglePinned}
                  title={isPinned ? "Lossa panelen" : "Fäst panelen"}
                >
                  {isPinned ? <Pin className="h-3.5 w-3.5 text-primary" /> : <PinOff className="h-3.5 w-3.5 text-foreground/70" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleOpenChange(false)}
                  title="Stäng"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </SheetTitle>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-80px)]">
            <div className="p-4 space-y-3">

              {/* Floors - FIRST (highest priority) */}
              <Collapsible open={floorsOpen} onOpenChange={setFloorsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between h-10 px-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4" />
                      <span className="font-medium text-sm">Våningsplan</span>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", floorsOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pl-2 pt-2">
                    <FloorVisibilitySelector
                      viewerRef={viewerRef}
                      buildingFmGuid={buildingFmGuid}
                      isViewerReady={isViewerReady}
                      onVisibleFloorsChange={handleVisibleFloorsChange}
                      enableClipping={true}
                      listOnly={true}
                      initialFloorFmGuid={initialFloorFmGuid}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* BIM Models - Collapsible */}
              <Collapsible open={modelsOpen} onOpenChange={setModelsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between h-10 px-2">
                    <div className="flex items-center gap-2">
                      <Box className="h-4 w-4" />
                      <span className="font-medium text-sm">BIM-modeller</span>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", modelsOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pl-2 pt-2">
                    <ModelVisibilitySelector viewerRef={viewerRef} buildingFmGuid={buildingFmGuid} listOnly={true} />
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Separator />

              {/* Display Section - Collapsible, expanded by default */}
              <Collapsible open={displayOpen} onOpenChange={setDisplayOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between h-10 px-2">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      <span className="font-medium text-sm">Visa</span>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", displayOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                <div className="space-y-3 pt-2">
                  {/* 2D/3D Toggle */}
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <div className={cn("p-1.5 rounded-md", is2DMode ? "bg-primary/10 text-primary" : "bg-muted text-foreground/70")}>
                        <SquareDashed className="h-4 w-4" />
                      </div>
                      <span className="text-sm">2D/3D</span>
                    </div>
                    <Switch checked={is2DMode} onCheckedChange={handle2DModeToggle} />
                  </div>

                  {/* Model Tree Toggle */}
                  {onToggleTreeView && (
                    <div className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <div className={cn("p-1.5 rounded-md", showTreeView ? "bg-primary/10 text-primary" : "bg-muted text-foreground/70")}>
                          <TreeDeciduous className="h-4 w-4" />
                        </div>
                        <span className="text-sm">Modellträd</span>
                      </div>
                      <Switch checked={showTreeView} onCheckedChange={(checked) => onToggleTreeView(checked)} />
                    </div>
                  )}

                  {/* Show Spaces Toggle - always visible */}
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <div className={cn("p-1.5 rounded-md", showSpaces ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                        {showSpaces ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </div>
                      <span className="text-sm">Visa rum</span>
                    </div>
                    <Switch checked={showSpaces} onCheckedChange={handleToggleSpaces} />
                  </div>

                  {/* X-ray Toggle */}
                  <XrayToggle viewerRef={viewerRef} />

                  {/* Minimap Toggle */}
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-muted text-muted-foreground">
                        <Map className="h-4 w-4" />
                      </div>
                      <span className="text-sm">Minimap</span>
                    </div>
                    <Switch
                      onCheckedChange={(checked) => {
                        window.dispatchEvent(new CustomEvent(MINIMAP_TOGGLE_EVENT, { detail: { visible: checked } }));
                      }}
                    />
                  </div>

                  {/* Annotations Toggle + Category List */}
                  {isToolVisible('annotations') && (
                    <Collapsible open={annotationsOpen} onOpenChange={setAnnotationsOpen}>
                      <div className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2">
                          <div className={cn("p-1.5 rounded-md", showAnnotations ? "bg-primary/10 text-primary" : "bg-muted text-foreground/70")}>
                            <MessageSquare className="h-4 w-4" />
                          </div>
                          <span className="text-sm">Annotationer</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Switch checked={showAnnotations} onCheckedChange={handleToggleAnnotations} />
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                              <ChevronDown className={cn("h-3 w-3 transition-transform", annotationsOpen && "rotate-180")} />
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                      </div>
                      <CollapsibleContent>
                        <div className="pl-8 pt-1">
                          <AnnotationCategoryList viewerRef={viewerRef} buildingFmGuid={buildingFmGuid} />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
                </CollapsibleContent>
              </Collapsible>

              <Separator />

              {/* Room Visualization - Collapsible, collapsed by default */}
              {buildingFmGuid && (
                <Collapsible open={roomVizOpen} onOpenChange={setRoomVizOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between h-10 px-2">
                      <div className="flex items-center gap-2">
                        <Palette className="h-4 w-4" />
                        <span className="font-medium text-sm">Rumsvisualisering</span>
                      </div>
                      <ChevronDown className={cn("h-4 w-4 transition-transform", roomVizOpen && "rotate-180")} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pt-2">
                      <RoomVisualizationPanel
                        viewerRef={viewerRef}
                        buildingFmGuid={buildingFmGuid}
                        onShowSpaces={onShowSpacesChange}
                        visibleFloorFmGuids={visibleFloorFmGuids && visibleFloorFmGuids.length > 0 ? visibleFloorFmGuids : undefined}
                        embedded={true}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              <Separator />

              {/* Viewer Settings - Collapsible */}
              <Collapsible open={viewerSettingsOpen} onOpenChange={setViewerSettingsOpen}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-between w-full py-2 hover:bg-muted/50 rounded-md transition-colors px-1">
                    <div className="flex items-center gap-2">
                       <div className="p-1.5 rounded-md bg-muted text-muted-foreground">
                        <Settings className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-medium">Viewer settings</span>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", viewerSettingsOpen && "rotate-180")} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  {/* Clip height slider (2D) */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="p-1.5 rounded-md bg-muted text-foreground/70"><Scissors className="h-4 w-4" /></div>
                      <span className="text-sm">Klipphöjd (2D-vy)</span>
                      <span className="text-xs font-medium ml-auto">{clipHeight.toFixed(1)}m</span>
                    </div>
                    <div className="pl-10">
                      <Slider value={[clipHeight]} onValueChange={handleClipHeightChange} min={0.5} max={2.5} step={0.1} className="w-full" />
                      <p className="text-xs text-foreground/70 mt-1">Höjd ovanför golv</p>
                    </div>
                  </div>

                  {/* 3D Ceiling clip */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className={cn("p-1.5 rounded-md", isSoloFloor && !is2DMode ? "bg-primary/10 text-primary" : "bg-muted text-foreground/70")}>
                        <Box className="h-4 w-4" />
                      </div>
                      <span className="text-sm">Takklipp (3D Solo)</span>
                      <span className="text-xs font-medium ml-auto">{clipHeight3D >= 0 ? '+' : ''}{clipHeight3D.toFixed(1)}m</span>
                    </div>
                    <div className="pl-10">
                      <Slider value={[clipHeight3D]} onValueChange={handleClipHeight3DChange} min={-1.5} max={1.5} step={0.1} className="w-full" disabled={is2DMode || !isSoloFloor} />
                       <p className="text-xs text-foreground/70 mt-1">
                        {isSoloFloor && !is2DMode ? "Offset från nästa vånings golv" : "Aktiveras när en våning är isolerad i 3D"}
                      </p>
                    </div>
                  </div>

                  {/* Room Labels Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className={cn("p-1.5 rounded-md", showRoomLabels ? "bg-primary/10 text-primary" : "bg-muted text-foreground/70")}>
                        <Type className="h-4 w-4" />
                      </div>
                      <span className="text-sm">Rumsetiketter</span>
                    </div>
                    <div className="pl-10">
                      {loadingRoomLabelConfigs ? (
                        <div className="text-xs text-foreground/70">Laddar...</div>
                      ) : (
                        <div className="space-y-1">
                          <button
                            className={cn("w-full text-left px-2 py-1 rounded text-xs transition-colors", !showRoomLabels ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50")}
                            onClick={() => handleRoomLabelConfigSelect('off')}
                          >Av</button>
                          {roomLabelConfigs.map((config) => (
                            <button
                              key={config.id}
                              className={cn("w-full text-left px-2 py-1 rounded text-xs transition-colors", activeRoomLabelConfigId === config.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50")}
                              onClick={() => handleRoomLabelConfigSelect(config.id)}
                            >
                              {config.name}
                              {config.is_default && <span className="ml-1 text-[10px] text-foreground/70">(standard)</span>}
                            </button>
                          ))}
                          {roomLabelConfigs.length === 0 && (
                            <div className="text-xs text-foreground/70 py-1">Inga konfigurationer. Skapa i Inställningar.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Viewer Theme Selector */}
                  <ViewerThemeSelector viewerRef={viewerRef} disabled={!isViewerReady} />

                  {/* Background color palette */}
                  <div className="py-1.5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-1.5 rounded-md bg-muted text-foreground/70"><Palette className="h-4 w-4" /></div>
                      <span className="text-sm">Bakgrundsfärg</span>
                    </div>
                    <div className="pl-10">
                      <div className="grid grid-cols-5 gap-1.5">
                        {ARCHITECT_BACKGROUND_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            title={preset.name}
                            onClick={() => handleBackgroundChange(preset.id as BackgroundPresetId)}
                            className={cn(
                              "w-6 h-6 rounded-md border-2 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/50",
                              architectBackground === preset.id ? "border-primary ring-2 ring-primary/30" : "border-border/40"
                            )}
                            style={{ background: `linear-gradient(180deg, rgb(255, 255, 255) 0%, ${preset.bottom} 100%)` }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Floor Pills Toggle */}
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <div className={cn("p-1.5 rounded-md", showFloorPills ? "bg-primary/10 text-primary" : "bg-muted text-foreground/70")}>
                        <Layers className="h-4 w-4" />
                      </div>
                      <span className="text-sm">Våningsväljare (pills)</span>
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
                </CollapsibleContent>
              </Collapsible>

              <Separator />

              {/* Actions section - Collapsible, collapsed by default */}
              <Collapsible open={actionsOpen} onOpenChange={setActionsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between h-10 px-2">
                    <div className="flex items-center gap-2">
                      <Camera className="h-4 w-4" />
                      <span className="font-medium text-sm">Åtgärder</span>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", actionsOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                <div className="space-y-1 pt-2">
                  <Button variant="outline" className="w-full justify-start gap-2 h-10" onClick={captureViewState} disabled={!isViewerReady}>
                    <div className="p-1.5 rounded-md bg-primary/10 text-primary"><Camera className="h-4 w-4" /></div>
                    <span className="text-sm">Skapa vy</span>
                  </Button>
                  <Button variant="outline" className="w-full justify-start gap-2 h-10" onClick={captureIssueState} disabled={!isViewerReady}>
                    <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-600"><MessageSquarePlus className="h-4 w-4" /></div>
                    <span className="text-sm">Skapa ärende</span>
                  </Button>
                  <Button
                    variant={showIssueList ? "secondary" : "outline"}
                    className="w-full justify-between h-10"
                    onClick={() => setShowIssueList(!showIssueList)}
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn("p-1.5 rounded-md", showIssueList ? "bg-primary/10 text-primary" : "bg-muted text-foreground/70")}>
                        <MessageSquare className="h-4 w-4" />
                      </div>
                      <span className="text-sm">Visa ärenden</span>
                    </div>
                  </Button>
                  {isToolVisible('addAsset') && onAddAsset && (
                    <Button variant="outline" className="w-full justify-start gap-2 h-10" onClick={() => { onOpenChange(false); onAddAsset(); }}>
                      <div className="p-1.5 rounded-md bg-primary/10 text-primary"><Plus className="h-4 w-4" /></div>
                      <span className="text-sm">Registrera tillgång</span>
                    </Button>
                  )}
                </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Floating Issue List Panel - independent from Sheet */}
      <FloatingIssueListPanel
        isOpen={showIssueList}
        onClose={() => setShowIssueList(false)}
        buildingFmGuid={buildingFmGuid}
        onSelectIssue={handleSelectIssue}
        onCreateIssue={captureIssueState}
        parentPosition={{ x: typeof window !== 'undefined' ? window.innerWidth - 680 : 400, y: 60 }}
        parentWidth={320}
      />

      {/* Dialogs */}
      <CreateViewDialog
        open={showCreateViewDialog}
        onClose={() => { setShowCreateViewDialog(false); setPendingViewState(null); }}
        onSave={handleSaveView}
        viewState={pendingViewState}
        isSaving={isSavingView}
      />
      <CreateIssueDialog
        open={showCreateIssueDialog}
        onClose={() => { setShowCreateIssueDialog(false); setPendingIssueState(null); }}
        onSubmit={handleSubmitIssue}
        screenshotUrl={pendingIssueState?.screenshot}
        buildingName={buildingName}
        isSubmitting={isSubmittingIssue}
        selectedObjectIds={pendingIssueState?.selectedObjects}
      />
      <IssueDetailSheet
        issue={selectedIssue}
        open={showIssueDetail}
        onClose={() => { setShowIssueDetail(false); setSelectedIssue(null); }}
        onGoToViewpoint={handleGoToIssueViewpoint}
        isAdmin={isAdmin}
      />
    </>
  );
};

export default ViewerRightPanel;
