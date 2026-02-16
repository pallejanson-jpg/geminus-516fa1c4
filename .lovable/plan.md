

## Fix: AlignmentPointPicker "getMainView saknas" Error

### Problem

The error "SDK-funktionen getMainView saknas" occurs because the NavVis SDK's `getApi()` returns an `ApiInterface` object where methods are organized into sub-APIs:

- `api.view.mainView` -- the main panorama view (current API)
- `api.legacyApi.getMainView()` -- legacy API path
- `api.legacyApi.moveToImageId(...)` -- legacy navigation

But the code calls `api.getMainView()` directly on the root object, which does not exist. You are not doing anything wrong -- this is a code bug where the wrong API path is used.

The `BrowserScanRunner` component already has the correct multi-path lookup pattern:
```text
api.view?.mainView ?? api.getMainView?.() ?? api.mainView
```

But `AlignmentPointPicker`, `useVirtualTwinSync`, `useIvionCameraSync`, and `CoordinateDiagnosticOverlay` all use the incorrect direct path.

### Solution

Create a shared helper function and update all affected files to use the correct SDK API paths.

### Changes

**1. Add helper to `ivion-sdk.ts`**

Add a utility function that resolves the main view from any version of the API object:

```typescript
export function resolveMainView(api: any): IvionMainView | null {
  return api?.view?.mainView
    ?? (typeof api?.legacyApi?.getMainView === 'function' ? api.legacyApi.getMainView() : null)
    ?? (typeof api?.getMainView === 'function' ? api.getMainView() : null)
    ?? api?.mainView
    ?? null;
}
```

**2. Fix `AlignmentPointPicker.tsx`**

Replace the `capture360Position` function's direct `api.getMainView()` call with `resolveMainView(api)`. Remove the long fallback block that tries `api.camera?.position` etc. -- simplify to one call.

**3. Fix `useVirtualTwinSync.ts`**

Replace `ivApi.getMainView()` with `resolveMainView(ivApi)`.

**4. Fix `useIvionCameraSync.ts`**

Replace all `ivApi.getMainView()` calls with `resolveMainView(ivApi)`.

**5. Fix `CoordinateDiagnosticOverlay.tsx`**

Replace the inline fallback with `resolveMainView(api)`.

### Files to modify

| File | Change |
|------|--------|
| `src/lib/ivion-sdk.ts` | Add `resolveMainView()` helper |
| `src/components/viewer/AlignmentPointPicker.tsx` | Use `resolveMainView()` instead of direct `getMainView()` |
| `src/hooks/useVirtualTwinSync.ts` | Use `resolveMainView()` |
| `src/hooks/useIvionCameraSync.ts` | Use `resolveMainView()` |
| `src/components/viewer/CoordinateDiagnosticOverlay.tsx` | Use `resolveMainView()` |

