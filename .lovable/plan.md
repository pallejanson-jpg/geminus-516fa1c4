

## Plan: Snabb favorit-visning + IFC-pipeline for ACC

Tva separata forbattringar: (1) eliminera fordrojningen i My Favorites, och (2) byt ACC-pipelinen fran OBJ till IFC.

---

### Del 1: Snabb favorit-visning

**Problem:** `fetchLocalAssets` laser fran `assets`-tabellen (inte Asset+ API), men paginerar genom tusentals rader vid uppstart. `favoriteBuildings` i HomeLanding kraver BADE `navigatorTreeData` (langsam) OCH `favorites` (snabb), sa allt blockas av den langsamma laddningen. Under tiden blinkar "No favorites yet".

**Losning:** Cachelagra favoritbyggnader i localStorage sa de visas direkt. Uppdatera nar aktuell data ar klar.

**Filandringar:**

**`src/components/home/HomeLanding.tsx`:**
- Vid mount: las cachead favoritdata fran `localStorage` (`geminus-fav-buildings-cache`)
- Visa cachad data omedelbart i UI
- Nar `navigatorTreeData` OCH `favorites` ar klara: berakna `favoriteBuildings` som idag, uppdatera UI, och skriv ny cache till localStorage
- Sa lange VARKEN cache ELLER beraknad data finns, visa en skeleton-loader (inte "No favorites yet")
- Visa "No favorites yet" ENBART om data har laddats klart och inga favoriter finns

**`src/hooks/useAllBuildingSettings.ts`:**
- Ingen andring kravs (redan snabb)

---

### Del 2: ACC IFC-pipeline

**Problem:** OBJ-export stods inte for RVT-filer i Autodesk API (400/403). Pipelinen fastnar.

**Losning:** Byt till IFC-export som primarformat for ACC-derivat. IFC stods for RVT och innehaller BIM-metadata. Sedan konverteras IFC till XKT klientsidigt via `@xeokit/xeokit-convert` (befintlig logik i `convertGlbToXkt` hantera redan IFC-format).

**Filandringar:**

**`supabase/functions/acc-svf-to-gltf/index.ts`:**
- Strategi 2 (rad ~445): Byt fran `{ type: "obj" }` till `{ type: "ifc" }` i translation job-anropet
- Uppdatera polling-logiken for att leta efter IFC-output istallet for OBJ
- Nar IFC ar klar: ladda ner IFC-filen, ladda upp direkt till storage (inget behov av GLB-konvertering pa servern)
- Ta bort eller behall OBJ-konverteringen som fallback

**`src/services/acc-xkt-converter.ts`:**
- I `convertAndStore`: Nar format ar `ifc`, konvertera till XKT via befintlig `convertGlbToXkt` (som redan har IFC-gren, rad 101-116) istallet for att spara direkt
- Sparar sedan XKT-filen med `format: 'xkt'` i databasen
- Detta ger battre prestanda i viewern (XKT ar optimerat for xeokit) OCH bevarar BIM-metadata

Flode efter andring:

```text
RVT fil i ACC
  -> Autodesk Model Derivative API: exportera IFC
  -> Edge function: ladda ner IFC, spara i storage
  -> Klient: hamta IFC, konvertera till XKT via xeokit-convert WASM
  -> Spara XKT i storage
  -> Viewer laddar XKT som vanligt
```

---

### Tekniska detaljer

**localStorage-cache for favoriter:**
```typescript
const CACHE_KEY = 'geminus-fav-buildings-cache';
// Sparar: { buildings: FavoriteBuilding[], timestamp: number }
// Visar cachad data vid mount, uppdaterar efter datahamtning
```

**IFC translation job (edge function):**
```typescript
// Byter fran:
output: { formats: [{ type: "obj" }] }
// Till:
output: { formats: [{ type: "ifc" }] }
```

**IFC->XKT konvertering (redan implementerad i convertGlbToXkt):**
- Anvander `parseIFCIntoXKTModel` fran `@xeokit/xeokit-convert`
- Kraver web-ifc WASM-filer i `/lib/xeokit/` (behover verifieras att de finns)

### Risker

- **web-ifc WASM**: IFC-konverteringen kraver WASM-filer (`web-ifc.wasm`). Om dessa inte finns i `/public/lib/xeokit/` kommer konverteringen misslyckas. Vi behover verifiera eller ladda ner dem.
- **IFC-filstorlek**: IFC-filer ar vanligtvis storre an OBJ, sa nedladdningen tar langre. Men slutresultatet (XKT) ar mer optimerat.
- **Edge function timeout**: IFC-translation kan ta langre an OBJ. Befintlig 5-minuters polling-timeout bor racka.

