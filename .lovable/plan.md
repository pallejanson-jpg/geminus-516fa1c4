

# Updated Plan: Street View Integration + Mobile-Responsive Map & Navigation

This adds a fourth proposal to the approved plan: making the Map view and NavigationMapPanel fully usable on iPhone screens.

---

## Proposal 4: Mobile-Responsive Map & Navigation (iPhone)

### Problem
- `NavigationMapPanel` is hardcoded to `w-80` (320px) and positioned `absolute top-3 left-3` — this overflows on iPhone (viewport ~375px or smaller) and overlaps map controls
- The panel has no way to collapse/minimize, blocking the entire map on small screens
- `BuildingSidebar` already handles mobile reasonably (collapsible icon button), but competes for space with the nav panel
- Route summary `ScrollArea` max-h is small (192px), leaving little room for steps on short screens

### Changes

#### File: `src/components/map/NavigationMapPanel.tsx`
- **Convert to bottom sheet on mobile**: Use `useIsMobile()` hook. On mobile, render the panel as a `Drawer` (bottom sheet) instead of a floating card, matching the app's existing mobile pattern
- The drawer has a drag handle and can be swiped to expand/collapse
- When collapsed, show a compact summary bar (duration + distance) at the bottom so the map stays visible
- When expanded, show the full form (origin, destination, profile, steps) with `max-h-[85dvh]` and scrollable content
- On desktop, keep the existing floating card layout unchanged
- Increase `ScrollArea` max-h to `max-h-[40dvh]` on mobile for more step visibility

#### File: `src/components/map/MapView.tsx`
- On mobile, hide `BuildingSidebar` when `showNavPanel` is true (avoid overlapping panels)
- Move the navigation toggle button position on mobile: place it in a bottom-right floating position that doesn't conflict with the drawer
- Ensure map controls (layers, zoom reset) remain accessible above the drawer when it's collapsed

#### File: `src/components/map/StreetViewThumbnail.tsx`
- Ensure thumbnails use responsive sizing: `w-full` on mobile instead of fixed width
- Larger preview dialog uses `max-w-[90vw]` on mobile

---

## Technical Details

- Reuses the existing `Drawer` component from `src/components/ui/drawer.tsx` (vaul-based) for the mobile bottom sheet — consistent with the mobile viewer patterns already in the app
- `useIsMobile()` hook already used elsewhere in MapView, so no new dependency
- The geocoding dropdown needs `z-50` and proper positioning inside the drawer to avoid clipping
- Touch targets for profile buttons (Walk/Drive/Transit) increased to `h-9` on mobile for better tap accuracy

### Files to modify
1. `src/components/map/NavigationMapPanel.tsx` — bottom drawer on mobile
2. `src/components/map/MapView.tsx` — hide sidebar when nav active on mobile, adjust controls
3. `src/components/map/StreetViewThumbnail.tsx` — responsive thumbnail sizing

