

# Plan: Viewer Improvements, Inventory Panel, Homepage V2 & Ilean in Geminus AI

This covers 7 distinct changes across the codebase.

---

## 1. Homepage V2 — Two-Column Desktop Layout (Test Page)

Create `src/pages/HomeLandingV2.tsx` as a standalone page at route `/home-v2` (public, no auth, no nav link — same pattern as `/presentation`).

- Copy the structure from `HomeLanding.tsx` but use `max-w-7xl` with `lg:grid-cols-[1fr_320px]`
- Left column: AI Assistants, Recent Buildings carousel, Saved Views carousel (existing content)
- Right column (desktop only): "Portfolio Summary" card with live KPIs fetched from `assets` and `work_orders` tables (total buildings, total area, open work orders, active issues) + "Recent Activity" feed from `work_orders` ordered by `created_at` desc, limit 8

**Files:** `src/pages/HomeLandingV2.tsx`, `src/App.tsx` (add route)

---

## 2. Ilean Document Q&A Tool in Geminus AI (Gunnar)

Add an `ask_document_question` tool to `supabase/functions/gunnar-chat/index.ts`:

- Tool definition: `name: "ask_document_question"`, params: `question` (string), `context_level` (building/floor/room), `context_fm_guid` (optional)
- Implementation: calls `senslinc-query` function internally with `action: 'ilean-ask'`, reusing the same Ilean API logic already in place
- Also queries the `documents` table for Geminus-managed documents (vectorized via `index-documents` function) as a secondary source
- Response appears inline in Gunnar's markdown output — no UI changes needed

**Files:** `supabase/functions/gunnar-chat/index.ts`

---

## 3. Floor Switcher Logic Alignment with Filter Panel

**Problem:** The floating floor switcher (`FloatingFloorSwitcher.tsx`) dispatches events via `applyAndDispatch` but does NOT apply xeokit visibility itself (it relies on `useFloorVisibility`). The filter panel applies visibility directly via `applyFilterVisibility`. When both are active, they conflict.

**Current gap:** When the filter panel selects a level, it dispatches `FLOOR_SELECTION_CHANGED_EVENT` with `visibleFloorFmGuids`. The floating switcher receives this and updates its pills (already fixed in prior change). However, the floating switcher's own click logic uses `applyFloorVisibility` from `useFloorVisibility` hook which uses a different mechanism (descendant-based hide/show) than the filter panel's `applyFilterVisibility`.

**Fix:** When the filter panel is open and dispatches a floor event, the floating switcher should update its pills but NOT re-apply its own floor visibility (to avoid conflicting with the filter panel's richer logic). Add a flag in the event detail like `fromFilterPanel: true` that the switcher checks before calling `applyAndDispatch`.

**Files:** `src/components/viewer/FloatingFloorSwitcher.tsx`, `src/components/viewer/ViewerFilterPanel.tsx`

---

## 4. Filter Panel Performance

The filter panel's `applyFilterVisibility` runs inside a `requestAnimationFrame` but iterates ALL scene objects multiple times per filter change. Key optimizations:

- Debounce the filter application (use a 150ms debounce instead of raw RAF)
- Skip `applyArchitectColors(viewer)` on every filter change — only apply once when panel opens
- Cache the entity-to-IFC-type mapping instead of rebuilding from `metaScene.metaObjects` on every call
- Batch `entity.colorize` assignments using scene batch methods where possible

**Files:** `src/components/viewer/ViewerFilterPanel.tsx`

---

## 5. Filter Panel Bugs

### 5a. Source naming — GUID shown instead of friendly name
In `sources` useMemo (line 200), the fallback `model.name` check uses a regex that only catches UUID-format GUIDs. Some model names contain GUID-like strings that don't match. Fix: also check against `model.shortName` and fall back to `Modell ${index + 1}` if name still looks like a GUID.

### 5b. Room count drops to 0 when floor selected
The `spaces` useMemo (line 217-253) builds `visibleLevelGuids` from `checkedLevels` but compares against `a.levelFmGuid` using `normalizeGuid`. The issue is that `levels[].fmGuid` comes from `floor.databaseLevelFmGuids[0]` which may not match `a.levelFmGuid` after normalization if the Asset+ data uses different GUID formatting. Fix: build `visibleLevelGuids` from ALL `databaseLevelFmGuids` of checked floors (not just the level fmGuid), and also try matching by floor name as fallback.

### 5c. Spaces should show room name AND number
Currently `FilterRow` only shows `space.name` (commonName). Add room number (designation) from `buildingData` as a secondary label. Change the `spaces` useMemo to also capture `designation` and render it in the `FilterRow` label as `"name (number)"` or as a badge.

**Files:** `src/components/viewer/ViewerFilterPanel.tsx`

---

## 6. Inventory Panel (Tandem-style Asset List in Viewer)

Create `src/components/viewer/InventoryPanel.tsx` — a bottom drawer panel (same pattern as `InsightsDrawerPanel.tsx`) that shows ALL assets for the current building in a table format.

**Layout:**
- Slides up from bottom, same height as InsightsDrawerPanel (400px desktop, fullscreen mobile)
- Header: "INVENTORY (count)" with "Assets only" toggle, column selector, Export, Import buttons
- Table columns: Name, Level, Rooms, Classification, Assembly, Category, GUID, Source, System Type, Systems
- Data source: `assets` table filtered by `building_fm_guid`, joined with `systems` and `asset_system`
- Filtering: listens for `FLOOR_SELECTION_CHANGED_EVENT` and `checkedCategories` to narrow displayed assets in sync with the filter panel
- "Follow selection" checkbox: when checked, clicking an asset in the list selects it in 3D and flies camera to it

**Integration:** Add "Inventory" button to `GeminusPluginMenu.tsx` menu items, and/or add to ViewerToolbar.

**Files:** `src/components/viewer/InventoryPanel.tsx`, `src/components/viewer/GeminusPluginMenu.tsx` or `src/pages/UnifiedViewer.tsx`

---

## Implementation Order

1. Filter panel bugs (5a, 5b, 5c) — quick fixes, high value
2. Filter panel performance (4) — debounce + caching
3. Floor switcher alignment (3) — event flag coordination
4. Inventory panel (6) — new component, medium effort
5. Ilean in Gunnar (2) — edge function update
6. Homepage V2 (1) — new page, independent

