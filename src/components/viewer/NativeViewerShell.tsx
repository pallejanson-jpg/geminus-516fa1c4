/**
 * NativeViewerShell — wraps NativeXeokitViewer with all UI overlays
 * (toolbar, floor switcher, filter panel, context menu, mobile overlay).
 */

import React, { useState, useCallback, useRef, useContext, useEffect } from 'react';
import { OBJECT_MOVE_MODE_EVENT, OBJECT_DELETE_EVENT, useObjectMoveMode } from '@/hooks/useObjectMoveMode';
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
import { ROOM_LABELS_TOGGLE_EVENT, ROOM_LABELS_CONFIG_EVENT, type RoomLabelsToggleDetail } from '@/hooks/useRoomLabels';
import useRoomLabels from '@/hooks/useRoomLabels';
import UniversalPropertiesDialog from '@/components/common/UniversalPropertiesDialog';
import { ARCHITECT_BACKGROUND_CHANGED_EVENT, ARCHITECT_BACKGROUND_PRESETS, type BackgroundPresetId } from '@/hooks/useArchitectViewMode';
import { FLOOR_SELECTION_CHANGED_EVENT, type FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { recolorArchitectObjects } from '@/lib/architect-colors';
import { Filter, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

interface NativeViewerShellProps {
  buildingFmGuid: string;
  onClose: () => void;
  /** Hide the desktop back button (when parent already has one, e.g. UnifiedViewer) */
  hideBackButton?: boolean;
}

const NativeViewerShell: React.FC<NativeViewerShellProps> = ({ buildingFmGuid, onClose, hideBackButton = false }) => {
  const isMobile = useIsMobile();
  const { allData, isSidebarExpanded } = useContext(AppContext);

  // Viewer instance
  const [xeokitViewer, setXeokitViewer] = useState<any>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);

  // Object move/delete mode hook
  useObjectMoveMode(xeokitViewer, buildingFmGuid);

  // UI state
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [viewMode, setViewMode] = useState<'2d' | '3d' | '360'>('3d');
  const [showSpaces, setShowSpaces] = useState(false);
  const [showVisualizationMenu, setShowVisualizationMenu] = useState(false);

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

  // Room labels hook — listens for ROOM_LABELS_TOGGLE_EVENT
  const { setLabelsEnabled, updateFloorFilter, updateViewMode: updateRoomLabelViewMode } = useRoomLabels(viewerShimRef);

  // Track current visible floor guids for room labels
  const currentFloorGuidsRef = React.useRef<string[]>([]);

  // Wire room labels toggle event — pass current floor filter so labels only show for selected floors
  useEffect(() => {
    const handler = (e: CustomEvent<RoomLabelsToggleDetail>) => {
      setLabelsEnabled(e.detail.enabled, currentFloorGuidsRef.current);
    };
    window.addEventListener(ROOM_LABELS_TOGGLE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ROOM_LABELS_TOGGLE_EVENT, handler as EventListener);
  }, [setLabelsEnabled]);

  // Wire floor selection → room label floor filter + track current selection
  useEffect(() => {
    const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
      const { visibleFloorFmGuids, isAllFloorsVisible } = e.detail;
      if (isAllFloorsVisible) {
        currentFloorGuidsRef.current = [];
        updateFloorFilter([]);
      } else if (visibleFloorFmGuids?.length) {
        currentFloorGuidsRef.current = visibleFloorFmGuids;
        updateFloorFilter(visibleFloorFmGuids);
      }
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, [updateFloorFilter]);

  const buildingName = React.useMemo(() => {
    if (!allData || !buildingFmGuid) return '';
    const b = allData.find((a: any) =>
      a.fmGuid === buildingFmGuid &&
      (a.category === 'Building' || a.category === 'IfcBuilding')
    );
    return b?.commonName || b?.name || '';
  }, [allData, buildingFmGuid]);

  // ── Background color handler ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const presetId = e.detail?.presetId as BackgroundPresetId;
      const preset = ARCHITECT_BACKGROUND_PRESETS.find(p => p.id === presetId);
      if (!preset) return;
      // Apply to the native canvas parent element
      const canvasParent = document.querySelector('.native-viewer-canvas-parent') as HTMLElement;
      if (canvasParent) {
        canvasParent.style.background = `linear-gradient(180deg, rgb(255, 255, 255) 0%, ${preset.bottom} 100%)`;
      }
    };
    window.addEventListener(ARCHITECT_BACKGROUND_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(ARCHITECT_BACKGROUND_CHANGED_EVENT, handler as EventListener);
  }, []);

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
        const metaObjects = viewer.metaScene?.metaObjects || scene?.metaScene?.metaObjects;
        if (!metaObjects) return;

        const visibleFloorKeys = new Set(
          (currentFloorGuidsRef.current || []).map((g) => (g || '').toLowerCase().replace(/-/g, ''))
        );
        const hasFloorFilter = visibleFloorKeys.size > 0;

        Object.values(metaObjects).forEach((mo: any) => {
          if (mo.type?.toLowerCase() !== 'ifcspace') return;
          const entity = scene.objects?.[mo.id];
          if (!entity) return;

          let belongsToVisibleFloor = true;
          if (hasFloorFilter) {
            belongsToVisibleFloor = false;
            let current = mo;
            while (current?.parent) {
              current = current.parent;
              if (current?.type?.toLowerCase() === 'ifcbuildingstorey') {
                const storeyGuid = (current.originalSystemId || current.id || '').toLowerCase().replace(/-/g, '');
                belongsToVisibleFloor = visibleFloorKeys.has(storeyGuid);
                break;
              }
            }
          }

          if (show && belongsToVisibleFloor) {
            entity.colorize = [0.898, 0.894, 0.890]; // SPACE_COLOR
            entity.opacity = 0.3;
            entity.pickable = true;
            entity.visible = true;
          } else {
            entity.visible = false;
            entity.pickable = false;
          }
        });
      },
      onToggleAnnotation: (show: boolean) => {
        window.dispatchEvent(new CustomEvent('TOGGLE_ANNOTATIONS', { detail: { show } }));
      },
      setShowFloorplan: (show: boolean) => {
        console.debug('[NativeShim] setShowFloorplan:', show);
      },
    };

    viewerShimRef.current = {
      $refs: { AssetViewer: assetViewerShim },
      assetViewer: assetViewerShim,
    };

    // Expose globally so UnifiedViewer, SplitPlanView, and sync hooks can find it
    (window as any).__assetPlusViewerInstance = viewerShimRef.current;
    (window as any).__nativeXeokitViewer = viewer;
  }, []);

  // Clean up global refs on unmount
  useEffect(() => {
    return () => {
      if ((window as any).__assetPlusViewerInstance === viewerShimRef.current) {
        delete (window as any).__assetPlusViewerInstance;
      }
      delete (window as any).__nativeXeokitViewer;
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

      setContextMenu({ position: { x: e.clientX, y: e.clientY }, entityId, fmGuid, entityName });
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
        const pickResult = xeokitViewer.scene.pick({ canvasPos: [offsetX, offsetY], pickSurface: false });
        const entityId = pickResult?.entity?.id || null;
        let fmGuid: string | null = null;
        let entityName: string | null = null;
        if (entityId && xeokitViewer.metaScene?.metaObjects) {
          const metaObj = xeokitViewer.metaScene.metaObjects[entityId];
          if (metaObj) { fmGuid = metaObj.originalSystemId || null; entityName = metaObj.name || metaObj.type || null; }
        }
        setContextMenu({ position: { x: touchPos.x, y: touchPos.y }, entityId, fmGuid, entityName });
      }, 600);
    };

    const handleTouchEnd = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
    const handleTouchMove = (e: TouchEvent) => {
      if (!longPressTimer) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchPos.x;
      const dy = touch.clientY - touchPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 10) { clearTimeout(longPressTimer); longPressTimer = null; }
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

  // ── Context menu action handlers ─────────────────────────────────────────

  const handleContextZoomTo = useCallback(() => {
    if (!contextMenu?.entityId || !xeokitViewer?.cameraFlight) return;
    const entity = xeokitViewer.scene.objects?.[contextMenu.entityId];
    if (entity?.aabb) {
      xeokitViewer.cameraFlight.flyTo({ aabb: entity.aabb, duration: 0.5 });
    }
  }, [contextMenu, xeokitViewer]);

  const handleContextHide = useCallback(() => {
    if (!contextMenu?.entityId || !xeokitViewer?.scene) return;
    const entity = xeokitViewer.scene.objects?.[contextMenu.entityId];
    if (entity) entity.visible = false;
  }, [contextMenu, xeokitViewer]);

  const handleContextIsolate = useCallback(() => {
    if (!contextMenu?.entityId || !xeokitViewer?.scene) return;
    const scene = xeokitViewer.scene;
    const allIds = scene.objectIds || [];
    scene.setObjectsVisible(allIds, false);
    // Show the picked entity and its parent storey
    const entity = scene.objects?.[contextMenu.entityId];
    if (entity) entity.visible = true;
    // Also show parent hierarchy
    const metaObj = xeokitViewer.metaScene?.metaObjects?.[contextMenu.entityId];
    if (metaObj?.parent) {
      const collectParentIds = (mo: any): string[] => {
        const ids = [mo.id];
        mo.children?.forEach((c: any) => ids.push(...collectParentIds(c)));
        return ids;
      };
      const parentIds = collectParentIds(metaObj.parent);
      parentIds.forEach(id => {
        const e = scene.objects?.[id];
        if (e) e.visible = true;
      });
    }
  }, [contextMenu, xeokitViewer]);

  const handleContextShowAll = useCallback(() => {
    if (!xeokitViewer?.scene) return;
    const scene = xeokitViewer.scene;
    scene.setObjectsVisible(scene.objectIds, true);
    // Re-apply full architect color palette (includes hiding spaces)
    recolorArchitectObjects(xeokitViewer);
    // Re-hide spaces
    const metaObjects = xeokitViewer.metaScene?.metaObjects;
    if (metaObjects) {
      Object.values(metaObjects).forEach((mo: any) => {
        const t = (mo.type || '').toLowerCase();
        if (t.includes('ifcspace') || t === 'ifc_space' || t === 'space') {
          const entity = scene.objects?.[mo.id];
          if (entity) {
            entity.visible = false;
            entity.pickable = false;
          }
        }
      });
    }
  }, [xeokitViewer]);

  const handleContextProperties = useCallback(() => {
    if (!contextMenu) return;
    setPropertiesEntity({
      entityId: contextMenu.entityId || '',
      fmGuid: contextMenu.fmGuid,
      name: contextMenu.entityName,
    });
  }, [contextMenu]);

  const handleContextSelect = useCallback(() => {
    if (!contextMenu?.entityId || !xeokitViewer?.scene) return;
    const entity = xeokitViewer.scene.objects?.[contextMenu.entityId];
    if (entity) {
      // Deselect all first
      xeokitViewer.scene.setObjectsSelected(xeokitViewer.scene.selectedObjectIds, false);
      entity.selected = true;
    }
  }, [contextMenu, xeokitViewer]);

  const handleContextMove = useCallback(() => {
    if (!contextMenu?.entityId || !contextMenu?.fmGuid) return;
    window.dispatchEvent(new CustomEvent(OBJECT_MOVE_MODE_EVENT, {
      detail: { entityId: contextMenu.entityId, fmGuid: contextMenu.fmGuid },
    }));
  }, [contextMenu]);

  const handleContextDelete = useCallback(() => {
    if (!contextMenu?.entityId || !contextMenu?.fmGuid) return;
    window.dispatchEvent(new CustomEvent(OBJECT_DELETE_EVENT, {
      detail: { entityId: contextMenu.entityId, fmGuid: contextMenu.fmGuid },
    }));
  }, [contextMenu]);

  const handleChangeViewMode = useCallback((mode: '2d' | '3d' | '360') => {
    setViewMode(mode);
    window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode } }));
  }, []);

  // Calculate left offset for floor switcher and filter button based on sidebar
  const sidebarOffset = !isMobile && isSidebarExpanded ? 'left-[calc(3.5rem+12px)]' : 'left-3';

  return (
    <div className="relative w-full h-full overflow-hidden native-viewer-canvas-parent" style={{ background: 'linear-gradient(180deg, rgb(255,255,255) 0%, rgb(230,230,230) 100%)' }}>
      {/* Desktop back button — hidden when parent (UnifiedViewer) has its own */}
      {!isMobile && !hideBackButton && (
        <Button
          variant="secondary"
          size="icon"
          onClick={onClose}
          className="absolute top-3 left-3 z-40 h-9 w-9 bg-card/80 backdrop-blur-sm shadow-md border"
          title="Tillbaka"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Canvas layer */}
      <NativeXeokitViewer
        buildingFmGuid={buildingFmGuid}
        onClose={onClose}
        onViewerReady={handleViewerReady}
      />

      {/* Bottom toolbar */}
      {isViewerReady && xeokitViewer && (
        <ViewerToolbar viewer={xeokitViewer} />
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
          onOpenSettings={() => setShowVisualizationMenu(true)}
        />
      )}

      {/* Floor switcher */}
      {isViewerReady && (
        <FloatingFloorSwitcher
          viewerRef={viewerShimRef}
          buildingFmGuid={buildingFmGuid}
          isViewerReady={isViewerReady}
          className={!isMobile ? sidebarOffset : undefined}
        />
      )}

      {/* Desktop filter toggle button */}
      {!isMobile && isViewerReady && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showFilterPanel ? 'default' : 'secondary'}
                size="icon"
                className={`absolute top-3 ${sidebarOffset} z-30 h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border`}
                onClick={() => setShowFilterPanel(p => !p)}
              >
                <Filter className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Filter</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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

      {/* Visualization toolbar (right sidebar) */}
      {isViewerReady && (
        <VisualizationToolbar
          viewerRef={viewerShimRef}
          buildingFmGuid={buildingFmGuid}
          buildingName={buildingName}
          isViewerReady={isViewerReady}
          showSpaces={showSpaces}
          onShowSpacesChange={(show) => {
            setShowSpaces(show);
            const assetViewer = viewerShimRef.current?.assetViewer || viewerShimRef.current?.$refs?.AssetViewer;
            assetViewer?.onShowSpacesChanged?.(show);
          }}
          externalOpen={showVisualizationMenu}
          onExternalOpenChange={setShowVisualizationMenu}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ViewerContextMenu
          position={contextMenu.position}
          entityId={contextMenu.entityId}
          entityName={contextMenu.entityName}
          fmGuid={contextMenu.fmGuid}
          onClose={() => setContextMenu(null)}
          onShowLabels={() => {
            window.dispatchEvent(new CustomEvent('TOGGLE_ANNOTATIONS', { detail: { show: true } }));
          }}
          onCreateIssue={() => {
            setShowVisualizationMenu(true);
          }}
          onViewIssues={() => {
            // Only open the visualization menu to show issues, don't toggle spaces
            setShowVisualizationMenu(true);
            // Dispatch a specific event to open the issue list directly
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('OPEN_ISSUE_LIST'));
            }, 100);
          }}
          onShowRoomLabels={() => {
            window.dispatchEvent(new CustomEvent(ROOM_LABELS_TOGGLE_EVENT, { detail: { enabled: true } }));
          }}
          onShowProperties={contextMenu.fmGuid ? handleContextProperties : undefined}
          onZoomTo={contextMenu.entityId ? handleContextZoomTo : undefined}
          onHideEntity={contextMenu.entityId ? handleContextHide : undefined}
          onIsolateEntity={contextMenu.entityId ? handleContextIsolate : undefined}
          onShowAll={handleContextShowAll}
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
