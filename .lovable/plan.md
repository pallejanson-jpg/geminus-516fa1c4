

# Fix Floating Floor Switcher and Ivion SDK 403 Error

## 1. Floor Switcher Overhaul

### Problems
- The panel stretches far beyond the pill content (visible in screenshot -- massive black area below the "+5" pill)
- Drag functionality adds complexity the user doesn't want
- Positioned on the right side instead of under the top-left buttons (X, expand, annotation)

### Root Cause
The component uses `fixed` positioning with `left`/`top` set dynamically via drag state. The excessive height likely comes from CSS or the container not constraining to content height. The `bg-background/80` background fills the entire fixed-positioned box.

### Fix

**Remove all drag functionality:**
- Delete `position` state, `isDragging` state, `dragOffsetRef`, `hasInitializedPosition`
- Delete `handleDragStart`, mouse move/up listeners (lines 102-130)
- Delete the GripVertical drag handle element (lines 572-585)

**Fixed position below top-left buttons:**
- Instead of `style={{ left: position.x, top: position.y }}`, use fixed CSS classes: `left-3 top-[140px]` (below the row of X, expand, annotation buttons which sit at ~top-20 with height ~40px each, stacked or in a row)
- The `140px` top value places it right below those buttons with a small gap

**Ensure height fits content exactly:**
- The container already uses `flex flex-col` with `gap-px`, so it should auto-size. Remove any min-height or explicit height that might be causing the stretch
- Add `h-auto` explicitly to prevent any inherited stretching

### Technical Changes (`src/components/viewer/FloatingFloorSwitcher.tsx`)

1. Remove state: `position`, `isDragging`, `dragOffsetRef`, `hasInitializedPosition` (lines 54-58)
2. Remove position initialization effect (lines 78-87)
3. Remove drag handlers and mouse event listeners (lines 102-130)
4. Remove GripVertical drag handle JSX (lines 572-585)
5. Change container from `style={{ left: position.x, top: position.y }}` to class-based positioning: `left-3 top-[140px]`
6. Remove `isDragging` conditional classes (`cursor-grabbing`, `shadow-xl`)
7. Keep all pill logic, overflow menu, click/double-click behavior unchanged

## 2. Ivion SDK 403 Error

### Problem
"Network request failed: OK (403) Full authentication is required to access this resource" when loading the Virtual Twin SDK.

### Analysis
This 403 means the `loginToken` fetched via `ivion-poi` edge function is either:
- Not being obtained (the fetch fails silently and SDK loads without auth)
- Expired or invalid
- The Ivion instance requires re-authentication

The `useIvionSdk` hook already handles this (fetches token, passes to SDK). The 403 suggests the token fetch returned null and the SDK loaded unauthenticated. The hook logs `[useIvionSdk] Will use loginToken for auto-auth` only when a token is obtained -- if missing, it proceeds without auth.

### Fix
Make the SDK initialization fail gracefully when no loginToken is available, and show a clear error message instead of loading unauthenticated (which causes the 403). In `useIvionSdk.ts`, if `loginToken` is null, set status to `'failed'` with a descriptive error rather than proceeding without auth.

### Technical Changes (`src/hooks/useIvionSdk.ts`)

Add early return when loginToken is null (after line 82):
```typescript
if (!loginToken) {
  console.error('[useIvionSdk] No loginToken available - cannot authenticate with Ivion');
  if (!cancelled) setSdkStatus('failed');
  return;
}
```

This prevents the SDK from loading in an unauthenticated state that triggers 403 errors on every API call.

## Files to Modify

| File | Changes |
|---|---|
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Remove drag functionality, fix position to top-left below buttons, ensure height fits content |
| `src/hooks/useIvionSdk.ts` | Fail early when loginToken is unavailable instead of loading without auth |

