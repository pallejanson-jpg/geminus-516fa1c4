

## Plan: Viewer UX-förbättringar (desktop)

Åtgärdar 10 separata problem: Insights-panel, Properties-dialog, Room Visualization/Color filter, högermeny-cleanup, Split 2D/3D kvalitet & kamerahöjd & selektion, kamerasync efter planbyten, och 2D klickbarhet.

---

### 1. Insights Drawer — ta bort KPI-kort + draggable avskiljare

**Fil:** `src/components/insights/BuildingInsightsView.tsx`
- Det finns redan en `drawerMode`-prop. Dölja KPI-kortraden (Floor/Rooms/Assets/Area/Energy/Rating) när `drawerMode === true`.

**Fil:** `src/components/viewer/InsightsDrawerPanel.tsx`
- Byt ut den fasta `height: 400px` till en resize-handle som gör panelen draggbar uppåt/nedåt.
- Implementera en `mousedown`-handler på headern/avskiljaren som uppdaterar höjden via `mousemove`.

---

### 2. Properties — visa fler egenskaper (BIM propertySets)

**Fil:** `src/components/common/UniversalPropertiesDialog.tsx`
- Problemet: när auto-create sker (objekt saknar databas-rad), hämtas BIM-metadata med `propertySets` och sparas i `bimFallbackData`, men efter att asset-raden skapats visas bara de fält som matchar `allProperties`-logiken (system, local, area, user-defined). BIM:s `propertySets` (Pset_WallCommon, BaseQuantities etc.) kopieras inte in i `attributes`.
- Fix: efter auto-create, spara BIM `propertySets` i assets `attributes` JSONB-kolumnen så att de dyker upp i `user-defined`-sektionen.
- Alternativt: om `bimFallbackData` har data OCH assets finns, visa bimFallbackData som en extra "BIM Properties"-sektion (read-only) under de andra sektionerna.

---

### 3. Properties — responsivitet + stängknapp + auto-uppdatering

**Fil:** `src/components/common/UniversalPropertiesDialog.tsx`
- **Radbrytningar:** Ändra `break-all` → `truncate` eller `whitespace-nowrap overflow-hidden text-ellipsis` på värden.
- **Font-stil:** Ta bort `font-mono` från numeriska värden.
- **Stängknapp:** Finns redan (`X`-knapp i header). Verifiera att den alltid syns (den gör den — rad 1447).
- **Auto-uppdatering vid ny selektion:** Finns redan via `isPinned`-prop. Säkerställ att pinned-läget är aktiverat som default eller att dialogen reagerar på `VIEWER_SELECT_ENTITY`-events oavsett pinned-status.

---

### 4. Room Visualization → "Color filter" + toggle-logik

**Fil:** `src/components/viewer/ViewerRightPanel.tsx`
- Byt label från "Room Visualization" till "Color filter".
- Gör sektionen collapsible (den är redan manuellt collapsible med `roomVizOpen` state).
- Den nuvarande listan visar items men klick verkar inte fungera. Undersök: `RoomVisualizationPanel` embedded=true lyssnar på `VISUALIZATION_QUICK_SELECT_EVENT`. Men om den är i `hidden`-div så kan den missa events? Nej — `hidden` via CSS döljer bara, JS kör fortfarande.
- Problem troligen: visualiseringen kräver att "Show spaces" aktiveras, och panelen försöker köra `onShowSpaces` men referensen saknas. Kolla att `onShowSpaces={onShowSpacesChange}` faktiskt triggar rätt.
- Lägg till toggle-beteende: klicka en gång = tänd, klicka igen = släck.

**Fil:** `src/components/viewer/VisualizationToolbar.tsx`  
- Byt "Room Visualization" → "Color filter" i mobilmenyn också om den finns.

---

### 5. Högermeny — ta bort X-ray, 2D/3D toggle, flytta Settings sist

**Fil:** `src/components/viewer/ViewerRightPanel.tsx`
- X-ray: redan borttagen (rad 611 kommentar).
- **2D/3D toggle:** Ta bort switchen under Display-sektionen (rad 587-596).
- **Settings:** Redan längst ner (rad 791-918). Verifierat OK.

---

### 6. Split 2D/3D — högre grafikkvalitet

**Fil:** `src/components/viewer/SplitPlanView.tsx`
- `width`-beräkningen (rad 413): desktop max är `6000`. Kontrollera att `container.clientWidth * 4` ger tillräckligt högt värde. Om split-panelen bara är ~50% bred → `clientWidth` ≈ 580 → `580 * 4 = 2320`. Det kan vara lågt.
- Öka multiplikatorn till `5` eller sätt min `3000` för desktop split.

---

### 7. Split 2D/3D — kamerahöjd i 3D (2m)

**Fil:** `src/pages/UnifiedViewer.tsx` (rad 140-145)
- Ändra `floorY + 1.5` → `floorY + 2.0` i split-navigate-handlern.

**Fil:** `src/components/viewer/SplitPlanView.tsx` (rad 965-967)
- Ändra `floorY + 1.5` → `floorY + 2.0` i standalone click handler.

---

### 8. Split 2D/3D — ingen auto-selektion i 3D vid 2D-klick

**Fil:** `src/components/viewer/SplitPlanView.tsx`
- När `isSplitMode === true`, hoppa över entity-selection (rad 884-901). Redan idag dispatchar den `VIEWER_SELECT_ENTITY` och sätter `entity.selected = true`. Villkora detta med `!isSplitMode`.

---

### 9. Split 2D/3D — kamerasync slutar efter våningsbyten

**Fil:** `src/components/viewer/SplitPlanView.tsx`
- Kamera-uppdateringen (rad 647-719) beror på `storeyMap` (dess `storeyId`). När man byter våning regenereras kartan med nytt `storeyId` → `worldPosToStoreyMap` använder rätt storey → kameran borde fortsätta följa.
- Problemet kan vara att `_textureData`-felet (från console logs) kraschar uppdateringen. Loggen visar `DTXTrianglesLayer._subPortionSetOffset` — detta är en xeokit-bug vid `setOffset` efter modellförstöring.
- Trolig orsak: `setOffset` anropas på en redan förstörd modell. Wrappa `updateCamera`-funktionen i try-catch så att felet inte stoppar intervallet.

---

### 10. Ren 2D — förbättra klickbarhet

**Fil:** `src/components/viewer/SplitPlanView.tsx`
- `pickStoreyMap` är en pixel-baserad pick mot rasterbilden. Om objektet är litet eller om rum/space-objekten har låg opacity/kontrast missar picken.
- Öka 2D-kartans upplösning (samma som punkt 6).
- Alternativt: om rum-entities inte har `visible = true` under pick-time (de sätts till opacity 0.5 och visible=true under rendering, men återställs efteråt), kan pick missa dem. Lösning: vid klick, temporärt sätta spaces visible+pickable innan `pickStoreyMap`.

---

### Sammanfattning av filändringar

| Fil | Ändringar |
|-----|-----------|
| `BuildingInsightsView.tsx` | Dölja KPI-kort i `drawerMode` |
| `InsightsDrawerPanel.tsx` | Draggable resize-handle istället för fast höjd |
| `UniversalPropertiesDialog.tsx` | Visa BIM propertySets, fixa responsivitet (truncate, ta bort font-mono), auto-uppdatering |
| `ViewerRightPanel.tsx` | Byt "Room Visualization" → "Color filter", ta bort 2D/3D toggle |
| `SplitPlanView.tsx` | Höjd 2m, högre upplösning, skippa selektion i split-mode, try-catch i camera-sync, förbättra pick |
| `UnifiedViewer.tsx` | Kamerahöjd 2m i split-navigate |

