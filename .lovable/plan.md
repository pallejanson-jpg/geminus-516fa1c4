

# Grundlig analys & fix av ViewerFilterPanel

## Identifierade problem

Jag har läst igenom hela ViewerFilterPanel.tsx (1859 rader) och hittat följande grundorsaker:

### Problem 1: Rum-antal visar 0 vid våningsbyte
**Orsak:** `spaces`-listan (rad 230-308) filtrerar rum baserat på `checkedLevels`, men GUID-matchningen mellan Asset+ level fm_guid och xeokit-scenen misslyckas ofta. Fallback-logiken (rad 261-291) försöker använda `entityMapRef`, men den kräver att `buildEntityMap` redan körts klart — och den memon som beräknar `spaces` triggas INNAN entity-mappen är klar. Resultatet: 0 rum.

**Dessutom:** `spaceCount` i levels (rad 169-174) beräknas med `normalizeGuid`-matchning mot `levelFmGuid`, men Asset+-data har ofta inkonsistenta GUID-format (med/utan bindestreck, olika casing). Om matchningen missar → `spaceCount` = 0.

### Problem 2: Kategorier visar ingenting
**Orsak:** `categories` (rad 381-451) hämtar entity-räkningar från `entityMapRef.current` — men om entity-mappen inte byggts klart (poller tar upp till 5 sekunder), returneras tom lista. Dessutom filtreras kategorier med `scopeIds` från `entityMapRef` som kan vara tom.

### Problem 3: Extremt långsamt
**Orsak — `applyFilterVisibility` (rad 807-1243):**
1. **Full-scan varje gång:** Rad 823-835 gör `scene.setObjectsVisible(scene.objectIds, true)` → itererar ALLA objekt (kan vara 100k+) varje checkbox-klick
2. **IfcSpace-scan duplicerad:** Rad 839-847 och rad 898-907 loopar genom ALLA metaObjects två gånger per filter-tillämpning
3. **Slab-scan:** Rad 1067-1116 gör ytterligare en full traversal av alla metaObjects
4. **Debounce hjälper inte:** 300ms debounce (rad 810) men `useEffect` vid rad 1248 triggas av 15+ dependencies inklusive `spaces`, `levelColors`, `spaceColors`, `categoryColors` — färgpaletterna ändras vid varje ny spaces-beräkning → cascade av re-renders
5. **`buildEntityMap` körs upprepade gånger:** `useCallback` vid rad 464 har `levels` och `sharedModels` som dependencies, och `buildEntityMap` anropas i ett `setInterval` vid rad 698

### Problem 4: Rummet visas inte isolerat i 3D
**Orsak:** `handleSpaceClick` (rad 1311-1327) selekterar entiteter men gör INTE visibility-filtrering. Den ändrar bara `selected`-state. Det som faktiskt filtrerar 3D-scenen är `applyFilterVisibility` som körs via `checkedSpaces` — men "x-ray context" logiken (rad 1144-1205) kräver att entity-mappen matchar rummet, vilket ofta misslyckas.

## Fixplan

### Steg 1: Separera data-byggande från rendering
- Flytta `buildEntityMap` till en `useEffect` som körs EN GÅNG när viewer är redo, och lagra resultatet i en stabil ref
- Låt `spaces` och `categories` memon läsa från entity-map-refen istället för att köra egna traversals
- Eliminera beroende på `spaces` i `buildEntityMap` (cirkulärt: spaces ↔ entityMap)

### Steg 2: Eliminera full-scene-reset
- Istället för "reset alla → sätt tillbaka" — håll en `previousVisibleIds`-ref och bara delta-uppdatera (göm det som lagts till, visa det som tagits bort)
- Alternativt: använd `scene.setObjectsVisible(idsToHide, false)` och `scene.setObjectsVisible(idsToShow, true)` bara för ändrade ID:n

### Steg 3: Fixa cascading filter-logiken  
**Principen: Source → Level → Space → Category som en tratt:**
1. **Sources** filtrerar vilka `levels` som visas i UI (graya ut / dölj levels som inte tillhör vald source)
2. **Levels** filtrerar vilka `spaces` som visas (matcha via Asset+ `level_fm_guid` + xeokit-fallback)
3. **Spaces** filtrerar vilka `categories` som visas (räkna bara IFC-typer inom valda rum/våningar)
4. Varje steg i tratten minskar scope för nästa

### Steg 4: Fixa GUID-matchning
- Normalisera ALLA GUID:s till lowercase utan bindestreck vid matchning
- Bygg en `normalizedLevelGuidMap` en gång som mappar alla varianter → kanoniskt level-fmGuid
- Inkludera ALLA `databaseLevelFmGuids` från `sharedFloors` i matchningen

### Steg 5: Rum-isolering i 3D vid checkbox
- När `checkedSpaces` ändras: visa rummet som solid, x-raya kontext (walls/doors på samma våning), dölj allt annat
- Flytta kameran automatiskt till rummet (`cameraFlight.flyTo({ aabb })`)

### Steg 6: Performance-optimeringar
- Cachelagra `metaObjects`-traversal i en `typeIndex: Map<string, string[]>` (IFC-typ → entity-IDs) — byggs en gång
- Reducera `applyFilterVisibility` dependencies till bara de states som faktiskt ändrats (break ut färg-applicering till separat effect)
- Flytta färgpaletten ur useMemo-beroendena — färgändringar ska INTE trigga full visibility-reset

## Filer att ändra

| Fil | Ändring |
|---|---|
| `src/components/viewer/ViewerFilterPanel.tsx` | Full refactor av filter-logik, entityMap-byggande, och performance |

Estimat: Stor ändring, ~800 rader berörs i en fil. Ingen databasändring behövs.

