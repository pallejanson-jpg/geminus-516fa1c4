
Mål (utifrån din feedback)
1) Kartposition per byggnad: Under “Map Position” ska en karta visas där man klickar ut positionen → spara latitude/longitude.
2) Rumsvisualisering: Den ska alltid hitta rätt rum (alla rum när alla våningsplan visas, annars bara rum på valda plan) och den ska vara snabb. “Visa rum”-sliden ska alltid vara aktiv när man jobbar med rumsvisualisering.
3) Namngivning: Våningsplan och BIM-modeller visar ofta fel namn → ska bli stabilt och konsekvent.
4) 2D/3D + klippning: Sax/klippning ska synas och vara aktivt användbar. Klippning ska fungera i 3D (taknivå mellan våningar för att klippa “felritade” objekt) och i 2D (planritning med justerbar klipphöjd). En kontroll i Visningsmenyn ska kunna styra 2D/3D samt klipphöjd.

------------------------------------------------------------
A) Kartposition för byggnad – klicka på karta och spara lat/lng
Problem i nuläget
- FacilityLandingPage har fält för latitude/longitude som man skriver in manuellt.
- MapView visar byggnader på “fejkade” koordinater (NORDIC_CITIES + random), och använder inte sparade koordinater från building_settings.

Lösning
A1. Bygg en “Map picker” i Building Settings (FacilityLandingPage)
- I sektionen “Map Position” ersätter vi (eller kompletterar) numeriska inputs med en liten karta (t.ex. 240px hög).
- Kartan:
  - Hämtar Mapbox-token via befintlig backend-funktion (samma strategi som MapView).
  - Visar en marker om building_settings redan har lat/lng.
  - Klick på kartan sätter “pending” lat/lng och flyttar markern direkt.
  - Knapp “Spara position” sparar via updateMapPosition(lat,lng).
  - Extra: knapp “Använd min position” (valfritt) kan använda GeolocateControl om du vill.

A2. Gör så att MapView faktiskt använder sparade koordinater
- Vid rendering av mapFacilities:
  - Hämta building_settings för alla byggnader (en query med select fm_guid, latitude, longitude).
  - För varje building:
    - Om lat/lng finns → använd dem.
    - Annars fallback till dagens “NORDIC_CITIES”-logik (så inget blir “utan position”).
- Resultat: När du klickar ut position i building settings syns det direkt i kartvyn.

Filer som berörs
- src/components/portfolio/FacilityLandingPage.tsx (UI: karta + klick-to-set + save)
- src/components/map/MapView.tsx (använd sparade coords från building_settings)
- (ev. ny liten komponent, t.ex. src/components/map/BuildingMapPicker.tsx för återanvändning)

------------------------------------------------------------
B) Rumsvisualisering – varför 0 rum ibland + prestanda
Observationer i koden (nuvarande)
- RoomVisualizationPanel hämtar rum via databasen (assets) och filtrerar sedan på visibleFloorFmGuids.
- visibleFloorFmGuids kommer från FloorVisibilitySelector och baseras på metaObject.originalSystemId/metaObject.id. I vissa modeller matchar detta inte DB:s level_fm_guid → filter kan bli “0 rum” även om det finns rum.
- Prestanda: applyVisualization loopar igenom alla rum och gör getItemsByPropertyValue('fmguid', ...) per rum. Detta är väldigt dyrt när rum är många.

Mål-beteende (som du beskriver)
- Om alla våningsplan är aktiva → hitta alla rum.
- Om ett enstaka plan väljs → bara rum på det planet.
- Kännas lika snabbt som Portfolio/Navigator.

Lösning – två delar: Stabil “hitta rum” + snabb “färga rum”
B1. Sluta fråga databasen i RoomVisualizationPanel – använd redan laddad allData
- Portfolio/Navigator är snabba eftersom de använder AppContext.allData (in-memory).
- Vi gör samma i RoomVisualizationPanel:
  - Hämta allData via AppContext direkt i komponenten.
  - rooms = allData.filter(category === 'Space' && buildingFmGuid matchar) och sedan filter på levelFmGuid när visibleFloorFmGuids finns.
- Detta tar bort:
  - risk för query-limit
  - nät/DB-latens
  - “ibland 0 rum” pga query timing
- Viktigt: byggnads-ID måste vara korrekt (se B2).

B2. Säkerställ att “buildingFmGuid” alltid är byggnadens guid i viewer-sammanhang
- I AssetPlusViewer sätts buildingFmGuid = assetData?.buildingFmGuid || assetData?.fmGuid.
- Om man öppnar viewer från ett plan/rum där buildingFmGuid saknas i datat → faller det tillbaka till fel guid → 0 rum, fel modellnamn etc.
- Åtgärd:
  - Införa en “resolveBuildingFmGuid(fmGuid)” i AssetPlusViewer:
    - Om assetData.category === 'Building' → fmGuid
    - Else om assetData.buildingFmGuid finns → den
    - Else fallback: försök härleda via allData/navigatorTreeData (t.ex. hitta Building Storey/Space och dess buildingFmGuid)
    - Sista fallback: (om behövs) en liten DB lookup på assets för just den fm_guid för att läsa building_fm_guid
- Alla viewer-subsystem (RoomVisualizationPanel, FloorVisibilitySelector, ModelVisibilitySelector) ska använda den resolved byggnads-guiden.

B3. Gör floor-filter robust: visibleFloorFmGuids måste vara DB:ns level_fm_guid-värden
- FloorVisibilitySelector bygger databaseLevelFmGuids utifrån metaScene. Det är här mismatchen ofta uppstår.
- Vi förbättrar mappingen:
  - Bygg en lookup från DB-storeys (assets där category='Building Storey' och building_fm_guid=byggnaden):
    - normalizedName → [storeyFmGuid...]
    - displayName från common_name/name
  - När vi extraherar metaScene floors:
    - normalisera metaObject.name
    - matcha mot DB lookup
    - om match finns:
      - använd DB displayName (så UI-namnet blir rätt)
      - och fyll databaseLevelFmGuids med de DB-guids som matchar
    - annars fallback till nuvarande logik
- Resultat:
  - “Våningsplan”-listan får stabila och rätta namn.
  - visibleFloorFmGuids blir rätt nivå-id för rooms-filter → rumsvisualisering hittar rätt.

B4. Prestanda: bygg en index-map för rum→objektIds en gång, inte per rum
- Nu: getItemsByPropertyValue per rum (dyrt).
- Ny strategi:
  - Bygg en cache när panelen öppnas / när viewer är redo:
    - Gå igenom metaScene.metaObjects, plocka IfcSpace metaobjekt
    - använd originalSystemId (fmGuid) som nyckel
    - samla deras “child object ids” via en childrenMap (samma optimering som FloorVisibilitySelector redan använder)
    - skapa Map<fmGuidLower, string[]> med alla entity ids i scene som hör till rummet
  - När man färgar:
    - slå upp entity ids i map och sätt colorize/opacity direkt (utan property-sök)
  - Kör färgningen i batchar med requestIdleCallback eller chunking (t.ex. 50 rum per frame) för att inte frysa UI.
  - När våningsfilter ändras: färga om endast de rum som påverkas.

B5. “Visa rum” ska alltid vara aktiverad när rumsvisualisering används
Nuvarande problem
- VisualizationToolbar äger showSpaces-state och default är OFF.
- RoomVisualizationPanel försöker “auto-activate” mot viewerRef, men den kan inte tvinga UI-switchen att bli ON eftersom AssetPlusViewer inte skickar onShowSpaces.

Åtgärd
- Gör en tydlig koppling mellan “Rumsvisualisering öppnas” och “Visa rum = ON”:
  Alternativ 1 (enkel och robust):
  - Lyft showSpaces-state till AssetPlusViewer och gör VisualizationToolbar kontrollerad (props).
  - När showVisualizationPanel = true → setShowSpaces(true) och disable toggling OFF medan panelen är öppen.
  Alternativ 2 (event-baserad):
  - Inför ett custom event t.ex. FORCE_SHOW_SPACES_EVENT som VisualizationToolbar lyssnar på.
  - RoomVisualizationPanel dispatchar event vid mount.
- Jag rekommenderar alternativ 1 eftersom det blir enklare att hålla UI i sync och undvika “lägen som glider isär”.

Filer som berörs
- src/components/viewer/AssetPlusViewer.tsx (resolveBuildingFmGuid, lyfta showSpaces-state, skicka props)
- src/components/viewer/RoomVisualizationPanel.tsx (använd allData, robust filter, cache/index, batch-colorize)
- src/components/viewer/FloorVisibilitySelector.tsx (robust DB-name mapping + korrekta databaseLevelFmGuids)
- src/components/viewer/VisualizationToolbar.tsx (showSpaces styrs externt eller via event + låsning när rumsvisualisering är aktiv)

------------------------------------------------------------
C) Namngivning på BIM-modeller (ofta fel)
Rotorsaker i nuläget
- ModelVisibilitySelector bygger friendlyName via matchning mellan viewer.scene.models keys och en nameMap från xkt_models/Asset+ GetModels.
- Men den använder ibland model.id före sceneModels-key. Om model.id inte representerar filnamn/guid korrekt → matchningen blir fel → fel namn visas.

Lösning
C1. Förbättra “rawName”/match-strategi i ModelVisibilitySelector
- Prioritera alltid sceneModels-key (modelId från Object.entries(sceneModels)) som primär identifierare.
- Använd model.id endast som sekundär fallback.
- Förbättra matchning:
  - matcha både med/utan .xkt
  - matcha guid-substring om key innehåller extra prefix/suffix
- Säkerställ att buildingFmGuid som används för xkt_models-query är resolved building guid (från B2), annars hämtas namn från fel building eller inte alls.

Filer som berörs
- src/components/viewer/ModelVisibilitySelector.tsx
- src/components/viewer/AssetPlusViewer.tsx (skicka korrekt buildingFmGuid till selectors)

------------------------------------------------------------
D) 2D/3D + klippning (sax) – synlighet och funktion i både 3D och 2D
Problem i nuläget
- “Sax” finns i FloorVisibilitySelector-header, men i Visningsmenyn används listOnly=true i SidePopPanel → header renderas inte → sax-knappen syns inte → clippingEnabled är alltid false.
- 2D-klipphöjd-slider visas bara när ViewerToolbar redan är i 2D och har dispatchat VIEW_MODE_CHANGED_EVENT.
- När man öppnar “2D” från Navigator/QuickActions får man bara toast “växla i verktygsfältet” → 2D blir inte aktivt automatiskt → upplevs som att 2D/klippning “inte fungerar”.

Lösning
D1. Gör sax/klippning synlig i SidePopPanel (Våningsplan)
- Uppdatera SidePopPanel så den kan ta emot “headerActions” (t.ex. en Scissors-knapp).
- Lägg klippknappen i SidePopPanel-header för Våningsplan, så den alltid syns även i listOnly-läge.
- Wire:a knappen till FloorVisibilitySelector:
  - Antingen via props: externalClippingEnabled + onToggleClipping
  - Eller genom att låta FloorVisibilitySelector i listOnly-mode rendera en liten topp-rad med sax (enklast: ny prop showHeaderInListOnly / showClippingToggle)

D2. Lägg “2D/3D” kontroll i Visningsmenyn (under “Visa”)
- Lägg till en Switch “2D plan” i VisualizationToolbar under “Visa”.
- När användaren slår på:
  - begär ViewMode=2D i ViewerToolbar (se D3)
  - se till att klippning för 2D är aktiv (floor plan clipping)
- När användaren slår av:
  - begär ViewMode=3D

D3. Inför en styrkanal för att byta viewMode från andra delar av UI
- Skapa ett nytt custom event, t.ex. VIEW_MODE_REQUESTED_EVENT (separat från VIEW_MODE_CHANGED_EVENT som är “status”).
- ViewerToolbar lyssnar på VIEW_MODE_REQUESTED_EVENT och kör handleViewModeChange('2d'|'3d').

D4. När man öppnar 2D från Navigator/QuickActions: starta i 2D direkt + välj rätt våningsplan
- Utöka AppContext med:
  - viewerInitialMode: '2d' | '3d' | null
  - viewerInitialFloorFmGuid: string | null (DB storey fm_guid)
- När Navigator “2D”-ikon klickas:
  - sätt viewerInitialMode='2d'
  - viewer3dFmGuid = storey.fmGuid
- I AssetPlusViewer:
  - om assetData är Building Storey → initialFloorFmGuid = assetData.fmGuid
  - om assetData är Space → initialFloorFmGuid = assetData.levelFmGuid
- Uppdatera FloorVisibilitySelector:
  - ta prop initialFloorFmGuid
  - när floors extraherats: auto-solo den floor-grupp som matchar initialFloorFmGuid (via databaseLevelFmGuids)
  - dispatcha FLOOR_SELECTION_CHANGED_EVENT så ViewerToolbar får currentFloorId och kan applicera applyFloorPlanClipping korrekt
- Resultat: 2D öppnas “på rätt sätt” och klippningen blir aktiv direkt.

D5. Klipphöjd
- 2D: behåll slider 0.5–2.5m (finns redan), men säkerställ att den alltid syns när 2D är aktivt (oavsett om 2D aktiverats från botten-toolbar eller visningsmeny).
- 3D: tak-klippning mellan storeys ska vara “på/av” (sax) och inte styras av slider (som du önskar). Den använder storey bounds (minY/maxY) vilket useSectionPlaneClipping redan gör.

Filer som berörs
- src/components/viewer/SidePopPanel.tsx (headerActions)
- src/components/viewer/VisualizationToolbar.tsx (2D/3D switch, koppla till event, visa/håll slider logik)
- src/components/viewer/ViewerToolbar.tsx (lyssna på VIEW_MODE_REQUESTED_EVENT)
- src/components/viewer/FloorVisibilitySelector.tsx (clipping toggle tillgänglig även i listOnly + initialFloorFmGuid auto-solo)
- src/context/AppContext.tsx (viewerInitialMode + viewerInitialFloorFmGuid)
- src/components/navigator/NavigatorView.tsx (Open2D ska faktiskt starta 2D, inte bara toast)
- src/components/portfolio/QuickActions.tsx (om 2D finns där: sätt initial mode)

------------------------------------------------------------
E) Test/validering – exakt vad vi ska verifiera
1) Map Position
- Öppna en byggnad → Building Settings → klicka på karta → spara → återöppna byggnaden och verifiera att markern ligger kvar.
- Öppna kartvyn → byggnaden ska ligga på sparad position.

2) Rumsvisualisering
- Öppna viewer på byggnad:
  - Alla våningsplan synliga → rumsvisualisering visar rum > 0 och färgning sker utan att UI fryser.
- Välj ett enskilt våningsplan:
  - rumsvisualisering hittar bara rum för detta plan (inte 0 pga mismatch).
- Växla mellan floors snabbt:
  - färgning ska ske snabbt och stabilt (chunking + cache).
- “Visa rum”:
  - när rumsvisualisering är ON ska “Visa rum” vara ON och inte gå att råka stänga av (eller auto-sättas tillbaka).

3) Namn
- Våningsplan: listan ska visa common_name/name från databasen, inte GUID.
- BIM-modeller: namnen ska matcha model_name från xkt_models/Asset+ GetModels.

4) 2D/3D + klippning
- I Visningsmenyn:
  - 2D-switch slår på 2D direkt, och klipphöjd fungerar.
  - Sax-knapp för 3D-klippning syns i Våningsplan panelen.
- Från Navigator 2D-ikon:
  - viewer öppnar i 2D direkt på vald våning och klippning är aktiv.

------------------------------------------------------------
Leveransordning (för att minska risk och snabbt se förbättring)
1) Fix FloorVisibilitySelector (databaseLevelFmGuids + namn) + resolved buildingFmGuid i AssetPlusViewer
   - Detta bör direkt lösa “0 rum” och förbättra naming.
2) Refaktor RoomVisualizationPanel: använd allData + bygg cache för space→entity ids + chunked coloring
   - Detta ger stora prestandavinster.
3) Visa rum-låsning och UI-sync när rumsvisualisering är aktiv
4) 2D/3D switch i visningsmenyn + VIEW_MODE_REQUESTED_EVENT + initial 2D från Navigator/QuickActions
5) Map picker i building settings + MapView använder sparade coords

Tekniska risker / edge cases vi hanterar
- Om en modell saknar tydlig mapping mellan metaScene storey name och DB storey names:
  - fallback: visa metaObject.name men ändå låt floors fungera, samt logga mismatch.
- Om byggnadens buildingFmGuid saknas i datat:
  - fallback resolution + (om behövs) DB lookup för just den fm_guid.
- Om väldigt många rum (tusentals):
  - chunking + cache + möjlighet att auto-begränsa till valda våningar för bättre UX.

