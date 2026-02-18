
# Plan: 8 buggar att åtgärda

## Inventering av alla problem

### Problem 1: Centralstationen & Åkerselva — 3D-knapp gråad
**Rotorsak bekräftad**: Databasen har bara XKT-modeller för 3 byggnader:
- `755950d9` (Småviken — 3 modeller, alla med UUID-namn)
- `9baa7a3a` (okänd — 2 modeller)
- `a8fe5835` (okänd — 2 modeller)

Centralstationen och Åkerselva saknas helt i `xkt_models`-tabellen. `FacilityLandingPage.tsx` kontrollerar:
```typescript
supabase.from('xkt_models').select('id', { count: 'exact', head: true })
  .eq('building_fm_guid', buildingGuid)
  .then(({ count }) => setHas3DModels((count ?? 0) > 0));
```
Om inga rader finns → `has3DModels = false` → 3D-knappen gråas ut.

**Orsak**: XKT-cache sparas bara när någon *öppnat* 3D-viewern för ett specifikt byggnad. Om den aldrig öppnats via `/split-viewer` fungerar inte knappen.

**Fix**: `FacilityLandingPage.tsx` ska **inte** gråa ut 3D-knappen baserat på XKT-cache. 3D-viewer fungerar även utan cachat XKT — den laddar direkt från Asset+ API. Knappen ska alltid vara aktiv för byggnader (ej gråad). Logiken för att checka XKT-tabell tas bort som port-check — istället visar vi 3D-knappen alltid för byggnader.

### Problem 2: Map-funktionen i övre menyn fungerar inte
**Rotorsak**: `handleMenuClick('map')` sätter `setActiveApp('map')`. Men i `MainContent.tsx` är `map` i `FILL_APPS` (inte `VIEWER_APPS`). Det innebär att containern är `w-full h-full` men `overflow-y-auto` är satt. Kartans `<Map>` komponent renderas i `flex-1 flex flex-col h-full` — detta fungerar korrekt. Problemet är att kartan inte får explicit höjd.

Men det verkliga problemet är: när `map` aktiveras via header-knappen — fungerar det faktiskt? Det borde fungera. Låt oss kontrollera om problemet är att `mapboxToken` inte laddas. Nej — token-logiken är korrekt.

Det troligaste problemet: kartans container `<div className="flex-1 flex flex-col h-full relative">` i `MapView.tsx` rad 415 fungerar inte om föräldern inte har explicit höjd. `MainContent` ger `h-full` till wrap-diven för FILL_APPS, men `overflow-y-auto` är satt på `<main>`. När `overflow-y-auto` är satt på föräldern + `h-full` på barnet, beräknas `h-full` mot scrollable height, inte viewport height.

**Fix**: Flytta `map` från `FILL_APPS` till `VIEWER_APPS` i `MainContent.tsx` — kartan behöver `overflow:hidden` precis som 3D-viewern.

### Problem 3: Byggnadsikonerna i Mapbox syns dåligt vid zoom/pan
**Rotorsak**: `clusters` beräknas via `useMemo` beroende på `viewState` — men `viewState` uppdateras *kontinuerligt* under `onMove`. Problemet är bounds-beräkningen:
```typescript
const bounds: [number, number, number, number] = [
  viewState.longitude - 180 / Math.pow(2, viewState.zoom),
  viewState.latitude - 90 / Math.pow(2, viewState.zoom),
  ...
];
```
Denna formel är en approximation och ger ibland fel bounds, vilket gör att supercluster returnerar tomma clusters för en del vyer.

**Fix**: Använd `mapRef.getBounds()` för att få exakta bounds, och beräkna clusters via `onMoveEnd`-callback (inte `useMemo` på `viewState`). Alternativt: använd `Map`'s `onMoveEnd` event och spara bounds i state för re-rendering.

Enklare fix: Lägg till en stor margin (padding) till bounds-beräkningen:
```typescript
const pad = 1.5;
const bounds: [number, number, number, number] = [
  viewState.longitude - (180 / Math.pow(2, viewState.zoom)) * pad,
  viewState.latitude - (90 / Math.pow(2, viewState.zoom)) * pad,
  viewState.longitude + (180 / Math.pow(2, viewState.zoom)) * pad,
  viewState.latitude + (90 / Math.pow(2, viewState.zoom)) * pad,
];
```

Dessutom: `coloringMode`-ändring re-renderar inte markererna. Fördröjning i `useMemo` kan orsaka att gamla markers kvarstår. Säkerställ att `coloringMode` är en dependency i cluster-beräkning.

### Problem 4: 360° i inbäddad vy säger "No 360° view configured"
**Rotorsak**: `LeftSidebar.tsx` anropar `setActiveApp('radar')` via `handleItemClick`. `MainContent.tsx` renderar `<Ivion360View>`. Ivion360View (rad 79): `const ivionUrl = ivion360Context?.ivionUrl || url || localStorage.getItem('ivion360Url')`. Men `ivion360Context` är null (inget sätts i LeftSidebar) och `url` är undefined. Komponenten söker efter `ivion360Context` men hittar inget → visar felmeddelandet.

Lösningen är att när användaren klickar på "Radar" (360°) i LeftSidebar, ska `ivion360Context` sättas med datan från `selectedFacility` (om byggnad är vald) och dess Ivion-inställningar.

**Fix i `LeftSidebar.tsx`**: För `radar`-alternativet, kontrollera om `selectedFacility` har en `ivionSiteId` i `building_settings`. Sätt `ivion360Context` med rätt data, annars visa ett meddelande om att konfigurera Ivion Site ID.

### Problem 5: Bakåtknapp saknas — inkonsekvent navigation
**Konsekventhetsprincip**: Välj EN strategi för bakåtknapp. **Rekommendation**: Bakåtpil (←) uppe till vänster för alla sidor. X-knapp (×) används bara för modala/overlay-komponenter.

**Sidor som saknar bakåtknapp**:
- `InsightsView` (ingen bakåt-knapp alls)
- `Viewer.tsx` / `AssetPlusViewer.tsx` inbäddad i AppLayout (ingen bakåt-knapp till portfolio)

**Fix**: 
- Lägg till bakåtknapp i `InsightsView.tsx` (← uppe till vänster) som navigerar till portfolio
- `Viewer.tsx` (inbäddad 3D) — lägg till bakåtpil i `AssetPlusViewer`-toolbar som anropar `onClose`
- `FacilityLandingPage` använder X — byt till ← uppe till vänster (konsekvent med UnifiedViewer)

### Problem 6: 2D Ritning gråad — förklaring och fix
**Förklaring av skillnad**:
- **2D Ritning** (`hasFmAccess`) = FM Access system (Tessel HDC) — kräver att `fm_access_building_guid` är satt i `building_settings`. Detta är ett separat CAD/ritningssystem.
- **2D FMA** i UnifiedViewer = samma sak men via iframe, visas på byggnads-/våningsnivå i 3D-viewern

**Varför gråat**: `hasFmAccess` checkar `fm_access_building_guid` i `building_settings`. Om detta fält är null/tomt → knapp gråas.

**Fix**: Det är korrekt beteende — knappen ska vara gråad om FM Access inte är konfigurerat. Men felbeskrivningen ska vara tydligare när användaren hover:ar. Lägg till tooltip: "FM Access-ritning. Kräver FM Access-konfiguration i byggnadsinstllningar."

### Problem 7: Cesium (Globe) fungerar inte
Cesium renderas via `CesiumGlobeView.tsx`. Problemet kan vara att `globe` är i `VIEWER_APPS` men att Cesium-token inte laddas, eller att komponenten kraschar.

**Fix**: Behöver undersöka `CesiumGlobeView.tsx` mer — men troligast är att `globe` bör hanteras som `VIEWER_APPS` (overflow hidden) och att Cesium-tokenhämtning fungerar.

### Problem 8: Insights — karta till höger med byggnadsikoner
**Ny feature**: I `InsightsView.tsx` på övergripande nivå, vill användaren ha en inbäddad karta (Mapbox) till höger med byggnadsikoner färgade enligt aktiv chart-kolumn/pie.

**Implementation**: Delad layout i InsightsView — vänster 60% = tabs/charts, höger 40% = inbäddad miniature MapView med `coloringMode` synkad till aktiv chart-typ.

---

## Konkret implementation — filändringar

### Fil 1: `src/components/portfolio/FacilityLandingPage.tsx`
- Ta bort `has3DModels` state och XKT-kontroll
- 3D-knappen är alltid aktiv för byggnader (inte gråad baserat på XKT)
- 2D-knapp: lägg till tydlig tooltip med förklaring

### Fil 2: `src/components/layout/MainContent.tsx`
- Flytta `'map'` från `FILL_APPS` till `VIEWER_APPS`

### Fil 3: `src/components/map/MapView.tsx`
- Fixa bounds-beräkning med padding-faktor (1.5x)
- Lägg till `mapRef` och använd `onMoveEnd` event för att trigga cluster-re-rendering
- Fixa `coloringMode`-ändring: säkerställ att markers uppdateras omedelbart

### Fil 4: `src/components/layout/LeftSidebar.tsx`
- För `radar`-klick: hämta ivion-inställningar för `selectedFacility` och sätt `ivion360Context`

### Fil 5: `src/components/insights/InsightsView.tsx`
- Lägg till bakåtpil (←) uppe till vänster som navigerar till 'portfolio'
- Lägg till inbäddad mini-karta till höger med ColoringMode synkad till aktiv tab

### Fil 6: `src/components/viewer/AssetPlusViewer.tsx`
- Säkerställ att back-knappen (onClose) alltid är synlig i toolbar (redan finns men verifiera)

---

## Navigation-konsekvensprincip

Valet är: **alltid bakåtpil (←) uppe till vänster**.
- X-knapp reserveras för modaler/dialogs/sheets
- Bakåtpil för alla sidor/vyer: InsightsView, FacilityLandingPage, 3D-viewer (inbäddad)
- UnifiedViewer (/split-viewer) har redan korrekt ← Tillbaka-knapp

---

## Sammanfattning av filändringar

| Fil | Problem | Ändring |
|---|---|---|
| `FacilityLandingPage.tsx` | 3D-knapp gråad | Ta bort XKT-kontroll, knappen alltid aktiv |
| `MainContent.tsx` | Map-layout | Flytta 'map' till VIEWER_APPS |
| `MapView.tsx` | Ikoner försvinner | Fixa bounds + coloringMode |
| `LeftSidebar.tsx` | 360° saknar context | Sätt ivion360Context vid radar-klick |
| `InsightsView.tsx` | Bakåtknapp + karta | Lägg till ← och mini-karta |
| `AssetPlusViewer.tsx` | Bakåtknapp synlighet | Verifiera onClose-knapp |
