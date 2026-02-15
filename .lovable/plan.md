

## Fix: 4 problem med mobil-viewer, Insights-navigering och prestanda

### Problem 1: Tillbaka-knapp och navigation forsvinner pa mobil i 3D-vyn
**Rotorsak:** Mobilversionen av UnifiedViewer (`MobileUnifiedViewer`, rad 531-624) anvander `h-screen flex flex-col` men nar AssetPlusViewer renderas inuti kan dess interna innehall gora att viewporten scrollas, varvid den fasta headern och bottom-nav hamnar utanfor synligt omrade.

**Losning:** 
- Lagg till `overflow-hidden` pa mobilens yttre container (`div.h-screen`) for att forhindra scroll.
- Satt `position: fixed` + `inset: 0` pa headern och anvand `z-50` sa att den alltid ligger ovanpa.
- Aven gor `entity_insights` till en immersive app i MainContent sa att parent-containern inte scrollar.

### Problem 2: "Visa"-knappen fungerar inte forran alla cirkeldiagram laddats
**Rotorsak:** `navigateTo3D`-funktionen i BuildingInsightsView anvander `useNavigate()` fran react-router-dom, men Insights renderas inuti `MainContent` (via `activeApp`) -- inte via en React Router-route. Darfor navigerar `navigate('/split-viewer?...')` till en helt ny route som unmountar hela AppLayout och laddar om viewer fran scratch. Det finns ingen direkt koppling till diagram-laddning, men den langa laddtiden ger intrycket att knappen "inte fungerar".

**Losning:**
- Byt fran `navigate('/split-viewer?...')` till att direkt andra `activeApp` till `assetplus_viewer` med ratt building-context via AppContext. Detta undviker full route-navigering och ger snabbare overgangen.
- Alternativt: behall navigate men lagg till en laddningsindikator sa att anvandaren ser att nagonting hander nar de trycker.

### Problem 3: Klick pa diagram farglaggar inte utrymmen/kategorier i 3D
**Rotorsak:** Nar navigateTo3D anropas med `visualization: 'area'` eller utan, sa skickas parametern via URL-query. UnifiedViewer laser `visualizationParam` fran URL:en och skickar det som `initialVisualization` till AssetPlusViewer. Men det finns ingen logik i AssetPlusViewer for att:
1. Farglagga specifika asset-kategorier baserat pa vad anvandaren klickat
2. Aktivera rumsvisualisering automatiskt fran Insights-navigering

**Losning:**
- Utoka `navigateTo3D` sa att klick pa specifika asset-kategorier skickar `assetType`-parameter i URL:en
- I AssetPlusViewer: Las `assetType`-param och markera/farglagg objekt av den typen vid laddning
- For Energy-per-Floor: Navigera till ratt vaning (redan implementerat via `entity`-param)
- For Room Types: Aktivera rumsvisualisering med `visualization=area` (redan implementerat)

### Problem 4: Langa laddtider -- XKT cachas inte vid navigering fran Insights
**Rotorsak:** `useXktPreload` anropas fran `PortfolioView`, `FacilityLandingPage` och `NavigatorView`, men INTE fran `BuildingInsightsView`. Nar anvandaren gar via Insights-floden (Portfolio -> Byggnad -> Insights -> Visa i 3D) triggas aldrig XKT-preloading, sa modellerna maste laddas fran scratch varje gang.

**Losning:** Lagg till `useXktPreload(facility.fmGuid)` i `BuildingInsightsView.tsx`. Eftersom preload-hooken automatiskt skippar redan cacheade byggnader och har en global `Set` for att undvika dubbletter, ar det helt sakert att lagga till.

---

### Tekniska detaljer

**Fil 1: `src/pages/UnifiedViewer.tsx` (MobileUnifiedViewer)**
```text
Rad 558-559:
  NUVARANDE: <div className="h-screen flex flex-col bg-background">
  NYTT:      <div className="fixed inset-0 flex flex-col bg-background z-50">

Rad 560-563 (header):
  Lagg till: className="... shrink-0 z-50"
  Satt headern som sticky/fixed sa den alltid syns
```

**Fil 2: `src/components/insights/BuildingInsightsView.tsx`**
```text
Rad 1-2 (imports):
  + import { useXktPreload } from '@/hooks/useXktPreload';

Rad 80 (efter useNavigate):
  + useXktPreload(facility.fmGuid);

Rad 158-163 (navigateTo3D):
  Uppdatera sa att asset-typ skickas som query-param
  nar klick kommer fran Asset Categories-diagrammet
```

**Fil 3: `src/components/layout/MainContent.tsx`**
```text
Rad 25:
  Lagg till 'entity_insights' i IMMERSIVE_VIEWER_APPS
  (forhindrar parent-scroll nar insights visas pa mobil -- inte nodvandigt om viewern fixas)
```

### Prioritetsordning
1. **XKT preload i Insights** (1 rad kod, storst effekt pa upplevd hastighet)
2. **Fixed mobile viewer container** (forhindrar att back-knapp och nav forsvinner)
3. **Asset-typ query-param** (forbatter visuell feedback vid navigering fran diagram)
4. **Laddningsindikator** (ger feedback nar "Visa" trycks)

### Sammanfattning
- 3 filer andras: `BuildingInsightsView.tsx`, `UnifiedViewer.tsx`, eventuellt `MainContent.tsx`
- Storsta vinsten: 1 rad `useXktPreload(facility.fmGuid)` i Insights-vyn
- Mobil-viewern gors `fixed inset-0` for att eliminera scroll-problem
- Asset-kategoriklick i diagram far `assetType`-parameter for 3D-filtrering
