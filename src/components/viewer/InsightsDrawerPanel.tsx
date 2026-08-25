/**
 * InsightsDrawerPanel
 * 
 * A collapsible bottom-sheet analytics panel in the 3D viewer.
 * Scoped to the currently loaded building (buildingFmGuid prop).
 * 
 * Uses BuildingInsightsView directly — no duplication of chart logic.
 * Resizable via drag handle between viewer and panel.
 */

import React, { useContext, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { BarChart2, X } from 'lucide-react';
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

export default function InsightsDrawerPanel({
  buildingFmGuid,
  buildingName,
  open,
  onClose,
}: InsightsDrawerPanelProps) {
  const { navigatorTreeData } = useContext(AppContext);

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
        "bg-background/95 backdrop-blur-md border-border/30 overflow-hidden flex flex-col animate-in slide-in-from-right-4 duration-200",
        isMobile
          ? "fixed inset-0 z-50"
          : "fixed top-0 right-0 bottom-0 w-[480px] z-40 border-l shadow-2xl"
      )}
    >
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
