

# Indoor Navigation Prototype

## Overview
Build an indoor navigation system with three parts: a navigation graph editor for the 2D plan view, a database table to persist the graph as GeoJSON, and a Dijkstra pathfinding engine that calculates and displays routes between rooms.

## Architecture

```text
┌─────────────────────────────────┐
│   SplitPlanView (2D plan)       │
│   ┌───────────────────────────┐ │
│   │ NavGraphEditorOverlay     │ │  ← SVG overlay for drawing nodes/edges
│   │  - Click to add waypoints │ │
│   │  - Click two nodes to     │ │
│   │    connect with edge      │ │
│   │  - Click room label to    │ │
│   │    set as room anchor     │ │
│   └───────────────────────────┘ │
│   ┌───────────────────────────┐ │
│   │ RouteDisplayOverlay       │ │  ← SVG polyline showing computed route
│   │  - Animated dashed line   │ │
│   │  - Floor transition icons │ │
│   └───────────────────────────┘ │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│   NavigationPanel (sidebar)     │
│  - "From" room selector        │
│  - "To" room selector          │
│  - "Find route" button         │
│  - Route summary (distance,    │
│    floor changes)               │
│  - Toggle: Edit mode / Nav mode │
└─────────────────────────────────┘
```

## Database

New table `navigation_graphs`:
- `id` uuid PK
- `building_fm_guid` text NOT NULL
- `floor_fm_guid` text (nullable — for per-floor graphs)
- `graph_data` jsonb NOT NULL — GeoJSON FeatureCollection containing:
  - Point features = waypoint nodes (with `room_fm_guid` property if anchored to a room)
  - LineString features = edges (with `weight` = distance in meters)
- `created_at`, `updated_at` timestamps
- RLS: authenticated users can read/write

## Implementation Plan

### 1. Database migration
Create `navigation_graphs` table with RLS policies for authenticated users.

### 2. Dijkstra pathfinding utility (`src/lib/pathfinding.ts`)
- Pure TypeScript, no dependencies
- Input: GeoJSON FeatureCollection (nodes + edges), start room GUID, end room GUID
- Output: ordered list of waypoint coordinates + total distance
- Handles multi-floor routes by connecting floor graphs via stairwell/elevator nodes

### 3. Navigation graph editor overlay (`src/components/viewer/NavGraphEditorOverlay.tsx`)
- SVG overlay on top of the SplitPlanView plan image
- Converts click positions to normalized % coordinates (same system as room labels)
- Modes: "Add node" (click to place), "Add edge" (click two nodes to connect), "Delete" (click to remove)
- Nodes near room labels auto-link to that room's `fm_guid`
- Saves to `navigation_graphs` table on each edit
- Visual: circles for nodes, lines for edges, colored dots for room-anchored nodes

### 4. Route display overlay (`src/components/viewer/RouteDisplayOverlay.tsx`)
- SVG polyline rendered on top of plan image
- Animated dashed stroke (CSS animation)
- Start/end markers with room names
- When route spans floors: show "Go to floor X" indicator at stairwell nodes

### 5. Navigation panel (`src/components/viewer/NavigationPanel.tsx`)
- Two combobox selectors populated from building spaces (IfcSpace assets from `allData`)
- "Find route" button runs Dijkstra and dispatches result to overlay
- Shows distance and floor transitions
- Toggle between Edit mode (shows editor overlay) and Navigate mode (shows route)

### 6. Integration into viewer
- Add "Navigation" tool to ViewerToolbar (compass/route icon)
- When active, show NavigationPanel in right sidebar and enable overlays on SplitPlanView
- Pass `storeyMapRef` coordinate system to overlays for correct positioning

## Files to Create/Edit
1. **Migration SQL** — `navigation_graphs` table
2. `src/lib/pathfinding.ts` — Dijkstra algorithm on GeoJSON graph
3. `src/components/viewer/NavGraphEditorOverlay.tsx` — Editor SVG overlay
4. `src/components/viewer/RouteDisplayOverlay.tsx` — Route display SVG overlay
5. `src/components/viewer/NavigationPanel.tsx` — Sidebar panel with room selectors
6. `src/components/viewer/SplitPlanView.tsx` — Add overlay slots
7. `src/components/viewer/ViewerToolbar.tsx` — Add navigation tool button

