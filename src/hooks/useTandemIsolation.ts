import { useCallback, useRef, useState } from 'react';

const WALL_TYPES = new Set(['ifcwall', 'ifcwallstandardcase', 'ifccurtainwall']);
const DOOR_WIN_TYPES = new Set([
  'ifcdoor', 'ifcwindow', 'ifcdoorstandardcase', 'ifcwindowstandardcase',
  'ifcdoorpanel', 'ifcwindowpanel',
]);
export const SPACE_TYPES = new Set(['ifcspace', 'ifcspacevirtualboundary']);
const SLAB_TYPES = new Set(['ifcslab', 'ifcslabstandardcase', 'ifcslabelementedcase']);
const ALWAYS_HIDE_TYPES = new Set(['ifccovering', 'ifcroof', 'ifcrooftype']);
const BOUNDARY_TYPES = new Set([...WALL_TYPES, ...DOOR_WIN_TYPES]);

// Generous tolerance for detecting bounding walls (covers thick exterior walls)
const WALL_TOL = 1.0;
// Furniture/fixture containment — centroid must be this far inside the space boundary
const FIXTURE_INSET = 0.10;
const BACKDROP_Y_OFFSET = -0.48;
const CEILING_PLANE_ID = '__isolation_ceiling_clip';

type EntitySnap = {
  visible: boolean;
  colorize: number[] | null;
  opacity: number;
  offset: number[];
  xrayed: boolean;
  pickable: boolean;
};

export type SpaceLabel = {
  id: string;
  name: string;
  worldPos: [number, number, number];
};

function collectNodeIds(node: any, scene: any, out: Set<string>) {
  if (!node) return;
  if (scene.objects?.[node.id]) out.add(node.id as string);
  for (const child of node.children || []) collectNodeIds(child, scene, out);
}

export function useTandemIsolation() {
  const [isolatedSpaceId, setIsolatedSpaceId] = useState<string | null>(null);
  const isolatedSpaceIdRef = useRef<string | null>(null);
  const [isolatedSpaceName, setIsolatedSpaceName] = useState<string | null>(null);
  const [backdropLabels, setBackdropLabels] = useState<SpaceLabel[]>([]);
  const snap = useRef(new Map<string, EntitySnap>());
  const preCam = useRef<{ eye: number[]; look: number[]; up: number[]; proj: string } | null>(null);

  const saveSnap = useCallback((entity: any, id: string) => {
    if (snap.current.has(id)) return;
    snap.current.set(id, {
      visible: entity.visible ?? true,
      colorize: entity.colorize ? [...entity.colorize] : null,
      opacity: entity.opacity ?? 1,
      offset: entity.offset ? [...entity.offset] : [0, 0, 0],
      xrayed: entity.xrayed ?? false,
      pickable: entity.pickable ?? true,
    });
  }, []);

  const restoreSnap = useCallback((scene: any) => {
    snap.current.forEach((s, id) => {
      const e = scene.objects?.[id];
      if (!e) return;
      e.visible = s.visible;
      try { e.colorize = s.colorize ?? null; } catch {}
      e.opacity = s.opacity;
      try { e.offset = [...s.offset]; } catch {}
      e.xrayed = s.xrayed;
      e.pickable = s.pickable;
    });
    snap.current.clear();
  }, []);

  const destroyCeilingPlane = useCallback((scene: any) => {
    try { scene.sectionPlanes?.[CEILING_PLANE_ID]?.destroy(); } catch {}
  }, []);

  const isolate = useCallback((spaceId: string, viewer: any) => {
    if (!viewer?.scene) return;
    const scene = viewer.scene;
    const metaObjects: Record<string, any> = viewer.metaScene?.metaObjects || {};

    const isReIsolate = isolatedSpaceIdRef.current !== null && isolatedSpaceIdRef.current !== spaceId;
    if (isReIsolate) {
      restoreSnap(scene);
      destroyCeilingPlane(scene);
    }

    const spaceEntity = scene.objects?.[spaceId];
    if (!spaceEntity?.aabb) return;
    const spaceMeta = metaObjects[spaceId];
    const sa = spaceEntity.aabb as number[];
    const [sx0,,sz0,sx1,,sz1] = sa;

    // ── Step 1: Save snapshot of ALL entities BEFORE touching anything ───────
    const allIds: string[] = [];
    try {
      const ids = scene.objectIds;
      if (Array.isArray(ids)) allIds.push(...ids);
      else allIds.push(...Object.keys(scene.objects || {}));
    } catch {
      allIds.push(...Object.keys(scene.objects || {}));
    }

    for (const id of allIds) {
      const e = scene.objects?.[id];
      if (e) saveSnap(e, id);
    }

    // ── Step 2: BATCH hide + clear x-ray for everything ─────────────────────
    // Using xeokit's batch APIs (same pattern as applyArchitectColors).
    // This is the authoritative fix for lingering x-ray / ghosted geometry.
    try { scene.setObjectsVisible(allIds, false); } catch {}
    try { scene.setObjectsXRayed(allIds, false); } catch {}

    // ── Step 3: Collect room entity IDs ─────────────────────────────────────

    const roomIds = new Set<string>([spaceId]);

    // IFC spatial children — boundary types always included; fixtures only if inside space
    if (spaceMeta?.children) {
      const stack = [...spaceMeta.children];
      while (stack.length) {
        const n = stack.pop();
        if (!n) continue;
        if (n.children?.length) stack.push(...n.children);
        if (!scene.objects?.[n.id]) continue;
        const nt = (n.type || '').toLowerCase() as string;
        if (ALWAYS_HIDE_TYPES.has(nt)) continue;
        if (BOUNDARY_TYPES.has(nt)) {
          roomIds.add(n.id as string);
        } else {
          const ce = scene.objects[n.id];
          if (!ce?.aabb) { roomIds.add(n.id as string); continue; }
          const ca = ce.aabb as number[];
          const centX = (ca[0] + ca[3]) / 2;
          const centZ = (ca[2] + ca[5]) / 2;
          if (centX >= sx0 + FIXTURE_INSET && centX <= sx1 - FIXTURE_INSET &&
              centZ >= sz0 + FIXTURE_INSET && centZ <= sz1 - FIXTURE_INSET) {
            roomIds.add(n.id as string);
          }
        }
      }
    }

    // Bounding walls & doors/windows by AABB proximity — check both metaObjects
    // and scene.objects directly to handle any ID mismatches in the model
    const addIfBounding = (eid: string, etype: string, eaabb: number[]) => {
      if (roomIds.has(eid) || ALWAYS_HIDE_TYPES.has(etype)) return;
      if (!BOUNDARY_TYPES.has(etype)) return;
      const [wx0,,wz0,wx1,,wz1] = eaabb;
      if (wx0 <= sx1 + WALL_TOL && wx1 >= sx0 - WALL_TOL &&
          wz0 <= sz1 + WALL_TOL && wz1 >= sz0 - WALL_TOL) {
        roomIds.add(eid);
      }
    };
    for (const mo of Object.values(metaObjects) as any[]) {
      const t = (mo.type || '').toLowerCase() as string;
      if (!BOUNDARY_TYPES.has(t)) continue;
      const e = scene.objects?.[mo.id];
      if (e?.aabb) addIfBounding(mo.id as string, t, e.aabb as number[]);
    }
    for (const id of allIds) {
      const e = scene.objects?.[id];
      if (e?.aabb) addIfBounding(id, (metaObjects[id]?.type || '').toLowerCase(), e.aabb as number[]);
    }

    // Floor slab (nearest below space, same storey)
    let storeyId: string | null = null;
    let p: any = spaceMeta?.parent;
    while (p) {
      if ((p.type || '').toLowerCase() === 'ifcbuildingstorey') { storeyId = p.id; break; }
      p = p.parent;
    }
    if (storeyId) {
      let best: { id: string; dist: number } | null = null;
      for (const mo of Object.values(metaObjects) as any[]) {
        if (!SLAB_TYPES.has((mo.type || '').toLowerCase())) continue;
        const e = scene.objects?.[mo.id];
        if (!e?.aabb) continue;
        if ((e.aabb as number[])[4] > sa[1] + 0.5) continue;
        let inStorey = false;
        let sp: any = mo.parent;
        while (sp) { if (sp.id === storeyId) { inStorey = true; break; } sp = sp.parent; }
        if (!inStorey) continue;
        const dist = sa[1] - (e.aabb as number[])[4];
        if (!best || dist < best.dist) best = { id: mo.id, dist };
      }
      if (best) roomIds.add(best.id);
    }

    // ── Step 4: Collect same-storey space IDs for 2D backdrop ───────────────
    const sameStoreyIds = new Set<string>();
    if (storeyId && metaObjects[storeyId]) {
      collectNodeIds(metaObjects[storeyId], scene, sameStoreyIds);
    }

    // Save camera before first isolation
    if (!isReIsolate) {
      preCam.current = {
        eye: [...viewer.camera.eye],
        look: [...viewer.camera.look],
        up: [...viewer.camera.up],
        proj: viewer.camera.projection,
      };
    }

    // ── Step 5: Apply rendering — ONLY to entities we want visible ───────────
    // Everything else stays hidden from the batch operation in step 2.

    const labels: SpaceLabel[] = [];

    // Show selected space — Tandem blue glass
    const spaceE = scene.objects?.[spaceId];
    if (spaceE) {
      spaceE.visible = true;
      spaceE.colorize = [0.55, 0.72, 0.95];
      spaceE.opacity = 0.22;
      try { spaceE.edges = true; } catch {}
      spaceE.xrayed = false;
      spaceE.pickable = false;
    }

    // Show room entities (walls, doors, fixtures, floor slab)
    for (const entityId of roomIds) {
      if (entityId === spaceId) continue;
      const e = scene.objects?.[entityId];
      if (!e) continue;
      const mo = metaObjects[entityId];
      const t = (mo?.type || '').toLowerCase() as string;
      if (ALWAYS_HIDE_TYPES.has(t)) continue; // ceiling covers always hidden

      if (SLAB_TYPES.has(t)) {
        e.visible = true;
        e.colorize = [0.90, 0.90, 0.88];
        e.opacity = 1;
        try { e.edges = false; e.offset = [0, -0.02, 0]; } catch {}
        e.xrayed = false;
        e.pickable = false;
      } else {
        e.visible = true;
        try { e.colorize = null; } catch {}
        e.opacity = 1;
        try { e.edges = true; } catch {}
        e.xrayed = false;
        e.pickable = DOOR_WIN_TYPES.has(t) || (!WALL_TYPES.has(t) && !SLAB_TYPES.has(t));
      }
    }

    // Show same-storey backdrop spaces — solid flat grey (true 2D plan look)
    for (const entityId of (storeyId ? sameStoreyIds : Object.keys(scene.objects || {}))) {
      if (roomIds.has(entityId) || entityId === spaceId) continue;
      const e = scene.objects?.[entityId];
      if (!e) continue;
      const mo = metaObjects[entityId];
      const t = (mo?.type || '').toLowerCase() as string;
      if (!SPACE_TYPES.has(t)) continue;

      e.visible = true;
      e.colorize = [0.86, 0.86, 0.83];
      e.opacity = 1.0; // solid — looks like flat 2D plan, no ghost/xray effect
      try { e.edges = false; } catch {}
      e.xrayed = false;
      e.pickable = true;
      try {
        const o: number[] = e.offset ? [...e.offset] : [0, 0, 0];
        e.offset = [o[0], o[1] + BACKDROP_Y_OFFSET, o[2]];
      } catch {}
      if (e.aabb && mo?.name) {
        const aabb = e.aabb as number[];
        labels.push({
          id: entityId,
          name: mo.name as string,
          worldPos: [(aabb[0] + aabb[3]) / 2, aabb[1] - 0.35, (aabb[2] + aabb[5]) / 2],
        });
      }
    }

    setBackdropLabels(labels);

    // ── Step 6: Ceiling section plane — open top so you can see into the room ─
    const cx = (sa[0] + sa[3]) / 2;
    const cz = (sa[2] + sa[5]) / 2;
    const floorY = sa[1];
    const ceilY = sa[4];
    // Clip at 80% of room height — above door/window heads, below ceiling slab
    const clipY = floorY + (ceilY - floorY) * 0.80;

    try {
      const SectionPlane =
        (window as any).__xeokitSectionPlaneClass ||
        (window as any).__xeokitSdk?.SectionPlane;
      if (SectionPlane) {
        destroyCeilingPlane(scene);
        new SectionPlane(viewer.scene, {
          id: CEILING_PLANE_ID,
          pos: [cx, clipY, cz],
          dir: [0, 1, 0], // clips everything above clipY
          active: true,
        });
      }
    } catch {}

    // ── Step 7: Camera fly ───────────────────────────────────────────────────
    const r = Math.max(sa[3] - sa[0], sa[5] - sa[2]) * 1.8;
    const midY = (floorY + ceilY) / 2;
    const el = (38 * Math.PI) / 180;
    const az = Math.PI / 4;

    viewer.camera.projection = 'perspective';
    try {
      viewer.cameraFlight?.flyTo({
        eye: [
          cx + r * Math.cos(el) * Math.cos(az),
          midY + r * Math.sin(el),
          cz + r * Math.cos(el) * Math.sin(az),
        ],
        look: [cx, midY, cz],
        up: [0, 1, 0],
        duration: isReIsolate ? 0.5 : 0.7,
      });
    } catch {}

    isolatedSpaceIdRef.current = spaceId;
    setIsolatedSpaceId(spaceId);
    setIsolatedSpaceName((spaceMeta?.name as string) || null);
  }, [saveSnap, restoreSnap, destroyCeilingPlane]);

  const exit = useCallback((viewer: any, opts?: { restoreCamera?: boolean }) => {
    if (!viewer?.scene || !isolatedSpaceIdRef.current) return;
    restoreSnap(viewer.scene);
    destroyCeilingPlane(viewer.scene);
    if ((opts?.restoreCamera ?? true) && preCam.current) {
      const c = preCam.current;
      viewer.camera.projection = c.proj;
      try { viewer.cameraFlight?.flyTo({ eye: c.eye, look: c.look, up: c.up, duration: 0.5 }); } catch {}
    }
    preCam.current = null;
    setBackdropLabels([]);
    isolatedSpaceIdRef.current = null;
    setIsolatedSpaceId(null);
    setIsolatedSpaceName(null);
  }, [restoreSnap, destroyCeilingPlane]);

  return { isolatedSpaceId, isolatedSpaceIdRef, isolatedSpaceName, backdropLabels, isolate, exit };
}
