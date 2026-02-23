

## Level Labels, Click-to-Isolate, and Shadows in the 3D Viewer

### Overview

Three new features inspired by the Tandem viewer reference:

1. **Level labels** floating beside each floor in the 3D scene (like Tandem's "Plan 09", "Plan 10"...)
2. **Click-to-isolate** on level/room labels with a close (X) button to restore
3. **Shadows (SAO)** for visual depth, matching the high-quality rendering seen in the reference

---

### 1. Level Labels (new "storey labels" system)

Currently, the `useRoomLabels` hook only creates labels for `IfcSpace` entities. We need a parallel system for `IfcBuildingStorey` labels that:

- Appear **to the left** of the building model, stacked vertically by floor elevation
- Show the floor name (e.g., "Plan 10", "Plan 18")
- Are always visible when the model is loaded (no toggle needed -- they serve as navigation aids)
- Use the same `worldToCanvas` projection technique as room labels
- Have a distinctive visual style: pill-shaped, slightly larger text, semi-transparent background

**Implementation**: A new hook `useLevelLabels` in `src/hooks/useLevelLabels.ts`:

- Scans `metaScene.metaObjects` for `IfcBuildingStorey` type
- For each storey, computes the **center Y** from the AABB of all child entities, and positions the label at `(minX - offset, centerY, centerZ)` -- placing it to the left of the building geometry
- Creates DOM elements in a container overlaid on the canvas (same pattern as `useRoomLabels`)
- Resolves friendly names from the database floor names (same approach as `FloatingFloorSwitcher`)
- Updates positions on camera changes using `requestAnimationFrame` throttling

**Visual style**:
- Pill-shaped (`rounded-full`, `px-3 py-1`)
- Semi-transparent dark background (`bg-card/80 backdrop-blur-sm`)
- White text, `font-size: 12px`, `font-weight: 500`
- Pointer events enabled (clickable)
- When isolated: highlight color + X close button appended

---

### 2. Click-to-Isolate with Close Button

When clicking a level label or room label:

**Level label click**:
- Isolates that floor (same as clicking a floor pill in `FloatingFloorSwitcher`)
- Dispatches `FLOOR_SELECTION_CHANGED_EVENT` with the storey data
- The label gets a visual "active" state: highlighted border, and an **X close button** appears next to it
- Clicking the X button restores all floors (dispatches `isAllFloorsVisible: true`)

**Room label click** (enhancement to existing `useRoomLabels`):
- When `clickAction` is set to a new mode `'isolate'` (or we add this alongside existing modes):
  - Hides all objects except the clicked room's entities
  - Shows an X button on the label
  - Clicking X restores full visibility

**Implementation details**:
- In `useLevelLabels`: each label element gets an `onclick` handler that calls isolation logic and appends an X span element
- The X click handler calls a restore function that shows all floors and removes the X element
- In `useRoomLabels`: extend the `handleLabelClick` to support an `'isolate'` click action (optional, can be added in a follow-up)
- Both hooks share the `FLOOR_SELECTION_CHANGED_EVENT` for coordination

---

### 3. Shadows via SAO (Scalable Ambient Obscurance)

Xeokit has built-in **SAO** (Scalable Ambient Obscurance) support -- a screen-space ambient occlusion technique that adds soft contact shadows similar to the Tandem screenshot. This is NOT traditional shadow mapping but achieves a very similar visual effect for architectural models.

**Xeokit SAO API** (available on `scene.sao`):
- `scene.sao.enabled = true` -- enables SAO
- `scene.sao.intensity = 0.25` -- shadow darkness (0-1)
- `scene.sao.bias = 0.5` -- depth bias to reduce artifacts
- `scene.sao.scale = 1000` -- scale factor for the effect
- `scene.sao.minResolution = 0` -- minimum resolution
- `scene.sao.kernelRadius = 100` -- radius of the effect

The `FastNavPlugin` already hides SAO during camera movement (`hideSAO: true`) for performance, which is the correct approach -- SAO is expensive but only needs to render when the camera stops.

**Implementation**: Add SAO activation in `usePerformancePlugins.ts` after the viewer is ready:

```
xeokitViewer.scene.sao.enabled = true;
xeokitViewer.scene.sao.intensity = 0.15;
xeokitViewer.scene.sao.bias = 0.5;
xeokitViewer.scene.sao.scale = 1000;
xeokitViewer.scene.sao.kernelRadius = 100;
```

The `FastNavPlugin` already handles hiding SAO during navigation, so performance should be acceptable. On mobile, we can skip SAO entirely or use lower settings.

---

### Technical Changes

**New file: `src/hooks/useLevelLabels.ts`**
- New hook following the same pattern as `useRoomLabels`
- Scans metaScene for `IfcBuildingStorey`, computes world positions
- Creates clickable DOM labels with isolation behavior
- Dispatches `FLOOR_SELECTION_CHANGED_EVENT` on click
- Appends/removes X close button on active label
- Accepts `viewerRef` and `buildingFmGuid` props
- Returns `{ setLabelsEnabled, refreshLabels }`

**File: `src/components/viewer/AssetPlusViewer.tsx`**
- Import and initialize `useLevelLabels` hook
- Enable level labels after model load (in `handleAllModelsLoaded`)
- Pass `buildingFmGuid` for name resolution

**File: `src/hooks/usePerformancePlugins.ts`**
- After installing FastNavPlugin, enable SAO on the scene with tuned parameters
- Skip SAO on mobile (`isMobile`) for performance

**File: `src/hooks/useRoomLabels.ts`** (minor)
- No changes needed for this phase; room label isolation can be added later as an enhancement

### No database changes needed

Level names are already stored in the `assets` table and resolved by the existing `FloatingFloorSwitcher` pattern.

