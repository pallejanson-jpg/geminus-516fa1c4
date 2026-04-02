import { useRef, useCallback, useEffect } from 'react';
import { on } from '@/lib/event-bus';

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
  occlusionEnabled: boolean;
  flatOnFloor: boolean;
}

// Default config for backwards compatibility
const DEFAULT_CONFIG: RoomLabelsConfigDetail = {
  fields: ['commonName', 'designation'],
  heightOffset: 0.05,
  fontSize: 10,
  scaleWithDistance: true,
  clickAction: 'none',
  occlusionEnabled: true,
  flatOnFloor: false,
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

  // Occlusion frame counter for throttling
  const occlusionFrameRef = useRef(0);
  const occlusionCacheRef = useRef<Map<string, boolean>>(new Map());

  // Update all label positions with distance-based scaling, occlusion & flat mode (batched DOM writes)
  const updateLabelPositions = useCallback(() => {
    const viewer = getXeokitViewer();
    if (!viewer || !enabledRef.current) return;

    const config = configRef.current;
    const camera = viewer.camera;
    const cameraEye = camera?.eye || [0, 0, 0];
    const cameraLook = camera?.look || [0, 0, 0];

    const labelCount = labelsRef.current.size;
    // Adaptive throttling: more labels = less frequent occlusion checks
    // Auto-disable occlusion above threshold for performance
    const occlusionThreshold = 30;
    const effectiveOcclusion = config.occlusionEnabled && labelCount <= occlusionThreshold;
    const occlusionInterval = labelCount > 40 ? 15 : labelCount > 20 ? 10 : 5;

    occlusionFrameRef.current++;
    const runOcclusion = effectiveOcclusion && occlusionFrameRef.current % occlusionInterval === 0;

    // Phase 1: Compute all positions (read-only)
    // Viewport culling: get canvas dimensions for early rejection
    const canvas = viewer.scene?.canvas?.canvas;
    const canvasW = canvas?.clientWidth || 1920;
    const canvasH = canvas?.clientHeight || 1080;
    const margin = 50; // px margin outside viewport

    const updates: { el: HTMLDivElement; transform: string; visible: boolean }[] = [];

    labelsRef.current.forEach(label => {
      const canvasPos = worldToCanvas(label.worldPos, viewer);
      
      if (canvasPos) {
        // Early viewport culling — skip labels outside visible area
        if (canvasPos[0] < -margin || canvasPos[0] > canvasW + margin ||
            canvasPos[1] < -margin || canvasPos[1] > canvasH + margin) {
          updates.push({ el: label.element, transform: '', visible: false });
          return;
        }

        // Occlusion test (throttled, adaptive)
        let occluded = false;
        if (effectiveOcclusion) {
          if (runOcclusion) {
            try {
              const dx = label.worldPos[0] - cameraEye[0];
              const dy = label.worldPos[1] - cameraEye[1];
              const dz = label.worldPos[2] - cameraEye[2];
              const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (len > 0.1) {
                const dir = [dx / len, dy / len, dz / len];
                const pickResult = viewer.scene.pick({
                  origin: cameraEye,
                  direction: dir,
                  pickSurface: false,
                });
                if (pickResult?.entity && pickResult.entity.id !== label.entityId) {
                  // Check if hit is closer than label
                  const hitPos = pickResult.worldPos || pickResult.entity?.aabb;
                  if (hitPos) {
                    const hx = (hitPos[0] ?? ((hitPos[0] + hitPos[3]) / 2)) - cameraEye[0];
                    const hy = (hitPos[1] ?? ((hitPos[1] + hitPos[4]) / 2)) - cameraEye[1];
                    const hz = (hitPos[2] ?? ((hitPos[2] + hitPos[5]) / 2)) - cameraEye[2];
                    const hitDist = Math.sqrt(hx * hx + hy * hy + hz * hz);
                    if (hitDist < len * 0.95) {
                      occluded = true;
                    }
                  }
                }
              }
            } catch (e) {
              // pick() can fail silently
            }
            occlusionCacheRef.current.set(label.fmGuid, occluded);
          } else {
            occluded = occlusionCacheRef.current.get(label.fmGuid) || false;
          }
        }

        if (occluded) {
          updates.push({ el: label.element, transform: '', visible: false });
          return;
        }

        let scale = 1;
        if (config.scaleWithDistance) {
          const dx = cameraEye[0] - label.worldPos[0];
          const dy = cameraEye[1] - label.worldPos[1];
          const dz = cameraEye[2] - label.worldPos[2];
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          scale = Math.max(0.4, Math.min(1.3, 18 / Math.max(distance, 5)));
        }

        // Flat on floor transform
        let flatTransform = '';
        if (config.flatOnFloor) {
          const hdx = cameraEye[0] - cameraLook[0];
          const hdz = cameraEye[2] - cameraLook[2];
          const horizontalDist = Math.sqrt(hdx * hdx + hdz * hdz);
          const pitch = Math.atan2(cameraEye[1] - cameraLook[1], horizontalDist);
          const tiltDeg = 90 - (pitch * 180 / Math.PI);
          flatTransform = ` rotateX(${tiltDeg.toFixed(1)}deg)`;
        }

        updates.push({
          el: label.element,
          transform: `translate3d(${canvasPos[0]}px, ${canvasPos[1]}px, 0) translate(-50%, -50%) scale(${scale})${flatTransform}`,
          visible: true,
        });
      } else {
        updates.push({ el: label.element, transform: '', visible: false });
      }
    });

    // Phase 2: Batch all DOM writes
    for (const u of updates) {
      if (u.visible) {
        u.el.style.transform = u.transform;
        if (u.el.style.display === 'none') u.el.style.display = 'block';
      } else {
        if (u.el.style.display !== 'none') u.el.style.display = 'none';
      }
    }
  }, [getXeokitViewer, worldToCanvas]);

  // Handle label click
  const handleLabelClick = useCallback((label: RoomLabel) => {
    const config = configRef.current;
    const viewer = getXeokitViewer();
    
    if (viewer) {
      // Deselect all previously selected objects
      const scene = viewer.scene;
      if (scene?.selectedObjectIds?.length) {
        scene.selectedObjectIds.forEach((id: string) => {
          const obj = scene.objects?.[id];
          if (obj) obj.selected = false;
        });
      }
      
      // Select and highlight the room entity (same as Filter panel space click)
      const entity = scene?.objects?.[label.entityId];
      if (entity) {
        entity.visible = true;
        entity.selected = true;
      }
      
      // Fly camera to room
      if (entity?.aabb) {
        // Expand AABB by 1.5x for a better overview when zooming to a room
        const aabb = [...entity.aabb];
        const cx = (aabb[0] + aabb[3]) / 2, cy = (aabb[1] + aabb[4]) / 2, cz = (aabb[2] + aabb[5]) / 2;
        const expand = 1.5;
        const expanded = [
          cx - (cx - aabb[0]) * expand, cy - (cy - aabb[1]) * expand, cz - (cz - aabb[2]) * expand,
          cx + (aabb[3] - cx) * expand, cy + (aabb[4] - cy) * expand, cz + (aabb[5] - cz) * expand,
        ];
        viewer.cameraFlight?.flyTo({
          aabb: expanded,
          duration: 0.8,
        });
      }
    }
    
    // Also trigger room card if configured
    if (config.clickAction === 'roomcard' && onRoomClick) {
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

    // Build parent->children map for geometry centroid calculation
    const labelChildrenMap = new Map<string, string[]>();
    Object.values(metaObjects).forEach((mo: any) => {
      const parentId = mo.parent?.id;
      if (parentId) {
        if (!labelChildrenMap.has(parentId)) labelChildrenMap.set(parentId, []);
        labelChildrenMap.get(parentId)!.push(mo.id);
      }
    });

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

      // STRICT floor filtering - if filter is active, REQUIRE parent storey match
      if (hasFloorFilter) {
        if (!parentStorey) {
          // No parent storey found - skip this room entirely when filtering
          filteredCount++;
          return;
        }
        
        const storeyGuid = (parentStorey.originalSystemId || parentStorey.id || '').toLowerCase();
        if (!visibleLower.has(storeyGuid)) {
          filteredCount++;
          return; // Skip this room - not on a visible floor
        }
      }

      const entity = scene.objects?.[metaObj.id];
      if (!entity?.aabb) return;

      // Calculate center position - use geometry centroid when available for accuracy
      // AABB center is unreliable for L/T-shaped rooms (corridor center can land outside room)
      const aabb = entity.aabb;
      const labelHeight = viewModeRef.current === '2d' 
        ? aabb[1] + 0.1   // Floor level for 2D plan view
        : aabb[1] + config.heightOffset;
      
      // Try to compute a better centroid from child mesh positions
      let centerX = (aabb[0] + aabb[3]) / 2;
      let centerZ = (aabb[2] + aabb[5]) / 2;
      
      // Sample child entity AABBs to find a weighted centroid closer to actual geometry
      const childIds = labelChildrenMap.get(metaObj.id);
      if (childIds && childIds.length > 0) {
        let sumX = 0, sumZ = 0, count = 0;
        childIds.forEach(childId => {
          const childEntity = scene.objects?.[childId];
          if (childEntity?.aabb) {
            const ca = childEntity.aabb;
            sumX += (ca[0] + ca[3]) / 2;
            sumZ += (ca[2] + ca[5]) / 2;
            count++;
          }
        });
        if (count > 0) {
          centerX = sumX / count;
          centerZ = sumZ / count;
        }
      }
      
      const center = [centerX, labelHeight, centerZ];

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
        left: 0;
        top: 0;
        background: transparent;
        color: #000;
        padding: 1px 3px;
        border-radius: 2px;
        font-size: ${config.fontSize}px;
        line-height: 1.3;
        text-align: center;
        transform: translate3d(0, 0, 0) translate(-50%, -50%);
        white-space: nowrap;
        pointer-events: ${hasClickAction ? 'auto' : 'none'};
        cursor: ${hasClickAction ? 'pointer' : 'default'};
        border: none;
        box-shadow: none;
        text-shadow: 0 0 3px white, 0 0 3px white;
        display: none;
        z-index: 5;
        will-change: transform;
        transform-style: preserve-3d;
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
          labelEl.style.background = 'hsl(var(--background) / 0.6)';
          labelEl.style.borderColor = 'hsl(var(--border) / 0.3)';
        });
      }

      labelsRef.current.set(fmGuid, labelData);

      createdCount++;
    });

    console.log(`✅ Created ${createdCount} room labels (${filteredCount} filtered by floor)`);

    // Set up camera change listener with double-rAF throttling for performance
    const scene2 = viewer.scene;
    if (scene2 && !cameraListenerRef.current) {
      let rafId = 0;
      let frameSkip = 0;
      const throttledUpdate = () => {
        if (rafId) return;
        frameSkip++;
        // Only update every 2nd frame to reduce CPU load
        if (frameSkip % 2 !== 0) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          updateLabelPositions();
        });
      };
      scene2.camera?.on?.('matrix', throttledUpdate);
      cameraListenerRef.current = () => {
        scene2.camera?.off?.('matrix', throttledUpdate);
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
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

    // Remove and nullify container so a fresh one is created on next enable
    if (containerRef.current) {
      containerRef.current.remove();
      containerRef.current = null;
    }

    // Clear occlusion cache
    occlusionCacheRef.current.clear();

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

  // Store original config so we can restore on 3D switch
  const origConfigRef = useRef<RoomLabelsConfigDetail | null>(null);

  // Update view mode (2D/3D) and recreate labels with appropriate height + 2D overrides
  const updateViewMode = useCallback((mode: '2d' | '3d') => {
    if (viewModeRef.current === mode) return;
    
    console.log(`Room labels: Updating view mode to ${mode}`);
    viewModeRef.current = mode;

    if (mode === '2d') {
      // Save original config and apply 2D-optimized overrides
      origConfigRef.current = { ...configRef.current };
      configRef.current = {
        ...configRef.current,
        scaleWithDistance: false,
        occlusionEnabled: false,
        fontSize: Math.max(configRef.current.fontSize, 12),
      };
    } else if (origConfigRef.current) {
      // Restore original config when switching back to 3D
      configRef.current = origConfigRef.current;
      origConfigRef.current = null;
    }
    
    if (enabledRef.current) {
      // Destroy and recreate labels with new height + config
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
    const handleConfigChange = (detail: RoomLabelsConfigDetail) => {
      console.log('Room labels: Config changed', detail);
      updateConfig(detail);
    };

    const offHandleConfigChange = on('ROOM_LABELS_CONFIG', handleConfigChange);
    return () => {
      offHandleConfigChange();
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
