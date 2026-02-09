

# Fix 4 Issues: XKT Reload, Right Menu, Floor Switcher Height, SDK Loading

## 1. XKT Reloads on Every Mode Switch

### Root Cause

In `UnifiedViewer.tsx`, each view mode conditionally renders its own `AssetPlusViewer` instance:

```
{viewMode === '3d' && <AssetPlusViewer ... />}      // line 411-414
{viewMode === 'vt' && <AssetPlusViewer ... />}       // line 425-431
{viewMode === 'split' && <AssetPlusViewer ... />}    // line 455-463
```

When the user switches from e.g. VT to 3D, the VT `AssetPlusViewer` unmounts (destroying the xeokit viewer and all loaded models) and the 3D `AssetPlusViewer` mounts fresh (re-fetching and loading all XKT files).

### Fix: Single AssetPlusViewer instance, always mounted

Render ONE `AssetPlusViewer` that stays mounted for all modes. Control its appearance using CSS (`display`/`visibility`, `pointer-events`, `opacity`, `background`) instead of conditional rendering.

```text
Before:
  {viewMode === '3d' && <AssetPlusViewer ... />}
  {viewMode === 'vt' && <AssetPlusViewer ... />}
  {viewMode === 'split' && <AssetPlusViewer ... />}

After:
  <div style={{
    display: viewMode === '360' ? 'none' : 'block',
    position: 'absolute', inset: 0,
    zIndex: viewMode === 'vt' ? 10 : viewMode === '3d' ? 10 : 5,
    pointerEvents: viewMode === 'vt' ? (overlayInteractive ? 'auto' : 'none') : 'auto',
  }}>
    <AssetPlusViewer
      fmGuid={buildingData.fmGuid}
      transparentBackground={viewMode === 'vt'}
      ghostOpacity={viewMode === 'vt' ? ghostOpacity / 100 : undefined}
      suppressOverlay={viewMode === 'vt'}
      onClose={viewMode === '3d' ? handleGoBack : undefined}
    />
  </div>
```

For split mode, the same AssetPlusViewer is shown in the left panel. This requires restructuring: in split mode, the AssetPlusViewer's container is placed inside the `ResizablePanel` instead of being absolute. This can be achieved by using a React portal or by changing the container sizing with CSS.

**Simpler approach**: Keep the single AssetPlusViewer always rendered at `absolute inset-0`. In split mode, resize it to 50% width using inline styles instead of ResizablePanelGroup for the 3D side:

```text
style={{
  width: viewMode === 'split' ? '50%' : '100%',
  height: '100%',
}}
```

And render the Ivion360View in the right half for split mode.

Actually, the cleanest approach is to use a **ref-based container swap** where AssetPlusViewer renders into a stable container div, and we use CSS to reposition/resize that container depending on the mode. This avoids portals and keeps the DOM structure simple.

### Technical Details

In `UnifiedViewer.tsx`:

1. Create a single ref for the 3D viewer container: `const viewerContainerRef = useRef<HTMLDivElement>(null)`
2. Render ONE `AssetPlusViewer` that stays mounted across all modes
3. Use CSS classes/styles to control:
   - **3D mode**: full size, opaque, interactive, shows its own toolbar
   - **VT mode**: full size, transparent background, ghost opacity, suppressed overlay, pointer-events conditional
   - **Split mode**: half width on left, opaque, shows its own toolbar
   - **360 mode**: hidden (`display: none`)
4. Remove the three separate `AssetPlusViewer` renders and replace with one

The key props that change per mode:
- `transparentBackground`: true only in VT
- `ghostOpacity`: set only in VT
- `suppressOverlay`: true only in VT
- `onClose`: only in 3D mode (other modes use the header back button)

## 2. Right Menu Not Working

### Root Cause

When in 3D mode inside UnifiedViewer, the `AssetPlusViewer` renders with `onClose={handleGoBack}` and without `suppressOverlay`. This means its internal toolbar (Close, Fullscreen, Tree, Menu buttons) is visible. The Menu button opens `ViewerRightPanel` (a Sheet with `modal={false}`).

The issue is likely that the Sheet renders at z-index that conflicts with the UnifiedViewer header (z-40). The Sheet from `ViewerRightPanel` uses Radix UI's Sheet which renders in a portal at the document root, so z-index should be fine.

However, there might be a conflict with the `pointer-events-none` wrapper. Looking at lines 2928-2979, the toolbar buttons have `pointer-events-auto`, and the ViewerRightPanel (line 3115-3133) is also wrapped in `pointer-events-auto`. This should work.

**Most likely cause**: When clicking the Menu button, the Sheet opens but its overlay/content is behind the UnifiedViewer's content area which has `z-10` on the 3D container (line 412). Since the Sheet portal renders at document root level, it should be above everything. Let me check if the AssetPlusViewer's wrapping div has issues.

Actually, looking more carefully: `AssetPlusViewer` itself wraps everything in a div with `will-change: transform` (for GPU layer isolation). This creates a new stacking context, which means the Sheet portal (rendered at document root) would appear ABOVE it. So the Sheet should work.

**Real issue**: The UnifiedViewer header (z-40) has a Close button and Fullscreen button that duplicate AssetPlusViewer's own buttons. In 3D mode, both toolbars are visible, potentially causing confusion. But the right panel button should still work.

Let me reconsider -- with the single AssetPlusViewer approach from fix #1, the right panel will naturally work because in 3D mode the `suppressOverlay` will be `false`, showing the internal toolbar including the Menu button.

### Fix

This is resolved by fix #1. In 3D mode, `suppressOverlay` is false, so the Menu button and ViewerRightPanel are available. Additionally, in 3D mode we should NOT show the AssetPlusViewer's own Close and Fullscreen buttons (since UnifiedViewer header already has them). We can pass `onClose={undefined}` to suppress the close button, since the header has its own back button.

## 3. Floor Switcher Still Too Tall

### Root Cause

The floor switcher at `FloatingFloorSwitcher.tsx` still renders with too much vertical space. Currently it has:
- Drag handle: `h-3` (line 575)
- Pills: `h-6 w-6 sm:h-7 sm:w-7` (line 601)
- Overflow button: `h-6 w-6 sm:h-7 sm:w-7` (line 642)
- "Alla" button: `h-5` (line 721)
- Container padding: `p-1` and `gap-0.5`

The width is now too narrow (`w-6`/`w-7` = 24px/28px). The user says it's "too narrow but too tall."

### Fix

1. **Restore width** to a reasonable size: `w-8 sm:w-9` for pills
2. **Reduce vertical padding** further: change container `gap-0.5` to `gap-px` (1px gap)
3. **Make drag handle even thinner**: `h-2` instead of `h-3`
4. **Remove "Alla" button entirely** -- double-click on any pill already shows all floors (tooltip explains this)
5. **Use `w-auto` with horizontal padding** instead of fixed square dimensions, so pills can be wider without being taller. Pills would be `h-6 px-2` instead of `h-6 w-6`.

This makes each pill take approximately 24px height + 1px gap = 25px per floor. For 10 floors, total height would be ~260px including drag handle.

## 4. Ivion SDK Not Loading

### Root Cause

The `Ivion360View` component (used in split mode) creates its own `<ivion>` element and calls `loadIvionSdk()`. The `loadIvionSdk` function passes `siteId` in the SDK config object (`sdkConfig.siteId = siteId`), but the NavVis SDK may not recognize `siteId` as a config property. Previously the code injected `?site=` into the URL which DID work.

The SDK config object likely supports `loginToken` but NOT `siteId`. The site selection needs to happen through URL or API.

### Fix

Restore URL-based site injection but do it SAFELY without triggering React Router:

1. Instead of modifying `window.location`, create a temporary `<a>` or use `URL` object to build the site URL
2. Pass the full URL including `?site=` to the `<ivion>` element's `src` attribute (if supported) or inject it into `window.location.search` ONLY during the `getApi()` call, and restore immediately after
3. Alternative: Use the API-based fallback that already exists (lines 320-343 in ivion-sdk.ts) but make it more robust

The safest approach is:
1. Keep `siteId` in SDK config (in case future SDK versions support it)  
2. Before calling `getApi()`, temporarily inject `?site=` using `replaceState`
3. Immediately after `getApi()` resolves, remove it
4. Wrap the URL manipulation in a try/finally to guarantee cleanup

The key difference from before: we do the injection ONLY around the `getApi()` call (not before script loading), and we clean up in a `finally` block.

```typescript
// Temporarily inject ?site= for SDK initialization
let urlModified = false;
if (siteId) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('site')) {
    url.searchParams.set('site', siteId);
    window.history.replaceState(null, '', url.toString());
    urlModified = true;
  }
}

try {
  const iv = await Promise.race([apiPromise, timeoutPromise]);
} finally {
  // Clean up ?site= immediately
  if (urlModified) {
    const url = new URL(window.location.href);
    url.searchParams.delete('site');
    window.history.replaceState(null, '', url.toString());
  }
}
```

## Technical Summary

| File | Changes |
|---|---|
| `src/pages/UnifiedViewer.tsx` | Replace 3 separate AssetPlusViewer instances with 1 always-mounted instance. Control appearance via CSS props based on viewMode. For split mode, use CSS width instead of ResizablePanelGroup for the 3D side. |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Restore pill width (`w-8`), minimize gaps (`gap-px`), remove "Alla" button, shrink drag handle (`h-2`). |
| `src/lib/ivion-sdk.ts` | Restore `?site=` URL injection around `getApi()` call only, with immediate cleanup in `finally` block. Keep SDK config siteId as secondary. |

## Risk Assessment

- **Single AssetPlusViewer (medium risk)**: Biggest change. The AssetPlusViewer must handle prop changes (transparentBackground, ghostOpacity, suppressOverlay) without full re-initialization. Since these are already props, React will re-render the component with new values. The xeokit viewer instance stays alive. The transparent background and ghost opacity are applied via CSS and scene API calls, not via re-initialization.
- **Floor switcher (no risk)**: Pure CSS changes.
- **SDK site injection (low risk)**: Restoring proven approach but with safer cleanup. The `finally` block ensures URL is always cleaned up.

