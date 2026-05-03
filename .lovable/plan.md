## Four bugs to fix (Småviken size discrepancy added)

### 1. Color Filter (Area) → all xrayed, nothing colored

Console proof:
```
[ViewerEvents] INSIGHTS_COLOR_UPDATE: room_spaces 907 entries, 0 matched
Applied area color filter: 907 rooms, 7 entity matches
```
Akerselva loaded only the B-modell fallback (8.76 MB, mostly VVS). B-models contain virtually no `IfcSpace` entities, so the colorize loop in `useViewerEventListeners.ts` finds 0 matches — but `setObjectsXRayed(scene.objectIds, true)` (line 153) still xrays everything → ghost building.

**Fix in `src/hooks/useViewerEventListeners.ts`** (`INSIGHTS_COLOR_UPDATE` handler):
- Run the colorize pass first into a buffer.
- Only call `setObjectsXRayed(...)` when `matchCount > 0`.
- When `matchCount === 0`, restore visibility, log a warning, and emit a toast: "No spaces in loaded model — the architectural model is required for the Area filter."
- Broaden the room cache lookup: when an entry in `colorMap` doesn't match any IfcSpace metaObject, fall back to matching `mo.name` against the room name registry (`__roomNameRegistry`) before giving up.

### 2. Småviken — never loads, app crashes (mobile GPU OOM)

`sync-xkt-building` returns 4 models totalling ~117 MB:
- A-modell 8.5 MB (suspicious — see bug #4)
- B-modell 1.84 MB
- E-modell 53.05 MB
- V-modell 53.38 MB

`MAX_SINGLE_MODEL_BYTES = 30 MB` skips the in-memory cache for E/V, but they still get loaded into the WebGL scene by `useModelLoader`. On mobile (current viewport 314×434, devicePixelRatio 3) ~116 MB of geometry blows the GPU → ViewerErrorBoundary trips.

**Fix:**
1. `src/hooks/useModelLoader.ts` `loadAllModels`: when `isMobile` is true, force `secondaryQueue = []` (A-only) and never auto-promote secondary models. Surface a toolbar action "Load engineering models" that opts in on demand.
2. Add a memory guard in the same function: before pushing each secondary model to the scene, sum `viewer.scene.models[*].numEntities` × heuristic byte cost; abort with toast if estimated total exceeds 60 MB on mobile / 150 MB on desktop.
3. In `src/components/viewer/NativeXeokitViewer.tsx` add a `webglcontextlost` listener that destroys all secondary models from the scene, clears `__xeokitNativeColors`, and surfaces a "Reload with architectural model only" recovery button (instead of the generic boundary).

### 3. Akerselva — red/uncolored objects after fallback load

Console: `Native model colors preserved. 16343 total entities`. `applyArchitectColors()` is imported in `NativeXeokitViewer.tsx` (line 18) but **never called** in the load path. When only the B-modell loads (A-modell 404), VVS pipes/unmapped IFC types render in xeokit's raw red default.

**Fix:**
1. In `src/components/viewer/NativeXeokitViewer.tsx` after line 209: sample the loaded scene; if any of the following is true, call `applyArchitectColors(viewer)` automatically:
   - More than 5% of entities have `colorize` undefined or approximately `[1, 0, 0]`.
   - No A-model loaded (only B/E/V/secondary disciplines present in `viewer.scene.models`).
2. Extend `IFC_TYPE_COLORS` in `src/lib/architect-colors.ts` with technical-system types currently falling back to `DEFAULT_COLOR`:
   - `ifcpipesegment`, `ifcpipefitting`, `ifcductsegment`, `ifcductfitting`
   - `ifcflowterminal`, `ifcairterminal`, `ifcsanitaryterminal`
   - `ifccablesegment`, `ifccarriersegment`, `ifcelectricappliance`, `ifclightfixture`
   Use muted technical palette: pipes/copper `[0.65, 0.55, 0.45]`, ducts `[0.70, 0.72, 0.74]`, electrical `[0.85, 0.78, 0.55]`.

### 4. Småviken A-modell file size collapse (8.51 MB ≠ correct)

Edge function logs from two consecutive sync runs of the same building:
```
Run @1777787537 → Model 042dba20  (A-modell) Downloaded 29.84 MB via bimobjectid=042dba20
Run @1777787608 → Model 486c162d  (A-modell) Downloaded  8.51 MB via bimobjectid=042dba20
```
Asset+ returned **two different `model_id`s** for the same A-modell on consecutive `GetAllRelatedModels` calls, but the XKT download used the *same* `bimobjectid=042dba20`. The second run got a much smaller (likely older or mismatched) revision and the system silently overwrote the good 29.84 MB file with the 8.51 MB one. Result: Småviken's "A-modell" in the cache is now a stale/partial version. This matches the existing `mem://constraints/smaviken-xkt-404-issue` pattern.

**Fix in `supabase/functions/asset-plus-sync/index.ts`** (`sync-xkt-building`):
1. Before calling `GetXktData`, look up any prior cached row in `xkt_models` matching either `model_id` OR `bimobjectid` for this building. Capture `previous_size`.
2. After download, if `new_size < previous_size * 0.5` (more than 50% shrinkage) AND no Asset+ revision number changed, **reject the update**, keep the previous file, log `WARN: XKT shrinkage detected (29.84MB → 8.51MB) — keeping previous revision`, and continue.
3. Add a `model_alias` column (or store in `attributes` JSONB) so we map `486c162d → 042dba20` for future revisions of the same logical A-modell. Use `bimobjectid` as the stable identity, not `model_id`.
4. Emit the rejection event into `sync_events` so the SyncProgressCard reports it.

This complements Asset+'s existing `bimObjectId` fallback identifier protocol (see `mem://integrations/asset-plus/xkt-sync-identifier-protocol`) by adding *integrity validation* on the response.

## Technical notes

Files touched:
- `src/hooks/useViewerEventListeners.ts` — defer xray; broaden room name lookup; toast when 0 matches
- `src/hooks/useModelLoader.ts` — mobile A-only mode; memory guard before secondary
- `src/components/viewer/NativeXeokitViewer.tsx` — auto architect colors when raw red detected; webglcontextlost recovery
- `src/lib/architect-colors.ts` — VVS / electrical / duct IFC type colors
- `src/components/viewer/ViewerToolbar.tsx` — mobile "Load engineering models" button
- `supabase/functions/asset-plus-sync/index.ts` — XKT shrinkage rejection + bimobjectid identity reconciliation

Memory updates after implementation:
- Update `mem://integrations/asset-plus/xkt-sync-identifier-protocol` with the size-shrinkage guard rule.
- Update `mem://constraints/smaviken-xkt-404-issue` to note the model_id-shuffle root cause.

## Out of scope

- Akerselva ARK-modell 404 from Asset+ stays unresolved (still waiting for the Asset+ web viewer URL/HAR you mentioned). This plan makes the B-modell fallback render correctly and warns the user that Area filter needs the A-model — it does NOT recover the missing A-model itself.
