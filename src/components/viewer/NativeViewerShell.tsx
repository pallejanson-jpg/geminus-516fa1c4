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
import ViewerToolbar from './ViewerToolbar';
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

    // Build comprehensive shim that mimics the Asset+ API for all toolbar/settings components
    const assetViewShim = {
      viewer,
      get selectedItemIds() {
        return viewer.scene?.selectedObjectIds || [];
      },
      viewFit: (ids?: string[], fitAll?: boolean) => {
        if (!viewer.cameraFlight) return;
        if (fitAll || !ids?.length) {
          viewer.cameraFlight.flyTo({ aabb: viewer.scene.aabb, duration: 0.5 });
        } else {
          const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
          ids.forEach(id => {
            const entity = viewer.scene.objects?.[id];
            if (entity?.aabb) {
              aabb[0] = Math.min(aabb[0], entity.aabb[0]);
              aabb[1] = Math.min(aabb[1], entity.aabb[1]);
              aabb[2] = Math.min(aabb[2], entity.aabb[2]);
              aabb[3] = Math.max(aabb[3], entity.aabb[3]);
              aabb[4] = Math.max(aabb[4], entity.aabb[4]);
              aabb[5] = Math.max(aabb[5], entity.aabb[5]);
            }
          });
          if (aabb[0] !== Infinity) {
            viewer.cameraFlight.flyTo({ aabb, duration: 0.5 });
          }
        }
      },
      setNavMode: (mode: string) => {
        if (!viewer.cameraControl) return;
        if (mode === 'firstPerson') {
          viewer.cameraControl.navMode = 'firstPerson';
          viewer.cameraControl.followPointer = true;
        } else if (mode === 'planView') {
          viewer.cameraControl.navMode = 'planView';
        } else {
          viewer.cameraControl.navMode = 'orbit';
          viewer.cameraControl.followPointer = false;
        }
      },
      useTool: (tool: string | null) => {
        // Native xeokit: select is the default pick mode
        // Measure and slicer emit events handled by respective hooks
        console.debug('[NativeShim] useTool:', tool);
      },
      clearSlices: () => {
        if (!viewer.scene) return;
        const planes = Object.values(viewer.scene.sectionPlanes || {});
        planes.forEach((sp: any) => { try { sp.destroy(); } catch {} });
      },
    };

    const assetViewerShim = {
      $refs: { assetView: assetViewShim },
      onShowSpacesChanged: (show: boolean) => {
        const scene = viewer.scene;
        if (!scene?.metaScene?.metaObjects) return;
        const metaObjects = scene.metaScene.metaObjects;
        Object.values(metaObjects).forEach((mo: any) => {
          if (mo.type?.toLowerCase() === 'ifcspace') {
            const entity = scene.objects?.[mo.id];
            if (entity) {
              entity.visible = show;
              if (show) {
                entity.opacity = 0.3;
                entity.colorize = [0.5, 0.7, 0.9];
              }
            }
          }
        });
      },
      onToggleAnnotation: (show: boolean) => {
        window.dispatchEvent(new CustomEvent('TOGGLE_ANNOTATIONS', { detail: { show } }));
      },
      setShowFloorplan: (show: boolean) => {
        // Handled by ViewerToolbar's 2D mode logic via events
        console.debug('[NativeShim] setShowFloorplan:', show);
      },
    };

    viewerShimRef.current = {
      $refs: { AssetViewer: assetViewerShim },
      assetViewer: assetViewerShim,
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
    scene.setObjectsColorize(scene.objectIds, null);
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

      {/* Bottom toolbar (zoom, select, measure, xray, 2d/3d) */}
      {isViewerReady && !isMobile && (
        <ViewerToolbar
          viewerRef={viewerShimRef}
        />
      )}

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
          onShowSpacesChange={(show) => {
            setShowSpaces(show);
            // Directly call the shim's method
            const assetViewer = viewerShimRef.current?.assetViewer || viewerShimRef.current?.$refs?.AssetViewer;
            assetViewer?.onShowSpacesChanged?.(show);
          }}
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
