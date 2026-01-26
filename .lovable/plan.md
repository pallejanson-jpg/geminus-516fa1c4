
# Plan: Förbättrad 3D-verktygsstruktur och byggnadsväljare

## Sammanfattning
Denna plan löser tre problem:
1. Verktyg som är markerade som synliga visas inte i verktygsfältet
2. För många verktyg i ett och samma verktygsfält
3. Ingen möjlighet att välja byggnad när 3D-viewern startas tom

## Problem 1: Verktyg syns inte

### Orsak
När `localStorage` innehåller äldre verktygsinställningar som saknar nya verktyg (t.ex. `visualization`), returnerar merge-logiken det lagrade värdet. Men om det lagrade värdet är `undefined` för nya verktyg, visas de inte.

Dessutom finns en logikbugg i `ToolButton`:
```javascript
if (toolId && isToolInOverflow(toolId) && !isMobile) return null;
```
Detta döljer verktyg som är markerade som "i overflow" från huvudmenyn, men om verktyget samtidigt är `visible: true` och `inOverflow: true`, visas det varken i huvudmenyn eller i overflow-menyn (om callback saknas).

### Lösning
Uppdatera merge-logiken i `getToolbarSettings()` för att alltid inkludera nya verktyg och tvinga en localStorage-uppdatering vid nya verktyg.

---

## Problem 2: Dela upp verktygsfältet

### Nuvarande struktur
Ett horisontellt verktygsfält i botten med ~20 verktyg:
- Navigering: Orbit, Första person
- Zoom: In, Ut, Anpassa, Återställ
- Verktyg: Välj, Mät, Snitt
- Vyläge: 2D/3D
- Vyalternativ: X-ray, Rum, NavCube, Minimap, Annotationer, Modellträd, Visualisering
- Objektinfo: Asset+, Lovable, Registrera

### Föreslagen struktur: Två separata verktygsfält

**Nedre verktygsfält (Navigering)**:
- Navigeringslägen: Orbit, Första person
- Zoom: In, Ut, Anpassa, Återställ
- Verktyg: Välj, Mät, Snitt
- Vyläge: 2D/3D
- Overflow-meny för övriga navigeringsverktyg

**Höger verktygsfält (Visualisering/Vy-alternativ)**:
- Placering: Höger sida, vertikalt
- Trigger: "..." (MoreVertical) eller Sheet-stil
- Innehåll:
  - X-ray läge
  - Visa/dölj rum (spaces)
  - Navigationskub
  - Minimap
  - Annotationer
  - Modellträd
  - Rumsvisualisering
  - Objektinfo (Asset+)
  - Egenskaper (Lovable)
  - Registrera tillgång
  - Inställningar

---

## Problem 3: Byggnadsväljare i tom viewer

### Nuvarande beteende
När användaren väljer "3D" från Quick Actions utan vald byggnad:
- Viewer.tsx visar "No model selected"
- Ingen möjlighet att välja byggnad

### Lösning
Skapa en byggnadsväljare-komponent som visas i den tomma viewern:

**Fil**: `src/components/viewer/BuildingSelector.tsx`

Funktionalitet:
1. Hämtar byggnader från `allData` i AppContext
2. Visar en lista/grid med tillgängliga byggnader
3. När användaren väljer en byggnad, sätts `viewer3dFmGuid`
4. Viewern laddar då modellen automatiskt

---

## Teknisk arkitektur

```text
                    +----------------------+
                    |    Viewer.tsx        |
                    +----------+-----------+
                               |
            +------------------+------------------+
            |                                     |
  viewer3dFmGuid?                      viewer3dFmGuid === null
            |                                     |
            v                                     v
+------------------------+          +---------------------------+
|   AssetPlusViewer      |          |   BuildingSelector        |
+------------------------+          | - Visar byggnader         |
| - Nedre verktygsfält   |          | - onClick → setViewer3d   |
| - Höger visualisering  |          +---------------------------+
+------------------------+
```

---

## Filändringar

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `src/components/viewer/ToolbarSettings.tsx` | Ändra | Fixa merge-logik för nya verktyg, definiera tool-grupper |
| `src/components/viewer/ViewerToolbar.tsx` | Ändra | Behåll endast navigeringsverktyg, ta bort visualiseringsverktyg |
| `src/components/viewer/VisualizationToolbar.tsx` | Ny | Nytt höger verktygsfält för vy-alternativ och visualisering |
| `src/components/viewer/AssetPlusViewer.tsx` | Ändra | Lägg till VisualizationToolbar, justera layout |
| `src/components/viewer/BuildingSelector.tsx` | Ny | Byggnadsväljare för tom viewer |
| `src/pages/Viewer.tsx` | Ändra | Visa BuildingSelector istället för "No model selected" |

---

## Detaljerad implementation

### 1. ToolbarSettings.tsx - Fixa merge-logik

Uppdatera `getToolbarSettings()`:
```text
- Lägg till versionsnummer för att tvinga reset vid strukturändringar
- Säkerställ att nya verktyg alltid inkluderas
- Separera verktyg i grupper: NAVIGATION_TOOLS och VISUALIZATION_TOOLS
```

### 2. ViewerToolbar.tsx - Fokus på navigering

Behåll endast:
- Navigering: Orbit, Första person
- Zoom: In, Ut, Anpassa, Återställ  
- Verktyg: Välj, Mät, Snitt
- Vyläge: 2D/3D
- Kompakt overflow för extra navigeringsverktyg

Ta bort:
- X-ray, Rum, NavCube, Minimap, Annotationer
- Modellträd, Visualisering
- Objektinfo, Egenskaper, Registrera tillgång

### 3. VisualizationToolbar.tsx (Ny)

Placering: Höger sida, vertikal
Trigger: Knapp med MoreVertical-ikon
Innehåll (Sheet eller Dropdown):
```text
VY-ALTERNATIV:
- X-ray läge
- Visa/dölj rum
- Navigationskub
- Minimap
- Annotationer

VISUALISERING:
- Modellträd
- Rumsvisualisering

OBJEKTDATA:
- Objektinfo (Asset+)
- Egenskaper (Lovable)
- Registrera tillgång

INSTÄLLNINGAR:
- Anpassa verktygsfält
```

### 4. BuildingSelector.tsx (Ny)

```text
Komponenter:
- Header med titel "Välj byggnad"
- Sökfält för filtrering
- Grid med byggnadskort:
  - Byggnadens namn
  - Adress
  - Antal våningar/rum
  - Klickbart för att öppna i 3D
```

### 5. Viewer.tsx - Integrera byggnadsväljare

```text
Ändra från:
  "No model selected" → <BuildingSelector />
```

---

## Visuell layout

```text
+----------------------------------------------------------+
|                      3D VIEWER                           |
|                                                          |
|                                                    [···] | ← Höger toolbar (visualisering)
|                                                          |
|                                                          |
|                                                          |
|                                                          |
|                                                          |
|                                                          |
+----------------------------------------------------------+
|    [🔄][👤] | [+][-][◎][⟲] | [↖][📏][✂] | [2D/3D] [⋮]    | ← Nedre toolbar (navigering)
+----------------------------------------------------------+
```

---

## Prioritering

1. **Kritiskt**: Fixa ToolbarSettings merge-logik (5 min)
2. **Viktigt**: Skapa VisualizationToolbar (20 min)
3. **Viktigt**: Uppdatera ViewerToolbar till navigeringsfokus (15 min)
4. **Funktion**: Integrera båda toolbars i AssetPlusViewer (10 min)
5. **Funktion**: Skapa BuildingSelector (20 min)
6. **Integration**: Uppdatera Viewer.tsx (5 min)

**Total uppskattad tid**: ~1.5 timmar

---

## Framtida förbättringar

- Drag-and-drop för att flytta verktyg mellan nedre och höger toolbar
- Tangentbordsgenvägar för vanliga verktyg
- Favoritverktyg som användaren kan pinna
- Responsiv anpassning för mobil (kollapsad höger toolbar)
