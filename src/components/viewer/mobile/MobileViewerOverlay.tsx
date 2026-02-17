import React, { useState, useCallback } from 'react';
import { ArrowLeft, TreeDeciduous, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ViewerTreePanel from '../ViewerTreePanel';

interface MobileViewerOverlayProps {
  onClose?: () => void;
  viewerInstanceRef: React.RefObject<any>;
  buildingName?: string;
  isViewerReady: boolean;
  onOpenSettings?: () => void;
  // Tree state
  treeSelectedId?: string | null;
  onTreeSelectedIdChange?: (id: string | null) => void;
  treeExpandedIds?: Set<string>;
  onTreeExpandedIdsChange?: (ids: Set<string>) => void;
}

/**
 * Slim mobile overlay for the 3D viewer.
 * Only renders the header bar with back/tree/settings buttons.
 * All visualization settings are delegated to ViewerRightPanel via onOpenSettings.
 */
const MobileViewerOverlay: React.FC<MobileViewerOverlayProps> = ({
  onClose,
  viewerInstanceRef,
  buildingName,
  isViewerReady,
  onOpenSettings,
  treeSelectedId,
  onTreeSelectedIdChange,
  treeExpandedIds,
  onTreeExpandedIdsChange,
}) => {
  const [showTreeOverlay, setShowTreeOverlay] = useState(false);

  const handleTreeNodeSelect = useCallback((nodeId: string) => {
    onTreeSelectedIdChange?.(nodeId);
  }, [onTreeSelectedIdChange]);

  return (
    <>
      {/* Compact Header - absolute positioned over the canvas */}
      <div
        className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between p-2 bg-gradient-to-b from-background/90 via-background/60 to-transparent"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top, 0px), 20px) + 8px)' }}
      >
        {/* Left: Back button */}
        {onClose && (
          <Button
            variant="secondary"
            size="icon"
            onClick={onClose}
            className="h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}

        {/* Center: Building name */}
        <div className="flex-1 mx-2 text-center">
          <h1 className="text-sm font-medium truncate text-foreground drop-shadow-sm">
            {buildingName || '3D Viewer'}
          </h1>
        </div>

        {/* Right: Tree + Settings */}
        <div className="flex gap-1.5">
          <Button
            variant={showTreeOverlay ? 'default' : 'secondary'}
            size="icon"
            className="h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border"
            onClick={() => setShowTreeOverlay(!showTreeOverlay)}
            disabled={!isViewerReady}
          >
            <TreeDeciduous className="h-4 w-4" />
          </Button>

          <Button
            variant="secondary"
            size="icon"
            className="h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border"
            onClick={onOpenSettings}
            disabled={!isViewerReady}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* TreeView sliding overlay from left */}
      {showTreeOverlay && (
        <>
          <div
            className="absolute inset-0 bg-black/40 z-40"
            onClick={() => setShowTreeOverlay(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-80 z-50 bg-card/98 backdrop-blur-md border-r shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-3 border-b">
              <div className="flex items-center gap-2">
                <TreeDeciduous className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Model Tree</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowTreeOverlay(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ViewerTreePanel
                viewerRef={viewerInstanceRef}
                isVisible={showTreeOverlay}
                onClose={() => setShowTreeOverlay(false)}
                onNodeSelect={handleTreeNodeSelect}
                embedded={true}
                showVisibilityCheckboxes={true}
                startFromStoreys={true}
                selectedId={treeSelectedId}
                onSelectedIdChange={onTreeSelectedIdChange}
                expandedIds={treeExpandedIds}
                onExpandedIdsChange={onTreeExpandedIdsChange}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default MobileViewerOverlay;
