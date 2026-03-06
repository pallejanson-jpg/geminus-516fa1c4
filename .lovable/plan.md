

## Plan: Mobile Layout Fix + Room Card Redesign + Gunnar Smart Upgrade

### Part 1: Mobile Layout Overflow Fix

**Problem:** On FacilityLandingPage, sections overflow to the right on mobile (~320px).

**Root cause:** Several sections lack proper overflow constraints. The outer container at line 389 has `overflow-x-hidden` but inner cards/grids may still push beyond.

**Fix in `FacilityLandingPage.tsx`:**
- Add `overflow-hidden` to all `Card` components and inner `CardContent` divs
- Constrain the grid containers (KPIs, rooms, assets, saved views) with `min-w-0` and `w-full`
- Ensure the settings section (map picker, sliders, coordinate inputs) wraps properly on narrow screens
- Add `break-words` / `truncate` to text that may overflow
- The `BuildingMapPicker` and `Slider` already handle their widths, but their parent containers need `overflow-hidden`

### Part 2: Move Room Cards from Building Page → Storey Page

**Current:** Building page shows a floor carousel + room grid for the selected floor.  
**Change:** 
- On the **building page**, remove the room grid section entirely (keep the floor carousel as navigation cards that click into the storey page)
- On the **storey page** (`isStorey`), add room cards using a compact list layout similar to Insights' `SpaceManagementTab` — each room shown as a horizontal row with name, number, area, and an occupancy-style progress bar
- Include search and sort controls (same pattern currently used)
- This matches the Insights visual language: compact rows with key metrics inline

### Part 3: Gunnar Smart Upgrade — FM Access, Viewer Control, Insights

This is the largest section. We need to add new tools to the `gunnar-chat` edge function and new action types in the frontend `GunnarChat.tsx`.

#### 3a. New Tools in `gunnar-chat/index.ts`

**FM Access tools** (call `fm-access-query` edge function internally):

| Tool | Description |
|------|-------------|
| `fm_access_get_drawings` | Get drawings for a building, grouped by tab/discipline (Arkitekt, El, VVS, etc.) |
| `fm_access_get_hierarchy` | Get object count and hierarchy for a building |
| `fm_access_search_objects` | Search objects in FM Access |
| `fm_access_show_drawing` | Get the 2D viewer URL for a specific floor's architect drawing |

Each tool calls the existing `fm-access-query` edge function (same pattern as `callSenslincQuery`):
```typescript
async function callFmAccessQuery(action: string, params: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resp = await fetch(`${supabaseUrl}/functions/v1/fm-access-query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ action, ...params }),
  });
  return resp.json();
}
```

**Viewer control tools:**

| Tool | Description |
|------|-------------|
| `viewer_show_floor` | Isolate a specific floor in the 3D viewer |
| `viewer_show_model` | Show/hide specific models (A-modell, VVS, El, etc.) |
| `viewer_open_building_3d` | Open the 3D viewer for a building |
| `viewer_switch_mode` | Switch between 2D/3D view modes |

These return action instructions that the AI will format as action buttons in its response using the existing `action:` link syntax.

**Insights/sensor enhancement:**
- Update the system prompt to instruct Gunnar to use `senslinc_search_data` for temperature/sensor questions and provide floor-level answers
- Add guidance for "which floors have avg temp > X" queries — Gunnar should call `get_floor_details` for each floor, then `senslinc_search_data` per floor

#### 3b. New Action Types in `GunnarChat.tsx`

Add to `handleActionLink` and `executeAction`:
- `action:showDrawing:BUILDING_GUID:FLOOR_NAME` → Navigate to `/viewer?building=GUID&mode=2d&floorName=NAME`
- `action:isolateModel:MODEL_ID` → Dispatch event to show only specified model
- `action:showFloorIn3D:BUILDING_GUID:FLOOR_GUID` → Navigate to `/viewer?building=GUID&mode=3d&floor=FLOOR_GUID`

#### 3c. System Prompt Enhancement

Update `buildSystemPrompt` to include:
- FM Access capabilities and example interactions
- Instructions to always suggest follow-up actions
- Building name → `building_settings.fm_access_building_guid` mapping for FM Access queries
- Model naming conventions (A-modell = Arkitekt, K-modell = Konstruktion, etc.)
- Pre-fetch `building_settings` with `fm_access_building_guid` to include in the building directory

#### 3d. New Action Button Syntax in System Prompt

```
[📐 Visa ritning](action:showDrawing:BUILDING_GUID:FLOOR_NAME) — show 2D drawing
[🧊 Visa våning i 3D](action:showFloorIn3D:BUILDING_GUID:FLOOR_GUID) — show floor in 3D
[🏗️ Visa modell](action:isolateModel:MODEL_ID) — isolate a specific BIM model
```

---

### Implementation Order

1. Fix mobile overflow in `FacilityLandingPage.tsx`
2. Restructure room cards: remove from building page, add Insights-style layout to storey page
3. Add FM Access tools to `gunnar-chat/index.ts`
4. Add viewer control tools to `gunnar-chat/index.ts`
5. Update system prompt with FM Access, viewer, and follow-up instructions
6. Add new action types in `GunnarChat.tsx`

### Files Modified

- `src/components/portfolio/FacilityLandingPage.tsx` — mobile fix + room card restructure
- `supabase/functions/gunnar-chat/index.ts` — new tools + prompt update
- `src/components/chat/GunnarChat.tsx` — new action types

