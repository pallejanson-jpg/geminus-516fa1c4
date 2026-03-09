

## Plan: Fix IFC Import — Missing Hierarchy + Portfolio Visibility

### Root Cause Analysis (from logs)

**Conversion jobs status:**
- Building `47787b90` (A1): Job stuck at `pending` but XKT was uploaded via browser — hierarchy extraction never ran
- Building `4d9c7202` (Smedvid/A-1): Job stuck at `processing` (30%) — edge function hit WORKER_LIMIT, browser fallback never triggered
- All older jobs: Same pattern — stuck at 30% ("Parsing IFC from disk...")

**Missing hierarchy:** Both buildings have ZERO storeys, spaces, or assets in the `assets` table. The browser-side `runBrowserConversion` function uploads the XKT file and metadata.json, but **never persists the extracted levels/spaces to the `assets` table** and never calls `asset-plus-create-hierarchy`.

**Portfolio not showing buildings:** `PortfolioView` (line 62-66) filters out buildings with 0 storeys AND 0 spaces — so newly imported buildings are invisible in Portfolio.

### Answer: Everything can be solved in Lovable

No external installation is needed. The external worker (Fly.io/Railway) described in the tips is an optimization for very large files (500MB+), but the browser-side conversion already works for the XKT geometry. The missing piece is just persisting the extracted hierarchy data to the database, which is purely frontend code.

### Changes Required

#### 1. `src/components/settings/CreateBuildingPanel.tsx` — Persist hierarchy from browser conversion

After `runBrowserConversion` extracts `result.levels` and `result.spaces`, add logic to:

- **Insert levels as assets** in the local DB (`category: 'Building Storey'`, with `building_fm_guid`)
- **Insert spaces as assets** in the local DB (`category: 'Space'`, with `building_fm_guid` and `level_fm_guid`)
- **Call `asset-plus-create-hierarchy`** edge function (same as the server-side path already does on lines 320-347) to create these in Asset+
- This goes after the XKT upload (around line 460) and before marking the job as done

#### 2. `src/components/portfolio/PortfolioView.tsx` — Show buildings without hierarchy

Change the filter (lines 62-66) to also include buildings that have XKT models but no storeys/spaces yet. This ensures newly imported buildings appear immediately, even before hierarchy is fully synced.

Alternative: remove the filter entirely and show all buildings from `navigatorTreeData` — the filter was added to hide empty duplicates but is now hiding legitimate new imports.

#### 3. `src/components/settings/CreateBuildingPanel.tsx` — Fix stuck "pending" jobs

When browser conversion starts, update the job status to `'processing'` immediately so the UI reflects actual state.

### Technical Detail

The hierarchy persistence in `runBrowserConversion` will follow this pattern:

```text
result.levels → for each level:
  - Generate fmGuid
  - Insert into assets (category: 'Building Storey', building_fm_guid, name)

result.spaces → for each space:
  - Generate fmGuid  
  - Find parent level fmGuid from level map
  - Insert into assets (category: 'Space', building_fm_guid, level_fm_guid, name)

Then call asset-plus-create-hierarchy edge function with the same data
```

### Files to Change
1. `src/components/settings/CreateBuildingPanel.tsx` — Add hierarchy persistence + fix job status
2. `src/components/portfolio/PortfolioView.tsx` — Relax empty-building filter

