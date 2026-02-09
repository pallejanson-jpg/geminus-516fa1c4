

# Fix Room Naming: Use `pdf772b6f` (Type/Family Name) for Room Names

## Problem

The debug logs reveal the actual property structure:

- `p153cb174` (name) = "TRAPPA 10001 [3767053]" -- Revit's internal element name with ID suffix, NOT useful
- `pdf772b6f` = "TRAPPA" -- the short room type/name we actually want
- `p3e6cca4a` = "OVA" -- department/function abbreviation
- `p29ff6f58` (number) = "10001" -- room number (works correctly)

Currently rooms get `common_name` = "10001" (number only). They should get `common_name` = "10001 TRAPPA".

## Root Cause

The field `pdf772b6f` contains the human-readable room name ("TRAPPA", "KORRIDOR", etc.) but the code doesn't look up this field. Based on the fieldsMap output, this key likely corresponds to "Family" or "Type Name" in Revit.

## Fix

### File: `supabase/functions/acc-sync/index.ts` -- `extractBimHierarchy`

1. Add `pdf772b6f` ("Family" / "Type Name") as an additional room name source
2. Search the fieldsMap for keys named "Family", "Type Name", "Type", "type_name" to resolve this dynamically
3. Update room name construction:
   - `name` = Number (e.g., "10001") -- already works
   - `common_name` = "Number TypeName" (e.g., "10001 TRAPPA")
4. Fallback chain for room description: roomName key > `pdf772b6f` (type/family) > department > name (stripped of ID suffix)

### File: `supabase/functions/acc-sync/index.ts` -- Jonkoping fix

The Jonkoping sync returned 0 levels, 0 rooms. Need to add logging for:
- Whether the Model Properties index exists (check-status response)
- The actual HTTP status/body when the properties query fails
- Show the user a clear message that the model needs indexing first

### Technical Detail

In `extractBimHierarchy`, after the existing field resolution block, add:

```text
// Resolve "type name" / "family" field for room descriptions
const typeNameKey = Object.entries(fieldsMap)
  .find(([_, name]) => /^(family|type.?name|typ)$/i.test(name))?.[0]
  || 'pdf772b6f';  // fallback to known key from Stadshuset

// When building room objects:
const typeName = props[typeNameKey] || '';
const roomDesc = roomNameVal || typeName || deptVal || '';
room.common_name = roomDesc 
  ? `${numberVal} ${roomDesc}` 
  : numberVal;
room.name = numberVal;  // designation
```

### Level naming -- already working

The logs confirm the GUID-to-human-name fix works:
- "Level 002ac82c" was renamed to "Plan 09"
- "Level 00133264" was renamed to "Plan 08"
- All 6 room references mapped to 7 levels (one extra level got no rename, acceptable)

No changes needed for level naming.

## Files to Modify

| File | Change |
|---|---|
| `supabase/functions/acc-sync/index.ts` | Add type/family name field resolution; update room common_name construction; add error logging for empty sync results |

## Expected Result

- Room `name` = "10001" (designation)
- Room `common_name` = "10001 TRAPPA" (designation + type name)
- Levels unchanged (fix already working)
- Jonkoping: clear error message explaining why 0 results

