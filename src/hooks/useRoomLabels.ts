import { useRef, useCallback, useEffect } from 'react';

interface RoomLabel {
  fmGuid: string;
  name: string;
  number: string;
  worldPos: number[];
  element: HTMLDivElement;
}

export const ROOM_LABELS_TOGGLE_EVENT = 'ROOM_LABELS_TOGGLE';

export interface RoomLabelsToggleDetail {
  enabled: boolean;
}

/**
 * Hook for displaying room labels (name + number) in the 3D viewer.
 * Uses xeokit camera events to project 3D positions to screen coordinates.
 */
export function useRoomLabels(viewerRef: React.MutableRefObject<any>) {
  const labelsRef = useRef<Map<string, RoomLabel>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const enabledRef = useRef(false);
  const tickListenerRef = useRef<(() => void) | null>(null);
  const cameraListenerRef = useRef<(() => void) | null>(null);

  // Get XEOkit viewer instance
  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch (e) {
      return null;
    }
  }, [viewerRef]);

  // Get canvas element
  const getCanvas = useCallback(() => {
    const viewer = getXeokitViewer();
    return viewer?.scene?.canvas?.canvas as HTMLCanvasElement | null;
  }, [getXeokitViewer]);

  // Create label container overlay
  const ensureContainer = useCallback(() => {
    if (containerRef.current) return containerRef.current;

    const canvas = getCanvas();
    if (!canvas?.parentElement) return null;

    const container = document.createElement('div');
    container.id = 'room-labels-container';
    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
      z-index: 10;
    `;
    canvas.parentElement.style.position = 'relative';
    canvas.parentElement.appendChild(container);
    containerRef.current = container;
    return container;
  }, [getCanvas]);

  // Project 3D world position to 2D canvas coordinates
  const worldToCanvas = useCallback((worldPos: number[], viewer: any): [number, number] | null => {
    if (!viewer?.scene?.canvas?.canvas) return null;

    const camera = viewer.camera;
    const canvas = viewer.scene.canvas.canvas;

    // Get matrices
    const viewMatrix = camera.viewMatrix;
    const projMatrix = camera.projMatrix;

    if (!viewMatrix || !projMatrix) return null;

    // Transform world position by view matrix
    const viewPos = [
      viewMatrix[0] * worldPos[0] + viewMatrix[4] * worldPos[1] + viewMatrix[8] * worldPos[2] + viewMatrix[12],
      viewMatrix[1] * worldPos[0] + viewMatrix[5] * worldPos[1] + viewMatrix[9] * worldPos[2] + viewMatrix[13],
      viewMatrix[2] * worldPos[0] + viewMatrix[6] * worldPos[1] + viewMatrix[10] * worldPos[2] + viewMatrix[14],
      viewMatrix[3] * worldPos[0] + viewMatrix[7] * worldPos[1] + viewMatrix[11] * worldPos[2] + viewMatrix[15]
    ];

    // Transform by projection matrix
    const projPos = [
      projMatrix[0] * viewPos[0] + projMatrix[4] * viewPos[1] + projMatrix[8] * viewPos[2] + projMatrix[12] * viewPos[3],
      projMatrix[1] * viewPos[0] + projMatrix[5] * viewPos[1] + projMatrix[9] * viewPos[2] + projMatrix[13] * viewPos[3],
      projMatrix[2] * viewPos[0] + projMatrix[6] * viewPos[1] + projMatrix[10] * viewPos[2] + projMatrix[14] * viewPos[3],
      projMatrix[3] * viewPos[0] + projMatrix[7] * viewPos[1] + projMatrix[11] * viewPos[2] + projMatrix[15] * viewPos[3]
    ];

    // Behind camera check
    if (projPos[3] <= 0) return null;

    // Perspective divide to NDC
    const ndcX = projPos[0] / projPos[3];
    const ndcY = projPos[1] / projPos[3];

    // Clip if outside view frustum
    if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.2 || ndcY > 1.2) return null;

    // Convert to canvas coordinates
    const canvasX = ((ndcX + 1) / 2) * canvas.clientWidth;
    const canvasY = ((1 - ndcY) / 2) * canvas.clientHeight;

    return [canvasX, canvasY];
  }, []);

  // Update all label positions
  const updateLabelPositions = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer || !enabledRef.current) return;

    labelsRef.current.forEach(label => {
      const canvasPos = worldToCanvas(label.worldPos, viewer);
      
      if (canvasPos) {
        label.element.style.left = `${canvasPos[0]}px`;
        label.element.style.top = `${canvasPos[1]}px`;
        label.element.style.display = 'block';
      } else {
        label.element.style.display = 'none';
      }
    });
  }, [getXeokitViewer, worldToCanvas]);

  // Create labels for all IfcSpace entities
  const createLabels = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return;

    const container = ensureContainer();
    if (!container) return;

    const metaObjects = viewer.metaScene.metaObjects;
    const scene = viewer.scene;
    let createdCount = 0;

    Object.values(metaObjects).forEach((metaObj: any) => {
      if (metaObj.type?.toLowerCase() !== 'ifcspace') return;

      const entity = scene.objects?.[metaObj.id];
      if (!entity?.aabb) return;

      // Calculate center position
      const aabb = entity.aabb;
      const center = [
        (aabb[0] + aabb[3]) / 2,
        (aabb[1] + aabb[4]) / 2 + 0.5, // Slightly above center
        (aabb[2] + aabb[5]) / 2,
      ];

      // Get room info from metadata
      const fmGuid = metaObj.originalSystemId || metaObj.id;
      const name = metaObj.name || '';
      
      // Try to find room number from various property sources
      let number = '';
      if (metaObj.attributes?.LongName) {
        number = metaObj.attributes.LongName;
      } else if (metaObj.propertySetValues?.Pset_SpaceCommon?.Reference) {
        number = metaObj.propertySetValues.Pset_SpaceCommon.Reference;
      } else if (metaObj.attributes?.Name) {
        number = metaObj.attributes.Name;
      }

      // Create HTML label element
      const labelEl = document.createElement('div');
      labelEl.className = 'room-label';
      labelEl.innerHTML = `
        <div style="font-weight: 600; font-size: 10px; opacity: 0.9;">${number || '—'}</div>
        ${name ? `<div style="font-size: 9px; opacity: 0.7; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>` : ''}
      `;
      labelEl.style.cssText = `
        position: absolute;
        background: hsl(var(--background) / 0.85);
        color: hsl(var(--foreground));
        padding: 3px 6px;
        border-radius: 4px;
        font-size: 10px;
        line-height: 1.3;
        text-align: center;
        transform: translate(-50%, -50%);
        white-space: nowrap;
        pointer-events: none;
        border: 1px solid hsl(var(--border) / 0.5);
        box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        display: none;
        z-index: 5;
      `;
      container.appendChild(labelEl);

      labelsRef.current.set(fmGuid, {
        fmGuid,
        name,
        number,
        worldPos: center,
        element: labelEl,
      });

      createdCount++;
    });

    console.log(`✅ Created ${createdCount} room labels`);

    // Set up camera change listener for position updates
    const scene2 = viewer.scene;
    if (scene2 && !cameraListenerRef.current) {
      const updateFn = () => updateLabelPositions();
      scene2.camera?.on?.('matrix', updateFn);
      cameraListenerRef.current = () => {
        scene2.camera?.off?.('matrix', updateFn);
      };
    }

    // Also listen to tick for smooth updates
    if (scene2 && !tickListenerRef.current) {
      const tickFn = () => {
        if (enabledRef.current) updateLabelPositions();
      };
      scene2.on?.('tick', tickFn);
      tickListenerRef.current = () => {
        scene2.off?.('tick', tickFn);
      };
    }

    // Initial position update
    updateLabelPositions();
  }, [getXeokitViewer, ensureContainer, updateLabelPositions]);

  // Destroy all labels
  const destroyLabels = useCallback(() => {
    // Remove event listeners
    if (cameraListenerRef.current) {
      cameraListenerRef.current();
      cameraListenerRef.current = null;
    }
    if (tickListenerRef.current) {
      tickListenerRef.current();
      tickListenerRef.current = null;
    }

    // Remove label elements
    labelsRef.current.forEach(label => {
      label.element.remove();
    });
    labelsRef.current.clear();

    console.log('Room labels destroyed');
  }, []);

  // Toggle labels on/off
  const setLabelsEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;

    if (enabled) {
      createLabels();
    } else {
      destroyLabels();
    }

    // Show/hide container
    if (containerRef.current) {
      containerRef.current.style.display = enabled ? 'block' : 'none';
    }
  }, [createLabels, destroyLabels]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyLabels();
      containerRef.current?.remove();
      containerRef.current = null;
    };
  }, [destroyLabels]);

  return {
    setLabelsEnabled,
    isEnabled: enabledRef.current,
    labelCount: labelsRef.current.size,
    refreshLabels: createLabels,
  };
}

export default useRoomLabels;
