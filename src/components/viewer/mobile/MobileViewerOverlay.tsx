import React from 'react';
import { ArrowLeft, Settings2, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MobileViewerOverlayProps {
  onClose?: () => void;
  viewerInstanceRef: React.RefObject<any>;
  buildingName?: string;
  buildingFmGuid?: string;
  isViewerReady: boolean;
  onOpenSettings?: () => void;
  // Filter panel
  showFilterPanel?: boolean;
  onToggleFilterPanel?: () => void;
}

/**
 * Slim mobile overlay for the 3D viewer.
 * Only renders the header bar with back/filter/settings buttons.
 * The old model tree has been removed — FilterPanel replaces it.
 */
const MobileViewerOverlay: React.FC<MobileViewerOverlayProps> = ({
  onClose,
  buildingName,
  isViewerReady,
  onOpenSettings,
  showFilterPanel,
  onToggleFilterPanel,
}) => {
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

        {/* Right: Filter + Settings */}
        <div className="flex gap-1.5">
          <Button
            variant={showFilterPanel ? 'default' : 'secondary'}
            size="icon"
            className="h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border"
            onClick={onToggleFilterPanel}
            disabled={!isViewerReady}
          >
            <Filter className="h-4 w-4" />
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
    </>
  );
};

export default MobileViewerOverlay;
