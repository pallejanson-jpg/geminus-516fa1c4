# Viewer Coordinator — sammanslagen spec + färdiga Claude Code-prompts

**Vad det här dokumentet är:** en sammanslagning av (1) min genomgång av den faktiska koden i `C:\MDP\GEMINUS` och (2) arkitekturförslaget du fick från en annan utvecklare, plus min bedömning av var de skiljer sig. Dokumentet är skrivet så att du kan peka Claude Code på det och köra igenom faserna i ordning.

**Hur du använder det:** Lägg filen i `docs/plans/` (redan gjort om du fick den via mig — annars döp den till `docs/plans/viewer-coordinator-spec-and-prompts.md`). Öppna Claude Code i projektroten och skriv t.ex.:

> Read docs/plans/viewer-coordinator-spec-and-prompts.md in full. Start with Phase 0.

Kör en fas i taget. Låt Claude Code stanna och rapportera efter varje fas innan ni går vidare — särskilt Phase 0, eftersom den kan ändra hela resten av planen beroende på vad den hittar.

De faktiska prompt-blocken nedan (i "Phase 0–4") är skrivna på engelska med flit, eftersom kodbasen och Claude Code generellt presterar mest förutsägbart på engelska instruktioner. Resten av dokumentet är på svenska för din skull.

---

## Del A — Verifierat nuläge (så Claude Code slipper göra om upptäcktsarbetet)

Detta är redan kontrollerat mot koden (2026-08-20), inte gissat från en arkitekturbeskrivning. Använd det som fakta, inte som något som behöver återupptäckas — men se "Öppna frågor" längst ner, för där finns saker som **inte** kunde verifieras utan att köra appen.

### A.1 Kamerasynk — två parallella implementationer idag

- **Split View-vägen:** `src/context/ViewerSyncContext.tsx` (delad state `{position, heading, pitch, source, timestamp}`) + `src/hooks/useViewerCameraSync.ts` (xeokit → context) + `src/hooks/useIvionCameraSync.ts` (Ivion → context, pollar `getMainView().getImage()`/`currViewingDir` var 200 ms).
- **Virtual Twin-vägen:** `src/hooks/useVirtualTwinSync.ts`, helt separat, envägs (Ivion driver, xeokit följer), egen `requestAnimationFrame`-loop, egna trösklar.
- Koordinattransform: `src/lib/ivion-bim-transform.ts`, enkel Y-rotation + XYZ-translation, hämtad från `building_settings.ivion_bim_offset_x/y/z` + `ivion_bim_rotation`. Om transformen är identitet (0,0,0,0) stängs synken av tyst.
- **Misstänkt trasig länk:** `useViewerCameraSync.ts` hittar xeokit-instansen via `viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer` (en äldre Vue-baserad väg). `useVirtualTwinSync.ts` har en fallback till `window.__nativeXeokitViewer` (satt av den nyare `src/components/viewer/NativeXeokitViewer.tsx`), men `useViewerCameraSync.ts` saknar den fallbacken. Sannolik konsekvens: Split View-kamerasynk fungerar inte när den nyare native-vieweren används — utan felmeddelande.
- Övriga kända buggar: delad debounce-timestamp mellan de två synk-riktningarna (kan svälta ut den ena); heading normaliseras inte konsekvent till 0–360°; `findNearestImage()` använder en platt 50 m-radie utan våningsfiltrering; flera hårdkodade "safety timeout"-mönster (t.ex. tvinga `isSyncing=false` efter 2 s) som tyder på tidigare observerade låsningar.

### A.2 POI/annotationer — allt hänger idag på `assets`-tabellen, ingen egen POI-tabell

- Ingen separat POI/panorama-tabell finns. POI existerar i NavVis Ivion och speglas via fyra fält på `public.assets`: `ivion_poi_id`, `ivion_site_id`, `ivion_image_id`, `ivion_synced_at`.
- **"Icke-modellerad asset" är redan ett etablerat begrepp**, inte något nytt: `assets.created_in_model` (default `true`, sätts `false` för assets utan BIM-geometri) + `assets.is_local` (default `false`) + `assets.annotation_placed`/`annotation_model_id` + `assets.symbol_id` (FK till `annotation_symbols`). Kopplingen till faktisk xkt-geometri sker via en **separat** tabell `geometry_entity_map` (building_fm_guid, asset_fm_guid, external_entity_id, model_id) — frånvaro av en rad där = ingen 3D-geometri finns för den assetten.
- Edge-funktionen `supabase/functions/ivion-poi/index.ts` (~850 rader) gör redan CRUD mot Ivions REST-API: `get-pois`, `create-poi`, `update-poi`, `import-pois` (Ivion → nya `assets`-rader med `created_in_model:false, is_local:true, annotation_placed:true`), `sync-asset` (Geminus-asset → ny Ivion-POI, **men bara create, ingen update om `ivion_poi_id` redan finns**), plus bild/panorama-positionslookup.
- Upptäckt av nya POI:er skapade i Ivion sker via **polling var 3:e sekund, bara när ett specifikt registreringspanel är öppet** (`Ivion360View.tsx`, action `get-latest-poi`) — inte realtid, inte automatiskt.
- AI-scan-pipelinen (`pending_detections` → godkänns → `assets` + Ivion-POI samtidigt) är ett **redan fungerande exempel** på flödet "hitta objekt som saknar BIM-geometri → skapa som annotation i båda vyer" — bygg vidare på det mönstret, uppfinn inte ett nytt parallellt.
- Rendering är inkonsekvent: `AnnotationCategoryList.tsx` och `AnnotationToggleMenu.tsx` är nästan identiska men filtrerar olika och pratar med **olika** xeokit-plugin-referenser (`localAnnotationsPlugin` respektive `annotationsPlugin`).
- `ViewerContext.tsx` har en påbörjad men aldrig kopplad `completeAnnotationPlacement(coordinates)` — koordinaterna kastas idag bort utan att sparas.

### A.3 Bibliotek och en verifierad licensrisk

- **xeokit-sdk är inte ett npm-beroende.** Laddas i `src/hooks/useXeokitInstance.ts` via `fetch('/lib/xeokit/xeokit-sdk.es.js')` → Blob URL → dynamisk `import()`. Version okänd utan att öppna filen.
- **NavVis Ivion SDK är inte heller ett npm-beroende**, trots att `navvis-ivion-11.9.8.tgz` ligger i repo-roten. Laddas via tre fallback-vägar i `src/lib/ivion-sdk.ts`: lokal UMD-bundle → scripttag mot kundens Ivion-instans → CORS-proxy edge function `ivion-proxy`.
- **Verifierat: xeokit-sdk är licensierat under AGPLv3**, med möjlighet att köpa en kommersiell licens för att slippa copyleft-kraven ([källa](https://github.com/xeokit/xeokit-sdk/wiki/License)). AGPL:s nätverksklausul innebär att om ni kör en modifierad version av xeokit på er egen server och exponerar den mot användare, kan ni bli skyldiga att erbjuda källkoden för den modifierade versionen till de användarna. Det här måste klargöras (kommersiell licens eller ej) **innan** ni investerar mycket arbete i att äga hela stacken själva.
- NavVis IVION API (`MainViewInterface`, verifierat mot v11.8.0-dokumentationen) har metoder som `updateOrientation()`, `centerOn()`, `getCamera()`, `updateFov()`/`getFov()`, `getImage()`, `getPoiLayer()` — men **inget dokumenterat "point-of-view changed"-event**. Nuvarande polling-ansats är alltså rimlig i grunden, den behöver bara konsolideras till en plats.

---

## Del B — Öppna frågor som MÅSTE besvaras i Phase 0, innan resten byggs

1. **Hur ansluter `Ivion360View.tsx` faktiskt till NavVis idag** — laddar den en levande SDK-instans (vilket `ivion-sdk.ts`/`useIvionCameraSync.ts` antyder, med polling av `currViewingDir`), eller är det i praktiken en iframe styrd enbart via URL-parametrarna `site`/`vlon`/`vlat`? Det avgör om ni redan har djup SDK-åtkomst att bygga vidare på, eller måste etablera den. (Detta var den enskilt viktigaste frågan i båda analyserna — vi är oense om svaret, så den måste verifieras i kod/runtime, inte antas.)
2. **Används `GeminusPlusViewer`/Vue-wrappern (`$refs.AssetViewer.$refs.assetView.viewer`) fortfarande i produktion**, eller är `NativeXeokitViewer.tsx` redan den enda vägen för alla kunder? Avgör hur snabbt `$refs`-kedjan kan tas bort helt.
3. **Är Virtual Twin-läget (`useVirtualTwinSync.ts`, Ivion-driven envägssynk) fortfarande ett produktkrav som ett separat UI-läge**, eller kan det bli ett specialfall av samma coordinator (source alltid `'ivion'`)?
4. **Har Geminus/SWG en kommersiell xeokit-licens, eller körs den publika AGPLv3-varianten?** Om det senare — flagga upp till affärssidan innan ni bygger vidare på en självhostad, modifierad xeokit-integration.
5. **Hur viktigt är multi-user (flera personer i samma viewer-session samtidigt) på kort sikt?** Avgör om Node-servern bara behöver vara ett skriv-API (enklare, se Del C.4) eller om en fullständig WebSocket-hubb ska byggas redan nu.
6. Faktisk NavVis-svarstid för Ivion-pollningen (nuvarande 200 ms är en gissning, inte uppmätt).

---

## Del C — Målarkitektur (sammanslagen)

### C.1 ViewerCoordinator + adapters

Ingen direktkoppling mellan xeokit och Ivion. Allt går genom en central, ren TS-modul (ingen DOM-koppling, testbar med vitest):

```
                ViewerCoordinator
                 /              \
        XeokitViewerAdapter   IvionViewerAdapter
                |                    |
          xeokit Viewer        NavVis IVION SDK
                 \              /
              SpatialReferenceService
                        |
                 Annotation/POI-lager (assets)
                        |
                 Node.js API  →  Supabase
```

```ts
export type ViewerSource = "xeokit" | "ivion" | "system";

export interface SpatialPose {
  buildingFmGuid: string;
  floorFmGuid?: string;
  position: { x: number; y: number; z: number };
  orientation?: { headingDeg: number; pitchDeg: number; rollDeg?: number };
  coordinateSystem: "geminus-local";
  timestamp: number;   // performance.now(), inte Date.now()
  source: ViewerSource;
  transactionId: string; // sätts av den adapter som initierar ändringen
}

export interface ViewerSelection {
  assetFmGuid?: string;
  bimEntityId?: string;   // motsvarar geometry_entity_map.external_entity_id
  ivionPoiId?: number;
  source: ViewerSource;
}

export interface SpatialViewerAdapter {
  initialize(): Promise<void>;
  destroy(): void;
  getPose(): Promise<SpatialPose | null>;
  setPose(pose: SpatialPose): Promise<void>;
  selectEntity(selection: ViewerSelection): Promise<void>;
  showAnnotation(annotation: ViewerAnnotation): Promise<void>;
  removeAnnotation(assetFmGuid: string): Promise<void>;
  onPoseChanged(cb: (pose: SpatialPose) => void): () => void;
  onSelectionChanged(cb: (sel: ViewerSelection) => void): () => void;
  onAnnotationCreateRequested(cb: (draft: ViewerAnnotationDraft) => void): () => void;
}
```

Filer: `src/viewer/ViewerCoordinator.ts`, `src/viewer/adapters/XeokitViewerAdapter.ts`, `src/viewer/adapters/IvionViewerAdapter.ts`, `src/viewer/SpatialReferenceService.ts`.

### C.2 Loop-skydd (viktigt tillägg jämfört med enbart sekvensnummer)

Varje pose märks med `transactionId` (uuid) av den adapter som initierar en ändring. Coordinatorn ignorerar en inkommande pose om:

- den kommer tillbaka med **samma** `transactionId` som coordinatorn själv precis skickade ut (äkta feedback-eko), **eller**
- positionen ligger inom `POSITION_EPSILON_METERS` (starta på 0,15 m) **och** headingen inom `HEADING_EPSILON_DEGREES` (starta på 2°) från den pose coordinatorn redan har, **eller**
- det är kortare än `SYNC_INTERVAL_MS` (starta på 100 ms) sedan senaste accepterade uppdatering **från samma källa**.

Detta hindrar den klassiska studs-oscillationen (A flyttar B, B rapporterar tillbaka en nästan identisk pose, vilket flyttar A igen) på ett sätt som ett rent sekvensnummer inte gör.

### C.3 Datamodell — utöka det som finns, bygg inte en parallell modell

Geminus princip (som ni redan lever efter i AI-scan-flödet) är att **POI/annotation är en asset**, inte ett separat viewer-objekt. Det är rätt, och bör bevaras — bygg inte en fristående `viewer_pois`/`poi_annotations`-tabell parallellt med `assets`, det ger er två sanningar om samma sak. Utöka istället:

**Två oberoende dimensioner, inte en — annars tappar ni signal.** `symbol_id` (finns redan, FK till `annotation_symbols`) svarar på "vad är det här och hur ska det se ut som POI/annotation" — en medveten klassificering. `spatial_representation`/`location_accuracy` svarar på en helt annan fråga: "varifrån kommer positionen och hur mycket litar vi på den" — härledd av systemet, inte vald av en användare. Slå inte ihop dessa till ett enda "typ"-fält: en brandvarnare (`symbol_id` = alarm) kan vara en riktig BIM-geometri, en manuellt utsatt punkt, eller en gissning vid rummets centrum — samma symbol, tre olika tillförlitlighetsnivåer, och ni vill kunna skilja dem åt i UI (t.ex. varningsikon på gissade positioner) och i kalibreringsarbetet.

Däremot är den befintliga kolumnen `assets.annotation_placed` (boolean) **redundant** och bör fasas ut: om `symbol_id` är satt betyder det per definition "ska visas som POI/annotation, och så här ser den ut" — ingen separat flagga behövs bredvid för att säga samma sak. Gör `symbol_id IS NOT NULL` till den **enda** regeln för "syns som POI/annotation" överallt i koden. Det här löser direkt bugg A.2 (de två annotationskomponenterna filtrerar idag på två olika, isärdrivna villkor) genom att det bara finns ett villkor att hålla koll på.

"Orphans" (assets utan BIM-geometri som ändå ska synas) blir med detta inget eget begrepp att modellera — det är bara skärningspunkten `symbol_id IS NOT NULL` + `spatial_representation = 'unlocated'`: vi vet vad det är, men den har ingen position än, så den hamnar i "Ej placerade assets" tills en position sätts i endera vyn.

```sql
-- Ny, tydlig klassificering av var en assets position kommer ifrån (ersätter implicit
-- tolkning av created_in_model + geometry_entity_map + ivion_poi_id)
alter table public.assets
  add column spatial_representation text
    check (spatial_representation in
      ('bim-object','spatial-point','space-centroid','navvis-location','unlocated'))
    default 'unlocated',
  add column location_accuracy text
    check (location_accuracy in
      ('surveyed','model-derived','navvis-derived','space-derived','manually-placed'))
    default null,
  add column transform_version integer default null;  -- vilken spatial_transforms.version som användes när koordinaten sattes

-- annotation_placed fasas ut (behåll kolumnen under migreringen för bakåtkompatibilitet,
-- men sluta skriva ny logik mot den — symbol_id is not null är den enda sanningen framåt).
-- Ett engångsskript backfyller symbol_id för rader där annotation_placed=true men symbol_id
-- saknas (välj en rimlig default-symbol per asset_type), innan kolumnen till sist droppas
-- i en separat, senare migration.

-- Ersätter/breddar building_settings.ivion_bim_offset_x/y/z + ivion_bim_rotation
create table public.spatial_transforms (
  id uuid primary key default gen_random_uuid(),
  building_fm_guid text not null,
  source_system text not null default 'xeokit',
  target_system text not null default 'navvis',
  matrix4x4 numeric[16] not null,        -- row-major 4x4-affin transform
  navvis_site_id text,
  version integer not null,
  residual_error_mm numeric,             -- RMS-fel över kalibreringspunkterna
  calibration_points jsonb,              -- [{xeokit:{x,y,z}, navvis:{x,y,z}}, ...] för spårbarhet
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (building_fm_guid, version)
);
```

Migrera in dagens `building_settings.ivion_bim_offset_x/y/z` + `ivion_bim_rotation` som `version = 1` i `spatial_transforms` (en ren rotation+translation uttryckt som 4x4-matris), så inget går förlorat och alla befintliga POI:er kan taggas med `transform_version = 1`.

`spatial_representation` sätts av applikationslogik (inte en trigger, för att undvika dold magi), enligt prioritetsordning:

1. Finns rad i `geometry_entity_map` för assetten → `bim-object`.
2. Har `coordinate_x/y/z` satta manuellt/AI-scan → `spatial-point`.
3. Har bara `ivion_poi_id`/`ivion_image_id` (importerad från Ivion, ingen BIM-koordinat) → `navvis-location`.
4. Kopplad till ett rum (`in_room_fm_guid`) men ingen egen koordinat → `space-centroid` (visa vid rummets centroid, tydligt markerad som approximation i UI:t).
5. Inget av ovanstående → `unlocated` (visas i en "Ej placerade assets"-lista, redan existerande UI-koncept i `UnplacedAssetsPanel.tsx`).

### C.4 Node.js-API (asset-centrerat, inte en separat POI-resurs)

```
GET   /api/buildings/:buildingFmGuid/viewer-config
GET   /api/buildings/:buildingFmGuid/annotations          -- assets med annotation_placed=true
POST  /api/buildings/:buildingFmGuid/annotations          -- skapar/uppgraderar en asset till annotation
PATCH /api/assets/:fmGuid/spatial-location                -- coordinate_x/y/z, spatial_representation, location_accuracy
DELETE /api/assets/:fmGuid/annotation                     -- annotation_placed=false (soft, tar inte bort assetten)

GET   /api/buildings/:buildingFmGuid/spatial-transform     -- senaste version
POST  /api/buildings/:buildingFmGuid/spatial-transform     -- ny kalibrering -> ny version
POST  /api/buildings/:buildingFmGuid/spatial-transform/validate  -- returnerar residual_error_mm utan att spara
```

Servern: validerar payload (Zod), kontrollerar building/tenant-behörighet, använder Supabase service-role **bara** server-side, anropar vidare till `ivion-poi`-logiken (flytta den hit eller anropa Supabase-funktionen server-till-server) när en annotation ska speglas som Ivion-POI, loggar ändringar, använder `updated_at`/version för optimistic concurrency, och litar **inte** på att Node-lagret är den enda spärren — RLS ska fortsatt gälla i Supabase.

**Realtidsstrategi — medvetet enklare än en full WebSocket-hubb i version 1:**

- **Kamera-pose** delas i minnet inom en och samma flik/session via `ViewerCoordinator` — ingen nätverksomgång behövs för att XEOkit och Ivion i samma flik ska följa varandra. Bygg inte en WebSocket-hubb för detta förrän multi-user (öppen fråga #5) faktiskt efterfrågas.
- **Annotationer** (låg frekvens, hög vikt) skrivs via Node-API:et ovan och propageras till andra öppna klienter (annan flik, annan användare) via **Supabase Realtime** på `assets`-tabellen, filtrerat på `building_fm_guid`. Det ger er "syns i båda vyer direkt" utan att ni behöver underhålla en egen realtidstransport från dag ett.
- Om multi-user-krav (dela en live-session med en kollega, synka kameran mellan två personers skärmar) blir aktuellt: lägg då till en tunn WebSocket-hubb på er Node-server som reläar `SpatialPose` mellan sessioner — det är en isolerad utbyggnad av samma `ViewerCoordinator`-gränssnitt, inte en omskrivning.

### C.5 Icke-förhandlingsbara begränsningar (från båda analyserna, samstämmigt)

- `NativeXeokitViewer.tsx`, befintlig XKT-laddning, IndexedDB/Supabase-cache och principen att xeokit **inte avmonteras** vid lägesbyte ska bevaras oförändrade.
- Ingen Supabase service-role-nyckel i webbläsarkod.
- RLS gäller alltid i Supabase, oavsett vad Node-lagret redan kontrollerat.
- Migreringen ska vara inkrementell — inget big-bang-utbyte av `UnifiedViewer.tsx`/`Ivion360View.tsx` i en enda commit.
- Ingen xeokit-versionsuppgradering samtidigt som synklogiken byggs om — separata initiativ.
- Global `window.__*`/`CustomEvent`-kommunikation fasas ut till förmån för adapters/coordinator, men får finnas kvar som en **tillfällig** bro under migreringen (se Phase 1) — riv inte ut den innan ersättningen är verifierad.

---

## Del D — Acceptanstester (definition of done)

- Transform xeokit → NavVis → xeokit håller sig inom tolerans (t.ex. < 5 cm) för kalibreringspunkterna.
- En kameraändring skapar inte en oändlig feedback-loop (testa med simulerade adapters).
- Snabb navigering throttlas utan att sluta-positionen tappas.
- Våningsbyte uppdaterar båda viewers och `findNearestImage`/motsvarande respekterar `floorFmGuid`.
- Annotation skapad i xeokit dyker upp i Ivion, och tvärtom, utan att ett specifikt UI-panel behöver vara öppet.
- Annotation överlever en sidladdning.
- Två samtidigt öppna flikar/användare ser samma annotation-uppdatering (även om kameran inte delas mellan dem i v1).
- Asset utan `geometry_entity_map`-rad visas ändå som annotation (`spatial_representation != 'bim-object'`).
- Asset utan koordinat och utan rumskoppling hamnar i "Ej placerade assets", inte på en godtycklig plats.
- Fel/avsaknad transform ger ett synligt fel i UI ("Ivion och BIM är inte kalibrerade") — inte tyst felplacering eller tyst avstängd synk.
- Frånkopplad Ivion (t.ex. nätverksfel mot kundens instans) låser inte xeokit-vieweren.
- En användare från fel tenant/building kan inte läsa eller ändra en annotation (RLS-test).
- `ivion-poi`:s `sync-asset` är idempotent — kör den två gånger på samma asset ska inte skapa en dubbel-POI.

---

## Del E — Fasplan med färdiga Claude Code-prompts

Kör en fas åt gången. Efter varje fas: läs igenom vad Claude Code faktiskt ändrade (diff), inte bara sammanfattningen, innan ni går vidare.

### Phase 0 — Verify before building anything

```
Read docs/plans/viewer-coordinator-spec-and-prompts.md in full, especially "Del A" (verified
current state) and "Del B" (open questions). Do not change any files yet.

Your job in this phase is to CONFIRM OR CORRECT the claims in Del A against the actual
current code and, where possible, runtime behavior, and to answer the open questions in Del B:

1. Does src/components/viewer/Ivion360View.tsx (and src/lib/ivion-sdk.ts) load a live NavVis
   IVION SDK instance that exposes camera/orientation state (e.g. currViewingDir, getMainView()),
   or does it only render an iframe positioned via URL parameters (site, vlon, vlat) with no
   further JS API access? Quote the exact code that proves your answer.
2. Is the Vue-based `$refs.AssetViewer.$refs.assetView.viewer` path (referenced in
   src/hooks/useViewerCameraSync.ts and src/hooks/useVirtualTwinSync.ts) still reachable from
   any currently-used page/route, or is src/components/viewer/NativeXeokitViewer.tsx
   (window.__nativeXeokitViewer) the only viewer instance in active use?
3. Is src/hooks/useVirtualTwinSync.ts (Virtual Twin mode) reachable from a real route/page today,
   or is it dead/experimental code?
4. Confirm whether @xeokit/xeokit-sdk or the equivalent runtime bundle under public/lib/xeokit/
   declares a version, and what license file (if any) ships with it.
5. List every place in the codebase that reads or writes:
   assets.created_in_model, assets.is_local, assets.annotation_placed, assets.ivion_poi_id,
   assets.coordinate_x/y/z, geometry_entity_map, building_settings.ivion_bim_offset_x/y/z,
   building_settings.ivion_bim_rotation.

Produce docs/viewer-current-state-verified.md with your findings, explicitly marking each
claim from Del A as CONFIRMED, CORRECTED (with the correction), or COULD NOT VERIFY (with what
you'd need to check — e.g. running the app manually). Do not implement anything in this phase.
```

### Phase 1 — ViewerCoordinator foundation (no persistence yet)

```
Read docs/plans/viewer-coordinator-spec-and-prompts.md ("Del C.1" and "Del C.2") and
docs/viewer-current-state-verified.md before starting.

Implement the foundation only:

- src/viewer/ViewerCoordinator.ts implementing the SpatialPose / ViewerSelection /
  SpatialViewerAdapter shapes from Del C.1, with the loop-guard rules from Del C.2
  (transactionId de-dup, position/heading epsilon suppression, per-source min interval).
  Make POSITION_EPSILON_METERS, HEADING_EPSILON_DEGREES and SYNC_INTERVAL_MS named,
  exported constants so they can be tuned later based on measured NavVis latency.
- src/viewer/adapters/XeokitViewerAdapter.ts — wraps whichever xeokit viewer reference Phase 0
  determined is actually in production use. If both the Vue $refs path and
  window.__nativeXeokitViewer are still reachable, support both behind this one adapter so
  callers never branch on it themselves.
- src/viewer/adapters/IvionViewerAdapter.ts — wraps the actual NavVis IVION integration
  confirmed in Phase 0 (do not assume a capability Phase 0 could not confirm).
- src/viewer/SpatialReferenceService.ts — pure functions for the current
  offset+rotation transform (read from building_settings as today; do NOT do the
  spatial_transforms table migration yet, that is Phase 2/3), but structure the function
  signatures so they can accept a 4x4 matrix later without changing callers
  (e.g. transformPoint(point, transform: { toMatrix(): number[] })).
- Normalize heading to [0, 360) inside SpatialReferenceService, in exactly one place.
- Add floor-awareness: SpatialPose carries floorFmGuid; nearest-image lookup (wherever it
  lives today) must filter candidates by floor before computing distance.
- Unit tests (vitest, already configured in this repo) for: loop-guard suppression logic,
  heading normalization, and the coordinate transform round-trip.

Do NOT touch POI/annotation persistence, Supabase schema, or the Node.js server in this phase.
Wire the new ViewerCoordinator into the existing Split View flow as a drop-in replacement for
ViewerSyncContext, but leave the old context in place (unused) until you've confirmed the new
path works, then remove it in a follow-up commit.

After implementation: run typecheck, run tests, run lint, list every changed file, and
explicitly call out any assumption you made because Phase 0 could not fully verify something.
```

### Phase 2 — Canonical annotations (assets-based, not a new POI table)

```
Read docs/plans/viewer-coordinator-spec-and-prompts.md ("Del A.2", "Del C.3", "Del C.4")
before starting.

Implement:

1. Supabase migration adding spatial_representation, location_accuracy, transform_version to
   public.assets, and creating public.spatial_transforms, exactly as specified in Del C.3.
   Include a data migration that copies the current building_settings.ivion_bim_offset_x/y/z +
   ivion_bim_rotation into a version=1 row per building in spatial_transforms (as an equivalent
   4x4 affine matrix), and backfills transform_version=1 on assets that already have
   coordinate_x/y/z or ivion_poi_id set.
2. Regenerate Supabase TypeScript types.
3. The Node.js API endpoints from Del C.4 (viewer-config, annotations CRUD,
   spatial-transform read/write/validate), with Zod validation, tenant/building authorization,
   and service-role Supabase access kept server-side only.
4. Make supabase/functions/ivion-poi's sync-asset action idempotent: if the asset already has
   ivion_poi_id, PUT an update instead of always POSTing a new POI.
5. Merge src/components/viewer/AnnotationCategoryList.tsx and
   src/components/viewer/AnnotationToggleMenu.tsx into a single component with exactly one
   filter condition — symbol_id IS NOT NULL — replacing both components' current, divergent
   filter logic (one uses annotation_placed=true OR asset_type='IfcAlarm', the other uses
   category='Instance' AND annotation_placed=true). Use one xeokit annotations-plugin reference
   (pick whichever plugin reference is actually correct per your Phase 0 findings, remove the
   other). Stop reading/writing assets.annotation_placed in any new code path; leave the column
   in place for now (see Del C.3 migration note) but treat symbol_id as the single source of
   truth for "is this asset shown as a POI/annotation".
6. Wire src/context/ViewerContext.tsx's completeAnnotationPlacement(coordinates) to actually
   call the new POST /api/buildings/:id/annotations endpoint instead of discarding the
   coordinates.
7. Replace the 3-second polling in Ivion360View.tsx (action get-latest-poi) with a Supabase
   Realtime subscription on public.assets filtered by building_fm_guid, so new annotations
   propagate to both viewers without requiring a specific panel to be open.
8. Both XeokitViewerAdapter and IvionViewerAdapter get a real showAnnotation/removeAnnotation
   implementation driven by the Realtime subscription plus the initial
   GET /api/buildings/:id/annotations load.

Preserve the existing pending_detections -> assets approval flow for AI-scan detections;
route its final "create asset" step through the same new annotations API instead of writing
directly to assets, so there is one write path.

After implementation: run typecheck, tests, lint. List every changed file and every new
Supabase migration. Explain any place where you had to guess at the correct xeokit
annotations-plugin API because documentation was ambiguous.
```

### Phase 3 — Calibration UI (multi-point → matrix + residual + version)

```
Read docs/plans/viewer-coordinator-spec-and-prompts.md ("Del C.3") before starting.

Build a calibration screen where a user picks 2+ corresponding points in the XEOkit view and
the Ivion view (reuse src/components/viewer/AlignmentPanel.tsx /
AlignmentPointPicker.tsx patterns if they fit), computes a similarity/affine transform from the
point pairs, shows the residual error (RMS, in mm) to the user before saving, and on save
POSTs to /api/buildings/:id/spatial-transform to create a new version row in
spatial_transforms (never overwrite an existing version).

Show a clear "not calibrated for this building" banner anywhere the viewer sync would otherwise
silently do nothing, linking directly to this screen.

After implementation: run typecheck, tests, lint. List every changed file.
```

### Phase 4 — Dependency and license cleanup (lower priority, can run in parallel)

```
Investigate and report (do not change production behavior without confirmation):

1. Whether Geminus/SWG holds a commercial xeokit-sdk license or is relying on the public
   AGPLv3 release loaded from public/lib/xeokit/. Report what you find in package.json,
   any license files under public/lib/xeokit/, and any commercial license key/config
   referenced in the codebase or environment variables. Do not make a licensing decision —
   just surface the facts so a human can decide.
2. Whether xeokit-sdk can be adopted as a versioned npm dependency instead of a runtime
   fetch+Blob-URL import, without breaking the "viewer stays mounted across mode changes"
   requirement.
3. Consolidate src/hooks/useIvionSdk.ts and the duplicated inline SDK lifecycle code in
   src/components/viewer/Ivion360View.tsx into a single hook with one token-refresh interval.

Propose but do not execute changes for item 1 (license) — that needs a business decision first.
Items 2 and 3 can be implemented if typecheck/tests/lint stay green.
```

---

## Del F — Vad jag ändrade jämfört med de två ursprungliga förslagen

- Jag har **övergivit min egen tidigare idé** om en fristående `poi_annotations`-tabell, och den andra utvecklarens `viewer_pois`-tabell, till förmån för att utöka `assets` direkt. Anledningen: Geminus princip (uttryckt i den andra analysens egen slutsats — "Geminus äger sambandet mellan asset, position, annotation och byggnad") stöds bättre av att varje annotation *är* en asset, inte en separat entitet med en valfri länk till en asset. Två parallella tabeller för samma koncept är precis den typen av duplicering som redan orsakat dagens problem (två kamerasynk-vägar, två annotationskomponenter).
- Jag har tagit över den andra analysens bättre delar rakt av: 4x4-matristransform med versionsnummer och residualfel, `transactionId`+epsilon-baserat loopskydd, och `spatial_representation`/`location_accuracy`-klassificeringen.
- Jag har nedskalat realtidsarkitekturen från en fullständig WebSocket-hubb (mitt ursprungliga förslag) till Supabase Realtime för annotationer + lokal in-memory-synk för kameran inom en flik, med WebSocket-hubben som en uttrycklig, senare utbyggnad om multi-user blir ett krav — enklare att bygga och underhålla för det ni faktiskt bett om (två viewers, samma användare, samma skärm).
- Jag har tagit bort `annotation_placed` som ett eget beslutsfält och gjort `symbol_id IS NOT NULL` till den enda regeln för "syns som POI/annotation" — en boolean bredvid en redan meningsbärande FK var ren duplicering, och det var precis den typen av två-sanningar-om-samma-sak som orsakade att de två annotationskomponenterna drivit isär. Positionens härkomst (`spatial_representation`/`location_accuracy`) hålls kvar som en egen dimension, eftersom den svarar på en annan fråga (varifrån kommer koordinaten, hur mycket litar vi på den) än vad symbolen svarar på (vad är det, hur ska det se ut).
- Jag har lagt till Phase 0 som ett explicit verifieringssteg eftersom de två analyserna motsäger varandra om hur `Ivion360View.tsx` faktiskt är uppbyggd (levande SDK-polling kontra ren iframe+URL-parametrar) — det måste avgöras i kod, inte antas, innan Phase 1 påbörjas.
