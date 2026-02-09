

# Fix Virtual Twin: Site ID, Object Selection, and Toolbar Customization

## Problem 1: Ivion shows site selection menu instead of the building

The NavVis SDK's `getApi(baseUrl, config)` initializes the viewer but does NOT automatically navigate to a specific site. The `ConfigurationInterface` only accepts `loginToken`, `lang`, etc. -- there is no `siteId` config option.

After the SDK loads, `api.site.service.activeSite` is undefined, and the user is shown Ivion's built-in site selection menu.

**Fix:** After `loadIvionSdk()` resolves, use the SDK's Site API to programmatically load the correct site:

```
api.site.repository.findOne(siteId)  -->  SiteInterface object
api.site.service.loadSite(site)      -->  Navigates to that site
```

The site ID is already available in `buildingInfo.ivionSiteId` (fetched from `building_settings`). After loading the site, also hide the sidebar menu items (same approach as `Ivion360View` already does on mobile).

| File | Change |
|---|---|
| `src/lib/ivion-sdk.ts` | Accept optional `siteId` parameter in `loadIvionSdk()`. After `getApi()` resolves, call `api.site.repository.findOne(siteId)` then `api.site.service.loadSite(site)`. Also hide all sidebar menu items and close the sidebar. |
| `src/pages/VirtualTwin.tsx` | Pass `buildingInfo.ivionSiteId` to `loadIvionSdk()` |
| `src/components/viewer/Ivion360View.tsx` | Also pass `siteId` to `loadIvionSdk()` for consistency |

## Problem 2: Cannot select objects in the 3D overlay

The 3D overlay div (line 341 in VirtualTwin.tsx) has `pointer-events: none` so that navigation clicks pass through to Ivion. This is correct for pan/rotate, but it also prevents clicking on 3D objects to select them.

**Fix:** Toggle pointer events on the 3D canvas based on the active tool in AssetPlusViewer. When the "select" tool is active, the canvas needs `pointer-events: auto` to receive clicks. When navigating (orbit, first person), it should be `pointer-events: none`.

Implementation approach:
- Add a custom event `VIEWER_TOOL_CHANGED` that ViewerToolbar dispatches whenever the active tool changes
- VirtualTwin listens for this event and toggles `pointer-events` on the 3D overlay div
- Default state: `pointer-events: none` (navigation mode)
- When select/measure/slicer tool is active: `pointer-events: auto` on the overlay

| File | Change |
|---|---|
| `src/lib/viewer-events.ts` | Add `VIEWER_TOOL_CHANGED_EVENT` constant and `ViewerToolChangedDetail` type |
| `src/components/viewer/ViewerToolbar.tsx` | Dispatch `VIEWER_TOOL_CHANGED_EVENT` when active tool changes |
| `src/pages/VirtualTwin.tsx` | Listen for `VIEWER_TOOL_CHANGED_EVENT` and toggle pointer-events on the 3D overlay accordingly |

```text
Tool is "select", "measure", or "slicer":
  3D overlay: pointer-events: auto   (clicks go to 3D for object interaction)

Tool is null (orbit/firstPerson/zoom navigation):
  3D overlay: pointer-events: none   (clicks pass to Ivion for panorama navigation)
```

## Problem 3: Toolbar customization does not take effect

There are two bugs in `getToolbarSettings()` and `getNavigationToolSettings()`:

**Bug A: User's custom order is always lost**

`getToolbarSettings()` iterates `DEFAULT_TOOLS.map(...)` which always returns tools in the hardcoded default order. The user's drag-and-drop reordering (stored in localStorage) is completely ignored because the merge uses the defaults as the iteration base.

**Bug B: `getNavigationToolSettings()` also loses order**

Even if `getToolbarSettings()` preserved order, `getNavigationToolSettings()` iterates `NAVIGATION_TOOLS.map(...)` which again uses the default order.

**Fix:** Change `getToolbarSettings()` to use the stored array's order as the base, only adding new tools that don't exist in stored settings. Change `getNavigationToolSettings()` and `getVisualizationToolSettings()` to filter from the ordered result instead of mapping from defaults.

| File | Change |
|---|---|
| `src/components/viewer/ToolbarSettings.tsx` | Rewrite `getToolbarSettings()` to preserve stored order. Rewrite `getNavigationToolSettings()` and `getVisualizationToolSettings()` to filter from ordered settings instead of mapping from defaults. |

### Detailed fix for order preservation:

**Before (broken):**
```
getToolbarSettings():
  DEFAULT_TOOLS.map(defaultTool => {
    find in stored -> merge
  })
  // Always returns default order
```

**After (fixed):**
```
getToolbarSettings():
  1. Start with stored tools in their saved order
  2. For each stored tool, merge with default (to pick up label changes)
  3. Append any new default tools not in stored settings
  // Returns user's saved order
```

**Before (broken):**
```
getNavigationToolSettings():
  NAVIGATION_TOOLS.map(navTool => find in allSettings)
  // Always returns default navigation order
```

**After (fixed):**
```
getNavigationToolSettings():
  allSettings.filter(t => NAVIGATION_TOOL_IDS.has(t.id))
  // Returns user's saved order, filtered to navigation tools only
```

## File Summary

| File | Changes |
|---|---|
| `src/lib/ivion-sdk.ts` | Add `siteId` parameter to `loadIvionSdk()`. After SDK init, auto-load site via `api.site.repository.findOne()` + `api.site.service.loadSite()`. Hide sidebar menu items. |
| `src/lib/viewer-events.ts` | Add `VIEWER_TOOL_CHANGED_EVENT` constant and type |
| `src/pages/VirtualTwin.tsx` | (1) Pass siteId to `loadIvionSdk()`, (2) listen for tool change events and toggle 3D overlay pointer-events |
| `src/components/viewer/ViewerToolbar.tsx` | Dispatch `VIEWER_TOOL_CHANGED_EVENT` on tool changes |
| `src/components/viewer/Ivion360View.tsx` | Pass siteId to `loadIvionSdk()` for consistency |
| `src/components/viewer/ToolbarSettings.tsx` | Fix `getToolbarSettings()`, `getNavigationToolSettings()`, and `getVisualizationToolSettings()` to preserve user's saved order |

## Risk Assessment

- **Site loading (low risk):** Uses the SDK's own documented API (`site.repository.findOne` + `site.service.loadSite`). If site loading fails, the user sees the same site selection menu as today -- no regression.
- **Pointer-events toggle (low risk):** Only affects the Virtual Twin page. Default is `pointer-events: none` (same as today). Adds interactivity only when a tool is explicitly active.
- **Toolbar order fix (low risk):** Only changes the merge logic in `getToolbarSettings`. The stored data format is unchanged. Existing users' saved settings will immediately work correctly.

