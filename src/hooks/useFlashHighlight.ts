import { useCallback, useRef } from 'react';

interface FlashOptions {
  color1?: [number, number, number];
  color2?: [number, number, number];
  interval?: number;
  duration?: number;
}

/**
 * Hook for flashing/highlighting selected objects in xeokit scene
 * Based on the xeokit SDK example pattern
 */
export const useFlashHighlight = () => {
  const flashIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentEntityRef = useRef<any>(null);
  const originalColorRef = useRef<[number, number, number] | null>(null);

  /**
   * Stop any active flashing effect
   */
  const stopFlashing = useCallback(() => {
    if (flashIntervalRef.current) {
      clearInterval(flashIntervalRef.current);
      flashIntervalRef.current = null;
    }
    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = null;
    }
    
    // Reset entity to original color
    if (currentEntityRef.current && originalColorRef.current) {
      try {
        currentEntityRef.current.colorize = originalColorRef.current;
      } catch (e) {
        console.debug('Could not reset entity color:', e);
      }
    }
    
    currentEntityRef.current = null;
    originalColorRef.current = null;
  }, []);

  /**
   * Start flashing effect on an entity
   */
  const startFlashing = useCallback((
    entity: any,
    options: FlashOptions = {}
  ) => {
    const {
      color1 = [1, 0.3, 0.3],   // Highlight red
      color2 = [1, 1, 1],       // White/original
      interval = 250,          // Flash interval in ms
      duration = 3000,         // Total duration in ms (0 = infinite)
    } = options;

    // Stop any previous flashing
    stopFlashing();

    if (!entity) return;

    try {
      // Store original color
      currentEntityRef.current = entity;
      originalColorRef.current = entity.colorize ? [...entity.colorize] as [number, number, number] : [1, 1, 1];

      let visible = true;
      
      // Start flashing
      flashIntervalRef.current = setInterval(() => {
        if (!currentEntityRef.current) return;
        
        try {
          currentEntityRef.current.colorize = visible ? color1 : color2;
          visible = !visible;
        } catch (e) {
          stopFlashing();
        }
      }, interval);

      // Stop after duration if specified
      if (duration > 0) {
        flashTimeoutRef.current = setTimeout(() => {
          stopFlashing();
        }, duration);
      }
    } catch (e) {
      console.debug('Could not start flashing:', e);
      stopFlashing();
    }
  }, [stopFlashing]);

  /**
   * Flash an entity by ID in a scene
   * Supports both direct scene.objects lookup and metaScene lookup
   */
  const flashEntityById = useCallback((
    scene: any,
    entityId: string,
    options?: FlashOptions
  ) => {
    if (!scene || !entityId) return;

    // Try direct lookup first (most common case)
    let entity = scene.objects?.[entityId];
    
    // If not found, the ID might be uppercase or have different casing
    if (!entity) {
      // Try case-insensitive lookup
      const objectIds = Object.keys(scene.objects || {});
      const matchingId = objectIds.find(
        id => id.toLowerCase() === entityId.toLowerCase()
      );
      if (matchingId) {
        entity = scene.objects[matchingId];
      }
    }
    
    if (entity) {
      startFlashing(entity, options);
    } else {
      console.debug('Flash: Entity not found in scene:', entityId);
    }
  }, [startFlashing]);

  /**
   * Flash multiple entities by IDs
   */
  const flashEntitiesByIds = useCallback((
    scene: any,
    entityIds: string[],
    options: FlashOptions = {}
  ) => {
    if (!scene || !entityIds.length) return;

    const {
      color1 = [1, 0.3, 0.3],
      color2 = [1, 1, 1],
      interval = 250,
      duration = 3000,
    } = options;

    // Stop any previous flashing
    stopFlashing();

    const entities = entityIds
      .map(id => scene.objects?.[id])
      .filter(Boolean);

    if (entities.length === 0) return;

    // Store references for cleanup
    const originalColors = entities.map(e => e.colorize ? [...e.colorize] : [1, 1, 1]);
    let visible = true;

    flashIntervalRef.current = setInterval(() => {
      try {
        entities.forEach(entity => {
          if (entity) {
            entity.colorize = visible ? color1 : color2;
          }
        });
        visible = !visible;
      } catch (e) {
        stopFlashing();
      }
    }, interval);

    // Store cleanup reference
    currentEntityRef.current = { entities, originalColors };

    if (duration > 0) {
      flashTimeoutRef.current = setTimeout(() => {
        // Restore original colors
        try {
          entities.forEach((entity, i) => {
            if (entity) {
              entity.colorize = originalColors[i];
            }
          });
        } catch (e) {
          console.debug('Could not restore colors:', e);
        }
        stopFlashing();
      }, duration);
    }
  }, [stopFlashing]);

  /**
   * Handle pick/click event to detect and flash selected object
   * This follows the xeokit SDK example pattern
   */
  const handlePickAndFlash = useCallback((
    viewer: any,
    canvasPos: [number, number],
    options?: FlashOptions
  ) => {
    if (!viewer?.scene) return null;

    try {
      const hit = viewer.scene.pick({
        canvasPos,
        pickSurface: true,
      });

      if (hit?.entity) {
        console.log('Selected object ID:', hit.entity.id);
        startFlashing(hit.entity, options);
        return hit;
      } else {
        stopFlashing();
        return null;
      }
    } catch (e) {
      console.debug('Pick error:', e);
      return null;
    }
  }, [startFlashing, stopFlashing]);

  return {
    startFlashing,
    stopFlashing,
    flashEntityById,
    flashEntitiesByIds,
    handlePickAndFlash,
  };
};

export default useFlashHighlight;
