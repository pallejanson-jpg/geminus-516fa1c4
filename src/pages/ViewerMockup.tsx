/**
 * ViewerMockup — ACC/Dalux-inspired mobile viewer layout with REAL 3D engine.
 *
 * Layout:
 *  ┌─────────────────────────────┐
 *  │ × [Building Name] 3D   [☰] │  ← Transparent topbar, ~32px
 *  │                             │
 *  │    NativeViewerShell        │  ← Real xeokit 3D canvas
 *  │                             │
 *  │ [🏠][✋][⬡][📐][✂️][⚡][⚙️]  │  ← Compact bottom toolbar, ~44px
 *  └─────────────────────────────┘
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  X, Menu, Orbit, Hand, Maximize, MousePointer, Ruler,
  Scissors, Square, Box, LayoutPanelLeft, View,
  Layers, Filter, SlidersHorizontal, BarChart2,
  AlertTriangle, Settings, ChevronRight, Eye,
  Upload, Scan, Navigation, Compass, PenTool, User,
  Loader2, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';
import NativeViewerShell from '@/components/viewer/NativeViewerShell';
import { useBuildingViewerData } from '@/hooks/useBuildingViewerData';
import { useContext } from 'react';
import { AppContext } from '@/context/AppContext';
import { emit } from '@/lib/event-bus';
import {
  VIEWER_TOOL_CHANGED_EVENT,
  VIEW_MODE_REQUESTED_EVENT,
  type ViewerToolChangedDetail,
} from '@/lib/viewer-events';

/* ── Types ── */
type ViewMode = '2d' | '2d3d' | '3d' | '3d360' | '360';

const VIEW_MODES: { mode: ViewMode; label: string; Icon: React.FC<any>; requires360?: boolean }[] = [
  { mode: '2d', label: '2D', Icon: Square },
  { mode: '2d3d', label: '2D + 3D', Icon: LayoutPanelLeft },
  { mode: '3d', label: '3D', Icon: Box },
  { mode: '3d360', label: '3D + 360', Icon: View, requires360: true },
  { mode: '360', label: '360', Icon: View, requires360: true },
];

/* ── All available tools (for toolbar config) ── */
const ALL_TOOLS: { id: string; Icon: React.FC<any>; label: string }[] = [
  { id: 'orbit', Icon: Orbit, label: 'Orbit' },
  { id: 'pan', Icon: Hand, label: 'Pan' },
  { id: 'fit', Icon: Maximize, label: 'Fit' },
  { id: 'select', Icon: MousePointer, label: 'Select' },
  { id: 'measure', Icon: Ruler, label: 'Measure' },
  { id: 'section', Icon: Scissors, label: 'Section' },
  { id: 'xray', Icon: Scan, label: 'X-Ray' },
  { id: 'firstPerson', Icon: User, label: 'First Person' },
  { id: 'navCube', Icon: Compass, label: 'Nav Cube' },
  { id: 'markup', Icon: PenTool, label: 'Markup' },
];

const DEFAULT_ENABLED = ['orbit', 'pan', 'fit', 'select', 'measure', 'section'];

/* ── Action Sheet menu items ── */
const MENU_ITEMS = [
  { id: 'viewMode', Icon: Box, label: 'View Mode', hasSubmenu: true },
  { id: 'filter', Icon: Filter, label: 'Filter' },
  { id: 'visualization', Icon: SlidersHorizontal, label: 'Visualization' },
  { id: 'insights', Icon: BarChart2, label: 'Insights' },
  { id: 'issues', Icon: AlertTriangle, label: 'Issues' },
  { id: 'openIfc', Icon: Upload, label: 'Open IFC', hasSubmenu: false },
  { id: 'settings', Icon: Settings, label: 'Settings' },
];

/* ── Helper: get xeokit viewer from global ref ── */
const getViewer = () => (window as any).__nativeXeokitViewer;

const ViewerMockup: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const buildingFmGuid = searchParams.get('building');
  const { allData } = useContext(AppContext);

  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [activeTool, setActiveTool] = useState('orbit');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [subSheet, setSubSheet] = useState<'viewMode' | 'toolbarConfig' | null>(null);
  const [enabledTools, setEnabledTools] = useState<string[]>(DEFAULT_ENABLED);
  const [isXrayActive, setIsXrayActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get building data
  const { buildingData, isLoading, error } = useBuildingViewerData(buildingFmGuid);

  const buildingName = buildingData?.name || 'Building';
  const hasIvionSiteId = !!buildingData?.ivionSiteId;
  const modeLabel = VIEW_MODES.find((m) => m.mode === viewMode)?.label ?? '3D';

  /* ── Real xeokit tool handlers ── */

  const handleToolClick = useCallback((toolId: string) => {
    const viewer = getViewer();
    setActiveTool(toolId);

    switch (toolId) {
      case 'orbit':
        if (viewer?.cameraControl) {
          viewer.cameraControl.navMode = 'orbit';
          viewer.cameraControl.followPointer = false;
        }
        // Clear active tool
        emit('VIEWER_TOOL_CHANGED', { tool: null } as ViewerToolChangedDetail,);
        break;

      case 'pan':
        if (viewer?.cameraControl) {
          viewer.cameraControl.navMode = 'planView';
        }
        emit('VIEWER_TOOL_CHANGED', { tool: null } as ViewerToolChangedDetail,);
        break;

      case 'fit':
        if (viewer?.cameraFlight && viewer?.scene) {
          viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.5 });
        }
        break;

      case 'select':
        emit('VIEWER_TOOL_CHANGED', { tool: 'select' } as ViewerToolChangedDetail,);
        break;

      case 'measure':
        emit('VIEWER_TOOL_CHANGED', { tool: 'measure' } as ViewerToolChangedDetail,);
        break;

      case 'section':
        emit('VIEWER_TOOL_CHANGED', { tool: 'slicer' } as ViewerToolChangedDetail,);
        break;

      case 'xray': {
        const next = !isXrayActive;
        setIsXrayActive(next);
        if (viewer?.scene) {
          const ids = viewer.scene.objectIds || [];
          viewer.scene.setObjectsXRayed(ids, next);
        }
        break;
      }

      case 'firstPerson':
        if (viewer?.cameraControl) {
          viewer.cameraControl.navMode = 'firstPerson';
          viewer.cameraControl.followPointer = true;
          viewer.cameraControl.constrainVertical = true;
        }
        emit('VIEWER_TOOL_CHANGED', { tool: null } as ViewerToolChangedDetail,);
        break;

      case 'navCube':
        toast.info('Nav Cube toggled');
        break;

      case 'markup':
        toast.info('Markup mode — coming soon');
        break;
    }
  }, [isXrayActive]);

  /* ── Menu item handlers ── */

  const handleMenuItem = useCallback((id: string) => {
    switch (id) {
      case 'viewMode':
        setSubSheet('viewMode');
        break;

      case 'filter':
        setSheetOpen(false);
        // Toggle the filter panel in NativeViewerShell
        setTimeout(() => {
          window.dispatchEvent(new Event('MOBILE_TOGGLE_FILTER_PANEL'));
        }, 200);
        break;

      case 'visualization':
        setSheetOpen(false);
        setTimeout(() => {
          window.dispatchEvent(new Event('MOBILE_TOGGLE_VIZ_MENU'));
        }, 200);
        break;

      case 'insights':
        setSheetOpen(false);
        setTimeout(() => {
          window.dispatchEvent(new Event('MOBILE_TOGGLE_VIZ_MENU'));
        }, 200);
        break;

      case 'issues':
        setSheetOpen(false);
        setTimeout(() => {
          window.dispatchEvent(new Event('MOBILE_TOGGLE_VIZ_MENU'));
          setTimeout(() => {
            emit('OPEN_ISSUE_LIST');
          }, 300);
        }, 200);
        break;

      case 'openIfc':
        setSheetOpen(false);
        setTimeout(() => fileInputRef.current?.click(), 300);
        break;

      case 'settings':
        setSheetOpen(false);
        toast.info('Settings — coming soon');
        break;
    }
  }, []);

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      toast.success(`IFC loaded (local only): ${file.name}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleTool = (toolId: string) => {
    setEnabledTools((prev) =>
      prev.includes(toolId) ? prev.filter((t) => t !== toolId) : [...prev, toolId]
    );
  };

  const visibleTools = ALL_TOOLS.filter((t) => enabledTools.includes(t.id));

  // Handle view mode change
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    // Dispatch to the real viewer
    if (mode === '2d' || mode === '3d') {
      emit('VIEW_MODE_REQUESTED', { mode },);
    }
  }, []);

  // Loading / error states
  if (!buildingFmGuid) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black text-white">
        <p>No building selected</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-white/50" />
      </div>
    );
  }

  if (error || !buildingData) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black text-white">
        <p>Building not found</p>
      </div>
    );
  }

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
      {/* Hidden file input for Open IFC */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc,.xkt"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* ── Real 3D canvas (NativeViewerShell) ── */}
      <div className="absolute inset-0">
        <NativeViewerShell
          buildingFmGuid={buildingData.fmGuid}
          onClose={() => navigate(-1)}
          hideBackButton
          hideMobileOverlay
          hideToolbar
          hideFloorSwitcher={false}
          showGeminusMenu={false}
        />
      </div>

      {/* ── Transparent top bar ── */}
      <div
        className="relative z-50 flex items-center justify-between px-3"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)',
          paddingBottom: '6px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 100%)',
        }}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="h-8 w-8 text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-white text-sm font-medium truncate max-w-[180px]">
            {buildingName}
          </span>
          <span className="text-white/60 text-xs">{modeLabel}</span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => { setSubSheet(null); setSheetOpen(true); }}
          className="h-8 w-8 text-white hover:bg-white/20"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Compact bottom toolbar (edge-to-edge / transparent) ── */}
      <div
        className="relative z-50 flex items-center justify-around pointer-events-none"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
          paddingTop: '16px',
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

        {/* Settings gear — always visible */}
        <button
          onClick={() => { setSubSheet('toolbarConfig'); setSheetOpen(true); }}
          className="pointer-events-auto flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-colors text-white/50 hover:text-white"
          title="Toolbar Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* ── Action Sheet ── */}
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
                {VIEW_MODES.map(({ mode, label, Icon, requires360 }) => {
                  const disabled = requires360 && !hasIvionSiteId;
                  return (
                    <button
                      key={mode}
                      onClick={() => {
                        if (disabled) {
                          toast.error('Requires 360 connection — set Ivion Site ID in building settings');
                          return;
                        }
                        handleViewModeChange(mode);
                        setSubSheet(null);
                        setSheetOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-4 rounded-lg transition-colors ${
                        disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : viewMode === mode ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60 text-foreground'
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <div className="flex-1 text-left">
                        <span className="text-sm font-medium">{label}</span>
                        {disabled && <p className="text-xs text-muted-foreground">Requires 360 connection</p>}
                      </div>
                      {viewMode === mode && !disabled && <Eye className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
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
                  <div
                    key={id}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-lg"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground flex-1 text-left">{label}</span>
                    <Switch
                      checked={enabledTools.includes(id)}
                      onCheckedChange={() => toggleTool(id)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
};

export default ViewerMockup;
