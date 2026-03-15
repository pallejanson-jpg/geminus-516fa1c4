/**
 * ViewerMockup — ACC/Dalux-inspired mobile viewer layout.
 *
 * Purpose: Iterate on layout before changing the real viewer.
 * Focus: Maximize canvas area with minimal topbar + compact bottom toolbar + action sheet.
 *
 * Layout:
 *  ┌─────────────────────────────┐
 *  │ × [Building Name] 3D   [☰] │  ← Transparent topbar, ~32px
 *  │                             │
 *  │       3D CANVAS             │  ← Maximized area
 *  │                             │
 *  │ [🏠][✋][⬡][📐][✂️][⚡][⚙️]  │  ← Compact bottom toolbar, ~44px
 *  └─────────────────────────────┘
 */

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Menu, Orbit, Hand, Maximize, MousePointer, Ruler,
  Scissors, Square, Box, LayoutPanelLeft, View,
  Layers, Filter, SlidersHorizontal, BarChart2,
  AlertTriangle, Settings, ChevronRight, Eye,
  Upload, Scan, Navigation, Compass, PenTool, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';

/* ── Types ── */
type ViewMode = '2d' | '2d3d' | '3d' | '3d360' | '360';

const VIEW_MODES: { mode: ViewMode; label: string; Icon: React.FC<any>; requires360?: boolean }[] = [
  { mode: '2d', label: '2D', Icon: Square },
  { mode: '2d3d', label: '2D + 3D', Icon: LayoutPanelLeft },
  { mode: '3d', label: '3D', Icon: Box },
  { mode: '3d360', label: '3D + 360', Icon: View, requires360: true },
  { mode: '360', label: '360', Icon: View, requires360: true },
];

const MOCK_FLOORS = ['Roof', 'Floor 3', 'Floor 2', 'Floor 1', 'Lobby', 'Basement'];

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
  { id: 'openIfc', Icon: Upload, label: 'Open IFC', hasSubmenu: false },
  { id: 'filter', Icon: Filter, label: 'Filter' },
  { id: 'visualization', Icon: SlidersHorizontal, label: 'Visualization' },
  { id: 'insights', Icon: BarChart2, label: 'Insights' },
  { id: 'issues', Icon: AlertTriangle, label: 'Issues' },
  { id: 'settings', Icon: Settings, label: 'Settings' },
];

const ViewerMockup: React.FC = () => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [activeTool, setActiveTool] = useState('orbit');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [subSheet, setSubSheet] = useState<'viewMode' | 'toolbarConfig' | null>(null);
  const [selectedFloor, setSelectedFloor] = useState('Floor 1');
  const [enabledTools, setEnabledTools] = useState<string[]>(DEFAULT_ENABLED);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildingName = 'Office Building A';
  const modeLabel = VIEW_MODES.find((m) => m.mode === viewMode)?.label ?? '3D';

  const handleMenuItem = (id: string) => {
    if (id === 'viewMode') {
      setSubSheet('viewMode');
    } else if (id === 'openIfc') {
      setSheetOpen(false);
      setTimeout(() => fileInputRef.current?.click(), 300);
    } else {
      setSheetOpen(false);
    }
  };

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

      {/* ── Fake canvas background ── */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center space-y-2 opacity-30">
          <Box className="h-16 w-16 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground text-sm">3D Canvas</p>
        </div>
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

      {/* ── Selected floor pill (floating) ── */}
      <div className="relative z-50 flex justify-center pb-2 pointer-events-none">
        <div className="pointer-events-auto bg-black/50 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1.5 border border-white/10">
          <Layers className="h-3 w-3 text-white/70" />
          <span className="text-xs font-medium text-white/90">{selectedFloor}</span>
        </div>
      </div>

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
            onClick={() => setActiveTool(id)}
            className={`pointer-events-auto flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-colors ${
              activeTool === id
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
                {VIEW_MODES.map(({ mode, label, Icon }) => (
                  <button
                    key={mode}
                    onClick={() => { setViewMode(mode); setSubSheet(null); setSheetOpen(false); }}
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
