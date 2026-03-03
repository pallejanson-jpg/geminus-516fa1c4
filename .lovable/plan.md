

# Plan: Cesium Globe — Fly-in animation, building popup, 3D buildings default, XKT placement

## 1. Startup fly-in animation
When the globe loads and buildings are available, start with a zoomed-out view of Earth, then fly to the bounding region of all buildings (Nordic/Northern Europe) over ~3 seconds.

**Implementation in `CesiumGlobeView.tsx`:**
- After pins are placed (in the facilities sync `useEffect`), compute a `Rectangle` bounding all building coordinates with some padding
- Call `viewer.camera.flyTo({ destination: boundingRect, duration: 3 })` to smoothly zoom from the default global view down to Northern Europe

## 2. Click → building info popup (like MapView)
Replace the current "click selects + fly" behavior with a floating info card showing building name, address, category, and a button to navigate to the facility landing page.

**Implementation:**
- Add a `selectedBuilding` state holding the clicked facility data + screen position
- On left-click: set `selectedBuilding` with facility info, fly to 300m altitude above it
- Render a floating `Card` positioned near the pin showing:
  - Building name, category badge
  - "Visa detaljer" button → navigates to facility landing page (`setSelectedFacility` + `setActiveApp('portfolio')`)
  - "Visa 3D" button → navigates to split-viewer
- Clicking the card's action button enters the building's landing page

## 3. Enable 3D buildings by default + set 300m fly-to altitude
- Change `show3dBuildings` initial state from `false` to `true`
- When clicking a building, fly to `toCartesian(lat, lng, 300)` with a slight pitch/heading for perspective

## 4. Smaller, cleaner 3D buildings toggle
Reduce the control card size — make it a compact pill-style toggle instead of a full card with padding. Remove the "Cesium Globe" title header, keep just the switch with a small icon.

## 5. Future: XKT model placement on globe
This is a more complex feature that requires:
- Converting XKT models to glTF/3D Tiles format (Cesium doesn't natively load XKT)
- Georeferencing the model (placing it at correct lat/lng/altitude with rotation)
- Options: convert IFC → 3D Tiles via a pipeline, or use Cesium ion for hosting

I'll note this as a future enhancement and return with a detailed plan when ready.

## Files to change

| File | Change |
|------|--------|
| `CesiumGlobeView.tsx` | Fly-in animation, building popup card, 3D buildings default on, compact toggle, 300m perspective fly-to |

