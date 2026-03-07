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

export const OBJECT_MOVE_MODE_EVENT = 'OBJECT_MOVE_MODE';
export const OBJECT_DELETE_EVENT = 'OBJECT_DELETE';

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
    const normalizeGuid = (g: string) => (g || '').toLowerCase().replace(/-/g, '');

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

  // Apply on viewer ready
  useEffect(() => {
    if (!viewer?.scene) return;
    // Small delay to let models finish loading
    const timer = setTimeout(applyModifications, 2000);
    return () => clearTimeout(timer);
  }, [viewer, applyModifications]);

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
      // Check if position is within the AABB (with some tolerance)
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
        toast.error('Objektet kunde inte hittas i 3D-scenen');
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

      toast.info('Klicka och dra för att flytta objektet. Klicka för att placera.');

      const canvas = viewer.scene.canvas?.canvas;
      if (!canvas) return;

      let hasMoved = false;
      let lastPickPos: [number, number, number] | null = null;

      const onMouseDown = (ev: MouseEvent) => {
        if (!activeRef.current) return;
        ev.preventDefault();
        ev.stopPropagation();

        // Pick surface position for start reference
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

        // Pick new surface position
        const pick = viewer.scene.pick({
          canvasPos: [ev.offsetX, ev.offsetY],
          pickSurface: true,
        });

        if (pick?.worldPos) {
          const dx = pick.worldPos[0] - lastPickPos[0];
          const dy = 0; // Keep Y (height) constant
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

        // Re-enable camera
        if (viewer.cameraControl) {
          viewer.cameraControl.pointerEnabled = true;
        }

        if (!hasMoved) {
          // Click without move = place at current position
          // If no movement at all, cancel
          const totalOffset = entity.offset || [0, 0, 0];
          const totalDist = Math.sqrt(
            Math.pow(totalOffset[0] - moveStateRef.current.originalOffset[0], 2) +
            Math.pow(totalOffset[1] - moveStateRef.current.originalOffset[1], 2) +
            Math.pow(totalOffset[2] - moveStateRef.current.originalOffset[2], 2)
          );

          if (totalDist < 0.01) {
            // No real movement, cancel
            entity.offset = moveStateRef.current.originalOffset;
            toast.info('Flytt avbruten');
            cleanup();
            return;
          }
        }

        // Save the move
        const finalOffset = entity.offset || [0, 0, 0];

        // Detect new room
        const entityCenter = entity.aabb ? [
          (entity.aabb[0] + entity.aabb[3]) / 2,
          (entity.aabb[1] + entity.aabb[4]) / 2,
          (entity.aabb[2] + entity.aabb[5]) / 2,
        ] as [number, number, number] : [0, 0, 0] as [number, number, number];

        const newRoom = detectRoomAtPosition(entityCenter);

        // Get current room before update
        const { data: currentAsset } = await supabase
          .from('assets')
          .select('in_room_fm_guid')
          .eq('fm_guid', moveStateRef.current.fmGuid)
          .maybeSingle();

        const originalRoom = currentAsset?.in_room_fm_guid || null;

        // Persist to DB
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
          .eq('fm_guid', moveStateRef.current.fmGuid);

        if (error) {
          console.error('[ObjectMove] Save failed:', error);
          toast.error('Kunde inte spara flytten');
          entity.offset = moveStateRef.current.originalOffset;
        } else {
          const roomMsg = newRoom ? ` → ${newRoom.name}` : '';
          toast.success(`Objekt flyttat${roomMsg}`);
        }

        cleanup();
      };

      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape' && activeRef.current) {
          entity.offset = moveStateRef.current?.originalOffset || [0, 0, 0];
          if (viewer.cameraControl) viewer.cameraControl.pointerEnabled = true;
          toast.info('Flytt avbruten');
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

      const entity = viewer.scene.objects?.[entityId];

      // Mark as deleted in DB
      const { error } = await supabase
        .from('assets')
        .update({
          modification_status: 'deleted',
          modification_date: new Date().toISOString(),
        })
        .eq('fm_guid', fmGuid);

      if (error) {
        console.error('[ObjectMove] Delete failed:', error);
        toast.error('Kunde inte markera objektet som borttaget');
        return;
      }

      // Hide in viewer
      if (entity) {
        entity.visible = false;
        entity.pickable = false;
      }

      toast.success('Objekt markerat som borttaget');
    };

    window.addEventListener(OBJECT_MOVE_MODE_EVENT, handleMoveEvent as EventListener);
    window.addEventListener(OBJECT_DELETE_EVENT, handleDeleteEvent as EventListener);

    return () => {
      window.removeEventListener(OBJECT_MOVE_MODE_EVENT, handleMoveEvent as EventListener);
      window.removeEventListener(OBJECT_DELETE_EVENT, handleDeleteEvent as EventListener);
    };
  }, [viewer, buildingFmGuid, detectRoomAtPosition]);

  return { applyModifications };
}
