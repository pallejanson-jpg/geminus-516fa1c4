

# Plan: Google Street View Integration — Three Proposals

## Overview
Add three features leveraging Google Street View in CesiumJS: (1) Street View button on Cesium globe building cards, (2) Street View thumbnails on navigation steps, (3) outdoor-to-indoor transition from Street View to Ivion 360°.

**Prerequisite**: A `GOOGLE_STREET_VIEW_API_KEY` secret is needed. The Cesium Ion experimental endpoint works for development but is not production-ready. We'll use the Ion experimental endpoint initially and add a fallback to a dedicated key.

---

## Proposal 1: "Street View" Button on BuildingInfoCard (Cesium Globe)

### New file: `src/components/globe/StreetViewOverlay.tsx`
A fullscreen overlay component that:
- Takes `lat`, `lng`, and the Cesium viewer ref as props
- Creates a secondary Cesium viewer (or reuses the existing one) with `globe.show = false`
- Fetches the Google Street View API key via the Ion experimental endpoint (same token already fetched)
- Uses `GoogleStreetViewCubeMapPanoramaProvider.fromUrl()` to create a provider
- Calls `provider.getNearestPanoId(cartographic, 200)` to find the nearest panorama
- Loads the panorama with `provider.loadPanorama()` and adds it to the scene
- Configures camera controls: rotation/tilt enabled, translate/zoom disabled, scroll-wheel FOV zoom
- Shows a close button, building name, and an "Enter building" button (for Proposal 3)
- Handles "no coverage" gracefully with a toast message

### Modified file: `src/components/map/BuildingInfoCard.tsx`
- No changes needed — the `extraActions` prop already supports additional buttons

### Modified file: `src/components/globe/CesiumGlobeView.tsx`
- Add state: `streetViewFacility: MapFacility | null`
- Add `handleOpenStreetView` callback that sets this state
- Pass a new "Street View" button via `extraActions` on the BuildingInfoCard (alongside existing BIM toggle)
- Render `<StreetViewOverlay>` when `streetViewFacility` is set

### New edge function: `supabase/functions/get-streetview-key/index.ts`
- Returns the Ion experimental panoramas endpoint response (key + url) using the existing `CESIUM_ION_TOKEN`
- Falls back to `GOOGLE_STREET_VIEW_API_KEY` if set as a direct secret

---

## Proposal 2: Street View Thumbnails on Navigation Steps

### Modified file: `src/components/map/NavigationMapPanel.tsx`
- In the `StepTimeline` component, for each outdoor step with coordinates, render a small thumbnail image using the Google Street View Static API
- Use the URL format: `https://maps.googleapis.com/maps/api/streetview?size=120x80&location={lat},{lng}&key={key}&fov=90&heading={heading}`
- The heading is derived from the step's maneuver bearing
- Fetch the API key from the new `get-streetview-key` edge function (cache it in component state)
- Clicking a thumbnail opens a dialog/sheet showing a larger Street View image
- Show a placeholder if no coverage (the API returns a "no imagery" grey image which can be detected via response headers or hidden)

### New component: `src/components/map/StreetViewThumbnail.tsx`
- Small reusable component: takes `lat`, `lng`, `heading`, `apiKey`
- Renders an `<img>` with the Static API URL
- On error/no-coverage, renders a subtle "No Street View" placeholder
- On click, opens a larger preview dialog

---

## Proposal 3: Outdoor-to-Indoor Transition (Street View → Ivion 360°)

### Modified file: `src/components/globe/StreetViewOverlay.tsx`
- Add an "Enter building" button visible when the building has Ivion 360° (`has360` from facility data)
- On click:
  1. Calculate the current camera heading from the Street View panorama
  2. Store the heading in `sessionStorage` as `street-view-entry-heading`
  3. Close the Street View overlay
  4. Navigate to the Unified Viewer with `mode=360` and the building's fmGuid
  5. The Ivion 360° view will pick up the heading and orient the initial view accordingly

### Modified file: `src/pages/UnifiedViewer.tsx`
- On mount in 360° mode, check for `street-view-entry-heading` in sessionStorage
- If present, pass it as initial heading to the Ivion SDK's `resolveMoveTo` to orient the indoor view matching the outdoor heading

### Modified file: `src/components/viewer/Ivion360View.tsx`
- Accept optional `initialHeading` prop
- When SDK is ready and `initialHeading` is set, apply it to the first view orientation

---

## Technical Details

- **Cesium version**: 1.139.0 already installed — supports `GoogleStreetViewCubeMapPanoramaProvider`
- **API key flow**: Ion experimental endpoint → `CESIUM_ION_TOKEN` (already configured) → returns a scoped Google Street View key. No new secrets needed for development. For production, add `GOOGLE_STREET_VIEW_API_KEY` secret.
- **Street View overlay**: Uses a separate `<div>` with its own Cesium viewer instance (lightweight, globe hidden). This avoids disturbing the main globe viewer state.
- **Thumbnail API**: Google Street View Static API returns 120×80 images (~5KB each). Limited to visible steps to avoid excessive API calls.
- **Camera heading preservation**: The Street View panorama's heading is read from the Cesium camera's heading property and converted to degrees for Ivion.

### Files to create
1. `src/components/globe/StreetViewOverlay.tsx`
2. `src/components/map/StreetViewThumbnail.tsx`
3. `supabase/functions/get-streetview-key/index.ts`

### Files to modify
1. `src/components/globe/CesiumGlobeView.tsx` — add Street View button + overlay state
2. `src/components/map/NavigationMapPanel.tsx` — add thumbnails to StepTimeline
3. `src/pages/UnifiedViewer.tsx` — handle street-view-entry-heading
4. `src/components/viewer/Ivion360View.tsx` — accept initialHeading prop

