/**
 * NativeViewerShell — wraps NativeXeokitViewer with all UI overlays
 * (toolbar, floor switcher, filter panel, context menu, mobile overlay).
 */

import React, { useState, useCallback, useRef, useContext, useEffect } from 'react';
import useSectionPlaneClipping from '@/hooks/useSectionPlaneClipping';
import { OBJECT_MOVE_MODE_EVENT, OBJECT_DELETE_EVENT, useObjectMoveMode } from '@/hooks/useObjectMoveMode';
import { useAiViewerBridge, dispatchAiViewerCommand } from '@/hooks/useAiViewerBridge';
import NativeXeokitViewer from './NativeXeokitViewer';
import MobileViewerOverlay from './mobile/MobileViewerOverlay';
import FloatingFloorSwitcher from './FloatingFloorSwitcher';
import ViewerFilterPanel from './ViewerFilterPanel';
import ViewerContextMenu from './ViewerContextMenu';
import ViewerToolbar from './ViewerToolbar';
import VisualizationToolbar from './VisualizationToolbar';
import RoomVisualizationPanel from './RoomVisualizationPanel';
import InventoryPanel from './InventoryPanel';
import InventoryFormSheet from '@/components/inventory/InventoryFormSheet';
import RouteDisplayOverlay from './RouteDisplayOverlay';
import VisualizationLegendOverlay from './VisualizationLegendOverlay';
import SensorDataOverlay from './SensorDataOverlay';

import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { AppContext } from '@/context/AppContext';
import { emit, on, type LoadSavedViewDetail, type ViewerToolChangedDetail, type ViewMode2DToggledDetail, type FloorSelectionEventDetail } from '@/lib/event-bus';
import { VIEW_MODE_REQUESTED_EVENT, LOAD_SAVED_VIEW_EVENT, VIEWER_TOOL_CHANGED_EVENT, VIEWER_CREATE_ASSET_EVENT, VIEW_MODE_2D_TOGGLED_EVENT, CLIP_HEIGHT_CHANGED_EVENT, FLOOR_SELECTION_CHANGED_EVENT, FORCE_SHOW_SPACES_EVENT } from '@/lib/viewer-events';
import { ROOM_LABELS_TOGGLE_EVENT, ROOM_LABELS_CONFIG_EVENT, type RoomLabelsToggleDetail } from '@/hooks/useRoomLabels';
import useRoomLabels from '@/hooks/useRoomLabels';
import UniversalPropertiesDialog from '@/components/common/UniversalPropertiesDialog';
import { ARCHITECT_BACKGROUND_CHANGED_EVENT, ARCHITECT_BACKGROUND_PRESETS, type BackgroundPresetId } from '@/hooks/useArchitectViewMode';
import { recolorArchitectObjects } from '@/lib/architect-colors';
import { Filter, ArrowLeft } from 'lucide-react';
import { parseNavGraph, dijkstra, findNodeByRoom, findNearestEntranceNode, mergeGraphs } from '@/lib/pathfinding';
import type { RouteResult } from '@/lib/pathfinding';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

interface NativeViewerShellProps {
  buildingFmGuid: string;
  onClose: () => void;
  /** Hide the desktop back button (when parent already has one, e.g. UnifiedViewer) */
  hideBackButton?: boolean;
  /** Hide the mobile overlay (mode switcher, filter, settings) when parent provides its own */
  hideMobileOverlay?: boolean;
  /** Hide the bottom toolbar (used in split-screen compact mode) */
  hideToolbar?: boolean;
  /** Hide the floating floor switcher (used when parent shows its own) */
  hideFloorSwitcher?: boolean;
  /** Show Geminus floating plugin menu (full 3D mode) */
  showGeminusMenu?: boolean;
}

const NativeViewerShell: React.FC<NativeViewerShellProps> = ({ buildingFmGuid, onClose, hideBackButton = false, hideMobileOverlay = false, hideToolbar = false, hideFloorSwitcher = false, showGeminusMenu = false }) => {
  const isMobile = useIsMobile();
  const { allData, isSidebarExpanded } = useContext(AppContext);

  // Viewer instance
  const [xeokitViewer, setXeokitViewer] = useState<any>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [viewerReloadKey, setViewerReloadKey] = useState(0);
  const [forceBootstrap, setForceBootstrap] = useState(false);

  // Listen for XKT_FORCE_RELOAD to remount the viewer with fresh data
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const targetGuid = e.detail?.buildingFmGuid;
      if (!targetGuid || targetGuid === buildingFmGuid) {
        console.log('[NativeViewerShell] Force reloading viewer for fresh XKT');
        setXeokitViewer(null);
        setIsViewerReady(false);
        startViewAppliedRef.current = null;
        setForceBootstrap(true);
        setViewerReloadKey(k => k + 1);
      }
    };
    window.addEventListener('XKT_FORCE_RELOAD', handler as EventListener);
    return () => window.removeEventListener('XKT_FORCE_RELOAD', handler as EventListener);
  }, [buildingFmGuid]);

  // AI Viewer Bridge — listens for AI_VIEWER_COMMAND events
  useAiViewerBridge(xeokitViewer, isViewerReady);
  const pendingSavedViewRef = useRef<LoadSavedViewDetail | null>(null);
  const startViewAppliedRef = useRef<string | null>(null);

  // ─── Auto-apply start view when viewer models finish loading ───
  useEffect(() => {
    if (startViewAppliedRef.current === buildingFmGuid) return;

    let cancelled = false;

    // Fetch start view config from DB
    const fetchAndApply = async () => {
      try {
        const { data: settings } = await supabase
          .from('building_settings')
          .select('start_view_id')
          .eq('fm_guid', buildingFmGuid)
          .maybeSingle();

        if (cancelled || !settings?.start_view_id) return;

        const { data: sv } = await supabase
          .from('saved_views')
          .select('camera_eye, camera_look, camera_up, camera_projection, view_mode, clip_height, show_spaces, show_annotations, visible_floor_ids, visible_model_ids')
          .eq('id', settings.start_view_id)
          .maybeSingle();

        if (cancelled || !sv) return;

        // Wait for VIEWER_MODELS_LOADED then dispatch
        const handler = () => {
          if (cancelled || startViewAppliedRef.current === buildingFmGuid) return;
          startViewAppliedRef.current = buildingFmGuid;

          window.dispatchEvent(new CustomEvent<LoadSavedViewDetail>(LOAD_SAVED_VIEW_EVENT, {
            detail: {
              viewId: 'start-view',
              cameraEye: sv.camera_eye || [0, 0, 0],
              cameraLook: sv.camera_look || [0, 0, 0],
              cameraUp: sv.camera_up || [0, 1, 0],
              cameraProjection: sv.camera_projection || 'perspective',
              viewMode: (sv.view_mode as '2d' | '3d') || '3d',
              clipHeight: sv.clip_height || 1.2,
              visibleModelIds: sv.visible_model_ids || [],
              visibleFloorIds: sv.visible_floor_ids || [],
              showSpaces: sv.show_spaces || false,
              showAnnotations: sv.show_annotations || false,
              visualizationType: 'none',
              visualizationMockData: false,
            },
          }));
          console.log('[NativeViewerShell] Applied start view for', buildingFmGuid);
        };

        window.addEventListener('VIEWER_MODELS_LOADED', handler);
        // Also check if models already loaded (viewer ready)
        if (isViewerReady) handler();

        return () => window.removeEventListener('VIEWER_MODELS_LOADED', handler);
      } catch (e) {
        console.warn('[NativeViewerShell] Failed to fetch start view:', e);
      }
    };

    let cleanup: (() => void) | undefined;
    fetchAndApply().then(c => { cleanup = c; });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [buildingFmGuid, isViewerReady]);

  // Indoor route from navigation handoff
  const [pendingIndoorRoute, setPendingIndoorRoute] = useState<any>(null);

  // Helper: apply a saved view to the xeokit viewer
  const applySavedView = useCallback((viewer: any, detail: LoadSavedViewDetail) => {
    if (!viewer?.camera) return;
    console.log('[NativeViewerShell] Applying saved view:', detail.viewId);
    viewer.camera.eye = detail.cameraEye;
    viewer.camera.look = detail.cameraLook;
    viewer.camera.up = detail.cameraUp;
    viewer.camera.projection = detail.cameraProjection || 'perspective';

    // Dispatch view mode if specified
    if (detail.viewMode) {
      window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode: detail.viewMode } }));
    }

    // Restore clip height
    if (detail.clipHeight != null) {
      window.dispatchEvent(new CustomEvent(CLIP_HEIGHT_CHANGED_EVENT, { detail: { height: detail.clipHeight } }));
    }

    // Restore floor visibility
    if (detail.visibleFloorIds && detail.visibleFloorIds.length > 0) {
      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
        detail: {
          floorId: detail.visibleFloorIds.length === 1 ? detail.visibleFloorIds[0] : null,
          floorName: null, bounds: null,
          visibleMetaFloorIds: [], visibleFloorFmGuids: detail.visibleFloorIds,
          isAllFloorsVisible: false,
          isSoloFloor: detail.visibleFloorIds.length === 1,
          fromFilterPanel: false,
        } as FloorSelectionEventDetail,
      }));
    }

    // Restore model visibility
    if (detail.visibleModelIds && detail.visibleModelIds.length > 0 && viewer.scene?.models) {
      const visibleSet = new Set(detail.visibleModelIds);
      Object.entries(viewer.scene.models).forEach(([modelId, model]: [string, any]) => {
        if (typeof model.visible !== 'undefined') {
          model.visible = visibleSet.has(modelId);
        }
      });
    }

    // Restore showSpaces
    if (detail.showSpaces) {
      window.dispatchEvent(new CustomEvent(FORCE_SHOW_SPACES_EVENT, { detail: { enabled: true } }));
    }

    // Restore section planes
    if (detail.sectionPlanes && Array.isArray(detail.sectionPlanes) && viewer.scene) {
      // Clear existing section planes
      const existingPlanes = Object.values(viewer.scene.sectionPlanes || {});
      existingPlanes.forEach((sp: any) => sp.destroy?.());
      // Restore section planes using the viewer's SectionPlane class
      detail.sectionPlanes.forEach((sp: { pos: number[]; dir: number[] }) => {
        try {
          // xeokit exposes SectionPlane on the scene
          const scene = viewer.scene;
          // Create via scene utility
          if (typeof scene.createSectionPlane === 'function') {
            scene.createSectionPlane({ pos: sp.pos, dir: sp.dir, active: true });
          }
        } catch (e) {
          console.warn('[NativeViewerShell] Could not restore section plane:', e);
        }
      });
    }
  }, []);

  // Object move/delete mode hook
  useObjectMoveMode(xeokitViewer, buildingFmGuid);

  // UI state
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [viewMode, setViewMode] = useState<'2d' | '3d' | '360'>('3d');
  const [showSpaces, setShowSpaces] = useState(false);
  const [showVisualizationMenu, setShowVisualizationMenu] = useState(false);
  const [showRoomVisualization, setShowRoomVisualization] = useState(false);
  const [showAssetPanel, setShowAssetPanel] = useState(false);

  // ── Inventory pick-position mode ──────────────────────────────────────
  const [isPickingPosition, setIsPickingPosition] = useState(false);
  const [pendingAssetPosition, setPendingAssetPosition] = useState<{ x: number; y: number; z: number } | null>(null);
  const [showInventorySheet, setShowInventorySheet] = useState(false);

  // Listen for asset panel toggle events (from VisualizationToolbar button)
  useEffect(() => {
    const handler = () => setShowAssetPanel(p => !p);
    window.addEventListener('TOGGLE_ASSET_PANEL', handler);
    return () => window.removeEventListener('TOGGLE_ASSET_PANEL', handler);
  }, []);

  // Listen for external toggle events (from MobileViewerPage header)
  useEffect(() => {
    const handleToggleFilter = () => setShowFilterPanel(p => !p);
    const handleToggleViz = () => setShowVisualizationMenu(p => !p);
    window.addEventListener('MOBILE_TOGGLE_FILTER_PANEL', handleToggleFilter);
    window.addEventListener('MOBILE_TOGGLE_VIZ_MENU', handleToggleViz);
    return () => {
      window.removeEventListener('MOBILE_TOGGLE_FILTER_PANEL', handleToggleFilter);
      window.removeEventListener('MOBILE_TOGGLE_VIZ_MENU', handleToggleViz);
    };
  }, []);

  // Listen for VIEWER_ZOOM_TO_OBJECT from portfolio "Open in 3D"
  useEffect(() => {
    const handler = (e: Event) => {
      const { fmGuid } = (e as CustomEvent).detail || {};
      if (!fmGuid) return;
      const viewer = (window as any).__nativeXeokitViewer;
      if (!viewer?.scene || !viewer?.cameraFlight) return;
      
      const norm = (s: string) => s.toLowerCase().replace(/-/g, '');
      const target = norm(fmGuid);
      
      const metaObjects = viewer.metaScene?.metaObjects || {};
      let entityId: string | null = null;
      for (const [id, mo] of Object.entries(metaObjects)) {
        const sysId = norm(((mo as any).originalSystemId || (mo as any).id || ''));
        if (sysId === target) {
          entityId = id;
          break;
        }
      }
      
      if (entityId) {
        const entity = viewer.scene.objects[entityId];
        if (entity) {
          viewer.scene.setObjectsVisible([entityId], true);
          viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
          viewer.scene.setObjectsSelected([entityId], true);
          viewer.cameraFlight.flyTo({ aabb: entity.aabb, duration: 1.5 });
        }
      }
    };
    window.addEventListener('VIEWER_ZOOM_TO_OBJECT', handler);
    return () => window.removeEventListener('VIEWER_ZOOM_TO_OBJECT', handler);
  }, []);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    entityId: string | null;
    fmGuid: string | null;
    entityName: string | null;
  } | null>(null);

  // Properties dialog
  const [propertiesEntity, setPropertiesEntity] = useState<{ entityId: string; fmGuid: string | null; name: string | null } | null>(null);
  const [propertiesPinned, setPropertiesPinned] = useState(false);

  // Shim ref that matches the old Asset+ ref chain for existing hooks
  const viewerShimRef = useRef<any>(null);

  // Room labels hook — listens for ROOM_LABELS_TOGGLE_EVENT
  const { setLabelsEnabled, updateFloorFilter, updateViewMode: updateRoomLabelViewMode, isEnabled: roomLabelsEnabled } = useRoomLabels(viewerShimRef);

  // Track current visible floor guids for room labels
  const currentFloorGuidsRef = React.useRef<string[]>([]);

  // Track toggle state for labels and room labels
  const labelsVisibleRef = useRef(false);
  const roomLabelsVisibleRef = useRef(false);

  // Wire room labels toggle event — pass current floor filter so labels only show for selected floors
  useEffect(() => {
    const handler = (e: CustomEvent<RoomLabelsToggleDetail>) => {
      roomLabelsVisibleRef.current = e.detail.enabled;
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

  // ── Section plane clipping hook ──────────────────────────────────────────
  const { applyCeilingClipping, removeSectionPlane } = useSectionPlaneClipping(viewerShimRef);

  /**
   * Resolve fmGuid(s) to xeokit metaObject storey IDs by searching the metaScene.
   * This handles the case where UnifiedViewer dispatches with only visibleFloorFmGuids
   * (Asset+ GUIDs) and empty visibleMetaFloorIds.
   */
  const resolveMetaFloorIds = useCallback((fmGuids: string[]): string[] => {
    const viewer = (window as any).__nativeXeokitViewer;
    if (!viewer?.metaScene?.metaObjects) return [];
    const normalizedGuids = new Set(fmGuids.map(g => g.toLowerCase().replace(/-/g, '')));
    const result: string[] = [];
    Object.values(viewer.metaScene.metaObjects).forEach((mo: any) => {
      if (mo.type?.toLowerCase() !== 'ifcbuildingstorey') return;
      const sysId = (mo.originalSystemId || mo.id || '').toLowerCase().replace(/-/g, '');
      if (normalizedGuids.has(sysId)) {
        result.push(mo.id);
      }
    });
    return result;
  }, []);

  // Wire floor selection → section plane clipping (3D ceiling clip)
  useEffect(() => {
    const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
      const { visibleMetaFloorIds, visibleFloorFmGuids, isAllFloorsVisible, skipClipping, isSoloFloor } = e.detail;
      if (skipClipping) return;

      if (isAllFloorsVisible) {
        removeSectionPlane();
        return;
      }

      // Resolve meta IDs: prefer explicit metaFloorIds, fallback to resolving fmGuids
      let metaIds = visibleMetaFloorIds?.length ? visibleMetaFloorIds : [];
      if (!metaIds.length && visibleFloorFmGuids?.length) {
        metaIds = resolveMetaFloorIds(visibleFloorFmGuids);
      }

      if (metaIds.length === 1 && isSoloFloor) {
        applyCeilingClipping(metaIds[0]);
      } else if (!metaIds.length && !visibleFloorFmGuids?.length) {
        removeSectionPlane();
      }
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, [applyCeilingClipping, removeSectionPlane, resolveMetaFloorIds]);

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

    // Apply any pending AI viewer command saved from another page
    try {
      const pending = sessionStorage.getItem('pending_ai_viewer_command');
      if (pending) {
        sessionStorage.removeItem('pending_ai_viewer_command');
        const cmd = JSON.parse(pending);
        // Delay slightly to let models finish loading
        setTimeout(() => {
          dispatchAiViewerCommand(cmd);
          if (cmd.sensorData?.length) {
            window.dispatchEvent(new CustomEvent('AI_SENSOR_DATA', { detail: cmd.sensorData }));
          }
          console.log('[NativeViewerShell] Applied pending AI viewer command:', cmd.action);
        }, 2000);
      }
    } catch (e) {
      console.warn('[NativeViewerShell] Failed to apply pending AI viewer command', e);
    }

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
            entity.colorize = [0.72, 0.83, 0.89]; // Light blue
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

    // Apply any pending LOAD_SAVED_VIEW that arrived before viewer was ready
    if (pendingSavedViewRef.current) {
      applySavedView(viewer, pendingSavedViewRef.current);
      pendingSavedViewRef.current = null;
    }
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

  // Consume pending_indoor_route from sessionStorage (navigation handoff)
  useEffect(() => {
    if (!isViewerReady) return;
    try {
      const raw = sessionStorage.getItem('pending_indoor_route');
      if (!raw) return;
      sessionStorage.removeItem('pending_indoor_route');
      const payload = JSON.parse(raw);
      if (payload.buildingFmGuid !== buildingFmGuid) return;

      // If route is already computed (from MapView), use it directly
      if (payload.route) {
        // We need to recalculate the Dijkstra route to get a RouteResult for the overlay
        // The route in sessionStorage is a GeoJSON FeatureCollection — we need path nodes
        // So we re-compute from the navigation graph
        (async () => {
          const { data: graphRows } = await supabase
            .from('navigation_graphs')
            .select('graph_data')
            .eq('building_fm_guid', buildingFmGuid);

          if (!graphRows?.length) return;
          const graphs = graphRows.map(r => parseNavGraph(r.graph_data as unknown as GeoJSON.FeatureCollection));
          const merged = mergeGraphs(graphs);
          const entrance = findNearestEntranceNode(merged);

          if (!entrance) return;

          // Try to find target from payload
          let targetNodeId: string | null = null;
          if (payload.targetRoomFmGuid) {
            const target = findNodeByRoom(merged, payload.targetRoomFmGuid);
            if (target) targetNodeId = target.nodeId;
          }

          if (!targetNodeId) {
            // Pick the last node in the graph as fallback
            const nodes = Array.from(merged.nodes.values());
            if (nodes.length === 0) return;
            targetNodeId = nodes[nodes.length - 1].nodeId;
          }

          const result = dijkstra(merged, entrance.nodeId, targetNodeId);
          if (result) setPendingIndoorRoute(result);
        })();
      }
    } catch (e) {
      console.warn('[NativeViewerShell] Failed to parse pending_indoor_route:', e);
    }
  }, [isViewerReady, buildingFmGuid]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LoadSavedViewDetail>).detail;
      if (!detail) return;
      const viewer = (window as any).__nativeXeokitViewer;
      if (viewer?.camera) {
        applySavedView(viewer, detail);
      } else {
        pendingSavedViewRef.current = detail;
      }
    };
    window.addEventListener(LOAD_SAVED_VIEW_EVENT, handler);
    return () => window.removeEventListener(LOAD_SAVED_VIEW_EVENT, handler);
  }, [applySavedView]);

  // ── 2D mode: switch camera nav mode ──────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { enabled } = (e as CustomEvent<ViewMode2DToggledDetail>).detail || {};
      const viewer = (window as any).__nativeXeokitViewer;
      if (!viewer?.scene || !viewer?.cameraControl) return;
      viewer.cameraControl.navMode = enabled ? 'planView' : 'orbit';

      // Enforce orthographic top-down camera when entering 2D mode
      if (enabled && viewer.camera) {
        const camera = viewer.camera;
        const lookX = camera.look[0], lookY = camera.look[1], lookZ = camera.look[2];
        const dx = camera.eye[0] - lookX, dy = camera.eye[1] - lookY, dz = camera.eye[2] - lookZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        camera.projection = 'ortho';
        if (camera.ortho) camera.ortho.scale = dist * 1.2;
        // Snap to top-down instantly
        camera.eye = [lookX, lookY + dist, lookZ];
        camera.look = [lookX, lookY, lookZ];
        camera.up = [0, 0, -1];

        // Disable rotation
        viewer.cameraControl.followPointer = false;
      } else if (!enabled && viewer.camera) {
        // Restore perspective when exiting 2D
        viewer.camera.projection = 'perspective';
      }
    };
    window.addEventListener(VIEW_MODE_2D_TOGGLED_EVENT, handler);
    return () => window.removeEventListener(VIEW_MODE_2D_TOGGLED_EVENT, handler);
  }, []);

  // ── Canonical fmGuid resolution ─────────────────────────────────────────
  // Resolves a raw BIM entity GUID (originalSystemId) to the canonical Asset+ fmGuid
  // by checking if the raw GUID has meaningful data; if not, finds matching Space by name.
  const resolveCanonicalFmGuid = useCallback((rawGuid: string | null, entityId: string): { fmGuid: string | null; name: string | null } => {
    const viewer = (window as any).__nativeXeokitViewer;
    const metaObj = viewer?.metaScene?.metaObjects?.[entityId];
    const entityName = metaObj?.name || metaObj?.type || null;

    if (!rawGuid) return { fmGuid: null, name: entityName };
    if (!allData?.length) return { fmGuid: rawGuid, name: entityName };

    const norm = (s: string) => s.toLowerCase().replace(/-/g, '');
    const rawNorm = norm(rawGuid);

    // Check if the raw GUID matches an asset with user-defined attributes
    const directMatch = allData.find((a: any) => a.fmGuid && norm(a.fmGuid) === rawNorm);
    if (directMatch) {
      const attrs = directMatch.attributes || {};
      const hasUserData = Object.keys(attrs).length > 0;
      if (hasUserData) {
        // Direct match has data — use it
        return { fmGuid: directMatch.fmGuid, name: entityName };
      }
    }

    // Raw GUID has no data — try to find canonical asset by name matching
    const isSpace = metaObj?.type?.toLowerCase()?.includes('ifcspace') || metaObj?.type?.toLowerCase() === 'space';
    if (isSpace && metaObj?.name) {
      const spaceName = metaObj.name.toLowerCase().trim();
      const buildingNorm = norm(buildingFmGuid);
      const candidates = allData.filter((a: any) => {
        if (!a.fmGuid || (a.category !== 'Space' && a.category !== 'IfcSpace')) return false;
        if (norm(a.buildingFmGuid || '') !== buildingNorm) return false;
        const aName = (a.commonName || a.name || '').toLowerCase().trim();
        return aName === spaceName;
      });
      // Prefer the candidate with the most attributes (user-defined data)
      if (candidates.length > 0) {
        const best = candidates.reduce((a: any, b: any) => {
          const aCount = Object.keys(a.attributes || {}).length;
          const bCount = Object.keys(b.attributes || {}).length;
          return bCount > aCount ? b : a;
        });
        const bestAttrs = Object.keys(best.attributes || {}).length;
        if (bestAttrs > 0) {
          console.log(`[CanonicalResolve] ${rawGuid} → ${best.fmGuid} (matched by name "${metaObj.name}", ${bestAttrs} attrs)`);
          return { fmGuid: best.fmGuid, name: entityName };
        }
      }
    }

    // Fallback: use the raw GUID as-is
    return { fmGuid: directMatch?.fmGuid || rawGuid, name: entityName };
  }, [allData, buildingFmGuid]);

  // ── Select tool click handler ──────────────────────────────────────────
  const activeToolRef = useRef<string | null>(null);

  useEffect(() => {
    const handler = (e: CustomEvent<ViewerToolChangedDetail>) => {
      activeToolRef.current = e.detail.tool;
    };
    window.addEventListener(VIEWER_TOOL_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(VIEWER_TOOL_CHANGED_EVENT, handler as EventListener);
  }, []);

  useEffect(() => {
    if (!xeokitViewer?.scene) return;
    const canvas = xeokitViewer.scene.canvas?.canvas;
    if (!canvas) return;

    const handleSelectClick = (e: MouseEvent) => {
      // Only select when the select tool is explicitly active
      if (activeToolRef.current !== 'select') return;
      const pickResult = xeokitViewer.scene.pick({
        canvasPos: [e.offsetX, e.offsetY],
        pickSurface: false,
      });
      if (pickResult?.entity) {
        const entityId = pickResult.entity.id;
        const isCtrl = e.ctrlKey || e.metaKey;
        const alreadySelected = pickResult.entity.selected;

        if (alreadySelected && !isCtrl) {
          // Toggle off — deselect clicked entity
          pickResult.entity.selected = false;
          if (!propertiesPinned) setPropertiesEntity(null);
          return;
        }

        if (!isCtrl) {
          // Single select — deselect all first
          const selected = xeokitViewer.scene.selectedObjectIds || [];
          if (selected.length > 0) xeokitViewer.scene.setObjectsSelected(selected, false);
        }

        pickResult.entity.selected = !alreadySelected || isCtrl;

        // When properties dialog is pinned, auto-update with newly selected entity
        if (propertiesPinned && pickResult.entity.selected) {
          const rawGuid = xeokitViewer.metaScene?.metaObjects?.[entityId]?.originalSystemId || null;
          const resolved = resolveCanonicalFmGuid(rawGuid, entityId);
          setPropertiesEntity({ entityId, fmGuid: resolved.fmGuid, name: resolved.name });
        }
      }
    };

    canvas.addEventListener('click', handleSelectClick);
    return () => canvas.removeEventListener('click', handleSelectClick);
  }, [xeokitViewer, resolveCanonicalFmGuid]);

  // ── Pick-position click handler for inventory ─────────────────────────
  useEffect(() => {
    if (!xeokitViewer?.scene || !isPickingPosition) return;
    const canvas = xeokitViewer.scene.canvas?.canvas;
    if (!canvas) return;

    canvas.style.cursor = 'crosshair';

    const handlePickClick = (e: MouseEvent) => {
      const pickResult = xeokitViewer.scene.pick({
        canvasPos: [e.offsetX, e.offsetY],
        pickSurface: true,
      });
      if (pickResult?.worldPos) {
        const [x, y, z] = pickResult.worldPos;
        setPendingAssetPosition({ x, y, z });
        setIsPickingPosition(false);
        setShowInventorySheet(true);
      }
    };

    canvas.addEventListener('click', handlePickClick);
    return () => {
      canvas.removeEventListener('click', handlePickClick);
      canvas.style.cursor = '';
    };
  }, [xeokitViewer, isPickingPosition]);

  // Listen for VIEWER_CREATE_ASSET_EVENT from mobile overlay
  useEffect(() => {
    const handler = () => {
      setIsPickingPosition(true);
    };
    window.addEventListener(VIEWER_CREATE_ASSET_EVENT, handler);
    return () => window.removeEventListener(VIEWER_CREATE_ASSET_EVENT, handler);
  }, []);

  // Cancel pick mode on Escape
  useEffect(() => {
    if (!isPickingPosition) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPickingPosition(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isPickingPosition]);

  // Context menu via right-click on canvas — only on stationary clicks (not pan drags)
  useEffect(() => {
    if (!xeokitViewer?.scene) return;

    const canvas = xeokitViewer.scene.canvas?.canvas;
    if (!canvas) return;

    let rightDownPos: { x: number; y: number } | null = null;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        rightDownPos = { x: e.clientX, y: e.clientY };
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      
      // Check if mouse moved significantly (pan gesture) — if so, skip context menu
      if (rightDownPos) {
        const dx = e.clientX - rightDownPos.x;
        const dy = e.clientY - rightDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          rightDownPos = null;
          return; // Let xeokit handle the pan
        }
      }
      rightDownPos = null;

      e.stopPropagation();

      const pickResult = xeokitViewer.scene.pick({
        canvasPos: [e.offsetX, e.offsetY],
        pickSurface: false,
      });

      const entityId = pickResult?.entity?.id || null;
      let fmGuid: string | null = null;
      let entityName: string | null = null;

      if (entityId) {
        const rawGuid = xeokitViewer.metaScene?.metaObjects?.[entityId]?.originalSystemId || null;
        const resolved = resolveCanonicalFmGuid(rawGuid, entityId);
        fmGuid = resolved.fmGuid;
        entityName = resolved.name;
      }

      setContextMenu({ position: { x: e.clientX, y: e.clientY }, entityId, fmGuid, entityName });
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('contextmenu', handleContextMenu);

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
        if (entityId) {
          const rawGuid = xeokitViewer.metaScene?.metaObjects?.[entityId]?.originalSystemId || null;
          const resolved = resolveCanonicalFmGuid(rawGuid, entityId);
          fmGuid = resolved.fmGuid;
          entityName = resolved.name;
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

    canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
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
    let resolvedFmGuid = contextMenu.fmGuid;
    const normalize = (g: string) => g.toLowerCase().replace(/-/g, '');

    // Try to resolve the correct database fmGuid via normalized comparison (strip hyphens)
    if (resolvedFmGuid && allData?.length) {
      const norm = normalize(resolvedFmGuid);
      const matchingAsset = allData.find(
        (a: any) => a.fmGuid && normalize(a.fmGuid) === norm
      );
      if (matchingAsset) {
        resolvedFmGuid = matchingAsset.fmGuid;
      }
    }

    // Fallback: if no fmGuid or no match, try entityId against database fmGuids
    if (!resolvedFmGuid && contextMenu.entityId && allData?.length) {
      const norm = normalize(contextMenu.entityId);
      const byEntityId = allData.find(
        (a: any) => a.fmGuid && normalize(a.fmGuid) === norm
      );
      if (byEntityId) resolvedFmGuid = byEntityId.fmGuid;
    }

    setPropertiesEntity({
      entityId: contextMenu.entityId || '',
      fmGuid: resolvedFmGuid,
      name: contextMenu.entityName,
    });
  }, [contextMenu, allData]);

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

  const handleContextCreateAsset = useCallback(() => {
    setIsPickingPosition(true);
  }, []);

  const handleChangeViewMode = useCallback((mode: '2d' | '3d' | '360') => {
    setViewMode(mode);
    window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, { detail: { mode } }));
  }, []);

  // Calculate left offset for floor switcher and filter button based on sidebar
  const sidebarOffset = !isMobile && isSidebarExpanded ? 'left-[calc(3.5rem+12px)]' : 'left-3';

    return (
    <div className="flex flex-row w-full h-full overflow-hidden">
      {/* Main viewer area — shrinks when properties panel is open */}
      <div className="flex-1 relative overflow-hidden native-viewer-canvas-parent" style={{ background: 'linear-gradient(180deg, #2D2D2D 0%, #3A3A3A 100%)' }}>
      {/* Desktop back button — hidden when parent (UnifiedViewer) has its own */}
      {!isMobile && !hideBackButton && (
        <Button
          variant="secondary"
          size="icon"
          onClick={onClose}
          className="absolute top-3 left-3 z-40 h-9 w-9 bg-card/80 backdrop-blur-sm shadow-md border"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Canvas layer */}
      <NativeXeokitViewer
        key={viewerReloadKey}
        buildingFmGuid={buildingFmGuid}
        onClose={onClose}
        onViewerReady={handleViewerReady}
        forceBootstrap={forceBootstrap}
      />

      {/* Bottom toolbar — always mounted for event handling, hidden visually when hideToolbar */}
      {isViewerReady && xeokitViewer && (
        <div style={hideToolbar ? { position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0, overflow: 'hidden' } : undefined}>
          <ViewerToolbar viewer={xeokitViewer} />
        </div>
      )}

      {/* Mobile header overlay — hidden when parent (UnifiedViewer) provides its own */}
      {isMobile && isViewerReady && !hideMobileOverlay && (
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

      {/* Floor switcher — positioned below the filter icon */}
      {isViewerReady && !hideFloorSwitcher && (
        <FloatingFloorSwitcher
          viewerRef={viewerShimRef}
          buildingFmGuid={buildingFmGuid}
          isViewerReady={isViewerReady}
          className={!isMobile
            ? `${hideBackButton ? 'top-12' : 'top-14'} ${sidebarOffset}`
            : 'bottom-[3.5rem] left-1/2 -translate-x-1/2'
          }
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
                className={`absolute ${hideBackButton ? 'top-2' : 'top-3'} ${sidebarOffset} z-40 h-9 w-9 bg-card/95 backdrop-blur-sm shadow-md border`}
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
            // Set explicit user toggle flag to prevent FORCE_SHOW_SPACES from overriding
            (window as any).__spacesUserExplicitOff = !show;
            const assetViewer = viewerShimRef.current?.assetViewer || viewerShimRef.current?.$refs?.AssetViewer;
            assetViewer?.onShowSpacesChanged?.(show);
          }}
          showVisualization={showRoomVisualization}
          onToggleVisualization={(visible) => setShowRoomVisualization(visible)}
          externalOpen={showVisualizationMenu}
          onExternalOpenChange={setShowVisualizationMenu}
        />
      )}

      {/* Room Visualization Panel — always mounted when viewer ready so color filter events work */}
      {isViewerReady && buildingFmGuid && (
        <RoomVisualizationPanel
          viewerRef={viewerShimRef}
          buildingFmGuid={buildingFmGuid}
          onShowSpaces={(show) => {
            setShowSpaces(show);
            const assetViewer = viewerShimRef.current?.assetViewer || viewerShimRef.current?.$refs?.AssetViewer;
            assetViewer?.onShowSpacesChanged?.(show);
          }}
          embedded
          className="hidden"
        />
      )}

      {/* Left-side visualization legend overlay */}
      {isViewerReady && <VisualizationLegendOverlay />}

      {/* Asset panel — independent from visualization menu */}
      {isViewerReady && buildingFmGuid && (
        <InventoryPanel
          buildingFmGuid={buildingFmGuid}
          buildingName={buildingName}
          open={showAssetPanel}
          onClose={() => setShowAssetPanel(false)}
        />
      )}

      {/* Indoor route overlay from navigation handoff */}
      {pendingIndoorRoute && (
        <RouteDisplayOverlay route={pendingIndoorRoute} />
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
            labelsVisibleRef.current = !labelsVisibleRef.current;
            window.dispatchEvent(new CustomEvent('TOGGLE_ANNOTATIONS', { detail: { show: labelsVisibleRef.current } }));
          }}
          onCreateIssue={() => {
            setShowVisualizationMenu(true);
          }}
          onViewIssues={() => {
            setShowVisualizationMenu(true);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('OPEN_ISSUE_LIST'));
            }, 100);
          }}
          onShowRoomLabels={() => {
            const next = !roomLabelsVisibleRef.current;
            roomLabelsVisibleRef.current = next;
            window.dispatchEvent(new CustomEvent(ROOM_LABELS_TOGGLE_EVENT, { detail: { enabled: next } }));
          }}
          onShowProperties={handleContextProperties}
          onZoomTo={handleContextZoomTo}
          onHideEntity={handleContextHide}
          onIsolateEntity={handleContextIsolate}
          onShowAll={handleContextShowAll}
          onSelectEntity={handleContextSelect}
          onSelectNone={() => {
            if (!xeokitViewer?.scene) return;
            const selected = xeokitViewer.scene.selectedObjectIds || [];
            if (selected.length > 0) xeokitViewer.scene.setObjectsSelected(selected, false);
            setPropertiesEntity(null);
          }}
          onMoveObject={handleContextMove}
          onDeleteObject={handleContextDelete}
          onCreateAsset={handleContextCreateAsset}
          labelsActive={labelsVisibleRef.current}
          roomLabelsActive={roomLabelsVisibleRef.current}
        />
      )}

      {/* Sensor data overlay from AI */}
      <SensorDataOverlay />

      {/* Pick-position mode indicator */}
      {isPickingPosition && (
        <div className="absolute top-3 left-3 z-50 pointer-events-none">
          <div className="bg-card/90 backdrop-blur-sm border rounded-lg px-4 py-2 shadow-lg text-sm font-medium text-foreground">
            Click to select position
          </div>
        </div>
      )}

      {/* Inventory form sheet */}
      <InventoryFormSheet
        isOpen={showInventorySheet}
        onClose={() => {
          setShowInventorySheet(false);
          setPendingAssetPosition(null);
        }}
        buildingFmGuid={buildingFmGuid}
        pendingPosition={pendingAssetPosition}
        onPickPositionRequest={() => {
          setShowInventorySheet(false);
          setIsPickingPosition(true);
        }}
        isPickingPosition={isPickingPosition}
        onPendingPositionConsumed={() => setPendingAssetPosition(null)}
      />
      </div>

      {/* Properties panel — renders as flex sibling to shrink canvas */}
      {propertiesEntity && (
        <UniversalPropertiesDialog
          isOpen={!!propertiesEntity}
          onClose={() => { setPropertiesEntity(null); setPropertiesPinned(false); }}
          fmGuids={propertiesEntity.fmGuid || propertiesEntity.entityId}
          entityId={propertiesEntity.entityId}
          isPinned={propertiesPinned}
          onPinToggle={() => setPropertiesPinned(p => !p)}
          inline
        />
      )}
    </div>
  );
};

export default NativeViewerShell;
