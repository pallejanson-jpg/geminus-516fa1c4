

## Plan: Fullscreen Edge-to-Edge Mobile Viewer

### Problem
On iPhone, the 3D viewer canvas doesn't extend behind the status bar (clock/battery) at the top or the home indicator at the bottom. The safe area insets create visible gaps.

### Current State
- `index.html` already has `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style=black-translucent` — these are the prerequisites for rendering behind the safe areas.
- `MobileViewerPage.tsx` (line 564-566) uses `fixed inset-0` with `height: 100dvh` — but `100dvh` on iOS Safari actually **excludes** the safe area insets. The `fixed inset-0` is correct on its own, but the explicit `height: 100dvh` may conflict.

### Changes

**1. `src/components/viewer/mobile/MobileViewerPage.tsx`**
- Remove the explicit `height: 100dvh` from the root container style — `fixed inset-0` already provides full-screen coverage including behind safe areas.
- Add `width: 100vw` is already there, keep it but let height come from `inset-0`.
- Ensure the canvas container (`<div className="absolute inset-0">`) has no padding or margin restrictions.

**2. `src/components/viewer/NativeXeokitViewer.tsx`**
- The canvas container and canvas element already use `w-full h-full` — no changes needed.

**3. `src/components/viewer/NativeViewerShell.tsx`**  
- The shell uses `relative w-full h-full overflow-hidden` — no changes needed.

**4. `src/components/viewer/mobile/MobileViewerOverlay.tsx`**
- The overlay already respects `env(safe-area-inset-top)` for its padding — this is correct and keeps the UI controls visible while the canvas extends behind them.

### Summary
The fix is minimal: remove `height: 100dvh` from MobileViewerPage's root container so that `fixed inset-0` takes full effect, which on iOS with `viewport-fit=cover` extends behind both the status bar and home indicator. The overlay controls already handle safe-area padding independently.

