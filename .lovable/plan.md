

# Geminus Platform — Comprehensive Quality Audit

## Executive Summary

Geminus is an ambitious facility management platform with impressive scope: 3D BIM viewing, 360-degree integration, AI-powered asset detection, IoT sensor dashboards, and portfolio management. The architecture shows thoughtful decomposition (domain contexts, event bus, lazy loading). However, the rapid growth has introduced inconsistencies and technical debt across several dimensions.

**Overall grade: B-** — Strong feature set, solid architectural bones, but needs a consistency and polish pass to reach production-grade quality.

---

## 1. UI/UX Consistency Issues

### 1.1 Page Headers — No Standard Pattern
Every page invents its own header style:

```text
Dashboard:        h1.text-2xl.font-semibold + p.text-muted-foreground
Support:          h1.text-2xl.font-bold + p.text-sm.text-muted-foreground
FM Access:        h1.text-lg.font-semibold
API Docs:         h1.text-lg.font-bold
BuildingSelector: "Select Building" inline
```

**Fix**: Create a `PageHeader` component with consistent `text-2xl font-semibold` for all top-level views.

### 1.2 Font Size Chaos — Arbitrary Pixel Sizes
Widespread use of non-standard text sizes (`text-[9px]`, `text-[10px]`, `text-[11px]`) across 6+ pages. These bypass the Tailwind type scale and are hard to maintain. Found 800+ occurrences across page files alone.

**Fix**: Map to Tailwind scale — `text-[10px]` → `text-[0.625rem]` or just use `text-xs` (12px). Create utility classes like `text-caption` if truly needed.

### 1.3 Inconsistent Card Padding
Some views use `p-4 md:p-6`, others `p-4 sm:p-8`, others have no wrapper padding at all. The `max-w` constraint also varies (`max-w-4xl`, `max-w-2xl`, `max-w-md`, none).

### 1.4 Dashboard Has Hardcoded Mock Data
`Dashboard.tsx` displays static values ("24 properties", "847 MSEK") that never change. This is a demo screen left in production. Either connect it to real data or remove it.

### 1.5 PlaceholderView Still References Firebase
`PlaceholderView.tsx` line 23: *"This view will be migrated from the Firebase project"* — a leftover message visible to end users.

### 1.6 Swedish/English Mix
Sidebar shows "Byggnad" as fallback (LeftSidebar line 121). Most UI is English but traces of Swedish remain in labels and descriptions. Pick one language.

---

## 2. Code Quality Issues

### 2.1 Pervasive `any` Types — ~153 occurrences in context files alone
Core data structures are untyped:
- `selectedFacility: any` — used in 40+ components
- `allData: any[]` — the central data store
- `insightsFacility: any`
- `appConfigs: Record<string, any>`
- `NavigatorNode` has `[key: string]: any`

This makes refactoring dangerous and eliminates TypeScript's value proposition for the most critical state.

**Fix**: Define proper interfaces for `Facility`, `NavigatorNode`, and `AppConfig` and propagate them.

### 2.2 Console.log Pollution — 1,058 instances in components alone
Production builds ship with over 1,000 `console.log` calls. Some are diagnostic (`[ViewerToolbar]`, `[ModelLoader]`), many are development leftovers (`console.log('Edge function call ended:', ...)`).

**Fix**: Replace with a logger utility that respects `import.meta.env.DEV` or use `console.debug` for diagnostic output.

### 2.3 Component Size
Several files are extremely large:
- `ApiSettingsModal.tsx` — 2,000+ lines (settings mega-component)
- `UnifiedViewer.tsx` — 1,700+ lines
- `NativeViewerShell.tsx` — 1,300+ lines
- `PortfolioView.tsx` — 751 lines
- `gunnar-chat/index.ts` — 2,000+ lines (edge function)

These are hard to test, review, and maintain.

### 2.4 ESLint Suppressions
Found `eslint-disable` comments in 4 files, all suppressing `react-hooks/exhaustive-deps`. This typically signals missing or incorrect dependency arrays in `useEffect` — potential source of stale-state bugs.

### 2.5 No Tests
Only `src/test/example.test.ts` exists. Zero component tests, zero integration tests, zero hook tests. For a platform of this complexity, this is a significant risk.

### 2.6 Duplicate Route Definitions
`IvionCreate`, `AiAssetScan`, and `Inventory` are defined both as top-level routes in `App.tsx` AND as lazy-loaded views in `MainContent.tsx`. This creates two code paths to the same feature.

### 2.7 `AppButton` Adds No Value
`AppButton` is a thin wrapper that just adds `flex items-center justify-center transition-colors` — classes already present on the base `Button`. This indirection adds cognitive load without benefit.

---

## 3. Architecture Issues

### 3.1 SPA Routing via State Machine, Not URL
Most navigation uses `setActiveApp('portfolio')` rather than URL-based routing. This means:
- Browser back/forward does not work for most views
- Users cannot bookmark or share links to specific views
- Deep linking only works for the `/viewer` route

### 3.2 AppContext Bridge — Performance Concern
`AppContextBridge` merges 4 domain contexts into one object on every render. Any state change in any domain context triggers a re-render of ALL 68+ consumers. The decomposition into `ThemeContext`, `NavigationContext`, etc. was the right direction but the bridge undermines the benefit.

### 3.3 Theme System Uses Raw Class Objects
`THEMES[theme]` returns class name strings like `t.bgSec`, `t.border`, etc. Meanwhile, CSS variables already handle theming via `:root` / `.dark` / `.swg`. This creates two parallel theming systems — the CSS variable approach (modern, correct) and the `THEMES` object (legacy, redundant).

### 3.4 Event Bus vs. Props — Mixed Patterns
The codebase uses both `window.dispatchEvent(new CustomEvent(...))` (43 instances in contexts alone) and React props/context for communication. While the event bus was intentionally introduced for viewer-specific cross-cutting concerns, its use has leaked into general UI coordination.

---

## 4. Security Observations

### 4.1 Auth Implementation — Solid
- Uses `user_roles` table with server-side `has_role` function — correct pattern
- `ProtectedRoute` checks auth state properly
- Admin check via database, not client storage
- Google OAuth with proper redirect handling

### 4.2 Profile Data in LocalStorage
`ProfileSettings.tsx` stores profile data (name, email, avatar as base64) in localStorage. This should be in the database `profiles` table.

### 4.3 Credentials in AppConfigs
`appConfigs` stored in localStorage may contain API credentials (`username`, `password` fields in `AppConfig` type). This is a security concern for shared/public machines.

---

## 5. Performance Observations

### 5.1 Lazy Loading — Good
Heavy views (Map, Globe, Viewer) are lazy-loaded. Globe is even pre-fetched.

### 5.2 XKT Force-Fetch on Every Load
Recent changes force a fresh Asset+ download on every viewer session. This is correct for debugging but will be a performance/bandwidth issue in production.

### 5.3 No Virtualization in Lists
Portfolio view renders all buildings in a flat grid. For large portfolios (100+ buildings), this could cause jank.

---

## 6. Competitive Analysis

### What Geminus Does Well
1. **Unified platform** — 3D viewer, 2D plans, 360-degree, IoT, and AI in one app. Competitors (Dalux, BIMcollab, Autodesk Tandem) typically do 1-2 of these.
2. **AI integration** — Asset detection from 360-degree scans, natural language building queries (Gunnar), document search (Ilean). This is ahead of most competitors.
3. **Multi-source data fusion** — Asset+, FM Access, Ivion, Senslinc all unified under one UI.
4. **PWA with offline potential** — Service worker registration, chunk error recovery.

### Where Competitors Are Ahead
1. **URL-based navigation** — Every competitor supports deep links and browser history.
2. **Testing** — Industry standard is 60-80% coverage for enterprise SaaS.
3. **Accessibility (a11y)** — No ARIA labels, no keyboard navigation testing, no skip-to-content links. Competitors like Procore invest heavily here.
4. **i18n** — No proper internationalization framework. Swedish/English mixed. Competitors use i18next or similar.
5. **Error reporting** — No Sentry/Datadog integration. Only `console.error` with `event.preventDefault()`.
6. **Documentation** — No Storybook, no component documentation, no API client SDK.

---

## 7. Recommended Action Plan (Priority Order)

### Phase 1 — Quick Wins (1-2 weeks)
1. Create `PageHeader` component, standardize all view headers
2. Remove `PlaceholderView` Firebase text
3. Replace hardcoded Dashboard with real data or remove page
4. Fix Swedish/English inconsistencies
5. Add a `logger` utility to gate `console.log` calls

### Phase 2 — Type Safety (2-3 weeks)
1. Type `selectedFacility` as `Facility | null` across all contexts
2. Type `allData` as a proper asset array
3. Type `appConfigs` properly
4. Remove `[key: string]: any` from NavigatorNode

### Phase 3 — Architecture (3-4 weeks)
1. Migrate from `setActiveApp()` state machine to React Router URL-based navigation
2. Remove the `AppContextBridge` — have consumers import domain-specific hooks directly
3. Remove the legacy `THEMES` object, use only CSS variables
4. Split large components (ApiSettingsModal, UnifiedViewer, NativeViewerShell)

### Phase 4 — Quality Infrastructure (ongoing)
1. Add Vitest component tests for critical flows (auth, viewer loading, portfolio)
2. Add Sentry or equivalent error reporting
3. Add Storybook for UI component documentation
4. Implement proper i18n with i18next
5. Accessibility audit and WCAG 2.1 AA compliance

