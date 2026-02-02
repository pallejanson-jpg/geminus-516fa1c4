import { useRef, useCallback, useEffect } from 'react';

interface RoomLabel {
  fmGuid: string;
  name: string;
  number: string;
  worldPos: number[];
  element: HTMLDivElement;
  entityId: string;
  metaObject: any;
}

export const ROOM_LABELS_TOGGLE_EVENT = 'ROOM_LABELS_TOGGLE';
export const ROOM_LABELS_CONFIG_EVENT = 'ROOM_LABELS_CONFIG';

export interface RoomLabelsToggleDetail {
  enabled: boolean;
}

export interface RoomLabelsConfigDetail {
  fields: string[];
  heightOffset: number;
  fontSize: number;
  scaleWithDistance: boolean;
  clickAction: 'none' | 'flyto' | 'roomcard';
}

// Default config for backwards compatibility
const DEFAULT_CONFIG: RoomLabelsConfigDetail = {
  fields: ['commonName', 'designation'],
  heightOffset: 1.2,
  fontSize: 10,
  scaleWithDistance: true,
  clickAction: 'none',
};

/**
 * Hook for displaying room labels (name + number) in the 3D viewer.
 * Uses xeokit camera events to project 3D positions to screen coordinates.
 * Now supports configurable fields, distance scaling, and click actions.
 */
export function useRoomLabels(
  viewerRef: React.MutableRefObject<any>,
  onRoomClick?: (roomData: any) => void
) {
  const labelsRef = useRef<Map<string, RoomLabel>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const enabledRef = useRef(false);
  const tickListenerRef = useRef<(() => void) | null>(null);
  const cameraListenerRef = useRef<(() => void) | null>(null);
  const visibleFloorGuidsRef = useRef<string[]>([]);
  const viewModeRef = useRef<'2d' | '3d'>('3d');
  const configRef = useRef<RoomLabelsConfigDetail>(DEFAULT_CONFIG);

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

  // Extract field value from metaObject based on config field key
  const extractFieldValue = useCallback((metaObj: any, fieldKey: string): string => {
    switch (fieldKey) {
      case 'commonName':
        return metaObj.name || '';
      case 'designation':
        return metaObj.attributes?.LongName || 
               metaObj.propertySetValues?.Pset_SpaceCommon?.Reference || 
               metaObj.attributes?.Name || '';
      case 'longName':
        return metaObj.attributes?.LongName || metaObj.name || '';
      case 'nta':
        const nta = metaObj.propertySetValues?.Pset_SpaceCommon?.NetPlannedArea ||
                    metaObj.attributes?.NetFloorArea ||
                    metaObj.propertySetValues?.BaseQuantities?.NetFloorArea;
        return nta ? `${Number(nta).toFixed(1)} m²` : '';
      case 'bta':
        const bta = metaObj.propertySetValues?.Pset_SpaceCommon?.GrossPlannedArea ||
                    metaObj.attributes?.GrossFloorArea;
        return bta ? `${Number(bta).toFixed(1)} m²` : '';
      case 'function':
        return metaObj.propertySetValues?.Pset_SpaceCommon?.Category || 
               metaObj.attributes?.ObjectType || '';
      case 'department':
        return metaObj.propertySetValues?.Pset_SpaceOccupancyRequirements?.OccupancyType || '';
      default:
        // Try to find in attributes or property sets
        return metaObj.attributes?.[fieldKey] || '';
    }
  }, []);

  // Build label HTML content from config fields
  const buildLabelContent = useCallback((metaObj: any): string => {
    const config = configRef.current;
    const lines: string[] = [];
    
    config.fields.forEach((fieldKey, index) => {
      const value = extractFieldValue(metaObj, fieldKey);
      if (value) {
        if (index === 0) {
          // First field is primary (larger, bolder)
          lines.push(`<div style="font-weight: 600; font-size: ${config.fontSize}px; opacity: 0.9;">${value}</div>`);
        } else {
          // Secondary fields are smaller
          lines.push(`<div style="font-size: ${config.fontSize - 1}px; opacity: 0.7; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${value}</div>`);
        }
      }
    });
    
    return lines.length > 0 ? lines.join('') : '<div style="font-size: 10px;">—</div>';
  }, [extractFieldValue]);

  // Update all label positions with distance-based scaling
  const updateLabelPositions = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer || !enabledRef.current) return;

    const config = configRef.current;
    const camera = viewer.camera;
    const cameraEye = camera?.eye || [0, 0, 0];

    labelsRef.current.forEach(label => {
      const canvasPos = worldToCanvas(label.worldPos, viewer);
      
      if (canvasPos) {
        label.element.style.left = `${canvasPos[0]}px`;
        label.element.style.top = `${canvasPos[1]}px`;
        label.element.style.display = 'block';
        
        // Distance-based scaling
        if (config.scaleWithDistance) {
          const dx = cameraEye[0] - label.worldPos[0];
          const dy = cameraEye[1] - label.worldPos[1];
          const dz = cameraEye[2] - label.worldPos[2];
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          // Scale factor: closer = larger, farther = smaller
          const scale = Math.max(0.4, Math.min(1.3, 18 / Math.max(distance, 5)));
          label.element.style.transform = `translate(-50%, -50%) scale(${scale})`;
        }
      } else {
        label.element.style.display = 'none';
      }
    });
  }, [getXeokitViewer, worldToCanvas]);

  // Handle label click
  const handleLabelClick = useCallback((label: RoomLabel) => {
    const config = configRef.current;
    const viewer = getXeokitViewer();
    
    if (config.clickAction === 'flyto' && viewer) {
      // Fly camera to room
      const entity = viewer.scene?.objects?.[label.entityId];
      if (entity?.aabb) {
        viewer.cameraFlight?.flyTo({
          aabb: entity.aabb,
          duration: 0.8,
        });
      }
    } else if (config.clickAction === 'roomcard' && onRoomClick) {
      // Extract room data for card
      const roomData = {
        fmGuid: label.fmGuid,
        name: extractFieldValue(label.metaObject, 'commonName'),
        number: extractFieldValue(label.metaObject, 'designation'),
        longName: extractFieldValue(label.metaObject, 'longName'),
        area: parseFloat(extractFieldValue(label.metaObject, 'nta')) || undefined,
        function: extractFieldValue(label.metaObject, 'function'),
      };
      onRoomClick(roomData);
    }
  }, [getXeokitViewer, onRoomClick, extractFieldValue]);

  // Create labels for all IfcSpace entities, filtering by visible floors
  const createLabels = useCallback((floorGuids?: string[]) => {
    const viewer = getXeokitViewer();
    if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return;

    const container = ensureContainer();
    if (!container) return;

    const config = configRef.current;

    // Update ref for future position updates
    if (floorGuids !== undefined) {
      visibleFloorGuidsRef.current = floorGuids;
    }

    const metaObjects = viewer.metaScene.metaObjects;
    const scene = viewer.scene;
    const visibleLower = new Set((floorGuids || visibleFloorGuidsRef.current).map(g => g.toLowerCase()));
    const hasFloorFilter = visibleLower.size > 0;
    let createdCount = 0;
    let filteredCount = 0;

    Object.values(metaObjects).forEach((metaObj: any) => {
      if (metaObj.type?.toLowerCase() !== 'ifcspace') return;

      // Find parent storey for floor filtering
      let parentStorey: any = null;
      let current = metaObj;
      while (current?.parent) {
        current = current.parent;
        if (current?.type?.toLowerCase() === 'ifcbuildingstorey') {
          parentStorey = current;
          break;
        }
      }

      // Floor filtering - skip rooms not on visible floors
      if (hasFloorFilter && parentStorey) {
        const storeyGuid = (parentStorey.originalSystemId || parentStorey.id || '').toLowerCase();
        if (!visibleLower.has(storeyGuid)) {
          filteredCount++;
          return; // Skip this room
        }
      }

      const entity = scene.objects?.[metaObj.id];
      if (!entity?.aabb) return;

      // Calculate center position - height from config
      const aabb = entity.aabb;
      const labelHeight = viewModeRef.current === '2d' 
        ? aabb[1] + 0.1   // Floor level for 2D plan view
        : aabb[1] + config.heightOffset;
      
      const center = [
        (aabb[0] + aabb[3]) / 2,
        labelHeight,
        (aabb[2] + aabb[5]) / 2,
      ];

      // Get room info from metadata
      const fmGuid = metaObj.originalSystemId || metaObj.id;
      const name = extractFieldValue(metaObj, 'commonName');
      const number = extractFieldValue(metaObj, 'designation');

      // Create HTML label element with dynamic content
      const labelEl = document.createElement('div');
      labelEl.className = 'room-label';
      labelEl.innerHTML = buildLabelContent(metaObj);
      
      // Enable pointer events if click action is set
      const hasClickAction = config.clickAction !== 'none';
      
      labelEl.style.cssText = `
        position: absolute;
        background: hsl(var(--background) / 0.85);
        color: hsl(var(--foreground));
        padding: 3px 6px;
        border-radius: 4px;
        font-size: ${config.fontSize}px;
        line-height: 1.3;
        text-align: center;
        transform: translate(-50%, -50%);
        white-space: nowrap;
        pointer-events: ${hasClickAction ? 'auto' : 'none'};
        cursor: ${hasClickAction ? 'pointer' : 'default'};
        border: 1px solid hsl(var(--border) / 0.5);
        box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        display: none;
        z-index: 5;
        transition: transform 0.1s ease-out;
      `;
      
      container.appendChild(labelEl);

      const labelData: RoomLabel = {
        fmGuid,
        name,
        number,
        worldPos: center,
        element: labelEl,
        entityId: metaObj.id,
        metaObject: metaObj,
      };

      // Add click handler if configured
      if (hasClickAction) {
        labelEl.addEventListener('click', (e) => {
          e.stopPropagation();
          handleLabelClick(labelData);
        });
        
        // Hover effect
        labelEl.addEventListener('mouseenter', () => {
          labelEl.style.background = 'hsl(var(--primary) / 0.15)';
          labelEl.style.borderColor = 'hsl(var(--primary) / 0.5)';
        });
        labelEl.addEventListener('mouseleave', () => {
          labelEl.style.background = 'hsl(var(--background) / 0.85)';
          labelEl.style.borderColor = 'hsl(var(--border) / 0.5)';
        });
      }

      labelsRef.current.set(fmGuid, labelData);

      createdCount++;
    });

    console.log(`✅ Created ${createdCount} room labels (${filteredCount} filtered by floor)`);

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
  }, [getXeokitViewer, ensureContainer, updateLabelPositions, buildLabelContent, extractFieldValue, handleLabelClick]);

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

  // Toggle labels on/off with optional floor filtering
  const setLabelsEnabled = useCallback((enabled: boolean, floorGuids?: string[]) => {
    enabledRef.current = enabled;

    if (enabled) {
      createLabels(floorGuids);
    } else {
      destroyLabels();
    }

    // Show/hide container
    if (containerRef.current) {
      containerRef.current.style.display = enabled ? 'block' : 'none';
    }
  }, [createLabels, destroyLabels]);

  // Update floor filter and recreate labels
  const updateFloorFilter = useCallback((floorGuids: string[]) => {
    visibleFloorGuidsRef.current = floorGuids;
    if (enabledRef.current) {
      // Destroy and recreate with new filter
      destroyLabels();
      createLabels(floorGuids);
    }
  }, [createLabels, destroyLabels]);

  // Update view mode (2D/3D) and recreate labels with appropriate height
  const updateViewMode = useCallback((mode: '2d' | '3d') => {
    if (viewModeRef.current === mode) return;
    
    console.log(`Room labels: Updating view mode to ${mode}`);
    viewModeRef.current = mode;
    
    if (enabledRef.current) {
      // Destroy and recreate labels with new height
      destroyLabels();
      createLabels();
    }
  }, [createLabels, destroyLabels]);

  // Update config and recreate labels
  const updateConfig = useCallback((newConfig: Partial<RoomLabelsConfigDetail>) => {
    configRef.current = { ...configRef.current, ...newConfig };
    
    if (enabledRef.current) {
      // Recreate labels with new config
      destroyLabels();
      createLabels();
    }
  }, [createLabels, destroyLabels]);

  // Listen for config change events
  useEffect(() => {
    const handleConfigChange = (e: CustomEvent<RoomLabelsConfigDetail>) => {
      console.log('Room labels: Config changed', e.detail);
      updateConfig(e.detail);
    };

    window.addEventListener(ROOM_LABELS_CONFIG_EVENT, handleConfigChange as EventListener);
    return () => {
      window.removeEventListener(ROOM_LABELS_CONFIG_EVENT, handleConfigChange as EventListener);
    };
  }, [updateConfig]);

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
    updateFloorFilter,
    updateViewMode,
    updateConfig,
    isEnabled: enabledRef.current,
    labelCount: labelsRef.current.size,
    refreshLabels: createLabels,
    currentConfig: configRef.current,
  };
}

export default useRoomLabels;
