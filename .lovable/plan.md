
# Plan: Fixa rum-synlighet vid våningsval

## Problemet

När användaren väljer ett specifikt våningsplan via våningsväljaren ("Våningsplan") så tänds rummen (IfcSpace) även fast "Visa rum"-slidern är avstängd.

### Orsak

1. `FloorVisibilitySelector.applyFloorVisibility()` samlar ALLA barn till det valda våningsplanet och sätter dem synliga
2. IfcSpace (rum) är barn till IfcBuildingStorey (våningsplan), så de blir synliga
3. `handleVisibleFloorsChange` i AssetPlusViewer anropar `filterSpacesToVisibleFloors` **endast om showSpaces är true**
4. När showSpaces är false körs ingen kod för att dölja rummen - de förblir synliga

```
Våningsväljare klickar "Plan 3"
       │
       ▼
FloorVisibilitySelector.applyFloorVisibility()
       │
       └── Visar ALLA barn till Plan 3 (inkl. rum)
               │
               ▼
handleVisibleFloorsChange() anropas
       │
       └── if (showSpaces) { filterSpacesToVisibleFloors() }
               │
               └── showSpaces är FALSE → ingen kod körs
                       │
                       ▼
              Rum förblir synliga (fel!)
```

---

## Lösning

Ändra `handleVisibleFloorsChange` så att den **alltid** anropar `filterSpacesToVisibleFloors` - inte bara när `showSpaces` är true.

Funktionen `filterSpacesToVisibleFloors` hanterar redan fallet korrekt:
- Om `forceShow` (showSpaces) är `false` → döljer alla IfcSpace
- Om `forceShow` är `true` → visar endast IfcSpace på synliga våningar

### Före (AssetPlusViewer.tsx rad 313-325)

```typescript
const handleVisibleFloorsChange = useCallback((floorIds: string[]) => {
  setVisibleFloorFmGuids(floorIds);
  
  // BUG: Anropas endast om showSpaces är true
  if (showSpaces) {
    filterSpacesToVisibleFloors(floorIds, showSpaces);
  }
  
  // Update room labels floor filter
  if (updateFloorFilter) {
    updateFloorFilter(floorIds);
  }
}, [showSpaces, filterSpacesToVisibleFloors, updateFloorFilter]);
```

### Efter

```typescript
const handleVisibleFloorsChange = useCallback((floorIds: string[]) => {
  setVisibleFloorFmGuids(floorIds);
  
  // FIX: Anropa ALLTID för att säkerställa att rum döljs om showSpaces är false
  filterSpacesToVisibleFloors(floorIds, showSpaces);
  
  // Update room labels floor filter
  if (updateFloorFilter) {
    updateFloorFilter(floorIds);
  }
}, [showSpaces, filterSpacesToVisibleFloors, updateFloorFilter]);
```

---

## Teknisk detalj

`filterSpacesToVisibleFloors` (rad 213-294) har redan korrekt logik:

```typescript
// Om showSpaces är OFF, dölj ALLA IfcSpace
if (!forceShow) {
  Object.values(metaObjects).forEach((metaObj: any) => {
    if (metaObj.type?.toLowerCase() !== 'ifcspace') return;
    const entity = scene.objects?.[metaObj.id];
    if (entity && entity.visible) {
      entity.visible = false;  // Dölj rummet
    }
  });
  return;
}
```

Problemet är att denna kod aldrig anropas när våningar ändras och showSpaces är false.

---

## Fil som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/AssetPlusViewer.tsx` | Ta bort `if (showSpaces)`-villkoret runt `filterSpacesToVisibleFloors`-anropet |

---

## Testning

1. **Starta 3D-viewer på en byggnad** → Alla våningar synliga, "Visa rum" avstängt
2. **Välj ett specifikt våningsplan** → Endast det planet synligt, rum ska INTE visas
3. **Slå på "Visa rum"** → Rum visas
4. **Välj annat våningsplan** → Rum visas endast för det nya planet
5. **Slå av "Visa rum"** → Rum döljs
