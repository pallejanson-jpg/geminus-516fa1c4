

# Plan: Fix Runtime Crash — `xrayedObjectIds` on Null

## Problem

The xeokit SDK's `scene.xrayedObjectIds` is a getter that internally calls `Object.keys()` on an internal map. When the scene isn't fully initialized (or during teardown), that internal map is null/undefined, causing `TypeError: Cannot convert undefined or null to object`.

This crashes the app with a blank screen.

## Fix

Wrap all accesses to `scene.xrayedObjectIds` and `scene.colorizedObjectIds` in try/catch blocks in `ViewerFilterPanel.tsx`. There are 3 locations:

### File: `src/components/viewer/ViewerFilterPanel.tsx`

1. **Line 831** (`applyFilterVisibility`): Wrap `scene.xrayedObjectIds` access in try/catch, default to empty array.

2. **Line 838** (`applyFilterVisibility`): Same for `scene.colorizedObjectIds`.

3. **Lines 1491-1492** (cleanup effect): Wrap both `scene.xrayedObjectIds` and `scene.colorizedObjectIds` in try/catch.

All catches will silently swallow the error (these are best-effort cleanup operations).

