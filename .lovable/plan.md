
# Plan: Fix 3D Viewer Crash and Improve Navigator Hierarchy

## Summary

This plan addresses two critical issues:
1. **3D Viewer crash during asset creation** - The asset registration flow fails because the viewer reference isn't properly connected
2. **Navigator hierarchy incomplete** - Spaces are excluded when they lack level GUID and storey linkage needs improvement

---

## Problem Analysis

### Issue 1: 3D Crash at Asset Creation

The `AssetRegistration.tsx` component creates a `viewerRef` that is never connected to the actual `AssetPlusViewer` component:

```text
AssetRegistration.tsx:
  viewerRef = useRef(null)  <-- Never connected
      ↓
  <AssetPlusViewerComponent fmGuid={...} />  <-- No ref passed
      ↓
  Form tries: viewerRef.current?.$refs?.AssetViewer...
      ↓
  Returns null → Error: "Kunde inte ansluta till 3D-vyn"
```

### Issue 2: Navigator Missing Spaces

Current data shows:
- 1843 total Spaces, 144 missing `level_fm_guid` (7.8%)
- Current fallback only works if Space has `levelCommonName` attribute
- The 144 orphan spaces have NO level attributes at all

Additionally, storeys have a `parentCommonName` field (like "B52", "B61") that represents sub-buildings, which the current logic doesn't utilize.

---

## Solution

### Part A: Fix Asset Registration Viewer Connection

**File: `src/pages/AssetRegistration.tsx`**

1. Remove the broken `viewerRef` approach entirely
2. Use a shared communication channel between viewer and form:
   - Store picked coordinates in React state lifted to parent
   - Pass a callback to `AssetPlusViewer` that receives picked coordinates
   - OR use a context/global store for coordinate picking

**Recommended approach:** Create a dedicated prop on `AssetPlusViewer` for pick mode:
- Add `onCoordinatePicked?: (coords: {x,y,z}, parentNode) => void` prop
- Add `pickModeEnabled?: boolean` prop
- When enabled, clicking surfaces triggers the callback instead of internal handling

### Part B: Improve Navigator Fallback Logic

**File: `src/context/AppContext.tsx`**

Enhance the `buildNavigatorTree` function with additional fallback strategies:

1. **Storey fallback for Spaces without level info:**
   - If Space has `building_fm_guid` but no `level_fm_guid`, and the building has ONLY ONE storey
   - Automatically assign that Space to the single storey

2. **Create "Unknown Floor" placeholder:**
   - For Spaces with `building_fm_guid` but no matchable storey
   - Create a synthetic "Okänd våning" storey under each building
   - Attach unmatched spaces there so they remain visible

3. **Consider sub-building grouping (future enhancement):**
   - The `parentCommonName` field ("B52", "B61", etc.) could create an intermediate grouping level
   - This is optional but would improve organization for complex buildings

---

## Implementation Details

### Step 1: Fix AssetRegistration.tsx

```text
Changes:
1. Remove viewerRef and related code
2. Add state for picked coordinates: pickedCoords, setPickedCoords
3. Pass props to AssetPlusViewer:
   - pickModeEnabled={isPickingCoordinates}
   - onCoordinatePicked={(coords, node) => {
       setPickedCoords(coords);
       setPickingEnabled(false);
     }}
4. Remove broken handlePickCoordinates logic from form
5. Add "Välj position" button that sets pickModeEnabled=true
```

### Step 2: Update AssetPlusViewer.tsx

```text
Changes:
1. Add new props: pickModeEnabled, onCoordinatePicked
2. Modify existing pick mode logic to call onCoordinatePicked callback
3. When pickModeEnabled changes to true, activate pick mode
4. When coordinate is picked, call callback and deactivate
```

### Step 3: Enhance AppContext.tsx Navigator Logic

```text
Changes to buildNavigatorTree():

1. After normal storey-space matching, collect orphan spaces
2. For each orphan space with building_fm_guid:
   a. Check if building has exactly 1 storey → assign there
   b. Else, add to synthetic "Okänd våning" node

3. Create synthetic storeys per building for remaining orphans:
   const syntheticStoreyMap = new Map<string, NavigatorNode>();
   
   orphanSpaces.forEach(space => {
     const buildingGuid = space.buildingFmGuid;
     if (!syntheticStoreyMap.has(buildingGuid)) {
       syntheticStoreyMap.set(buildingGuid, {
         fmGuid: `unknown-storey-${buildingGuid}`,
         category: 'Building Storey',
         commonName: 'Okänd våning',
         isSynthetic: true,
         children: [],
       });
     }
     syntheticStoreyMap.get(buildingGuid).children.push(space);
   });
```

---

## Technical Details

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/AssetRegistration.tsx` | Remove viewerRef, add coordinate state, pass props |
| `src/components/viewer/AssetPlusViewer.tsx` | Add pickModeEnabled/onCoordinatePicked props |
| `src/context/AppContext.tsx` | Add synthetic storey fallback for orphan spaces |

### New Props for AssetPlusViewer

```typescript
interface AssetPlusViewerProps {
  fmGuid: string;
  onClose?: () => void;
  // New props for external pick mode control
  pickModeEnabled?: boolean;
  onCoordinatePicked?: (
    coords: { x: number; y: number; z: number },
    parentNode: NavigatorNode | null
  ) => void;
}
```

### Synthetic Storey Structure

```typescript
{
  fmGuid: `synthetic-unknown-${buildingFmGuid}`,
  category: 'Building Storey',
  commonName: 'Okänd våning',
  name: 'Unknown Floor',
  isSynthetic: true,  // Flag for UI styling
  children: [...orphanSpaces],
}
```

---

## Expected Results

After implementation:
1. **Asset Registration:** Clicking "Välj position" will activate pick mode in the 3D viewer, and coordinates will properly flow to the form
2. **Navigator:** All 144 orphan spaces will appear under "Okänd våning" storeys in their respective buildings
3. **No data loss:** Spaces are never excluded from the tree - they're either matched or placed in fallback nodes

---

## Risk Mitigation

- The synthetic storey approach preserves all data visibility
- The pick mode changes are additive - existing viewer functionality remains intact
- Fallback logic only activates for unmatched items, not affecting already-working hierarchy
