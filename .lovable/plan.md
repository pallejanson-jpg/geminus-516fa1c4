

# Fix Data Consistency + 3D Conversion from ACC

## Problem 1: ACC-synkade byggnader raderas vid "Synka & rensa"

**Grundorsak:** ACC-synkade objekt (t.ex. "Stadshuset Nyköping") sparas med `is_local = false` och `source: acc-bim` i attributes. Men orphan-rensningen i `asset-plus-sync` filtrerar bara på `is_local = false` -- den vet inte att ACC-objekt inte ska finnas i Asset+. Resultatet: allt som finns lokalt men inte i Asset+ raderas, inklusive ACC-data.

**Databas idag:**
- 12 byggnader, varav 11 kommer från Asset+ och 1 ("Stadshuset Nyköping") kommer from ACC (`fm_guid` borjar med `acc-bim-`)

### Losning

Uppdatera `check-delta` och `sync-with-cleanup` samt `sync-structure` i `asset-plus-sync/index.ts` sa att de **exkluderar** objekt vars `fm_guid` borjar med `acc-bim-` (alternativt kollar `attributes->>'source' = 'acc-bim'`). Den enklaste och mest robusta metoden ar att filtrera pa `fm_guid NOT LIKE 'acc-bim-%'` eftersom alla ACC-objekt har detta prefix.

**Andringar i `supabase/functions/asset-plus-sync/index.ts`:**

1. **`check-delta`** (rad ~1474): Lagg till `.not('fm_guid', 'like', 'acc-bim-%')` i den lokala rakningen sa att ACC-objekt inte raknas med i diskrepansen.

2. **`sync-with-cleanup`** (rad ~1552): I `fetchAllLocalFmGuids`-anropet, eller direkt efter, filtrera bort fm_guids som borjar med `acc-bim-` fran orphan-listan.

3. **`sync-structure`** (rad ~680): Samma fix -- filtrera bort `acc-bim-*` fran orphan-listan.

4. **`fetchAllLocalFmGuids`**: Lagg till en valfri `excludePrefix`-parameter sa att funktionen kan exkludera ACC-prefixade GUIDs.

5. **Uppdatera bannerns knapptext**: Andra "Synka & rensa" till "Synka med Asset+" for tydlighet, och visa ett informationsmeddelande om ACC-data inte paverkas.

---

## Problem 2: 3D-konvertering fran ACC fungerar inte

Det finns **tva troliga orsaker**:

### 2a: OBJ-format stods inte av Autodesk for Revit-filer

Autodesk Model Derivative API stoder **inte** OBJ-output for Revit (.rvt) filer -- bara SVF/SVF2. OBJ stods bara for enkla formaten (DWG, STEP, etc.). Nar vi skickar `{ type: "obj" }` ignoreras det eller misslyckas tyst, och vi hamnar med enbart SVF2-derivatives som klientkonverteraren inte kan lasa.

### 2b: SVF2-derivatives ar inte nedladdningsbara som en fil

SVF2 ar ett multi-fil "bubble"-format med tusentals small chunks. Nar vi valjer en SVF2-derivat-URN och forsoker ladda ner den som en enda fil, far vi antingen en JSON-manifest eller en liten chunk -- inte nagon geometry-fil.

### Losning: Anvand SVF2-to-XKT konvertering via servern

Den korrekta pipelinen for Revit-filer ar:

1. Oversatt till SVF2 (behall nuvarande)
2. Ladda ner **hela SVF2-bubblan** (alla filer i manifestet)
3. Konvertera SVF2 till XKT med `@xeokit/xeokit-convert`s `parseSVF2IntoXKTModel` (kravs server-side)

**Men** detta ar komplext och kravs mycket minne. Ett enklare alternativ:

**Alternativ: Anvand Autodesk APS Viewer SDK for att visa modellen direkt (utan XKT-konvertering)**

Det enklaste ar att gora 3D-konverteringen till ett **informativt felmeddelande** som forklarar begransningen, och istallet prioritera att ACC-synkad hierarkidata fungerar korrekt.

### Andringar i `supabase/functions/acc-sync/index.ts`:

1. **`translate-model`**: Ta bort `{ type: "obj" }` fran output-formaten (det fungerar inte for RVT). Behall bara `{ type: "svf2", views: ["3d"] }`.

2. **`download-derivative`**: Nar endas SVF2-derivatives hittas, returnera ett tydligt felmeddelande: "RVT-filer kan for narvarande inte konverteras till XKT. SVF2-format kraver serverbaserad konvertering."

3. Logga tydligt vilka derivatives som finns tillgangliga sa att problemet kan felsökas.

### Andringar i `src/services/acc-xkt-converter.ts`:

1. Forbattra felmeddelandet i `detectFormat` nar `unknown` format upptacks -- visa exakt vilka bytes som hittades.

### Andringar i `src/components/settings/ApiSettingsModal.tsx`:

1. Visa ett tydligare felmeddelande nar 3D-konvertering misslyckas for RVT-filer, med forklaring att formatet inte stods annu.

---

## Sammanfattning

| Fil | Andring |
|---|---|
| `supabase/functions/asset-plus-sync/index.ts` | Exkludera ACC-objekt (`acc-bim-*`) fran orphan-rensning och delta-check |
| `supabase/functions/acc-sync/index.ts` | Ta bort OBJ-format, forbattra derivative-logging och felmeddelanden |
| `src/services/acc-xkt-converter.ts` | Battre felmeddelanden for okanda format |
| `src/components/settings/ApiSettingsModal.tsx` | Tydligare UI-feedback vid 3D-konverteringsfel |
| `src/components/common/DataConsistencyBanner.tsx` | Uppdatera knapptext for tydlighet |

