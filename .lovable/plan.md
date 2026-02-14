

## Skapa arende i FMA+ (intern vy med flytande arendeknapp)

### Oversikt
Nar anvandaren klickar pa FMA+ i sidomenyn oppnas FM Access-webbklienten som en **intern iframe-vy** (inte i ny flik). Ovanpa iframen visas en flytande "Skapa arende"-knapp (FAB). Nar den klickas oppnas den beprövade `CreateIssueDialog` med metadata om vilken sida/objekt anvandaren tittade pa. Arendet sparas i `bcf_issues`.

Samma logik lags aven till i `FmAccess2DPanel` sa att det ar forberett nar 2D-vyn fungerar.

### Andringar

**1. Ny komponent: `src/components/viewer/FmAccessIssueOverlay.tsx`**

En delad overlay-komponent som renderas ovanpa vilken FM Access-iframe som helst (bade FMA+-dashboarden och 2D-panelen). Den innehaller:
- En flytande knapp (FAB) med `MessageSquarePlus`-ikon och texten "Skapa arende"
- Positionerad langst ned till hoger, ovanfor safe-area pa mobil
- Glasmorfism-stil (semi-transparent, backdrop-blur) som matchar ovriga floating panels
- Pa klick: oppnar `CreateIssueDialog`
- Metadata som skickas med arendet:
  - `building_fm_guid` (fran props)
  - `building_name` (fran props)
  - `viewpoint_json`: `{ source: 'fm_access', floorId, floorName }` (2D-specifikt, eller `{ source: 'fma_plus', url }` for FMA+)
  - Ingen screenshot (CORS blockerar iframe-innehall) -- arendet skapas utan bild men med full kontext

Props:
```typescript
interface FmAccessIssueOverlayProps {
  buildingFmGuid: string;
  buildingName?: string;
  source: 'fma_plus' | '2d_fm_access';
  contextMetadata?: Record<string, any>; // floorId, floorName, url, etc.
}
```

**2. Ny intern vy: `src/components/viewer/FmaInternalView.tsx`**

En fullskarms intern vy som renderas nar `activeApp === 'fma_plus'` och `openMode !== 'external'`. Den:
- Embeddar FM Access webbklient i en iframe (URL fran `appConfigs.fma_plus.url`)
- Rendererar `FmAccessIssueOverlay` ovanpa iframen
- Visar en laddningsindikator medans iframen laddar
- Pa mobil: fullskarm utan header (laggs till i `IMMERSIVE_APPS`-listan i AppLayout)
- Pa desktop: fyller hela main content-omradet

**3. Uppdatera `src/components/layout/MainContent.tsx`**

Lagg till ett `case 'fma_plus'` i renderContent-switchsatsen:
- Rendera `FmaInternalView` med URL och byggnadsdata fran `appConfigs`
- Lazy-ladda komponenten for prestanda

**4. Uppdatera `src/components/layout/LeftSidebar.tsx`**

Andringen ar minimal -- nar `openMode === 'internal'` (eller saknas) sa anropas `setActiveApp('fma_plus')` som redan fungerar. Logiken finns redan pa plats. Standardvardet for `openMode` i `DEFAULT_APP_CONFIGS` andras fran `'external'` till `'internal'` sa att FMA+ oppnas internt som standard.

**5. Uppdatera `src/lib/constants.ts`**

Andra `fma_plus.openMode` fran `'external'` till `'internal'` i `DEFAULT_APP_CONFIGS`.

**6. Uppdatera `src/components/viewer/FmAccess2DPanel.tsx`**

Lagg till `FmAccessIssueOverlay` ovanpa iframen nar `phase === 'ready'`. Den visas langst ned till hoger med kontext om aktuell vaning och byggnad. Forberett for nar 2D-vyn fungerar.

### Flode

```text
Anvandare klickar FMA+ i sidomenyn
  -> MainContent renderar FmaInternalView
     -> iframe laddar FM Access URL
     -> FmAccessIssueOverlay visas ovanpa (FAB-knapp)
        -> Klick pa FAB -> CreateIssueDialog oppnas
           -> Anvandare fyller i titel/beskrivning/typ/prioritet
           -> Spara -> insert i bcf_issues med source-metadata
           -> Arendet syns i arendelistan i 3D-viewern
```

### Mobil-anpassning
- FAB-knappen har storre touch-target pa mobil (`h-12 w-12` vs `h-10 w-10`)
- Positionerad med `env(safe-area-inset-bottom)` for att undvika systemfaltet
- `CreateIssueDialog` anvander redan responsiv layout med `max-w-[calc(100vw-40px)]`
- FMA+ laggs till i `IMMERSIVE_APPS` i AppLayout for att gomma header/sidebars pa mobil

### Befintlig infrastruktur som ateranvands
- `CreateIssueDialog` -- bepropad, dragbar, responsiv
- `bcf_issues`-tabellen -- sparar arendet med `viewpoint_json` for kontext
- `issue-screenshots`-bucket -- anvands om screenshot lyckas (osannolikt med CORS)
- `useAuth()` -- for `reported_by`
