

## Analys och plan: Småviken Viewer — 8 problem att åtgärda

### Problemöversikt

Jag har analyserat loggarna, koden och nätverksförfrågningarna noggrant. Här är vad jag hittat:

---

### 1. Våningsplan: fel namn och för många (25 istället för ~8)

**Orsak:** Loggarna visar `xeokit storeys: 25` — det är alla modellers (A+B+E+V) våningsplan. `useFloorData.ts` har redan A-modell-prioritering men logiken i `classifyModels()` matchar inte korrekt: `modelNamesMap` returnerar DB-namn som `"A-modell"` men `isArchitecturalModel()` förväntar sig att `friendlyName.charAt(0) === 'A'`. Problemet: om DB-namn saknas eller inte börjar med "A" (t.ex. ett GUID-liknande ID) faller alla modeller igenom som icke-arkitektur, och `aModelObjectIds` blir tomt → `hasAModel = false` → alla 25 storeys visas.

Dessutom: `ViewerFilterPanel.buildEntityMap()` har sin egen `aModelSceneIds`-logik (rad 426-443) som kollar `m.name.toLowerCase().startsWith('a')` — men `sharedModels[].name` kan vara det fullständiga "A-modell"-namnet och inte bara "A", vilket borde matcha. Men fallback-logiken (rad 436-443) behandlar ALLA modeller som A-modeller om inga matchas.

**Fix i `useFloorData.ts`:**
- Förbättra `isArchitecturalModel()` att matcha `"A-modell"`, `"A modell"`, `"ARK"`, `"Arkitekt"` etc.
- Lägg till loggning: `console.log('[useFloorData] A-model detection:', friendlyName, isArch)`.

**Fix i `ViewerFilterPanel.tsx` buildEntityMap:**
- Samma förbättrade matchningslogik.

### 2. V-modell visas inte (A-modell visas istället)

**Orsak:** `ViewerFilterPanel` source-filtrering (rad 874-936) mappar sources via `levels.filter(l => checkedSources.has(l.sourceGuid))` — men `sourceGuid` baseras på `parentBimObjectId` från `assets`-tabellen, som kan vara tom eller inte matcha scen-modellens ID. Log: `Source filter produced 0 IDs — falling back to all objects`.

**Fix:**
- Förbättra source→model-mappning: när `sourceGuid` saknas, bygg en fallback baserad på `sharedModels[].id` direkt kopplat mot `viewer.scene.models`.
- I `applyModelVisibility` (useModelData), säkerställ att V-modell-ID:n mappas korrekt.

### 3. Allt går väldigt långsamt

**Orsak — flera faktorer:**

a) **FilterPanel entity map byggs om konstant** — loggarna visar `Entity map built` vid varje interaktion (15+ gånger under sessionen). `buildEntityMap` har `[levels, sharedModels, checkedSources, sources]` som dependencies, och `checkedSources` ändras vid source-filtrering → entity map byggs om → `getDescendantIds()` anropas för varje level × space (O(n×m) med rekursion).

b) **`applyFilterVisibility` itererar ALLA metaObjects 3-4 gånger** per filtrering (IfcSpace-hide, category coloring, slab detection).

c) **`categories` memo beror på `checkedLevels`** → omberäknas vid varje våningsbyte → itererar alla metaObjects.

d) **opacity-reset** skannar `scene.objectIds` linjärt varje gång.

**Fix:**
- Cacha entity map: ta bort `checkedSources` från dependencies (bygg mappen en gång, filtrera vid applicering).
- Slå ihop metaObject-loopar till en enda pass.
- Beräkna `categories` oberoende av `checkedLevels` och filtrera vid rendering.
- Byt opacity-reset till att bara tracka IDs som faktiskt ändrats.

### 4. IfcSlab dold som standard

**Orsak:** I `applyFilterVisibility` (rad 1034-1036): slabs flyttas från `solidIds` till `fadeIds` med `opacity: 0.3`. Men om `hasAnyFilter` är false (ingen filter aktiv) returnerar funktionen tidigt (rad 851-868) UTAN att göra slabs synliga — och slabs nämns inte i `applyArchitectColors()` som körs före.

**Fix:** Se till att slabs INTE döljs/fadas i "no filter"-läget. `applyArchitectColors` bör INTE dölja slabs.

### 5. GeminusPluginMenu ska tas bort från Viewer

**Orsak:** `NativeViewerShell.tsx` rad 632-639 renderar `GeminusPluginMenu` i 3D-viewern.

**Fix:** Ta bort `GeminusPluginMenu` från `NativeViewerShell.tsx`.

### 6. Asset panel ska ligga i Visningsmenyn

**Fix:** Lägg till en "Asset panel"-knapp i `VisualizationToolbar.tsx` Actions-sektionen som öppnar `InventoryPanel`.

### 7. Alarm annotations fungerar inte

**Orsak:** `NativeXeokitViewer` hanterar `ALARM_ANNOTATIONS_SHOW_EVENT` (rad 1221-1291) genom att matcha `alarmGuids` mot `mo.originalSystemId`. Loggen visar `1 alarms, 0 entities matched` — alarmens fm_guid hittas inte i metaScene. Problemet: alarmer är icke-modellerade assets registrerade i DB men har INGEN representation i IFC/XKT-modellen. `AssetPlusViewer` (den äldre viewern) löser detta genom att skapa HTML-markörer baserade på rumskoordinater — men `NativeXeokitViewer` försöker bara hitta IFC-entiteter.

**Fix:**
- Ändra alarm-hantering i NativeXeokitViewer: om inga alarm-entiteter matchas direkt, fallback till att matcha `roomFmGuid` istället och highlighta rummet.
- Ev. lägg till flyTo-logik baserat på rummets AABB.

### 8. Geminus AI: mockdata och trasiga action-tokens

**Problem 1 — Mockdata:** Systempromten (rad 1487) säger "ALWAYS use tools to get data – never guess or make up numbers" men modellen kan fortfarande generera mockdata om tools returnerar tomma resultat.

**Fix:** Lägg till explicit regel i systempromten: `"If a tool returns empty or no results, say that NO DATA WAS FOUND. NEVER fabricate, simulate, or make up data."`

**Problem 2 — Trasiga action-tokens:** AI:n genererar `[Visa alla arbetsordrar](action:queryWorkOrders:building_fm_guid=...)` — men `queryWorkOrders` finns inte i `handleActionLink` switch-satsen (rad 483-538). Dessa renderas som klickbara knappar men gör ingenting, och visar GUID:er i texten.

**Fix:**
- Lägg till `queryWorkOrders` (och liknande) i `handleActionLink` — eller bättre:
- Förbättra sanitering i `GunnarChat`: strippa `action:`-länkar som inte matchas i switch-satsen, visa bara texten.
- Uppdatera systempromten: lägg till att AI:n ALDRIG ska generera action-tokens som inte finns i den definierade listan.

---

### Tekniska ändringar

**Filer att ändra:**

1. **`src/hooks/useFloorData.ts`** — Förbättra `isArchitecturalModel()` matchning
2. **`src/components/viewer/ViewerFilterPanel.tsx`** — Samma A-modell-fix + prestanda + slab-fix + `fromFilterPanel: true` bort
3. **`src/components/viewer/NativeViewerShell.tsx`** — Ta bort GeminusPluginMenu
4. **`src/components/viewer/VisualizationToolbar.tsx`** — Lägg till Asset panel-knapp
5. **`src/components/viewer/NativeXeokitViewer.tsx`** — Förbättra alarm-matchning (room fallback)
6. **`src/components/chat/GunnarChat.tsx`** — Sanitera okända action:-tokens
7. **`supabase/functions/gunnar-chat/index.ts`** — Uppdatera systemprompt (no mockdata, action token whitelist)
8. **`src/components/viewer/FloatingFloorSwitcher.tsx`** — Ta bort `fromFilterPanel`-hantering

### Prestanda-analys: Varför långsammare än Tandem?

Tandem (Autodesk) laddar en optimerad rendering-pipeline med:
- **Server-side streaming tiles** (Level of Detail) — bara den geometri som syns i kameran skickas
- **GPU-instancing** — upprepade objekt (t.ex. stolar) renderas som instanser
- **Progressive loading** — lågupplöst modell först, detaljer streamar in
- **Ingen metaScene-iteration** — filtrering sker på GPU-nivå

Vår pipeline:
- Laddar HELA XKT-filen till klienten (allt i minnet)
- `applyFilterVisibility` itererar ~9000+ JavaScript-objekt per filter-ändring
- `getDescendantIds()` är rekursiv och körs per level × space
- Ingen GPU-instancing
- Varje filter-toggle triggar 3-4 fullständiga passes över alla objekt

**Åtgärder som hjälper mest:**
- Ta bort `checkedSources` från entity map dependencies (slutar bygga om mappen)
- Cacha IFC-typ → entity ID-mappning
- Flytta heavy filtering till idle callback
- Långsiktigt: implementera per-storey tiling (XKT worker) för Småviken

