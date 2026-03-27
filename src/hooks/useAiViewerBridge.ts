/**
 * useAiViewerBridge — listens for AI_VIEWER_COMMAND events and
 * controls the xeokit viewer via highlightEntities / resetView.
 */
import { useEffect, useCallback } from 'react';

export const AI_VIEWER_COMMAND_EVENT = 'AI_VIEWER_COMMAND';

export interface AiViewerCommand {
  action: 'highlight' | 'filter' | 'colorize' | 'reset';
  entityIds?: string[];
  colorMap?: Record<string, [number, number, number]>;
}

/**
 * Dispatch an AI viewer command from anywhere (e.g. the chat component).
 */
export function dispatchAiViewerCommand(command: AiViewerCommand) {
  window.dispatchEvent(new CustomEvent(AI_VIEWER_COMMAND_EVENT, { detail: command }));
}

/**
 * Hook that wires up AI viewer commands to a live xeokit viewer instance.
 * Call this in NativeViewerShell or similar viewer wrapper.
 */
export function useAiViewerBridge(viewer: any, isReady: boolean) {
  const highlightEntities = useCallback((entityIds: string[]) => {
    if (!viewer || !entityIds.length) return;

    // Ghost everything first
    const scene = viewer.scene;
    if (!scene) return;

    // Reset previous state
    scene.setObjectsColorized(scene.colorizedObjectIds, null);
    scene.setObjectsHighlighted(scene.highlightedObjectIds, false);
    scene.setObjectsXRayed(scene.xrayedObjectIds, false);
    scene.setObjectsSelected(scene.selectedObjectIds, false);

    // X-ray all, then un-xray the target entities
    const allIds = Object.keys(scene.objects);
    scene.setObjectsXRayed(allIds, true);
    scene.setObjectsXRayed(entityIds, false);

    // Highlight the target entities with a color
    scene.setObjectsHighlighted(entityIds, true);

    // Fly to the highlighted entities
    if (viewer.cameraFlight) {
      viewer.cameraFlight.flyTo({ aabb: scene.getAABB(entityIds), duration: 1.0 });
    }

    console.log(`[AiViewerBridge] Highlighted ${entityIds.length} entities`);
  }, [viewer]);

  const filterToEntities = useCallback((entityIds: string[]) => {
    if (!viewer || !entityIds.length) return;

    const scene = viewer.scene;
    if (!scene) return;

    // Hide everything, show only target entities
    const allIds = Object.keys(scene.objects);
    scene.setObjectsVisible(allIds, false);
    scene.setObjectsVisible(entityIds, true);

    if (viewer.cameraFlight) {
      viewer.cameraFlight.flyTo({ aabb: scene.getAABB(entityIds), duration: 1.0 });
    }

    console.log(`[AiViewerBridge] Filtered to ${entityIds.length} entities`);
  }, [viewer]);

  const colorizeEntities = useCallback((colorMap: Record<string, [number, number, number]>) => {
    if (!viewer || !colorMap || !Object.keys(colorMap).length) return;

    const scene = viewer.scene;
    if (!scene) return;

    // Reset previous state
    scene.setObjectsColorized(scene.colorizedObjectIds, null);
    scene.setObjectsHighlighted(scene.highlightedObjectIds, false);
    scene.setObjectsXRayed(scene.xrayedObjectIds, false);
    scene.setObjectsSelected(scene.selectedObjectIds, false);

    // X-ray all, then un-xray and colorize target entities
    const allIds = Object.keys(scene.objects);
    const entityIds = Object.keys(colorMap);
    scene.setObjectsXRayed(allIds, true);
    scene.setObjectsXRayed(entityIds, false);

    // Apply per-entity colors
    for (const [entityId, color] of Object.entries(colorMap)) {
      if (scene.objects[entityId]) {
        scene.setObjectsColorized([entityId], color);
      }
    }

    // Fly to colorized entities
    if (viewer.cameraFlight && entityIds.length) {
      viewer.cameraFlight.flyTo({ aabb: scene.getAABB(entityIds), duration: 1.0 });
    }

    console.log(`[AiViewerBridge] Colorized ${entityIds.length} entities`);
  }, [viewer]);

  const resetView = useCallback(() => {
    if (!viewer) return;

    const scene = viewer.scene;
    if (!scene) return;

    const allIds = Object.keys(scene.objects);
    scene.setObjectsVisible(allIds, true);
    scene.setObjectsXRayed(allIds, false);
    scene.setObjectsHighlighted(scene.highlightedObjectIds, false);
    scene.setObjectsColorized(scene.colorizedObjectIds, null);
    scene.setObjectsSelected(scene.selectedObjectIds, false);

    console.log(`[AiViewerBridge] View reset`);
  }, [viewer]);

  useEffect(() => {
    if (!isReady) return;

    const handler = (e: Event) => {
      const command = (e as CustomEvent<AiViewerCommand>).detail;
      if (!command) return;

      switch (command.action) {
        case 'highlight':
          if (command.entityIds?.length) highlightEntities(command.entityIds);
          break;
        case 'filter':
          if (command.entityIds?.length) filterToEntities(command.entityIds);
          break;
        case 'colorize':
          if (command.colorMap) colorizeEntities(command.colorMap);
          break;
        case 'reset':
          resetView();
          break;
      }
    };

    window.addEventListener(AI_VIEWER_COMMAND_EVENT, handler);
    return () => window.removeEventListener(AI_VIEWER_COMMAND_EVENT, handler);
  }, [isReady, highlightEntities, filterToEntities, colorizeEntities, resetView]);

  return { highlightEntities, resetView, filterToEntities, colorizeEntities };
}
