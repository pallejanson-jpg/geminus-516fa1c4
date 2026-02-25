

## Plan: Fix Småviken 3D Loading, 2D Stability, and Issue Visibility

### Root Cause Analysis

**1. Småviken empty 3D scene**

The `additionalDefaultPredicate` callback receives a `modelId` from the Asset+ SDK. Our whitelist contains DB `model_id` values (UUIDs like `042dba20-8b16-4e2d-b7cd-591e707b6395`). But the SDK may pass a different format (e.g. with `.xkt` suffix, a file path, or the `file_name` column value). If none match, the predicate returns `false` for ALL models, and the scene is empty.

DB state for Småviken confirms:
```text
model_id: 042dba20-8b16-4e2d-b7cd-591e707b6395  model_name: A-modell  file_name: 042dba20-8b16-4e2d-b7cd-591e707b6395.xkt
model_id: ee97a084-7454-4cbf-b5ab-e840eb670b9c  model_name: V-modell  file_name: ee97a084-7454-4cbf-b5ab-e840eb670b9c.xkt
```

The predicate only checks `modelId` and `modelId.toLowerCase()`. It does NOT check:
- `modelId` with `.xkt` stripped
- `file_name` variants
- Partial path matches

**2. 2D flips back to 3D**

`UnifiedViewer.tsx` line 157-162:
```typescript
if (sdkStatus === 'failed' && viewMode !== '3d') {
  setViewMode('3d');
}
```
This fires for ALL non-3D modes including `2d`, even though 2D does not need the 360 SDK.

**3. Issues disappear / don't show on toggle**

From the previous approved plan (not yet fully implemented): `loadLocalAnnotations()` clears `container.innerHTML = ''` which deletes issue markers sharing the same container. Issues are also auto-loaded then immediately wiped.

---

### Changes

#### A. Fix `additionalDefaultPredicate` matching (AssetPlusViewer.tsx)

1. When building the A-model whitelist, add **all possible key variants** for each model:
   - `model_id` (raw UUID)
   - `model_id.toLowerCase()`
   - `file_name` (e.g. `042dba20-...xkt`)
   - `file_name` without `.xkt` extension
   - All lowercased variants

2. In the predicate callback, normalize the incoming `modelId`:
   - Strip `.xkt` suffix
   - Try both raw and lowercased
   - Log the first 5 incoming modelIds for diagnostics

3. Add a safety fallback: if the predicate is called 3+ times and rejects everything, log a warning and disable the filter (set `allowedModelIdsRef.current = null`) so the scene is never empty.

**File:** `src/components/viewer/AssetPlusViewer.tsx` (lines ~3896-3940 and ~4037-4041)

#### B. Fix 2D mode stability (UnifiedViewer.tsx)

Change the `sdkStatus === 'failed'` effect to only force 3D for modes that require the SDK:

```typescript
if (sdkStatus === 'failed' && (viewMode === 'vt' || viewMode === 'split' || viewMode === '360')) {
  setViewMode('3d');
  toast.error('360° SDK kunde inte laddas. Visar 3D-modell.');
}
```

2D mode does not require the SDK and must not be affected.

**File:** `src/pages/UnifiedViewer.tsx` (line 158)

#### C. Separate marker containers for Issues (AssetPlusViewer.tsx)

1. Create a dedicated `#issue-markers-container` div (absolute, pointer-events:none, z-index:15) separate from the local annotations container.

2. `loadIssueAnnotations()` appends markers to this dedicated container instead of sharing with local annotations.

3. `loadLocalAnnotations()` only clears its own container (`#local-annotations-container`), no longer destroying issue markers.

4. Remove auto-load of issues from `handleAllModelsLoaded()` (Issues default OFF).

5. `ISSUE_ANNOTATIONS_TOGGLE_EVENT` handler:
   - `visible: true` + not loaded yet -> call `loadIssueAnnotations()`, mark loaded
   - `visible: true` + already loaded -> set container `display: flex`
   - `visible: false` -> set container `display: none`

**File:** `src/components/viewer/AssetPlusViewer.tsx`

#### D. Same pattern for sensor markers (AssetPlusViewer.tsx)

Ensure `loadSensorAnnotations()` uses its own `#sensor-markers-container`, separate from local and issue containers.

**File:** `src/components/viewer/AssetPlusViewer.tsx`

---

### Files Modified

| File | Change |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Robust predicate matching with all key variants + fallback; separate marker containers for issues/sensors; remove auto-load of issues; lazy-load on toggle |
| `src/pages/UnifiedViewer.tsx` | Guard SDK-fail effect to only affect vt/split/360 modes, not 2D |

### Implementation Order

1. Fix `UnifiedViewer.tsx` SDK guard (1 line change)
2. Fix predicate matching in `AssetPlusViewer.tsx` (whitelist building + normalization + fallback)
3. Separate marker containers for issues and sensors
4. Wire up lazy-load toggle for issues (default OFF)

