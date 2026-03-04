

# Plan: 12 fixes och förbättringar

## 1. Egenskapsdialog → fast sidopanel istället för flytande dialog
**Fil:** `src/components/common/UniversalPropertiesDialog.tsx`

Ersätt den nuvarande flytande dialogen (desktop) med en fast panel som glider in från höger, liknande Visningsmenyn i 3D. Behåll Sheet-implementationen för mobil.

- Ta bort floating dialog-koden (backdrop, drag, resize) på desktop
- Ersätt med en `fixed inset-y-0 right-0 w-80` panel med `animate-in slide-in-from-right`
- ScrollArea inuti för skrollbart innehåll
- Stäng-knapp med bakåtpil (se punkt 8)

## 2. Flytta Globe i sidomenyn — mellan Navigator och 3D View
**Fil:** `src/lib/sidebar-config.ts`

Ändra ordningen i `SIDEBAR_ITEM_META` så att `globe` hamnar direkt efter `navigation` och före `native_viewer`. Objektordningen i Record styr renderingen.

## 3. Cesium Globe — prestandafix och label vid klick
**Fil:** `src/components/globe/CesiumGlobeView.tsx`

- **Desktop-label saknas vid klick:** Klickhanteraren sätter `selectedBuilding` med popupdata men det visas bara om `selectedBuilding` finns — behöver verifiera att click-handler inte blockeras av `window.addEventListener('click', close)` (rad 374). Lösningen: lägg till `e.stopPropagation()` i viewer-click-hanteraren.
- **Prestanda:** Begränsa `postRender`-eventlyssnaren med throttle (requestAnimationFrame). Undvik att skapa nya objekt i varje render-frame. Minska render resolution med `viewer.resolutionScale = 0.75` på desktop.

## 4. Cesium — större pins och byggnadsnamn i Norden-läget
**Fil:** `src/components/globe/CesiumGlobeView.tsx`

- Öka `pixelSize` från `10` till `14` (normal) och `14` till `18` (selected)
- Öka label font från `11px` till `13px`
- Justera `scaleByDistance` `NearFarScalar` så pinnar syns bättre vid hög höjd: ändra far-scale från `0.6`/`0.5` till `0.8`/`0.7`

## 5. Flytta Support till Help Center → flik "Register Case"
**Filer:** `src/components/layout/RightSidebar.tsx`, `src/lib/sidebar-config.ts`

- Ta bort `support` från `SIDEBAR_ITEM_META` (den ska inte vara en egen menypost)
- Lägg till en ny flik "Support" i `RightSidebar.tsx` TabsList som renderar `CustomerPortalView` (eller en förenklad variant med `SupportCaseList` + create-knapp)
- Byt "Nytt ärende"-knappens text till "Register Case"

## 6. Support JWT — automatisera token-uppdatering
**Fil:** `supabase/functions/support-proxy/index.ts`

Problemet: SWG JWT går ut och kan inte förnyas automatiskt. Lösning:
- Lägg till en `login`-action i edge function som hämtar ny JWT med `SWG_SUPPORT_USERNAME` och `SWG_SUPPORT_PASSWORD` via SWG:s login-API
- Vid 401-svar: automatiskt försöka logga in igen och göra om anropet (retry-loop)
- Kräver att vi vet SWG:s login-endpoint — behöver undersöka/fråga om detta

**Alternativ:** Om SWG har en token-endpoint, implementera auto-refresh. Om inte, behöver vi veta login-URL:en.

## 7. "Öppna i 3D" från AssetsList fungerar inte
**Fil:** `src/components/portfolio/PortfolioView.tsx`

`handleOpen3DRoom` sätter `viewer3dFmGuid` till assetens fmGuid, men `NativeViewerPage` söker i `allData` — och Instance-assets finns inte alltid i `allData` (som bara innehåller struktur). 

Fix: I `handleOpen3DRoom`, resolva building GUID från assetens `building_fm_guid` först:
```typescript
const handleOpen3DRoom = (fmGuid: string, levelFmGuid?: string) => {
  // For assets: resolve to building GUID
  const item = allData.find(a => a.fmGuid === fmGuid);
  const buildingGuid = item?.buildingFmGuid || showAssetsFor?.fmGuid;
  setViewer3dFmGuid(buildingGuid || fmGuid);
  setActiveApp('native_viewer');
  setShowRoomsFor(null);
  setShowAssetsFor(null);
};
```

## 8. Alla stäng-knappar → enhetlig bakåtpil
**Filer:** `AssetsView.tsx`, `RoomsView.tsx`, `FacilityLandingPage.tsx`, `UniversalPropertiesDialog.tsx` m.fl.

Byt ut alla `<X>` (kryss) stäng-knappar mot `<ArrowLeft>` (bakåtpil) för konsekvens. Gäller headers i alla overlay-vyer.

## 9. Sticky kolumnrubriker i detaljerade listor
**Filer:** `src/components/portfolio/AssetsView.tsx`, `src/components/portfolio/RoomsView.tsx`

Tabellen har redan `sticky top-0` på `TableHeader` (rad 930), men den ligger inuti en `ScrollArea` som wrappar hela contentet. Problemet: `Table`-komponenten wrappar tabellen i en `div.overflow-auto`, och `ScrollArea` scrollar utanför.

Fix: Flytta `ScrollArea` att wrappa bara table-body, eller ändra table-strukturen så thead ligger utanför scroll-containern. Alternativt: använd CSS `position: sticky` med `top: 0` och se till att det yttre overflow-elementet är rätt.

## 10. Sortering går långsamt i detaljerade listor
**Fil:** `src/components/portfolio/AssetsView.tsx`

`filteredAssets` `useMemo` har `visibleColumns` som dependency — varje kolumn-toggle orsakar omberäkning. Sorteringen anropas med `.sort()` (in-place mutation risk) i useMemo.

Fix:
- Optimera `filteredAssets` memo genom att separera filter och sort
- Använd `useDeferredValue` eller `startTransition` för search-input
- Debounce sök-input (300ms)

## 11. Asset+ Create: "External Type is required" fel
**Fil:** `supabase/functions/asset-plus-create/index.ts`

Loggarna visar: `AddObjectList failed: External Type is required., External Type is not a valid category.`

Problemet: Asset+ API kräver ett `ExternalType`-fält i BimObject-payloaden för att identifiera objektkategorin (t.ex. "Brandsläckare"). 

Fix: Lägg till `ExternalType` i BimObject-payloaden:
```typescript
BimObject: {
  ObjectType: ObjectType.Instance,
  Designation: item.designation,
  CommonName: item.commonName || item.designation,
  ExternalType: item.commonName || item.designation, // Required by Asset+
  APIKey: apiKey,
  FmGuid: fmGuid,
  UsedIdentifier: 1,
},
```

Dessutom behöver vi stödja att icke-modell-assets (`created_in_model = false`) sorteras under rätt modell i Asset+. Lägg till logik för att bestämma parent: om asseten har ett `in_room_fm_guid`, använd det. Om rummet tillhör en modell (t.ex. A-modellen), sätts relationen korrekt.

## 12. Sök assets — prestanda
**Fil:** `src/components/portfolio/AssetsView.tsx`

Sökningen itererar alla synliga kolumner för varje asset. 

Fix: Debounce sök-input med 300ms och använd `React.startTransition` vid uppdatering av searchQuery.

---

## Sammanfattning av filer som ändras

| # | Ändring | Filer |
|---|---------|-------|
| 1 | Egenskapsdialog → sidopanel | `UniversalPropertiesDialog.tsx` |
| 2 | Globe i meny-ordning | `sidebar-config.ts` |
| 3-4 | Cesium prestanda + pins | `CesiumGlobeView.tsx` |
| 5 | Support → Help Center | `RightSidebar.tsx`, `sidebar-config.ts` |
| 6 | JWT auto-refresh | `support-proxy/index.ts` |
| 7 | Öppna i 3D fix | `PortfolioView.tsx` |
| 8 | Bakåtpil konsekvens | Flera vyer |
| 9 | Sticky headers | `AssetsView.tsx`, `RoomsView.tsx` |
| 10+12 | Sökprestanda | `AssetsView.tsx` |
| 11 | Asset+ ExternalType | `asset-plus-create/index.ts` |

