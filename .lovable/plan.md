

# Plan: FMA+ iframe restore, FMA 2.0 ny knapp, Cesium byggnadsväljare, Våningskarusell med herobilder

## 1. Återställ FMA+ till iframe-baserad vy

**Filer:** `MainContent.tsx`, `LeftSidebar.tsx`, `MobileNav.tsx`, `sidebar-config.ts`

- Ändra `fma_plus` case i `MainContent.tsx` att rendera `FmaInternalView` med URL från `appConfigs.fma_plus.url` (som redan har default `https://swg-demo.bim.cloud/`), istället för `FmAccessNativeView`
- Ta bort "force FMA+ to internal" logiken i `LeftSidebar.tsx` och `MobileNav.tsx` — låt det falla tillbaka till config-baserad routing (öppna iframe internt)
- Ändra `fma_plus` type tillbaka till `'config'` i `sidebar-config.ts`

## 2. Lägg till FMA 2.0 som ny menypost

**Filer:** `sidebar-config.ts`, `constants.ts`, `MainContent.tsx`

- Lägg till `fma_native` i `SIDEBAR_ITEM_META` med label "FMA 2.0", icon `Building2`, type `'internal'`
- Lägg till `fma_native` i `DEFAULT_SIDEBAR_ORDER` efter `fma_plus`
- Lägg till `case 'fma_native'` i `MainContent.tsx` som renderar `FmAccessNativeView`
- Lägg till `'fma_native'` i `FILL_APPS`

## 3. Undersök FMA 2.0-problem

`FmAccessNativeView` anropar `getHierarchy(buildingFmGuid)` men om `selectedFacility` inte har `fm_guid` eller `fm_access_building_guid`, visas ingenting. Trolig orsak: inget byggnadssammanhang sätts när man öppnar FMA 2.0 fristående. 

Fix: Visa en byggnadsväljare om `buildingFmGuid` saknas, med lista över tillgängliga byggnader från `navigatorTreeData`.

## 4. Cesium: Byggnadsväljare-sidebar (som i MapView)

**Fil:** `CesiumGlobeView.tsx`

Lägg till en `BuildingSidebar`-komponent (liknande den i `MapView.tsx`) med sökfunktion och byggnadslista. Vid klick på en byggnad → flyg till pinnens position och sätt `selectedFmGuid`.

Implementera som en intern komponent i CesiumGlobeView som använder `facilities`-arrayen.

## 5. Våningskarusell med herobilder (FacilityLandingPage)

**Fil:** `FacilityLandingPage.tsx`

Ersätt de nuvarande pill-tabs (rad 692-710) med bildkort-karusell:
- Varje `CarouselItem` visar en bild + våningsnamn som overlay
- Använd `BUILDING_IMAGES` (5 bilder) som pool, tilldela slumpmässigt per våning med `useMemo` baserat på `storey.fmGuid` (hashbaserat för konsistens)
- Kort: `w-36 h-24 rounded-xl overflow-hidden` med gradient-overlay och namn i botten
- Markera vald våning med `ring-2 ring-primary`

---

## Sammanfattning

| # | Ändring | Filer |
|---|---------|-------|
| 1 | FMA+ → iframe igen | `MainContent.tsx`, `LeftSidebar.tsx`, `MobileNav.tsx`, `sidebar-config.ts` |
| 2 | FMA 2.0 ny knapp | `sidebar-config.ts`, `constants.ts`, `MainContent.tsx` |
| 3 | FMA 2.0 empty state fix | `FmAccessNativeView.tsx` |
| 4 | Cesium byggnadsväljare | `CesiumGlobeView.tsx` |
| 5 | Våningskarusell med bilder | `FacilityLandingPage.tsx` |

