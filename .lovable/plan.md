

## Fix: 2D FMA Panel Disappears After Loading

### Problem
When navigating from Portfolio to the 2D FMA view, the panel briefly appears then vanishes. This happens because:

1. `hasFmAccess` is initially `true` (URL has a floor parameter)
2. An async database check queries `building_external_links` for `fm_access` rows
3. No such rows exist, so `hasFmAccess` flips to `false`
4. On mobile, both the 2D button and panel are gated by `hasFmAccess` alone, so they disappear

### Solution
Update the `hasFmAccess` determination to also consider:
- Whether the building has `fm_access_building_guid` configured in `building_settings` (which it does -- the value is already loaded via `buildingData.fmAccessBuildingGuid`)
- Whether the URL explicitly requests 2D mode with a floor parameter

### Changes

**File: `src/pages/UnifiedViewer.tsx`**

1. **Update `hasFmAccess` effect** (lines 70-79): Add `buildingData.fmAccessBuildingGuid` as a source of truth. If the building has an FM Access GUID configured, `hasFmAccess` should be `true` regardless of `building_external_links`.

2. **Fix mobile panel guard** (line 580): Change from `{hasFmAccess && (` to `{(hasFmAccess || floorFmGuid) && (` to match the desktop behavior.

3. **Fix mobile button guard** (line 558): Change from `{hasFmAccess && (` to `{(hasFmAccess || floorFmGuid) && (` so the 2D tab stays visible.

4. **Fix desktop mode button** (line 334): Change from `{hasFmAccess && (` to `{(hasFmAccess || floorFmGuid) && (` for consistency.

### Technical Details

The `hasFmAccess` effect will be updated to:

```text
useEffect(() => {
  if (buildingData?.fmAccessBuildingGuid) {
    setHasFmAccess(true);
    return; // No need to query building_external_links
  }
  if (!buildingData?.fmGuid) return;
  supabase
    .from('building_external_links')
    .select('id')
    .eq('building_fm_guid', buildingData.fmGuid)
    .eq('system_name', 'fm_access')
    .limit(1)
    .then(({ data }) => setHasFmAccess((data?.length ?? 0) > 0));
}, [buildingData?.fmGuid, buildingData?.fmAccessBuildingGuid]);
```

Additionally, all three render guards (mobile button, mobile panel, desktop mode button) will use `(hasFmAccess || floorFmGuid)` as fallback to ensure the 2D view remains accessible when explicitly navigated to.

### Files Changed
- `src/pages/UnifiedViewer.tsx` -- fix hasFmAccess logic and render guards

