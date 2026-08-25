import { describe, it, expect } from "vitest";
import { distributeAroundAnchor } from "@/lib/poi-cluster-layout";

describe("distributeAroundAnchor", () => {
  const anchor = { x: 10, y: 2, z: -5 };

  it("returns the anchor unchanged for zero or one point", () => {
    expect(distributeAroundAnchor(anchor, 0)).toEqual([anchor]);
    expect(distributeAroundAnchor(anchor, 1)).toEqual([anchor]);
  });

  it("spreads points evenly around the anchor at the given radius, preserving Y", () => {
    const points = distributeAroundAnchor(anchor, 4, 2);
    expect(points).toHaveLength(4);
    points.forEach((p) => {
      expect(p.y).toBe(anchor.y);
      const dist = Math.hypot(p.x - anchor.x, p.z - anchor.z);
      expect(dist).toBeCloseTo(2, 5);
    });
  });

  it("produces distinct points rather than stacking them on top of each other", () => {
    const points = distributeAroundAnchor(anchor, 5);
    const unique = new Set(points.map((p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`));
    expect(unique.size).toBe(5);
  });

  it("uses a default radius of 0.4m when omitted", () => {
    const [p] = distributeAroundAnchor(anchor, 2);
    const dist = Math.hypot(p.x - anchor.x, p.z - anchor.z);
    expect(dist).toBeCloseTo(0.4, 5);
  });
});
