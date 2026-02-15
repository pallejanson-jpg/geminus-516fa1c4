
## Fix: Infargning vid xray, insights-farglaggning, och legend-interaktion

### Problemanalys

Fyra separata problem har identifierats:

**Problem 1: Manuell X-ray slaecker infaergning**
`XrayToggle.tsx` koer `scene.setObjectsXRayed(allIds, true)` pa ALLA objekt, inklusive rum som aer faerglagda av rumsvisualisering. Xeokit renderar xray-objekt med `xrayMaterial` och ignorerar `entity.colorize` -- sa faergerna foersvinner.

**Problem 2: Insights-infaergning syns inte**
Trots `ensureXrayConfig` med lag `fillAlpha` fungerar inte xray-strategin. Asset+-bibliotekets interna rendering oeverskriver troligen xray-materialet eller tillstaendet. Laesningen: byt till opacity-baserad ghosting som redan bevisligen fungerar i rumsvisualiseringen (`entity.opacity = 0.15` istallet foer `entity.xrayed = true`).

**Problem 3: Legendens vaerdelabels uppdateras inte**
`VisualizationLegendBar` visar FASTA skalvaerden fran `VISUALIZATION_CONFIGS` (t.ex. 16, 18, 20, 22, 24, 26, 30 foer temperatur). Dessa aer faergskale-stopp, inte faktiska rumsvaerden. Labelen visar ratt sak men boer kompletteras med dynamisk min/max baserat pa riktiga sensorvaerden i de synliga rummen.

**Problem 4: Legend-klick ger ingen synlig effekt**
Legend-klick anvaender xray-strategi som inte fungerar. Byt till samma opacity-strategi.

---

### Laesning: Byt ALLA xray-strategier till opacity-baserad ghosting

Samma teknik som redan fungerar i `RoomVisualizationPanel.applyVisualization`:
- `entity.opacity = 0.1` foer "ghostade" objekt (istallet foer `entity.xrayed = true`)
- `entity.opacity = 0.85` + `entity.colorize = rgb` foer faergade rum/tillgangar
- Inget beroende pa `xrayMaterial` som Asset+ kan oeverskriva

---

### Fil 1: `src/components/viewer/AssetPlusViewer.tsx`

**1a. Insights-effekten (rad 316-321) -- byt xray till opacity**

```
// BEFORE:
ensureXrayConfig(scene);
scene.setObjectsXRayed(allIds, true);
// ... entity.xrayed = false; entity.colorize = rgb;

// AFTER:
// Ghost all objects with low opacity (no xray dependency)
scene.setObjectsVisible(allIds, true);
allIds.forEach(id => {
  const e = scene.objects?.[id];
  if (e) e.opacity = 0.1;
});
// ... entity.colorize = rgb; entity.opacity = 0.85;
// (ta bort entity.xrayed = false)
```

Tillaegg: laegg till cleanup-effekt som aterstaeller opacity till 1.0 och rensar colorize naer `insightsColorMode` avaktiveras (finns redan delvis).

**1b. Behall `ensureXrayConfig` foer eventuell framtida anvaendning men anvaend den inte i insights-floeded laengre.**

---

### Fil 2: `src/components/viewer/XrayToggle.tsx`

**2a. Bevara rumsvisualiserings-faerger vid xray-toggle**

Naer xray aktiveras: saett xray pa alla UTOM redan faerglagda rum. Lyssna pa en event eller kontrollera `entity.colorize` innan xray saetts:

```typescript
const handleToggleXray = useCallback((enabled: boolean) => {
  // ... existing viewer access ...
  const objectIds = scene.objectIds || [];
  
  if (enabled) {
    // Ensure transparent xray config
    ensureXrayConfig(scene); // inline version
    
    objectIds.forEach(id => {
      const entity = scene.objects?.[id];
      if (!entity) return;
      // Skip entities that are already colorized (from room visualization)
      if (entity.colorize && (entity.colorize[0] !== 1 || entity.colorize[1] !== 1 || entity.colorize[2] !== 1)) {
        return; // Don't xray colored rooms
      }
      entity.xrayed = true;
    });
  } else {
    scene.setObjectsXRayed(objectIds, false);
  }
}, [viewerRef]);
```

---

### Fil 3: `src/components/viewer/RoomVisualizationPanel.tsx`

**3a. Legend-klick (rad 530-551) -- byt xray till opacity**

```
// BEFORE:
scene.setObjectsXRayed(allIds, true);
scene.setObjectsXRayed(idsToSelect, false);

// AFTER:
// Ghost all with low opacity
allIds.forEach(id => {
  const e = scene.objects?.[id];
  if (e) e.opacity = 0.1;
});
// Restore matching rooms to full opacity
idsToSelect.forEach(id => {
  const e = scene.objects?.[id];
  if (e) e.opacity = 0.85;
});

// Toggle off: restore all to normal
allIds.forEach(id => {
  const e = scene.objects?.[id];
  if (e) e.opacity = 1.0;
});
// Re-apply visualization to restore colored rooms
applyVisualization();
```

---

### Fil 4: `src/components/viewer/VisualizationLegendBar.tsx`

**4a. Visa dynamiska min/max-vaerden fran faktiska rumsdata**

Laegg till beraeknade `actualMin` / `actualMax` fran `roomValues` och visa dem i legenden utover de fasta skalstopparna:

```typescript
const actualMin = roomValues.length > 0 
  ? Math.min(...roomValues.map(r => r.value)).toFixed(1) 
  : null;
const actualMax = roomValues.length > 0 
  ? Math.max(...roomValues.map(r => r.value)).toFixed(1) 
  : null;
```

Visa dessa som kompletterande info i legendens overkant/nederkant (t.ex. "Min: 18.2 degC -- Max: 24.7 degC").

---

### Sammanfattning

| Fil | Aendring |
|-----|---------|
| `AssetPlusViewer.tsx` | Byt insights xray till opacity-ghosting |
| `XrayToggle.tsx` | Bevara faerglagda rum vid manuell xray |
| `RoomVisualizationPanel.tsx` | Byt legend-klick xray till opacity, lagg till aterstaellning |
| `VisualizationLegendBar.tsx` | Visa dynamisk min/max fran faktiska sensorvaerden |

### Foervaentat resultat

1. **Rumsvisualisering + manuell xray**: faerger bevaras, xray appliceras bara pa icke-faergade objekt
2. **Insights till 3D**: rum faergas med opacity-ghosting (byggnaden blir naestan genomskinlig, faergade rum syns tydligt)
3. **Legend-klick**: vald kategori framhaevs med opacity, resten ghostas
4. **Legend-vaerden**: visar bade faergskalans fasta stopp och faktiska min/max fran sensordata
