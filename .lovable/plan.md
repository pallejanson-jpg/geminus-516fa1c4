

# Geminus Platform — Production Readiness Plan

## Overview
Three phases: Quick Wins (implement now), Strategic Improvements (architectural), and 10x Features (future roadmap). Quick Wins will be implemented in this session. Strategic and 10x items are planned for subsequent sessions.

---

## Phase 1: Quick Wins (Implement Now)

### 1. Replace all "Loading..." strings with branded Spinner
**Files:** `src/App.tsx`, `src/components/viewer/ViewerRightPanel.tsx`, `src/components/viewer/mobile/MobileViewerPage.tsx`, `src/components/viewer/VisualizationToolbar.tsx`, `src/components/settings/KnowledgeBaseSettings.tsx`, `src/pages/AiAssetScan.tsx`

- Replace ~20 instances of bare `Loading...` text in Suspense fallbacks and inline loading states
- Use the existing `<Spinner />` component from `src/components/ui/spinner.tsx`
- For Suspense fallbacks in `App.tsx`: create a shared `<FullPageSpinner />` component
- For inline loading states: use `<Spinner size="sm" />` instead of text

### 2. Add route-level `<title>` and meta tags
**New file:** `src/hooks/useDocumentTitle.ts`
**Modified:** Each page component or `MainContent.tsx`

- Create a `useDocumentTitle(title: string)` hook that sets `document.title`
- Apply in MainContent based on `activeApp` state, or in individual page components
- Pattern: "Portfolio | Geminus", "3D Viewer — {buildingName} | Geminus", "Map | Geminus"

### 3. Breadcrumb navigation in viewer context
**New file:** `src/components/viewer/ViewerBreadcrumb.tsx`
**Modified:** `src/components/viewer/NativeViewerShell.tsx`

- Show "Building → Floor → Room" path based on current selection context
- Use existing shadcn `Breadcrumb` components (already in project)
- Each segment clickable: Building → portfolio, Floor → floor filter, Room → select
- Position: top of viewer, below header, subtle styling

### 4. Z-index scale documentation and consolidation
**New file:** `src/lib/z-index.ts`
**Modified:** Components using hardcoded z-index values

- Define a z-index scale as constants: `Z_HEADER = 30`, `Z_SIDEBAR = 40`, `Z_OVERLAY = 50`, `Z_MODAL = 60`, `Z_NAVCUBE = 15`, `Z_FLOATING_BUTTONS = 70`, `Z_PROPERTIES = 80`
- Replace hardcoded `z-[80]`, `z-50`, `z-15` etc. with these constants
- Add inline documentation for the scale

### 5. Cmd+K hint visibility
**File:** `src/components/layout/AppHeader.tsx`

- Already implemented (line 186-188 shows `⌘K` kbd tag)
- Currently `hidden sm:inline-flex` — already visible on desktop
- No change needed — this is already done

### 6. Loading skeletons for building cards in portfolio
**Modified:** `src/components/portfolio/PortfolioView.tsx`, `src/components/home/HomeLanding.tsx`

- Replace empty/loading states with skeleton cards matching the building card layout
- Use existing `<Skeleton />` component
- Show 3-6 skeleton cards while `isLoadingData` is true

### 7. Fix mixed Swedish/English UI strings
**Approach:** Standardize to English (the majority language in the codebase)

- Audit: "Visa meny" → "Show menu", "Okänd våning" → "Unknown Floor", sidebar labels
- Keep Swedish only where it's user-data (building names, categories from Asset+)
- Touch ~10-15 files with scattered Swedish strings

---

## Phase 2: Strategic Improvements (Next Sessions)

### 8. Split AppContext into domain contexts
Currently 829 lines with 40+ state variables causing re-render cascades.

**New files:**
- `src/context/ThemeContext.tsx` — theme, setTheme (3 consumers)
- `src/context/NavigationContext.tsx` — activeApp, viewMode, selectedFacility, sidebar state
- `src/context/ViewerContext.tsx` — viewer3dFmGuid, viewerDiagnostics, assetRegistration, annotationPlacement
- `src/context/DataContext.tsx` — allData, navigatorTreeData, refreshInitialData, isLoadingData

**Impact:** Prevents viewer re-renders when theme changes, prevents portfolio re-renders when viewer state changes.

### 9. Extract NativeXeokitViewer into composable hooks
Currently 2,044 lines in one component.

**New hooks:**
- `useXeokitInstance(canvasRef, options)` — creates/destroys viewer, returns ref
- `useModelLoader(viewerRef, buildingFmGuid)` — handles model fetching, signed URLs, loading queue
- `useViewerEventListeners(viewerRef)` — consolidates all CustomEvent listeners

**Result:** `NativeXeokitViewer.tsx` becomes ~200 lines of composition.

### 10. Typed event system
Replace `window.dispatchEvent(new CustomEvent(...))` with a typed event bus.

**New file:** `src/lib/event-bus.ts`
- Zustand store or typed EventEmitter with `on<EventName>(handler)` pattern
- Compile-time type checking for event payloads
- Automatic cleanup via React hooks

### 11. Component tests
Add Vitest + Testing Library tests for critical paths:
- Viewer initialization flow
- Portfolio search and filter
- Command palette search
- Breadcrumb navigation
- Context state transitions

---

## Phase 3: 10x Features (Roadmap)

### 12. Real-time collaboration (co-presence)
- Leverage existing Realtime Presence channels
- Broadcast camera position, active floor, user avatar
- Render other users as markers in 3D scene
- "Fly to user" functionality

### 13. Progressive model streaming
- Implement chunked XKT loading showing geometry as chunks arrive
- Use xeokit's streaming capabilities or split models into storey-level tiles
- Show progressive rendering during download

### 14. AI-driven onboarding
- Gunnar auto-opens for first-time users (check onboarding_complete flag)
- Guided walkthrough: "Click here to open a building" → "This is the 3D viewer" → "Try asking me a question"
- Context-aware tips based on current view

### 15. Embedded analytics
- When selecting a room in 3D viewer, show a small card with energy/sensor data
- Inline KPIs in portfolio building cards
- Contextual insights in the properties dialog

---

## Implementation Order (This Session)

1. Branded Spinner + FullPageSpinner (replace all Loading... strings)
2. `useDocumentTitle` hook + apply to all routes
3. ViewerBreadcrumb component
4. Z-index constants file
5. Portfolio loading skeletons
6. Swedish → English string audit

**Estimated scope:** ~15 files modified, 3 new files created.

