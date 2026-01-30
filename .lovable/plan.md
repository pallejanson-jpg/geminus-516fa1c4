
# Plan: Dela Profil/Settings, On-Demand Synk & TreeView i 3D

## Sammanfattning

Användaren vill:
1. **Dela upp Profil och övriga Settings** - som det var tidigare (separata tabs)
2. **On-demand Asset-synk** - om assets saknas för en byggnad, hämta dem automatiskt när man öppnar UI
3. **On-demand XKT-synk** - samma logik för 3D-modeller
4. **TreeView i 3D-viewern** - xeokit:s TreeViewPlugin för BIM-hierarki, aktiverad via slider i Visningsmeny

---

## Del 1: Dela Profil och Settings

### Nuvarande struktur
`ApiSettingsModal.tsx` har 7 tabs: Profil, Apps, API's, Sync, Symboler, Teman, Röst

Profil innehåller: namn, email, avatar, tema-val

### Önskad struktur
Dela upp i två separata modaler:
1. **Profil-modal** - användarens personliga inställningar (namn, foto, tema)
2. **Settings-modal** - systeminställningar (Apps, API's, Sync, Symboler, Teman, Röst)

### Ändringar

**Ny fil:** `src/components/settings/ProfileModal.tsx`
- Extrahera profillogiken till egen modal
- Enkel dialog med avatar, namn, email, tema-val

**Ändra:** `src/components/settings/ApiSettingsModal.tsx`
- Ta bort Profil-tab
- Behåll övriga 6 tabs
- Byt namn till "SystemSettingsModal" eller behåll nuvarande namn

**Ändra:** Header-dropdown (troligen `AppHeader.tsx` eller `AppSidebar.tsx`)
- Separata menyval: "Profil" öppnar ProfileModal
- "Inställningar" öppnar ApiSettingsModal

---

## Del 2: On-Demand Asset-synk

### Nuvarande logik
`AssetsView.tsx` (rad 197-226) har redan logik för on-demand synk:
```typescript
useEffect(() => {
  const checkAndSyncAssets = async () => {
    if (assets.length > 0 || !facility.fmGuid) return;
    if (facility.category !== 'Building') return;
    
    setIsSyncingAssets(true);
    const result = await syncBuildingAssetsIfNeeded(facility.fmGuid);
    // ...
  };
  checkAndSyncAssets();
}, [facility.fmGuid, ...]);
```

`asset-plus-service.ts` har `syncBuildingAssetsIfNeeded()` som anropar edge function `sync-single-building`.

### Problem
1. Synken triggas bara i `AssetsView` - inte vid andra entry points
2. Användaren måste vänta på synk när de öppnar vyn
3. Inga återkopplingsmekanismer om synken misslyckas

### Lösning: Proaktiv On-Demand Synk

**Ändra:** `src/services/asset-plus-service.ts`
Lägg till funktion som körs automatiskt när användaren navigerar till en byggnad:

```typescript
/**
 * Ensure assets exist for a building - sync if needed.
 * Returns immediately if assets exist, otherwise triggers background sync.
 */
export async function ensureBuildingAssets(
  buildingFmGuid: string,
  options?: { waitForSync?: boolean }
): Promise<{ hasAssets: boolean; count: number; syncing: boolean }> {
  // 1. Check local count
  const { count } = await supabase
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("building_fm_guid", buildingFmGuid)
    .eq("category", "Instance");

  if (count && count > 0) {
    return { hasAssets: true, count, syncing: false };
  }

  // 2. Trigger background sync
  console.log(`No assets for ${buildingFmGuid}, triggering sync...`);
  
  const syncPromise = supabase.functions.invoke("asset-plus-sync", {
    body: { action: "sync-single-building", buildingFmGuid }
  });

  if (options?.waitForSync) {
    await syncPromise;
    // Re-check count
    const { count: newCount } = await supabase
      .from("assets")
      .select("*", { count: "exact", head: true })
      .eq("building_fm_guid", buildingFmGuid)
      .eq("category", "Instance");
    return { hasAssets: (newCount || 0) > 0, count: newCount || 0, syncing: false };
  }

  return { hasAssets: false, count: 0, syncing: true };
}
```

**Ändra:** `src/context/AppContext.tsx`
Anropa `ensureBuildingAssets` när användaren väljer en byggnad i Navigator eller Portfolio:

```typescript
// I setSelectedAsset eller liknande:
if (asset.category === 'Building') {
  ensureBuildingAssets(asset.fmGuid).then(result => {
    if (result.syncing) {
      toast({ title: 'Synkar assets...', description: 'Hämtar tillgångar för byggnaden' });
    }
  });
}
```

---

## Del 3: On-Demand XKT-synk

### Nuvarande logik
`useXktPreload.ts` preloadar XKT när en byggnad väljs, men:
1. Hämtar från Asset+ API direkt (kräver token varje gång)
2. Cachar till `xkt-models` bucket via `xktCacheService.storeModel()`
3. Vid nästa laddning, kollar cache först

### Problem
1. Preload kör bara 5 modeller, inte alla
2. Om cache-miss, laddas från API varje gång
3. Ingen synk-funktion som fyller databasen proaktivt

### Lösning: XKT On-Demand Sync

**Ändra:** `src/services/xkt-cache-service.ts`
Lägg till funktion för att synka XKT on-demand:

```typescript
/**
 * Ensure XKT models are cached for a building.
 * Triggers sync if no cached models exist.
 */
async ensureBuildingModels(
  buildingFmGuid: string
): Promise<{ cached: boolean; count: number; syncing: boolean }> {
  // 1. Check xkt_models table
  const { count } = await supabase
    .from("xkt_models")
    .select("*", { count: "exact", head: true })
    .eq("building_fm_guid", buildingFmGuid);

  if (count && count > 0) {
    console.log(`XKT cache: ${count} models found for ${buildingFmGuid}`);
    return { cached: true, count, syncing: false };
  }

  // 2. Trigger XKT sync for this building
  console.log(`XKT cache: No models for ${buildingFmGuid}, triggering sync...`);
  
  supabase.functions.invoke("asset-plus-sync", {
    body: { action: "sync-xkt-building", buildingFmGuid }
  }).catch(e => console.warn("XKT sync failed:", e));

  return { cached: false, count: 0, syncing: true };
}
```

**Ändra:** `supabase/functions/asset-plus-sync/index.ts`
Lägg till ny action `sync-xkt-building` som synkar XKT för en specifik byggnad:

```typescript
if (action === 'sync-xkt-building') {
  if (!buildingFmGuid) {
    return new Response(
      JSON.stringify({ success: false, error: 'buildingFmGuid required' }),
      { status: 400, headers: ... }
    );
  }

  // Hämta modeller från Asset+ 3D API
  const accessToken = await getAccessToken();
  const models = await fetchModelsForBuilding(accessToken, buildingFmGuid);
  
  // Ladda ner och cacha varje modell
  for (const model of models) {
    await downloadAndCacheXkt(supabase, model, buildingFmGuid, accessToken);
  }
  
  return new Response(
    JSON.stringify({ success: true, modelCount: models.length }),
    { headers: ... }
  );
}
```

**Ändra:** `src/hooks/useXktPreload.ts`
Anropa `ensureBuildingModels` istället för att göra API-anrop direkt:

```typescript
// Ersätt nuvarande preload-logik med:
const result = await xktCacheService.ensureBuildingModels(buildingFmGuid);
if (result.syncing) {
  console.log('XKT Preload: Background sync triggered');
}
```

---

## Del 4: TreeView i 3D-Viewern

### Befintlig komponent
`ViewerTreePanel.tsx` finns redan och visar BIM-hierarki baserat på xeokit metaScene. Den har:
- Sökfunktion
- Expandera/kollaps
- Klick → select & fly-to
- Hover → highlight

### Önskad placering
- Aktiveras via slider i Visningsmeny (VisualizationToolbar)
- Ikonen ska ligga bredvid maximeraknappen uppe till vänster

### Ändringar

**Ändra:** `src/components/viewer/VisualizationToolbar.tsx`
Lägg till TreeView toggle i huvudmenyn:

```tsx
// State
const [showTreeView, setShowTreeView] = useState(false);

// I "Visa"-sektionen (efter Rum-toggle):
<div className="flex items-center justify-between py-1.5 sm:py-2">
  <div className="flex items-center gap-2 sm:gap-3">
    <div className={cn(
      "p-1 sm:p-1.5 rounded-md",
      showTreeView ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
    )}>
      <TreeDeciduous className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
    </div>
    <span className="text-xs sm:text-sm">Modellträd</span>
  </div>
  <Switch 
    checked={showTreeView} 
    onCheckedChange={(checked) => {
      setShowTreeView(checked);
      onToggleTreeView?.(checked);
    }} 
  />
</div>
```

**Ändra:** `src/components/viewer/AssetPlusViewer.tsx`
Placera TreeView-ikonen bredvid maximeraknappen:

```tsx
// I header/toolbar-området uppe till vänster:
<div className="absolute top-3 left-3 z-30 flex items-center gap-2">
  {/* Existerande fullscreen-knapp */}
  <Button variant="outline" size="icon" onClick={toggleFullscreen}>
    {isFullscreen ? <Minimize2 /> : <Maximize2 />}
  </Button>
  
  {/* NY: TreeView toggle-knapp */}
  <Button 
    variant={showTreePanel ? "default" : "outline"} 
    size="icon"
    onClick={() => setShowTreePanel(!showTreePanel)}
    title="Modellträd"
  >
    <TreeDeciduous className="h-4 w-4" />
  </Button>
</div>

{/* TreeView panel */}
<ViewerTreePanel
  viewerRef={viewerInstanceRef}
  isVisible={showTreePanel}
  onClose={() => setShowTreePanel(false)}
  onNodeSelect={handleTreeNodeSelect}
/>
```

---

## Filer som Påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/components/settings/ProfileModal.tsx` | **NY FIL** - Separat profil-modal |
| `src/components/settings/ApiSettingsModal.tsx` | Ta bort Profil-tab |
| `src/components/layout/AppHeader.tsx` | Separata menyval för Profil/Settings |
| `src/services/asset-plus-service.ts` | `ensureBuildingAssets()` funktion |
| `src/services/xkt-cache-service.ts` | `ensureBuildingModels()` funktion |
| `supabase/functions/asset-plus-sync/index.ts` | `sync-xkt-building` action |
| `src/hooks/useXktPreload.ts` | Använd cache-service istället för direkt API |
| `src/components/viewer/VisualizationToolbar.tsx` | TreeView toggle |
| `src/components/viewer/AssetPlusViewer.tsx` | TreeView-knapp i header |

---

## Teknisk Översikt

```text
┌────────────────────────────────────────────────────────────────┐
│                  ON-DEMAND ASSET SYNC                          │
├────────────────────────────────────────────────────────────────┤
│  1. Användare väljer byggnad i Navigator/Portfolio             │
│  2. AppContext anropar ensureBuildingAssets(fmGuid)            │
│  3. Om assets saknas → trigga sync-single-building             │
│  4. Edge function hämtar från Asset+ API                       │
│  5. Sparar till assets-tabell                                  │
│  6. Nästa gång → data finns lokalt                             │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                  ON-DEMAND XKT SYNC                            │
├────────────────────────────────────────────────────────────────┤
│  1. Användare öppnar 3D-viewer för byggnad                     │
│  2. useXktPreload anropar ensureBuildingModels(fmGuid)         │
│  3. Om XKT saknas → trigga sync-xkt-building                   │
│  4. Edge function hämtar XKT från Asset+ 3D API                │
│  5. Sparar till xkt-models bucket + tabell                     │
│  6. Nästa gång → laddas från local cache                       │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                  TREEVIEW I 3D                                 │
├────────────────────────────────────────────────────────────────┤
│  [Maximize] [TreeView]              ← Uppe till vänster        │
│                                                                │
│  ┌─ ViewerTreePanel ─────────────────────┐                     │
│  │ 🔍 Sök...                             │                     │
│  │                                       │                     │
│  │ ▼ 🏢 Centralstationen                │                     │
│  │   ▼ 📄 Våning 1                      │                     │
│  │     ▶ 🚪 Rum 101                     │                     │
│  │     ▶ 🚪 Rum 102                     │                     │
│  │   ▶ 📄 Våning 2                      │                     │
│  │   ▶ 📄 Våning 3                      │                     │
│  └───────────────────────────────────────┘                     │
│                                                                │
│  VisualizationToolbar (höger):                                 │
│  [x] 2D/3D                                                     │
│  [x] Visa rum                                                  │
│  [x] Modellträd  ← Toggle som synkar med knappen               │
└────────────────────────────────────────────────────────────────┘
```

---

## Förväntade Resultat

1. **Separata modaler** - Profil och Settings är två olika modaler
2. **Automatisk asset-laddning** - När man öppnar en byggnad, synkas assets automatiskt om de saknas
3. **Automatisk XKT-laddning** - 3D-modeller synkas on-demand vid första besök
4. **Progressiv cache-uppbyggnad** - Lovable fylls på med data över tid när användare navigerar
5. **TreeView tillgänglig** - BIM-hierarki kan visas via knapp eller meny-toggle
