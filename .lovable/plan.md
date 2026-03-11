

# Analysis: ACC OBJ Pipeline Proposal

## Critical Issue — OBJ Stalls on Large Models

Your existing code at line 2008 of `acc-sync` has this comment:

```text
// Use SVF-only (no OBJ which stalls large models at 99%)
// SVF2 is not supported for all designs (406 error), so we use SVF
```

The proposal requests `svf2 + obj` from Model Derivative. This directly contradicts a known production issue you already solved — **OBJ export hangs at 99% for large Revit models**. SVF2 also returns 406 for some designs.

## Architecture Mismatch

The spec describes a **Node.js monorepo** (packages/extractor CLI, Express server, pnpm workspaces, Jest). Lovable is React + Supabase — no Node CLI, no Express, no filesystem access. The concept must be adapted:

| Spec component | Lovable equivalent |
|---|---|
| `packages/extractor` CLI | Edge function `acc-obj-extract` |
| `apps/api` Express | Actions in `acc-sync` edge function |
| `CDN_BASE` filesystem | Supabase Storage (`xkt-models` bucket) |
| `packages/viewer` React app | Enhance existing `NativeXeokitViewer` |
| `packages/common` types | Shared TypeScript types in `src/lib/types.ts` |
| Jest tests | Vitest (already configured) |

## What Actually Works from This Proposal

The **manifest-driven chunk loading** concept is sound and aligns with your existing `useFloorPriorityLoading` hook. The manifest schema and geometry_index schema are well-designed. The priority-based loading (active floor → adjacent → rest) is already implemented for XKT.

## Recommended Approach

Instead of fighting the OBJ stall issue, use the geometry you already get:

1. **SVF → extract geometry per storey** (you already parse SVF metadata in `extractBimHierarchy`)
2. **Convert to GLB per storey** (not monolithic OBJ) using the existing `bim-to-gltf` function pattern
3. **Store with the manifest schema** from the proposal
4. **Load via GLTFLoaderPlugin** (better xeokit support than OBJLoaderPlugin)

This gives you the same end result (per-storey chunks, manifest-driven loading, no IFC dependency) without hitting the OBJ stall problem.

## Implementation Plan (if you want to proceed)

### Phase 1: Save the plan document
Create `docs/plans/acc-obj-pipeline-plan.md` with the full spec for reference.

### Phase 2: Adapt to working formats
1. **DB migration** — add `format` column to `xkt_models` (`'xkt' | 'glb' | 'obj'`)
2. **New edge function `acc-geometry-extract`** — downloads SVF derivatives, extracts per-storey geometry, converts to GLB chunks, stores in `xkt-models` bucket with manifest.json
3. **Manifest + geometry_index** — stored as JSON in storage per the proposed schemas
4. **Viewer update** — `NativeXeokitViewer` checks for manifest, loads GLB chunks via `GLTFLoaderPlugin` with priority ordering

### Phase 3: OBJ as optional format
Add OBJ output as a **secondary format** for small models or FM Access consumers, but not as the primary pipeline due to the stall risk.

## My Recommendation

Save the plan document now, then implement using GLB instead of OBJ as the chunk format. The manifest schema, chunking logic, and viewer integration from the proposal are all reusable — only the geometry format changes. Do you want me to save the document and start with this adapted approach?

