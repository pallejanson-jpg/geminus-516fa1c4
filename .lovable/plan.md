

# Plan: Add Native Viewer as Sidebar Entry Point

## Overview
Add the native xeokit viewer as a selectable option when entering via the sidebar "3D Viewer", while keeping the old AssetPlusViewer for portfolio/navigator flows.

## Approach
Use a new `activeApp` value `'native_viewer'` for the sidebar entry point. This keeps both paths completely independent.

## Changes

### 1. `src/lib/sidebar-config.ts`
- Add `assetplus_viewer` entry with a Cuboid icon and label "3D Viewer" (the sidebar item that was previously handled only by `DEFAULT_SIDEBAR_ORDER`)

### 2. `src/lib/constants.ts`
- Add `'assetplus_viewer'` to `DEFAULT_SIDEBAR_ORDER` if not already present (check first)

### 3. `src/components/layout/MainContent.tsx`
- Add a new case `'native_viewer'` that renders a new `NativeViewerPage` component (wrapper around BuildingSelector + NativeXeokitViewer)
- Add `'native_viewer'` to `VIEWER_APPS`

### 4. Create `src/pages/NativeViewerPage.tsx`
- Same building selection logic as `Viewer.tsx` but renders `NativeXeokitViewer` instead of `AssetPlusViewer`
- Reuses existing `BuildingSelector` for picking a building

### 5. `src/components/layout/LeftSidebar.tsx`
- Change the sidebar click for `assetplus_viewer` to set `activeApp('native_viewer')` instead — or add special handling in `handleItemClick`

### 6. `src/components/layout/AppLayout.tsx`
- Add `'native_viewer'` to `IMMERSIVE_APPS`

## Result
- Sidebar "3D Viewer" → native xeokit viewer (new fast pipeline)
- Portfolio/Navigator "Open 3D" → old AssetPlusViewer (full feature set)
- Both share the same BuildingSelector for picking buildings

