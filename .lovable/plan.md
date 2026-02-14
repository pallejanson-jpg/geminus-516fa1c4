

## Fix: 2D FMA Panel on Mobile — Missing Props and Structural Issues

### Problem Summary
After 50+ iterations, the core issue has been obscured by cache-related errors. Here is the definitive analysis of what's actually wrong with the 2D FMA viewer:

### Issue 1: Mobile FmAccess2DPanel Missing Critical Props
The mobile `FmAccess2DPanel` (line 586-593) does NOT receive `floorId` or `floorName`. Without these, the edge function cannot resolve the correct drawing and will either show an error or a wrong/empty drawing.

**Desktop (correct):**
```text
<FmAccess2DPanel
  buildingFmGuid={buildingData.fmGuid}
  floorId={floorFmGuid || undefined}        <-- present
  floorName={floorName || undefined}         <-- present
  fmAccessBuildingGuid={...}
  buildingName={buildingData.name}
/>
```

**Mobile (broken):**
```text
<FmAccess2DPanel
  buildingFmGuid={buildingData.fmGuid}
                                              <-- floorId MISSING
                                              <-- floorName MISSING
  fmAccessBuildingGuid={...}
  buildingName={buildingData.name}
/>
```

### Issue 2: `floorName` Never Passed to MobileUnifiedViewer
The `MobileUnifiedViewer` component receives `floorFmGuid` (line 280) but `floorName` is never passed as a prop nor declared in the interface (line 529).

### Issue 3: FmAccess2DPanel Retry Button is Broken
The "Forsok igen" button (lines 94-105) sets `loading=true` and `error=null`, then sets `viewerUrl=null`. But the `useEffect` (line 31) depends on `[buildingFmGuid, floorId, floorName, fmAccessBuildingGuid, buildingName]` — none of which change, so the effect never re-fires. The panel stays stuck on "Laddar 2D-ritning..." forever.

### Issue 4: `hasFmAccess` Race Condition (Previously Identified)
The `building_external_links` table has ZERO rows with `system_name = 'fm_access'`. The only source of truth is `building_settings.fm_access_building_guid`. The current code (lines 70-83) correctly handles this by checking `fmAccessBuildingGuid` first, which is good.

### Changes

**File: `src/pages/UnifiedViewer.tsx`**

1. Add `floorName` to MobileUnifiedViewer props interface (around line 529):
   - Add `floorName: string;` to the props type

2. Pass `floorName` when rendering MobileUnifiedViewer (around line 266):
   - Add `floorName={floorName}` prop

3. Pass `floorId` and `floorName` to mobile FmAccess2DPanel (around line 588):
   - Add `floorId={floorFmGuid || undefined}`
   - Add `floorName={floorName || undefined}`

**File: `src/components/viewer/FmAccess2DPanel.tsx`**

4. Fix retry button (lines 94-105):
   - Add a `retryCount` state variable
   - Include it in the `useEffect` dependency array
   - Increment it in the retry button's `onClick`

### Files Changed
- `src/pages/UnifiedViewer.tsx` — pass missing floorId/floorName to mobile
- `src/components/viewer/FmAccess2DPanel.tsx` — fix retry mechanism

