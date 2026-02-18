
# Plan: Fixa 6 buggar i Desktop 3D-viewer + XKT-cache + BIM-namnsättning

## Sammanfattning av identifierade problem

### Problem 1: 3D startar inte på desktop (och split/2D FMA fungerar inte)
**Rotorsak**: `MainContent.tsx` rad 189 — `isImmersiveViewer` är bara sant **på mobil**: 
```tsx
const isImmersiveViewer = isMobile && IMMERSIVE_VIEWER_APPS.includes(activeApp);
```
På desktop renderas `assetplus_viewer` i en `<main>` med `absolute inset-0` och `overflow-y-auto`. Problemet är att `<main>` ärver höjden från sin relativt-positionerade parent `flex-1 min-h-0 relative`. AssetPlusViewer behöver `h-full` på containern men eftersom `overflow-y-auto` är satt krymper containern när innehållet är litet — 3D-viewerns canvas-element kan inte renderas i en 0-höjd container.

Dessutom: `Viewer.tsx` wrappar `AssetPlusViewer` i `<div className="h-full">` — men dess förälder `<main>` med `overflow-y-auto` gör att `h-full` inte fungerar korrekt på desktop (den beräknas mot viewport, inte parent).

**Fix**: Ändra `isImmersiveViewer` så att den gäller för ALLA viewer-appar (inte bara mobil), och separera "scrollbara" appar från "viewer-appar":
```tsx
// Viewer-appar är fullskärm på BÅDE mobil och desktop
const VIEWER_APPS = ['assetplus_viewer', 'viewer', 'radar', 'senslinc_dashboard', 'globe', 'ivion_create'];
// Portfolio, navigation, map mm. har interna scrollar
const INTERNAL_SCROLL_APPS = ['portfolio', 'navigation', 'map', 'fma_plus', 'entity_insights'];
// Scrollbara sida-appar
const SCROLLABLE_APPS = ['home', 'insights', 'inventory', 'fault_report', 'ai_scan', 'asset_registration'];

const isViewerApp = VIEWER_APPS.includes(activeApp);
const isScrollable = SCROLLABLE_APPS.includes(activeApp);
```

```tsx
<main className={`absolute inset-0 
  ${isViewerApp ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'} 
  ${t.bg}`}
  style={isViewerApp ? { touchAction: 'none' } : undefined}
>
  <div className={isViewerApp || !isScrollable ? "w-full h-full" : "w-full"}>
    {renderContent()}
  </div>
</main>
```

### Problem 2: Textfärger mörka på ljus bakgrund i menyer (dark mode)
**Rotorsak**: På startskärmen och menyerna används `text-foreground` men i dark mode kan detta vara mörkt om temat är fel — men viktigare: `NavigatorView`, `InsightsView`, `PortfolioView` mm. har ingen explicit `text-foreground` på deras `bg-card` containers. `HomeLanding.tsx` behöver granskas för att säkerställa att `text-foreground` används genomgående.

**Fix**: Säkerställ att alla text-element i menyer och sidebars har `text-foreground` eller `text-card-foreground` explicit, inte implicit (som kan ärva fel färg).

### Problem 3: XKT sparas inte korrekt — Småviken laddar långsamt varje gång
**Rotorsak konsolllogg-bekräftad**: 
```
XKT save: Upload failed { StorageUnknownError: Acquiring an exclusive Navigator LockManager lock "lock:sb-..." timed out waiting 10000ms }
```
`saveModelFromViewer` anropar `supabase.storage.upload()` — detta kräver en auth-session. Men Supabase-klienten försöker hämta sessionen via en `LockManager`-lock i en Service Worker/Web Worker context (Ivion SDK / NavVis Zone-kontexten) som inte kan nå `localStorage`. Uppladdet misslyckas varför modellerna aldrig sparas.

**Fix i `xkt-cache-service.ts`**: Använda `Service Role Key` via edge function istället för direkt Supabase-klient för uppladdning. Alternativt: anropa `xkt-cache` edge function (som redan finns) med `action: 'store'` — den använder `SUPABASE_SERVICE_ROLE_KEY` som kringgår LockManager-problemet.

Ändr `saveModelFromViewer` för att använda edge function för storage upload:
```typescript
// Istället för direkt supabase.storage.upload():
const { data, error } = await supabase.functions.invoke('xkt-cache', {
  body: { action: 'store', modelId, buildingFmGuid, xktData: base64Data }
});
```

### Problem 4: Alla BIM-modeller laddas vid första öppning av Småviken
**Rotorsak**: `initializeViewer` bygger ett filter (`allowedModelIdsRef`) baserat på `model_name` i `xkt_models`-tabellen. Men för Småviken är `model_name`-kolumnen null/GUID — `hasRealNames` är false → Asset+ API anropas. Problemet är att API-anropet för att hämta modellnamn misslyckas (se XKT cache-fel ovan) → `nameMap` förblir tom → `allowedModelIdsRef.current = null` → **alla modeller laddas**.

**Fix (två delar)**:
1. XKT save-fix (Problem 3) löser root cause — när modeller sparas lagras namnen korrekt.
2. Lägg till fallback i `initializeViewer` för att alltid försöka hämta modellnamn via Asset+ API, oavsett om DB-modeller finns. Separera modellnamns-fetch från existerande DB-kontroll:

```typescript
// ALLTID försök hämta från API om nameMap är tom:
if (nameMap.size === 0) {
  const resp = await fetch(`${apiBase}/api/threed/GetModels?fmGuid=${resolvedGuid}&apiKey=${apiKey}`, ...);
  // ... bygg nameMap från API
}
// Sedan bygg A-model filter
```

### Problem 5: BIM-modellnamn visas som konstiga ID:n istället för "A-modell", "V-modell" etc.
**Rotorsak**: Samma som Problem 4. `ModelVisibilitySelector` och `useModelNames` hämtar från `xkt_models.model_name` — om den är null/GUID visas "Laddar..." eller `fileNameWithoutExt.replace(/-/g, ' ')`.

**Fix**: Samma API-hämtnings-fix som ovan. Dessutom i `useModelNames`:
- Säkerställ att API-anropet faktiskt uppdaterar DB-raderna med rätt `model_name`
- Logiken finns redan men misslyckas pga LockManager-problem i uploaden

### Problem 6: Felaktiga/konstiga våningsplan i Småviken
**Rotorsak**: `FloatingFloorSwitcher` hämtar våningsnamn via `supabase.from('assets').select(...).eq('category', 'Building Storey')` — men från konsollloggen: `"AssetPlusViewer: Floor selection changed { guids: 0, isAllVisible: false }"` — detta indikerar att `visibleFloorFmGuids` är tomt. 

Mer specifikt: `extractFloors()` i `FloatingFloorSwitcher` hittar `IfcBuildingStorey` metaobjekt men deras namn är GUIDs (från BIM-modellen direkt) eftersom `floorNamesMap` är tom när modellen laddas. Sedan matchas dessa mot `floorNamesMap` från DB — men DB-datat kan ha olika GUID-format.

**Fix**: `floorNamesMap`-populationen är korrekt men timing-problem: `floorNamesMap` kan vara tomt när `extractFloors` körs. Loopen `Re-extract when names map updates` borde hantera det — men kan misslyckas om `isInitialized` är true men namnkartan ej laddats. Säkerställ att re-extract körs efter att DB-namnen laddas.

---

## Konkret implementation — filändringar

### Fil 1: `src/components/layout/MainContent.tsx`
**Problem 1 & 2 fixas**

```tsx
// Nuvarande:
const IMMERSIVE_VIEWER_APPS = ['assetplus_viewer', 'viewer', 'radar', 'map', 'fma_plus', 'entity_insights', 'navigation', 'portfolio', 'senslinc_dashboard', 'globe', 'ivion_create'];

// Ny uppdelning:
const VIEWER_APPS = ['assetplus_viewer', 'viewer', 'radar', 'senslinc_dashboard', 'globe']; 
// Dessa har h-full på ALLA plattformar
const FILL_APPS = ['portfolio', 'navigation', 'map', 'fma_plus', 'entity_insights', 'ivion_create'];
// Dessa har interna scrollbars och behöver h-full
const SCROLLABLE_PAGE_APPS = ['home', 'insights', 'inventory', 'fault_report', 'ai_scan', 'asset_registration'];
// Dessa är scroll-sidor utan h-full

// isViewerApp = viewer app på ALLA plattformar (inte bara mobil)
const isViewerApp = VIEWER_APPS.includes(activeApp);
// Alla appar utom scroll-sidor behöver h-full
const needsHFull = isViewerApp || FILL_APPS.includes(activeApp);
```

```tsx
// Render:
<main 
  className={`absolute inset-0 
    ${isViewerApp ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'} 
    ${t.bg}`}
  style={isViewerApp ? { touchAction: 'none' } : undefined}
>
  <div className={needsHFull ? "w-full h-full" : "w-full"}>
    {renderContent()}
  </div>
</main>
```

### Fil 2: `src/services/xkt-cache-service.ts`
**Problem 3 fixas — `saveModelFromViewer`**

Ändra upload-logiken för att använda edge function istället för direkt storage-anrop:
```typescript
// Konvertera till base64 och anropa edge function:
const base64Data = this.arrayBufferToBase64(xktData);
const { data, error } = await supabase.functions.invoke('xkt-cache', {
  body: { action: 'store', modelId: fileName, buildingFmGuid, xktData: base64Data }
});

// Sedan uppdatera metadata i DB:
await supabase.from('xkt_models').upsert({...}, { onConflict: 'building_fm_guid,model_id' });
```

### Fil 3: `src/components/viewer/AssetPlusViewer.tsx` (initializeViewer)
**Problem 4 & 5 fixas — modellnamnshämtning**

I `initializeViewer` (rad ~3078-3143), säkerställ att API-anropet **alltid** sker när `nameMap` är tom:
```typescript
// Om DB inte har riktiga namn, hämta alltid från API:
if (nameMap.size === 0) {
  try {
    const apiBase = baseUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
    const resp = await fetch(
      `${apiBase}/api/threed/GetModels?fmGuid=${resolvedGuid}&apiKey=${apiKey}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (resp.ok) {
      const apiModels = await resp.json();
      apiModels.forEach((m: any) => {
        if (m.id && m.name) nameMap.set(m.id, m.name);
        // Also map by xktFileUrl filename
        if (m.xktFileUrl) {
          const fileName = m.xktFileUrl.split('/').pop()?.replace('.xkt', '');
          if (fileName) nameMap.set(fileName, m.name);
        }
      });
    }
  } catch (e) {
    console.debug('Failed to fetch model names from API:', e);
  }
}
```

### Fil 4: `src/components/viewer/FloatingFloorSwitcher.tsx`
**Problem 6 fixas — våningsplan**

Lägg till retry när `floorNamesMap` uppdateras efter initial extraction:
```typescript
// Re-extract with names as soon as they're available
useEffect(() => {
  if (floorNamesMap.size === 0) return;
  const updatedFloors = extractFloors();
  if (updatedFloors.length > 0) {
    setFloors(updatedFloors);
    // Also trigger re-visibility
  }
}, [floorNamesMap]);
```
(Denna kod finns redan men verifieras att den körs rätt.)

### Färgfix (Problem 2) — text i dark mode
I `HomeLanding.tsx`, `NavigatorView.tsx`, `PortfolioView.tsx`:
- Säkerställ att alla rubriker, labels och list-items har `text-foreground` explicit
- Dropdown-menyer ska ha `text-foreground` på `SelectItem` och `DropdownMenuItem`
- I 3D-viewerns paneler: `ViewerRightPanel`, `ViewerTreePanel` — kolla att `text-white` används på dark bakgrunder

---

## Prioritetsordning för implementering

1. **MainContent.tsx** — fixar att 3D-viewer, split och 2D FMA visas korrekt på desktop (root cause)
2. **xkt-cache-service.ts** — fixar att XKT faktiskt sparas, löser långsam laddning
3. **AssetPlusViewer.tsx initializeViewer** — fixar modellnamnshämtning och A-model-filter
4. **FloatingFloorSwitcher.tsx** — verifierar timing av våningsplansnamn
5. **Textfärger** — genomgångna klasser för dark mode

## Inga DB-ändringar behövs
Alla buggar är rent kod-relaterade.
