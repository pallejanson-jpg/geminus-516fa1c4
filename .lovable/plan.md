

# Fix Room Field Mapping + Add Room Properties + Extract BIM Instances

## Three Changes

### 1. Fix Room Name/Number Mapping

**Current (wrong):**
- `name` = "10026" (Number)
- `common_name` = "10026" (Number only)

**Correct (matching ACC/Revit convention):**
- `name` = "TRAPPA" (Room Name from ACC "Name" field)
- `common_name` = "10026 TRAPPA" (Number + Name combined)

The issue is in `extractBimHierarchy` (lines 757-798): the code sets `designation = number` and puts it in `room.name`, while the descriptive name goes only into `common_name` as a suffix. The logic needs to be swapped so that:
- `room.name` = the descriptive name (from "Name", type/family, or Room Name field)
- `room.commonName` = "Number DescriptiveName"

### 2. Extract More Room Properties (Area, etc.)

Currently, room objects from BIM only store minimal attributes (`source`, `acc_project_id`, `bim_external_id`, `bim_level_ref`). Asset+ rooms have rich properties like Area, BRA, NTA, Department, etc.

The Model Properties API returns all Revit parameters for each room object. We need to:
1. Resolve additional field keys from `fieldsMap`: "Area", "Perimeter"/"Omkrets", "Department"/"Avdelning", "Volume", "Unbounded Height"
2. Store resolved values in the `attributes` JSON column (matching the Asset+ pattern with `name`, `value`, `dataType`)
3. Populate `gross_area` DB column with the Area value when available

### 3. Extract BIM Instances (Doors, Windows, Walls, etc.)

Currently `extractBimHierarchy` only looks for "Revit Level" and "Revit Rooms" categories. All other objects (doors, windows, walls, furniture, MEP equipment) are ignored.

In Revit/ACC, these are elements with categories like:
- "Revit Doors" / "Doors"
- "Revit Windows" / "Windows"  
- "Revit Walls" / "Walls"
- "Revit Furniture" / "Furniture"
- "Revit Mechanical Equipment" / "Mechanical Equipment"
- Generic "Revit Family Instances"

These map to `category: 'Instance'` (objectType 4) in Asset+.

**Approach:**
- After extracting levels and rooms, do a second pass over all objects
- Skip levels, rooms, and non-physical categories (views, grids, reference planes)
- Extract: name, type/family, level reference, room reference (if available)
- Store as `fm_guid: acc-bim-instance-{externalId}`, `category: 'Instance'`
- Link to building, level, and room via the existing hierarchy

**Important constraint:** BIM models can contain 10,000-50,000+ instances. To avoid overwhelming the database:
- Only extract instances with meaningful categories (skip annotations, grids, reference planes)
- Batch upsert in chunks of 200
- Log count per category for diagnostics

## Technical Details

### File: `supabase/functions/acc-sync/index.ts`

#### A. Fix `extractBimHierarchy` room naming (lines 757-798)

```text
// BEFORE (wrong):
room.name = designation;          // "10026" (Number)
room.commonName = "10026 TRAPPA"; // or just "10026"

// AFTER (correct):
room.name = descriptiveName;      // "TRAPPA" (Room Name)
room.commonName = "10026 TRAPPA"; // Number + Name
room.number = designation;        // "10026" (kept for reference)
```

#### B. Add property extraction for rooms

Resolve these additional field keys from `fieldsMap`:
- "Area" / "area" 
- "Perimeter" / "Omkrets" / "perimeter"
- "Volume" / "volume"
- "Department" / "Avdelning"
- "Unbounded Height" / "Rumshojd"

Store in room object and pass through to `upsertBimAssets`.

#### C. Add instance extraction

Add a new collection pass in the props loop:
- Identify instances by exclusion (not Level, not Room, not abstract categories)
- Skip categories: "Views", "Grids", "Reference Planes", "Sheets", "Scope Boxes", "Matchline", "Detail Items", "Model Text"
- Collect: externalId, name, category, type/family, level ref, room ref (if "Room" field exists)
- Return as `instances[]` from `extractBimHierarchy`

#### D. Update `upsertBimAssets` (lines 864-960)

- Accept `instances[]` parameter
- Add room properties to attributes JSON (area, perimeter, department, etc.)
- Set `gross_area` column for rooms when Area is available
- Upsert instances as `category: 'Instance'` with `fm_guid: acc-bim-instance-{externalId}`
- Link instances to levels and rooms using the level/room maps

#### E. Update `sync-bim-data` action response

- Include instance count in response message
- Update `upsertBimAssets` return type to include instance count

### File: `src/components/settings/ApiSettingsModal.tsx`

- Update sync result display to show instance count alongside levels and rooms

## Expected Result After Re-sync

- Room `name` = "TRAPPA" (descriptive name from ACC)
- Room `common_name` = "10026 TRAPPA" (number + name)
- Room `gross_area` = 15.5 (from BIM Area property)
- Room `attributes` includes Area, Perimeter, Department, etc.
- Instances (doors, windows, walls) appear as `category: 'Instance'` in the database
- Instance `common_name` = "Door Type A" (type/family name)
- Instance `level_fm_guid` and `in_room_fm_guid` linked to hierarchy

## Excluded Categories (Instances)

These Revit categories will be skipped as they're not physical assets:
"Views", "Grids", "Reference Planes", "Sheets", "Scope Boxes", "Matchline", "Detail Items", "Model Text", "Lines", "Filled Region", "Project Information", "Material Assets", "Schedules", "Legends"
