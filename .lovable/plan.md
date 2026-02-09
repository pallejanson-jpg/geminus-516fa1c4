

# Fix ACC BIM Data Quality and Vite Build Error

## Two Issues

### Issue 1: Vite Build Failure
The `shimNodeModules` plugin runs too late -- Vite's built-in browser externalization intercepts `node:util`, `fs`, etc. before our plugin gets a chance. Fix: add `enforce: 'pre'` to the plugin so it runs before Vite's resolve step.

### Issue 2: BIM Property Mapping (Levels + Rooms)

From the Revit data (your screenshots) and the database, here's what we know:

**What Revit has:**
- Levels: Name = "U2 Etasje", "01 Etasje", "11 Etasje"
- Rooms: Level = "U2 Etasje", Name = "BATTERI/UPS", Number = "K1-205"

**What we get currently:**
- Levels: `common_name` = "Level 002ac82c" (GUID suffix -- Name property returns empty)
- Rooms: `common_name` = "08001" (Number only, no descriptive name)
- Rooms: `level_fm_guid` = null (matching broken since levels have GUID names)

**Root cause:** The Model Properties API uses different property keys per model. The hardcoded keys (`p153cb174` for Name) don't match this model's keys. The `fieldsMap` lookup works for "Number" but the "Name" field likely maps to Revit's internal element name (e.g., "Room"), not the user-assigned room name stored under a different property like "Room Name" or "Rumsnamn".

## Plan

### Step 1: Fix Vite plugin (1 file)

**`vite.config.ts`**: Add `enforce: 'pre'` to the `shimNodeModules` plugin so it intercepts `node:util` etc. before Vite externalizes them.

### Step 2: Add debug logging to `extractBimHierarchy` (deploy + test)

**`supabase/functions/acc-sync/index.ts`**: Before fixing the property mapping blindly, add temporary logging to dump:
- All field keys and names from `fieldsMap` (so we see the actual keys for this model)
- Sample property values for the first level and first room object
- Which keys were resolved for category/name/number/level

This lets us see exactly which property key holds the human-readable level name (e.g., "01 Etasje") and room name (e.g., "BATTERI/UPS").

### Step 3: Fix property key resolution

Based on the Revit structure, the fix involves:

1. **Broader field name matching**: Search `fieldsMap` for additional patterns:
   - Room name: "room name", "rumsnamn", "room_name", "funktionsnamn", "department"
   - Level name: The "Name" property on levels should work -- the issue is likely that the fieldsMap key for "Name" doesn't match our hardcoded `p153cb174`

2. **Populate `name` field** (designation): Set `name` = Number for rooms (matching Asset+ convention where `name` = designation like "K1-205")

3. **Room `common_name`**: Use "Number Name" pattern (e.g., "K1-205 BATTERI/UPS")

4. **Level naming via room references**: Since rooms have `bim_level_ref` = "Plan 08", use these to back-populate level names when the direct Name property fails. Collect unique level references from rooms and match them to levels by index/elevation order.

### Step 4: Fix level-room matching in `upsertBimAssets`

The current matching compares `room.level` ("Plan 08") against level `common_name` ("Level 002ac82c"). Fix by:
1. After fixing level names in Step 3, matching will work naturally
2. As a fallback, build a reverse map from `room.level` values to level fm_guids based on order

### Step 5: Better error feedback for failed syncs

In `ApiSettingsModal.tsx`, when all files fail and totalLevels + totalRooms = 0, show a specific error toast instead of silently finishing.

## Files to Modify

| File | Change |
|---|---|
| `vite.config.ts` | Add `enforce: 'pre'` to shim plugin |
| `supabase/functions/acc-sync/index.ts` | Add debug logging; broaden property key search; fix level naming from room refs; fix level-room matching; populate `name` field |
| `src/components/settings/ApiSettingsModal.tsx` | Show error toast when all files fail |

## Expected Result After Fix

- Levels: "01 Etasje", "U2 Etasje", "11 Etasje" (from Name property or room references)
- Rooms: `name` = "K1-205", `common_name` = "K1-205 BATTERI/UPS"
- Level-room mapping: rooms correctly linked to their level via `level_fm_guid`
- Build succeeds without xeokit-convert errors

