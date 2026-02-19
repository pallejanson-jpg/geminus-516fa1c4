
## Plan: Fix 3D Loading (nextSibling error) + Remove inline 3D from InsightsDrawerPanel

### Problem 1: "nextSibling" crash on second mount

The Asset+ viewer (Vue-based, minified) crashes with `Cannot read properties of null (reading 'nextSibling')` every time the 3D viewer is opened a second time (e.g. navigating away and back, or switching buildings).

**Root cause**: The cleanup of the old viewer instance runs inside a `requestAnimationFrame` (deferred), but the new instance's `initializeViewer` starts almost immediately. This creates a race condition where:
1. Old viewer starts cleanup (`requestAnimationFrame` scheduled)
2. New viewer starts, clears `innerHTML`, calls `assetplusviewer()`
3. Old viewer's deferred `clearData()` fires, tries to access DOM nodes that no longer exist → crash

The current `innerHTML = ''` clearing is also happening **before** the old viewer has detached its internal DOM listeners, causing a second issue where Vue's virtual DOM tries to reconcile null nodes.

**Fix**: Replace the fragile deferred cleanup pattern with a proper synchronous cleanup-then-reinitialize flow:

1. **Synchronous cleanup guard**: Before calling `innerHTML = ''`, wait for any in-progress cleanup (tracked via a new `cleaningUpRef`) to complete. 
2. **Longer DOM settlement delay**: After clearing innerHTML, increase the wait from 1 `rAF` to 2 `rAF` + 50ms to give the old viewer's Vue runtime time to finish its teardown.
3. **Defensive `clearData()` timing**: Move the cleanup's `requestAnimationFrame` wrapper to a `setTimeout(fn, 100)` — which runs after the new initialization has already started its DOM wait loop, preventing overlap.
4. **Destroy viewer container node**: Instead of just clearing `innerHTML`, also remove and re-add the `#AssetPlusViewer` div — this gives the Asset+ Vue runtime a completely fresh DOM anchor with no residual event listeners.

### Problem 2: Inline 3D viewer inside InsightsDrawerPanel

`InsightsDrawerPanel` (used as the bottom panel in the 3D viewer) renders `BuildingInsightsView` with `drawerMode=true`. Even in `drawerMode`, `BuildingInsightsView` renders the `InsightsInlineViewer` component on desktop, which spawns a **second** `AssetPlusViewer` instance. Two simultaneous Asset+ viewer instances compete for the same `window.fetch` interceptor, the same `sessionStorage` cache keys, and WebGL resources.

**Fix**: Pass `drawerMode` into `BuildingInsightsView` and suppress the `InsightsInlineViewer` when `drawerMode === true`. The panel is already inside the 3D viewer, so the inline viewer is redundant.

---

### Files to change

**`src/components/viewer/AssetPlusViewer.tsx`** (two areas):

**Area 1 — `initializeViewer` (around line 2965–2970)**:
- Replace the single-rAF DOM settlement with: clear → wait 2 rAF + 50ms → re-check container
- Instead of only `innerHTML = ''`, also destroy and recreate the `#AssetPlusViewer` div inside the container to give Asset+ a fresh DOM anchor

```typescript
// Before (current):
viewerContainerRef.current.innerHTML = '';
await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

// After:
// Destroy and recreate the inner div to ensure no residual Vue bindings
const container = viewerContainerRef.current;
container.innerHTML = '';
const freshDiv = document.createElement('div');
freshDiv.id = 'AssetPlusViewer';
container.appendChild(freshDiv);
// Wait 2 rAF + 50ms for old Vue runtime to fully detach
await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
await new Promise<void>(r => setTimeout(r, 50));
```

**Area 2 — cleanup `useEffect` (around line 3464–3487)**:
- Change the `requestAnimationFrame` cleanup to `setTimeout(fn, 0)` so it runs synchronously after the current call stack, not in the next paint cycle (which can interleave with the new init's rAF loops)
- Add a `cleaningUpRef` flag so `initializeViewer` can detect ongoing cleanup

**`src/components/insights/BuildingInsightsView.tsx`** (line 753–764):
- Suppress `InsightsInlineViewer` when `drawerMode === true`

```typescript
// Before:
{/* Desktop inline 3D viewer */}
{!isMobile && (
    <InsightsInlineViewer ... />
)}

// After:
{/* Desktop inline 3D viewer — hide in drawerMode (already inside 3D viewer) */}
{!isMobile && !drawerMode && (
    <InsightsInlineViewer ... />
)}
```

---

### Technical summary

| File | Change | Impact |
|---|---|---|
| `AssetPlusViewer.tsx` | Recreate `#AssetPlusViewer` div + 2-rAF + 50ms settlement before mount | Eliminates `nextSibling` crash on remount |
| `AssetPlusViewer.tsx` | Cleanup uses `setTimeout(0)` instead of `rAF` | Prevents cleanup/init race condition |
| `BuildingInsightsView.tsx` | Add `&& !drawerMode` guard on `InsightsInlineViewer` | Removes redundant 2nd viewer in 3D panel |

No database changes, no new files, no edge function changes required.
