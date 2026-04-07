

## Plan: Native Colors Default + Mobile Floor Sync + Touch Navigation + Mobile Menu Responsiveness

### 1. Default to native model colors (no architect palette override)

**File: `src/hooks/useModelLoader.ts` and `src/components/viewer/NativeXeokitViewer.tsx`**

Currently `applyArchitectColors(viewer)` is called after every model load. This overwrites native XKT colors, making it impossible to verify that models were actually updated from Asset+.

- Remove all `applyArchitectColors()` calls from the model loading pipeline (both files)
- Keep the architect colors system available — it can be toggled on via the existing Viewer Theme selector or Architect Mode button
- In `useViewerEventListeners.ts`, remove the `applyArchitectColors()` call on tile load and on `INSIGHTS_COLOR_RESET` (instead, only re-apply if architect mode is explicitly active)
- In `ViewerToolbar.tsx`, remove the automatic `applyArchitectColors()` calls on reset/show-all — only call if architect mode is active

This means models load with their original IFC/XKT colors by default, and users can optionally switch to architect palette.

### 2. Mobile floor levels — re-extract when models stream in

**File: `src/hooks/useFloorData.ts`**

- Add a listener for `VIEWER_MODELS_LOADED` event bus event that triggers `extractFloors()` and updates state
- Add a xeokit scene `modelLoaded` listener to re-extract floors after each chunk arrives
- This ensures the floor list grows dynamically as progressive model segments load on slower mobile connections

### 3. Mobile touch navigation — full optimization

**File: `src/hooks/useXeokitInstance.ts`**

Replace the mobile `navTuning` block (line ~93) with best-practice touch values:

| Parameter | Current | New | Why |
|---|---|---|---|
| `dragRotationRate` | 70 | 45 | Less sensitive orbit |
| `rotationInertia` | 0.88 | 0.15 | Near-instant stop on release |
| `touchPanRate` | 0.14 | 0.08 | Finer pan |
| `panInertia` | 0.82 | 0.15 | Pan stops immediately |
| `touchDollyRate` | 0.09 | 0.06 | Gentler pinch-zoom |
| `mouseWheelDollyRate` | 35 | 15 | Tablet trackpad |
| `keyboardDollyRate` | 4 | 2 | External keyboards |

Additional mobile-specific `CameraControl` settings:
- `smartPivot = true` — orbit around touched surface
- `dollyMinSpeed = 0.02` — no zoom jumps
- `dollyProximityThreshold = 15` — slow zoom near surfaces
- `panRightClick = false` — irrelevant on touch
- `firstPerson = false` — orbit default

### 4. Mobile menu responsiveness — filter panel and all sheets

**File: `src/components/viewer/ViewerFilterPanel.tsx`**

The filter panel header crams 4 buttons (Reset colors, Show all, X-ray, Close) into one row. On 314px-wide mobile screens, the Close button gets pushed off-screen.

Fix:
- On mobile, make the Close button a prominent sticky element at the top-right, always visible
- Move "Reset colors" and "Show all" into a collapsible row or smaller icon-only buttons on mobile
- Ensure the panel respects `safe-area-inset-top` so it doesn't hide behind the status bar
- Change `top-[44px]` to use `safe-area-inset-top` calculation for notched devices

**File: `src/components/viewer/mobile/MobileViewerPage.tsx`**

The Drawer settings sub-sheet (line 1109) uses `max-h-[75dvh]` with internal `overflow-y-auto`, but the `ScrollArea` wrapper on line 871 already handles scrolling. This can cause double-scroll or content being cut off.

Fix:
- Remove the redundant `max-h-[75dvh]` from the settings sub-sheet inner div (line 1109) — the parent `ScrollArea` with `max-h-[88dvh]` already handles constraints
- Ensure all sub-sheets (display, colorFilter, actions, navigation, settings, toolbarConfig) use consistent padding-bottom (`pb-[calc(env(safe-area-inset-bottom)+24px)]`) so content isn't hidden behind the home indicator
- Add `overscroll-behavior: contain` to prevent pull-to-refresh interference

### Files to change

1. `src/hooks/useModelLoader.ts` — Remove `applyArchitectColors()` calls
2. `src/components/viewer/NativeXeokitViewer.tsx` — Remove `applyArchitectColors()` calls
3. `src/hooks/useViewerEventListeners.ts` — Conditional architect colors (only if mode active)
4. `src/components/viewer/ViewerToolbar.tsx` — Conditional architect colors on reset
5. `src/hooks/useFloorData.ts` — Add model-loaded event listeners for progressive floor extraction
6. `src/hooks/useXeokitInstance.ts` — Optimized mobile touch navigation values
7. `src/components/viewer/ViewerFilterPanel.tsx` — Mobile-responsive header with accessible close button
8. `src/components/viewer/mobile/MobileViewerPage.tsx` — Fix drawer scroll/safe-area for all sub-sheets

