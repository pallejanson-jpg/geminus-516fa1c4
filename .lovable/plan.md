

# RVT till 3D: Pipeline via IFC-export

## Bakgrund

RVT-filer genererar SVF2 (multi-fil) som varken kan laddas ner som en fil eller parsas av forge-convert-utils (stod stangd av juridiska skal). Nuvarande pipeline misslyckas darfor alltid for RVT.

## Losning: RVT -> IFC -> XKT

Autodesk Model Derivative API stoder export av RVT till IFC-format (en enda nedladdningsbar fil). xeokit-convert har `parseIFCIntoXKTModel` som kan parsa IFC direkt till XKT med hjalp av web-ifc (WASM).

```text
Nuvarande (misslyckas):
  RVT --> SVF2 (multi-fil) --> ??? --> XKT

Ny pipeline:
  RVT --> IFC (en fil, via Autodesk API) --> XKT (via xeokit-convert i webblasaren)
```

## Andringar

### 1. Edge function: `supabase/functions/acc-sync/index.ts`

**translate-model** (rad 1852-1860): Andra output-formaten fran SVF+OBJ till IFC (med SVF som fallback for icke-RVT-filer):

```text
// For RVT-filer: begara IFC-export
const isRvt = (body.fileName || '').toLowerCase().endsWith('.rvt');
const translationBody = {
  input: { urn: urnBase64 },
  output: {
    formats: isRvt
      ? [{ type: "ifc" }]                    // RVT -> IFC (en fil)
      : [{ type: "svf", views: ["3d"] }, { type: "obj" }]  // Andra format: behallt
  },
};
```

**download-derivative** (rad 2012-2053): Lagg till sokning efter IFC-derivat utover glTF/OBJ:

```text
// Leta efter IFC-derivat (nedladdningsbar som en fil)
const ifcDeriv = allDerivs.find(d =>
  d.outputType === 'ifc' || d.mime === 'application/octet-stream' && d.role === 'ifc'
);
```

Nar IFC-derivat hittas, ladda ner det och spara i Storage precis som GLB gors idag.

### 2. Klient: `src/services/acc-xkt-converter.ts`

**convertGlbToXkt** (rad 62-133): Utoka formatstodet med IFC-detektering och parsning:

```text
// Lagg till IFC-detektering
function detectFormat(data: ArrayBuffer): 'glb' | 'obj' | 'ifc' | 'unknown' {
  // ... befintlig kod ...
  // IFC: textfil som borjar med "ISO-10303-21" eller "FILE_DESCRIPTION"
  if (text.startsWith('ISO-10303-21') || text.includes('FILE_DESCRIPTION')) {
    return 'ifc';
  }
  return 'unknown';
}
```

For IFC-parsning, anvand `parseIFCIntoXKTModel` fran xeokit-convert:

```text
if (format === 'ifc') {
  logger('Parsing IFC into XKTModel...');
  const { parseIFCIntoXKTModel } = await loadXeokitConvert();
  const ifcData = new TextDecoder().decode(glbData);
  await parseIFCIntoXKTModel({
    data: ifcData,
    xktModel,
    log: logger,
  });
}
```

### 3. Beroende: web-ifc (WASM)

`parseIFCIntoXKTModel` kraver `web-ifc` som WASM-beroende. Detta maste installeras:

```text
npm install web-ifc
```

web-ifc ar en WASM-baserad IFC-parser som fungerar i webblasaren. Den anvands internt av xeokit-convert for att parsa IFC STEP-filer.

**Alternativ om web-ifc inte fungerar i webblasaren**: konvertera IFC till XKT pa servern (en enkel Node.js-instans eller en Deno edge function med WASM-stod). Men web-ifc ar designad for webblasaren, sa det bor fungera.

## Risker och fallbacks

| Risk | Hantering |
|---|---|
| web-ifc WASM laddas inte i webblasaren | Testa forst. Om det inte fungerar, flytta IFC-parsningen till en edge function |
| IFC-exporten fran Autodesk ar ofullstandig | RVT -> IFC stods officiellt (IFC2x3/IFC4). Geometri och hierarki foljder med |
| Stora modeller gor webblasaren langsam | Visa progressindikator. For mycket stora modeller kan serverkonvertering behovas |
| Andra filformat (IFC, DWG) paverkas | Andaringen ar villkorlig -- bara RVT-filer far IFC-pipeline, ovriga behalller SVF+OBJ |

## Sammanfattning

| Fil | Andring |
|---|---|
| `supabase/functions/acc-sync/index.ts` | Begara IFC-format for RVT-filer. Hitta och ladda ner IFC-derivat. |
| `src/services/acc-xkt-converter.ts` | Detektera IFC-format. Parsa med `parseIFCIntoXKTModel`. |
| `package.json` | Lagg till `web-ifc` som beroende (kravs av parseIFCIntoXKTModel). |
| `vite.config.ts` | Eventuellt: konfigurera WASM-laddning for web-ifc. |

