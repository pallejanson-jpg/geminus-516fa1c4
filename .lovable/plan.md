

## Plan: Improved FmAccess2DPanel Fallback + Fix Nameless Storeys

### Part 1: Better Fallback View in FmAccess2DPanel

**File: `src/components/viewer/FmAccess2DPanel.tsx`**

Update the error state to display contextual information about which building and floor could not be loaded:

- Show building name and floor name in the error view (e.g. "Kunde inte ladda ritning for Småviken, Plan 01")
- Add a "Byt våning" (Change floor) button that dispatches a custom event or calls an `onChangeFloor` callback prop
- Add a new optional `onChangeFloor` prop to the interface
- If no `floorName` was provided, show "Ingen våning vald" (No floor selected) with the change-floor button prominently

**File: `src/pages/UnifiedViewer.tsx`**

- Pass an `onChangeFloor` callback to `FmAccess2DPanel` in both desktop and mobile render paths. This callback switches the view mode back to 3D (where the floor switcher is available).

### Part 2: Fix Nameless Storeys Display

The root cause is that Asset+ returns storeys where both `commonName` and `designation` are null. This is source data and cannot be changed in the sync. However, we can improve how these are displayed.

**File: `src/context/AppContext.tsx`** (in `buildNavigatorTree`)

When building storey nodes, if both `commonName` and `name` are null, try to derive a name from the rooms underneath by looking at room designation patterns (e.g. rooms "01.2.095", "01.2.082B" share prefix "01.2" which could indicate a floor identifier). If no pattern can be derived, use "Våning (okänt namn)" instead of "(unnamed)".

Alternatively, simpler approach: check if a storey has `attributes.designation` or `attributes.levelNumber` that could be used. From the database query, the attributes for the null-name storeys show `levelNumber: null` and `designation: null`, so we need the pattern-based approach or a simple fallback.

**Simpler approach chosen**: Since these storeys genuinely have no name in the source system, we'll use the `parentCommonName` from attributes (which is "A-modell") combined with an index to generate a display name like "A-modell (våning 1)", or simply show "Namnlös våning" with the count of rooms underneath as context.

**File: `src/components/navigator/TreeNode.tsx`**

No change needed here - the label fallback `(unnamed)` is fine as a last resort but will be avoided by the AppContext fix.

### Technical Details

**FmAccess2DPanel.tsx changes:**
- Add `onChangeFloor?: () => void` to `FmAccess2DPanelProps`
- In the error render block, add contextual text: building name, floor name
- Add "Byt våning" button that calls `onChangeFloor`
- Add a "no floor selected" state when `floorId` and `floorName` are both empty

**AppContext.tsx changes (buildNavigatorTree):**
- After building the storey map (around line 410-414), iterate storeys that have no `commonName` and no `name`
- Attempt to use `attributes.parentCommonName` + a numeric suffix as the display name
- Fallback to "Namnlos vaning" with child count hint

**UnifiedViewer.tsx changes:**
- In both desktop and mobile `FmAccess2DPanel` instances, pass `onChangeFloor` callback that sets `viewMode` back to `'3d'`

### Files Changed
- `src/components/viewer/FmAccess2DPanel.tsx` -- enhanced error/fallback UI
- `src/pages/UnifiedViewer.tsx` -- pass onChangeFloor callback
- `src/context/AppContext.tsx` -- derive names for nameless storeys
