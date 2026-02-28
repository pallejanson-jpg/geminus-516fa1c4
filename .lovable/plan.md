

# Plan: Fix three UI issues

## Issue 1: Visualization legend bar positioned on wrong side
**File:** `src/components/viewer/VisualizationLegendBar.tsx`

The legend bar uses `right-3` (lines 119-121) but should be on the LEFT side per design. Change positioning:
- Mobile: `left-3 bottom-24` (was `right-3 bottom-24`)
- Desktop: `left-3 top-1/2 -translate-y-1/2` (was `right-3 top-1/2 -translate-y-1/2`)

## Issue 2: Floor switcher overlaps mobile navigation FAB
**File:** `src/components/viewer/FloatingFloorSwitcher.tsx`

Mobile position is `bottom-20` (line 274) which collides with the MobileNav FAB. However, floor switcher only shows in viewer apps, and MobileNav hides in viewer apps (`isInViewer` check in MobileNav). So this collision happens only in `split-viewer` route (not an `activeApp`-based view). 

Fix: increase mobile bottom offset from `bottom-20` to `bottom-28` to clear any safe-area overlap and ensure no collision with any bottom UI.

## Issue 3: QuickActions buttons don't navigate properly
**File:** `src/components/portfolio/FacilityLandingPage.tsx`

When QuickActions calls `startInventory()` or `startFaultReport()`, these change `activeApp` but the `FacilityLandingPage` overlay (z-40, absolute inset-0) remains on top because `selectedFacility` is still set in PortfolioView.

Similarly, `navigate('/split-viewer?...')` navigates to a route but the overlay stays.

**Fix:** In `FacilityLandingPage`:
- `handleInventory`: After calling `startInventory()`, also call `onClose()` to dismiss the overlay
- `onFaultReport` handler: After calling `startFaultReport()`, also call `onClose()` (already does via the lambda but need to verify)
- For visualization buttons in QuickActions that use `navigate()`: The navigate should work since it goes to a different route entirely. But on mobile SPA, we should verify the FacilityLandingPage unmounts when route changes.

Actually, looking more carefully: the `navigate()` calls in QuickActions go to `/split-viewer` route — this changes the route from `/` to `/split-viewer`, which unmounts the entire `Dashboard` component (which contains PortfolioView). So those should work.

The issue is specifically with `startInventory` and `startFaultReport` which change `activeApp` but don't clear `selectedFacility`. Fix:
- In `handleInventory`: call `onClose()` before `startInventory()` doesn't work since onClose navigates back in history. Instead, the fix should be in the context — but simplest is to close the overlay.

**Approach:** Modify `FacilityLandingPage.handleInventory` to close the landing page, and similarly for the fault report handler.

## Files to change
1. `src/components/viewer/VisualizationLegendBar.tsx` — move to left side
2. `src/components/viewer/FloatingFloorSwitcher.tsx` — increase mobile bottom offset
3. `src/components/portfolio/FacilityLandingPage.tsx` — close overlay when switching to inventory/fault report

