

# Fix Plan: Viewer Issues (6 items)

## Issues

1. **Properties close button hidden** — `z-50` on the panel is covered by filter panel (`z-[65]`) and VisualizationToolbar.
2. **Levels not filtered to A-model** — `aModelSourceGuid` likely fails because `sharedModels` names don't match `isArchitecturalModel()` or storey `sourceGuid` is empty/different.
3. **B-model visible when unchecked** — Lines 961-968: when no source is checked, ALL models are set `visible = true`, including loaded non-A models.
4. **Room visualization (CO2, Temp) doesn't work** — `resolveXeokitViewer()` checks for `v.$refs.AssetViewer.$refs.assetView.viewer` (Asset+ path) or `v.viewer.scene` or `v.scene`. The shim ref from NativeViewerShell doesn't match any of these paths — it has `$refs.assetView.viewer` (missing `AssetViewer` level).
5. **Insights bar chart click doesn't colorize** — The `INSIGHTS_COLOR_UPDATE_EVENT` handler in NativeXeokitViewer uses `viewerRef.current` which IS the raw xeokit viewer. This should work. But `FORCE_SHOW_SPACES_EVENT` is listened for only in `RoomVisualizationPanel` — which may not be mounted. The spaces may remain hidden so colors are invisible.
6. **Only A-model should show when nothing is checked** — Same as issue #3.

## Plan

### 1. Fix Properties z-index
**File:** `src/components/common/UniversalPropertiesDialog.tsx` (line 1482)
- Change `z-50` → `z-[70]`

### 2. Fix `resolveXeokitViewer` for Native path
**File:** `src/components/viewer/RoomVisualizationPanel.tsx` (line 57-67)
- The shim creates `{ $refs: { assetView: { viewer } } }` but `resolveXeokitViewer` checks `v.$refs.AssetViewer.$refs.assetView.viewer`. Add a check for `v?.$refs?.assetView?.viewer` (without the `AssetViewer` nesting).
- Also add `(window as any).__nativeXeokitViewer` as final fallback.

### 3. Fix model visibility when no source checked
**File:** `src/components/viewer/ViewerFilterPanel.tsx` (lines 961-968)
- When no source filter is active: instead of making all models visible, only keep A-model(s) visible. Use `isArchitecturalModel()` to identify A-models from scene model IDs/names. Hide non-A models.
- Same logic in the "no filter" path (lines 853-877): after showing all objects, hide non-A model objects.

### 4. Fix levels to only show A-model levels
**File:** `src/components/viewer/ViewerFilterPanel.tsx`
- The `aModelSourceGuid` lookup likely fails because `sharedModels` has IDs/names that don't match what `storeyAssets.sourceGuid` contains. Add debug logging and a broader matching strategy:
  - Also try matching by normalizing both the model ID and storey sourceGuid.
  - Add a fallback: if a storey's `sourceName` starts with "A" or "a", include it.
  - If no A-model match found at all, include all levels (current fallback already exists).

### 5. Make spaces visible for Insights colorize
**File:** `src/components/viewer/NativeXeokitViewer.tsx`
- In the `INSIGHTS_COLOR_UPDATE_EVENT` handler, also listen for `FORCE_SHOW_SPACES_EVENT` and toggle IfcSpace visibility directly in the native viewer (like the shim's `onShowSpacesChanged` does). This ensures spaces become visible when Insights dispatches `FORCE_SHOW_SPACES_EVENT`.

### Technical Details

- `resolveXeokitViewer` path fix ensures RoomVisualizationPanel can find the scene through the NativeViewerShell shim chain.
- Model isolation uses `isArchitecturalModel(modelName)` which checks for names starting with "A" or "a". For scene models without friendly names, fall back to checking if the model was loaded as the primary/first model.
- The Insights color pipeline: `BuildingInsightsView` dispatches `FORCE_SHOW_SPACES_EVENT` + `INSIGHTS_COLOR_UPDATE_EVENT`. Both must be handled in NativeXeokitViewer for the colors to appear on visible IfcSpace entities.

