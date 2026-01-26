
# Plan: Rumsvisualisering med färgkodning baserad på egenskaper

## Sammanfattning
Denna plan åtgärdar problemet med att "View all properties" inte visar data och implementerar en visualiseringsfunktion där rumsobjekt färgkodas baserat på mätvärden som temperatur, CO2 och luftfuktighet.

## Problem som identifierats

### 1. UniversalPropertiesDialog visar ingen data
**Orsak**: Dialogen söker med `fm_guid.toUpperCase()` men databasen lagrar FM GUIDs i lowercase format.

**Bevis från databas**:
- Rum-GUID: `01969f25-5337-737b-9222-0edaef51b54b` (lowercase)
- Sökningen: `fmGuid.toUpperCase()` = `01969F25-...` (uppercase) - matchar inte!

### 2. Synkroniseringsprocessen fungerar
Synkprocessen för rum fungerar korrekt. Databasen innehåller:
- Rum med 58-59 attribut var
- NTA-värden (yta)
- Alla systemegenskaper från Asset+
- User Defined Parameters (golvmaterial, rumsnamn, etc.)

### 3. Mätdata för visualisering
Sensor-egenskaper finns i databastrukturen:
- `sensortemperature...` - Temperatur
- `sensorhum...` - Luftfuktighet  
- `sensorco2...` - CO2
- `sensoroccupancy...` - Beläggning

Dessa kolumner saknar för närvarande värden men strukturen är redo.

---

## Implementeringsplan

### Fas 1: Fixa UniversalPropertiesDialog

**Fil**: `src/components/common/UniversalPropertiesDialog.tsx`

**Ändring**:
```text
Rad 92: Ändra från:
.eq('fm_guid', fmGuid.toUpperCase())

Till case-insensitiv sökning:
.or(`fm_guid.eq.${fmGuid},fm_guid.eq.${fmGuid.toLowerCase()},fm_guid.eq.${fmGuid.toUpperCase()}`)
```

**Resultat**: Dialogen hittar data oavsett vilket case som används.

### Fas 2: Förbättra visning av Asset+ egenskaper

**Fil**: `src/components/common/UniversalPropertiesDialog.tsx`

**Ändringar**:
1. Filtrera bort tekniska attribut (\_id, tenantId, etc.) från Asset+-fliken
2. Visa "User Defined Parameters" separat med läsbart namn
3. Extrahera `value` från strukturerade objekt (t.ex. `{name: "NTA", value: 61.7}` → visa `61.7`)
4. Gruppera egenskaper i kategorier: System, Koordinater, Sensor, User Defined

### Fas 3: Implementera rumsvisualisering i 3D-viewern

**Ny fil**: `src/components/viewer/RoomVisualizationPanel.tsx`

**Funktionalitet**:
1. Panel med dropdown för att välja visualiseringstyp:
   - Temperatur (färgskala blå→röd)
   - CO2 (färgskala grön→röd)
   - Luftfuktighet (färgskala brun→blå)
   - Beläggning (grå→grön)
   - NTA/Area (vit→lila gradient)
   
2. Legend som visar färgskala med min/max-värden

3. Knapp i verktygsfältet för att aktivera/inaktivera visualisering

**Integration i AssetPlusViewer.tsx**:
- Ny toolbar-knapp "Visualisering" med Palette-ikon
- Toggle för att visa/dölja RoomVisualizationPanel
- Anropa `colorizeSpace(fmGuid, color)` för varje rum

### Fas 4: Färgberäkningslogik

**Ny fil**: `src/lib/visualization-utils.ts`

```text
Funktioner:
- getSensorColor(value, min, max, colorScale): Returnerar RGB baserat på värde
- getColorScale(type): Returnerar färgpalett för typ (temp/co2/humidity)
- normalizeValue(value, min, max): Normaliserar till 0-1
- interpolateColor(color1, color2, t): Interpolerar mellan två färger
```

**Färgskalor**:
```text
Temperatur: 
  <18°C = Blå (#3B82F6)
  22°C = Grön (#22C55E)  
  >26°C = Röd (#EF4444)

CO2:
  <600 ppm = Grön (#22C55E)
  1000 ppm = Gul (#EAB308)
  >1500 ppm = Röd (#EF4444)

Luftfuktighet:
  <30% = Brun/Orange (#F97316)
  40-60% = Grön (#22C55E)
  >70% = Blå (#3B82F6)
```

### Fas 5: Hämta och visa mätdata

**Uppdatering**: `src/services/asset-plus-service.ts`

Ny funktion `fetchRoomSensorData(buildingFmGuid)`:
1. Hämta alla rum för en byggnad
2. Extrahera sensorvärden från `attributes` JSONB
3. Returnera mappat format: `{ fmGuid, temperature, co2, humidity, occupancy }`

**Mock-data vid avsaknad av riktiga värden**:
- Generera simulerade värden för demonstration
- Toggle i panelen: "Visa simulerad data"

---

## Teknisk arkitektur

```text
+------------------+     +------------------------+     +------------------+
| ViewerToolbar    |---->| RoomVisualizationPanel |---->| visualization-   |
| (Ny knapp)       |     | (Dropdown + Legend)    |     | utils.ts         |
+------------------+     +------------------------+     +------------------+
                                    |
                                    v
                         +------------------------+
                         | AssetPlusViewer        |
                         | - colorizeSpace()      |
                         | - resetColors()        |
                         +------------------------+
                                    |
                                    v
                         +------------------------+
                         | Supabase: assets       |
                         | (attributes JSONB)     |
                         +------------------------+
```

---

## Filändringar

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `src/components/common/UniversalPropertiesDialog.tsx` | Ändra | Case-insensitiv GUID-sökning |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Ny | Visualiseringspanel med dropdown och legend |
| `src/lib/visualization-utils.ts` | Ny | Färgberäkning och normalisering |
| `src/components/viewer/AssetPlusViewer.tsx` | Ändra | Lägg till visualiseringsknapp och integration |
| `src/components/viewer/ViewerToolbar.tsx` | Ändra | Ny knapp för visualisering |
| `src/services/asset-plus-service.ts` | Ändra | Ny funktion för att hämta sensordata |

---

## Prioritering

1. **Kritiskt**: Fixa UniversalPropertiesDialog (5 min)
2. **Viktigt**: Förbättra Asset+-egenskapsvisning (15 min)
3. **Funktion**: Implementera visualiseringspanel (30 min)
4. **Funktion**: Färgberäkningslogik (15 min)
5. **Integration**: Koppla till 3D-viewer (20 min)

**Total uppskattad tid**: ~1.5 timmar

---

## Framtida utbyggnad

- Integration med realtidsdata från Senslinc
- Historisk datavisning med tidslinjevy
- Exportera visualiseringsrapporter
- Larm-tröskelvärden för sensorer
