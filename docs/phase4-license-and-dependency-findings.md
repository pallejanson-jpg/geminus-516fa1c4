# Phase 4 findings — xeokit license status & SDK dependency feasibility

Per Phase 4 of `docs/plans/viewer-coordinator-spec-and-prompts.md`. This is a report only —
no production behavior was changed for items 1 or 2 below (item 3, the Ivion SDK
consolidation, was implemented; see the end of this doc).

---

## Item 1 — xeokit-sdk commercial license status: CONFIRMED — commercial agreement in place

**Resolved by Pål (2026-08-21): Geminus/SWG holds a commercial xeokit-sdk license.**
The `public/lib/xeokit/xeokit-sdk.es.js` bundle in this repo was downloaded directly
from the vendor's (access-gated, commercial-customer) GitHub repository for use in this
project — it is not the public AGPLv3 distribution. This supersedes the "needs an
off-repo check" finding below, which is kept for context on what was verifiable from
the repo alone before this was confirmed.

Everything checked in the repo was consistent with either the AGPLv3 or a commercial
build (the file itself carries no license banner either way — only a version/build
banner), so there was no repo-level evidence either confirming or ruling out a
commercial license:
- `public/lib/xeokit/xeokit-sdk.es.js` (v2.6.112) has no license text, no "AGPL" or
  "commercial" string, and no license-key check anywhere in the file. The only license
  strings inside the 5MB bundle belong to vendored third-party utilities (probe.gl,
  loaders.gl, pako, meshoptimizer, streaming-iterables, sindresorhus/file-type — all
  MIT — plus one LGPL notice for a vendored laz-perf module), none of which are
  xeokit-sdk's own license.
- `package.json`/lockfiles only reference `@xeokit/xeokit-convert@1.3.1` — a separate,
  MIT-licensed conversion library, not the viewer SDK. There is no `@xeokit/xeokit-sdk`
  npm entry anywhere.
- No `XEOKIT_LICENSE`/`XEOKIT_KEY`/`VITE_XEOKIT_*`-shaped environment variable exists in
  `.env` or anywhere under `supabase/`.

**Practical effect of the confirmation:** the AGPLv3 network-clause concern (self-hosting
a modified build and having to offer source to users) no longer applies — a commercial
license was procured specifically to avoid that. This doesn't change the technical
recommendation in Item 2 below (that's a regression-risk question, not a legal one), but
it does remove the licensing blocker on eventually adopting xeokit-sdk as a proper,
versioned dependency instead of the current fetch+Blob-URL runtime load.

## Item 2 — Adopting xeokit-sdk as an npm dependency: feasible for the live path, but not implemented this round

**The "viewer stays mounted across mode changes" constraint is safe either way.**
`NativeViewerShell`/`NativeXeokitViewer` is keyed only on the building GUID in
`UnifiedViewer.tsx`, not on `viewMode` — switching between 2d/3d/split/vt only changes
CSS (width/opacity/z-index), never unmounts the viewer. An npm-based import wouldn't
change that.

**But the loading mechanism is more fragmented than a single hook to swap out.** There
are **five independent places** that load `xeokit-sdk.es.js` at runtime, with
inconsistent caching:
- `useXeokitInstance.ts` — fetch → Blob → dynamic `import()`, caches the result on
  `window.__xeokitSdk` (this is what the live `NativeXeokitViewer` path uses).
- `SplitPlanView.tsx` — reads the same `window.__xeokitSdk` cache, falls back to its own
  import if missing.
- `MinimapPanel.tsx` and `GeminusView.tsx` — **each does its own import with no cache
  check at all**, meaning either can pull in a second independent copy of the ~5MB
  bundle if `useXeokitInstance` hasn't populated the cache yet.
- `GeminusPlusViewer.tsx` — loads from the **public jsdelivr CDN**
  (`@xeokit/xeokit-sdk/dist/...`), not the local file at all. This is the dead Vue-shim
  branch (Phase 0 confirmed `shouldUseNative3D` is hardcoded `true`), so this path
  shouldn't execute in production — but I haven't independently re-verified that for
  `MinimapPanel.tsx`/`GeminusView.tsx`/`SplitPlanView.tsx` specifically in this pass.

**Why I'm not making the swap now:** doing this safely means first confirming which of
those five call sites are actually live vs. dead (so dead ones can just be deleted
instead of migrated), and I have no way to load-test the 3D viewer end-to-end in this
session (no login credentials, no live building/XKT data). This is exactly the kind of
change Del C.5 in the plan already calls out as its own separate initiative
("Ingen xeokit-versionsuppgradering samtidigt som synklogiken byggs om") — a loading
mechanism change to the core rendering engine, touching every viewer page load, carries
real regression risk I can't verify from here. If you want to proceed, the next step
would be confirming liveness of those five call sites, then migrating them one at a
time with manual verification in a real browser session against real building data.

---

## Item 3 — Ivion SDK lifecycle consolidation (implemented)

`src/hooks/useIvionSdk.ts`'s own doc comment said it was meant to replace the duplicated
SDK-loading/token-refresh logic in `Ivion360View.tsx` — but that consolidation was never
finished; `Ivion360View.tsx` still had its own independent copy (own `fetchLoginToken`,
own load effect, own 10-minute refresh interval vs. the hook's 8-minute one).

`Ivion360View.tsx` now uses `useIvionSdk` for loading/auth/token-refresh/`<ivion>` element
lifecycle, keeping only what's genuinely specific to that component: the CSS
UI-scaling injection, mobile sidebar-hiding, initial-heading-from-Street-View
application, and a "connected" toast (now fired once per successful connect via a ref
guard, since the hook doesn't expose "loginToken vs. manual login" — the toast text lost
that one distinction, kept the more common case's wording).

One behavior a plain hook-swap would have silently changed: `useIvionSdk` stays in
`'idle'` status (rather than transitioning to `'failed'`) when `baseUrl`/`siteId` aren't
both set — a real case here, since `ivionSiteId` can be empty even when `ivionUrl` is
present. The old inline code always attempted a load and ended in `'ready'`/`'failed'`,
so it never had this gap. Fixed by treating `'idle'` the same as `'failed'` for the
iframe-fallback rendering once past the initial "no URL at all" guard — otherwise a
building with a URL but no site ID would show a blank pane instead of falling back to
the iframe.

**Files changed:** `src/components/viewer/Ivion360View.tsx`.
**Verified:** `tsc --noEmit` clean, full test suite (93/93) unaffected, lint shows the
same 4 pre-existing issues as before the change (0 new) — confirmed by re-reading the
original file's content earlier in this session rather than by diffing lint output.
