/**
 * PureFloorPlanView — Full-screen 2D floor plan mode using SplitPlanView.
 *
 * Wraps SplitPlanView for pure 2D-only viewing (not split-screen).
 * Provides the same high-quality orthographic floor plan as split-screen's 2D side,
 * but in full-screen mode.
 *
 * IMPORTANT: This component must NOT change 3D scene visibility. SplitPlanView's
 * StoreyViewsPlugin renders the plan image FROM the live 3D scene — hiding scene
 * objects produces a blank plan. Floor switching is handled entirely by
 * SplitPlanView, which already listens for FLOOR_SELECTION_CHANGED events from
 * the FloatingFloorSwitcher and regenerates the plan image.
 */

import React, { useCallback } from 'react';
import SplitPlanView from './SplitPlanView';

interface PureFloorPlanViewProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;
  currentFloorId?: string;
  onFloorChange?: (floorId: string) => void;
  onEntityClick?: (entityId: string, fmGuid: string | null, entityName: string | null) => void;
  className?: string;
}

const PureFloorPlanView: React.FC<PureFloorPlanViewProps> = ({
  viewerRef,
  buildingFmGuid,
  onEntityClick,
  className,
}) => {
  const handleEntityClick = useCallback((entityId: string, fmGuid: string | null, entityName: string | null) => {
    onEntityClick?.(entityId, fmGuid, entityName);
  }, [onEntityClick]);

  return (
    <div
      // z-10: above the 3D canvas but below floor switcher (z-30+), toolbar (z-30),
      // filter button (z-40) and the right-side visualization menu (z-20/z-60)
      className={`absolute inset-0 bg-white z-10 flex flex-col overflow-hidden ${className || ''}`}
    >
      <SplitPlanView
        viewerRef={viewerRef}
        buildingFmGuid={buildingFmGuid}
        className="flex-1"
        syncFloorSelection={true}
        lockCameraToFloor={false}
        monochrome={true}
        isSplitMode={false}
        hidePositionIndicator={true}
        onEntityClick={handleEntityClick}
      />
    </div>
  );
};

export default PureFloorPlanView;
