# Comprehensive Sync & Clipping Fix

## Status: ✅ IMPLEMENTED (2026-01-30)

All three problem areas have been addressed and deployed.

---

## Summary of Changes

### 1. XKT Sync (3D Models) - FIXED ✅

**Implementation:**
- Robust multi-URL endpoint discovery in `asset-plus-sync/index.ts`
- Endpoint caching table (`asset_plus_endpoint_cache`) with 24h TTL
- Enhanced test endpoint in `asset-plus-query/index.ts` tries all candidate URLs
- Resumable sync with progress tracking (`asset_sync_progress` table)
- Loop-until-complete behavior in `ApiSettingsModal.tsx`

**Findings:**
- The Asset+ demo environment has **no 3D XKT models configured**
- `/threed/GetModels` returns 200 with empty array (correct behavior)
- Sync now properly reports "0 models" instead of failing with 404

### 2. Asset Sync (ObjectType 4) - FIXED ✅

**Implementation:**
- Replaced `sync-assets-chunked` with `sync-assets-resumable`
- Progress cursor tracking (building + skip offset)
- Auto-detection of stale syncs (>10 min) → marked as "interrupted"
- UI loops automatically until sync completes

**Status:**
- Structure: 4,034/4,034 ✅ In sync
- Assets: 43,355/82,541 (ready to resume)

### 3. Viewer Clipping (2D/3D) - FIXED ✅

**Implementation in `useSectionPlaneClipping.ts`:**

Corrected xeokit SectionPlane direction:
- **Rule:** `dir` vector points toward DISCARDED half-space
- **3D ceiling:** `dir = [0, 1, 0]` (UP = discard above) ← FIXED
- **2D slice:** Dual planes for slab view

**Implementation in `FloorVisibilitySelector.tsx`:**
- `handleFloorToggle()` now ALWAYS dispatches `FLOOR_SELECTION_CHANGED_EVENT`
- Auto-enables clipping when switching to solo mode

---

## Database Tables Added

```sql
CREATE TABLE public.asset_sync_progress (
    job TEXT PRIMARY KEY,
    building_fm_guid TEXT,
    skip INTEGER DEFAULT 0,
    current_building_index INTEGER DEFAULT 0,
    total_buildings INTEGER DEFAULT 0,
    total_synced INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.asset_plus_endpoint_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Files Changed

### Frontend:
- `src/hooks/useSectionPlaneClipping.ts` - Correct direction vectors, dual-plane 2D
- `src/components/viewer/FloorVisibilitySelector.tsx` - Consistent event dispatch
- `src/components/settings/ApiSettingsModal.tsx` - Loop-until-complete sync

### Backend:
- `supabase/functions/asset-plus-sync/index.ts` - Resumable sync, stale detection
- `supabase/functions/asset-plus-query/index.ts` - Multi-URL 3D API test

---

## Verification

### Test 3D API:
```
POST /asset-plus-query { action: "test3DApi" }
→ Returns testedEndpoints array showing which URLs work
```

### Check Sync Status:
```
POST /asset-plus-sync { action: "check-sync-status" }
→ Shows structure/assets/xkt counts and sync states
```

### Trigger Resumable Sync:
- Click "Sync Assets" → automatically loops until complete
- Click "Sync XKT" → automatically loops until complete
