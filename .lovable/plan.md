

## Fix Plan: Småviken 3D, Insights Viewer Performance, and Chart Coloring

### Issues Identified

1. **3D viewer remounts on every chart click / tab switch** (critical performance bug)
2. **Toolbar and NavCube too large in Insights inline viewer**
3. **Chart click no longer colors 3D model** (caused by issue #1)
4. **Småviken 3D loading regression** (needs investigation -- likely fetch interceptor or memory)
5. **Remaining Swedish text** in several components

---

### 1. Stop Remounting the 3D Viewer on Chart Interaction

**Root cause:** In `BuildingInsightsView.tsx` line 1215, the `InsightsInlineViewer` uses `key={inlineUpdateKey}` and `handleInsightsClick` bumps this key on every chart click (line 470). This **destroys and recreates** the entire `AssetPlusViewer` component, including the WebGL context, model loading, and all initialization.

**Fix:**
- Remove `key={inlineUpdateKey}` from the `InsightsInlineViewer` mount
- Instead of remounting, dispatch an `INSIGHTS_COLOR_UPDATE_EVENT` to the existing viewer instance (same mechanism already used in `drawerMode`)
- Update `handleInsightsClick` for the desktop path: instead of setting state that triggers remount, dispatch the event directly to the already-mounted viewer
- The viewer already has a listener for `INSIGHTS_COLOR_UPDATE_EVENT` (line 452) that handles coloring without remount

**File: `src/components/insights/BuildingInsightsView.tsx`**
- Remove `inlineUpdateKey` state and its increment in `handleInsightsClick`
- Change the desktop path in `handleInsightsClick` to dispatch `INSIGHTS_COLOR_UPDATE_EVENT` (same as drawerMode path)
- Change `InsightsInlineViewer` to not use a dynamic key, mount once with just the `fmGuid`
- The `InsightsInlineViewer` still receives `insightsColorMode` and `insightsColorMap` as initial props for the first load

### 2. Compact Toolbar and NavCube in Insights Viewer

**Root cause:** The `AssetPlusViewer` always renders the full toolbar and NavCube even when embedded as a small inline panel. The `suppressOverlay` prop only hides the top bar and mobile overlay -- not the bottom toolbar or NavCube.

**Fix:**
- Add a new `compactMode` prop to `AssetPlusViewer` (set by `InsightsInlineViewer`)
- When `compactMode` is true:
  - Hide the bottom `ViewerToolbar` completely (or show a minimal version)
  - Hide the NavCube canvas
  - Hide `FloatingFloorSwitcher`, `FloorCarousel`, and `VisualizationLegendBar`
- When the viewer is expanded or maximized, `compactMode` should be false (showing full controls)

**File: `src/components/viewer/AssetPlusViewer.tsx`**
- Add `compactMode?: boolean` prop
- Guard the toolbar render block (line 4026) with `!compactMode`
- Guard the NavCube canvas (line 3968) with `!compactMode`
- Guard `FloatingFloorSwitcher` (line 4029) with `!compactMode`

**File: `src/components/insights/BuildingInsightsView.tsx`**
- Pass `compactMode={!expanded}` to the `AssetPlusViewer` in `InsightsInlineViewer`
- When `expanded` is true, show full controls including NavCube

### 3. Fix Chart-to-3D Coloring

This is automatically fixed by issue #1. Once the viewer is no longer remounted on every click, the `INSIGHTS_COLOR_UPDATE_EVENT` dispatch will reach the already-initialized viewer and apply colors correctly. The event handler at line 452 already implements the complete coloring logic for all modes (`room_types`, `room_spaces`, `energy_floors`, `asset_categories`, etc.).

### 4. Småviken 3D Loading

The models exist in storage (A-modell: 43MB, KV-modell: 2.2MB). Potential causes:
- The 43MB A-modell may exceed in-memory cache limits (MAX_MEMORY_BYTES) in `useXktPreload`
- The fetch interceptor may be interfering with cached URL resolution
- The large model may cause a parser timeout

**Investigation and fix:**
- Check `useXktPreload.ts` MAX_MEMORY_BYTES constant -- if it's too low for 43MB models, skip memory caching for large models
- Ensure the fetch interceptor's allowedModelIds whitelist includes Småviken's model IDs
- Add error logging to the model loading path to capture the specific failure

**File: `src/hooks/useXktPreload.ts`**
- Increase MAX_MEMORY_BYTES or add a per-model size guard to skip caching models larger than 30MB

**File: `src/components/viewer/AssetPlusViewer.tsx`**
- Ensure `allowedModelIdsRef` is properly cleared when building changes (already done per memory notes, but verify)

### 5. Remaining Swedish Text

Translate remaining Swedish strings found during exploration:

| File | Swedish | English |
|---|---|---|
| `BuildingInsightsView.tsx` | "Visa", "Tryck pa stapel for 3D", "Vaning:", "Alla", "Laddar...", "Rumsheatmap", "Visa rum i 3D", "Inga rum hittades", "Larm-objekt fran databasen", "Visa alla i 3D", "Hantera larm", "Senaste 50 larm", "Sok rumsnamn...", "Visa alla vaningar", "Rumsnamn", "Rumsnr", "Vaning", "Datum", various more | English equivalents |
| `ViewerToolbar.tsx` | "Vantar pa viewer..." | "Waiting for viewer..." |
| `AssetPlusViewer.tsx` | "Synkar 3D-modeller...", "Stang 3D-vy", "Helskarm", "Modelltrad", "Visning", Swedish pick-mode text | English equivalents |

---

### Technical Detail: File Changes

**`src/components/insights/BuildingInsightsView.tsx`**
1. Remove `inlineUpdateKey` state (line 165) and its setter calls
2. Update `handleInsightsClick` desktop path (lines 467-471): dispatch `INSIGHTS_COLOR_UPDATE_EVENT` instead of setting state that bumps key
3. Remove `key={inlineUpdateKey}` from `InsightsInlineViewer` (line 1215)
4. Pass `compactMode={!expanded}` to `AssetPlusViewer` inside `InsightsInlineViewer`
5. Translate all Swedish UI strings to English

**`src/components/viewer/AssetPlusViewer.tsx`**
1. Add `compactMode?: boolean` prop to `AssetPlusViewerProps`
2. Guard toolbar block (line 4026): `!compactMode && state.isInitialized && initStep === 'ready'`
3. Guard NavCube canvas (line 3968): add `!compactMode` to display condition
4. Guard `FloatingFloorSwitcher` (line 4029): `!compactMode && !isMobile`
5. Translate Swedish UI strings to English

**`src/hooks/useXktPreload.ts`**
1. Add per-model size guard: skip memory caching for models > 30MB to avoid cache eviction thrashing

**`src/components/viewer/ViewerToolbar.tsx`**
1. Translate "Vantar pa viewer..." to "Waiting for viewer..."

