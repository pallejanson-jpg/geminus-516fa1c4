

## Plan: Extend Geminus AI with IoT Sensor Data & Filter Sync

### Overview

Add IoT/sensor capabilities to the existing structured AI assistant, enabling queries like "show temperature in room A101" or "show pumps with high temperature". This requires new RPC functions for sensor data, new AI tools, enhanced viewer bridge for color-coded highlighting, and filter sync between AI responses and the UI.

### 1. New RPC Functions (Database Migration)

Create 2 new Postgres RPC functions:

**`get_sensors_in_room(sensor_type text, room_guid text)`**
- Queries `assets` table for sensor-related asset types (IfcSensor, IfcAlarm, etc.) in a given room
- Also returns sensor attributes (temperature, CO2, humidity values from `attributes` JSONB)
- Limit 200, SECURITY DEFINER

**`get_latest_sensor_values(sensor_ids text[])`**
- Given asset fm_guids, extracts the latest sensor readings from `assets.attributes` (where Senslinc data is stored)
- Returns `fm_guid`, `sensor_type`, `value`, `unit`, `room_fm_guid`, `room_name`
- Limit 200, SECURITY DEFINER

### 2. New AI Tools (Edge Function)

Add 2 new tool definitions to `gunnar-chat/index.ts`:

| Tool | Parameters | Purpose |
|---|---|---|
| `get_sensors_in_room` | `sensor_type`, `room_guid` | Find sensors by type in a room |
| `get_latest_sensor_values` | `sensor_ids[]` | Get current readings for sensors |

Add corresponding cases in `executeTool()` calling `supabase.rpc()`.

### 3. Enhanced Response Format

Extend `format_response` tool schema and `AiStructuredResponse` to include:

```json
{
  "message": "Room A101: Temperature 23.5°C, CO2 650 ppm",
  "action": "highlight",
  "asset_ids": [],
  "external_entity_ids": [],
  "filters": { "system": "ventilation", "category": "", "room": "A101" },
  "sensor_data": [
    { "entity_id": "xyz", "value": 23.5, "type": "temperature", "status": "normal" },
    { "entity_id": "abc", "value": 850, "type": "co2", "status": "warning" }
  ],
  "color_map": {
    "xyz": [0, 0.8, 0.2],
    "abc": [1, 0.3, 0.1]
  }
}
```

### 4. Viewer Bridge Enhancement

Extend `useAiViewerBridge.ts` with a new action `colorize`:

- **`colorizeEntities(colorMap)`**: Apply per-entity colors (green=normal, yellow=warning, red=critical) based on sensor values
- Add `colorMap` to `AiViewerCommand` interface
- The bridge applies colors using `scene.setObjectsColorized()` after x-raying others

### 5. Frontend Filter Sync

In `GunnarChat.tsx`, when a response includes `filters`:
- Dispatch a new `AI_FILTER_SYNC` custom event with the filter payload
- The `ViewerFilterPanel` or `VisualizationToolbar` can listen for this event and apply matching filters
- This keeps AI, UI, and viewer in sync

### 6. System Prompt Update

Add IoT-specific instructions to `buildSystemPrompt`:
- When user asks about temperature/CO2/humidity → use `get_sensors_in_room` + `get_latest_sensor_values`
- Chain: sensors → `get_viewer_entities` → apply color coding based on thresholds
- Include threshold rules (temp >26°C = warning, CO2 >1000 = warning)
- Multi-step reasoning: "show pumps with high temperature" → search pumps → get sensors in same rooms → cross-reference

### File Changes

| File | Change |
|---|---|
| `supabase/migrations/` | New migration: 2 RPC functions |
| `supabase/functions/gunnar-chat/index.ts` | Add 2 tools, extend format_response schema, update system prompt |
| `src/components/chat/GunnarChat.tsx` | Handle `sensor_data` + `color_map` in response, dispatch `AI_FILTER_SYNC` event |
| `src/hooks/useAiViewerBridge.ts` | Add `colorize` action with per-entity color support |

### Example Flows

**"Show temperature in room A101"**
1. AI calls `get_sensors_in_room("temperature", room_guid)`
2. AI calls `get_latest_sensor_values(sensor_ids)`
3. AI calls `get_viewer_entities(asset_ids)`
4. AI calls `format_response` with sensor_data + color_map + action="highlight"
5. Frontend applies color-coded highlights + displays readings in chat

**"Show all pumps with high temperature"**
1. AI calls `get_assets_by_system("pump", building_guid)`
2. AI calls `get_sensors_in_room("temperature", room_guids)` for each room
3. Filters to pumps in rooms with temp > threshold
4. AI calls `get_viewer_entities` → `format_response` with filtered results

