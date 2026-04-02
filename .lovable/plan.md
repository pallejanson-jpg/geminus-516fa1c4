

# Geminus Platform — Production Readiness Plan

## Overview
Three phases: Quick Wins, Strategic Improvements, and 10x Features.

---

## Phase 1: Quick Wins ✅ DONE

1. ✅ Replace all "Loading..." with branded `<FullPageSpinner />`
2. ✅ Add `useDocumentTitle` hook + apply to all routes via MainContent
3. ✅ Create `ViewerBreadcrumb` component (Building → Floor → Room)
4. ✅ Create z-index scale constants (`src/lib/z-index.ts`)
5. ✅ Cmd+K hint — already visible on desktop (no change needed)
6. ✅ Portfolio loading skeletons (6 skeleton cards)
7. ✅ Fix Swedish/English — standardized to English across ~15 files

---

## Phase 2: Strategic Improvements

### 8. Split AppContext into domain contexts ✅ DONE

**New files created:**
- `src/context/ThemeContext.tsx` — theme, setTheme
- `src/context/NavigationContext.tsx` — activeApp, viewMode, selectedFacility, sidebar, appConfigs, insights, 360, senslinc
- `src/context/ViewerContext.tsx` — viewer3dFmGuid, registration, inventory, fault report, annotation, AI selection, diagnostics
- `src/context/DataContext.tsx` — allData, navigatorTreeData, refreshInitialData, isLoadingData

**Architecture:** AppContext is now a thin facade (AppContextBridge) that composes all 4 domain contexts. All 68 existing consumers continue to work without changes via `useContext(AppContext)`. New code can use domain-specific hooks (`useTheme`, `useNavigation`, `useViewer`, `useData`).

### 9. Extract NativeXeokitViewer into composable hooks — NEXT
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
