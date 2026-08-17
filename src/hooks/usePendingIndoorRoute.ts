import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  parseNavGraph, dijkstra, findNodeByRoom, findNearestEntranceNode, mergeGraphs,
  type NavGraph, type RouteResult,
} from '@/lib/pathfinding';

interface PendingIndoorRoutePayload {
  buildingFmGuid: string;
  targetRoomFmGuid?: string | null;
  /** Geo-projected route from MapView, kept for shape compatibility — not consumed here. */
  route?: unknown;
}

interface UsePendingIndoorRouteOptions {
  buildingFmGuid: string | null | undefined;
  /** Only consume once the caller is ready to actually display the result (e.g. viewer loaded). */
  ready: boolean;
  onRoute: (graph: NavGraph, route: RouteResult) => void;
}

/**
 * Consumes the `pending_indoor_route` handoff written to sessionStorage by the
 * outdoor map (MapView) when the user picks "Show in building" / "Visa i byggnad".
 *
 * The map only hands off the building and the target room fm_guid — the actual
 * path nodes live in the `navigation_graphs` table, so the route is re-derived
 * here from the building's entrance node to the target room. Falls back to the
 * last node in the graph only when no target room was recorded (e.g. the user
 * navigated to the building without picking a room).
 */
export function usePendingIndoorRoute({ buildingFmGuid, ready, onRoute }: UsePendingIndoorRouteOptions) {
  useEffect(() => {
    if (!ready || !buildingFmGuid) return;

    const raw = sessionStorage.getItem('pending_indoor_route');
    if (!raw) return;
    sessionStorage.removeItem('pending_indoor_route');

    let payload: PendingIndoorRoutePayload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.warn('[usePendingIndoorRoute] Failed to parse pending_indoor_route:', e);
      return;
    }
    if (payload.buildingFmGuid !== buildingFmGuid) return;

    let cancelled = false;

    (async () => {
      const { data: graphRows } = await supabase
        .from('navigation_graphs')
        .select('graph_data')
        .eq('building_fm_guid', buildingFmGuid);
      if (cancelled || !graphRows?.length) return;

      const graphs = graphRows.map(r => parseNavGraph(r.graph_data as unknown as GeoJSON.FeatureCollection));
      const merged = mergeGraphs(graphs);
      const entrance = findNearestEntranceNode(merged);
      if (!entrance) return;

      let targetNodeId: string | null = null;
      if (payload.targetRoomFmGuid) {
        const target = findNodeByRoom(merged, payload.targetRoomFmGuid);
        if (target) targetNodeId = target.nodeId;
      }
      if (!targetNodeId) {
        const nodes = Array.from(merged.nodes.values());
        if (nodes.length === 0) return;
        targetNodeId = nodes[nodes.length - 1].nodeId;
      }

      const result = dijkstra(merged, entrance.nodeId, targetNodeId);
      if (!cancelled && result) onRoute(merged, result);
    })();

    return () => { cancelled = true; };
  }, [ready, buildingFmGuid, onRoute]);
}
