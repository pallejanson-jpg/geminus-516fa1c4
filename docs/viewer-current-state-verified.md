# Viewer current-state verification (Phase 0)

Verified against the actual code in `C:\MDP\GEMINUS` on 2026-08-20. This supersedes Del A of
`docs/plans/viewer-coordinator-spec-and-prompts.md` where marked CORRECTED below. No files were
changed in this phase — read-only investigation only.

Runtime behavior that can't be observed from static code (actual NavVis SDK load success/failure
in a live browser, measured Ivion latency) is marked COULD NOT VERIFY, with what's needed to check it.

---

## Del A.1 — Camera sync

**Two parallel implementations — CONFIRMED**, with one important correction to the "broken link" claim.

- Split View: `ViewerSyncContext` + `useViewerCameraSync` (xeokit → context) + `useIvionCameraSync`
  (Ivion → context, polls `getMainView().getImage()`/`currViewingDir` every
  `SYNC_POLL_INTERVAL_MS = 200`). CONFIRMED — [useIvionCameraSync.ts:69,235](../../src/hooks/useIvionCameraSync.ts).
- Virtual Twin: `useVirtualTwinSync.ts`, separate, one-directional (Ivion drives, xeokit follows),
  own `requestAnimationFrame` loop, own thresholds (`0.01` rad vs Split View's `0.05` rad). CONFIRMED.
- Coordinate transform `src/lib/ivion-bim-transform.ts`, Y-rotation + XYZ translation, sourced from
  `building_settings.ivion_bim_offset_x/y/z` + `ivion_bim_rotation`, written by
  `AlignmentPanel.tsx:94-97` and read by `ivion-bim-transform.ts:118-127`. CONFIRMED.

**"Misstänkt trasig länk" — CORRECTED (not currently broken, but fragile).**

Del A's claim was that `useViewerCameraSync.ts`'s `$refs.AssetViewer.$refs.assetView.viewer` lookup
has no fallback to `window.__nativeXeokitViewer`, so Split View sync would silently fail against the
native viewer. In the actual code this doesn't happen, because
[`NativeViewerShell.tsx:551-608`](../../src/components/viewer/NativeViewerShell.tsx) builds a
**deliberate compatibility shim** the moment the native xeokit viewer is ready:

```ts
const assetViewShim = { viewer, /* ...other Geminus-Plus-shaped methods... */ };
const assetViewerShim = { $refs: { assetView: assetViewShim }, onShowSpacesChanged, onToggleAnnotation, ... };
viewerShimRef.current = { $refs: { AssetViewer: assetViewerShim }, assetViewer: assetViewerShim };
(window as any).__geminusPlusViewerInstance = viewerShimRef.current;
(window as any).__nativeXeokitViewer = viewer;
```

`viewer` here is the same real xeokit `Viewer` instance in both places. `UnifiedViewer.tsx:503-512`
polls `window.__geminusPlusViewerInstance` into `viewerInstanceRef`, which is exactly the ref passed
to `useViewerCameraSync({ viewerRef: viewerInstanceRef, ... })` at `UnifiedViewer.tsx:609`. So
`viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer` **does** resolve to the
live xeokit viewer today — Split View camera sync is not silently dead via this path.

**Caveat worth carrying into Phase 1:** both hooks depend on this shim's exact shape as an implicit,
undocumented contract. If `NativeViewerShell.tsx`'s shim structure ever changes without updating
`useViewerCameraSync.ts`/`useVirtualTwinSync.ts` in lockstep, they'll fail silently (every call site
wraps the lookup in `?.` chains or try/catch that swallow the miss). This is exactly the kind of
fragility `ViewerCoordinator`/`XeokitViewerAdapter` should remove by talking to
`window.__nativeXeokitViewer` directly instead of through the shim.

**Other bugs — all CONFIRMED as described:**
- Shared debounce flag between sync directions: `useIvionCameraSync.ts`'s single `isSyncingRef` is
  set by the outgoing path (`syncToIvionSdk`) and checked by the incoming path (`pollPosition`), so a
  slow outgoing sync can suppress incoming updates. [useIvionCameraSync.ts:96,187,263](../../src/hooks/useIvionCameraSync.ts)
- Heading not normalized to [0,360): confirmed no wrapping is applied anywhere in
  `useIvionCameraSync.ts`, `useViewerCameraSync.ts`, or `useVirtualTwinSync.ts` — headings are passed
  through raw `atan`-derived degrees.
- `findNearestImage()` flat 50 m radius, no floor filter: confirmed literally,
  [useIvionCameraSync.ts:149-168](../../src/hooks/useIvionCameraSync.ts) (`return nearestDist < 50 ? ... : null`).
- Hardcoded safety-timeout patterns forcing `isSyncing.current = false` after a fixed delay:
  confirmed, e.g. [useViewerCameraSync.ts:160](../../src/hooks/useViewerCameraSync.ts) (2s),
  plus 300ms/100ms variants in `useIvionCameraSync.ts`.

---

## Del A.2 — POI/annotations

**No separate POI table — CONFIRMED.** Full inventory of the 8 named fields is in
"Field usage inventory" below; no `viewer_pois`/`poi_annotations` table exists anywhere in
`supabase/migrations/`.

**"Icke-modellerad asset" via created_in_model/is_local/annotation_placed/symbol_id +
geometry_entity_map — CONFIRMED, with one clarification.** `is_local` is not just a redundant
marker alongside `created_in_model` — it's load-bearing for a *different* concern: whether an asset
still needs pushing to Geminus Plus/Asset+ (used extensively across `geminus-plus-sync`,
`geminus-plus-update`, `geminus-plus-delete`, `imdf-export`). This doesn't contradict Del C.3 (which
only proposes phasing out `annotation_placed`, not `is_local`/`created_in_model`) — just flagging
that those two fields are sync-status bookkeeping, not spatial-origin classification, so they should
stay untouched by the `spatial_representation`/`location_accuracy` migration.

**`ivion-poi`'s `sync-asset` — CONFIRMED it doesn't update, CORRECTED on the failure mode.**
[`supabase/functions/ivion-poi/index.ts:327-331`](../../supabase/functions/ivion-poi/index.ts):

```ts
// If asset already has a POI ID, we'd update instead of create
// For now, just create new POIs
if (asset.ivion_poi_id) {
  return { success: true, poiId: asset.ivion_poi_id, message: 'Asset already synced' };
}
```

It's a **no-op** on repeat calls, not a duplicate-POI creator — so it's accidentally idempotent
today, but only because it silently does nothing rather than propagating any asset changes (renamed
asset, moved position) to the existing Ivion POI. Phase 2 item 4 (turn this into a real update) is
still exactly the right fix, just note the current failure mode is "stale POI data," not "duplicate POIs."

**Two annotation components with divergent filters — CONFIRMED, and the fragmentation is worse than
Del A described.** Found **three** different conditions in active use, not two:
- `AnnotationCategoryList.tsx:39` — `.or('annotation_placed.eq.true,asset_type.eq.IfcAlarm')`, reads via `viewerRef.current?.localAnnotationsPlugin`
- `AnnotationToggleMenu.tsx:74` — `.eq('annotation_placed', true)` only, reads via `viewer?.annotationsPlugin`
- `useViewerEventListeners.ts:578` and `ViewerFilterPanel.tsx:953` — a third variant,
  `.or('annotation_placed.eq.true,created_in_model.eq.false')`

Confirms the two different xeokit plugin references (`localAnnotationsPlugin` vs `annotationsPlugin`)
exactly as claimed. Phase 2's plan to collapse everything to one `symbol_id IS NOT NULL` condition and
one plugin reference is the right fix, and matters more than Del A implied — there are 3 divergent
filters to reconcile, not 2.

**`ViewerContext.completeAnnotationPlacement` discards coordinates — CONFIRMED literally:**
```ts
const completeAnnotationPlacement = useCallback((_coordinates: { x: number; y: number; z: number }) => {
  setAnnotationPlacementContext(null);
}, []);
```
[ViewerContext.tsx:177-179](../../src/context/ViewerContext.tsx) — parameter is underscore-prefixed and unused.

---

## Del A.3 — Libraries and license

- **xeokit-sdk confirmed NOT an npm dependency.** Loaded from
  `public/lib/xeokit/xeokit-sdk.es.js`, version banner confirms **v2.6.112**
  (commit `2ce58020`, built 2026-06-25). `package.json` only depends on the separate,
  MIT-licensed `@xeokit/xeokit-convert` (a conversion CLI/lib, not the viewer) — CONFIRMED distinction.
- No xeokit-sdk LICENSE file ships in `public/lib/xeokit/`. The `@license MIT` comments found inside
  `xeokit-sdk.es.js` belong to vendored third-party utilities (probe.gl, pako, loaders.gl,
  streaming-iterables) bundled *inside* xeokit-sdk, not to xeokit-sdk itself — CONFIRMED, no
  commercial license file or license key found anywhere in the codebase or referenced env vars.
- **COULD NOT VERIFY:** whether Geminus/SWG holds a commercial xeokit license outside the codebase
  (e.g. a contract/invoice) — that's not something grep can answer. Needs a business-side check,
  as Del B question 4 / Phase 4 already scope.
- NavVis Ivion SDK confirmed not an npm dependency either; `navvis-ivion-11.9.8.tgz` sits unused in
  the repo root, and the actual runtime bundle used is `public/lib/ivion/api.js` + `api.d.ts` — CONFIRMED.

---

## Del B — Open questions, answered

**1. Does `Ivion360View.tsx`/`ivion-sdk.ts` load a live SDK, or just an iframe?**

**Both — SDK-first with iframe fallback, not an either/or.** `loadIvionSdk()` in
[`ivion-sdk.ts:191-292`](../../src/lib/ivion-sdk.ts) tries, in order: (1) local bundle
`/lib/ivion/api.js` — which **exists** in this repo (`public/lib/ivion/api.js`, 13KB) so this attempt
should normally succeed; (2) a direct `<script>` tag against the customer's live Ivion instance;
(3) the same via the `ivion-proxy` CORS-proxy edge function. Only if all three fail does
`Ivion360View.tsx` fall back to the plain `<iframe src={ivionUrl}>` with `site`/`vlon`/`vlat` URL
params (`Ivion360View.tsx:627-636`, only rendered when `sdkStatus === 'failed'`).

When the SDK loads, it *does* expose live camera state exactly as `useIvionCameraSync.ts` and
`useVirtualTwinSync.ts` assume: `getMainView().getImage()` and `currViewingDir` are polled every
200ms/`requestAnimationFrame`, and `moveToImageId()` drives navigation the other way
(`ivion-sdk.ts:429-449`, `resolveMainView`/`resolveMoveTo`). **COULD NOT VERIFY:** whether the SDK
load actually *succeeds* in a live browser session against a real customer Ivion instance today
(needs manually opening the viewer and checking `sdkStatus`/console logs) — the local bundle being
present is necessary but not sufficient proof.

**2. Is the Vue `$refs.AssetViewer.$refs.assetView.viewer` path still reachable in production, or is `NativeXeokitViewer.tsx` the only viewer in use?**

**`NativeXeokitViewer.tsx` is the only viewer actually rendered. The Vue-shaped path is dead code, kept alive only as a compatibility shim.** Proof:

- `UnifiedViewer.tsx:688`: `const shouldUseNative3D = true;` — hardcoded, not a flag, not
  building-specific. The ternary at `UnifiedViewer.tsx:982-997` (`shouldUseNative3D ? <NativeViewerShell> : <GeminusPlusViewer>`) always takes the `NativeViewerShell` branch.
- `<GeminusPlusViewer>` (5391 lines, the component with the real `$refs.AssetViewer.$refs.assetView.viewer`-style Vue-shaped internals) is **only ever rendered from that one now-unreachable branch** — no other file renders it.
- There is no `vue` package in `package.json`, and `public/lib/assetplus/assetplusviewer.umd.min.js`
  (the actual proprietary Geminus Plus/Vue viewer bundle) is referenced from nowhere except
  `GeminusPlusViewer.tsx` itself.
- The `$refs` shape that's actually live in production is the **shim** `NativeViewerShell.tsx` builds
  (see Del A.1 correction above) — a plain object built in React/TS that happens to mimic the old Vue
  `$refs` shape so that legacy call sites (`useViewerCameraSync.ts`, and dozens of `$refs.AssetViewer...`
  reads still inside the dead `GeminusPlusViewer.tsx`) don't need to be rewritten yet.

**Implication for Phase 1:** `XeokitViewerAdapter` does **not** need to support two real viewer paths.
Build it directly against `window.__nativeXeokitViewer` (the real xeokit `Viewer`). There is no live
Vue wrapper to accommodate — only legacy call sites elsewhere in the codebase that still expect the
shim shape, which are out of scope for Phase 1 and can be migrated onto the new adapter later without
needing the adapter itself to speak two dialects.

**3. Is Virtual Twin mode (`useVirtualTwinSync.ts`) reachable from a real route, or dead/experimental?**

**Reachable, real, but not linked from any visible nav/menu — direct-URL/deep-link only.**
`/virtual-twin` is a registered, protected, lazily-loaded route (`App.tsx:28,107`).
`src/pages/VirtualTwin.tsx` immediately redirects to `/viewer?...&mode=vt`, which
`UnifiedViewer.tsx` handles as `viewMode === 'vt'` (`isVTMode`), enabling `useVirtualTwinSync`
(`UnifiedViewer.tsx:576-581`) and the ghost-opacity/ transparent-background rendering path through
`GeminusPlusViewer`'s props... **except** `GeminusPlusViewer` is the dead branch (see Q2), so in VT
mode `UnifiedViewer.tsx` must be rendering `NativeViewerShell` with VT-specific overlay props instead.
Grep found **no in-app link/button pointing at `/virtual-twin`** — it appears to be reached only via
a shared/bookmarked URL (e.g. sent to a specific customer), not a discoverable UI entry point.
**COULD NOT VERIFY:** whether it's still actively used by any customer today, or a leftover
from a past pilot — that's a product/business question, not a code one.

**4. Commercial xeokit license or public AGPLv3?**

**COULD NOT VERIFY** in code — see Del A.3. No license key, no commercial-license reference,
no LICENSE file bundled. This needs a human to check contracts/invoices with xeokit's vendor.

**5. How important is multi-user (same session, multiple people) short-term?**

Not a code question — **COULD NOT VERIFY**, needs a product decision. Nothing in the current
codebase implements or scaffolds multi-user camera sharing (confirmed no WebSocket server, no
session-sharing code found).

**6. Actual NavVis Ivion latency (is 200ms real or a guess)?**

**COULD NOT VERIFY** without running the app against a live customer Ivion instance and measuring.
The `200`/`SYNC_POLL_INTERVAL_MS` and `IFRAME_SYNC_THROTTLE_MS = 2000` constants in
`useIvionCameraSync.ts:69-70` have no comment or citation tying them to a measurement — treat as an
unverified guess, consistent with Del A's framing.

---

## Field usage inventory (supports Del C.3 migration planning)

Full file:line inventory of every read/write of `assets.created_in_model`, `assets.is_local`,
`assets.annotation_placed`, `assets.ivion_poi_id`, `assets.coordinate_x/y/z`,
`geometry_entity_map`, `building_settings.ivion_bim_offset_x/y/z`, `building_settings.ivion_bim_rotation`
was compiled across `src/` and `supabase/functions/`. Headline points relevant to Phase 2 planning:

- **`created_in_model`** and **`is_local`** are both far more heavily used than Del A.2 implied —
  each has 15-20+ read/write sites, spanning the Excel import, Ivion registration, mobile
  quick-registration, AI-scan approval, IFC/xkt conversion, and the entire Geminus Plus sync job.
  Both should be left alone by the Del C.3 migration (they're sync/provenance bookkeeping, not the
  POI/annotation classification `symbol_id`/`spatial_representation` is meant to replace).
- **`annotation_placed`** has ~20 read/write sites across 3 *different* filter conditions (see Del
  A.2 above) — more churn than Del A suggested, but confirms the plan to collapse to
  `symbol_id IS NOT NULL` is the right call.
- **`ivion_poi_id`**: the not-idempotent `sync-asset` gap is confirmed at
  `supabase/functions/ivion-poi/index.ts:329-331` exactly as described above.
- **`coordinate_x/y/z`** also exist as separate columns on `pending_detections` (the AI-scan review
  queue table) — distinct from `assets.coordinate_x/y/z`. Any migration/rename plan for `assets`
  needs an explicit decision on whether `pending_detections` needs parallel treatment or is
  considered ephemeral/out of scope (it's a transient review queue, so likely out of scope, but flag
  this explicitly in Phase 2 rather than silently ignoring it).
- **`geometry_entity_map`** had a real production bug already fixed in a recent migration
  (`20260819120000_fix_geometry_entity_map_conflict_target.sql` — deduped rows and replaced the
  unique index/conflict target), referenced as an open follow-up risk in
  `docs/plans/viewer-sync-losningsforslag.md:246`. Worth a quick sanity check in Phase 2 that the new
  `spatial_transforms` table's `unique (building_fm_guid, version)` constraint doesn't run into a
  similar conflict-target issue under concurrent writes.
- **`ivion_bim_offset_x/y/z`/`ivion_bim_rotation`**: only 2 real call sites each (write:
  `AlignmentPanel.tsx`, read: `ivion-bim-transform.ts` + `useBuildingViewerData.ts`) — this is the
  smallest, cleanest migration target in the whole set, consistent with Del C.3's plan to fold these
  into `spatial_transforms` version 1.
- A standalone root-level script `sync-service.js` (outside `src/`/`supabase/functions/`) also writes
  `created_in_model` — outside the two directories Del A/C scoped, but touches the same column. Not
  urgent, just flagging so it isn't missed if `created_in_model`'s meaning changes later.

(Full per-field file:line lists are available in the Explore-agent transcript from this session if needed for the actual Phase 2 migration write-up; omitted here for length.)

---

## Summary for Phase 1

- Build `XeokitViewerAdapter` directly against `window.__nativeXeokitViewer`. No dual-path support needed — the Vue/`$refs` path is dead code (Q2).
- Build `IvionViewerAdapter` against the real `IvionApi` (`getMainView()`, `currViewingDir`, `moveToImageId`, `pov.onChange`) with the existing iframe fallback preserved as a degraded mode, per Q1.
- Preserve the `window.__nativeXeokitViewer` / `window.__geminusPlusViewerInstance` globals during migration (per Del C.5's explicit "temporary bridge" allowance) — don't rip out `NativeViewerShell.tsx`'s shim until `useViewerCameraSync.ts`/`useVirtualTwinSync.ts` are actually migrated onto `ViewerCoordinator`.
- Fix the shared-`isSyncingRef` and missing-heading-normalization bugs as part of building `SpatialReferenceService` (Del C.2), since Phase 1's spec already calls for normalizing heading "in exactly one place."
- Floor-aware `findNearestImage` (Del C.1's floor-awareness requirement) has a clear, single call site to fix: `useIvionCameraSync.ts:149-168`.
