

## Add "2D FMA" Quick Action button for floors

### What it does
Adds a new "2D FMA" button in the Portfolio Quick Actions panel, visible only when a **floor (Building Storey)** is selected. Clicking it opens the FM Access 2D drawing viewer for that specific floor.

### Changes

**1. `src/components/portfolio/QuickActions.tsx`**
- Add a new "2D FMA" button after the existing storey-level "2D" button (around line 90)
- Visible only when `isStorey` is true
- On click, navigates to `/split-viewer?building={buildingFmGuid}&mode=2d&floor={facility.fmGuid}`
- Uses the `Square` icon with a distinct color and label "2D FMA"

**2. `src/components/viewer/FmAccess2DPanel.tsx`**
- Update to accept and use a `floorFmGuid` query parameter so the edge function can resolve the correct drawing for the selected floor via `get-perspective-tree`

**3. `src/pages/SplitViewer.tsx` (or UnifiedViewer)**
- Read the `floor` query parameter and pass it through to `FmAccess2DPanel` as `floorId` so the correct floor drawing is loaded

### Technical details

The "2D FMA" button will:
```text
navigate(`/split-viewer?building=${buildingFmGuid}&mode=2d&floor=${facility.fmGuid}`)
```

Where `buildingFmGuid` is derived from `(facility as any).buildingFmGuid || facility.fmGuid` (same pattern as the 3D button).

The FmAccess2DPanel already accepts a `floorId` prop and passes it to the edge function. The edge function's `get-viewer-url` action can use the floor GUID to resolve the correct drawing via the perspective tree (perspectiveId 8).

No new navigation routes are needed -- it reuses the existing `/split-viewer` route with `mode=2d`.
