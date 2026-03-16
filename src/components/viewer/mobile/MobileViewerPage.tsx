/**
 * MobileViewerPage — ACC/Dalux-inspired fullscreen mobile viewer.
 *
 * Layout:
 *  ┌─────────────────────────────┐
 *  │ × [Building] [modes] [☰]   │  ← Transparent gradient topbar
 *  │                             │
 *  │    NativeViewerShell        │  ← Real xeokit 3D canvas (edge-to-edge)
 *  │                             │
 *  │ ┄┄  Plan 1 │ Plan 2 │ …  ┄ │  ← Compact floor pills
 *  │ [🔄][✋][⬡][📐][✂️][⚡] [⚙] │  ← Compact bottom toolbar
 *  └─────────────────────────────┘
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Menu, Orbit, Hand, Maximize, MousePointer, Ruler,
  Scissors, Square, Box, LayoutPanelLeft, View,
  Filter, SlidersHorizontal, BarChart2, AlertTriangle,
  Settings, ChevronRight, Eye, Loader2, Scan, User,
  Compass, PenTool, RotateCcw, Layers, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import NativeViewerShell from '@/components/viewer/NativeViewerShell';
import SplitPlanView from '@/components/viewer/SplitPlanView';
import InsightsDrawerPanel from '@/components/viewer/InsightsDrawerPanel';
import { useFloorData, type FloorInfo } from '@/hooks/useFloorData';
import { getDescendantIds, calculateFloorBounds } from '@/hooks/useFloorVisibility';
import type { ViewMode } from '@/pages/UnifiedViewer';
import {
  VIEW_MODE_2D_TOGGLED_EVENT,
  VIEW_MODE_REQUESTED_EVENT,
  VIEWER_TOOL_CHANGED_EVENT,
  type ViewerToolChangedDetail,
} from '@/lib/viewer-events';
import {
  FLOOR_SELECTION_CHANGED_EVENT,
  type FloorSelectionEventDetail,
} from '@/hooks/useSectionPlaneClipping';
import type { LocalCoords } from '@/context/ViewerSyncContext';
import type { IvionBimTransform } from '@/lib/ivion-bim-transform';
import type { useBuildingViewerData } from '@/hooks/useBuildingViewerData';

/* ── All available tools (configurable) ── */
const ALL_TOOLS: { id: string; Icon: React.FC<any>; label: string }[] = [
  { id: 'orbit', Icon: Orbit, label: 'Orbit' },
  { id: 'pan', Icon: Hand, label: 'Pan' },
  { id: 'fit', Icon: Maximize, label: 'Fit' },
  { id: 'resetView', Icon: RotateCcw, label: 'Reset View' },
  { id: 'select', Icon: MousePointer, label: 'Select' },
  { id: 'measure', Icon: Ruler, label: 'Measure' },
  { id: 'section', Icon: Scissors, label: 'Section' },
  { id: 'xray', Icon: Scan, label: 'X-Ray' },
  { id: 'firstPerson', Icon: User, label: 'First Person' },
  { id: 'navCube', Icon: Compass, label: 'Nav Cube' },
  { id: 'markup', Icon: PenTool, label: 'Markup' },
];

const DEFAULT_ENABLED = ['orbit', 'pan', 'fit', 'resetView', 'select', 'measure', 'section'];

/* ── Action Sheet menu items ── */
const MENU_ITEMS = [
  { id: 'viewMode', Icon: Box, label: 'View Mode', hasSubmenu: true },
  { id: 'filter', Icon: Filter, label: 'Filter' },
  { id: 'visualization', Icon: SlidersHorizontal, label: 'Visualization' },
  { id: 'insights', Icon: BarChart2, label: 'Insights' },
  { id: 'issues', Icon: AlertTriangle, label: 'Issues' },
  { id: 'settings', Icon: Settings, label: 'Settings' },
];

const getViewer = () => (window as any).__nativeXeokitViewer;

interface MobileViewerPageProps {
  buildingData: NonNullable<ReturnType<typeof useBuildingViewerData>['buildingData']>;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  sdkStatus: string;
  ivApiRef: React.MutableRefObject<any>;
  sdkContainerRef: React.RefObject<HTMLDivElement | null>;
  transform: IvionBimTransform;
  handle3DCameraChange: (pos: LocalCoords, heading: number, pitch: number) => void;
  sync3DPosition: LocalCoords | null;
  sync3DHeading: number;
  sync3DPitch: number;
  hasIvion: boolean;
  hasFmAccess: boolean;
  floorFmGuid: string | null;
  floorName: string;
  entityFmGuid: string | null;
  visualizationParam: import('@/lib/visualization-utils').VisualizationType | null;
  insightsMode: string | null;
  forceXray: boolean;
  onGoBack: () => void;
  viewerInstanceRef: React.MutableRefObject<any>;
  viewerReady: boolean;
  insightsPanelOpen: boolean;
  setInsightsPanelOpen: (v: boolean) => void;
}

const MobileViewerPage: React.FC<MobileViewerPageProps> = ({
  buildingData,
  viewMode,
  setViewMode,
  sdkContainerRef,
  hasIvion,
  onGoBack,
  viewerInstanceRef,
  viewerReady,
  insightsPanelOpen,
  setInsightsPanelOpen,
}) => {
  const isSplit = viewMode === 'split2d3d';
  const [splitPlanReady, setSplitPlanReady] = useState(false);
  const [activeTool, setActiveTool] = useState('orbit');
  const [isXrayActive, setIsXrayActive] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [subSheet, setSubSheet] = useState<'viewMode' | 'toolbarConfig' | null>(null);
  const [enabledTools, setEnabledTools] = useState<string[]>(DEFAULT_ENABLED);
  const [soloFloorId, setSoloFloorId] = useState<string | null>(null);

  // Floor data
  const { floors } = useFloorData(viewerInstanceRef, buildingData.fmGuid);

  // Reset splitPlanReady when leaving split mode
  useEffect(() => {
    if (!isSplit) setSplitPlanReady(false);
  }, [isSplit]);

  useEffect(() => {
    if (!isSplit || !viewerReady) return;
    const timer = setTimeout(() => setSplitPlanReady(true), 400);
    return () => clearTimeout(timer);
  }, [isSplit, viewerReady]);

  const modes: { mode: ViewMode; label: string; Icon: React.FC<any> }[] = [
    { mode: '2d', label: '2D', Icon: Square },
    { mode: 'split2d3d', label: '2D/3D', Icon: LayoutPanelLeft },
    { mode: '3d', label: '3D', Icon: Box },
  ];
  if (hasIvion) modes.push({ mode: '360', label: '360°', Icon: View });

  const handleModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode === '2d') {
      window.dispatchEvent(new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: true } }));
      window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '2d' } }));
    } else if (mode === '3d') {
      window.dispatchEvent(new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: false } }));
      window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
    } else if (mode === 'split2d3d') {
      window.dispatchEvent(new CustomEvent(VIEW_MODE_2D_TOGGLED_EVENT, { detail: { enabled: false } }));
      window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: '3d' } }));
    }
  }, [setViewMode]);

  /* ── Real xeokit tool handlers ── */
  const handleToolClick = useCallback((toolId: string) => {
    const viewer = getViewer();

    // One-shot actions don't change activeTool
    if (toolId === 'fit') {
      if (viewer?.cameraFlight && viewer?.scene) {
        viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.5 });
      }
      return;
    }

    if (toolId === 'resetView') {
      if (viewer?.scene) {
        // Deselect all
        const selected = viewer.scene.selectedObjectIds || [];
        if (selected.length > 0) viewer.scene.setObjectsSelected(selected, false);
        // Un-xray all
        const xrayed = viewer.scene.xrayedObjectIds || [];
        if (xrayed.length > 0) viewer.scene.setObjectsXRayed(xrayed, false);
        setIsXrayActive(false);
        // Show all objects
        viewer.scene.setObjectsVisible(viewer.scene.objectIds, true);
        // Fly to full scene
        if (viewer.cameraFlight) {
          viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.5 });
        }
        // Reset floor solo
        setSoloFloorId(null);
        window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
          detail: { floorId: null, isAllFloorsVisible: true, isSoloFloor: false } as FloorSelectionEventDetail,
        }));
      }
      // Reset to orbit mode
      if (viewer?.cameraControl) {
        viewer.cameraControl.navMode = 'orbit';
        viewer.cameraControl.followPointer = true;
      }
      setActiveTool('orbit');
      window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, {
        detail: { tool: null } as ViewerToolChangedDetail,
      }));
      return;
    }

    if (toolId === 'xray') {
      const next = !isXrayActive;
      setIsXrayActive(next);
      if (viewer?.scene) {
        const ids = viewer.scene.objectIds || [];
        if (next) {
          const xrayMaterial = viewer.scene.xrayMaterial;
          if (xrayMaterial) {
            xrayMaterial.fill = true;
            xrayMaterial.fillAlpha = 0.15;
            xrayMaterial.edges = true;
            xrayMaterial.edgeAlpha = 0.4;
          }
        }
        viewer.scene.setObjectsXRayed(ids, next);
      }
      return;
    }

    setActiveTool(toolId);

    switch (toolId) {
      case 'orbit':
        if (viewer?.cameraControl) {
          viewer.cameraControl.navMode = 'orbit';
          viewer.cameraControl.followPointer = true;
        }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, {
          detail: { tool: null } as ViewerToolChangedDetail,
        }));
        break;
      case 'pan':
        if (viewer?.cameraControl) {
          viewer.cameraControl.navMode = 'pan';
        }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, {
          detail: { tool: null } as ViewerToolChangedDetail,
        }));
        break;
      case 'select':
        // Set orbit mode so click-picking works on the canvas
        if (viewer?.cameraControl) {
          viewer.cameraControl.navMode = 'orbit';
          viewer.cameraControl.followPointer = true;
        }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, {
          detail: { tool: 'select' } as ViewerToolChangedDetail,
        }));
        break;
      case 'measure':
        if (viewer?.cameraControl) {
          viewer.cameraControl.navMode = 'orbit';
          viewer.cameraControl.followPointer = true;
        }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, {
          detail: { tool: 'measure' } as ViewerToolChangedDetail,
        }));
        break;
      case 'section':
        if (viewer?.cameraControl) {
          viewer.cameraControl.navMode = 'orbit';
          viewer.cameraControl.followPointer = true;
        }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, {
          detail: { tool: 'slicer' } as ViewerToolChangedDetail,
        }));
        break;
      case 'firstPerson':
        if (viewer?.cameraControl) {
          viewer.cameraControl.navMode = 'firstPerson';
          viewer.cameraControl.followPointer = true;
          viewer.cameraControl.constrainVertical = true;
        }
        window.dispatchEvent(new CustomEvent(VIEWER_TOOL_CHANGED_EVENT, {
          detail: { tool: null } as ViewerToolChangedDetail,
        }));
        break;
    }
  }, [isXrayActive, soloFloorId]);

  /* ── Floor selection ── */
  const handleFloorClick = useCallback((floor: FloorInfo) => {
    const viewer = getViewer();
    const isSolo = soloFloorId === floor.id;

    if (isSolo) {
      // Deselect → show all
      setSoloFloorId(null);
      if (viewer?.scene) {
        viewer.scene.setObjectsVisible(viewer.scene.objectIds, true);
      }
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
        detail: {
          floorId: null,
          isAllFloorsVisible: true,
          isSoloFloor: false,
        } as FloorSelectionEventDetail,
      }));
    } else {
      // Solo this floor
      setSoloFloorId(floor.id);
      if (viewer?.scene) {
        // Hide all, then show descendants of this floor's metaObjectIds
        viewer.scene.setObjectsVisible(viewer.scene.objectIds, false);
        floor.metaObjectIds.forEach(moId => {
          const descendants = getDescendantIds(viewer, moId);
          viewer.scene.setObjectsVisible(descendants, true);
        });
      }
      const bounds = calculateFloorBounds(viewer, floor.id);
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
        detail: {
          floorId: floor.id,
          floorName: floor.name,
          bounds,
          visibleMetaFloorIds: floor.metaObjectIds,
          visibleFloorFmGuids: floor.databaseLevelFmGuids,
          isAllFloorsVisible: false,
          isSoloFloor: true,
          soloFloorName: floor.name,
        } as FloorSelectionEventDetail,
      }));
    }
  }, [soloFloorId]);

  /* ── Menu item handlers ── */
  const handleMenuItem = useCallback((id: string) => {
    switch (id) {
      case 'viewMode':
        setSubSheet('viewMode');
        break;
      case 'filter':
        setSheetOpen(false);
        setTimeout(() => window.dispatchEvent(new Event('MOBILE_TOGGLE_FILTER_PANEL')), 200);
        break;
      case 'visualization':
        setSheetOpen(false);
        setTimeout(() => window.dispatchEvent(new Event('MOBILE_TOGGLE_VIZ_MENU')), 200);
        break;
      case 'insights':
        setSheetOpen(false);
        setTimeout(() => setInsightsPanelOpen(true), 200);
        break;
      case 'issues':
        setSheetOpen(false);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('OPEN_ISSUE_LIST'));
        }, 200);
        break;
      case 'settings':
        setSheetOpen(false);
        break;
    }
  }, [setInsightsPanelOpen]);

  const visibleTools = ALL_TOOLS.filter((t) => enabledTools.includes(t.id));
  const modeLabel = modes.find(m => m.mode === viewMode)?.label ?? '3D';

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-black"
      style={{
        height: '100dvh',
        width: '100vw',
        touchAction: 'none',
        overscrollBehavior: 'none',
      }}
    >
      {/* ── 3D Canvas (edge-to-edge, behind overlays) ── */}
      <div className="absolute inset-0">
        {isSplit ? (
          <>
            {/* Top: 2D Plan */}
            <div className="absolute top-0 left-0 right-0 overflow-hidden" style={{ height: '50%' }}>
              <div className="h-full w-full" style={{ visibility: splitPlanReady ? 'visible' : 'hidden' }}>
                <SplitPlanView
                  viewerRef={viewerInstanceRef}
                  buildingFmGuid={buildingData.fmGuid}
                  className="h-full"
                  syncFloorSelection={true}
                  lockCameraToFloor={true}
                  monochrome
                />
              </div>
              {!splitPlanReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="absolute left-0 right-0 z-30 h-1 bg-border" style={{ top: '50%', transform: 'translateY(-50%)' }} />
            {/* Bottom: 3D */}
            <div className="absolute left-0 right-0 bottom-0 overflow-hidden" style={{ height: '50%' }}>
              <NativeViewerShell
                buildingFmGuid={buildingData.fmGuid}
                onClose={onGoBack}
                hideBackButton
                hideMobileOverlay
                hideToolbar
                hideFloorSwitcher
                showGeminusMenu={false}
              />
            </div>
          </>
        ) : viewMode === '360' && hasIvion ? (
          <div ref={sdkContainerRef} className="h-full w-full" />
        ) : (
          <NativeViewerShell
            buildingFmGuid={buildingData.fmGuid}
            onClose={onGoBack}
            hideBackButton
            hideMobileOverlay
            hideToolbar
            hideFloorSwitcher
            showGeminusMenu={viewMode === '3d'}
          />
        )}
      </div>

      {/* ── Transparent top bar ── */}
      <div
        className="relative z-50 flex items-center justify-between px-3 pointer-events-none"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)',
          paddingBottom: '6px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 100%)',
        }}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={onGoBack}
          className="h-8 w-8 text-white hover:bg-white/20 pointer-events-auto"
        >
          <X className="h-5 w-5" />
        </Button>

        {/* Building name / current mode label */}
        <span className="text-white text-xs font-medium truncate max-w-[50vw] pointer-events-none">
          {buildingData.name}
        </span>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => { setSubSheet(null); setSheetOpen(true); }}
          className="h-8 w-8 text-white hover:bg-white/20 pointer-events-auto"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Floor popover pill (centered above toolbar) ── */}
      {floors.length > 1 && !isSplit && (
        <div className="relative z-50 flex justify-center pb-1 pointer-events-none">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-medium hover:bg-black/70 transition-colors"
              >
                <Layers className="h-3.5 w-3.5" />
                {soloFloorId
                  ? floors.find(f => f.id === soloFloorId)?.shortName || 'All'
                  : 'All'}
                <ChevronUp className="h-3 w-3 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              sideOffset={8}
              className="w-auto min-w-[120px] max-w-[200px] p-1.5 bg-popover/95 backdrop-blur-md"
            >
              <div className="flex flex-col gap-0.5 max-h-[40dvh] overflow-y-auto">
                {floors.map((floor) => (
                  <button
                    key={floor.id}
                    onClick={() => handleFloorClick(floor)}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                      soloFloorId === floor.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    {floor.name}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* ── Compact bottom toolbar ── */}
      <div
        className="relative z-50 flex items-center justify-around pointer-events-none"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
          paddingTop: '12px',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
          background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)',
        }}
      >
        {visibleTools.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => handleToolClick(id)}
            className={`pointer-events-auto flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-colors ${
              activeTool === id
                ? 'text-primary'
                : id === 'xray' && isXrayActive
                  ? 'text-primary'
                  : 'text-white/70 hover:text-white'
            }`}
            title={label}
          >
            <Icon className="h-5 w-5" />
          </button>
        ))}

        {/* Settings gear */}
        <button
          onClick={() => { setSubSheet('toolbarConfig'); setSheetOpen(true); }}
          className="pointer-events-auto flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-colors text-white/50 hover:text-white"
          title="Toolbar Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* ── Action Sheet (Drawer) ── */}
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[85dvh]">
          {subSheet === null && (
            <>
              <DrawerHeader className="pb-2">
                <DrawerTitle className="text-base">Menu</DrawerTitle>
              </DrawerHeader>
              <div className="px-2 pb-6 space-y-0.5">
                {MENU_ITEMS.map(({ id, Icon, label, hasSubmenu }) => (
                  <button
                    key={id}
                    onClick={() => handleMenuItem(id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg hover:bg-muted/60 transition-colors"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground flex-1 text-left">{label}</span>
                    {id === 'viewMode' && (
                      <span className="text-xs text-muted-foreground">{modeLabel}</span>
                    )}
                    {hasSubmenu && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {subSheet === 'viewMode' && (
            <>
              <DrawerHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSubSheet(null)} className="h-7 px-2">
                    ← Back
                  </Button>
                  <DrawerTitle className="text-base">View Mode</DrawerTitle>
                </div>
              </DrawerHeader>
              <div className="px-2 pb-6 space-y-0.5">
                {modes.map(({ mode, label, Icon }) => (
                  <button
                    key={mode}
                    onClick={() => {
                      handleModeChange(mode);
                      setSubSheet(null);
                      setSheetOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-4 rounded-lg transition-colors ${
                      viewMode === mode ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60 text-foreground'
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium flex-1 text-left">{label}</span>
                    {viewMode === mode && <Eye className="h-4 w-4 text-primary" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {subSheet === 'toolbarConfig' && (
            <>
              <DrawerHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSubSheet(null)} className="h-7 px-2">
                    ← Back
                  </Button>
                  <DrawerTitle className="text-base">Toolbar</DrawerTitle>
                </div>
              </DrawerHeader>
              <div className="px-2 pb-6 space-y-0.5">
                {ALL_TOOLS.map(({ id, Icon, label }) => (
                  <div key={id} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg">
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground flex-1 text-left">{label}</span>
                    <Switch
                      checked={enabledTools.includes(id)}
                      onCheckedChange={() =>
                        setEnabledTools(prev =>
                          prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>

      {/* ── Insights panel ── */}
      {insightsPanelOpen && (
        <InsightsDrawerPanel
          buildingFmGuid={buildingData.fmGuid}
          buildingName={buildingData.name}
          open={insightsPanelOpen}
          onClose={() => setInsightsPanelOpen(false)}
        />
      )}
    </div>
  );
};

export default MobileViewerPage;
