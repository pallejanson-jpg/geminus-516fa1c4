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

## Business rules (unchanged from the original draft, confirmed correct)

1. **Authority hierarchy for storey identity:** if the building exists in Geminus Plus, Geminus Plus is the source of truth for storey names/FMGUIDs. If not, the uploaded architect model becomes the template.
2. **Storeys are the one entity type allowed to share an FMGUID** across discipline models (same physical floor = same FMGUID + same display name everywhere).
3. **Every non-storey object's FMGUID must be globally unique** across the whole federation. A duplicate is always an error to fix (re-mint), never legitimate, for v1.
4. **Models stay separate files** — this is federation, never a merge into one IFC.

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

### Phase 3 — Multi-model ingestion (Node module)
New Node module (repo root, alongside `sync-service.js`) that:
- Accepts N discipline IFC files for one building.
- Runs each through `web-ifc` (parsing) — same library already used server-side, now invoked from Node instead of Deno.
- Produces per-model storey lists and object lists ready for Phase 4/5.

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

**Not yet built:** the actual table UI component (React, per the rest of the app's stack) that renders `buildMatrix()`'s output, lets a user edit/override cells and canonical names, and calls `applyReconciliation()` on confirm. That's the remaining Phase 4 work before moving to Phase 3 (multi-model ingestion) and Phase 6 (viewer) per the build order.

### Phase 5 — Object-level FMGUID validation (extend to cross-model) — done, verified against fixtures

Implemented as [`ifc-federation/federation-guid-validator.js`](../../ifc-federation/federation-guid-validator.js). Parses every discipline model with the same product-type allowlist and `FmGuid`-property detection as `ifc-fmguid-prep/index.ts` (all types, not just storeys — that's `architect-model-template.js`'s narrower job), then does the genuinely new part: builds one `FMGUID → [locations]` map **across every uploaded model**, storeys excluded. `validateFederation(models)` returns the full element list plus a `duplicates` report (each with the offending FMGUID and every `{ modelName, ifcType, globalId, name }` location); `repairFederation(result)` then generates FMGUIDs for elements missing one and re-mints every occurrence after the first for a duplicated (non-storey) FMGUID — storeys are left untouched, since their shared-FMGUID reconciliation belongs to Phase 4, not here.

Verified against three fixtures ([`ifc-federation/test-fixtures/`](../../ifc-federation/test-fixtures/)): an architect model plus a synthetic electrical model and HVAC model that (a) intentionally share a storey FMGUID between disciplines, the way real models should, and (b) accidentally share an object-level FMGUID between an electrical light fixture and an HVAC duct — a deliberately planted federation-wide collision that no single-file check would catch. Result matched every business rule exactly:
- The shared storey FMGUID was **not** flagged — correct, storeys are allowed to repeat.
- The planted cross-model object-level duplicate **was** flagged as a hard blocker, with both locations named.
- An element with no `FmGuid` property at all was correctly counted as missing.
- After `repairFederation()`, all non-storey elements had unique FMGUIDs.

**Caveat**, same as Phase 2: verified against hand-built STEP fixtures, not a real multi-discipline export — re-verify parsing against real files (especially real Revit/other-tool STEP formatting quirks) before relying on this for production data.

### Phase 6 — Viewer (xeokit extension)
- Load all discipline models into `GeminusPlusViewer.tsx` simultaneously, one xeokit model per discipline.
- Per-discipline colour + visibility toggle (extend `IfcColorLegend.tsx`).
- Focus/fade behavior and matrix ↔ viewer linked selection.
- Primary purpose: catch coordinate misalignment between discipline models, which the data matrix alone can't reveal.

### Phase 7 — Commit / export
- Use `web-ifc`'s write path to stamp confirmed storey names/FMGUIDs (Phase 4) and object FMGUIDs (Phase 5) back into each discipline's original file.
- Output: same number of files as uploaded, cross-referenced via shared storey FMGUIDs and unique object FMGUIDs.
- Explicitly out of scope: pushing the corrected models into Geminus Plus. That's the existing upload path (and, later, the Asset+ push logic described in `acc-ifc-to-assetplus-push-plan.md`) — wiring "validate → push to Asset+" as one flow is a good candidate for a later phase once this pipeline is proven.

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
