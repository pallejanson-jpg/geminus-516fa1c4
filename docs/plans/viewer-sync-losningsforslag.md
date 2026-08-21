# Lösningsförslag: Synkroniserad Viewer (XEOkit + NavVis Ivion) för Geminus

**Underlag:** Genomgång av `C:\MDP\GEMINUS` (kod, Supabase-schema, edge functions) den 2026-08-20, samt research kring xeokit-sdk och NavVis IVION API.
**Syfte:** Ge ett konkret, genomförbart lösningsförslag för hur split-view-synken mellan XEOkit-vieweren (BIM/XKT) och Ivion-vieweren (360°) samt POI/annotationshanteringen kan byggas om från grunden med Claude Code, så att den blir robust, begriplig och underhållbar.

---

## 1. Sammanfattning

Geminus-koden är redan en fullvuxen, självdriven applikation (egen Node/Vite-build, egen Supabase-backend med ~65 migrationer och ~40 edge functions) — inte längre ett Lovable-utkast rent tekniskt. Men **viewer-synk-funktionen bär tydliga spår av att ha vuxit fram inkrementellt i Lovable**: samma problem (kamerasynk + POI) är löst på **två parallella, delvis motstridiga sätt**, det finns dubblerad SDK-livscykelkod, och flera nyckelfunktioner (t.ex. att spara en manuellt utpekad 3D-position för en annotation) är påbörjade men aldrig färdigställda.

De viktigaste fynden:

1. **Två separata kamerasynk-implementationer** finns samtidigt (`ViewerSyncContext`/Split View och `useVirtualTwinSync`/Virtual Twin), med duplicerad koordinat­transform-logik, olika trösklar och troligen en trasig länk till den nyare `NativeXeokitViewer`-komponenten.
2. **POI:er lever i NavVis Ivion**, speglas som fyra fält på `assets`-raden i Supabase (`ivion_poi_id`, `ivion_site_id`, `ivion_image_id`, `ivion_synced_at`) — det finns ingen egen POI-tabell och ingen realtidssynk, bara manuell polling var 3:e sekund när ett visst panel är öppet.
3. **"Icke-modellerad asset som ska visas som annotation"** är redan ett etablerat begrepp i datamodellen (`created_in_model = false`, `is_local = true`, `annotation_placed = true`) och används redan av både Ivion-POI-import och AI-scan-flödet — det är alltså inte ett nytt koncept, utan något som ska **göras konsekvent och realtidssynkat** snarare än uppfinnas från grunden.
4. Koordinattransformen mellan Ivion och BIM är en enkel offset+rotation (en akel), lagrad på `building_settings`, utan kalibrerings-UI — det räcker inte för byggnader som inte är perfekt i våg eller där Ivion-scanningen inte är axel­uppriktad mot BIM-modellen.
5. Både xeokit-sdk och NavVis Ivion SDK laddas som lösa scripttaggar/dynamiska imports, inte som versionshanterade npm-paket — det gör det svårt att veta vilken version som körs och svårt att dra nytta av TypeScript-typer.

Förslaget nedan beskriver en målarkitektur och en konkret, stegvis saneringsplan som är lagom stor att köra i faser med Claude Code, utan att du behöver kasta bort det som redan fungerar (BIM-laddning, XKT-cache, Ivion-inloggning, AI-scan-pipeline).

---

## 2. Nulägesanalys

### 2.1 Kamerasynk idag

**Väg A — Split View (`ViewerSyncContext.tsx`, `useViewerCameraSync.ts`, `useIvionCameraSync.ts`)**

- Delad React-context med state `{ position, heading, pitch, source: '3d' | 'ivion' | null, timestamp }`. Vem som "äger" kameran avgörs av vem som senast skrev (`updateFrom3D()` / `updateFromIvion()`) — inte en fast master/slave-modell.
- **XEOkit → Ivion:** lyssnar på xeokit-kamerans `viewMatrix`-ändringar, räknar om till heading/pitch, broadcastar throttlat (200 ms).
- **Ivion → XEOkit:** **pollar** `getMainView().getImage()` + `currViewingDir` var 200:e ms (det finns inget dokumenterat "point-of-view changed"-event i NavVis IVION API — se avsnitt 4.3 — så polling är i grunden rätt val, men implementationen är dubblerad, se nästa punkt).
- Koordinattransform (`ivion-bim-transform.ts`): ren Y-rotation + XYZ-translation, hämtad från `building_settings.ivion_bim_offset_x/y/z` + `ivion_bim_rotation`. **Om transformen är identitet (0,0,0,0 — dvs. aldrig kalibrerad för byggnaden) stängs synken av helt, tyst, utan varning till användaren.**
- `findNearestImage()` söker närmaste cachade Ivion-bild inom en hårdkodad radie på 50 m, rakt euklidiskt avstånd inklusive Z — utan våningsfiltrering. I en byggnad med flera våningar ovanpå varandra kan detta hoppa till fel våning.

**Väg B — Virtual Twin (`useVirtualTwinSync.ts`)**

- Helt separat kodväg: Ivion driver alltid, XEOkit följer envägs. `requestAnimationFrame`-loop sätter `camera.eye/look/up/fov` direkt utan flyg-animation.
- Duplicerar koordinattransformen och Ivion-pollningen från väg A, men med annan pollnings­mekanism och andra trösklar (0,01 rad vs 0,05 rad).

**Strukturellt problem:** Båda vägarna hittar XEOkit-instansen via `viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer` — dvs. genom en äldre, Vue-baserad komponents `$refs`. Den nyare, rena React-komponenten `NativeXeokitViewer.tsx` exponerar istället `window.__nativeXeokitViewer`. `useVirtualTwinSync` har en fallback dit, men **`useViewerCameraSync` (Split View) har det inte** — vilket med stor sannolikhet betyder att **Split View-synken är trasig när den nyare native-vieweren används**, tyst, utan felmeddelande. Det här är sannolikt en stor del av "fungerar inte tillräckligt bra".

Övriga identifierade problem: delad (icke käll-specifik) debounce-timestamp kan tysta uppdateringar från fel håll; heading normaliseras inte konsekvent (kan ge vinklar utanför 0–360°); flera hårdkodade "safety timeout"-mönster (t.ex. tvinga `isSyncing=false` efter 2 s) tyder på tidigare observerade låsningar; ett globalt modul-lås i `ivion-sdk.ts` serialiserar alla SDK-laddningar.

### 2.2 POI/annotationshantering idag

- **Skapas i Ivion → upptäcks i Geminus:** `Ivion360View.tsx` pollar edge-funktionen `ivion-poi` (action `get-latest-poi`) var 3:e sekund, **men bara när registreringspanelen är öppen**. Nya POI-ID:n läggs i en kö och kräver att en människa manuellt kopplar dem till en Geminus-tillgång i `IvionRegistrationPanel`.
- **Skapas i Geminus → pushas till Ivion:** `ivion-poi`-funktionens `sync-asset`-action bygger en Ivion-POI från `asset.coordinate_x/y/z` och POST:ar den. Hanterar **bara skapande** — ingen uppdatering om asset redan har ett `ivion_poi_id` (kommentar i koden: "For now, just create new POIs").
- **Ingen realtidssynk åt något håll.** Allt är antingen manuell polling med mänsklig bekräftelse, eller ett enkelriktat en-gångs-anrop.
- **Visning i BIM-vyn är inkonsekvent:** två nästan identiska komponenter (`AnnotationCategoryList.tsx` och `AnnotationToggleMenu.tsx`) filtrerar `assets` på olika villkor och pratar med **olika xeokit-plugin-referenser** (`localAnnotationsPlugin` respektive `annotationsPlugin`) — klassisk copy-paste-drift som gör att annotationer kan se olika ut beroende på vilken UI-väg man använder.
- **3D-placering av en fristående annotation är påbörjad men inte kopplad:** `ViewerContext.tsx` har en `AnnotationPlacementContext` med `startAnnotationPlacement`/`completeAnnotationPlacement`, men `completeAnnotationPlacement` ignorerar de inskickade koordinaterna helt och sparar ingenting.

### 2.3 Datamodell idag (Supabase)

Det finns **ingen egen POI- eller panorama-tabell**. Allt hänger på `public.assets`:

```
assets:
  id, fm_guid, category, name, common_name
  building_fm_guid, level_fm_guid, in_room_fm_guid
  coordinate_x/y/z              -- 3D-position (BIM-koordinatsystem)
  moved_offset_x/y/z            -- manuell flytt, med modification_status
  symbol_id                      -- FK -> annotation_symbols (ikon/färg)
  annotation_placed (bool)
  annotation_model_id
  created_in_model (bool, default true)   -- FALSE = ej modellerad i BIM
  is_local (bool, default false)          -- TRUE = skapad lokalt, ej från källsystem
  ivion_poi_id, ivion_site_id, ivion_image_id, ivion_synced_at
  attributes (jsonb)
```

Koppling till faktisk BIM-geometri (xkt-entity) sker **inte** via ett fält på `assets`, utan via en separat tabell:

```
geometry_entity_map:
  building_fm_guid, asset_fm_guid, external_entity_id (xkt/IFC entity-id),
  model_id, storey_fm_guid, metadata (jsonb), last_seen_at
```

Frånvaron av en rad här för en given asset = "asset finns inte som 3D-geometri i BIM-modellen". Kombinerat med `created_in_model = false` har ni alltså **redan** det begrepp ni efterfrågar ("assets som inte är modellerade ska visas som annotation i båda vyer") — det används redan av AI-scan-pipelinen (`pending_detections` → godkänd → `assets` + Ivion-POI samtidigt) och av Ivion-POI-importen. Problemet är inte att begreppet saknas, utan att **rendering och synk av dessa annotationer är inkonsekvent och inte realtid** (se 2.2).

`building_settings` har den enda kalibreringen som finns mellan Ivion och BIM:

```
ivion_bim_offset_x/y/z (numeric, default 0)
ivion_bim_rotation (numeric, default 0)     -- enkel Y-axel-rotation
ivion_start_vlon/vlat
```

### 2.4 Bibliotek

- **xeokit-sdk**: inte ett npm-beroende. Laddas i `useXeokitInstance.ts` via `fetch('/lib/xeokit/xeokit-sdk.es.js')` → Blob URL → dynamisk `import()`. Version okänd utan att öppna filen. Enda relaterade npm-paketet är `@xeokit/xeokit-convert` (endast för IFC→XKT-konvertering).
- **NavVis Ivion SDK**: inte heller ett npm-beroende (trots att `navvis-ivion-11.9.8.tgz` ligger i projektroten och en kommentar i koden hävdar att paketet importeras). Laddas via tre fallback-vägar: lokal UMD-bundle → scripttag mot kundens Ivion-instans → CORS-proxy edge function.
- Enligt NavVis IVION API-referensen (v11.8.0, `MainViewInterface`) finns metoder som `updateOrientation()`, `centerOn()`, `getCamera()`, `updateFov()`/`getFov()`, `getImage()`, `getPoiLayer()` — men **inget dokumenterat "point-of-view changed"-event**. Det bekräftar att er nuvarande pollning inte är ett misstag i sig, bara att den bör konsolideras till en enda, korrekt implementerad plats. [MainViewInterface](https://ivion-api.docs.navvis.com/v11.8.0/reference/interfaces/mainviewinterface) · [PoiInterface](https://ivion-api.docs.navvis.com/v10.3.2/reference/interfaces/poiinterface) · [NavVis IVION API-introduktion](https://knowledge.navvis.com/docs/navvis-ivion-api-documentation)
- xeokit-sdk:s `AnnotationsPlugin` (positionerade 2D-markörer ovanpå 3D-scenen, med `occludable`, `markerShown`/`labelShown`, klick-events) är rätt verktyg för BIM-sidans annotationer av icke-modellerade assets. Aktuell officiell dokumentation har flyttat till xeokits Notion-sajt; API:t i er kod (`localAnnotationsPlugin`/`annotationsPlugin`) matchar det klassiska `AnnotationsPlugin`-mönstret (`plugin.createAnnotation({id, worldPos, occludable, markerShown, labelShown, ...})`).

---

## 3. Målbild

1. **En (1) sanning för kameratillstånd**, inte två parallella synk-vägar. Split View och Virtual Twin ska dela samma underliggande synk-motor.
2. **Bidirektionell, realtidsnära synk**: navigerar man i XEOkit ska Ivion följa inom en videobildruta eller två, och tvärtom — utan att man behöver ha ett visst UI-panel öppet.
3. **POI:er och icke-modellerade assets är samma sak i datamodellen**, med ett enda skapandeflöde oavsett om man klickar i XEOkit-vyn, i Ivion-vyn, eller importerar via AI-scan — och de dyker upp i **båda** viewers automatiskt, utan manuell "godkänn"-fördröjning för det som redan är en etablerad regel (mänsklig granskning kan fortsatt krävas för AI-scan-detektioner, det är rimligt att behålla).
4. **Kalibreringen mellan Ivion och BIM är en synlig, redigerbar funktion i appen** (inte en rad i en databastabell man redigerar manuellt), med stöd för fler än en akel-offset om det visar sig nödvändigt.
5. **xeokit-sdk och Ivion SDK hanteras som riktiga, versionerade beroenden** där det är praktiskt möjligt, så Claude Code (och TypeScript) kan resonera om API-ytan istället för att gissa via `any`.
6. Din egen Node.js-server får en tydlig roll: **realtids-relä för synk-events + POI-skrivningar**, och ett ställe att lägga tyngre serverlogik som idag ligger utspridd i Supabase Edge Functions, om/när ni vill äga den delen själva istället för att vara låsta till Supabase.

---

## 4. Föreslagen arkitektur

### 4.1 Övergripande princip

Bygg en **enda synk-motor** (`viewer-sync` — kan vara en ren TS-modul, inte en React Context, så den är testbar utan DOM) som håller ett litet, uttömmande state:

```ts
type ViewerSyncState = {
  camera: { position: Vec3; headingDeg: number; pitchDeg: number; fovDeg: number };
  activeFloorId: string | null;
  source: 'xeokit' | 'ivion' | 'remote' | null;   // vem orsakade senaste ändringen
  seq: number;                                      // monotont sekvensnummer, inte bara timestamp
};
```

Två tunna adaptrar pratar med motorn:

- `XeokitSyncAdapter` — lyssnar på xeokit-kamerans events, skriver till motorn; lyssnar på motorn, flyger xeokit-kameran (med `CameraFlightAnimation`, avbrytbar).
- `IvionSyncAdapter` — pollar Ivion (det finns inget bättre val enligt API-dokumentationen ovan, men **på ett ställe, med en klocka**), skriver till motorn; lyssnar på motorn, anropar `updateOrientation()`/`centerOn()`/`updateFov()`.

Genom att ha **ett** sekvensnummer istället för en delad timestamp för debounce, försvinner race-conditionen där ena hållets uppdatering kan tysta det andra hållets (fynd #5 i tabellen i avsnitt 2). Genom att göra motorn floor-medveten (`activeFloorId`) kan `findNearestImage` filtrera på våning istället för att bara titta på euklidiskt avstånd (fynd #7).

Både Split View-sidan och Virtual Twin-sidan använder **samma** motor och adaptrar — Virtual Twin blir bara ett UI-läge där Ivion-adaptern är den enda som skriver (source alltid `'ivion'`), inte en helt egen kodväg.

```mermaid
flowchart LR
  subgraph Klient A (webbläsare)
    X1[XEOkit-viewer] <--> SM1[viewer-sync engine]
    I1[Ivion-viewer] <--> SM1
    SM1 <--> WS1[WebSocket-klient]
  end
  subgraph Din Node.js-server
    WSS[WebSocket / realtidsrelä]
    API[REST/API-lager]
  end
  subgraph Supabase
    DB[(assets / geometry_entity_map / poi)]
    RT[Realtime]
  end
  WS1 <--> WSS
  WSS <--> API
  API <--> DB
  DB --> RT --> API
```

### 4.2 Rollen för din egen Node.js-server

Idag ligger nästan all serverlogik i Supabase Edge Functions (bra för CRUD och Ivion-proxy, men Edge Functions är stateless och passar dåligt för "håll ett litet delat state per session och pusha ut det till alla anslutna klienter direkt"). Föreslagen uppdelning:

- **Behåll i Supabase**: datalagring (Postgres), RLS, autentisering, tunga engångsjobb (IFC→XKT-konvertering, AI-scan), samt ren CRUD mot Ivion (`ivion-poi`-funktionens create/update/get-mot-Ivion-API, eftersom den redan fungerar och inte är prestandakänslig).
- **Flytta till din Node.js-server**:
  - En **WebSocket-hubb** (t.ex. med `ws` eller Socket.IO) som håller `ViewerSyncState` per aktiv "visningssession" (en användare med två öppna viewers, eller flera användare som tittar på samma byggnad tillsammans — det senare får ni på köpet). Klienterna skickar sina egna ändringar dit och får andras ändringar tillbaka, istället för att XEOkit och Ivion pratar direkt med varandra i samma flik via React Context (vilket också löser problemet att synken idag är beroende av att båda viewers lever i exakt samma React-träd/`$refs`-kedja).
  - Ett **litet API-lager** som tar emot "ny POI/annotation skapad" (från endera vyn), skriver till Supabase (via service-role, precis som edge functions gör idag) och **broadcastar** den nya annotationen till alla anslutna klienter över samma WebSocket-hubb — detta är det som gör POI-synken snabb istället för 3-sekunders-polling.
  - Ni kan lyssna på **Supabase Realtime** (Postgres-ändringar på `assets`/den nya POI-tabellen, se 4.4) från er Node-server och vidarebefordra dem över WebSocket — då slipper klienterna prata med Supabase Realtime direkt, och ni har ett ställe att lägga affärslogik (t.ex. "skicka bara ut ändringar för byggnaden man faktiskt tittar på").

Detta är ett medvetet vanligt mönster (tunn realtidshubb ovanpå en "vanlig" databas) och ger er dessutom en naturlig plats att senare lägga multi-user-samarbete ("dela din vy med en kollega") om det blir intressant.

### 4.3 Kamerasynk-design (konkret)

1. **En enda plats äger xeokit-referensen.** Migrera bort från `$refs.AssetViewer.$refs.assetView.viewer`-mönstret helt till `window.__nativeXeokitViewer` (eller ännu hellre en riktig React context/ref som sätts av `NativeXeokitViewer.tsx` — undvik `window`-globaler där det går). Ta bort `GeminusPlusViewer`-vägen när ni bekräftat att `NativeXeokitViewer` täcker samma funktionalitet.
2. **En enda Ivion-pollning**, i `IvionSyncAdapter`, med ett konfigurerbart intervall (starta på 150–200 ms, mät faktisk NavVis-svarstid och justera). Eftersom NavVis IVION API inte dokumenterar ett change-event är polling rätt, men den ska bara finnas på ett ställe.
3. **Sekvensnummer istället för delad timestamp** för att avgöra "är detta en färsk uppdatering" — se 4.1.
4. **Normalisera heading konsekvent** (`((deg % 360) + 360) % 360`) på **alla** ställen där heading beräknas eller adderas/subtraheras — flytta detta in i själva transformfunktionen (`ivion-bim-transform.ts`) så det inte går att glömma på ett anropsställe.
5. **Floor-medveten `findNearestImage`**: filtrera Ivion-bildkandidater på `activeFloorId`/våningsintervall i Z innan ni räknar euklidiskt avstånd, inte bara en platt 50 m-radie.
6. **Synlig kalibreringsstatus**: om `isIdentityTransform(transform)` — visa en tydlig banderoll i UI ("Ivion och BIM är inte kalibrerade för den här byggnaden — synk avstängd") istället för att tyst göra ingenting. Länka direkt till kalibrerings-UI (se 4.6).
7. **Riktig avbrytbar flyg-animation**: använd xeokit `CameraFlightAnimation` med dess egen `.stop()`, och avbryt en pågående flygning om en ny synk-uppdatering kommer in innan den är klar, istället för nuvarande mönster med en frikopplad 2-sekunders säkerhets-timeout som kan race:a mot den riktiga callbacken.

### 4.4 POI/annotations-design

**Datamodell:** Inför en dedikerad tabell istället för att blanda in POI-fält direkt på `assets` (nuvarande fyra Ivion-fält på `assets` blir kvar för bakåtkompatibilitet men läses/skrivs bara av en ny tjänst):

```sql
create table public.poi_annotations (
  id uuid primary key default gen_random_uuid(),
  building_fm_guid text not null,
  asset_fm_guid text references public.assets(fm_guid),  -- nullable: en annotation kan skapas innan en asset finns
  label text,
  category text,
  symbol_id integer references public.annotation_symbols(id),

  -- position i BIM-koordinatsystem (source of truth)
  position_x numeric not null,
  position_y numeric not null,
  position_z numeric not null,

  -- var den syns
  visible_in_xeokit boolean not null default true,
  visible_in_ivion boolean not null default true,

  -- Ivion-koppling (om den finns som POI där)
  ivion_poi_id bigint,
  ivion_site_id text,
  ivion_image_id bigint,

  created_by uuid references auth.users(id),
  created_via text not null default 'manual',  -- 'manual' | 'ivion_import' | 'ai_scan'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Detta gör explicit det som idag är implicit spritt över `assets.coordinate_x/y/z` + `annotation_placed` + `created_in_model` + fyra `ivion_*`-fält, och separerar "var sitter markören" (alltid i BIM-koordinater, en sanning) från "är den kopplad till en riktig tillgång". En asset med `created_in_model = false` och ingen rad i `geometry_entity_map` pekar till en `poi_annotations`-rad; en asset som redan har 3D-geometri kan också ha en `poi_annotations`-rad om ni vill visa en etikett/ikon ovanpå geometrin.

**Flöde vid skapande (samma kodväg oavsett håll):**

1. Klicka i XEOkit-vyn på tom yta (pick mot en osynlig plansection eller `worldPos` från pick-eventet) **eller** skapa en POI i Ivion-vyn.
2. Klienten postar till Node-serverns API (`POST /annotations`) med `{ buildingFmGuid, positionBim, label, category, assetFmGuid? }`.
3. Servern: (a) skriver raden i `poi_annotations`, (b) om `visible_in_ivion`, räknar om `positionBim` → Ivion-koordinater via samma transform som kameran använder och anropar `ivion-poi`-funktionens `create-poi`/`sync-asset`-logik (flytta den logiken hit, eller anropa Supabase-funktionen server-till-server), (c) broadcastar den nya annotationen via WebSocket-hubben till alla klienter som tittar på den byggnaden.
4. Båda öppna viewers tar emot broadcasten och ritar ut annotationen direkt — ingen 3-sekunders polling, inget krav på att ett visst UI-panel är öppet.

Detta ersätter dagens `Ivion360View.tsx`-polling och den manuella `IvionRegistrationPanel`-bekräftelsen **för det generella fallet**. Behåll gärna ett granskningssteg specifikt för AI-scan-detektioner (`pending_detections`), eftersom det har ett annat syfte (kvalitetskontroll av osäkra AI-träffar) — men koppla det till samma `poi_annotations`-tabell när det godkänns, istället för att skapa en parallell datastig.

**Rendering — städa annotationskomponenterna:** Slå ihop `AnnotationCategoryList.tsx` och `AnnotationToggleMenu.tsx` till en komponent med en gemensam filterfunktion och **en** xeokit-pluginreferens. Bestäm om ni vill använda `AnnotationsPlugin` (enklast, inbyggd i xeokit-sdk) rakt av, eller fortsätta med er egen `localAnnotationsPlugin`-wrapper — men ha bara en.

**Färdigställ 3D-placering:** Koppla `completeAnnotationPlacement(coordinates)` i `ViewerContext.tsx` till samma `POST /annotations`-anrop som beskrivs ovan, så den faktiskt sparar något — idag kastas koordinaterna bort.

### 4.5 Icke-modellerade assets som annotationer i båda vyer

Med `poi_annotations`-tabellen ovan blir detta en ren renderingsfråga i respektive viewer, inte en specialhantering:

- **XEOkit:** för varje `poi_annotations`-rad med `visible_in_xeokit = true`, skapa en `Annotation` på `position_x/y/z` (redan i BIM-koordinater — inget att transformera). Klick öppnar samma detaljpanel som en vanlig asset.
- **Ivion:** för varje rad med `visible_in_ivion = true` och ett `ivion_poi_id`, låt Ivions egen POI-lager rendera den (det är redan Ivions ansvar när en POI finns där) — er kod behöver bara se till att POI:n faktiskt skapades i Ivion när annotationen skapades (steg 3b i flödet ovan). Assets som **har** BIM-geometri (finns i `geometry_entity_map`) men **saknar** en Ivion-POI kan med fördel också få en genererad POI, så de syns i 360-vyn också — detta är i praktiken samma "sync-asset"-anrop som redan finns i `ivion-poi`-funktionen, bara triggat automatiskt istället för manuellt och med stöd för uppdatering (inte bara skapande, se fynd i 2.2).

### 4.6 Kalibrering (multi-point alignment)

Bygg en enkel kalibrerings-vy: användaren väljer 2–3 motsvarande punkter i XEOkit-vyn och i Ivion-vyn (samma metod som `AlignmentPanel.tsx`/`AlignmentPointPicker.tsx` redan använder för annat — återanvänd om möjligt), och räkna ut en similaritetstransform (rotation + translation, ev. skala) istället för att förvänta sig att någon manuellt matar in siffror i `building_settings`. Spara resultatet i samma `ivion_bim_*`-kolumner (eller bredda till en 4x4-matris om en enkel Y-rotation visar sig otillräcklig för vissa byggnader) och visa transformens "kvalitet" (RMS-fel över kalibreringspunkterna) i UI.

---

## 5. Datamodelländringar — sammanfattning

| Ändring | Typ | Anledning |
|---|---|---|
| Ny tabell `poi_annotations` | Ny tabell | Separera "var sitter markören" från asset/Ivion-koppling; en sanning för position |
| `poi_annotations.ivion_poi_id/site_id/image_id` | Ny | Ersätter successivt motsvarande fält på `assets` för nya annotationer |
| Behåll `assets.created_in_model`, `is_local`, `geometry_entity_map` | Oförändrat | Redan rätt modellerat, bara renderingen är inkonsekvent idag |
| Fixa unikt index i `geometry_entity_map` | Bugfix | `20260819120000`-migrationen bytte till en genererad kolumn `model_id_norm` — kontrollera att alla upsert-anrop i `geminus-plus-sync` faktiskt använder den nya on-conflict-målet, annars tystnar re-sync av entity-mappningar igen |
| Kalibreringskvalitet på `building_settings` | Ny kolumn (t.ex. `ivion_bim_calibration_rms`) | Ge UI något att visa/varna på |

---

## 6. Konkret saneringsplan (kör i faser med Claude Code)

**Fas 0 — Skyddsnät innan ni rör något**
- Skriv ett litet manuellt testprotokoll (eller Playwright-smoke-test) som verifierar dagens beteende i Split View och Virtual Twin, så ni har något att jämföra mot.
- Slå fast: används `GeminusPlusViewer`/Vue-wrappern fortfarande någonstans i produktion, eller kan `NativeXeokitViewer` anses vara den enda vägen framåt? Detta avgör hur radikalt ni kan sanera i Fas 1.

**Fas 1 — Konsolidera kamerasynk**
- Bygg `viewer-sync`-motorn (ren TS, enhetstestbar) enligt 4.1.
- Skriv `XeokitSyncAdapter` mot `window.__nativeXeokitViewer` (ta bort `$refs`-kedjan).
- Skriv `IvionSyncAdapter`, flytta all pollningslogik hit från `useIvionCameraSync.ts` och `useVirtualTwinSync.ts`.
- Låt `ViewerSyncContext`, `useViewerCameraSync`, `useIvionCameraSync`, `useVirtualTwinSync` bli tunna wrappers runt motorn, eller ta bort dem helt till förmån för direkta hook-anrop mot motorn.
- Flytta heading-normalisering in i `ivion-bim-transform.ts`.
- Lägg till floor-filtrering i `findNearestImage`.
- Lägg till den synliga "ej kalibrerad"-banderollen.

**Fas 2 — Node.js-realtidshubb**
- Bygg WebSocket-hubben på er egen server (rum per `buildingFmGuid`, enkel auth via samma Supabase-JWT ni redan använder).
- Byt `viewer-sync`-motorns transport från "ren lokal React-state" till "skicka/ta emot över WebSocket", så samma kod fungerar oavsett om de två vyerna är i samma flik eller (senare) hos två olika användare.

**Fas 3 — POI/annotationer**
- Skapa `poi_annotations`-tabellen och migrera in relevant historik från `assets` (rader med `created_in_model = false`).
- Bygg `POST /annotations` på Node-servern (steg i 4.4), inklusive anrop vidare till Ivion via befintlig `ivion-poi`-logik.
- Slå ihop `AnnotationCategoryList.tsx` + `AnnotationToggleMenu.tsx`.
- Koppla `completeAnnotationPlacement` till det nya API:et.
- Byt ut `Ivion360View.tsx`:s 3-sekunders polling mot att lyssna på WebSocket-broadcasten.
- Gör `ivion-poi`:s `sync-asset` idempotent (uppdatera om `ivion_poi_id` redan finns, inte bara skapa).

**Fas 4 — Kalibrerings-UI**
- Bygg multi-point-kalibrering enligt 4.6, återanvänd `AlignmentPointPicker.tsx` om det passar.

**Fas 5 — Städning av beroenden (kan göras parallellt, lägre prioritet)**
- Undersök om xeokit-sdk kan installeras som npm-paket (`npm install @xeokit/xeokit-sdk` eller motsvarande beroende på vilken major-version ni kör) istället för runtime-fetch av en statisk fil — ger er versionsspårning och bättre TypeScript-stöd.
- Konsolidera `useIvionSdk.ts` och den inbäddade kopian i `Ivion360View.tsx` till en enda SDK-livscykel-hook.

Varje fas är rimlig att köra som en egen, avgränsad session med Claude Code: peka på den här filen, be Claude Code läsa avsnitt 4 och den aktuella fasen i avsnitt 6, och jobba filvis. Eftersom motorn i Fas 1 är ren TS utan DOM-beroenden går den att enhetstesta direkt (ni har redan `vitest` konfigurerat i projektet), vilket gör det säkrare att låta Claude Code iterera på den utan att behöva klicka igenom UI:t för varje ändring.

---

## 7. Om övergången från Lovable

Ni behöver inte en stor "migreringsplan" i klassisk mening — koden ligger redan i ett vanligt Git-repo med egen Vite/Node-build och egen Supabase-backend, alltså är ni tekniskt sett redan flyttade. Det som återstår är processuellt:

- Om ni fortfarande redigerar filer via Lovables webbgränssnitt parallellt med Claude Code, **sluta med det för viewer-relaterade filer** så snart Fas 1 påbörjas — samtidig redigering från två håll är den vanligaste orsaken till att "det som fungerade igår slutade fungera idag" i den här typen av projekt. `.lovable`-mappen i repot tyder på att kopplingen fortfarande finns.
- Låt Claude Code äga refaktoreringen filvis (enligt faserna ovan) med vanliga commits, så ni har en tydlig historik att slå upp om något beter sig annorlunda.
- Behåll Lovable (om ni vill) för rena UI-ytor som inte rör synk/POI-logiken, om det är där ni fortfarande får värde av det — men själva viewer-synken bör ha en enda ägare (Claude Code + er egen kodbas) för att undvika att de två strategierna nämnda i avsnitt 2.1 (Split View vs Virtual Twin) triggades av just den typen av parallellt, inkrementellt arbete.

---

## 8. Öppna frågor att bestämma innan ni startar Fas 1

1. **Är Virtual Twin-läget (Ivion-driven, envägs) fortfarande en produktkrav**, eller kan det bli ett specialfall av samma synk-motor (source alltid `'ivion'`, ingen skrivning från XEOkit-sidan)? Påverkar hur mycket av `useVirtualTwinSync.ts` som kan tas bort helt.
2. **Används `GeminusPlusViewer`/Vue-wrappern fortfarande i produktion**, eller är `NativeXeokitViewer` redan den faktiska vägen för alla kunder? Avgör hur snabbt `$refs`-kedjan kan tas bort.
3. **Hur viktigt är multi-user (flera personer i samma viewer-session samtidigt) på kort sikt?** Påverkar hur mycket ni bör investera i WebSocket-hubben nu kontra att börja enklare med Supabase Realtime direkt mot klienterna och lägga till er egen hubb senare.
4. **Toleransnivå för Ivion-pollningsintervallet** (nuvarande 200 ms) — en snabbare polling ger snabbare synk men fler API-anrop mot Ivion; värt att mäta faktisk NavVis-svarstid innan ni bestämmer ett tal.

---

*Detta dokument är underlag för planering, inte en färdig implementation. Rekommenderad nästa steg: gå igenom avsnitt 8 tillsammans med den som byggde AI-scan-pipelinen (de känner redan till `pending_detections`-flödet), bestäm svar, och starta Fas 1 som en avgränsad Claude Code-session med detta dokument som kontext.*

**Källor (NavVis IVION API):**
- [MainViewInterface](https://ivion-api.docs.navvis.com/v11.8.0/reference/interfaces/mainviewinterface)
- [PoiInterface](https://ivion-api.docs.navvis.com/v10.3.2/reference/interfaces/poiinterface)
- [ConfigurationInterface](https://ivion-api.docs.navvis.com/v11.9.4/reference/interfaces/configurationinterface.html)
- [Introduktion till NavVis IVION API](https://knowledge.navvis.com/docs/navvis-ivion-api-documentation)
- [xeokit-sdk AnnotationsPlugin](https://xeokit.github.io/xeokit-sdk/docs/class/src/plugins/AnnotationsPlugin/AnnotationsPlugin.js~AnnotationsPlugin.html)
