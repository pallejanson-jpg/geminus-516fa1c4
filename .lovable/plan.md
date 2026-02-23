

## Annotations Deep-Dive: Findings and Implementation Plan

### Current State Analysis

The annotation system has two loaders that run after all models load:

1. **`loadLocalAnnotations`** -- fetches assets with `annotation_placed=true` AND coordinates from the database, creates DOM circle markers projected onto the 3D scene
2. **`loadAlarmAnnotations`** -- fetches `IfcAlarm` assets, finds their BIM geometry position via metaScene lookup, creates similar markers

**Why it likely never works:**

- The projection uses `camera.projectWorldPos()` which may not exist on all xeokit camera versions -- if it returns `undefined`, all markers get `display: none` and are invisible
- Alarm annotations require an "Alarm" symbol row in `annotation_symbols` -- if missing, the function exits silently at line 1617
- Local annotations require assets with BOTH `annotation_placed=true` AND non-null `coordinate_x` -- most inventoried items may not have coordinates set
- There is no error feedback to the user -- failures are logged to console only

**What exists but is disconnected:**

- `AnnotationCategoryList` component (toggle visibility per category) exists but is buried in a submenu flyout
- No connection between annotations and the filter panel
- No floor-level filtering of annotation markers
- No click-to-interact on markers (no fly-to, no properties)

---

### Implementation Plan

#### 1. Fix the Projection Engine (AssetPlusViewer.tsx)

Replace the potentially missing `camera.projectWorldPos()` with the standard xeokit pattern used successfully by level labels and room labels:

```
camera.project(worldPos) -> returns [canvasX, canvasY, depth]
```

This affects both `loadLocalAnnotations.updatePositions` and `loadAlarmAnnotations.updatePositions`. The depth check changes from `canvasPos[2] > 0 && canvasPos[2] < 1` to checking that the projected point is within canvas bounds.

Also add a `levelFmGuid` property to local annotations (from the asset's `level_fm_guid` column) so they can be floor-filtered.

#### 2. Add Annotations Section to ViewerFilterPanel (ViewerFilterPanel.tsx)

Add a new **"Annotations"** filter section below the existing Categories section. This section will:

- Fetch non-modeled assets (`created_in_model = false` OR `asset_type = 'IfcAlarm'`) for the current building from Supabase
- Group them by `asset_type` (e.g., "Brandsslackare", "IfcAlarm", "Sensor") with counts
- Display as checkboxes with colored dots (from `annotation_symbols` table)
- When a category is checked/unchecked, dispatch a new event `ANNOTATION_FILTER_EVENT` with the list of visible categories
- The annotation system in AssetPlusViewer listens for this event and toggles marker visibility per category

Data flow:
```text
ViewerFilterPanel                          AssetPlusViewer
  [x] Brandsslackare (5)    --dispatch-->   show/hide markers
  [ ] IfcAlarm (23)          ANNOTATION_     with matching
  [x] Sensor (8)             FILTER_EVENT    category
```

#### 3. Floor-Aware Annotation Filtering (AssetPlusViewer.tsx)

Listen for `FLOOR_SELECTION_CHANGED_EVENT` in the annotation system. When a floor is isolated:

- Hide all annotation markers whose `levelFmGuid` does not match the visible floor(s)
- When all floors are restored, show all markers again
- This uses the same `visibleFloorFmGuids` array from the event detail

#### 4. Click-to-Interact on Markers (AssetPlusViewer.tsx)

Add click handlers to annotation markers:

- On click: fly the camera to the marker's world position and open the `AssetPropertiesDialog` for that asset's `fm_guid`
- On hover: show a tooltip with the asset name

#### 5. Toggle in VisualizationToolbar (VisualizationToolbar.tsx)

The existing "Visa annotationer" toggle (line 901-931) already works for global on/off. Keep it as-is -- it dispatches to `handleToggleAnnotations` which calls `handleAnnotationsChange`.

---

### Technical Changes Summary

| File | Change |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Fix `projectWorldPos` to use `camera.project()` in both `loadLocalAnnotations` and `loadAlarmAnnotations`; add `level_fm_guid` to local annotation data; add `FLOOR_SELECTION_CHANGED_EVENT` listener for annotation floor filtering; add click handler on markers to fly-to + show properties |
| `src/components/viewer/ViewerFilterPanel.tsx` | Add new "Annotations" FilterSection below Categories; fetch non-modeled assets grouped by type; dispatch `ANNOTATION_FILTER_EVENT` on checkbox change |
| `src/lib/viewer-events.ts` | Add `ANNOTATION_FILTER_EVENT` constant and `AnnotationFilterDetail` type |

### Not Changed

- `AnnotationCategoryList.tsx` and `AnnotationToggleMenu.tsx` -- these become redundant once the filter panel handles annotation filtering. They can be removed in a future cleanup.
- `VisualizationToolbar.tsx` -- the existing annotations toggle already works; the sub-menu arrow that opens the category list can be removed since the filter panel now handles it.
