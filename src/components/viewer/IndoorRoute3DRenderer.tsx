/**
 * IndoorRoute3DRenderer — draws a computed indoor RouteResult as real 3D geometry
 * inside the xeokit scene (a LineSet path + start/end/floor-transition markers),
 * instead of only on the flat 2D plan overlay. Renders nothing to the DOM itself.
 *
 * Purely a geometry renderer — camera movement and floor switching are owned by
 * IndoorWayfindingPanel, which reacts to the same route.
 */

import React, { useEffect } from 'react';
import { useFloorData } from '@/hooks/useFloorData';
import { getXeokitViewerFromRef } from '@/hooks/useFloorVisibility';
import {
  resolveRoutePositions, buildRouteSegments, segmentsToLineSetArrays, buildRouteMarkers,
  type RouteMarker,
} from '@/lib/indoor-route-3d';
import type { RouteResult } from '@/lib/pathfinding';

interface IndoorRoute3DRendererProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;
  isViewerReady: boolean;
  route: RouteResult | null;
}

const PATH_COLOR: [number, number, number] = [0.29, 0.56, 0.95];
const MARKER_COLORS: Record<RouteMarker['kind'], [number, number, number]> = {
  start: [0.15, 0.68, 0.38],
  end: [0.86, 0.15, 0.15],
  transition: [0.98, 0.62, 0.15],
};

const IndoorRoute3DRenderer: React.FC<IndoorRoute3DRendererProps> = ({
  viewerRef, buildingFmGuid, isViewerReady, route,
}) => {
  const { floors } = useFloorData(viewerRef, buildingFmGuid);

  useEffect(() => {
    const created: any[] = [];
    const cleanup = () => {
      created.forEach(obj => { try { obj.destroy(); } catch { /* already gone */ } });
      created.length = 0;
    };

    if (!route || route.path.length < 2 || !isViewerReady) return cleanup;

    const viewer = getXeokitViewerFromRef(viewerRef);
    const sdk = (window as any).__xeokitSdk;
    if (!viewer?.scene || !sdk) return cleanup;

    const resolved = resolveRoutePositions(viewer, floors, route);
    const { normal, transitions } = buildRouteSegments(resolved);
    const markers = buildRouteMarkers(resolved, route);

    if (normal.length > 0) {
      const { positions, indices } = segmentsToLineSetArrays(normal);
      created.push(new sdk.LineSet(viewer.scene, { positions, indices, color: PATH_COLOR }));
    }
    if (transitions.length > 0) {
      const { positions, indices } = segmentsToLineSetArrays(transitions);
      created.push(new sdk.LineSet(viewer.scene, { positions, indices, color: MARKER_COLORS.transition }));
    }

    if (markers.length > 0) {
      const sphereGeometry = new sdk.ReadableGeometry(
        viewer.scene,
        sdk.buildSphereGeometry({ radius: 0.35, heightSegments: 12, widthSegments: 12 }),
      );
      created.push(sphereGeometry);

      markers.forEach(marker => {
        const color = MARKER_COLORS[marker.kind];
        const material = new sdk.PhongMaterial(viewer.scene, { diffuse: color, emissive: color, ambient: color });
        created.push(material);
        created.push(new sdk.Mesh(viewer.scene, {
          geometry: sphereGeometry,
          material,
          position: marker.pos,
          pickable: false,
          collidable: false,
        }));
      });
    }

    return cleanup;
  }, [route, floors, isViewerReady, viewerRef]);

  return null;
};

export default IndoorRoute3DRenderer;
