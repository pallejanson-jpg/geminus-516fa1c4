/**
 * NativeViewerShell — wraps NativeXeokitViewer with all UI overlays
 * (toolbar, floor switcher, filter panel, context menu, mobile overlay).
 */

import React, { useState, useCallback, useRef, useContext, useEffect } from 'react';
import NativeXeokitViewer from './NativeXeokitViewer';
import MobileViewerOverlay from './mobile/MobileViewerOverlay';
import FloatingFloorSwitcher from './FloatingFloorSwitcher';
import ViewerFilterPanel from './ViewerFilterPanel';
import ViewerContextMenu from './ViewerContextMenu';
import VisualizationToolbar from './VisualizationToolbar';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppContext } from '@/context/AppContext';
import { VIEW_MODE_REQUESTED_EVENT } from '@/lib/viewer-events';
import UniversalPropertiesDialog from '@/components/common/UniversalPropertiesDialog';

interface NativeViewerShellProps {
  buildingFmGuid: string;
  onClose: () => void;
}

const NativeViewerShell: React.FC<NativeViewerShellProps> = ({ buildingFmGuid, onClose }) => {
  const isMobile = useIsMobile();
  const { allData } = useContext(AppContext);

  // Viewer instance
  const [xeokitViewer, setXeokitViewer] = useState<any>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);

  // UI state
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [viewMode, setViewMode] = useState<'2d' | '3d' | '360'>('3d');
  const [showSpaces, setShowSpaces] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    entityId: string | null;
    fmGuid: string | null;
    entityName: string | null;
  } | null>(null);

  // Properties dialog
  const [propertiesEntity, setPropertiesEntity] = useState<{ entityId: string; fmGuid: string | null; name: string | null } | null>(null);

  // Shim ref that matches the old Asset+ ref chain for existing hooks
  const viewerShimRef = useRef<any>(null);

  const buildingName = React.useMemo(() => {
    if (!allData || !buildingFmGuid) return '';
    const b = allData.find((a: any) =>
      a.fmGuid === buildingFmGuid &&
      (a.category === 'Building' || a.category === 'IfcBuilding')
    );
    return b?.commonName || b?.name || '';
  }, [allData, buildingFmGuid]);

  // When xeokit viewer becomes ready, build the shim ref
  const handleViewerReady = useCallback((viewer: any) => {
    setXeokitViewer(viewer);
    setIsViewerReady(true);

    // Build shim ref matching $refs.AssetViewer.$refs.assetView.viewer
    viewerShimRef.current = {
      $refs: {
        AssetViewer: {
          $refs: {
            assetView: {
              viewer,
            },
          },
        },
      },
    };
  }, []);

  // Context menu via right-click on canvas
  useEffect(() => {
    if (!xeokitViewer?.scene) return;

    const canvas = xeokitViewer.scene.canvas?.canvas;
    if (!canvas) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Pick entity at click position
      const pickResult = xeokitViewer.scene.pick({
        canvasPos: [e.offsetX, e.offsetY],
        pickSurface: false,
      });

      const entityId = pickResult?.entity?.id || null;
      let fmGuid: string | null = null;
      let entityName: string | null = null;

      if (entityId && xeokitViewer.metaScene?.metaObjects) {
        const metaObj = xeokitViewer.metaScene.metaObjects[entityId];
        if (metaObj) {
          fmGuid = metaObj.originalSystemId || null;
          entityName = metaObj.name || metaObj.type || null;
        }
      }

      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        entityId,
        fmGuid,
        entityName,
      });
    };

    // Long-press for mobile
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let touchPos = { x: 0, y: 0 };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchPos = { x: touch.clientX, y: touch.clientY };
      longPressTimer = setTimeout(() => {
        const rect = canvas.getBoundingClientRect();
        const offsetX = touchPos.x - rect.left;
        const offsetY = touchPos.y - rect.top;

        const pickResult = xeokitViewer.scene.pick({
          canvasPos: [offsetX, offsetY],
          pickSurface: false,
        });

        const entityId = pickResult?.entity?.id || null;
        let fmGuid: string | null = null;
        let entityName: string | null = null;

        if (entityId && xeokitViewer.metaScene?.metaObjects) {
          const metaObj = xeokitViewer.metaScene.metaObjects[entityId];
          if (metaObj) {
            fmGuid = metaObj.originalSystemId || null;
            entityName = metaObj.name || metaObj.type || null;
          }
        }

        setContextMenu({
          position: { x: touchPos.x, y: touchPos.y },
          entityId,
          fmGuid,
          entityName,
        });
      }, 600);
    };

    const handleTouchEnd = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!longPressTimer) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchPos.x;
      const dy = touch.clientY - touchPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 10) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchmove', handleTouchMove);
      if (longPressTimer) clearTimeout(longPressTimer);
    };
  }, [xeokitViewer]);

  // Context menu actions
  const handleZoomToFit = useCallback(() => {
    if (!xeokitViewer || !contextMenu?.entityId) return;
    const entity = xeokitViewer.scene.objects?.[contextMenu.entityId];
    if (entity?.aabb) {
      xeokitViewer.cameraFlight.flyTo({ aabb: entity.aabb, duration: 0.5 });
    }
  }, [xeokitViewer, contextMenu]);

  const handleIsolate = useCallback(() => {
    if (!xeokitViewer || !contextMenu?.entityId) return;
    const scene = xeokitViewer.scene;
    scene.setObjectsVisible(scene.objectIds, false);
    const entity = scene.objects?.[contextMenu.entityId];
    if (entity) {
      entity.visible = true;
      xeokitViewer.cameraFlight.flyTo({ aabb: entity.aabb, duration: 0.5 });
    }
  }, [xeokitViewer, contextMenu]);

  const handleHideSelected = useCallback(() => {
    if (!xeokitViewer || !contextMenu?.entityId) return;
    const entity = xeokitViewer.scene.objects?.[contextMenu.entityId];
    if (entity) entity.visible = false;
  }, [xeokitViewer, contextMenu]);

  const handleShowAll = useCallback(() => {
    if (!xeokitViewer) return;
    const scene = xeokitViewer.scene;
    scene.setObjectsVisible(scene.objectIds, true);
    scene.setObjectsXRayed(scene.objectIds, false);
    scene.setObjectsColorize(scene.objectIds);
  }, [xeokitViewer]);

  const handleProperties = useCallback(() => {
    if (!contextMenu?.entityId) return;
    setPropertiesEntity({
      entityId: contextMenu.entityId,
      fmGuid: contextMenu.fmGuid,
      name: contextMenu.entityName,
    });
  }, [contextMenu]);

  const handleChangeViewMode = useCallback((mode: '2d' | '3d' | '360') => {
    setViewMode(mode);
    window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode } }));
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Canvas layer */}
      <NativeXeokitViewer
        buildingFmGuid={buildingFmGuid}
        onClose={onClose}
        onViewerReady={handleViewerReady}
      />

      {/* Mobile header overlay */}
      {isMobile && isViewerReady && (
        <MobileViewerOverlay
          onClose={onClose}
          viewerInstanceRef={viewerShimRef}
          buildingName={buildingName}
          buildingFmGuid={buildingFmGuid}
          isViewerReady={isViewerReady}
          showFilterPanel={showFilterPanel}
          onToggleFilterPanel={() => setShowFilterPanel(p => !p)}
          viewMode={viewMode}
          onChangeViewMode={handleChangeViewMode}
          onOpenSettings={() => {/* handled by VisualizationToolbar */}}
        />
      )}

      {/* Floor switcher */}
      {isViewerReady && (
        <FloatingFloorSwitcher
          viewerRef={viewerShimRef}
          buildingFmGuid={buildingFmGuid}
          isViewerReady={isViewerReady}
        />
      )}

      {/* Filter panel */}
      {isViewerReady && (
        <ViewerFilterPanel
          viewerRef={viewerShimRef}
          buildingFmGuid={buildingFmGuid}
          isVisible={showFilterPanel}
          onClose={() => setShowFilterPanel(false)}
        />
      )}

      {/* Visualization toolbar (desktop — settings menu) */}
      {isViewerReady && !isMobile && (
        <VisualizationToolbar
          viewerRef={viewerShimRef}
          buildingFmGuid={buildingFmGuid}
          buildingName={buildingName}
          isViewerReady={isViewerReady}
          showSpaces={showSpaces}
          onShowSpacesChange={setShowSpaces}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ViewerContextMenu
          position={contextMenu.position}
          entityId={contextMenu.entityId}
          fmGuid={contextMenu.fmGuid}
          entityName={contextMenu.entityName}
          onClose={() => setContextMenu(null)}
          onProperties={handleProperties}
          onCreateIssue={() => {/* TODO: wire to CreateIssueDialog */}}
          onCreateWorkOrder={() => {}}
          onViewInSpace={() => {}}
          onSelect={() => {
            if (contextMenu.entityId && xeokitViewer?.scene?.objects) {
              const entity = xeokitViewer.scene.objects[contextMenu.entityId];
              if (entity) entity.selected = !entity.selected;
            }
          }}
          onZoomToFit={handleZoomToFit}
          onIsolate={handleIsolate}
          onHideSelected={handleHideSelected}
          onShowAll={handleShowAll}
        />
      )}

      {/* Properties dialog */}
      {propertiesEntity && propertiesEntity.fmGuid && (
        <UniversalPropertiesDialog
          isOpen={!!propertiesEntity}
          onClose={() => setPropertiesEntity(null)}
          fmGuids={propertiesEntity.fmGuid}
        />
      )}
    </div>
  );
};

export default NativeViewerShell;
