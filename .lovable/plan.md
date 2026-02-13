

# Plan: Prestandaoptimering av 3D-viewer + BIM-modellnamn

## Del 1: Prestandaproblem

### 1.1 Redundant space-filtrering (STÖRSTA problemet)

**Problem:** `filterSpacesToVisibleFloors` (rad 326-426) itererar over ALLA metaObjects vid varje anrop och loggar "Filtering spaces" + "Spaces filtered". Vid floor toggle anropas den 6+ ganger i rad (via event-lyssnare, state-uppdateringar, och useEffect-kedjor).

**Losning:**
- Debounce `filterSpacesToVisibleFloors` med 100ms sa att snabba toggle-sekvenser bara kors en gang
- Cacha entity-ID-listan for IfcSpace-objekt per floor (bygg en Map en gang vid modell-laddning istallet for att soka igenom alla metaObjects varje gang)
- Ta bort `console.log` pa rad 341 och 425 (tunga stranginterpolationer i hot path)

**Fil:** `src/components/viewer/AssetPlusViewer.tsx`
```text
Rad 326-426: Wrappa filterSpacesToVisibleFloors i useRef + debounce (100ms)
Rad 341, 354, 370, 385, 425: Byt console.log -> console.debug
Lagg till en useEffect som bygger en spacesByFloor-cache (Map<floorId, string[]>) 
en gang nar modellen laddas (modelLoadState === 'loaded')
```

### 1.2 Toolbar-rerenders

**Problem:** `getOverflowItems` i `ViewerToolbar.tsx` (rad 586-590) har en `console.log` som kors varje render. Loggen tyder pa att toolbaren renderas ofta.

**Losning:**
- Byt `console.log` till `console.debug` pa rad 590
- Wrappa `ViewerToolbar` i `React.memo` om den inte redan ar det

**Fil:** `src/components/viewer/ViewerToolbar.tsx`
```text
Rad 590: console.log -> console.debug
```

### 1.3 RoomVisualizationPanel retry-loop

**Problem:** Retry-loopen (rad 452-462) pollar 5 ganger med 400ms intervall aven nar ingen visualisering ar aktiv (entityIdCache ar tom). Loopen skriver en `console.warn` varje gang den ger upp.

**Losning:** Lagg till en tidig guard som kontrollerar om entityIdCache.size === 0 OCH rooms.length === 0 och skippar retry direkt.

**Fil:** `src/components/viewer/RoomVisualizationPanel.tsx`
```text
Rad 452-462: Lagg till guard innan retry:
  if (entityIdCache.size === 0 && rooms.length === 0 && attempt > 0) return;
```

### 1.4 Duplicerade API-anrop

**Problem:** Multipla samtidiga anrop till `user_roles` och `profiles` vid floor toggle. Dessa triggas troligen av att flera komponenter renderas om och var och en gor sitt eget fetch.

**Losning:** Satt `staleTime: 60_000` pa relevanta React Query-hooks sa att data cachas i 60 sekunder istallet for att hametn pa nytt vid varje render.

**Filer:** Soka efter `useQuery.*user_roles|profiles` och lagga till staleTime.

---

## Del 2: BIM-modellnamn pa mobil

### Problem

Nar modeller extraheras for MobileViewerOverlay (rad 2112-2122) anvands bara `model.id || id` som namn -- vilket ger kryptiska filnamn som `a1b2c3d4.xkt`. Desktop-versionen (`ModelVisibilitySelector`) har 6 namnstrategier som fallback.

### Losning

Atervand den befintliga `ModelVisibilitySelector`-logiken for att losa modellnamn, och dela den sa att bade desktop och mobil kan anvanda samma namnuppslagning.

**Steg 1:** Extrahera namnuppslagningen till en delad hook `useModelNames(buildingFmGuid)` som returnerar en `Map<modelId, friendlyName>`.

Hooken ska:
1. Forst forska hamta fran `xkt_models`-tabellen (db-cache)
2. Om tomt, falla tillbaka pa Asset+ `GetModels` API
3. Returnera en stabil `Map<string, string>` for modell-ID -> vanlgt namn

**Steg 2:** Anvand hooken i `AssetPlusViewer.tsx` nar modeller extraheras for mobil (rad 2112-2122):

```text
Rad 2108-2128: Uppdatera extractModels sa att den anvander modelNamesMap
fran useModelNames-hooken for att ge varje modell ett vanligt namn.

Nuvarande:  name: model.id || id
Nytt:       name: modelNamesMap.get(id) || modelNamesMap.get(id.toLowerCase()) || id
```

**Steg 3:** Anvand samma hook i `ModelVisibilitySelector.tsx` istallet for den interna fetchModelNames-effekten (rad 96-233).

**Filer:**
```text
Ny fil: src/hooks/useModelNames.ts
  - Extrahera logiken fran ModelVisibilitySelector rad 96-233

src/components/viewer/AssetPlusViewer.tsx:
  - Importera useModelNames
  - Rad 2112-2122: Anvand modelNamesMap for att ge modeller vanliga namn

src/components/viewer/ModelVisibilitySelector.tsx:
  - Ersatt intern fetchModelNames med useModelNames-hooken
```

---

## Sammanfattning av alla filandringar

```text
Ny fil:
  src/hooks/useModelNames.ts          -- Delad hook for modellnamn

Andrade filer:
  src/components/viewer/AssetPlusViewer.tsx:
    - filterSpacesToVisibleFloors: debounce + cache + console.debug
    - extractModels (mobil): anvand useModelNames for vanliga namn
    
  src/components/viewer/ViewerToolbar.tsx:
    - Rad 590: console.log -> console.debug
    
  src/components/viewer/RoomVisualizationPanel.tsx:
    - Rad 452: tidig guard i retry-loop
    
  src/components/viewer/ModelVisibilitySelector.tsx:
    - Ersatt intern namnlogik med useModelNames
```

## Forvantat resultat

- **Prestanda:** Markant minskning av CPU-last vid floor toggle (1 filtrering istallet for 6+, cachad entity-lookup)
- **Modellnamn:** Mobila modellnamn visar t.ex. "A-modell", "V-modell" istallet for kryptiska ID:n
- **Ingen paverkan** pa desktop-beteende

