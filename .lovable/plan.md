

# Fix Plan: English Translations, Issue Panel Layout, Display Menu, Color Filter, Open in 3D

## Issues Summary

1. **Swedish → English translations** across multiple files
2. **Issue list overlaps** mode switcher bar at top; Issue detail overlaps issue list
3. **Display menu close button** not visible (inherits white text but uses destructive color)
4. **Remove 2D/3D switch** from Display menu
5. **"Show labels" context menu** does nothing visible — needs investigation
6. **Color filter not working** — spaces turn on but don't get colored
7. **"Open in 3D"** from asset list doesn't zoom to object
8. **Asset list search performance** is slow with 1000+ assets

---

## Changes

### 1. Swedish → English Translations

**File: `src/components/portfolio/FacilityLandingPage.tsx`**
- "Sparade vyer" → "Saved views" (line 929)
- "Våningar" → "Floors" (line 711)

**File: `src/components/portfolio/PortfolioView.tsx`**
- "våningar" → "floors" (line 497)

**File: `src/components/insights/tabs/PredictiveMaintenanceTab.tsx`**
- "Hög risk" → "High risk", "Medel" → "Medium", "Låg risk" → "Low risk" (lines 26-28)
- "konfidens" → "confidence" (line 65)
- "Välj en byggnad för att se prediktivt underhåll" → "Select a building to view predictive maintenance" (line 89)
- "Prediktivt underhåll" → "Predictive Maintenance" (line 98)
- "AI-analys av utrustning och sensorer" → "AI analysis of equipment and sensors" (line 99)
- "Analyserar..." / "Analysera" → "Analyzing..." / "Analyze" (line 103)
- "Övergripande riskpoäng" → "Overall risk score" (line 129)
- "Inga underhållsrisker identifierade" → "No maintenance risks identified" (line 162)

**File: `src/components/viewer/VisualizationToolbar.tsx`**
- "Temperatur" → "Temperature", "Luftfuktighet" → "Humidity", "Beläggning" → "Occupancy", "Yta (NTA)" → "Area (NTA)" (lines 51-55)

**File: `src/components/viewer/VisualizationQuickBar.tsx`**
- "Fukt" → "Humid.", "Belägg." → "Occup.", "Yta" → "Area" (lines 13-15)

**File: `src/components/portfolio/AssetsView.tsx`**
- "Assets i" / "Assets på" → "Assets in" / "Assets on" (lines 734-736)
- "ej i modell" → "not in model" (line 763)
- "Ja" → "Yes", "Nej" → "No" (lines 701-703)
- "Ej synkad" → "Not synced", "Synkad" → "Synced" (lines 710-712)
- "Alla" → "All", "Ej i modell" → "Not in model", "Ej synkade" → "Not synced", "Utan annotation" → "No annotation" (lines 797-802, 812-822)
- "Kolumner" → "Columns" (line 832)
- "Systemegenskaper" → "System properties", "Användardefinierade" → "User defined" (lines 837, 861)
- "Åtgärder" → "Actions" (line 968)
- "Öppna i 3D" → "Open in 3D" (line 1012)
- "Egenskaper" → "Properties" (lines 904, 1000)
- "Placera annotation" → "Place annotation" (line 1026)
- "Synka till Asset+" → "Sync to Asset+" (line 1041)

**File: `src/components/portfolio/RoomsView.tsx`**
- "Visa i 3D" → "View in 3D" (lines 741, 854)
- "Egenskaper" → "Properties" (lines 620, 729)
- "Åtgärder" → "Actions" (line 687)
- "Användardefinierade" → "User defined" (line 575)

**File: `src/components/insights/BuildingInsightsView.tsx`**
- "Visa alla våningar" → "Show all floors" (line 1428)

### 2. Issue Panel Layout — Prevent Overlap

**File: `src/components/viewer/FloatingIssueListPanel.tsx`**
- Change initial `y` position from `80` to `60` (below mode switcher bar which is ~48px)
- Ensure the panel starts at a position that doesn't overlap the top bar

**File: `src/components/viewer/VisualizationToolbar.tsx`**
- When `handleSelectIssue` is called and `showIssueDetail` opens, close the issue list (`setShowIssueList(false)`) to prevent overlap. The detail sheet replaces the list view.

### 3. Display Menu Close Button Visibility

**File: `src/components/viewer/VisualizationToolbar.tsx`**
- The `[&_*]:text-inherit` rule on line 1210 forces ALL descendant text to white, including the close button's `text-destructive` class. Fix by excluding the close button from the inheritance — add `!text-destructive` to the close button or use inline style.
- Change close button class to include `!text-red-500` to override inheritance.

### 4. Remove 2D/3D Switch from Display Menu

**File: `src/components/viewer/VisualizationToolbar.tsx`**
- Remove the 2D/3D toggle block (lines 878-887) from the toolbar content. The mode switcher in the top bar already handles this.

### 5. "Show labels" Context Menu

The `onShowLabels` handler in `NativeViewerShell.tsx` (line 884) dispatches `TOGGLE_ANNOTATIONS` event. This is the annotation labels toggle — it works but requires annotations to be loaded first. This is working as designed but the effect may not be visible if no annotations exist. No code change needed, but could add a toast feedback: "No annotations loaded" if none are visible.

### 6. Color Filter Not Working

The color filter in VisualizationToolbar dispatches `VISUALIZATION_QUICK_SELECT_EVENT` which `RoomVisualizationPanel` listens to. The panel then calls `applyVisualization` which colorizes spaces. The issue is likely that `RoomVisualizationPanel` isn't mounted or the event chain breaks.

**Root cause**: The `RoomVisualizationList` in `VisualizationToolbar` dispatches `FORCE_SHOW_SPACES_EVENT` and `VISUALIZATION_QUICK_SELECT_EVENT`, but the `RoomVisualizationPanel` component that actually applies colors needs to be mounted (it's rendered inside `NativeViewerShell`). Need to verify it's mounted and the event flow connects properly.

**File: `src/components/viewer/VisualizationToolbar.tsx`**
- After dispatching `VISUALIZATION_QUICK_SELECT_EVENT`, also dispatch `FORCE_SHOW_SPACES_EVENT` with `{ show: true }` to ensure spaces are enabled. Currently this happens but the toggle function calls `onToggleVisualization` which may not propagate correctly to `NativeViewerShell`'s visualization state.
- The `RoomVisualizationList` should directly dispatch the event AND also call `onToggleVisualization(true)` to ensure the parent mounts `RoomVisualizationPanel`.

### 7. "Open in 3D" Doesn't Zoom to Object

**File: `src/components/portfolio/PortfolioView.tsx`**
- `handleOpen3DRoom` currently only sets `viewer3dFmGuid` to the building GUID and opens the viewer. It doesn't pass the target object's fmGuid for zoom-to.
- Fix: Store the target object fmGuid in a new context/state variable (e.g., `pendingZoomToFmGuid`), and in the viewer, listen for this and zoom to the object once the model is loaded.
- Simpler approach: dispatch a custom event `VIEWER_ZOOM_TO_OBJECT` with the fmGuid after a delay once the viewer is open. The viewer can listen for this event and fly to the matching entity.

**File: `src/components/viewer/NativeViewerShell.tsx`**
- Add listener for `VIEWER_ZOOM_TO_OBJECT` event that finds the entity by fmGuid in metaScene and flies camera to it.

### 8. Asset List Search Performance

**File: `src/components/portfolio/AssetsView.tsx`**
- The search filters run `filteredAssets` useMemo on every keystroke against 1000+ assets × N visible columns. Add input debouncing (300ms) to avoid re-computing on every character.
- Use a `debouncedSearchQuery` state that updates 300ms after the last keystroke, and use that in the `filteredAssets` memo instead of `searchQuery`.

## Technical Details

- Issue detail Sheet uses `modal={false}` so it doesn't create its own overlay — it renders inline and can overlap the FloatingIssueListPanel (both at z-[70]). Fix: close list when detail opens.
- The close button color override needs `!important` via Tailwind's `!` prefix because `[&_*]:text-inherit` has higher specificity through the parent selector.
- For zoom-to-object: use `setTimeout` (~2s) after viewer navigation to allow model loading, then dispatch the zoom event.
- Search debounce uses a simple `useEffect` + `setTimeout` pattern rather than adding a dependency.

