import { describe, it, expect } from "vitest";
import {
  parseNavGraph,
  findNodeByRoom,
  dijkstra,
  dijkstraWithOptions,
  mergeGraphs,
  findNearestEntranceNode,
  euclideanDist,
  generateIndoorSteps,
  navGraphToGeoJSON,
  type NavGraph,
  type NavNode,
  type RouteResult,
} from "@/lib/pathfinding";

function node(
  nodeId: string,
  coordinates: [number, number],
  extra: Partial<NavNode> = {},
): NavNode {
  return { nodeId, coordinates, room_fm_guid: null, floor_fm_guid: null, type: "waypoint", ...extra };
}

function graphFrom(nodes: NavNode[], edges: Array<[string, string, number]>): NavGraph {
  const map = new Map(nodes.map((n) => [n.nodeId, n]));
  return { nodes: map, edges: edges.map(([from, to, weight]) => ({ from, to, weight })) };
}

describe("parseNavGraph", () => {
  it("parses Point features into nodes and LineString features into edges", () => {
    const geojson = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [10, 20] },
          properties: { nodeId: "a", room_fm_guid: "room-1", type: "entrance" },
        },
        {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [30, 40] },
          properties: { nodeId: "b" },
        },
        {
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: [[10, 20], [30, 40]] },
          properties: { from: "a", to: "b", weight: 5 },
        },
      ],
    };

    const graph = parseNavGraph(geojson);

    expect(graph.nodes.size).toBe(2);
    expect(graph.nodes.get("a")).toMatchObject({
      nodeId: "a",
      coordinates: [10, 20],
      room_fm_guid: "room-1",
      type: "entrance",
    });
    expect(graph.nodes.get("b")).toMatchObject({ type: "waypoint", room_fm_guid: null });
    expect(graph.edges).toEqual([{ from: "a", to: "b", weight: 5 }]);
  });

  it("skips Point features with no nodeId", () => {
    const geojson = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [0, 0] },
          properties: {},
        },
      ],
    };
    expect(parseNavGraph(geojson).nodes.size).toBe(0);
  });

  it("skips LineString features missing from/to/weight", () => {
    const geojson = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] },
          properties: { from: "a", to: "b" }, // no weight
        },
      ],
    };
    expect(parseNavGraph(geojson).edges).toHaveLength(0);
  });
});

describe("findNodeByRoom", () => {
  const graph = graphFrom(
    [node("a", [0, 0], { room_fm_guid: "AC36D08E-A188-4AA0-A8C4-A7EC65A9A40E" })],
    [],
  );

  it("matches ignoring case and dashes", () => {
    expect(findNodeByRoom(graph, "ac36d08ea1884aa0a8c4a7ec65a9a40e")?.nodeId).toBe("a");
    expect(findNodeByRoom(graph, "AC36D08E-A188-4AA0-A8C4-A7EC65A9A40E")?.nodeId).toBe("a");
  });

  it("returns null when no node matches", () => {
    expect(findNodeByRoom(graph, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("dijkstra", () => {
  it("returns a zero-distance single-node path when start equals end", () => {
    const graph = graphFrom([node("a", [0, 0])], []);
    const result = dijkstra(graph, "a", "a");
    expect(result).toEqual({ path: [graph.nodes.get("a")], totalDistance: 0, floorTransitions: [] });
  });

  it("returns null when either node is unknown", () => {
    const graph = graphFrom([node("a", [0, 0])], []);
    expect(dijkstra(graph, "a", "missing")).toBeNull();
    expect(dijkstra(graph, "missing", "a")).toBeNull();
  });

  it("returns null when no path connects start and end", () => {
    const graph = graphFrom([node("a", [0, 0]), node("b", [1, 1])], []);
    expect(dijkstra(graph, "a", "b")).toBeNull();
  });

  it("picks the shorter of two routes between the same two nodes", () => {
    // a --10-- b --10-- d   (total 20)
    // a --100-- c --1-- d   (total 101)
    const graph = graphFrom(
      [node("a", [0, 0]), node("b", [1, 0]), node("c", [0, 1]), node("d", [1, 1])],
      [
        ["a", "b", 10],
        ["b", "d", 10],
        ["a", "c", 100],
        ["c", "d", 1],
      ],
    );
    const result = dijkstra(graph, "a", "d");
    expect(result?.totalDistance).toBe(20);
    expect(result?.path.map((n) => n.nodeId)).toEqual(["a", "b", "d"]);
  });

  it("treats edges as undirected", () => {
    const graph = graphFrom([node("a", [0, 0]), node("b", [1, 0])], [["b", "a", 7]]);
    const result = dijkstra(graph, "a", "b");
    expect(result?.totalDistance).toBe(7);
  });

  it("reports a floor transition when consecutive path nodes are on different floors", () => {
    const graph = graphFrom(
      [
        node("a", [0, 0], { floor_fm_guid: "floor-1" }),
        node("b", [1, 0], { floor_fm_guid: "floor-2", type: "elevator" }),
      ],
      [["a", "b", 5]],
    );
    const result = dijkstra(graph, "a", "b");
    expect(result?.floorTransitions).toEqual([{ nodeId: "b", fromFloor: "floor-1", toFloor: "floor-2" }]);
  });
});

describe("dijkstraWithOptions", () => {
  it("without preferElevator, picks the raw shortest path even through a stairwell", () => {
    // Direct stair route (short) vs elevator detour (long)
    const graph = graphFrom(
      [
        node("a", [0, 0]),
        node("stair", [1, 0], { type: "stairwell" }),
        node("b", [2, 0]),
        node("elev", [1, 1], { type: "elevator" }),
      ],
      [
        ["a", "stair", 5],
        ["stair", "b", 5],
        ["a", "elev", 50],
        ["elev", "b", 50],
      ],
    );
    const result = dijkstraWithOptions(graph, "a", "b");
    expect(result?.path.map((n) => n.nodeId)).toEqual(["a", "stair", "b"]);
    expect(result?.totalDistance).toBe(10);
  });

  it("with preferElevator, adds a heavy penalty to stairwell edges so the elevator route wins", () => {
    const graph = graphFrom(
      [
        node("a", [0, 0]),
        node("stair", [1, 0], { type: "stairwell" }),
        node("b", [2, 0]),
        node("elev", [1, 1], { type: "elevator" }),
      ],
      [
        ["a", "stair", 5],
        ["stair", "b", 5],
        ["a", "elev", 50],
        ["elev", "b", 50],
      ],
    );
    const result = dijkstraWithOptions(graph, "a", "b", { preferElevator: true });
    expect(result?.path.map((n) => n.nodeId)).toEqual(["a", "elev", "b"]);
    expect(result?.totalDistance).toBe(100);
  });

  it("start-equals-end and unreachable-node behavior matches plain dijkstra", () => {
    const graph = graphFrom([node("a", [0, 0]), node("b", [1, 0])], []);
    expect(dijkstraWithOptions(graph, "a", "a")?.totalDistance).toBe(0);
    expect(dijkstraWithOptions(graph, "a", "b")).toBeNull();
  });
});

describe("mergeGraphs", () => {
  it("combines nodes and edges from multiple graphs", () => {
    const g1 = graphFrom([node("a", [0, 0])], [["a", "b", 1]]);
    const g2 = graphFrom([node("b", [1, 0])], [["b", "a", 2]]);
    const merged = mergeGraphs([g1, g2]);
    expect(Array.from(merged.nodes.keys()).sort()).toEqual(["a", "b"]);
    expect(merged.edges).toHaveLength(2);
  });

  it("lets a later graph's node override an earlier one with the same id", () => {
    const g1 = graphFrom([node("a", [0, 0], { type: "waypoint" })], []);
    const g2 = graphFrom([node("a", [9, 9], { type: "entrance" })], []);
    const merged = mergeGraphs([g1, g2]);
    expect(merged.nodes.get("a")).toMatchObject({ coordinates: [9, 9], type: "entrance" });
  });
});

describe("findNearestEntranceNode", () => {
  it("prefers entrance-typed nodes over others", () => {
    const graph = graphFrom(
      [node("far", [0, 0], { type: "waypoint" }), node("entrance", [5, 5], { type: "entrance" })],
      [],
    );
    expect(findNearestEntranceNode(graph)?.nodeId).toBe("entrance");
  });

  it("picks the entrance closest to the origin when several exist", () => {
    const graph = graphFrom(
      [
        node("far-entrance", [10, 10], { type: "entrance" }),
        node("near-entrance", [1, 1], { type: "entrance" }),
      ],
      [],
    );
    expect(findNearestEntranceNode(graph)?.nodeId).toBe("near-entrance");
  });

  it("falls back to any node when no entrance-typed node exists", () => {
    const graph = graphFrom([node("only", [3, 4], { type: "waypoint" })], []);
    expect(findNearestEntranceNode(graph)?.nodeId).toBe("only");
  });

  it("returns null for an empty graph", () => {
    expect(findNearestEntranceNode({ nodes: new Map(), edges: [] })).toBeNull();
  });
});

describe("euclideanDist", () => {
  it("computes straight-line distance", () => {
    expect(euclideanDist([0, 0], [3, 4])).toBe(5);
  });
});

describe("generateIndoorSteps", () => {
  it("returns an empty array for a route with fewer than 2 nodes", () => {
    expect(generateIndoorSteps(null as unknown as RouteResult)).toEqual([]);
    expect(generateIndoorSteps({ path: [node("a", [0, 0])], totalDistance: 0, floorTransitions: [] })).toEqual([]);
  });

  it("produces a single arrival step for a straight two-node route", () => {
    const route: RouteResult = {
      path: [node("a", [0, 0]), node("b", [0, 10])],
      totalDistance: 10,
      floorTransitions: [],
    };
    const steps = generateIndoorSteps(route);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: "arrive", instruction: "Arrived", distance: 10 });
  });

  it("inserts a stairs/elevator step on a floor change", () => {
    const route: RouteResult = {
      path: [
        node("a", [0, 0], { floor_fm_guid: "f1" }),
        node("b", [0, 0], { floor_fm_guid: "f2", type: "elevator" }),
      ],
      totalDistance: 0,
      floorTransitions: [{ nodeId: "b", fromFloor: "f1", toFloor: "f2" }],
    };
    const steps = generateIndoorSteps(route);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      type: "elevator",
      instruction: "Take the elevator",
      floorChange: { fromFloor: "f1", toFloor: "f2" },
    });
  });

  it("splits a route into a walk segment and a turn when the path bends more than 30 degrees", () => {
    // a -> b straight along x, then b -> c turns 90 degrees along y: a sharp right/left turn
    const route: RouteResult = {
      path: [node("a", [0, 0]), node("b", [10, 0]), node("c", [10, 10])],
      totalDistance: 20,
      floorTransitions: [],
    };
    const steps = generateIndoorSteps(route);
    const types = steps.map((s) => s.type);
    expect(types).toContain("turn");
    expect(types[0]).toBe("walk");
  });
});

describe("navGraphToGeoJSON", () => {
  it("round-trips through parseNavGraph", () => {
    const graph = graphFrom(
      [node("a", [0, 0], { room_fm_guid: "r1" }), node("b", [10, 10])],
      [["a", "b", 3]],
    );
    const geojson = navGraphToGeoJSON(graph);
    const reparsed = parseNavGraph(geojson);

    expect(reparsed.nodes.size).toBe(2);
    expect(reparsed.nodes.get("a")).toMatchObject({ coordinates: [0, 0], room_fm_guid: "r1" });
    expect(reparsed.edges).toEqual([{ from: "a", to: "b", weight: 3 }]);
  });

  it("drops edges that reference a node not present in the graph", () => {
    const graph: NavGraph = {
      nodes: new Map([["a", node("a", [0, 0])]]),
      edges: [{ from: "a", to: "ghost", weight: 1 }],
    };
    const geojson = navGraphToGeoJSON(graph);
    expect(geojson.features.every((f) => f.geometry.type !== "LineString")).toBe(true);
  });
});
