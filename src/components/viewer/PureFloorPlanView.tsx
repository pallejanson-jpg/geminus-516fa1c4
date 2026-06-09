/**
 * PureFloorPlanView — Full-screen 2D floor plan mode using SplitPlanView.
 *
 * Wraps SplitPlanView for pure 2D-only viewing (not split-screen).
 * Provides the same high-quality orthographic floor plan as split-screen's 2D side,
 * but in full-screen mode with integrated controls.
 *
 * Syncs with 3D viewer:
 * - Floor selection in 2D updates 3D visibility
 * - Camera position in 3D updates 2D indicator
 * - Click-to-navigate in 2D moves 3D camera
 */

import React, { useCallback, useRef, useEffect } from 'react';
import SplitPlanView from './SplitPlanView';
import { FLOOR_SELECTION_CHANGED_EVENT, type FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';

interface PureFloorPlanViewProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;
  currentFloorId?: string;
  onFloorChange?: (floorId: string) => void;
  onEntityClick?: (entityId: string, fmGuid: string | null, entityName: string | null) => void;
  className?: string;
}

/**
 * Pure 2D floor plan viewer - full screen, no split layout.
 * Shows the same orthographic quality floor plan as SplitPlanView's 2D side.
 */
const PureFloorPlanView: React.FC<PureFloorPlanViewProps> = ({
  viewerRef,
  buildingFmGuid,
  currentFloorId,
  onFloorChange,
  onEntityClick,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Handle floor selection from 2D plan ──────────────────────────────────
  const handleFloorChange = useCallback((floorId: string) => {
    // Update 3D viewer visibility to match 2D floor selection
    // Note: SplitPlanView handles event dispatching with syncFloorSelection=true,
    // so we just need to update 3D visibility here
    const viewer = viewerRef.current;
    if (viewer?.scene && viewer?.metaScene?.metaObjects) {
      const metaObjects = viewer.metaScene.metaObjects;
      const floorMeta = metaObjects[floorId];

      if (floorMeta) {
        try {
          // Hide all, show only this floor's entities
          const allIds = viewer.scene.objectIds || [];
          if (allIds.length > 0) {
            viewer.scene.setObjectsVisible(allIds, false);
          }

          // Find and show entities belonging to this floor via parent chain traversal
          const floorEntityIds: string[] = [];
          const maxDepth = 100; // Reasonable depth limit for parent chain
          Object.entries(metaObjects).forEach(([id, mo]: [string, any]) => {
            if (!mo || !mo.id) return;
            let cur: any = mo;
            let depth = 0;
            while (cur && depth < maxDepth) {
              if (cur.id === floorId) {
                floorEntityIds.push(id);
                break;
              }
              cur = cur.parent;
              depth++;
            }
          });

          if (floorEntityIds.length > 0) {
            viewer.scene.setObjectsVisible(floorEntityIds, true);
            console.log(`[PureFloorPlanView] Floor changed to "${floorMeta.name}", showing ${floorEntityIds.length} entities`);
          } else {
            console.warn(`[PureFloorPlanView] No entities found for floor "${floorMeta.name}" (${floorId})`);
          }

          onFloorChange?.(floorId);
        } catch (err) {
          console.error(`[PureFloorPlanView] Error updating floor visibility:`, err);
        }
      }
    }
  }, [viewerRef, onFloorChange]);

  // ── Listen for external floor selection (from FloatingFloorSwitcher) ──────
  useEffect(() => {
    const handleFloorSelectionChanged = (e: Event) => {
      const detail = (e as CustomEvent<FloorSelectionEventDetail>).detail;
      if (!detail || !detail.floorId || detail.skipClipping) return;

      // When floor is selected externally, update 3D visibility
      handleFloorChange(detail.floorId);
    };

    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorSelectionChanged);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorSelectionChanged);
  }, [handleFloorChange]);

  // ── Handle click-to-navigate from 2D plan ────────────────────────────────
  const handleNavigate = useCallback((entityId: string, fmGuid: string | null, entityName: string | null) => {
    onEntityClick?.(entityId, fmGuid, entityName);

    // When user clicks on 2D plan, move 3D camera to that location
    // This is handled via SPLIT_PLAN_NAVIGATE event in ViewerToolbar
  }, [onEntityClick]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 bg-white z-40 flex flex-col overflow-hidden ${className || ''}`}
    >
      <SplitPlanView
        viewerRef={viewerRef}
        buildingFmGuid={buildingFmGuid}
        className="flex-1"
        syncFloorSelection={true}
        lockCameraToFloor={true}
        monochrome={true}
        isSplitMode={false}  // Full-screen mode (not split)
        hidePositionIndicator={true}  // Hide blue camera position marker in pure 2D
        onEntityClick={handleNavigate}
      />
    </div>
  );
};

export default PureFloorPlanView;
