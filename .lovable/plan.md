
# ✅ Fix Room Naming: Use Type/Family Name for Room Names

## Status: IMPLEMENTED

### Changes Made (`supabase/functions/acc-sync/index.ts`)

1. Added dynamic `typeNameKey` resolution — searches `fieldsMap` for "Family", "Type Name", "Typ", "Family Name" patterns
2. Falls back to hardcoded `pdf772b6f` (known key from Stadshuset Nyköping)
3. Updated room name fallback chain: Room Name > Type/Family Name > Department > stripped Name
4. Strips Revit ID suffix (e.g. `[3767053]`) from fallback names
5. Strips duplicate number prefix from fallback names

### Expected Result After Re-sync

- Room `name` = "10001" (designation)
- Room `common_name` = "10001 TRAPPA" (designation + type name)
- Levels unchanged (fix already working)
