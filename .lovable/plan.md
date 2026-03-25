

# Plan: Fix Alarm Management, Predictive/Optimization AI, and Viewer Room Coloring

## Issues Identified

### 1. Delete 90% actually works correctly
The code `shuffled.slice(0, Math.floor(shuffled.length * 0.9))` does take 90%. However, `handleDeleteRandom90` fetches alarms with `.limit(10000)` — if your building has more than 10,000 alarms, it only processes the first batch. No code change needed unless you have >10k alarms.

### 2. Alarm Detail Panel — missing
Clicking an alarm row does nothing. Need a slide-out detail panel showing alarm attributes, room info, and a "Send to colleague" email button.

### 3. Alarm "Show 3D" / "Show Annotation" — not implemented
The alarm list table has no buttons for opening the 3D viewer or navigating to an annotation.

### 4. Predictive Maintenance & Room Optimization return 0 rooms
**Root cause found**: Both edge functions filter by `category = 'IfcSpace'`, but the actual DB data uses `category = 'Space'`. Similarly, equipment uses `category = 'Instance'`, not `IfcSensor` etc. This is why the AI reports "0 rooms and 0 equipment".

### 5. AI responses in Swedish
Both edge functions have Swedish system prompts. Need to switch to English.

### 6. Viewer room coloring — entity ID cache mismatch
**Root cause found**: The `entityIdCache` is built from `metaObj.originalSystemId` in the xeokit metaScene. But this value (IFC GlobalId) may not match the FM GUID format stored in the database. The cache lookup fails silently, returning `[]` entity IDs, so `colorizeSpace` does nothing. The Portfolio view works because it only reads attributes — it doesn't need to map to 3D entities.

**Fix**: Add a fallback: also try matching by iterating scene objects and checking if the entity's metaObject has properties/attributes containing the fmGuid.

---

## Changes

### 1. Fix Predictive Maintenance edge function
**File**: `supabase/functions/predictive-maintenance/index.ts`
- Change category filter from `["IfcSpace", "IfcSensor", ...]` to `["Space", "IfcSpace", "Instance"]`
- Also include rooms with sensor data by querying attributes that contain sensor values
- Switch AI system prompt from Swedish to English
- Include actual sensor attribute values in the summary sent to AI

### 2. Fix Room Optimization edge function
**File**: `supabase/functions/room-optimization/index.ts`
- Change `.eq("category", "IfcSpace")` to `.in("category", ["Space", "IfcSpace"])`
- Switch AI system prompt from Swedish to English
- Include sensor data from attributes in the room summary

### 3. Add Alarm Detail Panel
**File**: `src/components/insights/tabs/AlarmManagementTab.tsx`
- Add state for `selectedAlarm` and fetch full alarm data (including attributes) when a row is clicked
- Render a Sheet/drawer showing: FM GUID, floor, room, timestamps, all attributes
- Add "Send via Email" button that opens `mailto:` with alarm details pre-filled
- Add "Show in 3D" button that sets `viewer3dFmGuid` via AppContext to navigate to the alarm's room
- Add "Show Annotation" button that navigates to the annotation view

### 4. Fix Viewer Room Coloring — entity ID cache
**File**: `src/components/viewer/RoomVisualizationPanel.tsx`
- Enhance entity cache building: in addition to `originalSystemId`, also check `metaObj.externalId` and iterate properties/propertySets for a `fmGuid` or `fmguid` match
- Add a second-pass fallback: scan `scene.objects` and check if any entity ID contains the fmGuid (case-insensitive substring match)
- Log cache hit rate so debugging is easier

### 5. Translate AI prompts to English
**Files**: Both edge functions above
- Replace all Swedish text in system prompts with English equivalents
- JSON field descriptions stay the same (they're structural)

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/predictive-maintenance/index.ts` | Fix category filter, translate prompts, include sensor data |
| `supabase/functions/room-optimization/index.ts` | Fix category filter, translate prompts, include sensor data |
| `src/components/insights/tabs/AlarmManagementTab.tsx` | Add detail panel, email, Show 3D, Show Annotation buttons |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Fix entity ID cache with fallback matching strategies |

## No database changes needed

