

# Fix 3D Viewer and Standardize Back Buttons

## Issue 1: 3D Viewer Not Working

### Root Cause

The 3D viewer (Asset+ xeokit) **is actually loading correctly** -- the console shows `AssetPlusViewer version: 2.5.1.0` and `Viewer mounted successfully`. The problem is specifically on the **Virtual Twin page** (`/virtual-twin`), where the 3D canvas has `pointer-events: none` and `transparentBackground`, and the Ivion SDK layer underneath it fails to load (404 on `ivion.js`). This means:

- The 3D model is rendered but fully transparent (ghost mode) on a black/empty background
- No panorama is visible behind it because the SDK didn't load
- The page looks blank or broken

The standalone 3D viewer (accessed via the portfolio/building selector) works fine -- it uses `AssetPlusViewer` in its standard mode with the normal gradient background.

### Fix

The Virtual Twin page needs a **fallback UI** when the Ivion SDK fails to load, instead of showing a blank screen. It should also handle the "SDK load failed" state more gracefully -- show an error toast with a retry option and optionally fall back to showing the 3D model with its normal (non-transparent) background so the user at least sees something.

**Changes to `src/pages/VirtualTwin.tsx`:**
- Track an `sdkError` state when the Ivion SDK fails to load
- When `sdkError` is true, show the 3D viewer in non-transparent mode (so the BIM model is visible on its normal background), plus an error banner explaining that the 360-degree panorama could not be loaded
- Add a "Retry" button to re-attempt SDK loading
- This ensures the 3D view always works even if the 360-degree layer fails

**Changes to `src/lib/ivion-sdk.ts`:**
- Review `loadIvionSdk` to ensure it propagates errors correctly (currently the Virtual Twin catches the error but only shows a toast -- needs to also set state)

## Issue 2: Inconsistent Back Buttons

### Current Inventory

There are **four different back button patterns** used across the application:

| Pattern | Where Used |
|---|---|
| **ArrowLeft icon only** (no text) | MapView (mobile), Mobile3DViewer selector, Mobile360Viewer, InsightsView, SplitViewer (mobile header), MobileFaultReport |
| **ChevronLeft icon** | MobileViewerOverlay (3D viewer header) |
| **ArrowLeft + "Tillbaka" text** | SplitViewer (desktop), VirtualTwin header |
| **X (close) icon** top-right | FacilityLandingPage, AssetPlusViewer error state |

### Standardized Design

Adopt **two patterns only**, based on navigation context:

1. **"Back" button (ArrowLeft)** -- Used when navigating **away from a standalone page** back to a previous page. Consistent: icon-only on mobile, icon + "Tillbaka" text on desktop.
   - Used in: VirtualTwin, SplitViewer, Mobile3DViewer, Mobile360Viewer, MobileFaultReport, InsightsViews

2. **"Close" button (X)** -- Used when **closing a panel/overlay within the same page** (e.g. closing a facility detail card to return to the portfolio grid). Positioned top-right.
   - Used in: FacilityLandingPage (closing facility detail back to portfolio grid)

The **ChevronLeft** variant in `MobileViewerOverlay` should be changed to **ArrowLeft** for consistency with all other back buttons.

### Changes

**`src/components/viewer/mobile/MobileViewerOverlay.tsx`:**
- Change `ChevronLeft` import to `ArrowLeft`
- Replace `<ChevronLeft>` with `<ArrowLeft>` in the back button

**`src/components/insights/EntityInsightsView.tsx`:**
- No change needed -- already uses ArrowLeft icon-only

**`src/components/insights/BuildingInsightsView.tsx`:**
- No change needed -- already uses ArrowLeft icon-only

**`src/pages/SplitViewer.tsx`:**
- Mobile header: already uses ArrowLeft icon-only (correct)
- Desktop header: already uses ArrowLeft + "Tillbaka" (correct)

**`src/pages/VirtualTwin.tsx`:**
- Already uses ArrowLeft + "Tillbaka" (correct)

**`src/components/portfolio/FacilityLandingPage.tsx`:**
- Already uses X icon top-right (correct for "close panel" context)

**`src/components/viewer/AssetPlusViewer.tsx`:**
- Error state uses X icon for close (correct -- closing the viewer panel)

## File Summary

| File | Changes |
|---|---|
| `src/pages/VirtualTwin.tsx` | Add `sdkError` state, show fallback 3D with error banner when SDK fails, add retry |
| `src/components/viewer/mobile/MobileViewerOverlay.tsx` | Change `ChevronLeft` to `ArrowLeft` for back button consistency |

## Technical Details

The 3D viewer fix in VirtualTwin.tsx involves:

1. Adding an `sdkError` boolean state
2. In the `loadSdk` catch block, set `setSdkError(true)` alongside the existing toast
3. When `sdkError` is true AND `buildingInfo` exists:
   - Render the `AssetPlusViewer` without `transparentBackground` (normal mode)
   - Show a warning banner at the top: "360-graders panorama kunde inte laddas. Visar enbart 3D-modell."
   - Include a "Forsok igen" (Retry) button that resets `sdkError` and re-triggers the SDK load effect
4. The `pointer-events: none` on the 3D layer is only applied when the SDK loaded successfully

The back button fix is a single-line change: replacing `ChevronLeft` with `ArrowLeft` in MobileViewerOverlay.

