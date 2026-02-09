

# Fix ACC BIM Data Quality and Vite Build Error — IMPLEMENTED

## Changes Made

### 1. Vite Build Fix (`vite.config.ts`)
- Added `enforce: 'pre'` to `shimNodeModules` plugin

### 2. BIM Property Mapping (`supabase/functions/acc-sync/index.ts`)
- **Dynamic field resolution**: Searches `fieldsMap` for category, name, elevation, level, number, room name, and department keys
- **Room Name keys**: Added "Room Name", "Rumsnamn", "Room_Name", "Department", "Funktionsnamn" patterns
- **Room naming**: `name` = Number (designation), `common_name` = "Number Description" (matches Asset+ convention)
- **Level naming fix**: Post-processing step detects GUID-like level names and back-fills from room `level` references (sorted by elevation)
- **Debug logging**: Logs all fieldsMap entries, resolved keys, and first level/room props for debugging
- **Level-room matching**: Already worked via `levelNameMap` — now works correctly because levels get proper names

### 3. Error Feedback (`src/components/settings/ApiSettingsModal.tsx`)
- Shows specific error toast when all files sync successfully but no levels/rooms are found

## Expected Results
- Levels: human-readable names from Revit (e.g., "01 Etasje", "U2 Etasje") or room references (e.g., "Plan 08")
- Rooms: `name` = "K1-205", `common_name` = "K1-205 BATTERI/UPS"
- Level-room mapping: rooms correctly linked via `level_fm_guid`
- Silent failures now show error toasts
