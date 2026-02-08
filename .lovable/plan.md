

# Fix 3D Viewer: 4 Remaining Issues

## Issue 1: Room Toggling Performance (All Rooms Load Without Floor Isolation)

### Problem
When "Visa rum" (Show Spaces) is toggled ON without a floor being isolated, the `filterSpacesToVisibleFloors` function in `AssetPlusViewer.tsx` (line 357) makes ALL IfcSpace entities visible across the entire building. On a large building, this can be hundreds of room geometries, causing severe performance degradation on mobile.

### Solution
Add a guard in the `handleShowSpacesChange` callback that checks whether all floors are currently visible. If all floors are visible (no isolation), show a warning toast and prevent enabling spaces.

**Changes to `src/components/viewer/AssetPlusViewer.tsx`:**
- In `handleShowSpacesChange`: Before calling `onShowSpacesChanged(true)`, check `isAllFloorsVisibleRef.current`. If true, show a toast message informing the user that a floor must be isolated first, and return without enabling spaces.

**Changes to `src/components/viewer/ViewerRightPanel.tsx`:**
- In `handleToggleSpaces`: Add the same guard -- check if all floors are visible by listening to the `FLOOR_SELECTION_CHANGED` event state. Show a toast warning if no floor is isolated.

**Changes to `src/components/viewer/VisualizationToolbar.tsx`:**
- Same guard in the spaces toggle handler.

**Changes to `src/components/viewer/mobile/MobileViewerOverlay.tsx`:**
- The "Show Spaces" toggle calls the parent's `onShowSpacesChange` callback, which routes to `handleShowSpacesChange` in `AssetPlusViewer.tsx`. No separate change needed here since the guard is in the parent.

Toast message (Swedish): "Isolera en vaningsplan forst for att visa rum. Att visa alla rum samtidigt gor viewern langsammare."

---

## Issue 2: Mobile Right Menu Crash (Building Disappears)

### Problem
When the Sheet (right-side settings drawer) opens on mobile, it overlays the viewer and may trigger DOM reflows or touch event conflicts that cause the WebGL canvas to lose its rendering context. The `Sheet` component from Radix UI uses a modal overlay with `pointer-events: none` on the body, which can interfere with the xeokit canvas.

### Root Cause Analysis
The `MobileViewerOverlay` uses a Radix `Sheet` component (line 220-485) with `side="right"`. When the Sheet opens:
1. Radix injects a backdrop overlay that covers the entire viewport
2. The Sheet's `ScrollArea` uses `h-[calc(100vh-80px)]` which can trigger layout recalculations
3. On iOS, this DOM manipulation combined with the WebGL context can cause the canvas to lose context or crash

### Solution
1. **Prevent canvas interference**: Add `will-change: transform` to the viewer canvas container to promote it to its own compositing layer, isolating it from DOM reflows caused by the Sheet
2. **Use non-modal Sheet**: Set `modal={false}` on the Sheet component to prevent Radix from adding a full-screen overlay and blocking pointer events on the body, which interferes with WebGL
3. **Add manual backdrop**: Add a simple semi-transparent backdrop div that closes the sheet on tap, without the heavy modal behavior

**Changes to `src/components/viewer/mobile/MobileViewerOverlay.tsx`:**
- On the `Sheet` component: add `modal={false}` prop
- Add a custom backdrop overlay that only covers the area outside the Sheet
- On the viewer container in `AssetPlusViewer.tsx`: add `will-change: transform` CSS to the `#AssetPlusViewer` div to prevent compositor layer thrashing

**Changes to `src/components/viewer/AssetPlusViewer.tsx`:**
- Add `willChange: 'transform'` to the style of the `#AssetPlusViewer` div (line 2877) to isolate WebGL from DOM reflows

---

## Issue 3: Incorrect BIM Model Names

### Problem
The `xkt_models` database table is empty (confirmed by query), and the Asset+ `GetModels` API is the fallback for model names. The model IDs in the xeokit scene are file hashes (e.g., `abc123def.xkt`), and the name mapping from the API uses `model.id` and `model.xktFileUrl` to match. If the matching fails (which the debug log shows: "No name match for model:"), the fallback is to display the raw file hash with dashes replaced by spaces -- which produces "very strange" names.

### Solution
Improve the name resolution in `ModelVisibilitySelector.tsx`:

1. **Use `model_name` from the `GetModels` API more aggressively**: The API returns objects with `id`, `name`, and `xktFileUrl`. Currently, the matching is done by xktFileUrl filename extraction, but the extracted filename may not match the scene model ID exactly.

2. **Add a position-based fallback**: If the API returns N models and the scene has N models, match by sorted position. This handles cases where IDs are completely different between the API and the scene.

3. **Cache API model names to the `xkt_models` table**: After fetching from the API, persist the mapping to the database for future loads. This avoids repeated API calls and ensures model names are available offline.

**Changes to `src/components/viewer/ModelVisibilitySelector.tsx`:**
- In `fetchModelNames` (line 96): After a successful API call, also insert/upsert the results into the `xkt_models` table so subsequent loads use the cached names
- In `extractModels` (line 221): Add a fallback matching strategy that uses the model's `metaScene` root object name (e.g., `IfcProject.name`) if the file name matching fails
- Add Strategy 6: Search the model's metaScene root node for the project name, which often matches the model name from Asset+

**Changes to add a backend function or direct insert:**
- After fetching from the Asset+ API, upsert rows into `xkt_models` with `building_fm_guid`, `model_id`, `model_name`, and `file_name`

---

## Issue 4: Not All Models in Model Selector

### Problem
For buildings with multiple BIM models (like "sma Viken" with 4 models: A, 1B, 1E, etc.), not all models appear in the model selector. The `ModelVisibilitySelector` combines scene models with `dbModels` from the `xkt_models` table. Since `xkt_models` is empty, only scene-loaded models appear. If the viewer's `additionalDefaultPredicate` is `undefined` (as set in our recent fix), the Asset+ viewer loads all models by default. However, if the viewer only loaded ONE model (e.g., the A model), the others won't appear in the selector.

### Root Cause
The `additionalDefaultPredicate` parameter was fixed to `undefined` in the previous change. According to the Asset+ docs, `undefined` means "use default behavior" which loads all models. The issue may be that:
1. The API only returns one model for some buildings
2. Or the scene models are loaded asynchronously and the selector polls too early (max 10 attempts x 500ms = 5 seconds)

### Solution
1. **Ensure all API models appear in the selector**: Even if they're not loaded in the scene yet, the `dbModels` state should contain them from the API call. Since `xkt_models` is empty, the API fallback runs. We need to verify this path works.

2. **Persist API models to database**: Same as Issue 3 -- once we write API results to `xkt_models`, the selector will always have the complete list regardless of which models are loaded in the scene.

3. **Add a "load model" action**: For models listed in the selector but not loaded in the scene (marked `loaded: false`), toggling them ON should trigger a model load via the Asset+ API (`viewer.loadModel(modelId)` or similar).

**Changes to `src/components/viewer/ModelVisibilitySelector.tsx`:**
- In `handleModelToggle`: If the model has `loaded: false`, attempt to load it into the scene via the Asset+ viewer API before making it visible
- After successful API fetch in `fetchModelNames`, upsert results to `xkt_models` for persistence

---

## File Summary

| File | Changes |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | (1) Guard spaces toggle to require floor isolation, (2) Add `willChange: 'transform'` to viewer container |
| `src/components/viewer/mobile/MobileViewerOverlay.tsx` | Set Sheet to `modal={false}`, add custom backdrop |
| `src/components/viewer/ViewerRightPanel.tsx` | Guard spaces toggle with floor isolation check |
| `src/components/viewer/VisualizationToolbar.tsx` | Guard spaces toggle with floor isolation check |
| `src/components/viewer/ModelVisibilitySelector.tsx` | (1) Add metaScene name fallback, (2) Persist API names to xkt_models, (3) Handle loading unloaded models |

## Risk Assessment

- **Spaces guard**: Low risk. Only adds a user-facing restriction with clear messaging. Power users who know what they're doing can isolate a floor first.
- **Sheet modal fix**: Low risk. Using `modal={false}` is a documented Radix prop. The custom backdrop provides the same UX without WebGL interference.
- **Model names**: Medium risk. The persistence to `xkt_models` requires an upsert that could fail silently. The metaScene fallback is a best-effort heuristic.
- **Model loading**: Medium risk. The `viewer.loadModel()` API needs to be verified against the Asset+ documentation.
