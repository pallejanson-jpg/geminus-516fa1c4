

# Plan: Skippa IFC och optimera 3D-pipelinen

## Bakgrund

Nuvarande pipeline begär redan SVF+OBJ från Autodesk (inte IFC), men vid nedladdning prioriteras IFC om den finns. Dessutom kräver IFC-konvertering i webbläsaren `web-ifc` WASM-laddning vilket är tungt. Genom att helt skippa IFC och istället prioritera OBJ/glTF sparas tid i varje steg.

## Ändringar

### 1. Backend: Ändra derivat-prioritet (`supabase/functions/acc-sync/index.ts`)

I `download-derivative`-sektionen (rad ~2093-2123):

**Nuvarande ordning:** IFC -> glTF -> OBJ

**Ny ordning:** glTF -> OBJ (skippa IFC helt)

- Ta bort sökningen efter IFC-derivat
- Ändra `derivUrn = ifcDeriv?.urn || gltfDeriv?.urn || objDeriv?.urn` till `derivUrn = gltfDeriv?.urn || objDeriv?.urn`
- Uppdatera loggningen som visar valt format

### 2. Frontend: Ta bort IFC-konvertering (`src/services/acc-xkt-converter.ts`)

- I `loadXeokitConvert()` (rad 37): ta bort import av `parseIFCIntoXKTModel`
- I `convertGlbToXkt()` (rad 100-114): ta bort hela IFC-grenen som laddar `web-ifc` WASM
- I `detectFormat()`: behåll IFC-detektering men kasta ett tydligt fel om IFC påträffas ("IFC-format stöds inte, använd OBJ/glTF")
- Detta gör att webbläsaren aldrig behöver ladda den tunga `web-ifc`-modulen

### 3. Serverkonvertering: Skippa IFC-export (`supabase/functions/acc-svf-to-gltf/index.ts`)

Redan korrekt -- begär OBJ, inte IFC. Ingen ändring behövs här.

### 4. (Framtida möjlighet) OBJLoaderPlugin i viewern

XEO-utvecklaren nämner att xeokit kan ladda OBJ direkt via `OBJLoaderPlugin`. Detta skulle kunna vara en alternativ väg: ladda OBJ direkt i viewern utan XKT-konvertering. Det sparar konverteringssteget men tappar XKT-cachning. Kan läggas till som fallback senare.

## Sammanfattning

```text
supabase/functions/acc-sync/index.ts:
  - Rad 2093-2123: Ta bort IFC-prioritering, ordning blir glTF -> OBJ

src/services/acc-xkt-converter.ts:
  - Rad 37: Ta bort parseIFCIntoXKTModel-import
  - Rad 100-114: Ta bort IFC-konvertering med web-ifc WASM
  - Behåll OBJ- och GLB-konvertering
```

## Effekt

- Snabbare nedladdning (OBJ/glTF istället för IFC)
- Snabbare klientkonvertering (ingen web-ifc WASM-laddning)
- Mindre minnesanvändning i webbläsaren
- Samma visuella resultat i 3D-viewern

