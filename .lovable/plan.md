

## Fix Mobile Visualization Menu and Legend Bar

### Problem Summary
Three issues on mobile:
1. **Right-side visualization menu hard to close** -- "double graphics" and no way to tap outside to dismiss
2. **Legend bar is horizontal instead of vertical** -- it's rendered inside the Sheet/panel, constrained by parent width
3. **Legend bar disappears when menu closes** -- it only exists as a child of `RoomVisualizationPanel`, so closing the Sheet hides it

### Solution

#### 1. Make the right panel closeable by tapping outside (mobile only)
- Change `ViewerRightPanel`'s `Sheet` from `modal={false}` to `modal={true}` on mobile devices only
- This adds a backdrop overlay that, when tapped, closes the panel automatically
- On desktop, keep `modal={false}` so the 3D viewer remains interactive while the panel is open

#### 2. Move the legend bar OUT of RoomVisualizationPanel
- The legend bar is currently rendered as a child of `RoomVisualizationPanel`, which sits inside the Sheet
- Move it to `AssetPlusViewer.tsx` as a sibling of the floor carousel and other floating overlays
- It will read the visualization state from localStorage (already persisted) and listen for visualization change events
- Position it on the **left side of the viewer**, vertically centered -- same area where the floor pills are

#### 3. Keep the legend bar visible independently
- Create a lightweight wrapper that reads `visualizationType` and `useMockData` from localStorage
- Listen for a new custom event (`VISUALIZATION_STATE_CHANGED`) dispatched by `RoomVisualizationPanel` whenever the type or mock toggle changes
- Render `VisualizationLegendBar` in the main viewer overlay layer, independent of the Sheet open/close state
- The legend bar already has correct vertical layout code (`flex-col`, fixed `height`), it just needs to be outside the Sheet's width constraint

### Technical Details

**File changes:**

1. **`src/components/viewer/RoomVisualizationPanel.tsx`**
   - Remove the `VisualizationLegendBar` rendering from both embedded and floating modes
   - Dispatch a `VISUALIZATION_STATE_CHANGED` custom event when `visualizationType` or `useMockData` changes, carrying the current rooms, type, and mock flag

2. **`src/components/viewer/AssetPlusViewer.tsx`**
   - Import `VisualizationLegendBar`
   - Add state listeners for `VISUALIZATION_STATE_CHANGED` to track active visualization type, rooms, and mock flag
   - Render the legend bar in the floating overlay area (alongside floor carousel), positioned left, vertically centered
   - The legend bar will be visible whenever a visualization type is active, regardless of whether the right panel is open

3. **`src/components/viewer/ViewerRightPanel.tsx`**
   - On mobile: set `modal={true}` on the Sheet so tapping the backdrop area closes it
   - On desktop: keep `modal={false}` for uninterrupted 3D interaction

4. **`src/components/viewer/VisualizationLegendBar.tsx`**
   - No layout changes needed -- the vertical layout already works, it was just being constrained by its Sheet parent

