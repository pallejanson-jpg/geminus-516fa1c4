/**
 * Dijkstra pathfinding on a GeoJSON FeatureCollection graph.
 *
 * Nodes: Point features with properties.nodeId (string)
 *        Optional: properties.room_fm_guid, properties.floor_fm_guid, properties.type ('stairwell'|'elevator')
 * Edges: LineString features with properties.from, properties.to (nodeId refs), properties.weight (number)
 */

export interface NavNode {
  nodeId: string;
  coordinates: [number, number]; // [x%, y%] normalized
  room_fm_guid?: string | null;
  floor_fm_guid?: string | null;
  type?: 'waypoint' | 'stairwell' | 'elevator';
}

export interface NavEdge {
  from: string;
  to: string;
  weight: number;
}

export interface NavGraph {
  nodes: Map<string, NavNode>;
  edges: NavEdge[];
}

export interface RouteResult {
  path: NavNode[];
  totalDistance: number;
  floorTransitions: Array<{ nodeId: string; fromFloor: string; toFloor: string }>;
}

/** Parse a GeoJSON FeatureCollection into a NavGraph */
export function parseNavGraph(geojson: GeoJSON.FeatureCollection): NavGraph {
  const nodes = new Map<string, NavNode>();
  const edges: NavEdge[] = [];

  for (const feature of geojson.features) {
    if (feature.geometry.type === 'Point') {
      const props = feature.properties || {};
      const nodeId = props.nodeId as string;
      if (!nodeId) continue;
      nodes.set(nodeId, {
        nodeId,
        coordinates: feature.geometry.coordinates as [number, number],
        room_fm_guid: props.room_fm_guid || null,
        floor_fm_guid: props.floor_fm_guid || null,
        type: props.type || 'waypoint',
      });
    } else if (feature.geometry.type === 'LineString') {
      const props = feature.properties || {};
      if (props.from && props.to && typeof props.weight === 'number') {
        edges.push({ from: props.from, to: props.to, weight: props.weight });
      }
    }
  }

  return { nodes, edges };
}

/** Build adjacency list from edges (undirected graph) */
function buildAdjacency(graph: NavGraph): Map<string, Array<{ neighbor: string; weight: number }>> {
  const adj = new Map<string, Array<{ neighbor: string; weight: number }>>();
  for (const [nodeId] of graph.nodes) {
    adj.set(nodeId, []);
  }
  for (const edge of graph.edges) {
    adj.get(edge.from)?.push({ neighbor: edge.to, weight: edge.weight });
    adj.get(edge.to)?.push({ neighbor: edge.from, weight: edge.weight });
  }
  return adj;
}

/** Find node by room_fm_guid */
export function findNodeByRoom(graph: NavGraph, roomFmGuid: string): NavNode | null {
  for (const [, node] of graph.nodes) {
    if (node.room_fm_guid && node.room_fm_guid.toLowerCase().replace(/-/g, '') === roomFmGuid.toLowerCase().replace(/-/g, '')) {
      return node;
    }
  }
  return null;
}

/** Dijkstra shortest path */
export function dijkstra(graph: NavGraph, startNodeId: string, endNodeId: string): RouteResult | null {
  if (!graph.nodes.has(startNodeId) || !graph.nodes.has(endNodeId)) return null;
  if (startNodeId === endNodeId) {
    const node = graph.nodes.get(startNodeId)!;
    return { path: [node], totalDistance: 0, floorTransitions: [] };
  }

  const adj = buildAdjacency(graph);
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const [nodeId] of graph.nodes) {
    dist.set(nodeId, Infinity);
    prev.set(nodeId, null);
  }
  dist.set(startNodeId, 0);

  // Simple priority queue via sorted array (fine for <10k nodes)
  const queue: string[] = [startNodeId];

  while (queue.length > 0) {
    // Pick node with smallest distance
    queue.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
    const current = queue.shift()!;

    if (current === endNodeId) break;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adj.get(current) || [];
    for (const { neighbor, weight } of neighbors) {
      if (visited.has(neighbor)) continue;
      const newDist = (dist.get(current) ?? Infinity) + weight;
      if (newDist < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, newDist);
        prev.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  // Reconstruct path
  if (dist.get(endNodeId) === Infinity) return null;

  const path: NavNode[] = [];
  let current: string | null = endNodeId;
  while (current) {
    path.unshift(graph.nodes.get(current)!);
    current = prev.get(current) ?? null;
  }

  // Detect floor transitions
  const floorTransitions: RouteResult['floorTransitions'] = [];
  for (let i = 1; i < path.length; i++) {
    const prevFloor = path[i - 1].floor_fm_guid;
    const curFloor = path[i].floor_fm_guid;
    if (prevFloor && curFloor && prevFloor !== curFloor) {
      floorTransitions.push({
        nodeId: path[i].nodeId,
        fromFloor: prevFloor,
        toFloor: curFloor,
      });
    }
  }

  return {
    path,
    totalDistance: dist.get(endNodeId) ?? 0,
    floorTransitions,
  };
}

/** Merge multiple per-floor graphs into one combined graph */
export function mergeGraphs(graphs: NavGraph[]): NavGraph {
  const merged: NavGraph = { nodes: new Map(), edges: [] };
  for (const g of graphs) {
    for (const [id, node] of g.nodes) merged.nodes.set(id, node);
    merged.edges.push(...g.edges);
  }
  return merged;
}

/** Calculate Euclidean distance between two normalized coordinate points */
export function euclideanDist(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** Convert NavGraph back to GeoJSON FeatureCollection */
export function navGraphToGeoJSON(graph: NavGraph): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const [, node] of graph.nodes) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: node.coordinates },
      properties: {
        nodeId: node.nodeId,
        room_fm_guid: node.room_fm_guid || null,
        floor_fm_guid: node.floor_fm_guid || null,
        type: node.type || 'waypoint',
      },
    });
  }

  for (const edge of graph.edges) {
    const fromNode = graph.nodes.get(edge.from);
    const toNode = graph.nodes.get(edge.to);
    if (!fromNode || !toNode) continue;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [fromNode.coordinates, toNode.coordinates],
      },
      properties: { from: edge.from, to: edge.to, weight: edge.weight },
    });
  }

  return { type: 'FeatureCollection', features };
}
