

# Plan: Let inventory 3D picker use NativeXeokitViewer's built-in sync

## Problem
`PositionPickerDialog` and `PositionPickerStep` check `xkt_models` table for existing models. If none found, they show "Ingen 3D-modell tillgänglig" and block the user. But `NativeXeokitViewer` already has auto-sync logic that fetches models from Asset+ when none exist locally. The inventory dialogs bypass this by never rendering the viewer.

## Solution
Remove the pre-check gates. Always render `NativeXeokitViewer` — it will handle the "no models" case by syncing from Asset+, exactly like it does in the main viewer.

## Changes

### 1. `src/components/inventory/PositionPickerDialog.tsx`
- Remove `hasModels` state and the `useEffect` that checks `xkt_models`
- Remove the conditional rendering (loading / no models / viewer)
- Always render `NativeXeokitViewer` directly — it handles syncing and error states internally

### 2. `src/components/inventory/mobile/PositionPickerStep.tsx`
- Remove `has3dModels` state and the Supabase check for `xkt_models`
- Always show the "Välj i 3D-modell" button as enabled (the viewer will sync if needed)
- Remove the disabled state / "Ingen 3D-modell tillgänglig" fallback

## Files to change
1. `src/components/inventory/PositionPickerDialog.tsx`
2. `src/components/inventory/mobile/PositionPickerStep.tsx`

