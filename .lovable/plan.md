

# Kopiera NavVis SDK till projektet och fixa Virtual Twin

## Bakgrund

NavVis IVION SDK:n bestaar av tvaa filer:
- `api.js` (13 KB, UMD-bundle med allt inbyggt)
- `api.d.ts` (3635 rader TypeScript-typer)

Paketet kan inte installeras via npm i denna byggmiljoe. Loesningen aer att kopiera filerna direkt till projektet och uppdatera importerna.

## Steg 1: Kopiera SDK-filerna till projektet

Kopiera de uppladdade filerna till `public/lib/ivion/`:

| Fil | Destination |
|---|---|
| `api.js` | `public/lib/ivion/api.js` |
| `api.d.ts` | `public/lib/ivion/api.d.ts` |

Att laegga dem i `public/` goer dem tillgaengliga som en statisk resurs via `/lib/ivion/api.js`.

## Steg 2: Uppdatera SDK-laddaren

Aendra `src/lib/ivion-sdk.ts` saa att Attempt 1 (npm-import) ersaetts med att ladda scriptet fraan den lokala `/lib/ivion/api.js`:

```text
Ny laddningsordning:
1. Ladda /lib/ivion/api.js via script-tag (lokal fil, inga CORS-problem)
2. (fallback) Ladda ivion.js direkt fraan NavVis-instansen
3. (fallback) Ladda ivion.js via CORS-proxyn

Efter laddning: window.IvApi.getApi finns tillgaengligt
```

SDK:ns UMD-bundle exporterar till `self.IvApi`, saa vi letar efter `window.IvApi.getApi` efter script-laddning.

| Fil | Aendring |
|---|---|
| `src/lib/ivion-sdk.ts` | Byt ut npm-import (Attempt 1) mot lokal script-laddning av `/lib/ivion/api.js` |

## Steg 3: Uppdatera TypeScript-deklarationer

Uppdatera `src/types/navvis-ivion.d.ts` saa att den inte refererar till `@navvis/ivion` npm-paketet laengre. Istallet pekar vi paa den lokala `api.d.ts` eller goer den oeverbloedig daa vi redan har egna typdefinitioner i `ivion-sdk.ts`.

| Fil | Aendring |
|---|---|
| `src/types/navvis-ivion.d.ts` | Uppdatera att referera lokala SDK istallet foer npm-paket |

## Steg 4: Installera tween.js-beroendet

SDK:ns `api.d.ts` importerar fraan `@tweenjs/tween.js`. Lagg till detta som ett beroende:

| Aendring |
|---|
| Lagg till `@tweenjs/tween.js` i package.json dependencies |

Alternativt: Om bara typerna behoevs (SDK:n ar redan bundlad) kan vi skapa en enkel type-stub istallet.

## Steg 5: Verifiera att laddningskedjan fungerar

Naar `loadIvionSdk()` anropas:
1. Den skapar en `<script src="/lib/ivion/api.js">` tag
2. UMD-bundlen koeris och satter `window.IvApi = { getApi: ... }`
3. `getApi(baseUrl, config)` anropas med NavVis-instansens URL + loginToken
4. SDK:n renderar 360-panoramat i den `<ivion>` DOM-element som skapats

## Om Alignment (foer referens)

Alignment mellan BIM-modell och 360-panorama aer en **manuell engaangskalibrering per byggnad**:

1. Admin oeppnar Virtual Twin och klickar paa "Alignment"-knappen i verktygsfaeltet
2. Fyra reglage visas: Offset X/Y/Z (meter) och Rotation (grader)
3. Admin justerar tills BIM-geometrin matchar panoraman visuellt
4. Vaerdena sparas till databasen (`building_settings`)
5. Alla framtida sessioner anvaender de sparade vaerdena automatiskt

Just nu har alla byggnader offset/rotation = 0,0,0,0 (ej kalibrerade). Foerst maste SDK:n kunna ladda (Steg 1-4) innan alignment kan testas.

## Filsammanfattning

| Fil | Aendring |
|---|---|
| `public/lib/ivion/api.js` | Ny fil - kopierad fraan NavVis SDK |
| `public/lib/ivion/api.d.ts` | Ny fil - kopierad fraan NavVis SDK |
| `src/lib/ivion-sdk.ts` | Byt npm-import mot lokal script-laddning |
| `src/types/navvis-ivion.d.ts` | Uppdatera att referera lokala SDK |

## Risk

- **SDK-laddning (laag risk)**: UMD-bundles fungerar alltid via script-taggar. Den exporterar till `self.IvApi` vilket aer standard UMD-beteende.
- **tween.js-beroende (laag risk)**: SDK:ns api.js har redan tween.js inbakat i sin bundle. Beroendet behoevs bara foer TypeScript-typerna i api.d.ts.
- **Alignment (ingen risk)**: Befintlig funktionalitet, ingen kod aendras. Kalibrering goers manuellt av admin.

