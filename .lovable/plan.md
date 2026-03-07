

# Plan: Förbättringar, Prestanda & Ilean-integration

## Översikt

Planen adresserar fyra huvudområden: (1) kodkvalitetsförbättringar från självgranskningen, (2) Ilean UI/UX-uppgradering, (3) viewer-prestanda, och (4) buggfixar.

---

## 1. Kodkvalitetsförbättringar

### 1a. Extrahera `normalizeGuid` till `lib/utils.ts`
Funktionen `(g || '').toLowerCase().replace(/-/g, '')` definieras i `useObjectMoveMode.ts` (rad 41) och `ViewerFilterPanel.tsx` (rad 85), plus inline `norm()` varianter i `NativeXeokitViewer.tsx`. Alla ersätts med en enda export från `lib/utils.ts`.

### 1b. Undo-toast efter flytt/radering
I `useObjectMoveMode.ts`:
- Efter lyckad flytt (rad 262): ersätt `toast.success()` med `toast.success('Objekt flyttat', { action: { label: 'Ångra', onClick: () => undoMove(fmGuid, originalOffset, originalRoom) } })`
- Efter radering (rad 323): samma mönster med undo som återställer `modification_status = null` och `visible = true`

### 1c. Bekräftelsedialog vid radering
I `handleDeleteEvent` (rad 296): visa en confirm-dialog innan DB-uppdatering. Använd `window.confirm()` som snabb lösning (inline, ingen extra komponent).

### 1d. Fix color reset vid toggle-av av ändringsfilter
I `ViewerFilterPanel.tsx` rad 1247-1257: när `showMovedAssets` ändras till `false`, kör explicit `recolorArchitectObjects(viewer)` för de påverkade entiteterna istället för att förlita sig på att det "redan sker".

### 1e. Ersätt hårdkodad 2s delay med modell-ready event
I `useObjectMoveMode.ts` rad 80-85: istället för `setTimeout(applyModifications, 2000)`, lyssna på xeokit-viewerns `scene.on('modelLoaded', ...)` event. Fallback: lyssna på custom event `VIEWER_MODELS_LOADED` som dispatchar efter alla modeller laddats i `NativeXeokitViewer.tsx` (rad 494).

---

## 2. Ilean: Native Geminus-UI med Senslinc-koppling

### Problem
Ilean-chatten fungerar via `useIleanData` → `senslinc-query` edge function → Senslinc Ilean API. Backend-logiken är korrekt men UI:t behöver polish.

### Åtgärder
- **IleanButton.tsx**: Behåll Geminus-designspråket (mörkt/glasigt kort, gradient-header, avatar). Förbättra:
  - Tydligare kontext-indikator (visa byggnad/våning/rum med ikon)
  - Bättre laddningsstate med skeleton-animation istället för enkel spinner
  - Sticky input-fält som inte scrollar bort
  - Länk "Öppna i Senslinc" om `contextEntity.dashboardUrl` finns
- **useIleanData.ts**: Ingen förändring i backend-logik, men lägg till `isContextAvailable` boolean som indikerar om Senslinc-koppling finns
- **senslinc-query edge function**: Redan korrekt implementerad med Ilean API-endpoints + Lovable AI fallback. Ingen ändring.

---

## 3. Viewer-prestanda (HÖGSTA PRIORITET)

### 3a. Parallell SDK-laddning + modell-metadata-hämtning
I `NativeXeokitViewer.tsx` rad 60-140: SDK-laddning och DB-queries sker sekventiellt. Ändra till `Promise.all`:
```text
[sdk, modelsFromDb, storageFiles] = await Promise.all([
  loadSDK(),
  supabase.from('xkt_models').select(...),
  supabase.storage.from('xkt-models').list(...)
])
```
Detta sparar ~200-500ms.

### 3b. Viewer-skapning optimering
Skapa viewern direkt efter SDK-import utan att vänta på modelldata. Modelldata kan resolvas parallellt.

### 3c. Snabbare modell-laddning med concurrent loading
Nuvarande `CONCURRENT = 1` (rad 355) är extremt konservativt. Ändra till:
- Desktop: `CONCURRENT = 2` (två modeller samtidigt)
- Mobil: behåll `CONCURRENT = 1`
A-modeller laddas fortfarande först.

### 3d. Modellnamns-resolution: cache i localStorage
Storey-names hämtas från `assets`-tabellen vid varje viewer-öppning. Cache resultatet i `localStorage` med building GUID som nyckel och 1h TTL.

### 3e. Skippa staleness-check vid första laddningen
Rad 308-324 triggar en bakgrunds-synk som kan störa laddningen. Flytta denna till `requestIdleCallback` eller `setTimeout(…, 5000)` så den inte konkurrerar med modell-fetch.

### 3f. Dispatch `VIEWER_MODELS_LOADED` event
I `NativeXeokitViewer.tsx` rad 494-495, dispatcha ett custom event när alla modeller laddats:
```js
window.dispatchEvent(new CustomEvent('VIEWER_MODELS_LOADED', { detail: { buildingFmGuid } }));
```
Används av `useObjectMoveMode` (ersätter 2s delay) och andra hooks.

### 3g. Preload-optimering
I `useXktPreload.ts`: nuvarande preload fetchar signedUrl + binary sekventiellt per modell. Generera alla signedUrls i batch först (parallellt), sedan fetcha binärdata.

---

## 4. 2D/3D Mode-konsistens

### Problem
Desktop och mobil hanterar 2D-knappen olika. Desktop använder `UnifiedViewer` med `mode=2d`, mobil har en annan ingångspunkt.

### Fix
I `UnifiedViewer.tsx`: säkerställ att `VIEW_MODE_REQUESTED_EVENT` dispatchar direkt vid mount om `effectiveInitialMode === '2d'`, inte bara vid ändring. Den nuvarande logiken (rad 130-166) har redan en `__init__` sentinel — verifiera att denna fungerar på mobil genom att kontrollera att `NativeViewerShell` faktiskt tar emot eventet.

---

## Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/lib/utils.ts` | Lägg till `normalizeGuid()` |
| `src/hooks/useObjectMoveMode.ts` | Undo-toast, confirm-dialog, model-ready event |
| `src/components/viewer/ViewerFilterPanel.tsx` | Color reset fix, import normalizeGuid |
| `src/components/viewer/NativeXeokitViewer.tsx` | Parallell laddning, concurrent=2, dispatch event |
| `src/components/chat/IleanButton.tsx` | UI-förbättringar |
| `src/hooks/useIleanData.ts` | `isContextAvailable` flag |
| `src/hooks/useXktPreload.ts` | Batch signedUrl |

## Prioritetsordning
1. Viewer-prestanda (3a-3g) — störst påverkan
2. Buggfixar (1d, 1e, 4)
3. Undo/confirm (1b, 1c)
4. Kodkvalitet (1a)
5. Ilean UI (2)

