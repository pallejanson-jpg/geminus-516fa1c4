# Phase 4 findings — xeokit license status & SDK dependency feasibility

Per Phase 4 of `docs/plans/viewer-coordinator-spec-and-prompts.md`. This is a report only —
no production behavior was changed for items 1 or 2 below (item 3, the Ivion SDK
consolidation, was implemented; see the end of this doc).

---

## Item 1 — xeokit-sdk commercial license status: no evidence of one, needs an off-repo check

**Nothing in the repository indicates a commercial xeokit-sdk license has been procured.**
Everything checked points to the plain public AGPLv3 build:

- `public/lib/xeokit/xeokit-sdk.es.js` (the loaded bundle, v2.6.112) has no license text,
  no "AGPL" or "commercial" string, and no license-key check anywhere in the file — only
  a version/build banner at the top. The only license strings inside the 5MB bundle belong
  to vendored third-party utilities (probe.gl, loaders.gl, pako, meshoptimizer,
  streaming-iterables, sindresorhus/file-type — all MIT — plus one LGPL notice for a
  vendored laz-perf module), none of which are xeokit-sdk's own license.
- `package.json`/lockfiles only reference `@xeokit/xeokit-convert@1.3.1` — a separate,
  MIT-licensed conversion library, not the AGPL viewer SDK. There is no
  `@xeokit/xeokit-sdk` entry anywhere.
- No `XEOKIT_LICENSE`/`XEOKIT_KEY`/`VITE_XEOKIT_*`-shaped environment variable exists in
  `.env` or anywhere under `supabase/`.
- `docs/3D_viewer_package.md` never mentions licensing at all.

**This can't be fully resolved from the repo.** Whether Geminus/SWG holds an off-repo
commercial agreement (a contract or invoice with the xeokit vendor) is a business
question — someone needs to check outside of code. If no such agreement exists, the
AGPLv3 network clause is relevant: self-hosting a modified xeokit build and exposing it
to users can create an obligation to offer the modified source to those users. This
needs a decision from whoever owns that relationship before more investment goes into
owning the xeokit integration long-term — I'm not making that call, just surfacing what's
verifiable.

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
