

# Fix Virtual Twin: Three View Modes with Top-Center Toolbar

## Current Problems

1. **SDK timeout** causes fallback to iframe mode with a tab switcher at the bottom
2. The tab switcher only toggles between 360-degrees and 3D -- it does not split the screen
3. The toolbar is at the bottom (`absolute bottom-6`) instead of top-center
4. There is no "Split" option -- only 360-degrees and 3D tabs
5. Iframe fallback is undesirable

## Solution: Unified Three-Mode Virtual Twin

Replace the current binary (SDK-mode vs fallback-mode) logic with a proper three-mode view system:

| Mode | Description | Default? |
|------|-------------|----------|
| **Split** | 3D transparent overlay on 360-degree (SDK mode) | Yes (default) |
| **360** | Only the 360-degree panorama (SDK mode, 3D hidden) | No |
| **3D** | Only the 3D BIM viewer (Ivion hidden) | No |

### View Mode Toolbar

A centered toolbar at the top (below the header bar) with three buttons: **360**, **Split**, **3D**. The "Split" button sits between the other two, visually indicating the blended mode.

```text
+--[Back]--[Building Name]----[360] [Split] [3D]----[Opacity] [Align] [FS]--+
|                                                                             |
|                      (viewport content based on mode)                       |
|                                                                             |
+-----------------------------------------------------------------------------+
```

The toolbar is integrated into the existing header bar (line 447), not a separate floating element.

## Technical Changes

### File: `src/pages/VirtualTwin.tsx`

**1. Replace state variables:**
- Remove: `fallbackTab` state (`FallbackTab` type)
- Remove: `showFallback` derived boolean
- Add: `viewMode` state of type `'split' | '360' | '3d'`, default `'split'`

**2. Always attempt SDK loading:**
- The SDK loads regardless of view mode (since both "Split" and "360" need it)
- If SDK fails, show a toast notification and auto-switch to "3D" mode
- Remove the iframe fallback entirely -- no more `<iframe>` tags

**3. Increase SDK timeout:**
- Change timeout from 15000ms to 30000ms
- The SDK sometimes takes longer to initialize depending on network conditions

**4. Render logic based on viewMode:**

```text
viewMode === 'split':
  Show: Ivion SDK layer (z-0) + transparent 3D overlay (z-10)
  Same as current SDK mode

viewMode === '360':
  Show: Ivion SDK layer only (z-0)
  Hide: 3D overlay (display: none, stays mounted)

viewMode === '3d':
  Show: AssetPlusViewer only (full opacity, not transparent)
  Hide: Ivion SDK layer (display: none, stays mounted)
```

Keeping both layers mounted (but hidden with `display: none`) avoids re-initialization when switching modes.

**5. Move mode switcher into the header bar:**
- Remove the bottom-positioned fallback tab switcher (lines 399-427)
- Remove the fallback info banner (lines 429-443)
- Remove the iframe block (lines 372-397)
- Add three-button mode switcher inside the existing header toolbar (line 447)
- Buttons styled like the existing fallback buttons but with a "Split" option in the middle
- Ghost opacity slider and alignment button only visible when viewMode is 'split' or '3d'

**6. SDK error handling:**
- When SDK fails, show a toast: "360-SDK kunde inte laddas. Visar 3D-modell."
- Auto-switch to '3d' mode
- The 360 and Split buttons become disabled with a tooltip explaining SDK is unavailable
- Add a small retry button next to the disabled buttons

### Detailed render structure after changes:

```text
<div className="h-screen w-screen relative overflow-hidden bg-black">

  <!-- Ivion SDK layer: visible in 'split' and '360' modes -->
  <div
    ref={sdkContainerRef}
    className="absolute inset-0 z-0"
    style={{ display: viewMode === '3d' ? 'none' : 'block' }}
  />

  <!-- 3D overlay: visible in 'split' mode (transparent) and '3d' mode (opaque) -->
  <div
    className="absolute inset-0 z-10"
    style={{
      display: viewMode === '360' ? 'none' : 'block',
      pointerEvents: (viewMode === 'split' && !overlayInteractive) ? 'none' : 'auto',
    }}
  >
    <AssetPlusViewer
      transparentBackground={viewMode === 'split'}
      ghostOpacity={viewMode === 'split' ? ghostOpacity / 100 : 1}
      suppressOverlay={viewMode === 'split'}
      ...
    />
  </div>

  <!-- Header toolbar with integrated mode switcher -->
  <div className="absolute top-0 left-0 right-0 z-40 ...">
    <!-- Left: Back button + building name -->
    <!-- Center: View mode switcher [360] [Split] [3D] -->
    <!-- Right: Opacity slider + Alignment + Fullscreen -->
  </div>
</div>
```

## File Summary

| File | Changes |
|---|---|
| `src/pages/VirtualTwin.tsx` | (1) Replace fallbackTab with viewMode state, (2) Remove iframe fallback entirely, (3) Move mode switcher from bottom to header bar with Split/360/3D buttons, (4) Split as default mode, (5) Increase SDK timeout to 30s, (6) On SDK failure: toast + auto-switch to 3D + disable Split/360 buttons |

## Risk Assessment

- **Removing iframe fallback (low risk):** The iframe was a degraded experience anyway. When SDK fails, showing 3D-only is better than a limited iframe.
- **Three modes (low risk):** Uses the same layers as today, just toggles visibility with `display: none/block`. No re-initialization needed.
- **SDK timeout increase (no risk):** Gives the SDK more time without any downside.

