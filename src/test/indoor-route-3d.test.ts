import { describe, it, expect } from "vitest";
import {
  findFloorForGuid,
  getFloorAabb,
  pctToWorld,
  pctDistanceToMeters,
  buildRouteSegments,
  segmentsToLineSetArrays,
  buildRouteMarkers,
  inferStepFloors,
  type Aabb6,
  type ResolvedRouteNode,
} from "@/lib/indoor-route-3d";
import type { FloorInfo } from "@/hooks/useFloorData";
import type { RouteResult, NavNode, IndoorStep } from "@/lib/pathfinding";

function floor(overrides: Partial<FloorInfo> = {}): FloorInfo {
  return {
    id: "floor-1",
    name: "1 Tr",
    shortName: "1",
    metaObjectIds: [],
    databaseLevelFmGuids: ["11111111-1111-1111-1111-111111111111"],
    ...overrides,
  };
}

function node(nodeId: string, coordinates: [number, number], extra: Partial<NavNode> = {}): NavNode {
  return { nodeId, coordinates, room_fm_guid: null, floor_fm_guid: null, type: "waypoint", ...extra };
}

describe("findFloorForGuid", () => {
  const floors = [floor(), floor({ id: "floor-2", databaseLevelFmGuids: ["22222222-2222-2222-2222-222222222222"] })];

  it("matches ignoring case and dashes", () => {
    expect(findFloorForGuid(floors, "11111111111111111111111111111111")?.id).toBe("floor-1");
    expect(findFloorForGuid(floors, "22222222-2222-2222-2222-222222222222")?.id).toBe("floor-2");
  });

  it("returns null for a null/undefined/unmatched guid", () => {
    expect(findFloorForGuid(floors, null)).toBeNull();
    expect(findFloorForGuid(floors, undefined)).toBeNull();
    expect(findFloorForGuid(floors, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("getFloorAabb", () => {
  it("returns null when the viewer has no scene", () => {
    expect(getFloorAabb({}, floor())).toBeNull();
    expect(getFloorAabb(null, floor())).toBeNull();
  });

  it("falls back to the whole scene's AABB when the viewer has no metaScene to resolve storeys from", () => {
    const aabb: Aabb6 = [0, 0, 0, 10, 3, 10];
    const viewer = { scene: { aabb } };
    expect(getFloorAabb(viewer, floor())).toEqual(aabb);
  });

  it("falls back to the whole scene's AABB when no storey metaObject matches the floor", () => {
    const aabb: Aabb6 = [1, 2, 3, 4, 5, 6];
    const viewer = { scene: { aabb }, metaScene: { metaObjects: {} } };
    expect(getFloorAabb(viewer, floor({ name: "Nonexistent Floor" }))).toEqual(aabb);
  });

  it("returns null when there is no whole-scene AABB to fall back to", () => {
    const viewer = { scene: {} };
    expect(getFloorAabb(viewer, floor())).toBeNull();
  });
});

describe("pctToWorld", () => {
  const aabb: Aabb6 = [0, 10, 0, 100, 13, 200];

  it("denormalizes a [0,0] percent coordinate to the AABB's min corner", () => {
    expect(pctToWorld(0, 0, aabb)).toEqual([0, 10.3, 0]);
  });

  it("denormalizes a [100,100] percent coordinate to the AABB's max corner (XZ)", () => {
    const [x, , z] = pctToWorld(100, 100, aabb);
    expect(x).toBe(100);
    expect(z).toBe(200);
  });

  it("interpolates a midpoint", () => {
    const [x, , z] = pctToWorld(50, 50, aabb);
    expect(x).toBe(50);
    expect(z).toBe(100);
  });

  it("uses yOverride instead of the default floor-height offset when given", () => {
    const [, y] = pctToWorld(0, 0, aabb, 42);
    expect(y).toBe(42);
  });
});

describe("pctDistanceToMeters", () => {
  it("returns 0 for the same point", () => {
    const aabb: Aabb6 = [0, 0, 0, 100, 3, 100];
    expect(pctDistanceToMeters([10, 10], [10, 10], aabb)).toBe(0);
  });

  it("scales percent-space distance by the floor's real-world extent", () => {
    // A 100x100 unit floor spanning 0-100%: 10% of width = 10 real units.
    const aabb: Aabb6 = [0, 0, 0, 100, 3, 100];
    expect(pctDistanceToMeters([0, 0], [10, 0], aabb)).toBeCloseTo(10);
  });

  it("accounts for non-square (anisotropic) floors correctly", () => {
    // Floor is 200 units wide (X) but only 50 deep (Z). A 10% step in Z should be
    // much smaller in real meters than the same 10% step in X.
    const aabb: Aabb6 = [0, 0, 0, 200, 3, 50];
    const dxMeters = pctDistanceToMeters([0, 0], [10, 0], aabb);
    const dzMeters = pctDistanceToMeters([0, 0], [0, 10], aabb);
    expect(dxMeters).toBeCloseTo(20);
    expect(dzMeters).toBeCloseTo(5);
  });
});

describe("buildRouteSegments", () => {
  function resolved(node_: NavNode, worldPos: [number, number, number], floorKey: string): ResolvedRouteNode {
    return { node: node_, worldPos, floorKey };
  }

  it("puts same-floor consecutive nodes into normal segments", () => {
    const path = [
      resolved(node("a", [0, 0]), [0, 0, 0], "floor-1"),
      resolved(node("b", [1, 0]), [1, 0, 0], "floor-1"),
    ];
    const { normal, transitions } = buildRouteSegments(path);
    expect(normal).toEqual([{ from: [0, 0, 0], to: [1, 0, 0] }]);
    expect(transitions).toHaveLength(0);
  });

  it("puts a floor change into transitions as a vertical riser at the first point's XZ", () => {
    const path = [
      resolved(node("a", [0, 0]), [5, 0, 5], "floor-1"),
      resolved(node("b", [0, 0]), [5, 3, 5], "floor-2"),
    ];
    const { normal, transitions } = buildRouteSegments(path);
    expect(normal).toHaveLength(0);
    expect(transitions).toEqual([{ from: [5, 0, 5], to: [5, 3, 5] }]);
  });
});

describe("segmentsToLineSetArrays", () => {
  it("flattens segments into positions/indices pairs", () => {
    const { positions, indices } = segmentsToLineSetArrays([
      { from: [0, 0, 0], to: [1, 1, 1] },
      { from: [2, 2, 2], to: [3, 3, 3] },
    ]);
    expect(positions).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("returns empty arrays for no segments", () => {
    expect(segmentsToLineSetArrays([])).toEqual({ positions: [], indices: [] });
  });
});

describe("buildRouteMarkers", () => {
  function resolved(node_: NavNode, worldPos: [number, number, number], floorKey = "floor-1"): ResolvedRouteNode {
    return { node: node_, worldPos, floorKey };
  }

  it("returns an empty array for an empty route", () => {
    expect(buildRouteMarkers([], { path: [], totalDistance: 0, floorTransitions: [] })).toEqual([]);
  });

  it("always marks the first and last node as start/end", () => {
    const path = [resolved(node("a", [0, 0]), [0, 0, 0]), resolved(node("b", [1, 0]), [1, 0, 0])];
    const route: RouteResult = { path: path.map((r) => r.node), totalDistance: 1, floorTransitions: [] };
    const markers = buildRouteMarkers(path, route);
    expect(markers).toEqual([
      { pos: [0, 0, 0], kind: "start" },
      { pos: [1, 0, 0], kind: "end" },
    ]);
  });

  it("adds a transition marker for nodes named in route.floorTransitions", () => {
    const a = node("a", [0, 0], { floor_fm_guid: "f1" });
    const b = node("b", [0, 0], { floor_fm_guid: "f2" });
    const c = node("c", [1, 0], { floor_fm_guid: "f2" });
    const path = [resolved(a, [0, 0, 0], "f1"), resolved(b, [0, 3, 0], "f2"), resolved(c, [1, 3, 0], "f2")];
    const route: RouteResult = {
      path: [a, b, c],
      totalDistance: 5,
      floorTransitions: [{ nodeId: "b", fromFloor: "f1", toFloor: "f2" }],
    };
    const markers = buildRouteMarkers(path, route);
    expect(markers).toEqual([
      { pos: [0, 0, 0], kind: "start" },
      { pos: [1, 3, 0], kind: "end" },
      { pos: [0, 3, 0], kind: "transition" },
    ]);
  });
});

describe("inferStepFloors", () => {
  it("attributes every step to the route's starting floor until a floor-change step advances it", () => {
    const route: RouteResult = {
      path: [node("a", [0, 0], { floor_fm_guid: "f1" }), node("c", [1, 0], { floor_fm_guid: "f2" })],
      totalDistance: 0,
      floorTransitions: [],
    };
    const steps: IndoorStep[] = [
      { instruction: "Walk", distance: 1, coordinates: [0, 0], type: "walk" },
      { instruction: "Take the elevator", distance: 0, coordinates: [0, 0], type: "elevator", floorChange: { fromFloor: "f1", toFloor: "f2" } },
      { instruction: "Arrived", distance: 0, coordinates: [1, 0], type: "arrive" },
    ];
    expect(inferStepFloors(route, steps)).toEqual(["f1", "f1", "f2"]);
  });

  it("returns null floors when the route has no starting floor", () => {
    const route: RouteResult = { path: [node("a", [0, 0])], totalDistance: 0, floorTransitions: [] };
    const steps: IndoorStep[] = [{ instruction: "Arrived", distance: 0, coordinates: [0, 0], type: "arrive" }];
    expect(inferStepFloors(route, steps)).toEqual([null]);
  });
});
