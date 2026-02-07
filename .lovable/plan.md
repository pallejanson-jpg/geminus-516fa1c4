

# Plan: Alternativ vag for BIM-synk + 3D-modellkonvertering

## Del 1: versionUrn utan extra API-anrop

### Problemet
Vi trodde att vi behövde anropa en separat `tip`-endpoint for att hamta `versionUrn` for varje BIM-fil, men den endpointen gav 403 (kräver Custom Integration-registrering).

### Losningen
Folder contents API (`GET /data/v1/projects/{pid}/folders/{folderId}/contents`) returnerar redan all information vi behover! Varje item i svaret har:

```text
data[].relationships.tip.data.id = "urn:adsk.wipprod:fs.file:vf.xxx?version=N"
```

Det ar precis den `versionUrn` vi behover for Model Properties API. Dessutom finns det ett `included`-falt i svaret som innehaller:

```text
included[].relationships.derivatives.data.id = base64-encoded derivative URN
```

Vi behover alltsa INGA extra API-anrop -- bara extrahera data fran det svar vi redan far.

### Andringar i `list-folders` (acc-sync/index.ts, rad 942-953)

Nuvarande kod extraherar bara `id`, `name`, `type`, `size`, `createTime` fran varje item. Vi utökar med:

```text
versionUrn: item.relationships?.tip?.data?.id || null
derivativeUrn: included?.find(v => v.id === versionUrn)?.relationships?.derivatives?.data?.id || null
```

Ingen ny endpoint behövs, inget permissions-problem.

---

## Del 2: sync-bim-data med Model Properties API

Samma flode som i den godkanda planen, men nu med versionUrn direkt fran folder contents:

1. Anvandaren klickar "Synka BIM-data" pa en mapp
2. Items har redan versionUrn fran list-folders
3. Edge function anropar Model Properties API:
   - POST `indexes:batch-status` med versionUrns
   - Polla tills FINISHED
   - Hamta fields + properties
   - Filtrera ut Levels och Rooms
4. Upserta till assets-tabellen

### Teknisk forandring

`sync-bim-data` actionet behover INTE langre hamta versionUrn -- det skickas med fran UI:t som redan har det fran list-folders.

---

## Del 3: 3D-modeller fran ACC till XKT

### Bakgrund

Nar en RVT/IFC-fil laddas upp till ACC konverteras den automatiskt till SVF2-format (Autodesks 3D-visningsformat). Vi behover fa den till XKT-format for att anvanda i xeokit-viewern i Geminus.

### Konverteringskedjan

```text
RVT/IFC (original i ACC)
    |
    v
SVF2 (konverteras automatiskt av ACC vid uppladdning)
    |
    v  [svf-utils / forge-convert-utils]
glTF 2.0 (oppet 3D-format)
    |
    v  [convert2xkt]
XKT (xeokit-format, redan anvant i Geminus)
```

### Tre alternativ for 3D-visning

#### Alternativ A: SVF2 --> glTF --> XKT (rekommenderat)

**Verktyg:**
- `svf-utils` (npm: svf-utils, av Petr Broz): Konverterar SVF2 till glTF. Stödjer SVF2 direkt med kommandot `svf2-to-gltf`.
- `convert2xkt` (npm: @xeokit/xeokit-convert): Konverterar glTF till XKT.

**Flode:**
1. Hamta derivative URN fran folder contents (redan tillgangligt i `included`-arrayen)
2. En ny edge function laddar ner SVF2-datat via Model Derivative API
3. Konverterar SVF2 till glTF (med svf-utils)
4. Konverterar glTF till XKT (med convert2xkt)
5. Laddar upp XKT till Supabase Storage (befintlig `xkt-models`-bucket)

**Fordelar:**
- Anvander befintlig xeokit-viewer -- ingen ny viewer behövs
- Automatisk pipeline -- klicka "Konvertera" och vanta
- Samma visningssatt som idag

**Utmaning:**
- Kräver Node.js-runtime (edge functions kör Deno, inte Node.js)
- `svf-utils` och `convert2xkt` ar Node.js-paket
- Losning: En separat konverteringstjänst, eller anvanda Autodesks experimentella AWS-baserade tjänst

#### Alternativ B: Autodesks experimentella SVF-till-glTF-tjänst

Autodesk har en offentlig experimentell tjänst (`aps-extra-derivatives`) som konverterar SVF direkt till glTF/GLB/USDZ via ett REST-API.

```text
POST https://m5ey85w3lk.execute-api.us-west-2.amazonaws.com/...
```

**Flode:**
1. Skicka derivative URN till tjänsten
2. Vanta pa konvertering
3. Ladda ner glTF-resultatet
4. Konvertera till XKT med convert2xkt
5. Ladda upp till Supabase Storage

**Fordelar:**
- Slipper kora svf-utils sjalv
- REST-API som gar att anropa fran edge function

**Utmaning:**
- "Experimentell" -- kan forsvinna eller andras
- Stödjer mojligtvis inte SVF2 (bara SVF1)
- Fortfarande behover convert2xkt koras nagonstans

#### Alternativ C: Autodesk Viewer (backup)

Integrera Autodesks egen Viewer SDK direkt i Geminus. Modellerna visas direkt fran ACC utan konvertering.

**Flode:**
1. Hamta derivative URN fran folder contents
2. Ladda Autodesk Viewer SDK i browsern
3. Visa modellen direkt

**Fordelar:**
- Ingen konvertering behovs
- Alltid senaste versionen av modellen
- Stödjer alla Autodesk-format

**Nackdelar:**
- Kräver en andra viewer i Geminus (bade xeokit och Autodesk Viewer)
- Annorlunda UX -- tva olika 3D-visningssatt
- Kräver Autodesk-inloggning for att visa modeller
- Mer komplex kodbas

### Rekommendation

**Steg 1 (nu):** Implementera BIM-synk (Del 1 + 2) for att hamta byggnadsstruktur (plan, rum) fran Model Properties API. Detta behöver inte 3D-konvertering.

**Steg 2 (nasta):** Undersök Alternativ A (SVF2 --> glTF --> XKT) genom att bygga en test-pipeline. De tva huvudsakliga utmaningarna ar:
- Kora `svf-utils` i Deno (edge function) -- kan behova en extern tjanst
- Kora `convert2xkt` for att fa slutligt XKT-format

**Steg 3 (backup):** Om konverteringspipelinen visar sig for komplex, implementera Alternativ C (Autodesk Viewer) som ett sekundart visningslage i Geminus.

---

## Andringslista for denna sprint

### Prioritet 1: BIM-hierarki (Building, Storey, Space)

| Fil | Andring |
|-----|---------|
| `supabase/functions/acc-sync/index.ts` | Utoka `list-folders` att extrahera `versionUrn` och `derivativeUrn` fran befintligt folder contents-svar |
| `supabase/functions/acc-sync/index.ts` | Nytt `sync-bim-data` action med Model Properties-flödet |
| `src/components/settings/ApiSettingsModal.tsx` | "Synka BIM-data"-knapp med progress |

### Prioritet 2: 3D-modellkonvertering (framtid)

| Fil | Andring |
|-----|---------|
| Ny edge function eller extern tjanst | SVF2-nedladdning + glTF-konvertering |
| Ev. ny edge function | glTF --> XKT-konvertering |
| Befintlig XKT-cache | Lagring av konverterade modeller |

### Implementationsordning

1. Utoka `list-folders` med versionUrn/derivativeUrn fran befintligt svar
2. Implementera `sync-bim-data` action (Model Properties-flödet)
3. Lagga till synk-knapp i UI
4. Testa med "Jonkoping Science Tower"
5. (Framtid) Prototyp for SVF2 --> glTF --> XKT-pipeline

