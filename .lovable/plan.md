

## Plan: Add "Show Sensors" Toggle to Viewer Right Panel

### Context

Currently `loadAlarmAnnotations` loads all `IfcAlarm` assets from BIM and displays them with the "Alarm" symbol. The user wants to split the viewer overlay controls into three separate toggles:

1. **Show Issues** -- BCF issues as 3D markers (loaded via `loadIssueAnnotations`)
2. **Show Alarms** -- Alarm events from Insights/FM tab (dispatched via `ALARM_ANNOTATIONS_SHOW_EVENT`, red markers)
3. **Show Sensors** (NEW) -- `IfcAlarm` BIM objects shown with the "Sensor" symbol configured in Settings > Symbols

The existing `loadAlarmAnnotations` function loads `IfcAlarm` assets and uses the "Alarm" annotation symbol. This needs to be repurposed as the "Show Sensors" data source, using the **Sensor** symbol instead (or a configurable symbol name).

### What Changes

#### 1. ViewerRightPanel -- Add "Show Sensors" toggle

**File: `src/components/viewer/ViewerRightPanel.tsx`**

Add a third toggle in the Display section, between Show Issues and Show Alarms (or after both). The toggle dispatches a new custom event `SENSOR_ANNOTATIONS_TOGGLE_EVENT` with `{ visible: boolean }`.

```text
Display section toggles:
  - 2D/3D
  - Show spaces
  - X-ray
  - Minimap
  - Annotations (local/inventoried)
  - Show Issues    (NEW - toggle for BCF issue markers)
  - Show Alarms    (NEW - toggle for Insights alarm markers)  
  - Show Sensors   (NEW - toggle for IfcAlarm BIM sensor markers)
```

The Sensor toggle uses a `Radio` or `Activity` icon from lucide-react.

#### 2. New event in viewer-events.ts

**File: `src/lib/viewer-events.ts`**

Add:
```typescript
export const SENSOR_ANNOTATIONS_TOGGLE_EVENT = 'SENSOR_ANNOTATIONS_TOGGLE';
export interface SensorAnnotationsToggleDetail { visible: boolean; }
```

#### 3. AssetPlusViewer -- Lazy-load sensor annotations on toggle

**File: `src/components/viewer/AssetPlusViewer.tsx`**

- **Rename** `loadAlarmAnnotations` to `loadSensorAnnotations` (since it loads IfcAlarm BIM objects which represent sensors).
- Change the symbol lookup from `'Alarm'` to `'Sensor'` (or a fallback chain: look for "Sensor" symbol first, then "Alarm", then use a default green/teal color).
- Change marker CSS class from `alarm-marker` to `sensor-marker`.
- **Do NOT auto-load** on `handleAllModelsLoaded` -- remove the `loadAlarmAnnotationsRef.current?.()` call from there.
- Add a `useEffect` listener for `SENSOR_ANNOTATIONS_TOGGLE_EVENT`:
  - When `visible: true`: call `loadSensorAnnotations()` if not already loaded, then show all sensor markers (`display: flex`).
  - When `visible: false`: hide all sensor markers (`display: none`).
- The marker appearance uses the symbol configured under Settings > Symbols with name "Sensor":
  - `color` from the symbol record
  - `icon_url` from the symbol record (rendered as an img inside the marker circle)
  - If no "Sensor" symbol exists, fall back to a default teal circle with a radio icon.

#### 4. Symbol lookup logic

The existing code already queries `annotation_symbols` for the "Alarm" symbol:
```typescript
const { data: alarmSymbol } = await supabase
  .from('annotation_symbols')
  .select('id, name, color, icon_url')
  .eq('name', 'Alarm')
  .maybeSingle();
```

Change to query for "Sensor" instead:
```typescript
const { data: sensorSymbol } = await supabase
  .from('annotation_symbols')
  .select('id, name, color, icon_url, marker_html')
  .eq('name', 'Sensor')
  .maybeSingle();

// Fallback defaults if no symbol configured
const symbolColor = sensorSymbol?.color || '#14B8A6'; // teal
const symbolIcon = sensorSymbol?.icon_url || '';
```

If `marker_html` is set on the symbol, use that as the marker innerHTML instead of the default circle+icon pattern.

#### 5. Keep "Show Alarms" separate

"Show Alarms" remains tied to `ALARM_ANNOTATIONS_SHOW_EVENT` from Insights, which creates red markers at room centers for active alarms. This is a different data source (Insights FM alarm events) from the BIM-based IfcAlarm sensor objects.

### Files to Modify

| File | Changes |
|---|---|
| `src/lib/viewer-events.ts` | Add `SENSOR_ANNOTATIONS_TOGGLE_EVENT` + detail type |
| `src/components/viewer/ViewerRightPanel.tsx` | Add "Show Sensors" toggle that dispatches `SENSOR_ANNOTATIONS_TOGGLE_EVENT` |
| `src/components/viewer/AssetPlusViewer.tsx` | Rename `loadAlarmAnnotations` → `loadSensorAnnotations`; change symbol from "Alarm" to "Sensor"; remove auto-load on init; add event listener for toggle; use sensor symbol appearance |

### Implementation Order

1. Add `SENSOR_ANNOTATIONS_TOGGLE_EVENT` to `viewer-events.ts`
2. Add "Show Sensors" toggle UI in `ViewerRightPanel.tsx`
3. Refactor `loadAlarmAnnotations` → `loadSensorAnnotations` in `AssetPlusViewer.tsx` with Sensor symbol lookup
4. Wire up lazy-load on toggle event + hide/show logic
5. Remove auto-load from `handleAllModelsLoaded`

