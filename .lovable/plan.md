

## Plan: Mobile 3D/2D/360° Responsiveness Fixes

### Issues Identified

1. **VisualizationToolbar (Visningsmenyn) not fully scrollable on mobile** — "Skapa ärende" and "Skapa vy" buttons at the bottom of the panel are cut off. The panel uses `max-h-[85vh]` but actions section is below the scroll area fold on small screens.

2. **2D mode not activating on mobile** — `MobileUnifiedViewer` sets `viewMode` to `'2d'` via `setViewMode('2d')` which updates state, but the `VIEW_MODE_2D_TOGGLED_EVENT` is dispatched from the `useEffect` watching `viewMode`. The issue is that the `AssetPlusViewer` inside mobile doesn't have a `ViewerToolbar` mounted (it's inside AssetPlusViewer only for desktop, and the mobile overlay doesn't include it). The `ViewerToolbar` listens for `VIEW_MODE_2D_TOGGLED_EVENT` and calls `handleViewModeChange('2d')` which does the actual 2D setup (ortho camera, floor plan clipping). On mobile, since `ViewerToolbar` IS rendered inside `AssetPlusViewer` (it's not conditional on `!isMobile`), the event should reach it. However, looking at `AssetPlusViewer` lines 4512-4536, `ViewerToolbar` is rendered when `!compactMode` — which is always true for mobile UnifiedViewer. So the toolbar IS mounted. The bug is likely a **timing issue**: when starting in 2D mode, the event fires before the viewer is ready. The `pending2dRef` logic (lines 233-261 in ViewerToolbar) should handle this, but the re-dispatch at lines 219-229 in UnifiedViewer fires at 500ms which may be too early.

3. **FloatingFloorSwitcher not shown in mobile 2D** — In `MobileUnifiedViewer` (line 701-710), the switcher is conditionally rendered when `viewMode === '2d'`. But it uses `className="!fixed !left-auto !top-auto !bottom-16 !right-2 !flex-row !h-auto !w-auto !z-50"` which overrides the default vertical layout. This should work, but the `isVisible` state inside `FloatingFloorSwitcher` defaults based on localStorage — if the user never toggled it, it should default to `true` (which it does at line 59). The real issue may be that the viewer isn't reporting as ready when 2D mode initializes on mobile.

4. **VisualizationLegendBar overlapping FloatingFloorSwitcher** — Legend bar uses `absolute left-3 top-1/2 -translate-y-1/2 z-[52]` while floor switcher uses `fixed left-3 top-[140px] z-20`. Both are on the left side and can overlap.

5. **Building name label in MobileViewerOverlay collides with 2D/3D switch in MobileUnifiedViewer** — Two separate header bars: `MobileViewerOverlay` renders a header with building name at `z-30`, and `MobileUnifiedViewer` renders its own header at `z-30` with the 2D/3D mode switcher. Both are `absolute top-0`.

6. **360° viewer elements too large on mobile** — The Ivion 360 SDK renders its own UI (sidebar, navigation controls) which takes up too much screen space. Some controls are also hidden/inaccessible.

---

### Technical Details

#### Fix 1: VisualizationToolbar mobile scrollability
The panel already has `max-h-[85vh]` and `ScrollArea`, but the "Åtgärder" (Actions) section with "Skapa vy" and "Skapa ärende" is inside the scroll area. The issue is likely that `ScrollArea` height isn't properly constrained because the panel uses `flex flex-col` but the scroll area doesn't get `min-h-0`. Add `min-h-0` to the scroll wrapper and ensure the panel respects mobile safe areas.

**File**: `src/components/viewer/VisualizationToolbar.tsx`
- Add `pb-safe` (safe area bottom padding) to the mobile panel
- Ensure scroll container has proper flex constraints

#### Fix 2: 2D mode activation on mobile
The 2D event re-dispatch in `UnifiedViewer.tsx` (lines 219-229) fires at 500ms. On mobile, model loading is slower. Increase delay and add a retry mechanism.

**File**: `src/pages/UnifiedViewer.tsx`
- In the `viewerReady && viewMode === '2d'` effect (lines 219-229), increase delay to 1500ms and add a second dispatch at 3000ms as fallback
- This ensures the ViewerToolbar's pending2dRef picks up the event even on slow mobile loads

#### Fix 3: FloatingFloorSwitcher in mobile 2D
The switcher in `MobileUnifiedViewer` should be rendered regardless of `viewMode === '2d'` but with visibility controlled by 2D state. The current approach is correct but may fail if the viewer isn't reporting ready. Change to always render the component (it self-hides when no floors) and ensure it gets proper z-index above the mode switcher bar.

**File**: `src/pages/UnifiedViewer.tsx`
- Move FloatingFloorSwitcher outside the `viewMode === '2d'` conditional — always render it, the component self-manages visibility
- Adjust z-index and positioning to avoid collision with bottom navigation

#### Fix 4: Legend bar vs Floor switcher overlap
Move the legend bar to avoid conflicting with the floor switcher on mobile.

**File**: `src/components/viewer/VisualizationLegendBar.tsx`
- On mobile, position legend bar further down or on the right side to avoid floor switcher collision
- Use `left-3 bottom-24` on mobile instead of `left-3 top-1/2 -translate-y-1/2`

#### Fix 5: Dual header collision on mobile
The `MobileViewerOverlay` (inside AssetPlusViewer) and the `MobileUnifiedViewer` header both render at `top-0`. When used inside `MobileUnifiedViewer`, the `MobileViewerOverlay` should be suppressed (via `suppressOverlay` prop) since `MobileUnifiedViewer` has its own header with 2D/3D switcher. But `suppressOverlay` is not passed from `MobileUnifiedViewer`.

**File**: `src/pages/UnifiedViewer.tsx`
- Pass `suppressOverlay` to `AssetPlusViewer` in `MobileUnifiedViewer` — the parent already handles the header with mode switcher
- Move building name into the `MobileUnifiedViewer` header (between back button and mode switcher)

#### Fix 6: 360° viewer mobile sizing
The Ivion SDK's built-in sidebar takes too much space on mobile. After SDK loads, hide sidebar elements via DOM manipulation (already partially done in Ivion360View).

**File**: `src/components/viewer/Ivion360View.tsx`
- Expand the existing mobile sidebar-hiding logic to also scale down navigation controls
- Add CSS overrides for Ivion SDK elements on mobile viewports

---

### Files to Modify

| File | Changes |
|---|---|
| `src/pages/UnifiedViewer.tsx` | Fix 2D init timing, suppress overlay, add building name to mobile header, always render floor switcher |
| `src/components/viewer/VisualizationToolbar.tsx` | Improve mobile scroll area constraints and safe area padding |
| `src/components/viewer/VisualizationLegendBar.tsx` | Reposition on mobile to avoid floor switcher overlap |
| `src/components/viewer/Ivion360View.tsx` | Improve mobile SDK element scaling |
| `src/components/viewer/mobile/MobileViewerOverlay.tsx` | No changes needed — suppressed via `suppressOverlay` in UnifiedViewer |

