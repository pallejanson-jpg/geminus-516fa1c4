

## Problem

Gunnar AI cannot answer sensor/temperature questions (e.g. "Vilket rum har högst temperatur?", "Genomsnittstemperatur i byggnaden?") because:

1. **The fast-path `iot_query`** calls `execLiveSensorData` which relies on Senslinc API `latest_values` — these are often null
2. **Ranking/complex questions** (e.g. "vilka rum har högst temp") are excluded from fast-path and sent to the AI loop, but the AI loop's `get_live_sensor_data` tool has the same problem
3. **Sensor data already exists in the database** as attributes on Space assets (`sensorTemperature`, `sensorCO2`, `sensorHumidity`, `sensorOccupancy`) — the same data used for room color visualization — but Gunnar never queries it

## Solution

Add a new tool and database RPC that lets Gunnar query sensor attributes directly from the `assets` table, with sorting/filtering/aggregation built in. This is the same data source the visualization panel uses.

### 1. New database function: `get_room_sensor_data`

Create an RPC function that:
- Selects all Space assets for a building (or filtered by floor)
- Extracts sensor values from the `attributes` JSONB column (keys: `sensorTemperature`, `sensorCO2`, `sensorHumidity`, `sensorOccupancy`, `Sensor Temperature`, etc.)
- Returns: `fm_guid`, `common_name`, `name`, `level_fm_guid`, `temperature`, `co2`, `humidity`, `occupancy`
- Ordered by a requested metric (for ranking questions)
- Limited to 200 rows

### 2. New tool in `gunnar-chat`: `get_room_sensor_data`

Add a tool definition that the AI can call:
- Parameters: `building_guid` (required), `floor_guid` (optional), `metric` (optional: temperature/co2/humidity/occupancy), `order` (optional: asc/desc)
- Executes the RPC function
- Returns structured data with averages, highest/lowest, and per-room values

### 3. Update `execLiveSensorData` fallback

When Senslinc API returns no data (`available: false`), fall back to the database RPC to get cached sensor attributes from spaces.

### 4. Update fast-path IoT routing

Remove the `isRankingQuestion` exclusion — ranking questions like "vilka rum har högst temperatur" should also go through the fast-path `iot_query`, which will now handle them via the database fallback.

### 5. Update system prompt

Add instruction: "For sensor/temperature/CO2/humidity questions, use `get_room_sensor_data` to query cached sensor attributes from rooms. Use `get_live_sensor_data` only when you need real-time data from the Senslinc platform."

### Technical details

```text
Data flow:
  User question → fast-path iot_query OR AI loop
    → Try get_live_sensor_data (Senslinc API)
    → If unavailable, fall back to get_room_sensor_data (DB attributes)
    → Build response with averages, rankings, per-room data
```

**Database RPC** extracts values using JSONB operators, handling key variants like `sensorTemperature`, `Sensor Temperature`, `temperature`, etc. — mirroring the `extractSensorValue` logic from `visualization-utils.ts`.

### Files to change

- **New migration**: Create `get_room_sensor_data` RPC function
- **`supabase/functions/gunnar-chat/index.ts`**: Add tool definition, execution function, update fast-path routing and system prompt

