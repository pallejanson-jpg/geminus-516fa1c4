import { useCallback, useRef } from 'react';

interface BcfViewpoint {
  perspective_camera?: {
    camera_view_point: { x: number; y: number; z: number };
    camera_direction: { x: number; y: number; z: number };
    camera_up_vector: { x: number; y: number; z: number };
    field_of_view: number;
  };
  orthogonal_camera?: {
    camera_view_point: { x: number; y: number; z: number };
    camera_direction: { x: number; y: number; z: number };
    camera_up_vector: { x: number; y: number; z: number };
    view_to_world_scale: number;
  };
  components?: {
    visibility?: {
      default_visibility: boolean;
      exceptions: Array<{ ifc_guid: string; visible?: boolean }>;
    };
    selection?: Array<{ ifc_guid: string }>;
  };
  clipping_planes?: Array<{
    location: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
  }>;
}

interface UseBcfViewpointsProps {
  viewerRef: React.MutableRefObject<any>;
}

/**
 * Hook for capturing and restoring BCF viewpoints in xeokit viewer.
 * BCF (BIM Collaboration Format) is an open standard for issue tracking in BIM.
 */
export const useBcfViewpoints = ({ viewerRef }: UseBcfViewpointsProps) => {
  const bcfPluginRef = useRef<any>(null);

  /**
   * Get the xeokit viewer instance from the AssetPlusViewer
   */
  const getXeokitViewer = useCallback(() => {
    const viewer = viewerRef.current;
    return viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }, [viewerRef]);

  /**
   * Capture current viewpoint as BCF-compatible JSON.
   * This captures camera position, visible objects, and clipping planes.
   */
  const captureViewpoint = useCallback((): BcfViewpoint | null => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer) {
      console.warn('Viewer not available for BCF capture');
      return null;
    }

    try {
      const camera = xeokitViewer.camera;
      const scene = xeokitViewer.scene;

      // Determine camera type
      const isPerspective = camera.projection === 'perspective';

      // Build BCF viewpoint
      const viewpoint: BcfViewpoint = {};

      if (isPerspective) {
        viewpoint.perspective_camera = {
          camera_view_point: {
            x: camera.eye[0],
            y: camera.eye[1],
            z: camera.eye[2],
          },
          camera_direction: {
            x: camera.look[0] - camera.eye[0],
            y: camera.look[1] - camera.eye[1],
            z: camera.look[2] - camera.eye[2],
          },
          camera_up_vector: {
            x: camera.up[0],
            y: camera.up[1],
            z: camera.up[2],
          },
          field_of_view: camera.perspective?.fov || 60,
        };
      } else {
        viewpoint.orthogonal_camera = {
          camera_view_point: {
            x: camera.eye[0],
            y: camera.eye[1],
            z: camera.eye[2],
          },
          camera_direction: {
            x: camera.look[0] - camera.eye[0],
            y: camera.look[1] - camera.eye[1],
            z: camera.look[2] - camera.eye[2],
          },
          camera_up_vector: {
            x: camera.up[0],
            y: camera.up[1],
            z: camera.up[2],
          },
          view_to_world_scale: camera.ortho?.scale || 1,
        };
      }

      // Capture selected objects
      const selectedIds = Object.keys(scene.selectedObjectIds || {});
      if (selectedIds.length > 0) {
        viewpoint.components = {
          ...viewpoint.components,
          selection: selectedIds.map(id => ({ ifc_guid: id })),
        };
      }

      // Capture section planes if any
      const sectionPlanes = scene.sectionPlanes;
      if (sectionPlanes && Object.keys(sectionPlanes).length > 0) {
        viewpoint.clipping_planes = Object.values(sectionPlanes).map((plane: any) => ({
          location: {
            x: plane.pos[0],
            y: plane.pos[1],
            z: plane.pos[2],
          },
          direction: {
            x: plane.dir[0],
            y: plane.dir[1],
            z: plane.dir[2],
          },
        }));
      }

      return viewpoint;
    } catch (err) {
      console.error('Failed to capture BCF viewpoint:', err);
      return null;
    }
  }, [getXeokitViewer]);

  /**
   * Restore a BCF viewpoint, animating the camera to the saved position.
   */
  const restoreViewpoint = useCallback((viewpoint: BcfViewpoint, options?: { duration?: number }) => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer || !viewpoint) {
      console.warn('Cannot restore viewpoint - viewer or viewpoint not available');
      return;
    }

    try {
      const camera = xeokitViewer.camera;
      const scene = xeokitViewer.scene;
      const duration = options?.duration ?? 1.0;

      // Determine camera settings from viewpoint
      let eye: number[] = [0, 0, 0];
      let look: number[] = [0, 0, 0];
      let up: number[] = [0, 0, 1];

      if (viewpoint.perspective_camera) {
        const pc = viewpoint.perspective_camera;
        eye = [pc.camera_view_point.x, pc.camera_view_point.y, pc.camera_view_point.z];
        look = [
          pc.camera_view_point.x + pc.camera_direction.x,
          pc.camera_view_point.y + pc.camera_direction.y,
          pc.camera_view_point.z + pc.camera_direction.z,
        ];
        up = [pc.camera_up_vector.x, pc.camera_up_vector.y, pc.camera_up_vector.z];
        camera.projection = 'perspective';
      } else if (viewpoint.orthogonal_camera) {
        const oc = viewpoint.orthogonal_camera;
        eye = [oc.camera_view_point.x, oc.camera_view_point.y, oc.camera_view_point.z];
        look = [
          oc.camera_view_point.x + oc.camera_direction.x,
          oc.camera_view_point.y + oc.camera_direction.y,
          oc.camera_view_point.z + oc.camera_direction.z,
        ];
        up = [oc.camera_up_vector.x, oc.camera_up_vector.y, oc.camera_up_vector.z];
        camera.projection = 'ortho';
      }

      // Fly camera to position
      const cameraFlight = scene.components?.['CameraFlightAnimation'] || xeokitViewer.cameraFlight;
      if (cameraFlight) {
        cameraFlight.flyTo({
          eye,
          look,
          up,
          duration,
        });
      } else {
        // Fallback: direct camera set
        camera.eye = eye;
        camera.look = look;
        camera.up = up;
      }

      // Restore selection if any
      if (viewpoint.components?.selection && viewpoint.components.selection.length > 0) {
        // Clear current selection first
        scene.setObjectsSelected(scene.selectedObjectIds, false);
        
        // Select saved objects
        const idsToSelect = viewpoint.components.selection.map(s => s.ifc_guid);
        scene.setObjectsSelected(idsToSelect, true);
      }

      // Note: Section planes restoration would require more complex logic
      // This is a simplified implementation

    } catch (err) {
      console.error('Failed to restore BCF viewpoint:', err);
    }
  }, [getXeokitViewer]);

  /**
   * Capture a screenshot from the viewer canvas
   */
  const captureScreenshot = useCallback((): string | null => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer) {
      return null;
    }

    try {
      const canvas = xeokitViewer.scene?.canvas?.canvas;
      if (!canvas) {
        return null;
      }

      // Force a render before capturing
      xeokitViewer.scene?.render?.(true);
      return canvas.toDataURL('image/png');
    } catch (err) {
      console.error('Failed to capture screenshot:', err);
      return null;
    }
  }, [getXeokitViewer]);

  /**
   * Get IDs of currently selected objects
   */
  const getSelectedObjectIds = useCallback((): string[] => {
    const xeokitViewer = getXeokitViewer();
    if (!xeokitViewer) {
      return [];
    }

    try {
      const scene = xeokitViewer.scene;
      return Object.keys(scene.selectedObjectIds || {});
    } catch (err) {
      console.error('Failed to get selected objects:', err);
      return [];
    }
  }, [getXeokitViewer]);

  return {
    captureViewpoint,
    restoreViewpoint,
    captureScreenshot,
    getSelectedObjectIds,
  };
};

export type { BcfViewpoint };
