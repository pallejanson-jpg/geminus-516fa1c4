/**
 * InsightsDrawerPanel
 * 
 * A collapsible bottom-sheet analytics panel in the 3D viewer.
 * Scoped to the currently loaded building (buildingFmGuid prop).
 * 
 * Uses BuildingInsightsView directly — no duplication of chart logic.
 * Resizable via drag handle between viewer and panel.
 */

import React, { useContext, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, BarChart2, X, GripHorizontal } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Facility } from '@/lib/types';
import BuildingInsightsView from '@/components/insights/BuildingInsightsView';

interface InsightsDrawerPanelProps {
  buildingFmGuid: string;
  buildingName?: string;
  open: boolean;
  onClose: () => void;
}

const MIN_HEIGHT = 200;
const MAX_HEIGHT_RATIO = 0.8;
const DEFAULT_HEIGHT = 400;

export default function InsightsDrawerPanel({
  buildingFmGuid,
  buildingName,
  open,
  onClose,
}: InsightsDrawerPanelProps) {
  const { allData, navigatorTreeData } = useContext(AppContext);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(DEFAULT_HEIGHT);

  // Drag-to-resize logic
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const maxH = window.innerHeight * MAX_HEIGHT_RATIO;
    const delta = startY.current - e.clientY; // drag up = increase height
    setHeight(Math.max(MIN_HEIGHT, Math.min(maxH, startH.current + delta)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Look up the facility from context data
  const facility = useMemo<Facility | null>(() => {
    const treeNode = navigatorTreeData.find(
      n => n.fmGuid?.toLowerCase() === buildingFmGuid?.toLowerCase()
    );
    if (treeNode) {
      return {
        fmGuid: treeNode.fmGuid,
        name: treeNode.name,
        commonName: treeNode.commonName,
        complexCommonName: treeNode.complexCommonName,
        category: 'Building',
        attributes: treeNode.attributes,
      } as Facility;
    }
    if (buildingFmGuid) {
      return {
        fmGuid: buildingFmGuid,
        name: buildingName || buildingFmGuid,
        category: 'Building',
      } as Facility;
    }
    return null;
  }, [navigatorTreeData, buildingFmGuid, buildingName]);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  if (!open || !facility) return null;

  const displayName = facility.commonName || facility.name || buildingName || '';

  return (
    <div
      className={cn(
        "border-t border-border/30 bg-background/95 backdrop-blur-md overflow-hidden flex flex-col",
        isMobile ? "fixed inset-0 z-50" : "shrink-0"
      )}
      style={isMobile ? undefined : { height: `${height}px` }}
    >
      {/* Drag handle / resize bar */}
      {!isMobile && (
        <div
          className="flex items-center justify-center h-3 cursor-row-resize hover:bg-muted/60 transition-colors select-none touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground/50" />
        </div>
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            Insights
            {displayName && (
              <span className="text-muted-foreground font-normal ml-1.5">– {displayName}</span>
            )}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content — BuildingInsightsView handles its own tabs */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <BuildingInsightsView
          facility={facility}
          onBack={onClose}
          drawerMode
        />
      </div>
    </div>
  );
}
