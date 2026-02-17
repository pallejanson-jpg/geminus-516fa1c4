

## Plan: OBJ-laddning direkt i xeokit via GLTFLoaderPlugin/OBJLoaderPlugin

Istallet for att konvertera OBJ till GLB till XKT kan vi ladda OBJ-filer (eller GLB-filer) direkt i xeokit-viewern med hjalp av dess inbyggda loader-plugins. Detta forenklar ACC-pipelinen avsevart.

---

### Bakgrund och strategi

Nuvarande pipeline: ACC OBJ-export -> edge function konverterar OBJ till minimal GLB -> klient laddar ner GLB -> konverterar till XKT -> sparar XKT -> AssetPlusViewer laddar XKT.

Forenklad pipeline: ACC OBJ-export -> edge function sparar OBJ direkt till storage -> klient laddar OBJ direkt i xeokit via OBJLoaderPlugin (eller behaller GLB och laddar via GLTFLoaderPlugin).

**Rekommendation:** Behall den befintliga GLB-konverteringen pa servern (den fungerar redan) men skippa XKT-steget pa klienten. Ladda GLB direkt via xeokits `GLTFLoaderPlugin` istallet. Detta ar enklare och mer robust an att ladda ra OBJ, och GLB-formatet bevarar material och normals battre.

Alternativt kan vi ocksa testa ren OBJ-laddning via `OBJLoaderPlugin` for maximal enkelhet (hoppa over GLB-konverteringen helt).

---

### Vad som andras

#### 1. Ny laddningslogik i AssetPlusViewer

Nar en ACC-derivatmodell finns i storage som GLB (eller OBJ) istallet for XKT, ladda den direkt via xeokits loader-plugin.

**I `AssetPlusViewer.tsx`**, efter att xeokit-viewern ar initialiserad:

```text
1. Kolla om byggnaden har ACC-modeller i storage (via xkt_models-tabellen, kolumn format)
2. Om format = 'glb': anvand GLTFLoaderPlugin for att ladda fran signerad URL
3. Om format = 'obj': anvand OBJLoaderPlugin for att ladda fran signerad URL
4. Behall befintlig XKT-laddning for Asset+-modeller (ingen andrring)
```

**Pseudokod:**
```typescript
// Ladda ACC-modell direkt utan XKT-konvertering
const sdk = await import(XEOKIT_CDN);
const gltfLoader = new sdk.GLTFLoaderPlugin(xeokitViewer);
gltfLoader.load({
  id: `acc-${modelId}`,
  src: signedGlbUrl,
  edges: true,
});
```

#### 2. Uppdatera edge-funktionen (valfritt steg 2)

Tva alternativ:

**Alt A - Behall GLB (rekommenderat):** Behall `convertObjToGlb` i `acc-svf-to-gltf`. Servern laddar upp GLB som vanligt, men klienten skippar XKT-konvertering och laddar GLB direkt.

**Alt B - Spara OBJ direkt:** Ta bort `convertObjToGlb`, spara OBJ-texten direkt till storage. Klienten laddar via `OBJLoaderPlugin`.

#### 3. Uppdatera xkt_models-tabellen

Lagg till en `format`-kolumn for att skilja mellan XKT- och GLB/OBJ-modeller:

```sql
ALTER TABLE xkt_models ADD COLUMN IF NOT EXISTS format TEXT DEFAULT 'xkt';
```

#### 4. Uppdatera klientens laddningsflode

I `acc-xkt-converter.ts`, metoden `convertAndStore`:
- Ta bort XKT-konverteringssteget
- Spara GLB direkt till storage med `format: 'glb'` i databasen
- Returnera URL direkt

I `AssetPlusViewer.tsx`, i XKT-cache-interceptorn eller `handleAllModelsLoaded`:
- Kolla om det finns ACC-modeller med `format: 'glb'` for byggnaden
- Ladda dem via GLTFLoaderPlugin parallellt med Asset+-modellerna

---

### Filer som andras

| Fil | Andring |
|-----|---------|
| `xkt_models` (databas) | Lagg till kolumn `format TEXT DEFAULT 'xkt'` |
| `src/services/acc-xkt-converter.ts` | Ta bort `convertGlbToXkt`-anropet i `convertAndStore`, spara GLB direkt |
| `src/components/viewer/AssetPlusViewer.tsx` | Lagg till GLTFLoaderPlugin-laddning for ACC-modeller efter viewer-init |
| `src/services/xkt-cache-service.ts` | Uppdatera queries for att inkludera `format`-kolumnen |

### Begransningar och risker

- **OBJ fran ACC for RVT-filer:** Autodesk Model Derivative API stodjer inte OBJ-export for RVT-filer (returnerar 400/403). Denna losning fungerar bara for filtyper som stodjer OBJ-export (IFC, DWG, NWD). For RVT behover vi IFC-exporten istallet.
- **Prestanda:** GLB/OBJ-laddning ar langsammare an XKT for stora modeller (XKT ar optimerat for xeokit). For POC/test ar detta acceptabelt, men for produktion med stora modeller rekommenderas XKT.
- **Metadata:** OBJ-format saknar BIM-metadata (IFC-typer, fmGuids). GLB fran OBJ-konvertering har ocksa minimal metadata. Asset+-modellerna (XKT) fortsatter att ge metadata.

