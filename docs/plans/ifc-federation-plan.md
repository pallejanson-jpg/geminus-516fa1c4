# Plan: IFC Federation & Normalization Pipeline

## Summary

A new feature that takes multiple discipline IFC models (architecture, electrical, HVAC, plumbing, sprinkler, fire, etc.) for one building, reconciles their `IfcBuildingStorey` naming/identity against a canonical source, lets a human confirm the mapping in a matrix UI with a linked 3D viewer, validates/generates object-level FMGUIDs, and writes the corrected data back into each discipline's IFC file — without merging the files. Geminus Plus (Asset+) upload of the result is out of scope for v1; the existing upload path already handles that once files are clean.

This supersedes the earlier draft plan that assumed a separate Node.js server and a separate Revit add-in repo to port from. Neither exists — see "Corrected architecture assumptions" below.

## Corrected architecture assumptions

The original draft (produced without reading this repo) made two wrong assumptions:

1. **"A Geminus Node.js server, separate from the React/Supabase app."** Not quite — Geminus is one repo, one fully working, daily-used solution. Its backend logic runs in two places today: **Supabase Edge Functions (Deno)**, which is where most of it lives (ACC sync, FM Access sync, Geminus Plus create/sync, all IFC parsing), and **one standalone Node.js file**, [`sync-service.js`](../../sync-service.js), which handles Asset+ structure/asset sync (Keycloak auth, paginated upsert, no 60s wall-clock limit). Both are production code; nothing here is unfinished or broken. `SYNC_ARCHITECTURE.md`'s "three paths" section is a forward-looking design note about where *future* code could go — not a status report on the current app. The only real question for this plan is a placement choice for the *new* IFC federation code: another Deno edge function (60s limit) or a new file alongside `sync-service.js` (no limit). See the decision below.
2. **"Port the Revit add-in's (C#/.NET) Geminus Plus API client."** Wrong target — the FMGuid Revit add-in is a separate tool that writes FMGUIDs into Revit models before export; it has no Geminus Plus API client to port. The actual Geminus Plus push logic (Complex → Building → Model → Revision creation, Keycloak + APIKey auth) already exists in this repo, as Deno edge functions (`geminus-plus-create-building/index.ts`, `geminus-plus-sync/index.ts`) and is described in [`acc-ifc-to-assetplus-push-plan.md`](acc-ifc-to-assetplus-push-plan.md). It is written against `fetch`, the same pattern `sync-service.js` already uses locally — porting it to Node is a small, mechanical move, not a rewrite.

**Decision for this plan:** build the IFC federation pipeline as a new local Node.js module, alongside `sync-service.js` (e.g. `ifc-federation/` at repo root), not as another Deno edge function. Reasons:
- Multi-file IFC parsing + a global (cross-model) FMGUID uniqueness check will very plausibly exceed the edge function's 60-second wall-clock limit, the same problem that motivated `sync-service.js` to exist.
- The Asset+ push step this pipeline may eventually feed into is easiest to reuse if both live in the same runtime.

## UI decision (revised): standalone app, not a Geminus Tools tab

The pipeline modules (`ifc-federation/*.js`) were originally going to surface as a new tab inside `GeminusToolsView.tsx`, next to "Forma → Geminus Plus" and "IFC → Geminus Plus". **That plan changed.** The user wants colleagues to be able to run this independently, hosted on Render, and — deliberately — as its own product rather than folded into the main Geminus app, specifically so more such tools can be added later as their own pieces without growing into a pile of tabs in one app.

This is built as **[`ifc-federation-app/`](../../ifc-federation-app)** — a separate app living in this repo (so it can import the already-tested `../ifc-federation/*.js` modules directly, unchanged) but fully independent as a product: its own `package.json`, its own minimal React frontend (no shadcn/Tailwind dependency on the main app — a small hand-rolled UI, since porting the shadcn-based `StoreyReconciliationMatrix.tsx` would have meant dragging that whole dependency tree into a separate deployable), and its own Express backend wrapping Phases 1, 2, 4, 5, and 7 behind a small HTTP API (`/api/lookup-building`, `/api/ingest`, `/api/reconcile`, `/api/export`).

Today it runs as two local processes (`node server.js` + the Vite dev server) on the user's own machine — see [`ifc-federation-app/README.md`](../../ifc-federation-app/README.md) for exact commands. Moving it to Render is the next step, not yet done; the README documents what that move needs (replacing the in-memory session map with something that survives a restart, and serving the built client from Express so it's one deployable instead of two).

**Verified end-to-end, including the real browser UI** — not just the API. The Express endpoints were smoke-tested directly via `curl` (ingest → reconcile → export against the electrical/HVAC fixtures, producing an identical result to the CLI-based test done earlier), then the full flow was re-verified by driving the actual React client in a browser: injecting real `File` objects into the upload inputs (via `DataTransfer`, since this environment's remote browser can't drive a native OS file picker), clicking through Analysera → matrix render → Bekräfta mappning → Exportera, and confirming a `200 OK` network response on `/api/export`. One integration bug was caught and fixed in the process: `archiver`'s v8 release replaced its classic `archiver('zip', opts)` factory function with ES classes (`new ZipArchive(opts)`) — the server crashed on startup with the old API until this was corrected.

**Phase 6 (viewer) is intentionally not part of this app yet** — same reasoning as before (no real XKT data to build/verify against), called out explicitly in the app's own README as a fast-follow rather than silently dropped.

## Standalone app: real progress reporting, building-check UX, and configurable object-FMGUID handling

Three user-facing additions on top of the initial standalone-app build, driven by direct feedback from actually using it:

**1. Real, live progress bar (not a fake animation).** `/api/ingest` now returns a `jobId` immediately after upload and runs the actual work (canonical-storey resolution, matrix build, FMGUID validation) as a background job the client polls. Uploading itself is tracked client-side via real XHR byte-progress events; server-side processing is tracked via the same weighted-by-file-size approach already used for `onProgress` callbacks in Phase 2/4/5's modules. This surfaced a real, significant bug: **Node.js is single-threaded, so the fully-synchronous line-by-line parsing loops in `parseStoreys`/`parseElements` blocked the entire event loop** — confirmed in practice that the server couldn't even answer its own "how's it going?" polling endpoint while a large file was mid-parse, defeating the whole point of a progress bar. Fixed by adding a periodic `await setImmediate()` (via `node:timers/promises`) inside both hot loops, at the same ~100-times-per-file cadence as the existing progress callbacks — confirmed against the 289 MB / 4.18M-line real file that the server now stays responsive throughout the full ~90s of processing, with progress genuinely advancing rather than freezing. This required converting `parseStoreys`, `buildCanonicalStoreys`, `parseElements`, `validateFederation`, `getModelStoreys`, and `buildMatrix` to `async` functions — a real signature change, re-verified against the fixture regression suite (identical output before/after) and against `ingest-federation.js`'s CLI callers, which were updated to `await` them.

**2. "Kontrollera byggnad" pre-check.** The authority-hierarchy rule (Geminus Plus wins over an uploaded architect model whenever the building is found) already worked correctly, but was only visible *after* running a full analysis — pointless waiting if a large architect file was about to be uploaded for nothing. Added a button next to the building-ID field that calls `/api/lookup-building` immediately and shows "Hittad: Byggnad X (N våningar)" or "not found" before any file upload happens.

**3. Configurable object-FMGUID handling.** `repairFederation()` (Phase 5) gained a `{ regenerateAll: boolean }` option. Default (`false`, unchanged from before) respects any FMGUID an object already carries — only missing or duplicate ones are touched. `regenerateAll: true` mints a fresh FMGUID for every non-storey object unconditionally, for when the source files' existing FMGUIDs aren't trusted. Exposed in the app as a checkbox ("Generera om alla objekt-FMGUID"). Verified both modes against the electrical/HVAC fixtures: default kept Lamp A's pre-existing valid FMGUID untouched; `regenerateAll` replaced it along with everything else.

All three verified together in one live browser session (not just individually): building check, checkbox toggle, and a full analysis run that visibly showed a real "Validerar FMGUID… (architect) 69%" progress state mid-flight before completing.

## Business rules (unchanged from the original draft, confirmed correct)

1. **Authority hierarchy for storey identity:** if the building exists in Geminus Plus, Geminus Plus is the source of truth for storey names/FMGUIDs. If not, the uploaded architect model becomes the template.
2. **Storeys are the one entity type allowed to share an FMGUID** across discipline models (same physical floor = same FMGUID + same display name everywhere).
3. **Every non-storey object's FMGUID must be globally unique** across the whole federation. A duplicate is always an error to fix (re-mint), never legitimate, for v1.
4. **Models stay separate files** — this is federation, never a merge into one IFC.
5. **Generated FMGUIDs must be deterministic, derived from the object's own IfcGuid — never random.** Added after initial delivery, based directly on user feedback: if the same model is re-exported/redrawn later with the same IfcGuid on an object, the FMGUID generated for it must come out identical, or downstream systems (Geminus Plus and others) will treat it as a brand-new object instead of recognizing the one they already track. Implemented as [`ifc-federation/deterministic-guid.js`](../../ifc-federation/deterministic-guid.js) — UUID v5 (RFC 4122), a SHA-1 hash of a fixed namespace plus the IfcGuid, zero dependencies, zero state. This also happens to solve a problem the standalone app would otherwise have had: it has no database, so a lookup-table approach (`ifc_fmguid_map`-style, as `ifc-fmguid-prep/index.ts` uses) wasn't available to it anyway — derivation needs no persisted state at all. **Critical constraint:** the namespace UUID in `deterministic-guid.js` must never change once used against real data — doing so would silently change every derived FMGUID on every future re-upload, defeating the whole point with no error or warning. Verified end-to-end (not just unit-level): the same two fixture files run through the full `/api/ingest` HTTP flow twice produced byte-identical generated FMGUIDs both times, for both a canonical storey and an object-level element.

## Storey matching — auto-suggest, human confirms (clarified)

The original draft said "no auto-matching, pure manual." Clarified: auto-suggest is fine and should reuse logic already in the repo, but the result must always be shown as an editable suggestion in the matrix, never silently applied.

Reuse the existing reconciliation heuristic in [`ifc-extract-systems/index.ts:387-470`](../../supabase/functions/ifc-extract-systems/index.ts) (`reconcileGuids`, currently used silently for asset-level matching) as the basis, applied to storeys:

1. **FMGUID match first** — if a storey in an uploaded model already carries the same FMGUID as a canonical storey (e.g. re-upload, or a discipline that already got the right value), suggest that mapping with high confidence.
2. **Name-similarity fallback** — normalize both sides (strip whitespace/case, extract leading digits: "Floor 01" / "Plan 01" / "01" → `01`) and suggest the closest canonical match.
3. **No match found** — leave the cell unmapped, force explicit user action.

Every suggestion is pre-filled but editable in the matrix UI before write-back. Nothing is written to a file until the user confirms.

## Viewer — xeokit, not Fragments (clarified)

The original draft proposed introducing `@thatopen/fragments` + `web-ifc` as a new stack. Confirmed with the user: keep xeokit, which is already the production viewer technology.

- **Parsing**: `web-ifc` is already a runtime dependency in [`ifc-extract-systems/index.ts`](../../supabase/functions/ifc-extract-systems/index.ts) (line ~692) and its WASM binaries already ship in `public/lib/xeokit/`. No new parsing library needed.
- **Rendering**: extend the existing [`GeminusPlusViewer.tsx`](../../src/components/viewer/GeminusPlusViewer.tsx) / [`IfcColorLegend.tsx`](../../src/components/viewer/IfcColorLegend.tsx) to:
  - Load each discipline model as a separate object in one scene (xeokit already supports multiple loaded models side by side).
  - Per-discipline colour coding (reuse the legend component's existing colour-assignment pattern).
  - Highlight-in-focus / fade-others behavior tied to which matrix row/column is active.
  - Linked selection: matrix ↔ viewer, both directions.
- Drop `@thatopen/fragments` from the plan entirely — it would be a second, redundant IFC stack.

## What already exists vs. what's new

| Capability | Status | Where |
|---|---|---|
| Geminus Plus building/storey lookup, auth (Keycloak + APIKey) | **Exists** | `supabase/functions/geminus-plus-sync/index.ts`, `geminus-plus-create-building/index.ts` |
| IFC storey/space extraction | **Exists** | `supabase/functions/ifc-extract-systems/index.ts:167-220` |
| FMGUID presence check + generation (`crypto.randomUUID()`), per-file reuse via `ifc_fmguid_map` table | **Exists** | `supabase/functions/ifc-fmguid-prep/index.ts` |
| Auto-match heuristic (external_id → name+level → identity fallback) | **Exists, but silent/automatic** | `ifc-extract-systems/index.ts:387-470` (`reconcileGuids`) — needs to become a *suggestion* surfaced in UI, not an automatic decision |
| Storey FMGUID treated as intentionally-shared (vs. object FMGUIDs which must be unique) | **Missing** | needs new logic |
| Cross-model (federation-wide) FMGUID uniqueness check | **Missing** | today's uniqueness logic is per-file only |
| Reconciliation matrix UI | **Missing** | new |
| Multi-model federation viewer (per-discipline colour/fade/linked-select) | **Missing**, but viewer foundation (xeokit) exists | extend `GeminusPlusViewer.tsx` |
| Write-back of confirmed names/FMGUIDs into IFC files | **Missing** | `web-ifc` supports IFC writing; not yet used for this |
| Local Node.js module runtime (proven pattern) | **Exists (partial)** | `sync-service.js` — only covers Asset+ sync; this plan adds the IFC-federation module alongside it |
| Geminus Plus lookup (building + storeys) as a plain Node module | **Built and verified against live data** | [`ifc-federation/geminus-plus-lookup.js`](../../ifc-federation/geminus-plus-lookup.js) — see Phase 1 findings below |

## Phase plan

### Phase 1 — Geminus Plus lookup (reuse, wrap for Node) — done, verified against live data

Implemented as [`ifc-federation/geminus-plus-lookup.js`](../../ifc-federation/geminus-plus-lookup.js): a plain Node module (ESM, matching `sync-service.js`'s `"type": "module"` setup), reusing the same Keycloak auth + `PublishDataServiceGetMerged` call as `sync-service.js` and `geminus-plus-sync/index.ts`, callable directly with no `supabase.functions.invoke(...)` hop and no 60s limit. Exposes:

- `getBuildingByIdentifier(identifier)` → `{ fmguid, name }` or `null` (null = fall back to the architect model, Phase 2).
- `getStoreysForBuilding(buildingFmGuid)` → `[{ fmguid, name, sequence }]`.

Tested live against three real buildings (Byggnad 1 / 1 storey, Akerselva Atrium / 10 storeys, Småviken / 13 storeys). Findings that changed the implementation and are load-bearing for later phases:

1. **Building name field**: `designation` is frequently `null` on Building objects; `commonName` is the reliably populated display name (e.g. "Huvudkontor", "Byggnad 1"). The module now reads `commonName` first, `designation` as fallback.
2. **No fixed "elevation" field.** Per-object custom properties (e.g. "Elevation") are stored under a *dynamically hashed* key (e.g. `elevationA514DA1094CE1BD6B9267E8A0E3DF8736DA457A5`), not a stable field name — the module finds them generically by scanning for `{ name: "Elevation", ... }`.
3. **No reliable storey ordering exists at all.** Confirmed directly: Byggnad 1's storey carried an "Elevation" property, Akerselva Atrium's ten storeys carried none (only "Modell"/"Beskrivning" properties). `levelNumber` is *not* numeric either — it duplicates the text name (e.g. `levelNumber: "Plan 11"`), so it can't be used for ordering. **This is not a bug to fix — it directly confirms business rule 4 (no auto-matching by elevation/geometry).** `getStoreysForBuilding()` returns `sequence: null` whenever no such property exists and does a best-effort sort only (unranked storeys pushed last); the reconciliation matrix (Phase 4) must never treat `sequence` as a matching signal, only, optionally, as an initial display order.
4. **Storey names can be genuinely missing in Geminus Plus itself**, not just in uploaded IFC files — one of Småviken's 13 storeys had `levelName`, `commonName`, and `designation` all `null`. The reconciliation matrix must have a defined way to display/handle an "unnamed" canonical row (Phase 4), since this isn't just an IFC-side data quality issue to guard against — the canonical source itself can lack a name.

### Phase 2 — Architect model as template (fallback) — done, verified against a synthetic fixture

Implemented as [`ifc-federation/architect-model-template.js`](../../ifc-federation/architect-model-template.js). Ports `ifc-fmguid-prep/index.ts`'s STEP-text parsing (property name confirmed as `FmGuid`, not `FM_GUID` — line 204) near-verbatim, narrowed to `IFCBUILDINGSTOREY` entities only (object-level FMGUID handling for all product types stays where it already is, and gets extended cross-model in Phase 5). Note: this parser is plain regex/string based — it never used `web-ifc`, despite the original draft's assumption; nothing here needed the `web-ifc` runtime dependency `ifc-extract-systems` uses elsewhere.

Exposes `buildCanonicalStoreys(ifcText)` / `getArchitectStoreysFromFile(path)` → `[{ fmguid, name, sequence }]`, the same shape as Phase 1's `getStoreysForBuilding()`. `sequence` is always `null` here (no ordering signal exists in plain STEP text, consistent with Phase 1 finding 3 — no reliable elevation field exists in Geminus Plus either).

Verified against a hand-built two-storey fixture ([`ifc-federation/test-fixtures/sample-architect.ifc`](../../ifc-federation/test-fixtures/sample-architect.ifc)) with one storey carrying an existing `FmGuid` property and one without: the existing GUID was correctly reused, and a fresh UUID was generated for the storey missing one — matching the business rule exactly. **Caveat:** only tested against a synthetic fixture, not a real Revit/architect IFC export — the STEP grammar handled here (single-line entities, no line-continuation edge cases beyond what `ifc-fmguid-prep` already handles) should be re-verified against an actual exported file before relying on this for real buildings.

### Phase 3 — Multi-model ingestion (Node module) — done, verified end-to-end

Implemented as [`ifc-federation/ingest-federation.js`](../../ifc-federation/ingest-federation.js): a thin orchestration layer, not new parsing (the STEP-text parsing already lives in Phase 2 and Phase 5's modules; there was never a `web-ifc` dependency to introduce here — see Phase 2's note that the existing parsing is plain regex/string-based). `ingestFederation({ buildingIdentifier, architectFile, disciplineFiles })`:

1. Calls Phase 1's `getBuildingByIdentifier()` — if found, canonical storeys come from Phase 1's `getStoreysForBuilding()`.
2. If not found, requires an `architectFile` and falls back to Phase 2's `buildCanonicalStoreys()`.
3. Reads every discipline file once, feeds the same in-memory model list into Phase 4's `buildMatrix()` and Phase 5's `validateFederation()`.
4. Returns `{ canonicalSource, building, canonicalStoreys, matrix, guidValidation }` — everything a caller (an upload endpoint, or the eventual UI) needs in one call.

Verified end-to-end against the existing fixtures on **both** authority paths:
- **Architect-fallback path** (no Geminus Plus building given): canonical storeys built from `sample-architect.ifc`, matrix built against `sample-electrical.ifc` + `sample-hvac.ifc`, GUID validation run across all three. Produced the expected matrix (both discipline storeys `fmguid-match` against "Plan 01") and correctly re-surfaced the planted duplicate FMGUID between Lamp A and Duct A.
- **Geminus Plus authority path** (real building `c757f78f-…`, "Byggnad 1", live-looked-up per Phase 1): ran without error against the same synthetic discipline files. Its one real storey ("Plan 11") naturally didn't match the fixtures' fake storey names, and both correctly landed in `unmatched` rather than being force-matched — a useful negative-case confirmation that mismatched real/synthetic data doesn't get silently glued together.

**Notable integration-level finding** (not a bug): when the architect model is included as one of the matrix's own columns and one of its storeys had no `FmGuid` property in the source file, Phase 2 generates a fresh canonical FMGUID **in memory only** — it isn't written back into the file until Phase 7. Re-parsing that same architect file for the matrix therefore still sees no FMGUID on that storey and can only resolve it via `name-match`, not `fmguid-match`, even though it's the canonical source itself. This is correct and expected (write-back hasn't happened yet), but worth documenting clearly so it isn't mistaken for a matching bug when the UI is wired up — a canonical row can legitimately show anything less than fmguid-match confidence for its own source model, once, until the file is re-saved through Phase 7.

### Phase 4 — Storey reconciliation matrix — logic and table UI done, verified in-browser

**Logic** ([`ifc-federation/storey-reconciliation.js`](../../ifc-federation/storey-reconciliation.js), framework-agnostic):

- `buildMatrix(canonicalStoreys, models)` — canonical storeys as rows, uploaded models as columns. Each cell is filled via the two-step auto-suggest confirmed with the user: (1) FMGUID match against a canonical storey — highest confidence, e.g. a re-upload or a discipline that already carries the correct shared FMGUID; (2) normalized name similarity (`normalizeStoreyName`: lowercase, extract embedded digits, so "Floor 01" / "01 Etasje" / "02 - Sprinkler" all reduce to a comparable key) — lower confidence, still surfaced automatically. A model storey matching neither goes into `unmatched`, forcing an explicit manual decision instead of a guess.
- `applyReconciliation(matrix, overrides)` — takes the matrix plus only the cells the user changed from the suggestion, and returns the flat write-back list (`{ modelName, globalId, canonicalFmguid, canonicalName }`) that Phase 7 stamps into each file's `IfcBuildingStorey` entities. Un-overridden matched cells keep the matrix's suggestion; a matched cell explicitly unmapped by the user is excluded; and — a bug caught during UI testing, see below — a storey from `matrix.unmatched` that the user manually assigns via an override **is now also included**.
- Rows are display order only — no reliable sequence field exists (Phase 1 finding 3) — so the UI lets the user reorder rows manually if it matters, not infer an order.
- A canonical row with a `null` name (Phase 1 finding 4: happens for real in Geminus Plus, not just in IFC files) renders an explicit "Namnlös — behöver namn" state; correcting the canonical name inline is the primary way that gets fixed.

Logic verified with three cases, all matching the plan's rules: (1) FMGUID match — electrical and HVAC storeys sharing a storey FMGUID with the canonical architect storey both resolved via `fmguid-match`; (2) name-similarity fallback — a storey named "02 - Sprinkler" with no FMGUID property at all correctly resolved to canonical "Plan 02" via digit normalization, confidence `name-match`; (3) no-match case — a storey named "Takplan" with neither a matching FMGUID nor a numeric name correctly landed in `unmatched` rather than being force-matched.

**Table UI** ([`src/components/geminus-tools/StoreyReconciliationMatrix.tsx`](../../src/components/geminus-tools/StoreyReconciliationMatrix.tsx)), built with the app's existing component stack (shadcn `Table`/`Select`/`Badge`/`Input`, matching `IfcToGeminusPlusPanel.tsx`'s conventions) — pure presentational component, takes `matrix` as a prop (parsing stays server-side/Node) plus `onCanonicalNameChange` and `onConfirm(overrides)` callbacks:

- Canonical storeys as rows, models as columns; each cell shows the model's own storey name, a confidence badge ("FMGUID" / "Namnlikhet"), and a dropdown to override the suggestion or unmap it.
- Unnamed canonical rows show a destructive "Namnlös — behöver namn" badge with an inline-editable name field.
- A dedicated "Omatchade våningar" section lists every `matrix.unmatched` entry with its own dropdown to manually assign it to a canonical row.
- A confirm button shows a live count of currently-mapped cells and calls `onConfirm(overrides)`.

Verified by temporarily wiring the component to a mock matrix (same shape as the fixture-verified logic above) behind a throwaway route, and driving it in the actual dev server (not just reading the source): confirmed the FMGUID-match, name-match, and unnamed-row states all render as designed, edited a canonical name and confirmed via the checkmark button (fired `onCanonicalNameChange` with the right arguments), and — the one significant finding — used the "Omatchade våningar" dropdown to manually assign "Takplan" to "Plan 01". That override didn't show up in the confirm-count and, more importantly, `applyReconciliation()` silently dropped it from the write-back list, because it only ever walked `matrix.rows`/`cells` and never consulted `matrix.unmatched`. **Fixed**: `applyReconciliation()` now also processes `matrix.unmatched` entries that carry an explicit override, re-verified with a fixture reproducing the exact case (Takplan → Plan 01 now appears correctly in the write-back list). Without this fix, a user's manual rescue of an unmatched storey would have been silently ignored at write-back time — a real correctness bug, not a cosmetic one.

One inconclusive item from testing: pressing Enter inside the canonical-name edit field didn't commit the name (only the checkmark button did) during automated browser-tool testing. This looked like a browser-automation key-event quirk rather than a genuine handler bug (the `onKeyDown` code path is correct and the button path works reliably), but it's worth a quick manual keyboard check once this is wired into the real app, since Enter-to-confirm is a basic expected affordance.

The throwaway demo route/page used for this verification was removed after testing; only the reusable component and the fix to `storey-reconciliation.js` remain.

### Phase 5 — Object-level FMGUID validation (extend to cross-model) — done, verified against fixtures

Implemented as [`ifc-federation/federation-guid-validator.js`](../../ifc-federation/federation-guid-validator.js). Parses every discipline model with the same product-type allowlist and `FmGuid`-property detection as `ifc-fmguid-prep/index.ts` (all types, not just storeys — that's `architect-model-template.js`'s narrower job), then does the genuinely new part: builds one `FMGUID → [locations]` map **across every uploaded model**, storeys excluded. `validateFederation(models)` returns the full element list plus a `duplicates` report (each with the offending FMGUID and every `{ modelName, ifcType, globalId, name }` location); `repairFederation(result)` then generates FMGUIDs for elements missing one and re-mints every occurrence after the first for a duplicated (non-storey) FMGUID — storeys are left untouched, since their shared-FMGUID reconciliation belongs to Phase 4, not here.

Verified against three fixtures ([`ifc-federation/test-fixtures/`](../../ifc-federation/test-fixtures/)): an architect model plus a synthetic electrical model and HVAC model that (a) intentionally share a storey FMGUID between disciplines, the way real models should, and (b) accidentally share an object-level FMGUID between an electrical light fixture and an HVAC duct — a deliberately planted federation-wide collision that no single-file check would catch. Result matched every business rule exactly:
- The shared storey FMGUID was **not** flagged — correct, storeys are allowed to repeat.
- The planted cross-model object-level duplicate **was** flagged as a hard blocker, with both locations named.
- An element with no `FmGuid` property at all was correctly counted as missing.
- After `repairFederation()`, all non-storey elements had unique FMGUIDs.

**Caveat**, same as Phase 2: verified against hand-built STEP fixtures, not a real multi-discipline export — re-verify parsing against real files (especially real Revit/other-tool STEP formatting quirks) before relying on this for production data.

### Phase 6 — Viewer (xeokit extension) — done, scope narrowed deliberately; verified without real XKT data

**Built as a new, self-contained component, not an extension of `GeminusPlusViewer.tsx`.** That file is 5,000+ lines and tightly coupled to the single-building production viewer's DOM structure, event bus, and NavCube/section-plane scaffolding — extending it in place for a federation-specific workflow would have meant touching high-risk production code for a feature that doesn't need most of what it provides. Instead:

- [`src/components/geminus-tools/FederationViewer.tsx`](../../src/components/geminus-tools/FederationViewer.tsx) — bootstraps its own minimal xeokit `Viewer` + `XKTLoaderPlugin`, reusing the exact SDK-loading technique (`/lib/xeokit/xeokit-sdk.es.js`, cached on `window.__xeokitSdk`) and the same per-entity `.colorize` / `.xrayed` / `.opacity` API already used throughout `GeminusPlusViewer.tsx` (confirmed by grep against that file before writing this). Loads one discipline per model ID, tints each a distinct colour, and shows a per-discipline legend (visibility toggle) matching `IfcColorLegend.tsx`'s existing visual style.
- [`src/components/geminus-tools/FederationWorkspace.tsx`](../../src/components/geminus-tools/FederationWorkspace.tsx) — the matrix ↔ viewer link: hovering a model's column header in `StoreyReconciliationMatrix` (a new `onModelHover` prop) sets that model as "focused" in the viewer, which fades every other discipline (`xrayed = true`, reduced opacity) so misalignment between that discipline and the others is visually obvious.

**Scope deliberately narrowed to model-level linking, not object/storey-level**, matching what the plan's own stated purpose for this phase actually requires ("catch coordinate misalignment between discipline models") rather than building more than that purpose needs: highlighting a *specific object or storey* in 3D from a matrix row would require mapping each IFC GlobalId to its xeokit object ID, which none of Phases 1–5 currently produce (they operate on GlobalId/FMGUID, not xeokit's own internal object IDs) — a real feature, but a different and larger one than "does this discipline's geometry line up," which needs only model-level distinction. Documented as a clear "not built" rather than silently a gap.

**Verified without real XKT data — a genuine limitation of this test pass, not skipped carelessly.** No `.xkt` file existed for any of the real IFC test files used elsewhere in this plan (they were never run through the `ifc-to-xkt` conversion step); building/testing that conversion was out of scope for this session. What WAS verified live in the dev server:
- The component mounts, loads the real xeokit SDK successfully, and renders a canvas at the correct size within the workspace's grid layout.
- Pointed at two nonexistent `.xkt` URLs, `XKTLoaderPlugin` degraded gracefully — logged `"Unsupported .XKT file version"` to console rather than throwing, and the component still reached its "ready" state instead of hanging — good evidence the loading path doesn't crash on bad model data, though this specific behavior (silent degrade vs. surfacing a per-model error) hasn't been checked against a genuinely corrupt-but-real XKT file, only a nonexistent one.
- The matrix → viewer hover link works end-to-end: hovering the "electrical" column header in the matrix correctly applied `opacity-50` to every *other* discipline's legend entry (confirmed via DOM inspection), proving the full chain — matrix hover → React state → viewer prop → per-model fade — is wired correctly.

**Not yet verified:** actual 3D rendering and coordinate-misalignment detection against real geometry, since that requires real XKT files this session didn't have. That remains the concrete next verification step once XKT conversions of real discipline models are available.

### Phase 7 — Commit / export — done, verified end-to-end (round-trip)

Implemented as [`ifc-federation/ifc-writer.js`](../../ifc-federation/ifc-writer.js). No `web-ifc` write path used or needed — the whole pipeline has stayed plain STEP-text parsing since Phase 2, so writing back is done the same way: locate each entity by GlobalId, either overwrite an existing `FmGuid` property's value in place, or (if the element had no `FmGuid` property chain at all) append a new `IFCPROPERTYSINGLEVALUE` + `IFCPROPERTYSET` + `IFCRELDEFINESBYPROPERTIES` triplet wired to it, reusing the element's own OwnerHistory reference. Storey writes also overwrite the entity's Name attribute. `applyFederationWrites(ifcText, { storeyWrites, guidAssignments })` operates on one file at a time and returns the rewritten text plus a report (`storeysWritten`, `guidsWritten`, `guidsCreated`, `errors`).

Verified as a full round-trip against the electrical + HVAC fixtures, feeding this phase directly from Phase 4/5's real output (not hand-built inputs):
1. Ran Phase 4's `applyReconciliation()` (after renaming the canonical "Plan 01" to "Plan 01 (confirmed)", to prove name write-back) and Phase 5's `repairFederation()` (on the same planted Lamp A / Duct A duplicate and Lamp B's missing FMGUID) to get the real write instructions.
2. Applied them to each file via `applyFederationWrites()`.
3. **Re-parsed the written files** (not just eyeballed the text) with the same Phase 5 validator and Phase 2 storey parser used throughout.

Result: both files' storeys now read "Plan 01 (confirmed)" with the shared canonical FMGUID; Lamp B (previously missing) now carries a freshly created FmGuid property chain; the duplicate FMGUID was resolved by keeping the first occurrence (electrical's Lamp A) untouched and re-minting every later occurrence (HVAC's Duct A) — re-validating the output found `missing: 0` and `duplicateGroups: 0`. This confirms the write path produces files that are not just textually plausible but actually re-parse correctly and satisfy every business rule the earlier phases enforce.

**Scope confirmed as originally planned:** pushing the corrected models into Geminus Plus stays out of scope here — that's the existing upload path (and, later, the Asset+ push logic in `acc-ifc-to-assetplus-push-plan.md`). Wiring "validate → push to Asset+" as one flow remains a good candidate for a later chapter.

**Re-verified against real production files, and one real bug found and fixed in the process.** The user supplied four real discipline models for one building (NCC "Folkboende": architect 39 MB, structural 2.2 MB, two ventilation files 14 MB and 9.8 MB — 17,406 elements total, real Revit/simplebim exports, real base64 IFC GlobalIds). Running the full Phase 1→2→3→4→5→7 pipeline against them surfaced a genuine scalability bug that the small synthetic fixtures never could have caught:

- **Bug:** `ensureFmGuid()` re-scanned the *entire* entity list (and every `IFCRELDEFINESBYPROPERTIES` in it) for every single FMGUID write. On the 1,130-element structural file alone this made a full write pass effectively O(elements × entities) — confirmed to hang indefinitely (killed after 2+ minutes) rather than complete.
- **Fix:** `ifc-writer.js` now builds one set of indices up front (`byGlobalId`, `byLineId`, `relsByElementLineId` — see `buildIndex()`) before any writes happen, turning each write into an O(1)-amortized lookup instead of a full re-scan. Confirmed the fix doesn't change behavior by re-running the exact same electrical/HVAC fixture regression test from earlier and getting identical write reports.
- **Result after the fix, on the real 4-file federation:** reading all four files, building the matrix, validating, and writing every missing FMGUID back into all four files completed in **~32 seconds total** (the largest single file — ventilation, 7,374 newly created FMGUID property chains — took ~8.9s to write). Re-parsing all four written-back files confirmed `missing: 0` and `duplicateGroups: 0` across all 17,406 elements, and — the real payoff — **every one of the ten shared storeys carries an identical FMGUID across all four discipline files** (e.g. "Plan 10" resolved to the same UUID in the architect, structural, and both ventilation files), which is the core business rule working correctly on an actual multi-discipline dataset, not just a hand-built fixture.
- **Real-data observation, not a bug:** none of the four real files carried any `FmGuid` property at all before this ran (`hadFmguid: 0` initially) — confirming this is genuinely pre-FMGUID production data, exactly the situation the whole pipeline is designed for. All ten canonical storeys across the real building were also already named consistently across disciplines ("Plan 10"–"Plan 18", "Takplan"), so this particular dataset didn't exercise the name-mismatch/manual-reconciliation case Phase 4 is otherwise built for — that still only has synthetic-fixture coverage.

**Stress-tested against a much larger real federation (NCC "Jönköping Science Tower"): two more real bugs found and fixed, plus one real architectural limitation surfaced and left open.** Six real discipline files across architecture (2 files, up to 276 MB / 4.18M lines), electrical (3 files), and ventilation (1 file) — 126,504 elements total, ~6 million lines of IFC text combined. This dataset was an order of magnitude larger than the "Folkboende" test and immediately found problems the smaller one didn't reach:

1. **Bug (found first):** the same O(elements × entities) shape reappeared at a scale the first fix's testing hadn't reached — actually, the O(1)-indexed writer from the Folkboende fix held up fine here; the *new* failure was different: `outputLines.splice(insertAt, 0, ...newEntities.map(serializeEntity))` in `applyFederationWrites()` throws `RangeError: Maximum call stack size exceeded` once `newEntities` (brand-new property/pset/rel entities to insert) reaches roughly tens of thousands — `splice(...items)` passes each item as an individual call argument, which has an engine limit `concat` doesn't. Hit this on the very first attempt (architect file alone needed ~88,000 new entities, since it had zero pre-existing FmGuid properties). **Fixed** by replacing the spread-into-splice with `before.concat(newEntitiesSerialized, after)`, which takes whole arrays as arguments instead of spreading their contents onto the call stack.
2. **Bug (found second, more interesting):** re-running after fix #1, the pipeline completed (~170s, then ~240s on a clean re-run) but a discrepancy in `el_630`'s write counts (`guidsWritten: 2891` vs an expected-if-no-duplicates `guidsCreated`) led to investigating and confirming: **real IFC files can legitimately contain the same native GlobalId on two or more physically distinct entities** — confirmed 147 such pairs in `E-630-V-100.ifc` alone (two different `IFCFLOWTERMINAL` entities, different line numbers, identical GlobalId; this is technically non-conformant IFC per spec, but real exporters produce it). `ifc-writer.js`'s `buildIndex()` originally mapped `globalId -> single entity` (last-one-wins), which meant the "losing" entity of each pair silently received no `FmGuid` property at all — a real, silent data-loss bug, not hypothetical. **Fixed:** `byGlobalId` now maps to an array of entities, and `ensureFmGuid()`/`setName()` apply the same value to every entity sharing a GlobalId, so no entity is ever silently skipped. Verified directly against the 147-pair file: 0 non-storey elements missing `FmGuid` after the fix (down from confirmed data loss before it), and the two known-duplicate entities (`#108034`, `#131768`, GlobalId `3Qt0TOJpHFYRbJM5wJhc9w`) both ended up carrying the identical FMGUID `1d6148df-…`, as designed.
3. **Left open — a real architectural limitation, not a bug to patch reactively:** giving both entities in a duplicate-native-GlobalId pair the *same* FMGUID (fix #2's safe default) means they now legitimately trigger Phase 5's own duplicate-FMGUID detection on re-validation — confirmed: the final full re-parse found **530 duplicate FMGUID groups** across the federation, all traceable to this same root cause (native GlobalId collisions in the source files), not to any remaining bug in generation or writing. The deeper issue: every write instruction in this pipeline (Phase 4's `applyReconciliation()` output, Phase 5's `repairFederation()` output) is keyed by `globalId` alone, on the — usually true, but not IFC-spec-guaranteed — assumption that one GlobalId identifies exactly one physical entity. Properly resolving this (giving each duplicate-GlobalId sibling its own independent FMGUID when that's what's wanted) would need write instructions keyed by an entity-level reference instead of bare GlobalId, which touches Phase 4, Phase 5, and Phase 7 together — a real refactor, not a quick patch, and out of scope for this test pass. **Recommendation for a future session:** have Phase 5 distinguish and separately report "native GlobalId collision" (a source-file integrity problem, arguably needing its own UI treatment) from "assigned FMGUID collision" (this pipeline's own generation producing a duplicate, which is what business rule 3 was originally written to catch) — right now both surface identically as "duplicate FMGUID," which conflates two different problems with two different fixes.

**Performance at this scale, for reference:** reading all six files ~0.8s; parsing the 4.18M-line architect file's 18 canonical storeys ~14–25s; building the full 18×6 matrix ~19–36s; validating all 126,504 elements ~25–47s; writing every file back (creating ~126,000 new property/pset/rel triplets combined) ~17–90s per file depending on size; **total pipeline time ~170–240s** across two clean runs. No crash, no hang, after the two fixes above — confirming the pipeline is viable at real building scale, not just fixture scale, once these were caught.

**Caveat that still stands:** the writer reconstructs every touched entity as a single line, normalizing any multi-line-formatted entity to one line in the output — semantically valid STEP, but not a byte-identical diff of the original file. Not yet checked whether any of these four real files actually contained multi-line-formatted entities (they may not have — worth confirming before assuming this is fully proven against that specific edge case).

## Suggested build order

1. Phase 1 (Geminus Plus lookup wrapper) — thin wrapper over existing, working code.
2. Phase 2 (architect-model fallback) — mostly reuse of `ifc-fmguid-prep` + `ifc-extract-systems`.
3. Phase 5 (cross-model FMGUID uniqueness) — extends existing per-file logic, testable independently before the matrix UI exists.
4. Phase 4 (reconciliation matrix, table only, no viewer) — get write-back correct first.
5. Phase 6 (xeokit viewer extension, linked to matrix) — layer visual confirmation on top.
6. Phase 7 (commit/export via `web-ifc` write) — ties it together.

## Open items to confirm during implementation

- Whether Phase 1's Geminus Plus calls can stay on `supabase.functions.invoke(...)` (Path A) or need a native-Node port (Path B) for acceptable latency — decide per `SYNC_ARCHITECTURE.md`'s framework, not up front.
- Exact shape of the "location" reference used in Phase 5's duplicate-FMGUID report (file + IFC line/entity id) — needs to be useful enough for a user to find and fix the object.
- How the new Node module authenticates to Supabase (service_role key, per `SYNC_ARCHITECTURE.md` §2) if it needs write access beyond what `sync-service.js` already does.

## Status update (2026-08-31): IDS validation + reporting shipped

Beyond the seven phases above, a further validation layer has been built and shipped on top of the standalone `ifc-federation-app` — full detail in [`ids-validation-plan.md`](ids-validation-plan.md), summarized here:

- **IDS (buildingSMART Information Delivery Specification) validation**, wrapping `ifctester` (IfcOpenShell) as a Python subprocess, against a shared, Geminus-maintained rule library checked into the repo (`ifc-federation/ids-rules/*.ids`). This checks information requirements (naming, required properties, classifications, etc.) — complementary to, and independent of, the FMGUID handling in Phases 1–7 above.
- **BCF export** of failing checks, for opening directly in the projector/designer's own BIM tool.
- **A4 PDF report** (`ifc-federation-app/pdf-report.js`), Geminus-branded, green check/red cross per validated specification — a readable companion to the BCF file. Verified end-to-end against the running server.
- **The entire `ifc-federation-app` UI (and server-emitted job-status strings) is now in English**, not Swedish as originally built.
- Deliberately **not** built: a Revit-native/ODA-based IDS engine — decided against in favor of keeping "upload IFC here" as the primary flow, with any future Revit add-in calling this app's own `/api/validate-ids` API instead.
