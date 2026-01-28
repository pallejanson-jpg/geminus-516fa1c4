

# Plan: Fixa Gunnar-panelen, 3D-viewer felmeddelande och XKT-cachelagring

## Sammanfattning

Jag har identifierat tre separata problem som behöver åtgärdas:

1. **Gunnar-panelen** - Bör vara flytande/dragbar med transparent bakgrund (som VisualizationToolbar)
2. **3D-viewer felmeddelande** - Bör undertryckas under initialisering så det inte stör användaren
3. **XKT-cachelagring** - Fungerar inte eftersom datan som skickas till edge-funktionen är tom (0 bytes)

---

## Problem 1: Gunnar flytande panel med transparent bakgrund

### Nuvarande beteende
Gunnar öppnas som en Sheet (sidopanel) som täcker hela höger sida och har en solid bakgrund.

### Önskat beteende
En flytande, dragbar panel med semi-transparent bakgrund (som VisualizationToolbar) så att 3D-byggnaden syns bakom.

### Lösning
Konvertera GunnarButton från Sheet till en flytande panel med:
- Dragbar header (som VisualizationToolbar)
- Semi-transparent bakgrund med frosted glass-effekt (`bg-card/60 backdrop-blur-md`)
- Positioneringslogik för att flytta panelen
- Storleksanpassning för mobil vs desktop

### Ändringar

**Fil: `src/components/chat/GunnarButton.tsx`**
- Ersätt Sheet-komponenten med en flytande `div`-panel
- Lägg till state för position (`useState<{x: number, y: number}>`)
- Lägg till drag-hantering med `onMouseDown`, `onMouseMove`, `onMouseUp`
- Lägg till touch-stöd för mobil (swipe-to-close)
- Applicera transparent styling: `bg-card/60 backdrop-blur-md`
- Positionera panelen med `fixed` och `style={{ left, top }}`

---

## Problem 2: Felmeddelande blinkar vid 3D-start

### Nuvarande beteende
Vid initialisering visas ett felmeddelande ("Could not load 3D viewer") kort innan viewern laddas korrekt. Detta beror på React Strict Mode som dubbelmontar komponenten.

### Orsak
Viewern har en retry-logik, men felmeddelandet visas omedelbart vid första försökets misslyckande. Den andra mount-cykeln lyckas sedan.

### Lösning
Undertryck felmeddelandet under den initiala laddningsfasen. Visa bara fel efter att alla retry-försök har misslyckats och viewern har varit stabil en stund.

### Ändringar

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**
- Lägg till en `showErrorRef` som sätts till `true` först efter en fördröjning (t.ex. 500ms) efter att ett fel uppstått
- Lägg till state `showError` som kontrollerar om felmeddelandet ska visas
- Ändra error-renderingen att kontrollera `showError` istället för `state.error`
- När viewern lyckas initialisera, rensa både `error` och `showError`

---

## Problem 3: XKT-filer sparas inte i databasen

### Nuvarande beteende
Konsolen visar "XKT model cached successfully" men:
- Edge-funktionen kastar error: "xktData is required for store action"
- `xkt_models` tabellen är tom
- Storage bucket `xkt-models` är tom
- Konsolloggen visar "0.00 MB" - datan är tom

### Rotorsak
Fetch-interceptorn i `AssetPlusViewer.tsx` interceptar `/GetXktData` API-anrop. Men dessa är inte .xkt-filer - de returnerar metadata om modeller. De faktiska XKT-filerna laddas från en annan URL som interceptorn missar.

Asset+ viewern använder en intern mekanism för att ladda XKT-filer. De faktiska binärfilerna hämtas inte via standard `fetch()` som vi kan intercepta - de laddas direkt av xeokit/Asset+ biblioteket.

### Utredning visar
1. `/GetXktData?modelid=...` returnerar troligen JSON-metadata, inte binärdata
2. XKT-filerna laddas via WebGL/xeokit loader som inte använder `fetch()`
3. Cloned response.arrayBuffer() returnerar tom data (0.00 MB)

### Lösning
Istället för att intercepta fetch-anrop (som inte fungerar), implementera en proaktiv XKT-synk:

1. **Uppdatera edge-funktionen `asset-plus-sync`** att ladda ner XKT-filer via `/api/v1/AssetDB/GetXktData?modelid=...` endpoint direkt från backend
2. Använd `/api/v1/AssetDB/GetModels?fmGuid=...` för att hämta modell-listan (detta fungerar redan)
3. För varje modell, hämta XKT-datan och spara till storage + databas

### Ändringar

**Fil: `supabase/functions/asset-plus-sync/index.ts`**
- Lägg till korrekt URL-konstruktion för GetXktData endpoint
- Lägg till logik för att ladda ner XKT binärdata
- Spara till storage bucket och registrera i xkt_models tabell

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**
- Ta bort eller inaktivera den icke-fungerande fetch-interceptorn
- Eller: behåll den för framtida bruk men förbättra den att logga varningar

---

## Tekniska detaljer

### Gunnar flytande panel - Ny struktur

```text
GunnarButton
├── Floating trigger button (bottom-right)
└── Floating draggable panel (when open)
    ├── Header with drag handle + close button
    ├── GunnarChat (embedded mode)
    └── Touch swipe support for mobile
```

### Gunnar panel styling

```css
/* Semi-transparent frosted glass */
bg-card/60 backdrop-blur-md
border rounded-lg shadow-xl
fixed z-[60]

/* Position management */
style={{ left: position.x, top: position.y }}
```

### Error suppression timing

```text
Error flow:
1. initializeViewer() starts
2. DOM wait fails → set error state internally
3. Start 500ms timer before showing error
4. If retry succeeds within 500ms → clear error, never show it
5. If still failed after 500ms → show error to user
```

### XKT sync strategy

```text
1. Get models list via GetModels API
2. For each model:
   a. Construct URL: baseUrl/api/v1/AssetDB/GetXktData?modelid={id}
   b. Fetch with auth token
   c. Upload to storage bucket
   d. Insert/update xkt_models table
```

---

## Filöversikt

| Fil | Ändringar |
|-----|-----------|
| `src/components/chat/GunnarButton.tsx` | Ersätt Sheet med flytande dragbar panel |
| `src/components/viewer/AssetPlusViewer.tsx` | Lägg till fördröjd felvisning, rensa interceptor |
| `supabase/functions/asset-plus-sync/index.ts` | Fixa XKT-nedladdning via GetXktData endpoint |

---

## Prioritetsordning

1. **Gunnar flytande panel** - UX-förbättring
2. **Felmeddelande suppression** - UX-förbättring  
3. **XKT-caching** - Prestandaförbättring (kräver mer testning)

