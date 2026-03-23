

# Plan: Street View Walking + Indoor Nav Setup Guide + Mobile Nav Fix

Three changes requested:

---

## 1. Walk Around in Google Street View

### Problem
Currently the overlay loads a single static panorama. Users can look around but cannot move to adjacent panoramas like in Google Maps.

### Solution
Add click-to-move navigation: when the user double-clicks (or taps) in a direction, find the nearest panorama in that direction and load it, creating a "walking" experience.

#### File: `src/components/globe/StreetViewOverlay.tsx`
- Add state for `currentPanoId` and `providerRef` so the provider persists across panorama loads
- Extract the panorama loading logic into a reusable `loadPanoAtPosition(panoId, longitude, latitude)` function
- Add a `LEFT_DOUBLE_CLICK` event handler on the Cesium canvas:
  1. Get the camera's current heading direction
  2. Calculate a point ~30m ahead in that heading direction from the current position
  3. Call `provider.getNearestPanoId(aheadCartographic, 50)` to find the next panorama
  4. If found, remove the current panorama primitive and load the new one
  5. Preserve the camera heading across transitions for continuity
- Add arrow navigation buttons (forward/backward) in the header bar as an alternative to clicking
- Show a brief loading indicator during transitions between panoramas
- On mobile, use single tap (since double-tap is harder) with a "move forward" button overlay at the bottom center

### UX
- Double-click to move forward in the direction you're looking
- Forward/back buttons in the toolbar for explicit control
- Current position indicator showing lat/lng (small, bottom-left)

---

## 2. Indoor Navigation Setup (Documentation — No Code Changes)

This is a configuration guide, not a code change. The steps needed to enable indoor navigation for a building:

1. **Upload an IFC model** — go to the building's 3D viewer, use the model upload feature. The IFC will be converted to XKT automatically
2. **Set building coordinates** — in building settings, save the latitude/longitude so the building appears on the globe/map
3. **Create a navigation graph** — open the 3D viewer for the building, enable the Nav Graph Editor from the Navigation panel. Place waypoint nodes at corridors, doorways, stairs/elevators. Connect them with edges. Save the graph
4. **Set building rotation** (recommended) — align the BIM model's north with geographic north for correct orientation when transitioning between outdoor/indoor views
5. **(Optional) Set Ivion Site ID** — to enable 360° mode, enter the Ivion Site ID in building settings

Steps 1-3 are required for indoor navigation. Without a navigation graph, the pathfinding engine has no data to work with.

---

## 3. Mobile Navigation Panel — Fix Scrolling + Make Taller

### Problem
The Vaul `Drawer` content doesn't scroll on mobile, and the panel is too short.

#### File: `src/components/map/NavigationMapPanel.tsx`
- The `DrawerContent` uses `max-h-[85dvh]` but the inner `div` with `overflow-y-auto` may not have a constrained height — fix by adding `flex flex-col` to `DrawerContent` and `flex-1 overflow-y-auto` to the scrollable inner div
- Increase snap points from `[0.35, 0.85]` to `[0.45, 0.92]` so the collapsed state shows more content and expanded state uses near-full screen
- Add `overscroll-contain` to prevent pull-to-refresh interference on iOS
- Ensure the `ScrollArea` inside the step timeline also works within the drawer by removing the nested `max-h` constraint on mobile (let the drawer height control it instead)

---

## Technical Details

### Files to create
None

### Files to modify
1. `src/components/globe/StreetViewOverlay.tsx` — add panorama navigation (click-to-move + buttons)
2. `src/components/map/NavigationMapPanel.tsx` — fix mobile drawer scrolling, increase height

### Street View navigation logic (key snippet)
```typescript
// On double-click: move forward in look direction
const moveForward = async () => {
  const camera = viewer.camera;
  const heading = camera.heading;
  const currentPos = currentPositionRef.current; // {lng, lat}
  
  // Calculate point ~30m ahead
  const dLat = (30 / 111320) * Math.cos(heading);
  const dLng = (30 / (111320 * Math.cos(currentPos.lat * Math.PI / 180))) * Math.sin(heading);
  const aheadCart = Cesium.Cartographic.fromDegrees(
    currentPos.lng + dLng, currentPos.lat + dLat, 0
  );
  
  const nextPano = await providerRef.current.getNearestPanoId(aheadCart, 50);
  if (nextPano) {
    await loadPanoAtPosition(nextPano.panoId, nextPano.longitude, nextPano.latitude);
  }
};
```

