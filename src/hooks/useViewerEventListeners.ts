/**
 * useViewerEventListeners — Consolidates all CustomEvent listeners for the 3D viewer.
 *
 * Handles: insights colorization, alarm annotations, space visibility, color reset,
 * navigation speed, FastNav toggle, annotation markers, entity selection, model loading,
 * and floor tile switching.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeGuid } from '@/lib/utils';
import { applyArchitectColors } from '@/lib/architect-colors';
import { toast } from 'sonner';
import { emit, on } from '@/lib/event-bus';
import { logger } from '@/lib/logger';
import { subscribeToBuildingAnnotations } from '@/viewer/annotationsRealtime';
import { projectWorldToCanvas } from '@/viewer/worldToCanvas';
import {
  INSIGHTS_COLOR_UPDATE_EVENT,
  INSIGHTS_COLOR_RESET_EVENT,
  ALARM_ANNOTATIONS_SHOW_EVENT,
  FORCE_SHOW_SPACES_EVENT,
  FLOOR_SELECTION_CHANGED_EVENT,
} from '@/lib/viewer-events';
import type {
  InsightsColorUpdateDetail,
  AlarmAnnotationsShowDetail,
  FloorSelectionEventDetail,
  ModelLoadRequestedDetail,
} from '@/lib/event-bus';
import type { ModelInfo } from '@/hooks/useModelLoader';

/** Project a 3D world position to 2D canvas coordinates */
function worldToCanvas(viewer: any, worldPos: number[]): [number, number, number] | null {
  return projectWorldToCanvas(viewer?.scene?.camera, viewer?.scene?.canvas?.canvas, worldPos as [number, number, number]);
}

interface UseViewerEventListenersOptions {
  viewerRef: React.RefObject<any>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  buildingFmGuid: string;
  pendingInsightsColorRef: React.RefObject<InsightsColorUpdateDetail | null>;
}

export function useViewerEventListeners({
  viewerRef,
  canvasRef,
  buildingFmGuid,
  pendingInsightsColorRef,
}: UseViewerEventListenersOptions) {
  const isMobileRef = useRef(false);

  // ── MODEL_LOAD_REQUESTED (on-demand secondary model loading) ──
  useEffect(() => {
    const handler = async (detail: ModelLoadRequestedDetail) => {
      const requestedModelId = detail?.modelId?.replace(/\.xkt$/i, '');
      if (!requestedModelId) return;
      const sceneModels = viewerRef.current?.scene?.models || {};
      if (sceneModels[requestedModelId]) return;
      const secondaryQueue: Array<ModelInfo & { model_id?: string }> = (window as any).__secondaryModelQueue || [];
      const requestedModel = secondaryQueue.find((model: any) => {
        const candidateId = (model.model_id || model.id || '').replace(/\.xkt$/i, '');
        return candidateId === requestedModelId;
      });
      if (!requestedModel) return;
      try { await (window as any).__loadSecondaryModel?.(requestedModel); } catch {}
    };
    const off = on('MODEL_LOAD_REQUESTED', handler);
    return () => off();
  }, [viewerRef]);

  // ── FLOOR_TILE_SWITCH (dynamic tile loading for real per-storey tiles) ──
  useEffect(() => {
    const handler = async (detail: any) => {
      if (!detail?.tiles || !detail?.floorFmGuid) return;
      const viewer = viewerRef.current;
      if (!viewer?.scene) return;
      const allChunks: any[] = (window as any).__xktTileChunks || [];
      const loadedIds: Set<string> = (window as any).__xktTileLoadedIds || new Set();
      if (allChunks.length === 0) return;
      const tilesToLoad = detail.tiles as Array<{ modelId: string }>;
      const neededIds = new Set(tilesToLoad.map((t: any) => t.modelId));

      for (const loadedId of loadedIds) {
        if (!neededIds.has(loadedId)) {
          try { viewer.scene.models?.[loadedId]?.destroy(); } catch {}
          loadedIds.delete(loadedId);
        }
      }

      for (const tile of tilesToLoad) {
        if (loadedIds.has(tile.modelId)) continue;
        const chunk = allChunks.find((c: any) => c.model_id === tile.modelId);
        if (!chunk) continue;
        try {
          const { data: urlData } = await supabase.storage.from('xkt-models').createSignedUrl(chunk.storage_path, 3600);
          if (urlData?.signedUrl) {
            const sdk = (window as any).__xeokitSdk;
            if (!sdk) continue;
            const xktLoader = new sdk.XKTLoaderPlugin(viewer);
            const entity = xktLoader.load({ id: tile.modelId, src: urlData.signedUrl, edges: true });
            await new Promise<void>((resolve) => {
              entity?.on?.('loaded', () => resolve());
              entity?.on?.('error', () => resolve());
              setTimeout(resolve, 60000);
            });
            loadedIds.add(tile.modelId);
          }
        } catch {}
      }
    };
    const off = on('FLOOR_TILE_SWITCH', handler);
    return () => off();
  }, [viewerRef]);

  // ── INSIGHTS_COLOR_UPDATE (colorize entities by insights data) ──
  useEffect(() => {
    const handler = (detail: InsightsColorUpdateDetail) => {
      if (!detail?.colorMap) return;
      const viewer = viewerRef.current;
      if (!viewer?.scene || !viewer?.metaScene) {
        if (pendingInsightsColorRef.current !== undefined) {
          (pendingInsightsColorRef as React.MutableRefObject<InsightsColorUpdateDetail | null>).current = detail;
        }
        return;
      }

      const { mode, colorMap } = detail;
      const scene = viewer.scene;
      const metaObjects = viewer.metaScene.metaObjects;
      if (!metaObjects) return;

      // Buffer matches first — defer xray until we know matchCount > 0
      let matchCount = 0;
      const alreadyColored = new Set<string>();
      const pendingColorizations: Array<{ id: string; rgb: [number, number, number]; opacity: number }> = [];

      const colorizeEntity = (mo: any, rgb: [number, number, number], opacity = 1.0) => {
        const entity = scene.objects?.[mo.id];
        if (entity) {
          pendingColorizations.push({ id: mo.id, rgb, opacity });
          alreadyColored.add(mo.id);
          matchCount++;
        }
      };
      // ── colorize logic continues below ──
      // (inserted opening brace replaced — see closing log line for end)
      const _runColorize = () => {
      // Direct entity ID map (bypass GUID matching)
      if (detail.entityColorMap) {
        Object.entries(detail.entityColorMap).forEach(([entityId, rgb]) => {
          const entity = scene.objects?.[entityId];
          if (entity) {
            pendingColorizations.push({ id: entityId, rgb, opacity: 0.85 });
            alreadyColored.add(entityId);
            matchCount++;
          }
        });
      }

      // Space entity ID cache
      const spaceEntityIdCache = (window as any).__spaceEntityIdCache as Map<string, string[]> | undefined;
      if (spaceEntityIdCache) {
        Object.entries(colorMap).forEach(([fmGuid, rgb]) => {
          const normGuid = normalizeGuid(fmGuid);
          const entityIds = spaceEntityIdCache.get(normGuid);
          entityIds?.forEach(entityId => {
            if (!alreadyColored.has(entityId)) colorizeEntity({ id: entityId }, rgb);
          });
        });
      }

      const fmGuidLookup = new Map<string, [number, number, number]>();
      Object.entries(colorMap).forEach(([key, rgb]) => fmGuidLookup.set(normalizeGuid(key), rgb));

      // Build a name lookup from colorMap keys (room names) as a fallback
      const roomNameRegistry = (window as any).__roomNameRegistry as Map<string, string> | undefined;
      const guidByRoomName = new Map<string, string>();
      if (roomNameRegistry) {
        roomNameRegistry.forEach((name: string, guid: string) => {
          if (name) guidByRoomName.set(name.toLowerCase().trim(), normalizeGuid(guid));
        });
      }

      if (mode === 'asset_category' || mode === 'asset_categories') {
        const typeColorLookup = new Map<string, [number, number, number]>();
        Object.entries(colorMap).forEach(([typeName, rgb]) => {
          typeColorLookup.set(typeName.toLowerCase(), rgb);
          typeColorLookup.set(('ifc' + typeName).toLowerCase(), rgb);
        });
        Object.values(metaObjects).forEach((mo: any) => {
          const ifcType = (mo.type || '').toLowerCase();
          const stripped = ifcType.replace(/^ifc/, '');
          const rgb = typeColorLookup.get(ifcType) || typeColorLookup.get(stripped);
          if (rgb) colorizeEntity(mo, rgb);
        });
      } else {
        const isRoomMode = mode === 'room_spaces' || mode === 'room_type' || mode === 'room_types';
        const isFloorMode = mode.startsWith('energy_floor');
        const nameColorMap = detail.nameColorMap || {};
        const useStrictGuidMode = detail.strictGuidMode || false;

        Object.values(metaObjects).forEach((mo: any) => {
          if (alreadyColored.has(mo.id)) return;
          if (isRoomMode) {
            const t = (mo.type || '').toLowerCase();
            if (t !== 'ifcspace' && t !== 'ifc_space' && t !== 'space') return;
          }
          const sysId = normalizeGuid(mo.originalSystemId || '');
          const moId = normalizeGuid(mo.id || '');
          const moName = (mo.name || '').toLowerCase().trim();
          // XKT entity ID → FM GUID bridge for Asset+ models (name-matched at load time)
          const xktIdToFmGuid = (window as any).__xktIdToFmGuid as Map<string, string> | undefined;
          const fmFromXkt = xktIdToFmGuid
            ? (xktIdToFmGuid.get(sysId) || xktIdToFmGuid.get(moId))
            : undefined;
          let rgb = fmGuidLookup.get(sysId) || fmGuidLookup.get(moId)
            || (fmFromXkt ? fmGuidLookup.get(fmFromXkt) : undefined);
          if (!rgb && !useStrictGuidMode && moName && nameColorMap[moName]) rgb = nameColorMap[moName];
          // Broader fallback: match metaObject name against room name registry
          if (!rgb && isRoomMode && moName) {
            const altGuid = guidByRoomName.get(moName);
            if (altGuid) rgb = fmGuidLookup.get(altGuid);
          }
          if (rgb) {
            if (isRoomMode) {
              const entity = scene.objects?.[mo.id];
              if (entity) { entity.visible = true; entity.pickable = true; }
            }
            colorizeEntity(mo, rgb);
            if (isFloorMode) {
              const colorizeChildren = (obj: any) => {
                obj.children?.forEach((child: any) => {
                  const e = scene.objects?.[child.id];
                  if (e) { pendingColorizations.push({ id: child.id, rgb: rgb!, opacity: 1.0 }); matchCount++; }
                  colorizeChildren(child);
                });
              };
              colorizeChildren(mo);
            }
          }
        });
      }
      };
      _runColorize();

      // GUID matching found nothing — try name-based fallback before giving up.
      // This handles buildings where XKT entity IDs don't match Supabase FM GUIDs.
      if (matchCount === 0 && detail.nameColorMap && Object.keys(detail.nameColorMap).length > 0) {
        const nmcm = detail.nameColorMap;
        const isRoomMode2 = mode === 'room_spaces' || mode === 'room_type' || mode === 'room_types';
        Object.values(metaObjects).forEach((mo: any) => {
          if (alreadyColored.has(mo.id)) return;
          if (isRoomMode2) {
            const t = (mo.type || '').toLowerCase();
            if (t !== 'ifcspace' && t !== 'ifc_space' && t !== 'space') return;
          }
          const moName = (mo.name || '').toLowerCase().trim();
          const rgb = moName ? nmcm[moName] : undefined;
          if (rgb) {
            const entity = scene.objects?.[mo.id];
            if (entity) { entity.visible = true; entity.pickable = true; }
            colorizeEntity(mo, rgb, 1.0);
          }
        });
      }

      logger.log('[ViewerEvents] INSIGHTS_COLOR_UPDATE:', mode, Object.keys(colorMap).length, 'entries,', matchCount, 'matched');

      if (matchCount === 0) {
        (window as any).__colorFilterActive = false;
        logger.warn('[ViewerEvents] No entity matches for color filter — skipping xray pass');
        return;
      }

      // Now safe to xray + apply buffered colorizations
      const xrayMat = scene.xrayMaterial;
      if (xrayMat) {
        xrayMat.fill = true; xrayMat.fillAlpha = 0.08; xrayMat.fillColor = [0.55, 0.55, 0.6];
        xrayMat.edges = true; xrayMat.edgeAlpha = 0.15;
      }
      scene.setObjectsXRayed(scene.objectIds, true);
      (window as any).__colorFilterActive = true;

      for (const { id, rgb, opacity } of pendingColorizations) {
        const entity = scene.objects?.[id];
        if (entity) {
          entity.xrayed = false; entity.visible = true;
          entity.colorize = rgb; entity.opacity = opacity;
        }
      }
    };
    const off = on('INSIGHTS_COLOR_UPDATE', handler);
    return () => off();
  }, [viewerRef, pendingInsightsColorRef]);

  // ── FORCE_SHOW_SPACES ──
  useEffect(() => {
    const handler = (detail: any) => {
      const show = detail?.show ?? true;
      const viewer = viewerRef.current;
      if (!viewer?.scene || !viewer?.metaScene?.metaObjects) return;
      if (show && (window as any).__spacesUserExplicitOff) return;

      const metaObjects = viewer.metaScene.metaObjects;
      const scene = viewer.scene;
      (window as any).__spacesForceVisible = show;

      const SPACE_COLOR: [number, number, number] = [184 / 255, 212 / 255, 227 / 255];
      const floorFilterRaw = (detail?.floorGuids as string[] | undefined) ?? [];
      let visibleFloorKeys: Set<string> | null = null;
      if (floorFilterRaw.length > 0) {
        visibleFloorKeys = new Set(floorFilterRaw.map((g: string) => g.toLowerCase().replace(/-/g, '')));
      }

      Object.values(metaObjects).forEach((mo: any) => {
        const ifcType = (mo.type || '').toLowerCase();
        if (ifcType !== 'ifcspace' && ifcType !== 'ifc_space' && ifcType !== 'space') return;
        const entity = scene.objects?.[mo.id];
        if (!entity) return;
        let belongsToFloor = true;
        if (visibleFloorKeys?.size) {
          belongsToFloor = false;
          let current = mo;
          while (current?.parent) {
            current = current.parent;
            if (current?.type?.toLowerCase() === 'ifcbuildingstorey') {
              belongsToFloor = visibleFloorKeys.has((current.originalSystemId || current.id || '').toLowerCase().replace(/-/g, ''));
              break;
            }
          }
        }
        if (show && belongsToFloor) {
          entity.visible = true; entity.pickable = true; entity.colorize = SPACE_COLOR; entity.opacity = 0.25;
        } else if (!show) {
          entity.visible = false; entity.pickable = false; entity.colorize = null; entity.opacity = 1.0;
        }
      });
    };
    const off = on('FORCE_SHOW_SPACES', handler);
    return () => off();
  }, [viewerRef]);

  // ── INSIGHTS_COLOR_RESET ──
  useEffect(() => {
    const handler = () => {
      const viewer = viewerRef.current;
      if (!viewer?.scene) return;
      const scene = viewer.scene;
      scene.setObjectsXRayed(scene.objectIds, false);
      scene.alphaDepthMask = true;
      (window as any).__colorFilterActive = false;
      // Clean up alarm DOM markers
      const alarmContainer = (window as any).__alarmMarkerContainer as HTMLDivElement | null;
      if (alarmContainer) { alarmContainer.remove(); (window as any).__alarmMarkerContainer = null; }
      const alarmUnsubs = (window as any).__alarmMarkerCameraUnsubs as Array<() => void> | null;
      if (alarmUnsubs) { alarmUnsubs.forEach(fn => fn()); (window as any).__alarmMarkerCameraUnsubs = null; }
      const vizSet = (window as any).__vizColorizedEntityIds;
      if (vizSet instanceof Set) vizSet.clear();
      // Restore native model colors (no automatic architect palette)
      const nativeColors = (window as any).__xeokitNativeColors as Map<string, { color: number[]; opacity: number; edges: boolean }> | undefined;
      if (nativeColors) {
        for (const [objId, props] of nativeColors) {
          const entity = scene.objects?.[objId];
          if (entity) {
            entity.colorize = props.color;
            entity.opacity = props.opacity;
          }
        }
      }
    };
    const off = on('INSIGHTS_COLOR_RESET', handler);
    return () => off();
  }, [viewerRef]);

  // ── ALARM_ANNOTATIONS_SHOW ──
  useEffect(() => {
    const handler = (detail: AlarmAnnotationsShowDetail) => {
      if (!detail?.alarms?.length) return;
      const viewer = viewerRef.current;
      if (!viewer?.scene || !viewer?.metaScene) return;
      const scene = viewer.scene;
      const metaObjects = viewer.metaScene.metaObjects;

      const alarmGuids = new Set(detail.alarms.map(a => normalizeGuid(a.fmGuid)));
      const roomGuids = new Set(detail.alarms.filter(a => a.roomFmGuid).map(a => normalizeGuid(a.roomFmGuid!)));

      const xrayMat = scene.xrayMaterial;
      if (xrayMat) { xrayMat.fill = true; xrayMat.fillAlpha = 0.15; xrayMat.fillColor = [0.55, 0.55, 0.6]; xrayMat.edges = true; xrayMat.edgeAlpha = 0.3; }
      scene.setObjectsXRayed(scene.objectIds, true);

      const matchedIds: string[] = [];
      Object.values(metaObjects).forEach((mo: any) => {
        const sysId = normalizeGuid(mo.originalSystemId || '');
        const moId = normalizeGuid(mo.id || '');
        if (alarmGuids.has(sysId) || alarmGuids.has(moId)) {
          const entity = scene.objects?.[mo.id];
          if (entity) { entity.xrayed = false; entity.visible = true; entity.colorize = [0.9, 0.2, 0.15]; entity.opacity = 1.0; matchedIds.push(mo.id); }
        }
      });

      Object.values(metaObjects).forEach((mo: any) => {
        if (mo.type !== 'IfcSpace') return;
        const sysId = normalizeGuid(mo.originalSystemId || '');
        const moId = normalizeGuid(mo.id || '');
        if (roomGuids.has(sysId) || roomGuids.has(moId)) {
          const entity = scene.objects?.[mo.id];
          if (entity) {
            entity.xrayed = false; entity.visible = true; entity.pickable = true;
            entity.colorize = matchedIds.length === 0 ? [0.9, 0.2, 0.15] : [1.0, 0.6, 0.2];
            entity.opacity = matchedIds.length === 0 ? 0.8 : 0.6;
            matchedIds.push(mo.id);
          }
        }
      });

      if (detail.flyTo && matchedIds.length > 0) {
        viewer.cameraFlight?.flyTo({ aabb: scene.getAABB(matchedIds), duration: 1.0 });
      }

      // Create DOM pin markers for alarm positions
      const existingAlarmContainer = (window as any).__alarmMarkerContainer as HTMLDivElement | null;
      const existingAlarmUnsubs = (window as any).__alarmMarkerCameraUnsubs as Array<() => void> | null;
      if (existingAlarmContainer) { existingAlarmContainer.remove(); (window as any).__alarmMarkerContainer = null; }
      if (existingAlarmUnsubs) { existingAlarmUnsubs.forEach(fn => fn()); (window as any).__alarmMarkerCameraUnsubs = null; }

      const canvas = viewer.scene.canvas?.canvas;
      const parent = canvas?.parentElement;
      if (parent && matchedIds.length > 0) {
        const container = document.createElement('div');
        container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:30;overflow:hidden;';
        parent.appendChild(container);
        (window as any).__alarmMarkerContainer = container;
        const cameraUnsubs: Array<() => void> = [];

        for (const entityId of matchedIds) {
          const entity = scene.objects?.[entityId];
          if (!entity?.aabb) continue;
          const aabb = entity.aabb;
          const worldPos = [(aabb[0] + aabb[3]) / 2, aabb[4], (aabb[2] + aabb[5]) / 2];

          const marker = document.createElement('div');
          marker.style.cssText = 'position:absolute;pointer-events:none;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;color:white;background:#dc2626;white-space:nowrap;transform:translate(-50%,-100%);box-shadow:0 2px 6px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.25);';
          marker.textContent = '⚠ Alarm';
          container.appendChild(marker);

          const updatePos = () => {
            if (!viewer.scene?.canvas) return;
            const pos = worldToCanvas(viewer, worldPos);
            if (pos && pos[2] > 0) {
              marker.style.left = pos[0] + 'px';
              marker.style.top = pos[1] + 'px';
              marker.style.display = 'block';
            } else {
              marker.style.display = 'none';
            }
          };
          const unsub = viewer.scene.camera?.on?.('matrix', updatePos);
          if (unsub) cameraUnsubs.push(() => viewer.scene.camera?.off?.('matrix', unsub));
          updatePos();
        }
        (window as any).__alarmMarkerCameraUnsubs = cameraUnsubs;
      }
    };
    const off = on('ALARM_ANNOTATIONS_SHOW', handler);
    return () => off();
  }, [viewerRef]);

  // ── NAV_SPEED + FASTNAV ──
  useEffect(() => {
    const masterHandler = (detail: { speed: number }) => {
      const speed = detail?.speed ?? 100;
      const m = Math.max(0.25, Math.min(3, speed / 100));
      const cc = viewerRef.current?.cameraControl;
      if (!cc) return;
      const mob = isMobileRef.current;
      cc.dragRotationRate = (mob ? 45 : 120) * m;
      cc.touchPanRate = (mob ? 0.08 : 0.3) * m;
      cc.touchDollyRate = (mob ? 0.06 : 0.15) * m;
      if (!mob) { cc.mouseWheelDollyRate = 50 * m; cc.keyboardDollyRate = 5 * m; }
      else { cc.mouseWheelDollyRate = 15 * m; cc.keyboardDollyRate = 2 * m; }
    };
    const granularHandler = (d: any) => {
      const cc = viewerRef.current?.cameraControl;
      if (!cc) return;
      const mob = isMobileRef.current;
      const zM = Math.max(0.25, Math.min(3, (d?.zoom ?? 100) / 100));
      const pM = Math.max(0.25, Math.min(3, (d?.pan ?? 100) / 100));
      const rM = Math.max(0.25, Math.min(3, (d?.rotate ?? 100) / 100));
      cc.dragRotationRate = (mob ? 45 : 120) * rM;
      cc.touchPanRate = (mob ? 0.08 : 0.3) * pM;
      cc.touchDollyRate = (mob ? 0.06 : 0.15) * zM;
      if (!mob) { cc.mouseWheelDollyRate = 50 * zM; cc.keyboardDollyRate = 5 * zM; }
      else { cc.mouseWheelDollyRate = 15 * zM; cc.keyboardDollyRate = 2 * zM; }
    };
    const fastNavHandler = (detail: { enabled: boolean }) => {
      const enabled = detail?.enabled ?? false;
      const viewer = viewerRef.current;
      if (!viewer?.scene) return;
      viewer.scene.pbrEnabled = !enabled;
    };
    const offMasterHandler = on('NAV_SPEED_CHANGED', masterHandler);
    const offGranularHandler = on('NAV_SPEED_GRANULAR', granularHandler);
    const offFastNavHandler = on('FASTNAV_TOGGLE', fastNavHandler);
    return () => {
      offMasterHandler();
      offGranularHandler();
      offFastNavHandler();
    };
  }, [viewerRef]);

  // ── TOGGLE_ANNOTATIONS (annotation markers) ──
  useEffect(() => {
    let markerContainer: HTMLDivElement | null = null;
    let cameraUnsubs: Array<() => void> = [];
    let currentFloorFilter: string | null = null;
    let markerAnnotationMap: Map<HTMLDivElement, { level_fm_guid: string | null }> = new Map();
    // Last show/visibleCategories the handler was run with, so a Realtime-triggered
    // refresh (an annotation created/changed in another viewer or tab) can re-render
    // with the same visibility the user last chose, instead of needing a manual toggle.
    // Starts at show:false because that's this panel's actual default (see
    // ViewerRightPanel.tsx's localShowAnnotations) — TOGGLE_ANNOTATIONS is normally
    // only ever emitted after the user opts in, so a Realtime tick before that should
    // stay a no-op rather than surprise-enabling markers.
    let lastDetail: { show?: boolean; visibleCategories?: string[] } = { show: false };

    const applyFloorFilter = () => {
      markerAnnotationMap.forEach((ann, marker) => {
        if (!currentFloorFilter) {
          if (marker.dataset.catHidden !== 'true') marker.dataset.floorHidden = 'false';
        } else {
          const onFloor = ann.level_fm_guid && ann.level_fm_guid.toLowerCase() === currentFloorFilter.toLowerCase();
          if (!onFloor) { marker.style.display = 'none'; marker.dataset.floorHidden = 'true'; }
          else marker.dataset.floorHidden = 'false';
        }
      });
    };

    const floorHandler = (detail: FloorSelectionEventDetail) => {
      if (detail?.isAllFloorsVisible || !detail?.floorId) {
        currentFloorFilter = null;
      } else {
        const viewer = viewerRef.current;
        let resolvedFmGuid: string | null = null;
        if (viewer?.metaScene) {
          const mo = viewer.metaScene.metaObjects?.[detail.floorId];
          if (mo?.originalSystemId) resolvedFmGuid = mo.originalSystemId;
        }
        currentFloorFilter = resolvedFmGuid || detail.floorId;
      }
      applyFloorFilter();
    };
    const offFloorHandler = on('FLOOR_SELECTION_CHANGED', floorHandler);

    const handler = async (detail: any) => {
      lastDetail = { show: detail?.show ?? true, visibleCategories: detail?.visibleCategories };
      const show = detail?.show ?? true;
      const visibleCategories: string[] | undefined = detail?.visibleCategories;
      const viewer = viewerRef.current;

      if (!show && markerContainer) { markerContainer.style.display = 'none'; return; }
      if (markerContainer) { cameraUnsubs.forEach(fn => fn()); cameraUnsubs = []; markerContainer.remove(); markerContainer = null; }
      markerAnnotationMap = new Map();
      if (!show || !viewer?.scene) return;

      try {
        const { data: annotations } = await supabase
          .from('assets')
          .select('fm_guid, common_name, name, asset_type, coordinate_x, coordinate_y, coordinate_z, symbol_id, in_room_fm_guid, level_fm_guid')
          .eq('building_fm_guid', buildingFmGuid)
          .not('symbol_id', 'is', null);

        if (!annotations?.length) return;
        const catSet = visibleCategories?.length ? new Set(visibleCategories) : null;

        const symbolIds = [...new Set(annotations.filter(a => a.symbol_id).map(a => a.symbol_id!))];
        const symbolColors = new Map<string, string>();
        if (symbolIds.length > 0) {
          const { data: symbols } = await supabase.from('annotation_symbols').select('id, color').in('id', symbolIds);
          symbols?.forEach(s => symbolColors.set(s.id, s.color));
        }

        const canvas = viewer.scene.canvas?.canvas;
        const parent = canvas?.parentElement;
        if (!parent) return;

        const container = document.createElement('div');
        container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:30;overflow:hidden;';
        parent.appendChild(container);
        markerContainer = container;

        annotations.forEach(ann => {
          const color = ann.symbol_id ? (symbolColors.get(ann.symbol_id) || '#3b82f6') : '#3b82f6';
          const label = ann.common_name || ann.name || 'Annotation';
          const marker = document.createElement('div');
          marker.style.cssText = `position:absolute;pointer-events:auto;cursor:pointer;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;color:white;background:${color};white-space:nowrap;transform:translate(-50%,-100%);box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
          marker.textContent = label;
          marker.title = label;
          marker.dataset.category = ann.asset_type || 'Other';
          marker.addEventListener('click', (evt) => {
            evt.stopPropagation();
            emit('VIEWER_SELECT_ENTITY', { entityId: ann.fm_guid, fmGuid: ann.fm_guid, entityName: ann.common_name || ann.name || null },);
          });
          const markerCat = ann.asset_type || 'Other';
          if (catSet && !catSet.has(markerCat)) { marker.style.display = 'none'; marker.dataset.catHidden = 'true'; }
          else marker.dataset.catHidden = 'false';
          marker.dataset.floorHidden = 'false';
          markerAnnotationMap.set(marker, { level_fm_guid: ann.level_fm_guid || null });
          container.appendChild(marker);

          const updatePos = () => {
            if (!viewer.scene?.canvas) return;
            if (marker.dataset.catHidden === 'true' || marker.dataset.floorHidden === 'true') { marker.style.display = 'none'; return; }
            let wx = ann.coordinate_x || 0, wy = ann.coordinate_y || 0, wz = ann.coordinate_z || 0;
            if (wx === 0 && wy === 0 && wz === 0 && ann.fm_guid) {
              const roomGuid = (ann as any).in_room_fm_guid || (ann as any).level_fm_guid;
              if (roomGuid) {
                const metaObjects = viewer.metaScene?.metaObjects || {};
                for (const mo of Object.values(metaObjects) as any[]) {
                  if ((mo.originalSystemId || '').toLowerCase() === roomGuid.toLowerCase()) {
                    const entity = viewer.scene.objects?.[mo.id];
                    if (entity?.aabb) { wx = (entity.aabb[0] + entity.aabb[3]) / 2; wy = (entity.aabb[1] + entity.aabb[4]) / 2; wz = (entity.aabb[2] + entity.aabb[5]) / 2; }
                    break;
                  }
                }
              }
              if (wx === 0 && wy === 0 && wz === 0) { marker.style.display = 'none'; return; }
            }
            const canvasPos = worldToCanvas(viewer, [wx, wy, wz]);
            if (canvasPos && canvasPos[2] > 0) { marker.style.left = canvasPos[0] + 'px'; marker.style.top = canvasPos[1] + 'px'; marker.style.display = 'block'; }
            else marker.style.display = 'none';
          };
          const unsub = viewer.scene.camera?.on?.('matrix', updatePos);
          if (unsub) cameraUnsubs.push(() => viewer.scene.camera?.off?.('matrix', unsub));
          updatePos();
        });
        applyFloorFilter();
      } catch (err) {
        logger.warn('[ViewerEvents] Failed to load annotations:', err);
      }
    };

    const offHandler = on('TOGGLE_ANNOTATIONS', handler);

    // Re-run with the last-known visibility whenever an asset in this building changes —
    // this is what makes an annotation created/moved in one viewer (or by another user)
    // show up in this one without a panel being open or a manual toggle.
    const offRealtime = buildingFmGuid
      ? subscribeToBuildingAnnotations(buildingFmGuid, () => handler(lastDetail))
      : () => {};

    return () => {
      offHandler();
      offFloorHandler();
      offRealtime();
      cameraUnsubs.forEach(fn => fn());
      markerContainer?.remove();
    };
  }, [buildingFmGuid, viewerRef]);

  // ── WORKORDER_ANNOTATIONS_TOGGLE ──
  useEffect(() => {
    let markerContainer: HTMLDivElement | null = null;
    let cameraUnsubs: Array<() => void> = [];
    let currentFloorFilter: string | null = null;
    let markerFloorMap: Map<HTMLDivElement, string | null> = new Map();

    const applyFloor = () => {
      markerFloorMap.forEach((floorGuid, marker) => {
        if (!currentFloorFilter) { marker.style.display = ''; return; }
        marker.style.display = (floorGuid && floorGuid.toLowerCase() === currentFloorFilter.toLowerCase()) ? '' : 'none';
      });
    };

    const floorHandler = (detail: FloorSelectionEventDetail) => {
      if (detail?.isAllFloorsVisible || !detail?.floorId) {
        currentFloorFilter = null;
      } else {
        const viewer = viewerRef.current;
        let resolved: string | null = null;
        if (viewer?.metaScene) {
          const mo = viewer.metaScene.metaObjects?.[detail.floorId];
          if (mo?.originalSystemId) resolved = mo.originalSystemId;
        }
        currentFloorFilter = resolved || detail.floorId;
      }
      applyFloor();
    };
    const offFloor = on('FLOOR_SELECTION_CHANGED', floorHandler);

    const handler = async (detail: { visible: boolean }) => {
      const show = detail?.visible ?? true;
      if (!show) { if (markerContainer) markerContainer.style.display = 'none'; return; }
      if (markerContainer) {
        cameraUnsubs.forEach(fn => fn()); cameraUnsubs = [];
        markerContainer.remove(); markerContainer = null;
      }
      markerFloorMap = new Map();
      const viewer = viewerRef.current;
      if (!viewer?.scene || !buildingFmGuid) return;

      // Work orders come from two independent sources that were never cross-referenced
      // before: faciliate_records (external Faciliate sync, keyed by *_cad_key, assumed
      // — not verified in code — to be the same GUID scheme as *_fm_guid) and work_orders
      // (created in-app via CreateWorkOrderDialog/fault-report flows, keyed by the real
      // *_fm_guid columns). Fetch both and merge into the same per-room marker.
      const [{ data: records }, { data: localOrders }] = await Promise.all([
        supabase
          .from('faciliate_records')
          .select('source_guid, title, status, room_cad_key, floor_cad_key')
          .eq('object_type', 'workorder')
          .eq('building_cad_key', buildingFmGuid.toLowerCase()),
        supabase
          .from('work_orders')
          .select('id, title, status, space_fm_guid, attributes')
          .eq('building_fm_guid', buildingFmGuid),
      ]);

      if (!records?.length && !localOrders?.length) return;

      // Group by room key, count open vs total
      const rooms = new Map<string, { total: number; open: number; titles: string[]; floor_cad_key: string | null }>();
      const isOpenStatus = (status: string | null) => {
        const s = (status || '').toLowerCase();
        return !s.includes('avslut') && !s.includes('closed') && !s.includes('done') && !s.includes('completed') && !s.includes('cancelled');
      };
      for (const r of records || []) {
        const key = r.room_cad_key || '__no_room__';
        if (!rooms.has(key)) rooms.set(key, { total: 0, open: 0, titles: [], floor_cad_key: r.floor_cad_key || null });
        const entry = rooms.get(key)!;
        entry.total++;
        if (isOpenStatus(r.status)) entry.open++;
        if (entry.titles.length < 3) entry.titles.push(r.title || '');
      }
      for (const r of localOrders || []) {
        const key = (r.space_fm_guid || '__no_room__').toLowerCase();
        if (!rooms.has(key)) rooms.set(key, { total: 0, open: 0, titles: [], floor_cad_key: null });
        const entry = rooms.get(key)!;
        entry.total++;
        if (isOpenStatus(r.status)) entry.open++;
        if (entry.titles.length < 3) entry.titles.push(r.title || '');
        // work_orders has no dedicated floor column — CreateWorkOrderDialog stashes it in
        // attributes.level_fm_guid when known. Only fill in floor_cad_key if this room
        // doesn't already have one from faciliate_records (which does have a real column).
        const levelFmGuid = (r.attributes as { level_fm_guid?: string } | null)?.level_fm_guid;
        if (!entry.floor_cad_key && levelFmGuid) entry.floor_cad_key = levelFmGuid;
      }

      const canvas = viewer.scene.canvas?.canvas;
      const parent = canvas?.parentElement;
      if (!parent) return;

      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:30;overflow:hidden;';
      parent.appendChild(container);
      markerContainer = container;

      const metaObjects = viewer.metaScene?.metaObjects || {};

      rooms.forEach((info, roomGuid) => {
        if (roomGuid === '__no_room__') return;

        // Locate the room entity in the scene
        let wx = 0, wy = 0, wz = 0;
        for (const mo of Object.values(metaObjects) as any[]) {
          const sysId = (mo.originalSystemId || '').toLowerCase();
          const moId = (mo.id || '').toLowerCase();
          if (sysId === roomGuid || moId === roomGuid) {
            const entity = viewer.scene.objects?.[mo.id];
            if (entity?.aabb) {
              wx = (entity.aabb[0] + entity.aabb[3]) / 2;
              wy = (entity.aabb[1] + entity.aabb[4]) / 2;
              wz = (entity.aabb[2] + entity.aabb[5]) / 2;
            }
            break;
          }
        }
        if (wx === 0 && wy === 0 && wz === 0) return;

        const hasOpen = info.open > 0;
        const bg = hasOpen ? '#f59e0b' : '#6b7280';
        const label = hasOpen ? `${info.open} open` : `${info.total} closed`;
        const tooltip = info.titles.filter(Boolean).join('\n') || `${info.total} work order${info.total !== 1 ? 's' : ''}`;

        const marker = document.createElement('div');
        marker.style.cssText = `position:absolute;pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;color:white;background:${bg};white-space:nowrap;transform:translate(-50%,-100%);box-shadow:0 1px 4px rgba(0,0,0,0.35);`;
        marker.innerHTML = `<span style="font-size:9px">🔧</span>${label}`;
        marker.title = tooltip;

        markerFloorMap.set(marker, info.floor_cad_key);
        container.appendChild(marker);

        const updatePos = () => {
          if (!viewer.scene?.canvas) return;
          if (marker.style.display === 'none') return;
          const canvasPos = worldToCanvas(viewer, [wx, wy, wz]);
          if (canvasPos && canvasPos[2] > 0) {
            marker.style.left = canvasPos[0] + 'px';
            marker.style.top = canvasPos[1] + 'px';
            marker.style.visibility = 'visible';
          } else {
            marker.style.visibility = 'hidden';
          }
        };

        const unsub = viewer.scene.camera?.on?.('matrix', updatePos);
        if (unsub) cameraUnsubs.push(() => viewer.scene.camera?.off?.('matrix', unsub));
        updatePos();
      });

      applyFloor();
    };

    const offHandler = on('WORKORDER_ANNOTATIONS_TOGGLE', handler);
    return () => {
      offHandler(); offFloor();
      cameraUnsubs.forEach(fn => fn());
      markerContainer?.remove();
    };
  }, [buildingFmGuid, viewerRef]);

  // ── VIEWER_SELECT_ENTITY (select + fly-to) ──
  useEffect(() => {
    const handler = (detail: any) => {
      const fmGuid = detail?.fmGuid || detail?.entityId;
      if (!fmGuid) return;
      const viewer = viewerRef.current;
      if (!viewer?.scene || !viewer?.metaScene) return;
      const scene = viewer.scene;
      const targetNorm = normalizeGuid(fmGuid);
      const matchedIds: string[] = [];
      Object.values(viewer.metaScene.metaObjects).forEach((mo: any) => {
        const sysId = normalizeGuid(mo.originalSystemId || '');
        const moId = normalizeGuid(mo.id || '');
        if (sysId === targetNorm || moId === targetNorm) {
          matchedIds.push(mo.id);
          const entity = scene.objects?.[mo.id];
          if (entity) { entity.visible = true; entity.pickable = true; }
        }
      });
      if (matchedIds.length > 0) {
        scene.setObjectsSelected(scene.selectedObjectIds, false);
        scene.setObjectsSelected(matchedIds, true);
        viewer.cameraFlight?.flyTo({ aabb: scene.getAABB(matchedIds), duration: 1.0 });
      }
    };
    const off = on('VIEWER_SELECT_ENTITY', handler);
    return () => off();
  }, [viewerRef]);
}
