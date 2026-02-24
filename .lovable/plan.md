

## Plan: Floor Switcher Fix, English Translation, Level Labels Removal, and XKT Performance Strategy

### Summary

| # | Issue | File(s) | Effort |
|---|---|---|---|
| 1 | Revert all UI text to English | ~10 files | Medium |
| 2 | Reduce FloatingFloorSwitcher vertical height + add "Show all" | `FloatingFloorSwitcher.tsx` | Easy |
| 3 | Remove level labels | `AssetPlusViewer.tsx`, `VisualizationToolbar.tsx`, `ViewerToolbar.tsx` | Easy |
| 4 | Småviken 3D debugging | Investigation | See analysis below |
| 5 | XKT performance strategy (research output) | N/A - documentation | N/A |

---

### 1. Revert All UI Text to English

The previous message translated many labels to Swedish. All UI must be English. Key files and changes:

**ViewerFilterPanel.tsx:**
- "Visa alla" → "Show all"
- "Källor" → "Sources"
- "Våningar" → "Levels"
- "Rum" → "Spaces"
- "Kategorier" → "Categories"
- "Annotationer" → "Annotations"
- "Inga källor hittades" → "No sources found"
- "Ingen träff" → "No match"
- "Inga rum på vald våning" → "No spaces on selected level"
- "Visar 200 av X rum" → "Showing 200 of X spaces"
- X-ray tooltip text

**ViewerRightPanel.tsx:**
- Any Swedish section headers back to English

**ViewerContextMenu.tsx:**
- "Isolera objekt" → "Isolate object"
- "Dölj objekt" → "Hide object"
- "Visa alla" → "Show all"

**HomeLanding.tsx:**
- "Senaste" → "Recent"
- "Sparade vyer" → "Saved Views"

**FacilityLandingPage.tsx:**
- "Sparade vyer" → "Saved Views"

**ProfileModal.tsx:**
- "Mina assistenter" → "My Assistants"

**Dashboard.tsx:**
- "Senaste aktivitet" → "Recent Activity"
- Other Swedish labels back to English

**AppHeader.tsx / sidebar-config.ts:**
- Verify all navigation labels are English

**FloatingFloorSwitcher.tsx:**
- Tooltip text: "Del av selektion" → "Part of selection", "Ej isolerad" → "Not isolated"

**Other files with Swedish text** (ModelVisibilitySelector, AnnotationCategoryList, FloorVisibilitySelector, etc.) will be checked and reverted.

---

### 2. Reduce FloatingFloorSwitcher Vertical Height + Add "Show All"

**Problem:** The pill container has a fixed dark background that extends far below the last pill (as shown in the red-outlined area of the screenshot). The container uses `h-auto` but the `gap-0.5` and pill sizes create unnecessary vertical space.

**Fix in FloatingFloorSwitcher.tsx:**
- The container already uses `h-auto` (line 523), so the dark area below is likely from padding or the container not fitting tightly. Reduce `p-0.5` and `gap-0.5` to minimal values.
- Add a "Show all" pill at the bottom of the list that resets to all floors visible (double-click currently does this, but an explicit button is clearer):
  ```tsx
  <Button
    variant="ghost"
    size="sm"
    className="h-7 w-8 sm:h-7 sm:w-9 p-0 text-[9px] font-medium rounded-full bg-muted/30 text-muted-foreground"
    onClick={handleShowAllFloors}
    title="Show all floors"
  >
    All
  </Button>
  ```
- The `handleShowAllFloors` function sets all floor IDs as visible and dispatches the appropriate event.

---

### 3. Remove Level Labels

Disable the level labels feature entirely for now by:

**AssetPlusViewer.tsx (line 272):**
- Comment out or remove `useLevelLabels` hook call
- Remove the `setLevelLabelsEnabled` usage

**VisualizationToolbar.tsx:**
- Remove the level labels toggle from the visualization settings menu

**ViewerToolbar.tsx:**
- Remove any level labels toggle reference

The hook file `useLevelLabels.ts` itself can remain for future use but will not be called.

---

### 4. Småviken 3D Analysis

The console logs captured show **Akerselva Atrium** (fmGuid `a8fe5835-...`), not Småviken. No Småviken-specific logs were captured, meaning the user may have navigated away before sending the message, or the model failed to even start loading.

Key observations from the logs:
- The log says `XKT filter: Initial load restricted to 1 A-model(s) out of 2` -- this is normal for the selective loading strategy
- `Built metaObject lookup map with 0 entries` -- suggests the model loaded but metaScene was empty for that building
- `Model data or models array is not available` -- Asset+ viewer error when calling `getAnnotations`

**To debug Småviken specifically**, we need to:
1. Check what `building_fm_guid` Småviken maps to
2. Query the `xkt_models` table for that guid
3. Check if the A-model XKT file exists and is accessible

Without Småviken-specific logs, we cannot diagnose further in this session. The user should try opening Småviken and sending another message while on that page.

---

### 5. XKT Performance Strategy (Tandem/Dalux Benchmarking)

Based on the previous competitive analysis, here is the strategic direction for improving XKT loading performance:

```text
┌─────────────────────────────────────────────────────────────┐
│              Current State: Monolithic XKT v10              │
│                                                             │
│  - Single large .xkt file per model (can be 30+ MB)        │
│  - Full download before any geometry appears                │
│  - Memory-intensive: entire model in GPU memory at once     │
│  - Cache helps on repeat visits but first load is slow      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            Phase 1: Multi-Part XKT Splitting                │
│                                                             │
│  Split each model into per-storey or per-discipline XKT     │
│  chunks during the conversion pipeline:                     │
│                                                             │
│  Building_A.xkt → A_Floor01.xkt (2MB)                      │
│                  → A_Floor02.xkt (1.5MB)                    │
│                  → A_Floor03.xkt (3MB)                      │
│                  → ...                                      │
│                                                             │
│  Benefits:                                                  │
│  - Progressive rendering (first floor appears in <2s)       │
│  - Priority loading (load visible floor first)              │
│  - Smaller individual fetches = better cache hit rate        │
│  - Can unload off-screen floors from GPU memory             │
│                                                             │
│  Implementation:                                            │
│  - Modify acc-sync pipeline to split by IfcBuildingStorey   │
│  - Update xkt_models table: add parent_model_id, storey_id │
│  - Update AssetPlusViewer loader to load chunks in order    │
│  - Priority queue: visible floor → adjacent → rest          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│        Phase 2: OTG-Style Request Chunking                  │
│                                                             │
│  Similar to Autodesk Tandem's SVF2/OTG format:              │
│                                                             │
│  - Separate geometry meshes from property data              │
│  - Load geometry first (visual), properties on demand       │
│  - Use shared geometry instancing (common objects like       │
│    doors, windows use same mesh definition)                 │
│  - Stream mesh data via range requests                      │
│                                                             │
│  This requires xeokit SDK v2.6+ which supports:             │
│  - SceneModel streaming API                                 │
│  - Instanced geometry references                            │
│  - Incremental scene graph building                         │
│                                                             │
│  Benefits:                                                  │
│  - 3-5x reduction in total download size (instancing)       │
│  - First paint in <1s for any model size                    │
│  - Memory-efficient: only loaded meshes in GPU              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│         Phase 3: Dalux-Style Tile Streaming                 │
│                                                             │
│  Spatial tiling with LOD (Level of Detail):                 │
│                                                             │
│  - Pre-process model into spatial tiles (octree)            │
│  - Each tile has multiple LOD levels                        │
│  - Stream tiles based on camera frustum + distance          │
│  - Near tiles = high detail, far tiles = low detail         │
│  - Unload tiles that leave the frustum                      │
│                                                             │
│  This is the most advanced approach and matches what        │
│  Dalux and Google Maps 3D use for infinite-scale models.    │
│                                                             │
│  Requires:                                                  │
│  - Custom tile generation pipeline                          │
│  - LOD mesh simplification (e.g., meshoptimizer)            │
│  - Spatial index (R-tree or octree) stored alongside tiles  │
│  - Client-side tile manager with prefetch logic             │
└─────────────────────────────────────────────────────────────┘
```

**Recommended immediate action (Phase 1)** is the most practical: split XKT files by storey during the existing conversion pipeline. This gives the biggest UX improvement (progressive loading) with the least architectural change. The current `xkt_models` table and `AssetPlusViewer` loader can be extended to support multi-part models without breaking the existing flow.

---

### Files to Modify

| File | Changes |
|---|---|
| `src/components/viewer/ViewerFilterPanel.tsx` | Swedish → English text |
| `src/components/viewer/ViewerRightPanel.tsx` | Swedish → English text |
| `src/components/viewer/ViewerContextMenu.tsx` | Swedish → English text |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Tighten height, add "All" button, English tooltips |
| `src/components/viewer/AssetPlusViewer.tsx` | Remove useLevelLabels call |
| `src/components/viewer/VisualizationToolbar.tsx` | Remove level labels toggle |
| `src/components/viewer/ViewerToolbar.tsx` | Remove level labels reference |
| `src/components/home/HomeLanding.tsx` | Swedish → English |
| `src/components/portfolio/FacilityLandingPage.tsx` | Swedish → English |
| `src/components/settings/ProfileModal.tsx` | Swedish → English |
| `src/pages/Dashboard.tsx` | Swedish → English |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Swedish → English |
| `src/components/viewer/AnnotationCategoryList.tsx` | Swedish → English |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Swedish → English |

