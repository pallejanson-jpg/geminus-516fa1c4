
# Serverbaserad SVF-till-glTF-konvertering for RVT-filer

## Problemet

RVT-filer kan bara oversattas till SVF/SVF2 av Autodesk -- inte till OBJ eller glTF direkt. SVF2 ar ett multi-fil-format som inte kan laddas ner som en enda fil, sa den befintliga klientkonverteringen (GLB/OBJ till XKT) fungerar inte.

## Losningsforslag: SVF (v1) + serverbaserad glTF-konvertering

Hela pipelinen:

```text
RVT-fil
  |
  v
[Autodesk Model Derivative API]  -- begar SVF (v1) istallet for SVF2
  |
  v
SVF (v1) -- multi-fil, men streambar via API
  |
  v
[Ny edge function: acc-svf-to-gltf]  -- anvander forge-convert-utils
  |                                      laser SVF direkt fran Autodesk API
  |                                      konverterar till GLB i minnet
  |                                      sparar GLB i Supabase Storage
  v
GLB-fil i Storage
  |
  v
[Befintlig klientkod: acc-xkt-converter.ts]  -- laddar ner GLB
  |                                             konverterar till XKT i webblasaren
  v
XKT-modell i xkt-models bucket -- redo for visning i viewern
```

## Steg-for-steg

### 1. Andra oversattningsformat fran SVF2 till SVF (v1)

I `supabase/functions/acc-sync/index.ts`, action `translate-model`:
- Byt `{ type: "svf2" }` till `{ type: "svf" }`
- SVF (v1) stodjer samma filtyper som SVF2 men har den fordelen att `forge-convert-utils` kan lasa det direkt fran Autodesks API via URN

### 2. Skapa ny edge function: `acc-svf-to-gltf`

En dedicerad edge function som:
1. Tar emot `versionUrn` och `derivativeUrn`
2. Anvander APS-token for att lasa SVF-data fran Autodesk via `forge-convert-utils`
3. Konverterar SVF till GLB (binary glTF) i minnet
4. Sparar GLB i Supabase Storage (`xkt-models` bucket, temporart)
5. Returnerar en signed URL till GLB-filen

Biblioteket `forge-convert-utils` importeras via `esm.sh` i Deno-miljon.

### 3. Uppdatera download-derivative-logiken

Istallet for att forsoka ladda ner en enstaka fil fran SVF2 (som inte fungerar):
1. Nar SVF-oversattning ar klar, anropa den nya `acc-svf-to-gltf` edge function
2. Edge function streamar SVF fran Autodesk, konverterar till GLB, sparar i Storage
3. Returnerar signed URL till GLB
4. Klienten anvander befintlig `convertAndStore()` i `acc-xkt-converter.ts` for att konvertera GLB till XKT

### 4. Uppdatera klientens pipeline

I `acc-xkt-converter.ts`, metoden `runFullPipeline`:
- Lagg till ett nytt steg mellan "translation klar" och "download": anropa `acc-svf-to-gltf` for att konvertera SVF till GLB pa servern
- Resten av pipelinen (ladda ner GLB, konvertera till XKT, spara) fungerar redan

### 5. Uppdatera UI

I `ApiSettingsModal.tsx`:
- Ta bort begransningsmeddelandet for RVT-filer
- Visa progress for det nya steget: "Konverterar geometri pa servern..."

## Filer som andras

| Fil | Andring |
|---|---|
| `supabase/functions/acc-sync/index.ts` | Byt SVF2 till SVF i translate-model. Uppdatera download-derivative att anropa nya funktionen. |
| `supabase/functions/acc-svf-to-gltf/index.ts` | **Ny fil.** Edge function som laser SVF fran Autodesk och konverterar till GLB via forge-convert-utils. |
| `supabase/config.toml` | Lagg till `[functions.acc-svf-to-gltf]` med `verify_jwt = false`. |
| `src/services/acc-xkt-converter.ts` | Lagg till SVF-till-GLB-steget i `runFullPipeline`. |
| `src/components/settings/ApiSettingsModal.tsx` | Ta bort RVT-formatbegransning, visa konverteringsprogress. |

## Begransningar och risker

- **Minnesgransen i edge functions**: Stora RVT-modeller kan generera stora SVF-filer. Om modellen ar for stor for edge function-miljon (minne/tid) misslyckas konverteringen. Vi bygger in tydliga felmeddelanden for detta.
- **forge-convert-utils i Deno**: Biblioteket ar byggt for Node.js. Det kan behova anpassningar for att fungera i Deno via esm.sh. Om det inte fungerar ar alternativet att anvanda en extern konverteringstjanst eller Docker-baserad worker.
- **SVF vs SVF2 for BIM-hierarki**: BIM-hierarki-synk (rum, vaningsplan) anvander Model Properties API som ar oberoende av oversattningsformatet, sa att byta till SVF paverkar inte den funktionaliteten.
- **Dubbel oversattning**: Om en modell redan ar oversatt till SVF2 maste den oversattas pa nytt till SVF. Befintliga SVF2-oversattningar cache-invalideras inte automatiskt.
