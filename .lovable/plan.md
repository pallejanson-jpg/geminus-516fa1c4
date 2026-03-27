

## Plan: Upgrade XKT Viewer, Fix Space Heuristic, Map IFC Categories Properly

### Problem Summary
1. **Viewer broken**: Bundled xeokit-sdk (v2.4-era) only supports XKT v1-v10. Browser `@xeokit/xeokit-convert@^1.3.1` outputs XKT v12.
2. **5067 spaces instead of 272**: The heuristic in `ifc-extract-systems` classifies any storey child whose name contains a digit as `IfcSpace` — captures walls, windows, etc.
3. **IFC categories not mapped**: All IFC instances get `category: "Instance"` in the DB. The `asset_type` stores the IFC type (e.g. `IfcWall`) but the viewer filter panel expects mapped category names like "Wall", "Door". No mapping is applied at import time.
4. **Same issues apply to ACC imports**: ACC instances also need proper category mapping and the viewer filter panel needs consistent categories.

### Task 1: Upgrade Bundled xeokit-sdk to v2.6.x (supports XKT v12)

**File: `public/lib/xeokit/xeokit-sdk.es.js`**
- Replace with latest `@xeokit/xeokit-sdk@2.6.107` ES module build from npm/CDN
- This adds `ParserV11` and `ParserV12` to the parsers list, making XKT v12 files loadable
- No need to downgrade `@xeokit/xeokit-convert` — keep `^1.3.1`

**Risk**: The new SDK may have API changes. The viewer code uses `Viewer`, `XKTLoaderPlugin`, `GLTFLoaderPlugin`, `NavCubePlugin`, `FastNavPlugin`, etc. The v2.6 API is backward-compatible with v2.4 for these core classes, but we should verify the build still works.

### Task 2: Fix Space Heuristic — Stop Misclassifying Elements

**File: `supabase/functions/ifc-extract-systems/index.ts`** (lines 176-187)

Current broken heuristic:
```
const looksLikeRoom = /\d/.test(name) || spaceChildren.length > 0;
```

Replace with a strict room-name pattern:
- Match room-number patterns: `01.3.082`, `Rum 203`, `Room 1`, `A-201`, `1:234`
- Exclude product codes: `GNT100S 55x119`, `YT_01`, names with `x` dimensions
- Exclude nodes with 50+ children (type groups, not rooms)
- Pattern: `/^(\d{1,4}[\.\-\:]\d|rum\s|room\s)/i` or similar

### Task 3: Map IFC Categories to Geminus Categories at Import Time

**File: `supabase/functions/ifc-to-xkt/index.ts`** (Pass 3, line 478)

Currently: `category: "Instance"` for all non-spatial objects.

Add a mapping table (same as `CATEGORY_TO_IFC` in ViewerFilterPanel):
```
IfcWall → "Wall", IfcDoor → "Door", IfcWindow → "Window",
IfcSlab → "Slab", IfcColumn → "Column", etc.
```

For unmapped IFC types, fall back to `"Instance"`. Store the mapped category in `category` and keep the raw IFC type in `asset_type`.

**File: `supabase/functions/ifc-extract-systems/index.ts`**
- Apply the same category mapping when populating instances from metadata fallback

### Task 4: Apply Same Category Mapping to ACC Import

**File: `supabase/functions/acc-sync/index.ts`**

The ACC sync uses Revit categories from the Model Properties API (e.g. `"Walls"`, `"Doors"`, `"Windows"`). Map these to the same Geminus categories:
```
Walls → "Wall", Doors → "Door", Windows → "Window",
Floors → "Slab", Roofs → "Roof", Columns → "Column", etc.
```

Store mapped category in `category` column instead of raw `"Instance"`.

### Task 5: Clean Up SV Building Data

**Database cleanup** (one-time migration or manual):
- Delete duplicate `xkt_models` for building SV, keeping only latest per model name
- Delete misclassified space records (5067 → should be ~272)
- After fixes are deployed, user re-imports to get clean data

### Technical Details

| File | Change |
|---|---|
| `public/lib/xeokit/xeokit-sdk.es.js` | Replace with v2.6.107 build (adds XKT v11/v12 support) |
| `supabase/functions/ifc-extract-systems/index.ts` | Fix room heuristic; add IFC→Geminus category mapping for instances |
| `supabase/functions/ifc-to-xkt/index.ts` | Add IFC→Geminus category mapping for instances |
| `supabase/functions/acc-sync/index.ts` | Add Revit→Geminus category mapping for instances |
| `package.json` | Keep `@xeokit/xeokit-convert@^1.3.1` (no change needed) |

### Shared Category Mapping (used in all import paths)

```text
IFC Type              Revit Category     Geminus Category
─────────────────────────────────────────────────────────
IfcWall               Walls              Wall
IfcDoor               Doors              Door
IfcWindow             Windows            Window
IfcSlab               Floors             Slab
IfcRoof               Roofs              Roof
IfcStair              Stairs             Stair
IfcColumn             Columns            Column
IfcBeam               Structural Framing Beam
IfcCovering           Ceilings           Covering
IfcRailing            Railings           Railing
IfcCurtainWall        Curtain Panels     Curtain Wall
IfcFurnishingElement  Furniture          Furnishing
IfcFlowTerminal       Mechanical Equip.  Flow Terminal
IfcPipeSegment        Pipes              Pipe
IfcDuctSegment        Ducts              Duct
IfcBuildingElementProxy  Generic Models  Proxy
(unmapped)            (unmapped)         Instance
```

