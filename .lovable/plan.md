

# Mobile 3D Viewer: Fix XKT loading, toolbar positioning, and assistant defaults

## Problem Summary

Four distinct issues need to be fixed for mobile:

1. **3D content not displaying (blank canvas)**: The `Mobile3DViewer` page (route `/viewer`) uses a recursive tree traversal looking for `children` in `allData` to find buildings. However, `allData` is a **flat array** without nested `children`. This means the building list is always empty, and the viewer never receives a valid `fmGuid` to load models. The desktop `BuildingSelector` correctly uses `allData.filter(item => item.category === 'Building')`.

2. **Toolbars hidden under browser chrome**: The mobile toolbar uses `absolute bottom-3` which positions it at the bottom of the viewport -- directly under the mobile browser's navigation bar. The header overlay at `absolute top-0` can clip under the status bar.

3. **Header not hidden in immersive mode (in-app path)**: When the 3D viewer loads inside `AppLayout` (via the `assetplus_viewer` activeApp), the immersive mode already works. But when navigating via `/viewer` route, the `Mobile3DViewer` page renders outside `AppLayout` entirely, so this is already fullscreen. The issue is that within the in-app path, `BuildingSelector` also needs proper immersive handling.

4. **Gunnar and Ilean floating buttons visible by default**: Both assistants default to `visible: true` in their settings, cluttering mobile screens.

---

## Changes

### 1. Fix Mobile3DViewer building extraction (Critical)

**File:** `src/pages/Mobile3DViewer.tsx`

Replace the recursive tree traversal with the same flat-array filter used by the working desktop `BuildingSelector`:

```text
// BEFORE (broken - looks for .children which doesn't exist on flat allData)
const extractBuildings = (nodes) => {
  for (const node of nodes) {
    if (node.category === 'Building') result.push(node);
    if (node.children) result.push(...extractBuildings(node.children));
  }
};
const rootNodes = Array.isArray(allData) ? allData : allData?.children || [];
return extractBuildings(rootNodes);

// AFTER (correct - matches BuildingSelector pattern)
return allData.filter(item => item.category === 'Building');
```

Also fix `getFloorCount` to count floors from the flat array instead of non-existent `children`:

```text
// BEFORE
const getFloorCount = (building) => {
  if (!building?.children) return 0;
  return building.children.filter(c => c.category === 'Level').length;
};

// AFTER
const getFloorCount = (building) => {
  return allData.filter(item =>
    item.buildingFmGuid === building.fmGuid &&
    (item.category === 'Building Storey' || item.category === 'IfcBuildingStorey')
  ).length;
};
```

### 2. Fix toolbar positioning with safe-area-insets

**File:** `src/components/viewer/ViewerToolbar.tsx`

For the mobile toolbar (around line 742), change `bottom-3` to account for the mobile browser's bottom chrome using CSS `env(safe-area-inset-bottom)`:

```text
// BEFORE
className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 ..."

// AFTER - use safe-area padding
style={{
  bottom: 'calc(env(safe-area-inset-bottom, 12px) + 12px)',
  left: '50%',
  transform: 'translateX(-50%)',
}}
```

**File:** `src/components/viewer/mobile/MobileViewerOverlay.tsx`

For the header overlay (line 130), add safe-area-inset-top padding:

```text
// BEFORE
className="absolute top-0 left-0 right-0 z-30 ..."

// AFTER
style={{
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
}}
```

Also position the NavCube canvas higher to avoid the toolbar:

**File:** `src/components/viewer/AssetPlusViewer.tsx`

Change the NavCube bottom positioning on mobile (around line 2920):

```text
// BEFORE
className="absolute bottom-[70px] right-3 z-[25]"

// AFTER (account for safe area)
className="absolute right-3 z-[25]"
style={{ bottom: 'calc(env(safe-area-inset-bottom, 12px) + 70px)' }}
```

### 3. Default Gunnar and Ilean to hidden

**File:** `src/components/settings/GunnarSettings.tsx`

Change default `visible` from `true` to `false`:

```text
const DEFAULT_SETTINGS: GunnarSettingsData = {
  visible: false,  // was: true
  buttonPosition: null,
};
```

**File:** `src/components/settings/IleanSettings.tsx`

Same change:

```text
const DEFAULT_SETTINGS: IleanSettingsData = {
  visible: false,  // was: true
  buttonPosition: null,
};
```

Note: Existing users who have already saved settings in localStorage will not be affected by this change. Only new users or users who have never toggled these settings will see the new default.

### 4. Add viewport meta tag for safe-area support

**File:** `index.html`

Ensure the viewport meta tag includes `viewport-fit=cover` so that `env(safe-area-inset-*)` values are available:

```text
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

---

## File Summary

| File | Change |
|------|--------|
| `src/pages/Mobile3DViewer.tsx` | Fix building extraction to use flat array filter instead of recursive tree traversal |
| `src/components/viewer/ViewerToolbar.tsx` | Add safe-area-inset-bottom padding to mobile toolbar |
| `src/components/viewer/mobile/MobileViewerOverlay.tsx` | Add safe-area-inset-top padding to header overlay |
| `src/components/viewer/AssetPlusViewer.tsx` | Adjust NavCube positioning with safe-area padding |
| `src/components/settings/GunnarSettings.tsx` | Default `visible` to `false` |
| `src/components/settings/IleanSettings.tsx` | Default `visible` to `false` |
| `index.html` | Add `viewport-fit=cover` to viewport meta tag |

## Risk Assessment

- **Building extraction fix**: Low risk -- aligns with proven desktop BuildingSelector pattern.
- **Safe-area insets**: Low risk -- gracefully falls back to default values on non-mobile browsers.
- **Assistant defaults**: Minimal risk -- only affects new users or those without saved localStorage settings.

