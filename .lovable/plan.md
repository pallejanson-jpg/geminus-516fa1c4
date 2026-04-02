

# Geminus Digital Twin — Re-Evaluation Report (April 2, 2026 — End of Day)

This is a re-run of the comprehensive review you requested at 05:33 today, now reflecting all work completed since then.

---

## Status of Original Top 10 Critical Issues

| # | Original Issue | Status | Notes |
|---|---|---|---|
| 1 | **AppContext monolith (829 lines, 40+ vars)** | **FIXED** | Split into 4 domain contexts: `ThemeContext`, `NavigationContext`, `ViewerContext`, `DataContext`. AppContext is now a thin 267-line backward-compatible facade. |
| 2 | **NativeXeokitViewer god component (2,044 lines)** | **FIXED** | Decomposed into 323 lines + 3 composable hooks: `useXeokitInstance`, `useModelLoader`, `useViewerEventListeners`. |
| 3 | **`window.*` globals** | **PARTIALLY FIXED** | `__xeokitSdk` removed. But `__nativeXeokitViewer`, `__assetPlusViewerInstance`, `__xktTileChunks`, `__vizColorizedEntityIds`, `__spacesUserExplicitOff` etc. still used across ~25 files (388 matches). |
| 4 | **Custom event bus sprawl** | **IN PROGRESS** | Typed `event-bus.ts` created with 40+ typed events and `emit()`/`on()` helpers. ~12 files migrated, ~29 files still use raw `window.dispatchEvent(new CustomEvent(...))` (435 matches remaining). **Currently broken — 25+ TypeScript errors from handler signature mismatches** (handlers still expect `CustomEvent` but `on()` passes `detail` directly). |
| 5 | **`any` types everywhere** | **NOT ADDRESSED** | `allData: any[]`, `selectedFacility: any`, `appConfigs: Record<string, any>` still present in AppContext. |
| 6 | **No error boundaries around 3D viewer** | **FIXED** | `ViewerErrorBoundary` wraps both `NativeViewerShell` and `AssetPlusViewer` in all viewer pages. |
| 7 | **Mixed Swedish/English UI text** | **NOT ADDRESSED** | Still mixed across components. |
| 8 | **Performance / Lighthouse** | **IMPROVED** | Context split reduces re-render cascades. Progressive model streaming implemented. |
| 9 | **No automated tests** | **NOT ADDRESSED** | Still only `example.test.ts` with a single `expect(true).toBe(true)`. |
| 10 | **LOD culling on setInterval** | **IMPROVED** | `usePerformancePlugins` hook extracted with `ViewCullPlugin` (frustum culling). |

---

## What Was Accomplished Today

### Architecture (completed)
- **Context split**: AppContext → 4 domain contexts (ThemeContext, NavigationContext, ViewerContext, DataContext) with backward-compatible facade
- **Viewer decomposition**: NativeXeokitViewer → 3 composable hooks
- **Typed event bus**: `event-bus.ts` with 40+ typed events, `emit()`/`on()` helpers
- **API Profiles system**: Full credential management UI + DB schema
- **Progressive model streaming**: Models render as they download
- **Z-index scale**: `z-index.ts` created as single source of truth (but not yet adopted — 218 matches of `z-[N]` hardcoded across 26 files)

### Documentation (completed)
- **Technical report**: Word document comparing Asset+ viewer vs native xeokit implementation

---

## Current Blockers

### 1. Event bus migration is broken (CRITICAL)
25+ TypeScript errors across `AssetPlusViewer.tsx`, `GunnarButton.tsx`, `RoomsView.tsx`, `ViewerFilterPanel.tsx`, `SplitPlanView.tsx`, `GeminusPluginMenu.tsx`, `RoomVisualizationPanel.tsx`. Root cause: handlers were converted to use `on()` but their signatures still expect `CustomEvent` objects instead of the unwrapped `detail`. Every handler needs its parameter changed from `(e: CustomEvent<T>) => ...` to `(detail: T) => ...`, updating all internal `e.detail.xxx` references to `detail.xxx`.

### 2. `RoomsView.tsx` has an invalid property
Line 505: `selectOnly` does not exist in `VIEWER_FLY_TO` detail type `{ fmGuid: string }`.

---

## Remaining Items from Original Review (not yet done)

### Quick Wins (still open)
1. Replace remaining 9 "Loading..." strings with branded `<Spinner />` (in `MobileViewerPage`, `KnowledgeBaseSettings`, `VisualizationToolbar`, `ViewerRightPanel`, `ApiProfilesManager`, `AiAssetScan`)
2. Adopt `z-index.ts` constants across 26 files (replace hardcoded `z-[N]` classes)
3. Fix mixed Swedish/English — pick one language
4. Add `Cmd+K` hint in header for command search

### Strategic (still open)
5. Remove `window.*` globals (~25 files, 388 matches) — expose via React context or hook returns instead
6. Type the remaining `any` in AppContext facade (`allData`, `selectedFacility`, `appConfigs`)
7. Add component tests (currently zero)
8. Complete event bus migration (fix 25+ TS errors, migrate remaining 29 files)

### 10x Features (still open / partially done)
9. AI-driven onboarding — `generate-onboarding` edge function exists, but no guided first-use flow via Gunnar
10. Embedded analytics — still tab-based, not contextual
11. Real-time collaboration — not started

---

## Recommended Next Steps (Priority Order)

1. **Fix the 25+ TypeScript errors** in the event bus migration — this is blocking the build right now
2. **Complete the remaining ~29 file migrations** to `emit()`/`on()`
3. **Replace hardcoded z-index values** with `z-index.ts` constants
4. **Remove `window.*` globals** — biggest remaining architectural debt
5. **Add basic tests** — at minimum for the 3 viewer hooks and the event bus

---

## Competitive Positioning Update

| Area | Previous Rating | Current Rating | Change |
|---|---|---|---|
| Architecture | 4/10 | **7/10** | Context split, hook extraction, typed events |
| Performance | 5/10 | **7/10** | Progressive streaming, caching, frustum culling |
| UI Polish | 5/10 | **5/10** | No change (i18n, z-index, loading states still open) |
| Test Coverage | 1/10 | **1/10** | No change |
| Feature Depth | 8/10 | **8/10** | Already strong |
| **Overall** | **5/10** | **6.5/10** | Significant architectural improvement |

**Bottom line**: The architectural foundations are now solid. The remaining gap is polish (UI consistency, i18n, z-index), test coverage, and completing the in-progress event bus migration (which currently has build errors).

