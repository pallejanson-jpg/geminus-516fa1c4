

## Analysis of Current Issues

### 1. Filter Panel Missing Close Button
The `ViewerFilterPanel` (line 969) already has a close button (`<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>`). This is confirmed in the code. However, the user says it's missing — this may be a visibility or rendering issue, or it could be the mobile variant. Need to verify the `onClose` prop is being passed correctly from the parent.

### 2. FloatingFloorSwitcher Too Narrow + Too Tall
Current pills are `h-7 w-8 sm:h-7 sm:w-9` (line 544) — roughly 32-36px wide. Floor names like "PLAN 3 Pål." don't fit in `shortName` which only extracts digits. The max visible pills are `MAX_VISIBLE_PILLS_DESKTOP = 10` (line 34) — should be 12 per user request.

### 3. 3D Performance
The `usePerformancePlugins` hook is installed but the LOD culling iterates ALL objects every 500ms which could be expensive. The XKT Phase 1 chunking columns exist in the schema but the **viewer loading logic** doesn't use them — it still loads full monolithic models. This is the main performance bottleneck.

### 4. Issue Click → Fly-to + Open Detail Sheet (No Gray Overlay)
When clicking an issue marker in 3D, `ISSUE_MARKER_CLICKED_EVENT` is dispatched. `ViewerRightPanel` handles this via `handleSelectIssue` which calls `handleGoToIssueViewpoint(issue.viewpoint_json)` AND opens `showIssueDetail = true`. The `IssueDetailSheet` uses a Radix `Sheet` which creates a modal overlay that grays out the background. To prevent this, the Sheet should be non-modal (`modal={false}`) or use a different layout approach.

### 5. "Click to go to position" Doesn't Work
In `IssueDetailSheet.tsx` line 215: `onClick={() => issue.viewpoint_json && onGoToViewpoint?.(issue.viewpoint_json)}`. The `onGoToViewpoint` prop is passed from `ViewerRightPanel` (line 953). The function calls `restoreViewpoint()` which uses `cameraFlight.flyTo()`. This should work — but if the Sheet is modal, pointer events on the viewer may be blocked. Making the Sheet non-modal should fix this.

### 6. 2D Still Not Starting in 2D
The `userChangedModeRef` approach was implemented but there's a timing issue. The URL has `mode=2d`, which sets `viewMode` to `'2d'` via the `modeParam` effect (line 102-110). However, the `prevViewModeRef` is initialized to `viewMode === '2d' ? '__init__' : viewMode` (line 114). The `LOAD_SAVED_VIEW_EVENT` timer (line 197-224) fires at 2 seconds and should respect `userChangedModeRef.current`. But the `modeParam` effect at line 107 sets `userChangedModeRef.current = true` — this looks correct. The issue may be that `buildingData` loads and the start view effect runs before the `modeParam` effect, since both depend on different deps. The `modeParam` effect runs on `[modeParam, viewMode]` while the start view runs on `[buildingData]`.

**Root cause:** The start view effect (line 189-225) captures `viewMode` at the time it creates the closure but doesn't update when `viewMode` changes. The `setTimeout` uses a stale closure. Since the timer fires at 2 seconds, `viewMode` might still be `'3d'` at closure creation time (before `modeParam` effect fires).

**Fix:** The start view timer should read `viewMode` from a ref, not from the closure.

### 7. XKT Phase 1 Status
The database columns (`parent_model_id`, `storey_fm_guid`, `is_chunk`, `chunk_order`) **already exist** in the schema. The converter (`acc-xkt-converter.ts`) has a `splitAndStoreByStorey` method. However, the **viewer loading in AssetPlusViewer** does NOT use chunks — it loads the full model. The preloader (`useXktPreload.ts`) also doesn't distinguish chunks. So Phase 1 schema is done, converter has a stub, but **viewer-side chunk loading is not implemented**.

---

## Planned Changes

### A. Fix FloatingFloorSwitcher — Wider Pills + Max 12 Visible

**File:** `src/components/viewer/FloatingFloorSwitcher.tsx`

1. Change `MAX_VISIBLE_PILLS_DESKTOP` from 10 to 12
2. Widen pills to show full floor name instead of just `shortName`:
   - Change pill width from `w-8 sm:w-9` to `w-auto min-w-[40px] px-2`
   - Display `floor.name` (truncated) instead of `floor.shortName`
   - Set `max-w-[120px]` with truncation for very long names
3. Reduce pill height slightly for density: keep `h-7`

### B. Fix Filter Panel Close Button Visibility

**File:** `src/components/viewer/ViewerFilterPanel.tsx`

The close button exists (line 969) but is using `text-foreground` which may not be visible. Ensure the X button is prominent and has proper contrast. Also verify the `onClose` prop flows through correctly from `AssetPlusViewer.tsx`.

### C. Fix 2D Mode Not Sticking

**File:** `src/pages/UnifiedViewer.tsx`

The start view effect creates a stale closure over `viewMode`. Fix by using a `viewModeRef` that always has the current value:
- Add `const viewModeRef = useRef(viewMode)` and keep it updated
- In the start view timer, read `viewModeRef.current` instead of `viewMode`
- Also check `userChangedModeRef.current` (already done)

### D. Issue Click → Fly-to + Non-Modal Detail Sheet

**File:** `src/components/viewer/IssueDetailSheet.tsx`

1. Make the Sheet non-modal so the 3D viewer stays interactive:
   - Already has `modal` support — but currently no prop set
   - Change: `<Sheet open={open} onOpenChange={...} modal={false}>`
   - Remove or hide the overlay so 3D isn't grayed out

2. The "Click to go to position" should work once the Sheet is non-modal (pointer events unblocked on canvas)

**File:** `src/components/viewer/ViewerRightPanel.tsx`

3. When `ISSUE_MARKER_CLICKED_EVENT` fires, also fly to the issue viewpoint (already done in `handleSelectIssue` which calls `handleGoToIssueViewpoint`)

### E. Performance — Throttle LOD Culling for Large Models

**File:** `src/hooks/usePerformancePlugins.ts`

1. Add object-count guard: if `Object.keys(scene.objects).length > 50000`, skip LOD culling entirely (already mentioned in memory but not implemented)
2. On mobile, disable LOD culling interval completely

### F. XKT Phase 1 — No Code Changes Needed Now

The schema columns exist. The converter has the stub. The viewer-side loading is not yet chunk-aware but this is a larger feature that would require its own plan. The user asked if it's implemented — answer: **partially** (schema + converter stub done, viewer loading not yet chunk-aware). This is not causing the current slowness — the slowness is from loading large monolithic XKT files.

---

## Files Modified

| File | Change |
|---|---|
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Wider pills showing full name, max 12 visible |
| `src/pages/UnifiedViewer.tsx` | Fix stale closure in start view timer for 2D mode |
| `src/components/viewer/IssueDetailSheet.tsx` | Non-modal Sheet so 3D stays visible and interactive |
| `src/hooks/usePerformancePlugins.ts` | Guard LOD culling for large models (>50k objects) |
| `src/components/viewer/ViewerFilterPanel.tsx` | Ensure close button is visible |

