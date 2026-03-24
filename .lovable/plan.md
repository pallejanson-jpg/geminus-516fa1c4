

# Plan: Fix Småviken Levels + Mobile Viewer Settings

## Root Cause

The filter panel's `levels` memo (line 242) takes the `sharedFloors` path whenever `sharedFloors.length > 0`. For Småviken, the xeokit scene exposes only 2 partial/unnamed storeys from the A-model, so `sharedFloors` returns 2 items. This blocks the fallback path (line 288) which would correctly produce 10 storeys from the `assets` table.

The fix: when `sharedFloors` exists but looks incomplete compared to `storeyAssets` from the DB, prefer the DB-driven list.

## Changes

### 1. Fix levels selection logic in ViewerFilterPanel
**File: `src/components/viewer/ViewerFilterPanel.tsx`** (lines 239-319)

Replace the simple `if (sharedFloors.length > 0)` guard with a quality check:

```
const aModelStoreys = storeyAssets.filter(s => 
  s.sourceName && !isGuid(s.sourceName) && isArchitecturalModel(s.sourceName)
);

// Use sharedFloors only if they are MORE complete than DB storeys
// If DB has significantly more A-model storeys, prefer DB as source of truth
if (sharedFloors.length > 0 && (aModelStoreys.length === 0 || sharedFloors.length >= aModelStoreys.length * 0.7)) {
  // ... existing sharedFloors mapping (lines 243-285)
} else if (aModelStoreys.length > 0) {
  // Use DB-driven A-model storeys (existing fallback logic, lines 289-318)
} else {
  // Final fallback: all storeyAssets
}
```

This means: if the DB says there are 10 A-model storeys but the scene only found 2, prefer the DB list. The 0.7 threshold allows for minor differences without flipping.

### 2. Add per-axis speed sliders and FastNav to mobile settings
**File: `src/components/viewer/mobile/MobileViewerPage.tsx`**

In the mobile settings drawer (where the master speed slider already exists), add:
- Three separate sliders for Zoom, Pan, Rotate (same `NAV_SPEED_GRANULAR` event as desktop)
- FastNav switch (dispatches `FASTNAV_TOGGLE` event)
- Read initial values from localStorage, same keys as desktop

This ensures mobile and desktop have identical Viewer Settings controls.

## Files to Modify

| File | Change |
|------|--------|
| `src/components/viewer/ViewerFilterPanel.tsx` | Add quality check: prefer DB storeys when scene floors are incomplete |
| `src/components/viewer/mobile/MobileViewerPage.tsx` | Add per-axis speed sliders + FastNav toggle to mobile settings drawer |

