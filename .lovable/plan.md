

# Plan: Consolidate shared building map logic between MapView and CesiumGlobeView

## Problem

`MapView.tsx` (626 lines) and `CesiumGlobeView.tsx` (821 lines) duplicate significant logic:

1. **Building data preparation** (~50 lines each): Both fetch `building_settings` coordinates from the database, merge with `navigatorTreeData`, and fall back to `NORDIC_CITIES` for buildings without saved positions. The code is nearly identical.
2. **Building sidebar** (~80 lines each): Both implement a collapsible card with search input, filtered building list, selected highlight, and mobile expand/collapse. MapView has it as a named component; Cesium has it inline.
3. **Building info popup** (~60 lines each): Both show name, address, badges, and action buttons ("Visa detaljer", "Öppna 3D-viewer"). Cesium adds "Visa BIM".
4. **Navigation handlers**: Both implement `handleOpenFacility` (navigate to portfolio) and `handleOpenViewer` (open 3D viewer) with similar patterns.

## Proposed shared modules

### 1. New hook: `src/hooks/useMapFacilities.ts`

Extracts the duplicated data-fetching and merging logic:

- Fetches `building_settings` (coords, ivion_site_id, rotation) from database
- Merges with `navigatorTreeData` from AppContext
- Falls back to `NORDIC_CITIES` for buildings without coords
- Computes `area`, `numberOfLevels`, `numberOfSpaces` from `allData`
- Returns a unified `MapFacility[]` array and a `coordsLookup` map

Both MapView and CesiumGlobeView import and use this hook instead of their own inline implementations.

### 2. Shared component: `src/components/map/BuildingSidebar.tsx`

Extract MapView's `BuildingSidebar` into its own file with a generic interface:

```typescript
interface BuildingSidebarProps {
  facilities: { fmGuid: string; displayName: string; address: string }[];
  selectedFmGuid: string | null;
  onSelect: (fmGuid: string) => void;
  title?: string; // "Buildings" vs "Byggnader"
}
```

Both MapView and CesiumGlobeView import this shared component.

### 3. Shared component: `src/components/map/BuildingInfoCard.tsx`

Extract the popup content (name, address, badges, action buttons) into a reusable card:

```typescript
interface BuildingInfoCardProps {
  name: string;
  address: string;
  has360?: boolean;
  onViewDetails: () => void;
  onOpen3D: () => void;
  extraActions?: React.ReactNode; // For Cesium's "Visa BIM" button
}
```

CesiumGlobeView passes `extraActions` for the BIM toggle. MapView uses the card inside its Mapbox `<Popup>`.

### 4. Refactor MapView.tsx and CesiumGlobeView.tsx

- Replace inline building data logic with `useMapFacilities()` hook
- Replace inline sidebar with `<BuildingSidebar />`
- Replace inline popup content with `<BuildingInfoCard />`
- Keep renderer-specific code in place (Cesium pins/camera/BIM, Mapbox clusters/supercluster/token)

## Estimated line reduction

| File | Before | After (approx) |
|------|--------|-----------------|
| MapView.tsx | 626 | ~420 |
| CesiumGlobeView.tsx | 821 | ~580 |
| New shared files | 0 | ~250 |
| **Net** | 1447 | ~1250 |

The main benefit is not line count but single-source-of-truth: adding a building field or changing sidebar behavior only needs one edit.

## Files

| File | Action |
|------|--------|
| `src/hooks/useMapFacilities.ts` | Create — shared data hook |
| `src/components/map/BuildingSidebar.tsx` | Create — shared sidebar component |
| `src/components/map/BuildingInfoCard.tsx` | Create — shared popup/info card |
| `src/components/map/MapView.tsx` | Refactor to use shared modules |
| `src/components/globe/CesiumGlobeView.tsx` | Refactor to use shared modules |

