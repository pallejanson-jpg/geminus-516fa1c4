
# Plan: Fix Asset+ Sync System and 3D Viewer Toolbars

## Overview

This plan addresses two main areas:
1. **Restructure Asset+ synchronization** with 3 clear sync types replacing the current confusing setup
2. **Fix 3D viewer toolbar issues** in both the right overflow menu and bottom navigation bar

---

## Part 1: Asset+ Synchronization Restructure

### Current Problem

The current sync UI shows confusing entries like individual building GUIDs (e.g., `42495e64-b484-4303-9a9d-5aa8f200ed03`) alongside `buildings` and `full`. The difference:
- `buildings` = Only Building records (ObjectType 1)
- `{buildingFmGuid}` = Specific building's full hierarchy (Building + Storeys + Spaces)
- `full` = All object types (stops around 40,000 due to API/memory limits)

### New Sync Structure

Replace current sync buttons with 3 clear categories:

| Sync Type | Description | Action | Technical Notes |
|-----------|-------------|--------|-----------------|
| **1. Byggnad/Plan/Rum** | Building hierarchy only | `sync-structure` | ObjectTypes 1, 2, 3 (Buildings, Storeys, Spaces) |
| **2. Alla Tillgangar** | All assets including instances | `sync-assets-chunked` | ObjectType 4 only, chunked by building to avoid 40k limit |
| **3. XKT-filer** | 3D model file caching | `cache-xkt-models` | Preload XKT files to Supabase storage |

### Technical Implementation

#### A. Backend Changes (asset-plus-sync edge function)

1. **New action: `sync-structure`**
   - Syncs only ObjectTypes 1, 2, 3 (Buildings, Building Storeys, Spaces)
   - Uses `subtree_id: 'structure'`
   - Estimated ~5,000-10,000 records (fast sync)

2. **New action: `sync-assets-chunked`**
   - Syncs ObjectType 4 (Instances/Assets) in chunks
   - Strategy: Loop through all buildings, sync assets per building
   - Uses `subtree_id: 'assets'`
   - Avoids memory issues by processing in building-sized batches

3. **New action: `cache-all-xkt`**
   - Iterates through buildings with XKT models
   - Calls existing xkt-cache service to prefetch/store models
   - Uses `subtree_id: 'xkt'`

#### B. Frontend Changes (ApiSettingsModal.tsx)

1. **Replace current sync section with 3 cards:**

```text
+------------------------------------------+
| Byggnad/Plan/Rum                    [Synka]|
| Byggnader, våningsplan och rum            |
| Status: Grön/Röd badge | 1,234 objekt     |
+------------------------------------------+
| Alla Tillgangar                     [Synka]|
| Installationer och inventarier            |
| Status: Grön/Röd badge | 38,500 objekt    |
+------------------------------------------+
| XKT-filer                          [Cacha]|
| 3D-modellfiler för snabbare laddning      |
| Status: Grön/Röd badge | 14/14 modeller   |
+------------------------------------------+
```

2. **Status indicators:**
   - Green badge when sync completed successfully
   - Red badge when out of sync or failed
   - Spinning loader during sync

---

## Part 2: 3D Viewer Toolbar Fixes

### Issue A: Right Overflow Menu Not Working

**Root Cause Analysis:**
The VisualizationToolbar uses a Sheet component. The issue is likely that:
1. The `viewerRef` might not be properly populated when the component renders
2. The Sheet trigger button renders but the Sheet content doesn't show

**Fix:**
1. Verify Sheet opens correctly by checking `isOpen` state
2. Ensure `viewerRef.current` is accessible
3. Debug the Sheet component's mounting/unmounting behavior

### Issue B: Move Items to Right Overflow Menu

Items to relocate from bottom toolbar to right menu:
- **Annotations toggle** (currently in bottom toolbar)
- **Show Rooms toggle** (add to right menu)
- **Room Visualization panel** (already in right menu, verify it works)

**Implementation:**
1. Remove `annotations` from `NAVIGATION_TOOLS` in ToolbarSettings.tsx
2. Add `annotations` to `VISUALIZATION_TOOLS`
3. Ensure all view toggles are in the right menu
4. Keep only navigation/interaction tools in bottom toolbar

### Issue C: Bottom Navigation Buttons Sporadic

**Likely Causes:**
1. `getAssetView()` returns undefined intermittently
2. Tool state not properly reset between interactions
3. Event handlers attached to elements that get recreated

**Fix:**
1. Add null checks before all viewer operations
2. Debounce rapid button clicks
3. Ensure viewer reference is stable
4. Add console logging for debugging

---

## File Changes Summary

### Backend Files

| File | Changes |
|------|---------|
| `supabase/functions/asset-plus-sync/index.ts` | Add `sync-structure`, `sync-assets-chunked`, `cache-all-xkt` actions |

### Frontend Files

| File | Changes |
|------|---------|
| `src/components/settings/ApiSettingsModal.tsx` | New sync UI with 3 cards, remove old confusing structure |
| `src/components/viewer/VisualizationToolbar.tsx` | Debug Sheet, add annotations toggle, verify all toggles work |
| `src/components/viewer/ViewerToolbar.tsx` | Remove annotations, add better null checks, improve reliability |
| `src/components/viewer/ToolbarSettings.tsx` | Move `annotations` to VISUALIZATION_TOOLS, update defaults |

---

## Technical Details

### Edge Function: sync-assets-chunked Strategy

```text
1. Get list of all buildings from local DB
2. For each building:
   a. Fetch assets (ObjectType 4) with filter: buildingFmGuid = building.fm_guid
   b. Batch insert (500 at a time)
   c. Update progress in asset_sync_state
3. Mark sync complete when all buildings processed
```

This avoids the 40,000 object limit by never requesting more than one building's assets at a time.

### XKT Cache Sync Strategy

```text
1. Query buildings from local DB
2. For each building with models:
   a. Check if XKT already cached in Supabase storage
   b. If not, fetch from Asset+ API and store
   c. Track progress in asset_sync_state with subtree_id='xkt'
```

---

## Testing Checklist

- [ ] Byggnad/Plan/Rum sync completes and shows green status
- [ ] Alla Tillgangar sync handles 40,000+ objects without timeout
- [ ] XKT cache prefetches all available models
- [ ] Right overflow menu opens and shows all options
- [ ] Annotations toggle works from right menu
- [ ] Room visualization activates from right menu
- [ ] Bottom navigation buttons respond consistently
- [ ] Tool settings changes apply immediately

---

## Priority Order

1. Fix VisualizationToolbar Sheet (blocking issue)
2. Move annotations to right menu
3. Implement 3 new sync types in backend
4. Update sync UI in ApiSettingsModal
5. Improve bottom toolbar reliability
