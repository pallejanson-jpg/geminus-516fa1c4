

## Plan: Geminus View — fristående IFC-visare + plugin-menyknapp

### Sammanfattning

Tre ändringar:

1. **Fixa Insikter-knappen** i plugin-menyn (wrappa i fixed container)
2. **Lägg till "Geminus View"** i plugin-menyn
3. **Ny route `/view`** — fristående sida där man kan:
   - Välja befintlig byggnad / sparad vy (navigerar till `/viewer`)
   - **Ladda upp en IFC-fil** och visa den direkt i xeokit — utan koppling till databas, byggnader eller assets

### Ändringar

#### 1. `src/components/viewer/GeminusPluginMenu.tsx`

- **Fixa Insikter**: Wrappa `InsightsDrawerPanel` i en `fixed z-50`-container med samma floating-mönster som Gunnar/Ilean (backdrop-blur, close-knapp, fullskärm på mobil)
- **Nytt menyalternativ**: `{ id: 'viewer', label: 'Geminus View', icon: Eye }`
- Uppdatera `ActivePanel`-typ med `'viewer'`
- När `activePanel === 'viewer'` → navigera till `/view` (via `window.open` i plugin-kontext eller `useNavigate` i app-kontext)

#### 2. `src/pages/GeminusView.tsx` (ny fil)

Fristående sida med två lägen:

**Läge A — Välj byggnad/vy:**
- Hämta byggnader från `assets`-tabellen (category = 'Building')
- Hämta sparade vyer från `saved_views`
- Sökbar lista, klick → navigera till `/viewer?building=GUID`

**Läge B — Ladda upp IFC:**
- Fil-input som accepterar `.ifc`
- Filen laddas **inte** upp till backend — den läses lokalt i webbläsaren
- Använder `web-ifc` + `@xeokit/xeokit-convert` (redan tillgängliga) för att konvertera IFC → XKT i minnet (samma logik som `runBrowserConversion` i `CreateBuildingPanel`)
- XKT-datan laddas in i en `NativeXeokitViewer`-instans direkt
- Ingen data sparas i databasen — rent tillfälligt viewer-läge

**UI-flöde:**
1. Användaren ser en splashsida med två val: "Välj byggnad" eller "Ladda upp IFC"
2. Vid IFC-uppladdning: visar progress under konvertering, sedan renderar xeokit-viewern med modellen
3. Toolbar med grundläggande verktyg (orbit, zoom, fit, section)

#### 3. `src/App.tsx`

- Lägg till route `/view` → lazy-load `GeminusView`, skyddad med `ProtectedRoute`

### Tekniska detaljer

- IFC-konvertering sker helt i webbläsaren via `web-ifc` WASM (redan inkluderat som `web-ifc` npm-paket)
- XKT genereras i minnet som en `ArrayBuffer`, laddas via xeokit SDK:s `XKTLoaderPlugin.load({ xkt: arrayBuffer })`
- Ingen Supabase-interaktion för IFC-visningen — helt klientbaserad
- Befintlig `NativeXeokitViewer` modifieras inte — den nya sidan skapar en egen viewer-instans
- Storleksgräns: Varnar om filen > 50 MB (webbläsarminne)

