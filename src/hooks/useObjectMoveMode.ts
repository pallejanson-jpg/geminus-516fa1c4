/**
 * useObjectMoveMode — Drag-move logic for relocating 3D objects in xeokit.
 * 
 * Listens for OBJECT_MOVE_MODE_EVENT to activate drag mode on a specific entity.
 * Calculates world-space delta on mouse drag, applies entity.offset, detects
 * new room via AABB intersection, and persists to the assets table.
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { normalizeGuid } from '@/lib/utils';

import { on } from '@/lib/event-bus';
export const OBJECT_MOVE_MODE_EVENT = 'OBJECT_MOVE_MODE';
export const OBJECT_DELETE_EVENT = 'OBJECT_DELETE';
export const VIEWER_MODELS_LOADED_EVENT = 'VIEWER_MODELS_LOADED';

interface MoveState {
  entityId: string;
  fmGuid: string;
  startCanvasPos: [number, number];
  startWorldPos: [number, number, number];
  originalOffset: [number, number, number];
}

export function useObjectMoveMode(viewer: any, buildingFmGuid: string) {
  const moveStateRef = useRef<MoveState | null>(null);
  const activeRef = useRef(false);

  // ── Apply saved offsets & hide deleted entities on model load ─────────
  const applyModifications = useCallback(async () => {
    if (!viewer?.scene) return;

    const { data: modified } = await supabase
      .from('assets')
      .select('fm_guid, modification_status, moved_offset_x, moved_offset_y, moved_offset_z')
      .eq('building_fm_guid', buildingFmGuid)
      .not('modification_status', 'is', null);

    if (!modified || modified.length === 0) return;

    const metaObjects = viewer.metaScene?.metaObjects || {};

    // Build lookup: normalizedGuid → entity ID
    const guidToEntityId = new Map<string, string>();
    Object.values(metaObjects).forEach((mo: any) => {
      const sysId = mo.originalSystemId || mo.id || '';
      guidToEntityId.set(normalizeGuid(sysId), mo.id);
    });

    let movedCount = 0;
    let deletedCount = 0;

    modified.forEach((asset: any) => {
      const entityId = guidToEntityId.get(normalizeGuid(asset.fm_guid));
      if (!entityId) return;
      const entity = viewer.scene.objects?.[entityId];
      if (!entity) return;

      if (asset.modification_status === 'deleted') {
        entity.visible = false;
        entity.pickable = false;
        deletedCount++;
      } else if (asset.modification_status === 'moved') {
        const ox = asset.moved_offset_x || 0;
        const oy = asset.moved_offset_y || 0;
        const oz = asset.moved_offset_z || 0;
        if (ox !== 0 || oy !== 0 || oz !== 0) {
          entity.offset = [ox, oy, oz];
        }
        movedCount++;
      }
    });

    if (movedCount > 0 || deletedCount > 0) {
      console.log(`[ObjectMove] Applied modifications: ${movedCount} moved, ${deletedCount} deleted`);
    }
  }, [viewer, buildingFmGuid]);

  // Apply on VIEWER_MODELS_LOADED event and REAPPLY_MODIFICATIONS event
  useEffect(() => {
    if (!viewer?.scene) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.buildingFmGuid === buildingFmGuid) {
        applyModifications();
      }
    };

    const reapplyHandler = () => {
      applyModifications();
    };

    const offHandler = on('VIEWER_MODELS_LOADED', handler);
    const offReapplyHandler = on('REAPPLY_MODIFICATIONS', reapplyHandler);

    // Fallback: also apply if models are already loaded (viewer is ready)
    if (viewer.scene.numObjects > 0) {
      applyModifications();
    }

    return () => {
      offHandler();
      offReapplyHandler();
    };
  }, [viewer, applyModifications, buildingFmGuid]);

  // ── Undo helpers ─────────────────────────────────────────────────────
  const undoMove = useCallback(async (fmGuid: string, originalOffset: [number, number, number], originalRoom: string | null) => {
    // Restore in DB
    const { error } = await supabase
      .from('assets')
      .update({
        modification_status: null,
        moved_offset_x: null,
        moved_offset_y: null,
        moved_offset_z: null,
        in_room_fm_guid: originalRoom,
        original_room_fm_guid: null,
        modification_date: null,
      })
      .eq('fm_guid', fmGuid);

    if (error) {
      toast.error('Could not undo move');
      return;
    }

    // Restore in viewer
    if (viewer?.scene?.metaScene?.metaObjects) {
      const metaObjects = viewer.metaScene.metaObjects;
      for (const mo of Object.values(metaObjects) as any[]) {
        if (normalizeGuid(mo.originalSystemId || mo.id) === normalizeGuid(fmGuid)) {
          const entity = viewer.scene.objects?.[mo.id];
          if (entity) entity.offset = originalOffset;
          break;
        }
      }
    }
    toast.success('Move undone');
  }, [viewer]);

  const undoDelete = useCallback(async (fmGuid: string) => {
    const { error } = await supabase
      .from('assets')
      .update({
        modification_status: null,
        modification_date: null,
      })
      .eq('fm_guid', fmGuid);

    if (error) {
      toast.error('Could not undo deletion');
      return;
    }

    // Restore visibility in viewer
    if (viewer?.scene?.metaScene?.metaObjects) {
      const metaObjects = viewer.metaScene.metaObjects;
      for (const mo of Object.values(metaObjects) as any[]) {
        if (normalizeGuid(mo.originalSystemId || mo.id) === normalizeGuid(fmGuid)) {
          const entity = viewer.scene.objects?.[mo.id];
          if (entity) {
            entity.visible = true;
            entity.pickable = true;
          }
          break;
        }
      }
    }
    toast.success('Deletion undone');
  }, [viewer]);

  // ── Detect room at position ──────────────────────────────────────────
  const detectRoomAtPosition = useCallback((worldPos: [number, number, number]): { fmGuid: string; name: string } | null => {
    if (!viewer?.metaScene?.metaObjects) return null;
    const metaObjects = viewer.metaScene.metaObjects;

    for (const mo of Object.values(metaObjects) as any[]) {
      if ((mo.type || '').toLowerCase() !== 'ifcspace') continue;
      const entity = viewer.scene.objects?.[mo.id];
      if (!entity?.aabb) continue;

      const [x, y, z] = worldPos;
      const aabb = entity.aabb;
      if (x >= aabb[0] - 0.5 && x <= aabb[3] + 0.5 &&
          y >= aabb[1] - 0.5 && y <= aabb[4] + 0.5 &&
          z >= aabb[2] - 0.5 && z <= aabb[5] + 0.5) {
        return {
          fmGuid: mo.originalSystemId || mo.id,
          name: mo.name || 'Unknown',
        };
      }
    }
    return null;
  }, [viewer]);

  // ── Move mode event handler ──────────────────────────────────────────
  useEffect(() => {
    const handleMoveEvent = (e: CustomEvent) => {
      const { entityId, fmGuid } = e.detail || {};
      if (!entityId || !fmGuid || !viewer?.scene) return;

      const entity = viewer.scene.objects?.[entityId];
      if (!entity) {
        toast.error('Object not found in 3D scene');
        return;
      }

      // Store initial state
      moveStateRef.current = {
        entityId,
        fmGuid,
        startCanvasPos: [0, 0],
        startWorldPos: [0, 0, 0],
        originalOffset: entity.offset ? [...entity.offset] as [number, number, number] : [0, 0, 0],
      };
      activeRef.current = true;

      // Disable camera controls during drag
      if (viewer.cameraControl) {
        viewer.cameraControl.pointerEnabled = false;
      }

      toast.info('Click and drag to move the object. Click to place.');

      const canvas = viewer.scene.canvas?.canvas;
      if (!canvas) return;

      let hasMoved = false;
      let lastPickPos: [number, number, number] | null = null;

      const onMouseDown = (ev: MouseEvent) => {
        if (!activeRef.current) return;
        ev.preventDefault();
        ev.stopPropagation();

        const pick = viewer.scene.pick({
          canvasPos: [ev.offsetX, ev.offsetY],
          pickSurface: true,
        });

        if (pick?.worldPos) {
          moveStateRef.current!.startCanvasPos = [ev.offsetX, ev.offsetY];
          moveStateRef.current!.startWorldPos = [...pick.worldPos] as [number, number, number];
          lastPickPos = [...pick.worldPos] as [number, number, number];
          hasMoved = false;
        }
      };

      const onMouseMove = (ev: MouseEvent) => {
        if (!activeRef.current || !moveStateRef.current || !lastPickPos) return;
        ev.preventDefault();

        const pick = viewer.scene.pick({
          canvasPos: [ev.offsetX, ev.offsetY],
          pickSurface: true,
        });

        if (pick?.worldPos) {
          const dx = pick.worldPos[0] - lastPickPos[0];
          const dy = 0;
          const dz = pick.worldPos[2] - lastPickPos[2];

          if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
            hasMoved = true;
            const currentOffset = entity.offset || [0, 0, 0];
            entity.offset = [
              currentOffset[0] + dx,
              currentOffset[1] + dy,
              currentOffset[2] + dz,
            ];
            lastPickPos = [...pick.worldPos] as [number, number, number];
          }
        }
      };

      const onMouseUp = async (ev: MouseEvent) => {
        if (!activeRef.current || !moveStateRef.current) return;
        ev.preventDefault();

        if (viewer.cameraControl) {
          viewer.cameraControl.pointerEnabled = true;
        }

        if (!hasMoved) {
          const totalOffset = entity.offset || [0, 0, 0];
          const totalDist = Math.sqrt(
            Math.pow(totalOffset[0] - moveStateRef.current.originalOffset[0], 2) +
            Math.pow(totalOffset[1] - moveStateRef.current.originalOffset[1], 2) +
            Math.pow(totalOffset[2] - moveStateRef.current.originalOffset[2], 2)
          );

          if (totalDist < 0.01) {
            entity.offset = moveStateRef.current.originalOffset;
            toast.info('Move cancelled');
            cleanup();
            return;
          }
        }

        const finalOffset = entity.offset || [0, 0, 0];
        const savedOriginalOffset = [...moveStateRef.current.originalOffset] as [number, number, number];
        const savedFmGuid = moveStateRef.current.fmGuid;

        // Detect new room
        const entityCenter = entity.aabb ? [
          (entity.aabb[0] + entity.aabb[3]) / 2,
          (entity.aabb[1] + entity.aabb[4]) / 2,
          (entity.aabb[2] + entity.aabb[5]) / 2,
        ] as [number, number, number] : [0, 0, 0] as [number, number, number];

        const newRoom = detectRoomAtPosition(entityCenter);

        const { data: currentAsset } = await supabase
          .from('assets')
          .select('in_room_fm_guid')
          .eq('fm_guid', savedFmGuid)
          .maybeSingle();

        const originalRoom = currentAsset?.in_room_fm_guid || null;

        const { error } = await supabase
          .from('assets')
          .update({
            modification_status: 'moved',
            moved_offset_x: finalOffset[0],
            moved_offset_y: finalOffset[1],
            moved_offset_z: finalOffset[2],
            original_room_fm_guid: originalRoom,
            in_room_fm_guid: newRoom?.fmGuid || originalRoom,
            modification_date: new Date().toISOString(),
          })
          .eq('fm_guid', savedFmGuid);

        if (error) {
          console.error('[ObjectMove] Save failed:', error);
          toast.error('Could not save move');
          entity.offset = savedOriginalOffset;
        } else {
          const roomMsg = newRoom ? ` → ${newRoom.name}` : '';
          toast.success(`Object moved${roomMsg}`, {
            action: {
              label: 'Undo',
              onClick: () => undoMove(savedFmGuid, savedOriginalOffset, originalRoom),
            },
          });
        }

        cleanup();
      };

      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape' && activeRef.current) {
          entity.offset = moveStateRef.current?.originalOffset || [0, 0, 0];
          if (viewer.cameraControl) viewer.cameraControl.pointerEnabled = true;
          toast.info('Move cancelled');
          cleanup();
        }
      };

      const cleanup = () => {
        activeRef.current = false;
        moveStateRef.current = null;
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('keydown', onKeyDown);
        canvas.style.cursor = '';
      };

      canvas.style.cursor = 'move';
      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('mouseup', onMouseUp);
      document.addEventListener('keydown', onKeyDown);
    };

    // ── Delete event handler ───────────────────────────────────────────
    const handleDeleteEvent = async (e: CustomEvent) => {
      const { entityId, fmGuid } = e.detail || {};
      if (!entityId || !fmGuid || !viewer?.scene) return;

      // Confirmation dialog
      const confirmed = window.confirm('Mark this object as deleted? This can be undone.');
      if (!confirmed) return;

      const entity = viewer.scene.objects?.[entityId];

      const { error } = await supabase
        .from('assets')
        .update({
          modification_status: 'deleted',
          modification_date: new Date().toISOString(),
        })
        .eq('fm_guid', fmGuid);

      if (error) {
        console.error('[ObjectMove] Delete failed:', error);
        toast.error('Could not mark object as deleted');
        return;
      }

      if (entity) {
        entity.visible = false;
        entity.pickable = false;
      }

      toast.success('Object marked as deleted', {
        action: {
          label: 'Undo',
          onClick: () => undoDelete(fmGuid),
        },
      });
    };

    const offHandleMoveEvent = on('OBJECT_MOVE_MODE', handleMoveEvent);
    const offHandleDeleteEvent = on('OBJECT_DELETE', handleDeleteEvent);

    return () => {
      offHandleMoveEvent();
      offHandleDeleteEvent();
    };
  }, [viewer, buildingFmGuid, detectRoomAtPosition, undoMove, undoDelete]);

  return { applyModifications };
}
