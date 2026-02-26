

## Analysis

### Current State: 4 Independent Implementations

There are **four separate components** that each independently implement floor/model listing, naming, and visibility:

1. **ViewerFilterPanel** (FilterPanel / "Filtermeny")
   - Lists models as "Sources" from Asset+ `allData` (Building Storey → `parentBimObjectId`/`parentCommonName`)
   - Lists floors as "Levels" from Asset+ `allData` (Building Storey objects)
   - Floor names: `commonName` from Asset+ data
   - Model visibility: maps `source::guid` → entity IDs via entity map, hides/shows per-entity
   - **Bug**: Source toggle doesn't actually work because `sourceIds` collection depends on `entityMapRef` having `source::` keys, which only get built if storeys match — and the matching is fragile

2. **ModelVisibilitySelector** (Visningsmeny / Right Panel)
   - Lists models from **xeokit scene** (`viewer.scene.models`) + `xkt_models` DB + Asset+ storey lookup
   - Model names resolved via `useModelNames` hook (DB → Asset+ API fallback) + storey lookup
   - Visibility: sets `model.objects[*].visible` per scene model
   - **Works but slow** because it iterates all objects in each model

3. **FloorVisibilitySelector** (Visningsmeny / Right Panel)
   - Lists floors from **xeokit metaScene** (`IfcBuildingStorey`)
   - Floor names: DB query to `assets` table, then metaScene fallback
   - Visibility: builds `childrenMap`, toggles per-entity, includes section plane clipping
   - **Names correct** because it queries DB with `common_name`

4. **FloatingFloorSwitcher** (Floating pills)
   - Duplicates floor extraction from metaScene + DB query (same as FloorVisibilitySelector)
   - Separate visibility logic, separate state

### Root Causes

| Problem | Cause |
|---|---|
| Models missing in Visningsmeny | `ModelVisibilitySelector.extractModels` only finds models loaded in `scene.models`; if not loaded yet it needs DB fallback but matching fails |
| Model toggle slow in Visningsmeny | Iterates ALL model objects one-by-one in JS |
| Source toggle broken in Filtermeny | `source::` entity map keys depend on fragile storey → model matching; if storeys from different models share names, mapping breaks |
| Floor names wrong in Filtermeny | Uses `allData` `commonName` directly, which can be GUID-like for some buildings; doesn't use DB `common_name` fallback |
| Inconsistent floor data | 4 separate `extractFloors`/level-listing implementations with different name resolution |

### Plan: Unify into Shared Hooks

#### Step 1: Create `useFloorData` shared hook
Extract the common floor listing logic into one hook used by all components.

**File**: `src/hooks/useFloorData.ts`

- Single source of truth for floor list
- Combines DB name lookup + xeokit metaScene extraction (same as FloorVisibilitySelector's current logic)
- Returns `floors: FloorInfo[]` and `floorNamesMap`
- Used by: FloorVisibilitySelector, FloatingFloorSwitcher, ViewerFilterPanel (levels section)

#### Step 2: Create `useModelData` shared hook  
Extract the common model listing logic.

**File**: `src/hooks/useModelData.ts`

- Single source of truth for model/source list
- Combines `useModelNames` + xeokit `scene.models` + Asset+ storey lookup (same as ModelVisibilitySelector's current logic)
- Returns `models: ModelInfo[]`
- Used by: ModelVisibilitySelector, ViewerFilterPanel (sources section)

#### Step 3: Fix ViewerFilterPanel source toggle
- Replace the broken `source::` entity map approach with the same `model.objects` approach used by ModelVisibilitySelector
- When a source is toggled, iterate `scene.models`, find models belonging to that source, toggle `model.visible`

#### Step 4: Fix ViewerFilterPanel floor names
- Replace the inline `allData` level name derivation with the shared `useFloorData` hook
- This ensures DB `common_name` is used (matches Visningsmeny behavior)

#### Step 5: Optimize model visibility toggle
- Replace per-object iteration with batch `scene.setObjectsVisible(objectIds, bool)` for speed
- Collect all object IDs for a model at once, then batch-apply

#### Step 6: Remove duplicate code
- Remove `extractFloors` from FloatingFloorSwitcher and FloorVisibilitySelector (use hook)
- Remove `fetchFloorNames` DB queries from each component (hook handles it)
- Remove duplicate `assetPlusSources` derivation from ModelVisibilitySelector (hook handles it)

### Files to Modify

| File | Change |
|---|---|
| `src/hooks/useFloorData.ts` | **New** — shared floor listing hook |
| `src/hooks/useModelData.ts` | **New** — shared model listing hook |
| `src/components/viewer/ViewerFilterPanel.tsx` | Use shared hooks for sources/levels; fix source toggle logic |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Use shared model hook; batch visibility |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Use shared floor hook |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Use shared floor hook |

### Performance Note (Småviken)
The slow loading is caused by per-object visibility iteration. Batch operations (`scene.setObjectsVisible`) will significantly improve toggle speed. The model listing itself is fast; the bottleneck is the apply step.

