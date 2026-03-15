

# Mobile Viewer Redesign — ACC-inspired Layout

## Goal
Restyle `MobileViewerPage.tsx` to match the ViewerMockup's ACC/Dalux-inspired design: transparent topbar overlaying the 3D canvas, compact icon-only bottom toolbar with 6 tool buttons, and replace the current `FloatingFloorSwitcher` pills with a more compact floor switcher that takes less screen space.

## Current State
- **MobileViewerPage** has an opaque header with mode switcher + filter/viz/insights buttons, no bottom toolbar, and delegates everything to `NativeViewerShell` (which shows `FloatingFloorSwitcher` pills + `ViewerToolbar`)
- **ViewerMockup** has the desired look: transparent gradient topbar, transparent gradient bottom toolbar with 6 icons, and a hamburger menu (Drawer) for secondary features
- **FloatingFloorSwitcher** renders vertical pills on desktop and horizontal pills on mobile — takes significant space

## Plan

### 1. Restyle MobileViewerPage header to transparent overlay
- Remove the opaque `bg-background/90 border-b` header
- Use transparent gradient overlay matching ViewerMockup: `linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)`
- Keep: back button (X icon), mode switcher, hamburger menu button
- Move filter/viz/insights into the hamburger Drawer menu (like ViewerMockup's action sheet)

### 2. Add compact bottom toolbar
- Port the ViewerMockup's bottom toolbar pattern: 6 icon buttons with transparent gradient background
- Wire to real xeokit commands via same event dispatch pattern already proven in ViewerMockup (orbit, pan, fit, select, measure, section)
- Include the gear icon for toolbar config sub-menu

### 3. Add action sheet Drawer
- Port the ViewerMockup Drawer with menu items: View Mode, Filter, Visualization, Insights, Issues, Settings
- Wire each to existing events (`MOBILE_TOGGLE_FILTER_PANEL`, `MOBILE_TOGGLE_VIZ_MENU`, `OPEN_ISSUE_LIST`)

### 4. Replace floor switcher with compact inline pills
- Pass `hideFloorSwitcher` to `NativeViewerShell` to suppress the default `FloatingFloorSwitcher`
- Add a thin horizontal floor pill strip positioned just above the bottom toolbar (inside the gradient area)
- Reuse floor data from `useFloorData` hook and visibility logic from `useFloorVisibility`
- Each pill: small rounded chip with short floor name, click to solo/toggle, much smaller than current pills

### 5. Shell props
- Keep `hideMobileOverlay={true}`, `hideBackButton`, add `hideFloorSwitcher` to all NativeViewerShell instances in MobileViewerPage
- Keep `hideToolbar` since we provide our own bottom toolbar

### Files to edit
- `src/components/viewer/mobile/MobileViewerPage.tsx` — main rewrite
- No new components needed; floor pills are inline

### What stays functional (no broken features)
- All tool buttons wired to real xeokit events (proven pattern from ViewerMockup)
- Mode switching via existing `VIEW_MODE_*` events
- Filter/Viz/Issues via existing custom events
- Floor visibility via existing `FLOOR_SELECTION_CHANGED_EVENT` + `useFloorVisibility`
- Split 2D/3D mode unchanged
- Insights drawer unchanged

