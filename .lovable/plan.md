

# Plan: Fix Four Viewer Issues

## Issue 1: Windows colored by default in Filter Panel
The `ViewerFilterPanel` auto-assigns colors to levels via `LEVEL_PALETTE` in a `useEffect` at line 210-216. These colors are stored in `levelColors` state. The `applyFilterVisibility` function applies these colors when `autoColorEnabled` is true (line 607). Since `autoColorEnabled` starts as `false`, the coloring should not apply. However, the Window issue is likely from the **Asset+ viewer itself** (IfcWindow default material), not the filter panel. This will be resolved by switching to the native xeokit viewer (Issue 2), where windows render with natural IFC materials.

If the user means the **CATEGORY_PALETTE** colors appearing: `Window: '#4FC3F7'` — these only apply when `autoColorEnabled` is true AND categories are checked. No code change needed unless colors appear without enabling auto-color. Will verify after fixing Issue 2.

## Issue 2: Asset+ viewer still starts from "3D View" instead of native xeokit

**Root cause**: The AppHeader "3D View" button (line 122) maps to `key: 'assetplus_viewer'`, which on line 96 navigates to `/split-viewer?mode=3d` (UnifiedViewer using AssetPlusViewer). The sidebar "3D Viewer" entry uses `native_viewer` correctly.

**Fix**: Change the AppHeader "3D View" button to use `native_viewer` instead of `assetplus_viewer`, and have it call `setActiveApp('native_viewer')` instead of navigating to `/split-viewer`.

**File**: `src/components/layout/AppHeader.tsx`
- Change line 122: `key: 'assetplus_viewer'` → `key: 'native_viewer'`
- Update `handleMenuClick` to handle `native_viewer` by calling `setActiveApp('native_viewer')` instead of navigating to a route.

## Issue 3: Asset+ right panel still showing

This is because `AssetPlusViewer` renders `ViewerRightPanel` as part of its component tree. When the native viewer (`NativeViewerPage` → `NativeXeokitViewer`) is used instead, the right panel should not appear. The native viewer currently has no equivalent settings panel.

No code change needed if Issue 2 is fixed correctly — switching to `native_viewer` will render `NativeXeokitViewer` which doesn't include `ViewerRightPanel`.

## Issue 4: IFC conversion hangs (browser warns "wait or leave")

**Root cause**: The IFC conversion in `CreateBuildingPanel.tsx` calls `convertToXktWithMetadata()` which runs `parseIFCIntoXKTModel` synchronously on the main thread via web-ifc WASM (line 150-157 in `acc-xkt-converter.ts`). For large IFC files, this blocks the main thread for minutes, triggering the browser's "page unresponsive" warning.

**Fix**: Move the IFC parsing to a Web Worker to avoid blocking the main thread. This requires:
1. Create a new worker file `src/workers/ifc-converter.worker.ts` that imports web-ifc and xeokit-convert and runs the conversion off the main thread.
2. Update `convertToXktWithMetadata` in `acc-xkt-converter.ts` to delegate to the worker.
3. Use `postMessage` for progress callbacks.

**Alternative simpler fix**: Use `setTimeout` chunking or convert the blocking WASM call to use the multi-threaded web-ifc build (`web-ifc-mt.wasm` already exists in `public/lib/xeokit/`). However, the most reliable fix is a Web Worker.

## Implementation Steps

1. **Fix AppHeader 3D View routing** — Change `assetplus_viewer` to `native_viewer` in the header nav buttons and update `handleMenuClick` to use `setActiveApp` instead of route navigation.

2. **Move IFC conversion to Web Worker** — Create worker file, update `convertToXktWithMetadata` to use it, keeping the same API surface with progress callbacks via `postMessage`.

## Technical Details

### AppHeader change (step 1)
```typescript
// Line 96-98: Remove the assetplus_viewer redirect
// Line 122: Change key to 'native_viewer'
{ key: 'native_viewer', mode: undefined, icon: Cuboid, label: '3D View' },
```
The existing `handleMenuClick` default path already calls `setActiveApp(app)`, so changing the key is sufficient.

### Web Worker for IFC (step 2)
Worker receives `ArrayBuffer`, imports `@xeokit/xeokit-convert` and `web-ifc`, runs `parseIFCIntoXKTModel`, posts back progress messages and final result. The main thread `convertToXktWithMetadata` wraps this in a Promise.

