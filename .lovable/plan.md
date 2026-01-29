
# Plan: Aktivera Alarm-annotationer och fixa klippning/rumssynlighet

## Sammanfattning

Denna plan hanterar fyra delar:
1. **Alarm-annotationer** - Aktivera annotationer för alarm från Asset+ synk
2. **Klipphöjd i 2D** - Fixa slidern så den uppdaterar scenen i realtid  
3. **Klippning vid våningsgräns i 3D Solo** - Använd Asset+ inbyggda `cutOutFloorsByFmGuid` 
4. **Rum alltid AV** - Säkerställ att `showSpaces` alltid är AV som default

---

## Del 1: Aktivera Alarm-annotationer

### Bakgrund
- Det finns **5 482 alarm** i databasen, alla med `asset_type = 'IfcAlarm'` i byggnaden **Småviken**
- Det finns redan en symbol i `annotation_symbols` med namn **"Alarm"** och färg `#EF4444` (röd)
- Nuvarande annotations-system visar bara assets med `annotation_placed = true` och `coordinate_x/y/z`
- Alarm-objekten har INTE koordinater (de är synkade från BIM, inte placerade manuellt)

### Lösning: Använd BIM-geometri för position

Alarm-objekt finns i BIM-modellen med sina FmGuids. Vi kan hitta deras position genom att:
1. Slå upp deras `fmGuid` i xeokits `metaScene`
2. Hämta motsvarande `entity` och dess `aabb` (bounding box)
3. Beräkna centrumpunkten för att placera markören

### Implementering

#### 1.1 Uppdatera `loadLocalAnnotations` i `AssetPlusViewer.tsx`

```typescript
// Ny funktion: loadAlarmAnnotations
const loadAlarmAnnotations = useCallback(async () => {
  const resolvedBuildingGuid = resolveBuildingFmGuid();
  if (!resolvedBuildingGuid) return;

  const viewer = viewerInstanceRef.current;
  const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (!xeokitViewer?.metaScene?.metaObjects || !xeokitViewer?.scene) return;

  // Hämta Alarm-symbolen
  const { data: alarmSymbol } = await supabase
    .from('annotation_symbols')
    .select('id, name, color, icon_url')
    .eq('name', 'Alarm')
    .maybeSingle();

  if (!alarmSymbol) {
    console.log('No Alarm symbol configured');
    return;
  }

  // Hämta alla alarm-objekt för denna byggnad
  const { data: alarms, error } = await supabase
    .from('assets')
    .select('fm_guid, name, asset_type, level_fm_guid, in_room_fm_guid')
    .eq('building_fm_guid', resolvedBuildingGuid)
    .eq('asset_type', 'IfcAlarm');

  if (error || !alarms || alarms.length === 0) {
    console.log('No alarms found for building:', resolvedBuildingGuid);
    return;
  }

  const metaObjects = xeokitViewer.metaScene.metaObjects;
  const scene = xeokitViewer.scene;

  // Skapa annotations för alarm med positioner från BIM-geometri
  const annotationsData: Array<{
    id: string;
    worldPos: [number, number, number];
    category: string;
    name: string;
    color: string;
    iconUrl: string;
    markerShown: boolean;
    levelFmGuid: string | null;
  }> = [];

  alarms.forEach(alarm => {
    // Försök hitta objektet i metaScene via fmGuid
    const metaObj = Object.values(metaObjects).find((m: any) => 
      (m.originalSystemId || m.id)?.toUpperCase() === alarm.fm_guid?.toUpperCase()
    );

    if (!metaObj) return; // Objektet finns inte i laddad BIM-modell

    // Hämta entity och dess bounding box
    const entity = scene.objects?.[metaObj.id];
    if (!entity?.aabb) return;

    const aabb = entity.aabb;
    // Centrum av bounding box
    const worldPos: [number, number, number] = [
      (aabb[0] + aabb[3]) / 2,
      (aabb[1] + aabb[4]) / 2 + 0.1, // Lite ovanför mitten
      (aabb[2] + aabb[5]) / 2
    ];

    annotationsData.push({
      id: `alarm-${alarm.fm_guid}`,
      worldPos,
      category: 'Alarm',
      name: alarm.name || 'Alarm',
      color: alarmSymbol.color,
      iconUrl: alarmSymbol.icon_url || '',
      markerShown: showAnnotations,
      levelFmGuid: alarm.level_fm_guid,
    });
  });

  console.log(`Found ${annotationsData.length} alarm annotations with BIM positions`);
  
  // Lägg till alarm-annotationerna till den befintliga localAnnotationsManager
  // ... (integration med befintligt marker-renderingssystem)
}, [resolveBuildingFmGuid, showAnnotations]);
```

#### 1.2 Uppdatera `AnnotationCategoryList` för att inkludera Alarm

Ändra query i `AnnotationCategoryList.tsx` för att inkludera alarm:

```typescript
// Hämta assets med annotations ELLER alarm för denna byggnad
const { data: assets } = await supabase
  .from('assets')
  .select('asset_type, symbol_id')
  .eq('building_fm_guid', buildingFmGuid)
  .or('annotation_placed.eq.true,asset_type.eq.IfcAlarm');
```

#### 1.3 Registrera Alarm-symbolen automatiskt

Lägg till logik för att koppla alla `IfcAlarm` assets till Alarm-symbolen:

```typescript
// I loadAlarmAnnotations - sätt symbol_id på alarm-objekt om det saknas
const alarmWithoutSymbol = alarms.filter(a => !a.symbol_id);
if (alarmWithoutSymbol.length > 0 && alarmSymbol) {
  // Bulk-uppdatera symbol_id för alarm (körs en gång)
  await supabase
    .from('assets')
    .update({ symbol_id: alarmSymbol.id })
    .eq('building_fm_guid', resolvedBuildingGuid)
    .eq('asset_type', 'IfcAlarm')
    .is('symbol_id', null);
}
```

---

## Del 2: Fixa 2D klipphöjd-slider

### Problem
Slidern i VisualizationToolbar dispatchar `CLIP_HEIGHT_CHANGED_EVENT`, men `updateFloorCutHeight` i `useSectionPlaneClipping.ts` skapar inte ett fungerande section plane.

### Orsak (identifierad)
Enligt xeokit dokumentation:
> "Discards elements from the half-space in the direction of `dir`"

Med `dir: [0, -1, 0]` (pekar neråt) klipps allt **under** planet bort. För 2D-planritning vill vi klippa det som är **ovanför**, så vi behöver `dir: [0, 1, 0]` (pekar uppåt).

### Lösning
Invertera `dir`-vektorn för 2D-läge till `[0, 1, 0]`:

```typescript
// useSectionPlaneClipping.ts - Korrigerad direction
const create2DClipPlane = (clipHeight: number) => {
  sectionPlaneRef.current = plugin.createSectionPlane({
    id: `floor-clip-2d-${Date.now()}`,
    pos: [0, clipHeight, 0],
    dir: [0, 1, 0], // Pekar uppåt = klipper ovanför planet
    active: true,
  });
};
```

### Alternativ strategi: Använd Asset+ inbyggda `setShowFloorplan`

Enligt dokumentationen har Asset+ viewer en `setShowFloorplan(value: boolean)` metod. Vi kan prova att använda den istället för manuell SectionPlane:

```typescript
const assetView = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView;
assetView?.setShowFloorplan?.(true); // Aktiverar 2D-planritningsvy
```

---

## Del 3: Fixa 3D Solo-mode klippning vid våningsgräns

### Problem
Väggar sticker fortfarande upp i Solo-läge.

### Bättre lösning: Använd Asset+ inbyggda `cutOutFloorsByFmGuid`

Enligt dokumentationen har Asset+ viewer metoden:
```javascript
cutOutFloorsByFmGuid(fmGuid: string, includeRelatedFloors: boolean): void
```

Denna funktion är designad exakt för detta syfte - att "cut out" (klippa ut) ett våningsplan.

### Implementering

Uppdatera `handleShowOnlyFloor` i `FloorVisibilitySelector.tsx`:

```typescript
const handleShowOnlyFloor = useCallback((floorId: string) => {
  // ... befintlig kod för visibility ...

  // Använd Asset+ native floor cutout istället för manuell SectionPlane
  const floor = floors.find(f => f.id === floorId);
  if (floor && floor.databaseLevelFmGuids.length > 0) {
    const floorFmGuid = floor.databaseLevelFmGuids[0];
    
    // Anropa Asset+ viewer metod
    const viewer = viewerRef.current;
    if (viewer?.cutOutFloorsByFmGuid) {
      viewer.cutOutFloorsByFmGuid(floorFmGuid, false); // false = bara detta våningsplan
      console.log('Applied native floor cutout for:', floorFmGuid);
    }
  }
}, [floors, viewerRef]);
```

### Fallback om `cutOutFloorsByFmGuid` inte räcker

Om Asset+ cutout inte fungerar tillräckligt, justera section plane direction:
- **3D Solo (ceiling mode)**: `dir: [0, -1, 0]` (pekar neråt = klipper ovanför)
- Verifiera att clipHeight beräknas från `nästa vånings minY`, inte geometrins maxY

---

## Del 4: Säkerställ "Visa rum" alltid AV som default

### Problem
Rum visas ibland trots att switchen är avstängd.

### Orsak
1. `onShowSpacesChanged(true)` anropas från RoomVisualizationPanel
2. Asset+ viewer kan ha sin egen interna state som inte synkroniseras

### Lösning

#### 4.1 Forcera spaces OFF efter modeller laddats

I `handleAllModelsLoaded` i `AssetPlusViewer.tsx`:

```typescript
// Forcera spaces OFF - måste göras EFTER Asset+ laddat klart
const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
const xeokitViewer = assetView?.viewer;

// Metod 1: Via Asset+ API
assetViewer?.onShowSpacesChanged?.(false);

// Metod 2: Direkt på xeokit - dölja alla IfcSpace entities
if (xeokitViewer?.metaScene?.metaObjects) {
  const metaObjects = xeokitViewer.metaScene.metaObjects;
  Object.values(metaObjects).forEach((metaObj: any) => {
    if (metaObj.type?.toLowerCase() === 'ifcspace') {
      const entity = xeokitViewer.scene?.objects?.[metaObj.id];
      if (entity) entity.visible = false;
    }
  });
}
```

#### 4.2 Synkronisera state vid floor/model-ändringar

```typescript
// I handleVisibleFloorsChange i AssetPlusViewer
const handleVisibleFloorsChange = useCallback((floorIds: string[]) => {
  setVisibleFloorFmGuids(floorIds);
  
  // ALLTID stäng av showSpaces vid floor-ändring
  if (showSpaces) {
    handleShowSpacesChange(false);
  }
}, [showSpaces, handleShowSpacesChange]);
```

---

## Filändringar

| Fil | Ändringar |
|-----|-----------|
| `src/components/viewer/AssetPlusViewer.tsx` | Ny `loadAlarmAnnotations` funktion, forcera spaces OFF i `handleAllModelsLoaded`, använd `cutOutFloorsByFmGuid` |
| `src/components/viewer/AnnotationCategoryList.tsx` | Inkludera `IfcAlarm` i query |
| `src/hooks/useSectionPlaneClipping.ts` | Ändra `dir` till `[0, 1, 0]` för 2D-läge |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Använd Asset+ `cutOutFloorsByFmGuid` i Solo-läge |

---

## Tekniska detaljer

### xeokit SectionPlane beteende
Baserat på xeogl dokumentation:
> "Discards elements from the half-space **in the direction of** `dir`"

- `dir: [0, 1, 0]` = pekar uppåt → klipper allt **ovanför** planet (för 2D-planritning)
- `dir: [0, -1, 0]` = pekar neråt → klipper allt **under** planet

### Asset+ cutOutFloorsByFmGuid
Denna inbyggda funktion hanterar:
- Korrekt detektion av våningsplanets höjd
- Automatisk geometri-klippning  
- Kamera-justering

### Alarm-annotations prestanda
Med 5 482 alarm i Småviken kan rendering bli tungt. Optimeringar:
- Chunk-baserad rendering (100 markers/frame)
- Lazy loading vid zoom
- Dölj markers utanför viewport

---

## Förväntade resultat

1. **Alarm visas som annotationer** - Röda markers med Alarm-ikon i 3D
2. **Alarm i Annotationstyper-listan** - Kan togglas av/på
3. **2D-slider fungerar** - Klipphöjd uppdateras i realtid
4. **3D Solo klipper korrekt** - Väggar från ovanliggande våningar döljs
5. **Rum alltid AV** - Som default och efter model/floor-ändringar
