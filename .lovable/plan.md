
# Plan: Flytta Kontroller till Visningsmenyn, Fixa Rumsvisualisering & Implementera Sparade Vyer

## Sammanfattning

Tre huvudsakliga förbättringsområden:

1. **Meny-struktur** - Flytta 2D/3D-slider och ta bort fel kontroller från Visningsmenyn
2. **Rumsvisualisering** - Automatisk uppdatering, spara inställningar, robust floor-tracking
3. **Sparade Vyer** - Ny funktion för att spara och återställa viewer-tillstånd

---

## Del 1: Rensar Meny-strukturen

### Nuvarande Problem
- **Visningsmenyn (VisualizationToolbar)** innehåller: BIM-modeller, Våningsplan, "Visa rum", "Visa annotationer", "Rumsvisualisering"
- **Navigeringsmenyn (ViewerToolbar)** innehåller: Orbit, Zooma, 2D/3D-knapp etc.
- Användaren vill ha 2D/3D-slider i Visningsmenyn, INTE som knapp i Navigeringsmenyn

### Åtgärder

**A. Lägg till 2D/3D-switch i Visningsmenyn (under "Visa")**
```
Fil: src/components/viewer/VisualizationToolbar.tsx

Lägg till:
- State: const [is2DMode, setIs2DMode] = useState(false);
- Switch-kontroll: "2D planvy" med Switch-komponent
- Vid toggle: dispatcha VIEW_MODE_REQUESTED_EVENT
- Lyssna på VIEW_MODE_CHANGED_EVENT för att synka state
```

**B. ViewerToolbar lyssnar på VIEW_MODE_REQUESTED_EVENT**
```
Fil: src/components/viewer/ViewerToolbar.tsx

- Definiera: const VIEW_MODE_REQUESTED_EVENT = 'VIEW_MODE_REQUESTED';
- useEffect som lyssnar och kör handleViewModeChange()
- 2D/3D-knappen i bottentoolbar BEHÅLLS (dubblerad kontroll är ok)
```

**C. Behåll endast visualiseringsrelaterat i Visningsmenyn**
Kontroller som ska finnas i Visningsmenyn:
- 2D/3D switch (NY)
- Klipphöjd-slider (redan finns, visas vid 2D)
- BIM-modeller → Side-pop
- Våningsplan → Side-pop
- Visa rum (showSpaces)
- Visa annotationer
- Rumsvisualisering (öppnar panel)
- Skapa tillgång
- **Skapa Vy** (NY - Del 3)

---

## Del 2: Fixa Rumsvisualisering

### Nuvarande Problem
1. Efter byte av BIM-modeller/våningsplan uppdateras inte rum-antal
2. `entityIdCache` byggs endast EN gång - nytt floor-val triggar inte re-cache
3. Färgval måste appliceras manuellt via "Uppdatera"-knapp
4. Inställningar (visualiseringstyp) sparas inte

### Lösning

**A. Ta bort "Uppdatera"-knappen - applicera automatiskt**
```
Fil: src/components/viewer/RoomVisualizationPanel.tsx

- Ta bort "Uppdatera"-knappen helt
- useEffect på [visualizationType, useMockData] triggar applyVisualization() automatiskt
- "Återställ" ändras till "Rensa färger" och återställer endast utan att ändra vald typ
```

**B. Bygg om entityIdCache vid floor/model-ändringar**
```
Nuvarande: useEffect bygger cache EN gång (isCacheBuilt)

Ändring:
- Ta bort isCacheBuilt-check
- Lägg till dependency på buildingFmGuid och visibleFloorFmGuids
- Cache byggs om vid varje relevant förändring

Alt: Gör cache lat (bygg vid behov, invalidera vid scene-ändringar)
```

**C. Trigga rum-uppdatering vid floor-ändringar via event**
```
Fil: src/components/viewer/RoomVisualizationPanel.tsx

- Lyssna på FLOOR_SELECTION_CHANGED_EVENT
- Vid förändring: invalidera cache + re-fetch rooms
```

**D. Spara inställningar i localStorage**
```
Fil: src/components/viewer/RoomVisualizationPanel.tsx

const STORAGE_KEY = 'roomVisualizationSettings';

// Vid mount - återställ
useEffect(() => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const { type, mock } = JSON.parse(saved);
    setVisualizationType(type);
    setUseMockData(mock);
  }
}, []);

// Vid ändring - spara
useEffect(() => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    type: visualizationType,
    mock: useMockData
  }));
}, [visualizationType, useMockData]);
```

**E. Färgläggning följer panel-state**
```
- När panel stängs (onClose): kör resetColors() BARA om man vill
- Behåll färgerna så länge "Rumsvisualisering" är aktiv i Visningsmenyn
- Endast "Rensa färger"-knappen eller att stänga panelen nollställer
```

---

## Del 3: Sparade Vyer

### Funktionsbeskrivning
- Användaren kan spara den aktuella 3D-vyn med alla inställningar
- Sparade vyer visas i BuildingSelector (vid val av 3D-viewer)
- En vy innehåller: namn, beskrivning, skärmbild, kamera-state, alla viewer-inställningar

### Databasschema

**Ny tabell: saved_views**
```sql
CREATE TABLE public.saved_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  building_fm_guid TEXT NOT NULL,
  building_name TEXT,
  
  -- Screenshot (URL till storage)
  screenshot_url TEXT,
  
  -- Camera state
  camera_eye NUMERIC[3],
  camera_look NUMERIC[3],
  camera_up NUMERIC[3],
  camera_projection TEXT DEFAULT 'perspective',
  
  -- Viewer settings
  view_mode TEXT DEFAULT '3d', -- '2d' eller '3d'
  clip_height NUMERIC DEFAULT 1.2,
  visible_model_ids TEXT[], -- Array av model-IDs som är synliga
  visible_floor_ids TEXT[], -- Array av floor-IDs som är synliga
  
  -- Visualization state
  show_spaces BOOLEAN DEFAULT false,
  show_annotations BOOLEAN DEFAULT false,
  visualization_type TEXT DEFAULT 'none',
  visualization_mock_data BOOLEAN DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON public.saved_views FOR SELECT USING (true);
CREATE POLICY "Public insert access" ON public.saved_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update access" ON public.saved_views FOR UPDATE USING (true);
CREATE POLICY "Public delete access" ON public.saved_views FOR DELETE USING (true);
```

### UI-Implementation

**A. "Skapa Vy" i Visningsmenyn**
```
Fil: src/components/viewer/VisualizationToolbar.tsx

- Lägg till under "Åtgärder":
  <Button onClick={handleCreateView}>
    <Camera /> Skapa Vy
  </Button>

- handleCreateView:
  1. Ta skärmbild via xeokit viewer.getImage()
  2. Samla ihop alla settings
  3. Öppna dialog för namn/beskrivning
  4. Spara till saved_views + ladda upp bild till storage
```

**B. CreateViewDialog-komponent**
```
Fil: src/components/viewer/CreateViewDialog.tsx (NY)

- Dialog med:
  - Förhandsvisning av skärmbild
  - Namn (obligatoriskt)
  - Beskrivning (valfritt)
  - "Spara"/"Avbryt" knappar
```

**C. Uppdatera BuildingSelector med sparade vyer**
```
Fil: src/components/viewer/BuildingSelector.tsx

Ändra layout:
- Tabs: "Byggnader" | "Sparade Vyer"
- Under "Sparade Vyer":
  - Grid med kort (samma stil som byggnader)
  - Varje kort visar: skärmbild, namn, byggnad, datum
  - Klick → ladda vyn i viewer
```

**D. Ladda sparad vy**
```
Fil: src/pages/Viewer.tsx + src/components/viewer/AssetPlusViewer.tsx

- Ny context-state: savedViewToLoad
- När vy väljs:
  1. setViewer3dFmGuid(view.building_fm_guid)
  2. setSavedViewToLoad(view)
- I AssetPlusViewer vid init:
  - Om savedViewToLoad finns:
    - Applicera camera state
    - Applicera visibility (models, floors)
    - Applicera visualization settings
    - Flyg till saved camera position
```

### xeokit Screenshot-funktion
```javascript
// Ta skärmbild från xeokit viewer
const viewer = viewerRef.current.$refs.AssetViewer.$refs.assetView.viewer;
const imageData = viewer.getImage({
  format: "png",
  width: 400,
  height: 300
});

// imageData är base64 - ladda upp till Supabase Storage
const { data, error } = await supabase.storage
  .from('saved-view-screenshots')
  .upload(`${viewId}.png`, base64ToBlob(imageData));
```

---

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/VisualizationToolbar.tsx` | Lägg till 2D/3D switch, "Skapa Vy"-knapp |
| `src/components/viewer/ViewerToolbar.tsx` | Lyssna på VIEW_MODE_REQUESTED_EVENT |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Ta bort Uppdatera, spara settings, re-cache vid floor-ändringar |
| `src/components/viewer/BuildingSelector.tsx` | Lägg till Tabs för Byggnader/Sparade Vyer |
| `src/components/viewer/CreateViewDialog.tsx` | **NY** - Dialog för att skapa vy |
| `src/pages/Viewer.tsx` | Hantera savedViewToLoad |
| `src/context/AppContext.tsx` | Lägg till savedViewToLoad state |
| `supabase/migrations/xxx_saved_views.sql` | **NY** - Databas-schema |

---

## Leveransordning

1. **Meny-struktur** - 2D/3D switch i Visningsmenyn + event-hantering
2. **Rumsvisualisering** - Ta bort Uppdatera, auto-apply, spara settings, floor-tracking
3. **Databas** - saved_views tabell + storage bucket
4. **CreateViewDialog** - UI för att skapa vy med screenshot
5. **BuildingSelector** - Tabs + visa sparade vyer
6. **Load View** - Context + applicera sparad vy i viewer

---

## Tekniska Detaljer

### VIEW_MODE_REQUESTED_EVENT
```typescript
// I useSectionPlaneClipping.ts eller separat fil
export const VIEW_MODE_REQUESTED_EVENT = 'VIEW_MODE_REQUESTED';

// Dispatcha från VisualizationToolbar
window.dispatchEvent(new CustomEvent(VIEW_MODE_REQUESTED_EVENT, {
  detail: { mode: '2d' } // eller '3d'
}));

// Lyssna i ViewerToolbar
useEffect(() => {
  const handler = (e: CustomEvent) => {
    handleViewModeChange(e.detail.mode);
  };
  window.addEventListener(VIEW_MODE_REQUESTED_EVENT, handler);
  return () => window.removeEventListener(VIEW_MODE_REQUESTED_EVENT, handler);
}, [handleViewModeChange]);
```

### Screenshot-flöde
```
1. Användaren klickar "Skapa Vy"
2. viewer.getImage() → base64 PNG
3. Öppna CreateViewDialog med förhandsvisning
4. Användaren fyller i namn/beskrivning
5. Vid "Spara":
   a. Generera UUID för view
   b. Upload screenshot till storage
   c. Samla camera state + settings
   d. INSERT till saved_views
6. Toast: "Vy sparad!"
```

### Saved View Camera State
```typescript
interface SavedViewCameraState {
  eye: [number, number, number];
  look: [number, number, number];
  up: [number, number, number];
  projection: 'perspective' | 'ortho';
  orthoScale?: number;
}

// Hämta från xeokit
const camera = viewer.camera;
const state: SavedViewCameraState = {
  eye: [...camera.eye],
  look: [...camera.look],
  up: [...camera.up],
  projection: camera.projection,
  orthoScale: camera.orthoScale
};

// Återställ
camera.eye = state.eye;
camera.look = state.look;
camera.up = state.up;
camera.projection = state.projection;
if (state.orthoScale) camera.orthoScale = state.orthoScale;
```
