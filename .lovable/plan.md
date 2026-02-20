

## Forbattra Insights: Sokbar byggnadsvaljare + 3D-synk fran drawer

### Problem 1: Byggnadsvaljaren pa portfolioniva ar for stor

I `InsightsView` -> `PerformanceTab` visas alla byggnader som stora knappar i ett rutnot. Med manga byggnader blir det ooverskadligt och det gar inte att soka.

**Losning:** Byt ut rutnatsknapparna mot en kompakt, sokbar Combobox-valjare (liknande `ErrorCodeCombobox`-monstret som redan finns i projektet). Byggnadsvaljaren ska:
- Anvanda Popover + Command (cmdk) fran befintliga UI-komponenter
- Visa en sokinput med filtrering
- Visa byggnadsnamn + energirating i en kompakt lista
- Klick valjer byggnad och anropar `onSelectBuilding`
- Ta ca 40px hojd istallet for hela grid-sektionen

### Problem 2: Klick pa diagram i Insights-drawern fargar inte 3D

I `BuildingInsightsView` finns `handleInsightsClick` som i `drawerMode` dispatchar `INSIGHTS_COLOR_UPDATE_EVENT`. Mottagaren i `AssetPlusViewer` (rad ~460-530) hanterar korrekt `room_spaces`, `room_types` och `room_type` -- men for `energy_floors`, `energy_floor`, `asset_categories` och `asset_category` faller den igenom till en else-branch (rad 524-529) som bara sparar varden till en cache-ref utan att faktiskt farglagga nagra objekt.

**Losning:** Implementera faktisk colorize-logik for `energy_floors`/`energy_floor` i event-handlern:

1. `energy_floors` / `energy_floor`: colorMap-nycklarna ar floor-fmGuids. Iterera over alla metaObjects, hitta vilka som tillhor respektive Building Storey (via parent-hierarkin), och applicera farg pa alla entiteter under den vaningen.

2. `asset_categories` / `asset_category`: colorMap-nycklarna ar kategoribeteckningar. Iterera over allData for att hitta assets av den kategorin, matcha mot scene-objekt via fmGuid, och farglagg dem.

### Tekniska detaljer

#### Fil 1: `src/components/insights/tabs/PerformanceTab.tsx`

- Ersatt "Buildings"-kortets grid med en kompakt Combobox:

```text
+-----------------------------------------------+
| [Sok byggnad...              v]                |
|   Smakanalen          B  95 kWh/m2            |
|   Tornhuset            A  82 kWh/m2            |
|   Lagerhuset           C  115 kWh/m2           |
+-----------------------------------------------+
```

- Anvander `Popover`, `Command`, `CommandInput`, `CommandList`, `CommandItem` (redan installerade)
- Visa energirating-badge + kWh/m2 per rad
- Klick -> `onSelectBuilding(building)`
- Hela sektionen tar en rad istallet for ett stort grid

#### Fil 2: `src/components/viewer/AssetPlusViewer.tsx`

Utoka INSIGHTS_COLOR_UPDATE_EVENT-handlern (rad ~475-529) med logik for `energy_floors`/`energy_floor`:

```typescript
if (mode === 'energy_floors' || mode === 'energy_floor') {
  // colorMap keys are floor fmGuids
  // Iterate metaObjects, find IfcBuildingStorey entries, 
  // then colorize all child objects belonging to that storey
  Object.values(metaObjects).forEach((mo: any) => {
    if (mo.type?.toLowerCase() !== 'ifcbuildingstorey') return;
    const moGuid = (mo.originalSystemId || mo.id || '').toLowerCase();
    const rgb = colorMap[moGuid] || colorMap[moGuid.toUpperCase()];
    if (!rgb) return;
    // Get all children of this storey
    const childIds = getChildEntityIds(mo, metaObjects);
    childIds.forEach(childId => {
      const entity = scene.objects?.[childId];
      if (entity) {
        entity.xrayed = false;
        entity.visible = true;
        entity.colorize = rgb;
        entity.opacity = 0.85;
      }
    });
  });
}
```

For `asset_categories`/`asset_category`: liknande logik men matchar assets via allDataRef.current mot scene-objekt.

Hjalp-funktion `getChildEntityIds(storeyMeta, allMetaObjects)` traverserar barn rekursivt for att hitta alla scene-objekt under en vaningsplan-nod.

### Filer som andras

| Fil | Andring |
|---|---|
| `src/components/insights/tabs/PerformanceTab.tsx` | Ersatt Building-grid med kompakt sokbar Combobox |
| `src/components/viewer/AssetPlusViewer.tsx` | Utoka INSIGHTS_COLOR_UPDATE_EVENT-handler med `energy_floors`, `energy_floor`, `asset_categories`, `asset_category` |

Inga nya filer, databastabeller eller edge functions behovs.

