/**
 * MobileViewerPage — Dedicated fullscreen mobile viewer.
 * 
 * Layout:
 *  ┌──────────────────────────┐
 *  │  Header: ← [modes] [⚙]  │  z-50, safe-area
 *  ├──────────────────────────┤
 *  │     Canvas / Split       │  flex-1, touch-action: none
 *  ├──────────────────────────┤
 *  │  ToolBar (slim)          │  safe-area-bottom
 *  └──────────────────────────┘
 */

import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Square, Box, LayoutPanelLeft, View,
  Loader2, Filter, Settings2, BarChart2, SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NativeViewerShell from '@/components/viewer/NativeViewerShell';
import SplitPlanView from '@/components/viewer/SplitPlanView';
import InsightsDrawerPanel from '@/components/viewer/InsightsDrawerPanel';
import type { ViewMode } from '@/pages/UnifiedViewer';
import { VIEW_MODE_2D_TOGGLED_EVENT, VIEW_MODE_REQUESTED_EVENT } from '@/lib/viewer-events';
import type { LocalCoords } from '@/context/ViewerSyncContext';
import type { IvionBimTransform } from '@/lib/ivion-bim-transform';
import type { useBuildingViewerData } from '@/hooks/useBuildingViewerData';

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
  sdkStatus,
  ivApiRef,
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

  // Reset splitPlanReady when leaving split mode
  useEffect(() => {
    if (!isSplit) setSplitPlanReady(false);
  }, [isSplit]);

  // Mark split plan as ready after a short delay once viewerReady
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

  if (hasIvion) {
    modes.push({ mode: '360', label: '360°', Icon: View });
  }

  // NativeViewerShell provides its own filter, context menu, toolbar, and 
  // visualization settings. On mobile non-split modes we let the Shell's own
  // MobileViewerOverlay handle filter+settings via hideMobileOverlay=false.
  // In split mode the Shell is confined to the bottom half and we hide its
  // overlay; instead we surface filter/settings in our own header.

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-background"
      style={{
        height: '100dvh',
        width: '100vw',
        touchAction: 'none',
        overscrollBehavior: 'none',
      }}
    >
      {/* ── Header ── */}
      <div
        className="shrink-0 z-50 flex items-center justify-between px-1.5 py-1 bg-background/90 backdrop-blur-sm border-b border-border/30"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4px)',
          paddingLeft: 'max(env(safe-area-inset-left, 0px), 6px)',
          paddingRight: 'max(env(safe-area-inset-right, 0px), 6px)',
        }}
      >
        {/* Back */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onGoBack}
          className="h-7 w-7 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {/* Mode switcher — single source of truth */}
        <div className="flex items-center gap-0.5 bg-muted/80 rounded-lg p-0.5">
          {modes.map(({ mode, label, Icon }) => (
            <Button
              key={mode}
              size="sm"
              variant={viewMode === mode ? 'default' : 'ghost'}
              className={`h-6 px-1.5 text-[9px] rounded-md gap-0.5 ${
                viewMode !== mode ? 'text-muted-foreground hover:text-foreground' : ''
              }`}
              onClick={() => setViewMode(mode)}
            >
              <Icon className="h-3 w-3" />
              {label}
            </Button>
          ))}
        </div>

        {/* Right: Filter + Viz + Insights */}
        <div className="flex shrink-0 gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => window.dispatchEvent(new CustomEvent('MOBILE_TOGGLE_FILTER_PANEL'))}
          >
            <Filter className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => window.dispatchEvent(new CustomEvent('MOBILE_TOGGLE_VIZ_MENU'))}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${insightsPanelOpen ? 'bg-primary/20 text-primary' : ''}`}
            onClick={() => setInsightsPanelOpen(!insightsPanelOpen)}
          >
            <BarChart2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Canvas area ── */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {isSplit ? (
          /* Split 2D/3D — fixed 50/50 vertical */
          <>
            {/* Top: 2D Plan */}
            <div
              className="absolute top-0 left-0 right-0 overflow-hidden"
              style={{ height: '50%' }}
            >
              <div
                className="h-full w-full"
                style={{ visibility: splitPlanReady ? 'visible' : 'hidden' }}
              >
                <SplitPlanView
                  viewerRef={viewerInstanceRef}
                  buildingFmGuid={buildingData.fmGuid}
                  className="h-full"
                  syncFloorSelection={false}
                  lockCameraToFloor={false}
                  monochrome
                />
              </div>
              {!splitPlanReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Divider — visual only, no drag */}
            <div
              className="absolute left-0 right-0 z-30 h-1 bg-border"
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            />

            {/* Bottom: 3D — NativeViewerShell handles its own toolbar, filter, context menu */}
            <div
              className="absolute left-0 right-0 bottom-0 overflow-hidden"
              style={{ height: '50%' }}
            >
              <NativeViewerShell
                buildingFmGuid={buildingData.fmGuid}
                onClose={onGoBack}
                hideBackButton
                hideMobileOverlay={true}
                hideFloorSwitcher
                showGeminusMenu={false}
              />
            </div>
          </>
        ) : (
          /* Non-split: full canvas — let NativeViewerShell show its own mobile overlay */
          <div className="h-full w-full">
            {viewMode === '360' && hasIvion ? (
              <div
                ref={sdkContainerRef}
                className="h-full w-full"
              />
            ) : (
              <NativeViewerShell
                buildingFmGuid={buildingData.fmGuid}
                onClose={onGoBack}
                hideBackButton
                hideMobileOverlay={true}
                showGeminusMenu={viewMode === '3d'}
              />
            )}
          </div>
        )}
      </div>

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
