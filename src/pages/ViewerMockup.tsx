/**
 * ViewerMockup — ACC/Dalux-inspirerad mobil viewer layout.
 *
 * Syfte: Iterera på layouten innan vi ändrar riktiga viewern.
 * Fokus: Maximera canvasyta med minimal topbar + kompakt bottom-toolbar + action-sheet.
 *
 * Layout:
 *  ┌─────────────────────────────┐
 *  │ × [Byggnadsnamn] 3D    [☰] │  ← Transparent topbar, ~32px
 *  │                             │
 *  │       3D CANVAS             │  ← Maximerad yta
 *  │                             │
 *  │ [🏠][✋][⬡][📐][✂️][⚡]     │  ← Kompakt bottom-toolbar, ~44px
 *  └─────────────────────────────┘
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Menu, Orbit, Hand, Maximize, MousePointer, Ruler,
  Scissors, Square, Box, LayoutPanelLeft, View,
  Layers, Filter, SlidersHorizontal, BarChart2,
  AlertTriangle, Settings, ChevronRight, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';

/* ── Types ── */
type ViewMode = '2d' | '3d' | 'split2d3d' | '360';

const VIEW_MODES: { mode: ViewMode; label: string; Icon: React.FC<any> }[] = [
  { mode: '2d', label: '2D Plan', Icon: Square },
  { mode: '3d', label: '3D Modell', Icon: Box },
  { mode: 'split2d3d', label: '2D + 3D', Icon: LayoutPanelLeft },
  { mode: '360', label: '360° Panorama', Icon: View },
];

const MOCK_FLOORS = ['Tak', 'Vån 3', 'Vån 2', 'Vån 1', 'Entré', 'Källare'];

/* ── Bottom toolbar tools ── */
const TOOLS = [
  { id: 'orbit', Icon: Orbit, label: 'Orbit' },
  { id: 'pan', Icon: Hand, label: 'Pan' },
  { id: 'fit', Icon: Maximize, label: 'Fit' },
  { id: 'select', Icon: MousePointer, label: 'Välj' },
  { id: 'measure', Icon: Ruler, label: 'Mät' },
  { id: 'section', Icon: Scissors, label: 'Snitt' },
] as const;

/* ── Action Sheet menu items ── */
const MENU_ITEMS = [
  { id: 'viewMode', Icon: Box, label: 'Visningsläge', hasSubmenu: true },
  { id: 'floors', Icon: Layers, label: 'Våningar', hasSubmenu: true },
  { id: 'filter', Icon: Filter, label: 'Filter' },
  { id: 'visualization', Icon: SlidersHorizontal, label: 'Visualisering' },
  { id: 'insights', Icon: BarChart2, label: 'Insikter' },
  { id: 'issues', Icon: AlertTriangle, label: 'Ärenden' },
  { id: 'settings', Icon: Settings, label: 'Inställningar' },
];

const ViewerMockup: React.FC = () => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [activeTool, setActiveTool] = useState('orbit');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [subSheet, setSubSheet] = useState<'viewMode' | 'floors' | null>(null);
  const [selectedFloor, setSelectedFloor] = useState('Vån 1');

  const buildingName = 'Kontorsbyggnad A';
  const modeLabel = VIEW_MODES.find((m) => m.mode === viewMode)?.label ?? '3D';

  const handleMenuItem = (id: string) => {
    if (id === 'viewMode') {
      setSubSheet('viewMode');
    } else if (id === 'floors') {
      setSubSheet('floors');
    } else {
      // Close sheet for non-submenu items (placeholder)
      setSheetOpen(false);
    }
  };

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
        {/* Close */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="h-8 w-8 text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </Button>

        {/* Building name + mode */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-white text-sm font-medium truncate max-w-[180px]">
            {buildingName}
          </span>
          <span className="text-white/60 text-xs">{modeLabel}</span>
        </div>

        {/* Hamburger */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => { setSubSheet(null); setSheetOpen(true); }}
          className="h-8 w-8 text-white hover:bg-white/20"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* ── Spacer to push toolbar to bottom ── */}
      <div className="flex-1" />

      {/* ── Selected floor pill (floating) ── */}
      <div className="relative z-50 flex justify-center pb-2 pointer-events-none">
        <div className="pointer-events-auto bg-background/80 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1.5 border border-border/40">
          <Layers className="h-3 w-3 text-primary" />
          <span className="text-xs font-medium text-foreground">{selectedFloor}</span>
        </div>
      </div>

      {/* ── Compact bottom toolbar ── */}
      <div
        className="relative z-50 flex items-center justify-around bg-background/90 backdrop-blur-sm border-t border-border/30"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
          paddingTop: '6px',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
      >
        {TOOLS.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveTool(id)}
            className={`flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-colors ${
              activeTool === id
                ? 'text-primary bg-primary/10'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title={label}
          >
            <Icon className="h-5 w-5" />
          </button>
        ))}
      </div>

      {/* ── Action Sheet (main menu) ── */}
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[85dvh]">
          {subSheet === null && (
            <>
              <DrawerHeader className="pb-2">
                <DrawerTitle className="text-base">Meny</DrawerTitle>
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
                    {id === 'floors' && (
                      <span className="text-xs text-muted-foreground">{selectedFloor}</span>
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
                    ← Tillbaka
                  </Button>
                  <DrawerTitle className="text-base">Visningsläge</DrawerTitle>
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

          {subSheet === 'floors' && (
            <>
              <DrawerHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSubSheet(null)} className="h-7 px-2">
                    ← Tillbaka
                  </Button>
                  <DrawerTitle className="text-base">Våningar</DrawerTitle>
                </div>
              </DrawerHeader>
              <div className="px-2 pb-6 space-y-0.5">
                {MOCK_FLOORS.map((floor) => (
                  <button
                    key={floor}
                    onClick={() => { setSelectedFloor(floor); setSubSheet(null); setSheetOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-4 rounded-lg transition-colors ${
                      selectedFloor === floor ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60 text-foreground'
                    }`}
                  >
                    <Layers className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium flex-1 text-left">{floor}</span>
                    {selectedFloor === floor && <Eye className="h-4 w-4 text-primary" />}
                  </button>
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
