
Målbild
- Rumslabel i 3D ska endast visas för de våningsplan som faktiskt är “valda/isolering-synliga” just nu.
- Rumsobjekt (IfcSpace) i 3D ska endast vara synliga för de våningsplan som är valda/isolering-synliga.
- Rumsvisualisering (färgning) ska endast appliceras på rum på valda/isolering-synliga våningsplan och aldrig “läcka” till andra plan, samt sluta vara sporadisk.

Varför felet uppstår idag (rotorsak)
1) Det finns flera sätt att välja våning:
   - FloatingFloorSwitcher (pills nere till vänster)
   - FloorVisibilitySelector (i menyn)
   - FloorCarousel (thumbnail-karusell)
   Dessa pratar inte konsekvent samma “floor filter”-språk.

2) AssetPlusViewer filtrerar rum med visibleFloorFmGuids (databasens level-fmGuid), men:
   - FloatingFloorSwitcher och FloorCarousel uppdaterar inte visibleFloorFmGuids i AssetPlusViewer.
   - FloorVisibilitySelector anropar onVisibleFloorsChange vid klick, men vid initial restore (localStorage) kan AssetPlusViewer stå kvar med tom lista.
   - När visibleFloorFmGuids är tomt finns fallback-logik som kan visa alla spaces, vilket gör att hela byggnadens rum tänds.

3) RoomVisualizationPanel kan lämna “färgade” rum kvar från tidigare filter eftersom resetColors idag bara reset:ar de rum som just nu råkar ligga i state `rooms`. När man byter våning kan rum från tidigare våning förbli färgade → upplevs som sporadiskt/hela byggnaden.

Övergripande lösning
A) Inför en “single source of truth” för våningsfilter, och se till att ALLA vånings-UI-komponenter emitterar samma uppdatering (inklusive multi-select).
B) AssetPlusViewer ska alltid använda det uppdaterade filterläget när:
   - showSpaces ändras
   - våningsval/isolering ändras
   - rumslabels är på
   - rumsvisualisering är på
C) RoomVisualizationPanel ska hålla reda på vilka rum som faktiskt färgats och alltid reset:a dessa vid filterbyte/typbyte så inget “hänger kvar”.

Del 1 — Gör FLOOR_SELECTION_CHANGED_EVENT rikare (så AssetPlusViewer alltid vet vilka våningar som är valda)
Ändringar:
1) Uppdatera typen FloorSelectionEventDetail i `src/hooks/useSectionPlaneClipping.ts` (bakåtkompatibelt)
   - Lägg till optional fält:
     - visibleMetaFloorIds?: string[]        (xeokit meta storey ids)
     - visibleFloorFmGuids?: string[]        (databasens floor fmGuids / originalSystemId)
     - isAllFloorsVisible?: boolean

2) Uppdatera `src/components/viewer/FloorVisibilitySelector.tsx`
   - När selection ändras (inkl. init/restore), dispatcha FLOOR_SELECTION_CHANGED_EVENT med:
     - visibleMetaFloorIds: Array.from(newSet)
     - visibleFloorFmGuids: allFmGuids (som den redan kan räkna fram)
     - isAllFloorsVisible: newSet.size === floors.length
   - Viktigt: gör detta även vid initial apply (idag dispatchas event bara i solo-läge, vilket gör att andra delar inte får korrekt filter)

3) Uppdatera `src/components/viewer/FloatingFloorSwitcher.tsx`
   - Vid klick (solo/multi/all) dispatcha FLOOR_SELECTION_CHANGED_EVENT med samma extra data:
     - visibleMetaFloorIds: Array.from(newVisibleIds)
     - visibleFloorFmGuids: härled från `floors`-listan (floor.databaseLevelFmGuids för de synliga)
     - isAllFloorsVisible: newVisibleIds.size === floors.length

4) Uppdatera `src/components/viewer/FloorCarousel.tsx` och/eller `AssetPlusViewer.handleFloorSelect`
   - När man väljer en våning i karusellen ska det också trigga samma event och filter:
     - visibleMetaFloorIds: [floor.id]
     - visibleFloorFmGuids: [resolvedDbGuid] (metaObj.originalSystemId om finns)
     - isAllFloorsVisible: false
   - (Valfritt men rekommenderat) Uppdatera FloorCarousel så floor.fmGuid faktiskt blir originalSystemId när den finns, inte metaObject.id. Då blir även cutout och filter mer korrekt.

Del 2 — AssetPlusViewer ska alltid filtrera spaces + labels + visualization efter samma “effektiva” floor filter
Ändringar i `src/components/viewer/AssetPlusViewer.tsx`:
1) Lägg till en listener på FLOOR_SELECTION_CHANGED_EVENT
   - Om eventet innehåller visibleFloorFmGuids + isAllFloorsVisible:
     - Uppdatera `visibleFloorFmGuids` state direkt (för att driva RoomVisualizationPanel + labels)
     - Kör `filterSpacesToVisibleFloors(effectiveGuids, showSpaces)` om showSpaces är på
     - Anropa `updateFloorFilter(effectiveGuids)` för rumslabels

2) Ta bort/ändra “show all”-fallback i `filterSpacesToVisibleFloors`
   - Idag: om visibleFloorGuids.length === 0 och showSpaces===true → visas alla spaces.
   - Ändra till:
     - Om isAllFloorsVisible === true → visa alla spaces (OK)
     - Om vi inte vet vad som är synligt (t.ex. tom lista men inte all-visible) → visa INTE allt; antingen:
       a) göm spaces (säkert default)
       b) eller försök härleda från selectedFloorId om den är satt
   Detta är den viktigaste delen för att stoppa att hela byggnadens rum tänds av misstag.

3) Se till att RoomVisualizationPanel alltid får korrekt visibleFloorFmGuids
   - Efter Del 1/2 ska `visibleFloorFmGuids` aldrig vara “tom av misstag” när användaren isolerat en våning.
   - Behåll prop-logik men se till att state faktiskt uppdateras.

Del 3 — Gör rumslabels striktare så de aldrig “läcker” om parent storey saknas
Ändringar i `src/hooks/useRoomLabels.ts`:
- I `createLabels`:
  - Om hasFloorFilter är true men parentStorey inte hittas:
    - skip: return; (skapa inte label)
  Detta matchar space-filtering som redan gömmer sådana.

Del 4 — Fixa “sporadisk” rumsvisualisering (sticky colors)
Ändringar i `src/components/viewer/RoomVisualizationPanel.tsx`:
1) Inför en ref som spårar vilka fmGuids som färgats senast:
   - `const colorizedRoomGuidsRef = useRef<Set<string>>(new Set());`

2) När filter/visualizationType ändras:
   - Reset:a alla tidigare färgade rum (från ref) innan ny applicering
   - Töm ref och fyll på igen när applyVisualization färgar rum
   Detta gör att rum från andra våningar aldrig blir kvar i färgat läge när man byter isolering.

3) Vid unmount:
   - Reset:a alla rum i `colorizedRoomGuidsRef` (inte bara `rooms` state)

Del 5 — Testplan (för att verifiera att allt sitter ihop)
1) Öppna valfri byggnad med flera våningar.
2) Isolera en våning via:
   - FloatingFloorSwitcher (pills)
   - FloorVisibilitySelector (menyn)
   - FloorCarousel (karusell)
3) Slå på:
   - “Visa rum” (Show Spaces)
   - Rumslabels
   - Rumsvisualisering (t.ex. Temperatur)
4) Verifiera:
   - Endast rum/spaces/labels på isolerad våning syns och färgas.
   - Byt isolerad våning → endast nya våningens rum färgas, inga “gamla” rum förblir färgade.
   - Multi-select (Ctrl/Cmd-klick i pills eller switches) → endast de valda våningarna påverkas.
   - “Visa alla våningar” → rumsfeatures gäller hela byggnaden (om det är önskat). Om ni hellre vill att labels/visualization bara ska fungera i solo-läge kan vi låsa till solo senare.

Filer som berörs
- `src/hooks/useSectionPlaneClipping.ts` (utöka event detail-typ)
- `src/components/viewer/FloorVisibilitySelector.tsx` (dispatcha full selection + init)
- `src/components/viewer/FloatingFloorSwitcher.tsx` (dispatcha full selection även i multi)
- `src/components/viewer/FloorCarousel.tsx` (skicka selection-event / korrigera fmGuid)
- `src/components/viewer/AssetPlusViewer.tsx` (lyssna på event, robust filter, ta bort farlig fallback)
- `src/hooks/useRoomLabels.ts` (strict filter när parentStorey saknas)
- `src/components/viewer/RoomVisualizationPanel.tsx` (sticky color fix)

Förväntad effekt
- När du tänder rumsvisualisering ska endast rummen på valda våningar tändas (och inga andra).
- Inga sporadiska “läckor” vid våningsbyte, eftersom tidigare färgningar alltid reset:as.
- Samma beteende oavsett om du väljer våning via pills, meny eller karusell.
