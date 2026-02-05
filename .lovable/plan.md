
# Plan: Fixa 3D Quick Actions för våningar och rum

## Problem
När användaren navigerar till en våning (Building Storey) eller ett rum (Space) och klickar på "3D" i Quick Actions, händer ingenting. Istället visas byggnadsväljar-vyn.

## Orsak
Filen `Viewer.tsx` validerar att `viewer3dFmGuid` måste vara en byggnad (`Building` eller `IfcBuilding`). När en vånings- eller rums-fmGuid skickas:
1. `validBuilding` blir `null` eftersom kategorin inte matchar
2. Koden rensar `viewer3dFmGuid` och visar `BuildingSelector`
3. `AssetPlusViewer` når aldrig det skickade fmGuid:et

Paradoxalt nog har `AssetPlusViewer` redan färdig logik för att hantera Building Storey och Space med korrekta kamera-actions (cutoutfloor, lookatspace).

## Lösning
Uppdatera valideringslogiken i `Viewer.tsx` för att:
1. Acceptera våningar och rum (inte bara byggnader)
2. Automatiskt härleda föräldrbyggnadens fmGuid när en underordnad entitet väljs
3. Skicka båda till `AssetPlusViewer`: byggnadens fmGuid för modelladdning + det ursprungliga fmGuid:et för fokusering

---

## Steg 1: Uppdatera Viewer.tsx

Ändra `validBuilding`-logiken för att hitta byggnaden även när en våning eller rum väljs:

```typescript
// Ny logik: hitta byggnad baserat på viewer3dFmGuid
const { buildingFmGuid, targetFacility } = useMemo(() => {
  if (!viewer3dFmGuid || !allData || allData.length === 0) {
    return { buildingFmGuid: null, targetFacility: null };
  }
  
  // Hitta den valda entiteten
  const facility = allData.find((item: any) => item.fmGuid === viewer3dFmGuid);
  if (!facility) return { buildingFmGuid: null, targetFacility: null };
  
  // Om det är en byggnad, använd den direkt
  if (facility.category === 'Building' || facility.category === 'IfcBuilding') {
    return { buildingFmGuid: facility.fmGuid, targetFacility: facility };
  }
  
  // Om det är en våning eller rum, hitta föräldra-byggnaden
  if (facility.buildingFmGuid) {
    const building = allData.find((item: any) => 
      item.fmGuid === facility.buildingFmGuid && 
      (item.category === 'Building' || item.category === 'IfcBuilding')
    );
    if (building) {
      return { buildingFmGuid: building.fmGuid, targetFacility: facility };
    }
  }
  
  return { buildingFmGuid: null, targetFacility: null };
}, [viewer3dFmGuid, allData]);
```

Uppdatera villkorlig rendering för att använda nya variabler.

---

## Steg 2: Skicka initialFmGuidToFocus till AssetPlusViewer

Lägg till en ny prop för att tala om vilken entitet som ska fokuseras:

```typescript
<AssetPlusViewer 
  fmGuid={buildingFmGuid}  // Byggnaden för modelladdning
  initialFmGuidToFocus={viewer3dFmGuid}  // Det ursprungliga fmGuid:et (våning/rum)
  onClose={handleClose} 
/>
```

---

## Steg 3: Uppdatera AssetPlusViewer props

Lägg till `initialFmGuidToFocus` som optional prop och använd den i initieringslogiken:

```typescript
interface AssetPlusViewerProps {
  fmGuid: string;  // Byggnadens fmGuid
  initialFmGuidToFocus?: string;  // Entiteten att fokusera på (valfri)
  onClose?: () => void;
  // ... övriga props
}
```

I `initializeViewer`:
```typescript
// Använd initialFmGuidToFocus för att bestämma displayAction
const focusFmGuid = initialFmGuidToFocus || fmGuid;
const focusData = allData.find((a: any) => a.fmGuid === focusFmGuid);

if (focusData?.category === 'Building') {
  displayAction = { action: 'viewall' };
} else if (focusData?.category === 'Building Storey') {
  displayAction = { 
    action: 'cutoutfloor', 
    parameter: { fmGuid: focusFmGuid, includeRelatedFloors: true } 
  };
} else if (focusData?.category === 'Space') {
  // ...befintlig logik
}
```

---

## Steg 4: Uppdatera QuickActions.tsx (valfritt)

Lägg till 3D-knappen för Space-kategori:

```typescript
// Rad 89: Ändra från
{(isBuilding || isStorey) && (
// Till
{(isBuilding || isStorey || isSpace) && (
```

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/pages/Viewer.tsx` | Uppdatera validering för att stödja våningar och rum |
| `src/components/viewer/AssetPlusViewer.tsx` | Lägg till `initialFmGuidToFocus` prop |
| `src/components/portfolio/QuickActions.tsx` | Visa 3D-knappen även för rum (Space) |

---

## Tekniska detaljer

```text
Flöde före fix:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  QuickActions   │───▶│   Viewer.tsx    │───▶│ BuildingSelector│
│  onToggle3D()   │    │ validBuilding   │    │   (visas)       │
│  fmGuid=Våning  │    │ = null ❌       │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘

Flöde efter fix:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  QuickActions   │───▶│   Viewer.tsx    │───▶│AssetPlusViewer  │
│  onToggle3D()   │    │ buildingFmGuid  │    │ fmGuid=Byggnad  │
│  fmGuid=Våning  │    │ = Building ✓    │    │ focus=Våning ✓  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```
