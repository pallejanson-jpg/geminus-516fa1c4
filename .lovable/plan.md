

# Fix Ivion SDK, Toolbar Labeling, and Floor Switcher

## Problem 1: SDK initialization times out (root cause)

According to the NavVis SDK documentation (`public/lib/ivion/api.d.ts` line 3628-3631):

> "The promise resolves once data has been loaded and **the view has been moved to the startup location**. If private mode is enabled, the promise resolves only after a user has logged in."

For multi-site Ivion instances (like `swg.iv.navvis.com`), `getApi()` waits for the user to manually select a site before resolving. With `loginToken`, authentication is instant, but site selection blocks the promise indefinitely -- causing the 30-second timeout.

The `ConfigurationInterface` has NO `siteId` property. The only options are `loginToken`, `lang`, `base_url` (hidden), and a few UI settings.

When accessed via browser URL (iframe), `?site=3373717251911143` tells Ivion which site to auto-select. The SDK should behave similarly when the site parameter is included in the baseUrl.

**Fix:** Include `?site=siteId` in the `baseUrl` parameter passed to `getApi()`. This mirrors how the iframe URL works and allows the SDK to determine the startup site during initialization, bypassing the site selection menu.

```text
Before (hangs for multi-site):
  getApi('https://swg.iv.navvis.com', { loginToken: '...' })

After (auto-selects site):
  getApi('https://swg.iv.navvis.com/?site=3373717251911143', { loginToken: '...' })
```

Keep the post-resolve `loadSite()` call as a backup in case the URL approach does not work (SDK resolves via manual selection). Also keep the menu-hiding and sidebar-closing logic.

This fix applies to ALL three views that use the SDK:
- `src/pages/VirtualTwin.tsx`
- `src/components/viewer/Ivion360View.tsx`
- `src/pages/SplitViewer.tsx` (via Ivion360View)

| File | Change |
|---|---|
| `src/lib/ivion-sdk.ts` | When `siteId` is provided, construct `baseUrl` with `?site=siteId` for `getApi()`. Keep post-resolve `loadSite()` as fallback. |
| `src/pages/VirtualTwin.tsx` | Already passes `siteId` -- no change needed. |
| `src/components/viewer/Ivion360View.tsx` | Already passes `siteId` -- no change needed. |

## Problem 2: Toolbar should say "VT" instead of "Split"

The user wants the Virtual Twin overlay mode (currently labeled "Split") renamed to "VT". This is the default mode and represents the core Virtual Twin experience.

| File | Change |
|---|---|
| `src/pages/VirtualTwin.tsx` | Rename "Split" button label to "VT", update tooltip to "Virtual Twin -- 3D overlay pa 360-grader" |

## Problem 3: Floor switcher is too tall vertically

The floating floor switcher currently shows up to 8 pills on desktop (`MAX_VISIBLE_PILLS_DESKTOP = 8`). With 10 floors (as in the Akerselva Atrium building), this creates a very tall vertical strip.

**Fix:**
- Reduce `MAX_VISIBLE_PILLS_DESKTOP` from 8 to 5
- Reduce `MAX_VISIBLE_PILLS_MOBILE` from 6 to 4
- In Virtual Twin mode, hide the floor switcher by default (dispatch `FLOOR_PILLS_TOGGLE` event with `visible: false` on mount)

| File | Change |
|---|---|
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Change `MAX_VISIBLE_PILLS_DESKTOP` from 8 to 5, `MAX_VISIBLE_PILLS_MOBILE` from 6 to 4 |
| `src/pages/VirtualTwin.tsx` | On mount in VT/split mode, dispatch `FLOOR_PILLS_TOGGLE` event with `visible: false` to hide the floor switcher by default |

## Technical Details

### SDK baseUrl construction

```text
// In loadIvionSdk():
// Build the URL that getApi will use for initialization
let initUrl = baseUrl;
if (siteId) {
  const sep = baseUrl.includes('?') ? '&' : '?';
  initUrl = baseUrl + sep + 'site=' + siteId;
}
const api = await getApi(initUrl, config);

// Post-resolve backup: if site wasn't auto-selected, load it manually
if (siteId && !api.site?.service?.activeSite) {
  const site = await api.site.repository.findOne(Number(siteId));
  await api.site.service.loadSite(site);
}
```

Note: `SiteRepositoryInterface.findOne(id: number)` takes a number, so the string site ID must be parsed with `Number()`.

### Floor switcher hide in VT mode

```text
// In VirtualTwin.tsx, after SDK loads or on mount:
useEffect(() => {
  if (viewMode === 'split') {
    window.dispatchEvent(new CustomEvent(FLOOR_PILLS_TOGGLE_EVENT, {
      detail: { visible: false }
    }));
  }
}, [viewMode]);
```

## File Summary

| File | Changes |
|---|---|
| `src/lib/ivion-sdk.ts` | Include `?site=siteId` in baseUrl for `getApi()`. Parse siteId as number for `findOne()`. |
| `src/pages/VirtualTwin.tsx` | (1) Rename "Split" to "VT" in toolbar, (2) Hide floor switcher by default in VT/split mode |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Reduce max visible pills: desktop 8 to 5, mobile 6 to 4 |

## Risk Assessment

- **SDK baseUrl with site param (medium risk):** This mirrors how the iframe URL works. If the SDK strips query params for API calls but uses them for initialization, it works perfectly. If not, the post-resolve `loadSite()` backup handles it. Worst case: SDK shows site selection briefly before auto-selecting.
- **Toolbar rename (no risk):** Label-only change.
- **Floor switcher reduction (low risk):** Remaining floors are accessible via the overflow menu. Hidden by default in VT mode is sensible since 3D floor controls conflict with the 360-degree panorama navigation.
