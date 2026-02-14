

## Fix: 2D FMA Blank Screen + 360 UI Cleanup

### Problem 1: 2D FMA Shows Nothing

The edge function returns a valid URL (`https://swg-demo.bim.cloud/viewer/2d?objectId=11482&token=...`), confirmed by direct API call. The problem is in the iframe element in `FmAccess2DPanel.tsx` (line 162-169):

```
sandbox="allow-scripts allow-same-origin allow-popups"
referrerPolicy="no-referrer"
```

- `sandbox` is too restrictive: FM Access 2D viewer likely needs `allow-forms` (internal form elements) and `allow-modals` (alert/confirm dialogs).
- `referrerPolicy="no-referrer"` may cause the FM Access server to reject the request or fail to set cookies.

**Fix (FmAccess2DPanel.tsx):**
- Remove the `sandbox` attribute entirely (the token is already embedded in the URL, so the iframe content is authenticated).
- Remove `referrerPolicy="no-referrer"` to allow normal referrer behavior.

### Problem 2: 360 UI Elements Too Large

The Ivion SDK renders its own UI (sidebar menu, floor selector, controls) inside the `<ivion>` element. These can be resized with CSS injected into the SDK container.

**Fix (Ivion360View.tsx):**
- After SDK reports `ready`, inject a `<style>` element into the `<ivion>` shadow DOM or container that scales down the SDK's UI controls (e.g., sidebar width, button sizes).
- Use CSS to target known Ivion UI classes/elements and reduce their size with `transform: scale(0.8)` or direct size overrides.

### Problem 3: Login Screen Visible During 360 Loading

When the SDK initializes with a `loginToken`, it briefly shows its own login page before auto-authentication completes. This looks unprofessional.

**Fix (Ivion360View.tsx + UnifiedViewer.tsx):**
- Hide the `<ivion>` element (via `visibility: hidden` or `opacity: 0`) until `sdkStatus === 'ready'`.
- Show our own loading spinner overlay during this time (already partially implemented at line 519-534 of Ivion360View.tsx, but the underlying `<ivion>` element is still visible behind the semi-transparent overlay).
- Change the loading overlay from `bg-background/80` (semi-transparent) to `bg-background` (fully opaque) to completely cover the SDK's login screen.
- In `UnifiedViewer.tsx`, apply the same logic to the SDK container div — set `opacity: 0` until `sdkStatus === 'ready'`.

### Technical Details

**File: `src/components/viewer/FmAccess2DPanel.tsx`**
- Line 162-169: Remove `sandbox` and `referrerPolicy` from the `<iframe>` element.

**File: `src/components/viewer/Ivion360View.tsx`**
- Line 520: Change loading overlay background from `bg-background/80` to `bg-background` (fully opaque, hides login screen).
- Line 551-555: Add `opacity: 0` / `transition` to SDK container div when `sdkStatus !== 'ready'`, so the login flash is invisible.
- Add a `useEffect` after SDK ready that injects CSS to shrink Ivion UI elements (sidebar, buttons, floor switcher) using `transform: scale(0.85)` or equivalent size reductions.

**File: `src/pages/UnifiedViewer.tsx`**
- Line 408-419: Add `opacity: 0` style to the SDK container div when `sdkStatus !== 'ready'`, with a smooth transition to `opacity: 1` when ready.

### Files Changed
- `src/components/viewer/FmAccess2DPanel.tsx` — remove sandbox/referrerPolicy
- `src/components/viewer/Ivion360View.tsx` — opaque loader, hide SDK during init, shrink UI
- `src/pages/UnifiedViewer.tsx` — hide SDK container during loading
