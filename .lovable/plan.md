

## Plan: Space Filter Fix, XKT Performance, Tandem-Style Room Visualization, and Ilean Context Integration

This is a large plan with 4 distinct workstreams. Each is described below with technical details.

---

### 1. Fix Space Filter (room selection hides everything)

**Root cause:** When a space is checked in the filter panel, `spaceIds` only contains the IfcSpace entity IDs (the room volume). The intersection logic on line 591 skips `levelIds` when spaces are checked (`checkedSpaces.size > 0 ? null : levelIds`), but `spaceIds` alone contains only the room volume -- not the surrounding walls, doors, furniture etc. So the intersection results in only the IfcSpace entities being "solid", and everything else gets hidden.

**Fix:** When spaces are checked, also include all entities from the parent level(s) of those spaces. This makes space filtering behave like level filtering but with the selected space highlighted:

In `ViewerFilterPanel.tsx`, around line 565-591:
- When `checkedSpaces.size > 0`, derive the parent level fmGuids from the spaces list
- Add those level entity IDs to a combined set that replaces the `spaceIds`-only filter
- Keep the space highlight (blue colorize) on the checked spaces
- The surrounding level geometry stays visible (same behavior as level filtering)

```typescript
// When spaces are checked, include parent level geometry
let spaceIds: Set<string> | null = null;
if (checkedSpaces.size > 0) {
  spaceIds = new Set<string>();
  // Add the space entities themselves
  checkedSpaces.forEach(fmGuid => {
    eMap.get(fmGuid)?.forEach(id => spaceIds!.add(id));
  });
  // ALSO add all entities from parent levels so context is visible
  const parentLevelGuids = new Set<string>();
  spacesRef.current.forEach(space => {
    if (checkedSpaces.has(space.fmGuid) && space.levelFmGuid) {
      parentLevelGuids.add(space.levelFmGuid);
    }
  });
  parentLevelGuids.forEach(levelGuid => {
    eMap.get(levelGuid)?.forEach(id => spaceIds!.add(id));
  });
}
```

This way, checking a room shows the full floor context with the room highlighted in blue -- same behavior as level filtering.

**Files:** `src/components/viewer/ViewerFilterPanel.tsx`

---

### 2. Tandem-Style Room Visualization (floor-only coloring)

**Problem:** Currently, room visualization colors the entire IfcSpace 3D volume (a box that fills the room). This blocks the view of objects inside the room. Autodesk Tandem only colors the floor surface.

**Approach:** Instead of colorizing the IfcSpace entity with `opacity: 0.6`, use a lower opacity that makes the room volume nearly invisible but still provides color feedback. The key change is in `RoomVisualizationPanel.tsx`:

```typescript
// In colorizeSpace function (line 362-373)
if (color) {
  entity.colorize = rgbToFloat(color);
  entity.opacity = 0.15; // Nearly transparent - shows color on floor without blocking
} else {
  entity.colorize = null;
  entity.opacity = 1.0;
}
```

This makes the room volume act as a subtle color wash (visible mainly on the floor plane) without blocking objects inside. A true floor-only approach would require splitting IfcSpace geometry into faces, which xeokit doesn't support per-face coloring. The transparency approach is the pragmatic solution that achieves a similar visual result.

**Files:** `src/components/viewer/RoomVisualizationPanel.tsx`

---

### 3. XKT Performance Strategy - Phase 1 Implementation

Phase 1: Multi-part XKT splitting by storey during conversion. This is the most impactful change with minimal architectural disruption.

#### 3a. Database Schema Change

Add columns to `xkt_models` table:
```sql
ALTER TABLE xkt_models ADD COLUMN parent_model_id text;
ALTER TABLE xkt_models ADD COLUMN storey_fm_guid text;
ALTER TABLE xkt_models ADD COLUMN is_chunk boolean DEFAULT false;
ALTER TABLE xkt_models ADD COLUMN chunk_order integer DEFAULT 0;
```

#### 3b. Conversion Pipeline (`acc-xkt-converter.ts`)

Add a new method `splitXktByStorey` that:
1. After converting a full model to XKT, parses the IFC hierarchy to identify `IfcBuildingStorey` boundaries
2. Creates per-storey XKT chunks using `xeokit-convert`'s filtering capabilities
3. Uploads each chunk to storage with naming convention: `{modelId}_storey_{storeyGuid}.xkt`
4. Records each chunk in `xkt_models` with `parent_model_id`, `storey_fm_guid`, `is_chunk=true`

```typescript
async splitXktByStorey(
  fullXktData: ArrayBuffer,
  modelId: string,
  buildingFmGuid: string,
  storeys: Array<{ guid: string; name: string }>,
  onLog?: (msg: string) => void
): Promise<void> {
  // For each storey, filter the IFC model to only include
  // entities that are children of that storey
  // Then convert the filtered set to a separate XKT chunk
}
```

#### 3c. Viewer Loading (`AssetPlusViewer.tsx`)

Update the model loading logic to:
1. Check if a model has chunks (`is_chunk = true` entries with matching `parent_model_id`)
2. If chunks exist, load them in priority order:
   - Current/visible floor first
   - Adjacent floors next
   - Remaining floors last
3. If no chunks, fall back to loading the full monolithic XKT (backward compatible)

```typescript
// Priority loading order
const sortedChunks = chunks.sort((a, b) => {
  if (a.storey_fm_guid === currentFloorGuid) return -1;
  if (b.storey_fm_guid === currentFloorGuid) return 1;
  return a.chunk_order - b.chunk_order;
});
```

#### 3d. Memory Management (`useXktPreload.ts`)

Update preloading to handle chunks:
- Preload only the current floor's chunks first
- Background-load remaining chunks
- Per-chunk memory tracking instead of per-model

**Files:**
- Database migration (new columns)
- `src/services/acc-xkt-converter.ts`
- `src/components/viewer/AssetPlusViewer.tsx`
- `src/hooks/useXktPreload.ts`
- `src/services/xkt-cache-service.ts`

---

### 4. Ilean Context-Aware Integration

**Goal:** Replace the iframe-based Ilean with a native Geminus UI that fetches Ilean data from Senslinc contextually based on the user's navigation level (building, floor, room, asset).

#### 4a. Senslinc URL Structure

From the examples provided:
- Room: `{portal}/machine/{pk}/ilean/` (e.g., "RUM 02.4.002 - ilean")
- Building: `{portal}/site/{pk}/home/` (e.g., "Småviken - Home")
- Floor: `{portal}/line/{pk}/home/` (e.g., "04 - 02 - Home")

The mapping is:
| Geminus Level | Senslinc Entity | API Endpoint |
|---|---|---|
| Building | Site | `/api/sites?code={buildingCode}` |
| Floor/Storey | Line | `/api/lines?site={sitePk}` |
| Room/Space | Machine | `/api/machines?code={roomFmGuid}` |

#### 4b. New Edge Function Action: `get-ilean-context`

Add a new action to `senslinc-query/index.ts`:

```typescript
case 'get-ilean-context': {
  // Given a fmGuid and context level (building/floor/room),
  // return the Ilean URL and dashboard data
  const { fmGuid, contextLevel } = request;
  
  // 1. Find the matching Senslinc entity
  // 2. Fetch its Ilean/dashboard data
  // 3. Return structured data for Geminus UI
  
  return jsonResponse({
    success: true,
    data: {
      ileanUrl: `${portalUrl}/machine/${machinePk}/ilean/`,
      dashboardUrl: `${portalUrl}/machine/${machinePk}/room_analysis/`,
      entityName: machine.name,
      entityType: contextLevel,
    }
  });
}
```

#### 4c. Transform IleanButton to Native Chat

Replace the iframe approach with a native Geminus component that:
1. Detects navigation context from `AppContext` (selectedFacility, activeApp, etc.)
2. Fetches the appropriate Senslinc data via the edge function
3. Renders a chat-like UI using existing Geminus design patterns (similar to GunnarChat)
4. The Ilean responses come from the Senslinc Ilean API, but displayed in Geminus styling

#### 4d. Insights Integration

When navigating to a building or floor in Insights:
- Fetch the Senslinc site/line dashboard data
- Display it in the Performance tab alongside existing metrics
- Use the `useSenslincData` hook but extend it to support building-level and floor-level queries (currently only room-level)

**New hook: `useSenslincContextData`**
```typescript
export function useSenslincContextData(
  fmGuid: string | null,
  contextLevel: 'building' | 'floor' | 'room'
) {
  // Fetches appropriate Senslinc data based on context level
  // Building → site dashboard data
  // Floor → line dashboard data  
  // Room → machine data (existing useSenslincData)
}
```

**Files:**
- `supabase/functions/senslinc-query/index.ts` (new action)
- `src/components/chat/IleanButton.tsx` (major refactor)
- `src/hooks/useSenslincData.ts` (extend with context levels)
- `src/components/insights/BuildingInsightsView.tsx` (integrate Senslinc building/floor data)
- `src/components/insights/tabs/PerformanceTab.tsx` (real data from Senslinc)

---

### Implementation Priority

| Priority | Task | Complexity |
|---|---|---|
| 1 | Fix space filter (item 1) | Small - 1 file change |
| 2 | Tandem-style room visualization (item 2) | Small - 1 file change |
| 3 | Ilean context integration (item 4) | Medium - 5 files |
| 4 | XKT Phase 1 (item 3) | Large - 5 files + migration |

### Files to Modify

| File | Changes |
|---|---|
| `src/components/viewer/ViewerFilterPanel.tsx` | Include parent level geometry when space is selected |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Reduce room volume opacity to 0.15 |
| `supabase/functions/senslinc-query/index.ts` | Add `get-ilean-context` action |
| `src/components/chat/IleanButton.tsx` | Refactor to native context-aware UI |
| `src/hooks/useSenslincData.ts` | Extend with building/floor context |
| `src/components/insights/BuildingInsightsView.tsx` | Integrate Senslinc data |
| `src/services/acc-xkt-converter.ts` | Add storey splitting |
| `src/components/viewer/AssetPlusViewer.tsx` | Priority chunk loading |
| `src/hooks/useXktPreload.ts` | Chunk-aware preloading |
| `src/services/xkt-cache-service.ts` | Chunk-aware caching |
| Database migration | Add chunk columns to xkt_models |

