import { describe, it, expect } from "vitest";
import { findRoomMetaObject, buildRoomChildrenMap, computeRoomCentroid } from "@/lib/room-centroid";

function makeViewer(metaObjects: Record<string, any>, objects: Record<string, any>) {
  return {
    metaScene: { metaObjects },
    scene: { objects },
  };
}

describe("findRoomMetaObject", () => {
  it("finds an IfcSpace by GUID, ignoring case and dashes", () => {
    const room = { id: "room-1", type: "IfcSpace", originalSystemId: "AAAA-BBBB-1234" };
    const wall = { id: "wall-1", type: "IfcWall", originalSystemId: "CCCC-DDDD-5678" };
    const viewer = makeViewer({ "room-1": room, "wall-1": wall }, {});

    expect(findRoomMetaObject(viewer, "aaaabbbb1234")).toBe(room);
  });

  it("ignores non-IfcSpace objects even if the GUID matches", () => {
    const wall = { id: "wall-1", type: "IfcWall", originalSystemId: "CCCC-DDDD-5678" };
    const viewer = makeViewer({ "wall-1": wall }, {});

    expect(findRoomMetaObject(viewer, "cccc-dddd-5678")).toBeNull();
  });

  it("returns null when the room GUID does not exist", () => {
    const viewer = makeViewer({}, {});
    expect(findRoomMetaObject(viewer, "not-there")).toBeNull();
  });

  it("returns null when no room GUID is given", () => {
    const viewer = makeViewer({ "room-1": { id: "room-1", type: "IfcSpace", originalSystemId: "x" } }, {});
    expect(findRoomMetaObject(viewer, null)).toBeNull();
  });
});

describe("computeRoomCentroid", () => {
  it("falls back to the room's own AABB center when it has no child geometry", () => {
    const room = { id: "room-1" };
    const objects = { "room-1": { aabb: [0, 0, 0, 10, 3, 4] } };
    const viewer = makeViewer({ "room-1": room }, objects);

    expect(computeRoomCentroid(viewer, room)).toEqual({ x: 5, y: 0, z: 2 });
  });

  it("uses a weighted centroid of child entities instead of the raw AABB center for an L-shaped room", () => {
    // The room's own AABB spans a large L-shape, but the real furniture/geometry
    // sits in the narrow leg — the raw AABB center (5, 2) would land in empty
    // space. This is the exact room-label bug the algorithm was written to fix.
    const room = { id: "room-1" };
    const metaObjects = {
      "room-1": room,
      "child-1": { id: "child-1", parent: { id: "room-1" } },
      "child-2": { id: "child-2", parent: { id: "room-1" } },
    };
    const objects = {
      "room-1": { aabb: [0, 0, 0, 10, 3, 4] }, // raw center would be (5, 2)
      "child-1": { aabb: [0, 0, 0, 2, 3, 2] }, // center (1, 1)
      "child-2": { aabb: [0, 0, 2, 2, 3, 4] }, // center (1, 3)
    };
    const viewer = makeViewer(metaObjects, objects);

    expect(computeRoomCentroid(viewer, room)).toEqual({ x: 1, y: 0, z: 2 });
  });

  it("prefers a provided children map over scanning metaObjects", () => {
    const room = { id: "room-1" };
    // No parent/child relationships in metaObjects at all — a fallback scan
    // would find zero children and fall back to the raw AABB center (5, 2).
    const metaObjects = { "room-1": room };
    const objects = {
      "room-1": { aabb: [0, 0, 0, 10, 3, 4] },
      "ghost-child": { aabb: [8, 0, 3, 8, 3, 3] }, // center (8, 3)
    };
    const viewer = makeViewer(metaObjects, objects);
    const map = new Map([["room-1", ["ghost-child"]]]);

    expect(computeRoomCentroid(viewer, room, map)).toEqual({ x: 8, y: 0, z: 3 });
  });

  it("returns null when the room entity has no geometry", () => {
    const room = { id: "room-1" };
    const viewer = makeViewer({ "room-1": room }, { "room-1": {} });
    expect(computeRoomCentroid(viewer, room)).toBeNull();
  });
});

describe("buildRoomChildrenMap", () => {
  it("groups metaObject ids by their parent id", () => {
    const metaObjects = {
      "room-1": { id: "room-1" },
      "child-1": { id: "child-1", parent: { id: "room-1" } },
      "child-2": { id: "child-2", parent: { id: "room-1" } },
      "unrelated": { id: "unrelated" },
    };

    const map = buildRoomChildrenMap(metaObjects);
    expect(map.get("room-1")).toEqual(["child-1", "child-2"]);
    expect(map.has("unrelated")).toBe(false);
  });
});
