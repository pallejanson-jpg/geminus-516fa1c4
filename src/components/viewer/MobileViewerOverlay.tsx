import React from 'react';
import { ArrowLeft, Settings2, Filter, Square, Box, View, LayoutPanelLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { emit } from '@/lib/event-bus';

type ViewMode = '2d' | '3d' | '360' | 'split2d3d';

interface MobileViewerOverlayProps {
  onClose?: () => void;
  viewerInstanceRef: React.RefObject<any>;
  buildingName?: string;
  buildingFmGuid?: string;
  isViewerReady: boolean;
  onOpenSettings?: () => void;
  showFilterPanel?: boolean;
  onToggleFilterPanel?: () => void;
  viewMode?: ViewMode;
  onChangeViewMode?: (mode: ViewMode) => void;
  hasIvion?: boolean;
}

const MobileViewerOverlay: React.FC<MobileViewerOverlayProps> = ({
  onClose,
  isViewerReady,
  onOpenSettings,
  showFilterPanel,
  onToggleFilterPanel,
  viewMode = '3d',
  onChangeViewMode,
  hasIvion = false,
}) => {
  return (
    <>
      <div
        className="absolute top-0 left-0 right-0 z-30 grid grid-cols-[auto_1fr_auto] items-center gap-1 px-1.5 py-1 bg-gradient-to-b from-background/90 via-background/60 to-transparent"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4px)',
          paddingLeft: 'max(env(safe-area-inset-left, 0px), 6px)',
          paddingRight: 'max(env(safe-area-inset-right, 0px), 6px)',
        }}
      >
        {onClose && (
          <Button
            variant="secondary"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 bg-card/95 backdrop-blur-sm shadow-md border"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}

        {onChangeViewMode && (
          <div className="mx-auto flex max-w-full min-w-0 items-center gap-0.5 overflow-x-auto bg-black/50 backdrop-blur-md rounded-lg p-0.5 border border-white/10">
            <Button
              size="sm"
              variant={viewMode === 'split2d3d' ? 'default' : 'ghost'}
              className={`h-6 px-1.5 text-[9px] rounded-md gap-0.5 ${viewMode !== 'split2d3d' ? 'text-white/70 hover:text-white hover:bg-white/10' : ''}`}
              onClick={() => onChangeViewMode('split2d3d')}
            >
              <LayoutPanelLeft className="h-3 w-3" />
              2D/3D
            </Button>
            <Button
              size="sm"
              variant={viewMode === '2d' ? 'default' : 'ghost'}
              className={`h-6 px-1.5 text-[9px] rounded-md gap-0.5 ${viewMode !== '2d' ? 'text-white/70 hover:text-white hover:bg-white/10' : ''}`}
              onClick={() => onChangeViewMode('2d')}
            >
              <Square className="h-3 w-3" />
              2D
            </Button>
            <Button
              size="sm"
              variant={viewMode === '3d' ? 'default' : 'ghost'}
              className={`h-6 px-1.5 text-[9px] rounded-md gap-0.5 ${viewMode !== '3d' ? 'text-white/70 hover:text-white hover:bg-white/10' : ''}`}
              onClick={() => onChangeViewMode('3d')}
            >
              <Box className="h-3 w-3" />
              3D
            </Button>
            {hasIvion && (
              <Button
                size="sm"
                variant={viewMode === '360' ? 'default' : 'ghost'}
                className={`h-6 px-1.5 text-[9px] rounded-md gap-0.5 ${viewMode !== '360' ? 'text-white/70 hover:text-white hover:bg-white/10' : ''}`}
                onClick={() => onChangeViewMode('360')}
              >
                <View className="h-3 w-3" />
                360°
              </Button>
            )}
          </div>
        )}

        <div className="flex shrink-0 gap-1">
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 sm:h-8 sm:w-8 bg-card/95 backdrop-blur-sm shadow-md border"
            onClick={() => emit('VIEWER_CREATE_ASSET')}
            disabled={!isViewerReady}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant={showFilterPanel ? 'default' : 'secondary'}
            size="icon"
            className="h-7 w-7 sm:h-8 sm:w-8 bg-card/95 backdrop-blur-sm shadow-md border"
            onClick={onToggleFilterPanel}
            disabled={!isViewerReady}
          >
            <Filter className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 sm:h-8 sm:w-8 bg-card/95 backdrop-blur-sm shadow-md border"
            onClick={onOpenSettings}
            disabled={!isViewerReady}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </>
  );
};

export default MobileViewerOverlay;
