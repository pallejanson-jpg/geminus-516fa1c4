
# Plan: Förenklat Ivion 360° inventerings-arbetsflöde

## Sammanfattning av problemet

**Nuvarande flöde (fungerar dåligt):**
1. Starta i Lovable's registreringsformulär
2. Fyll i data
3. Klicka "Öppna 360+"
4. Ivion öppnas i ny flik
5. Skapa POI manuellt i Ivion
6. Gå tillbaka till Lovable
7. Klicka "Synka POI" - ofta misslyckas pga auth-problem

**Önskat flöde (startar från Ivion):**
1. Starta Ivion 360° i fullskärmsläge
2. Skapa POI med Ivions standardfunktionalitet (långtryck)
3. Automatiskt visa Lovable's "Registrera ny tillgång" dialog
4. Fyll i kategori, namn, symbol etc.
5. Spara direkt till Lovable backend (ingen manuell synk!)

---

## Teknisk lösning

### Alternativ A: NavVis IVION Frontend API med `onPoiSave` event (Optimal)

NavVis IVION har ett Frontend API med en `onPoiSave` signal som triggas när en POI skapas eller uppdateras. Genom att injicera ett anpassat script i Ivion kan vi lyssna på denna event och öppna Lovable's registreringsformulär automatiskt.

**Problem:** Ivion är externt hostade (swg.iv.navvis.com) och vi har inte möjlighet att injicera custom JavaScript i deras instans om vi inte har admin-access till NavVis-kontot och kan konfigurera en "Custom Plugin".

**Slutsats:** Endast möjligt om kunden har tillgång till NavVis admin-panel och kan lägga till en custom integration.

---

### Alternativ B: "Launch from Ivion" via URL-parameter (Praktiskt genomförbart)

Eftersom vi inte kan injicera kod i NavVis Ivion direkt, föreslår vi följande arbetsflöde:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ STEG 1: Användare startar inventeringsläge                               │
│ ───────────────────────────────────────────────────────────────────────  │
│  ○ I Lovable → Inventering → Välj "Starta i 360°"                        │
│  ○ Ivion öppnas i fullskärms-iframe ELLER i separat popup               │
│  ○ Lovable visar svävande "Registrera tillgång"-knapp som overlay       │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEG 2: Användare navigerar och skapar POI i Ivion                       │
│ ───────────────────────────────────────────────────────────────────────  │
│  ○ Användare går till rätt plats i 360°-vyn                              │
│  ○ Användare skapar POI via Ivions standardmetod (långtryck)            │
│  ○ Ivion sparar POI med koordinater och image-ID                         │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEG 3: Användare klickar "Registrera tillgång"                          │
│ ───────────────────────────────────────────────────────────────────────  │
│  ○ Lovable's registreringsformulär öppnas som overlay/sidopanel          │
│  ○ Formuläret är transparent/flyttbart så man ser 360° bakom            │
│  ○ "Hämta senaste POI" knapp hämtar koordinater från Ivion               │
│  ○ Alternativt: Användare klistrar in URL från Ivion                     │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEG 4: Spara till Lovable backend                                       │
│ ───────────────────────────────────────────────────────────────────────  │
│  ○ Sparas direkt till Supabase assets-tabellen                           │
│  ○ Ivion POI-ID kopplas till asset (om credentials fungerar)             │
│  ○ Formulsret återställs för nästa registrering                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Detaljerad implementation

### Del 1: Ny sida - "Ivion Inventory Mode" (`/ivion-inventory`)

En fullskärms-sida som:
- Visar Ivion i en iframe (100% höjd/bredd)
- Har en svävande "Registrera tillgång" FAB-knapp
- Formuläret öppnas som en flyttbar, transparent panel (liknande registrera i 3D)

```typescript
// Ny fil: src/pages/IvionInventory.tsx
interface IvionInventoryProps {}

const IvionInventory: React.FC = () => {
  const [formOpen, setFormOpen] = useState(false);
  const [ivionUrl, setIvionUrl] = useState<string | null>(null);
  const [buildingFmGuid, setBuildingFmGuid] = useState<string | null>(null);

  // Pre-select building based on route params or last used
  useEffect(() => {
    // Load building settings to get ivion_site_id
  }, []);

  return (
    <div className="h-screen w-screen relative">
      {/* Fullscreen Ivion iframe */}
      {ivionUrl && (
        <iframe 
          src={ivionUrl} 
          className="w-full h-full border-0"
          allow="fullscreen"
        />
      )}

      {/* Floating registration button */}
      {!formOpen && (
        <Button
          className="fixed bottom-8 right-8 h-14 w-14 rounded-full shadow-xl z-50"
          onClick={() => setFormOpen(true)}
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}

      {/* Floating registration form */}
      {formOpen && (
        <IvionRegistrationPanel
          buildingFmGuid={buildingFmGuid}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            // Optionally loop to register next
          }}
        />
      )}
    </div>
  );
};
```

### Del 2: Flyttbar registreringspanel

Återanvänd logiken från `InventoryFormSheet` men som en flyttbar, transparent dialog:

```typescript
// Ny fil: src/components/inventory/IvionRegistrationPanel.tsx

const IvionRegistrationPanel: React.FC<Props> = ({ buildingFmGuid, onClose, onSaved }) => {
  const [position, setPosition] = useState({ x: window.innerWidth - 420, y: 100 });
  const [isDragging, setIsDragging] = useState(false);

  // POI fetch feature
  const [poiInput, setPoiInput] = useState('');
  const [fetchedCoords, setFetchedCoords] = useState<Coords | null>(null);

  const handleFetchPOI = async () => {
    // Parse POI ID from input (user can paste URL or just ID)
    // Call edge function to get POI details
    // Set coordinates
  };

  return (
    <div
      className="fixed z-[60] w-[380px] max-h-[80vh] bg-card/90 backdrop-blur-md border rounded-xl shadow-2xl overflow-hidden"
      style={{ left: position.x, top: position.y }}
    >
      {/* Draggable header */}
      <div 
        className="px-4 py-3 bg-muted/50 cursor-grab flex items-center justify-between"
        onMouseDown={startDrag}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Registrera tillgång</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* POI Fetch section */}
      <div className="p-4 border-b">
        <Label className="text-xs text-muted-foreground">Hämta position från POI</Label>
        <div className="flex gap-2 mt-1">
          <Input 
            placeholder="POI-ID eller URL..." 
            value={poiInput}
            onChange={(e) => setPoiInput(e.target.value)}
            className="h-9"
          />
          <Button variant="outline" size="sm" onClick={handleFetchPOI}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        {fetchedCoords && (
          <div className="text-xs text-green-600 mt-1">
            ✓ Position: {fetchedCoords.x.toFixed(2)}, {fetchedCoords.y.toFixed(2)}, {fetchedCoords.z.toFixed(2)}
          </div>
        )}
      </div>

      {/* Standard registration form fields */}
      <ScrollArea className="max-h-[60vh] p-4">
        {/* Name, Category, Symbol, Floor, Room, Description, Image */}
        <InventoryFormFields ... />
      </ScrollArea>

      {/* Save button */}
      <div className="p-4 border-t">
        <Button onClick={handleSave} className="w-full">
          Spara tillgång
        </Button>
      </div>
    </div>
  );
};
```

### Del 3: Uppdatera befintliga inventeringsalternativ

I `PositionPickerStep.tsx` (mobil) och `InventoryForm.tsx` (desktop):

**Nuvarande:**
- "Välj i 3D-modell" → Öppnar 3D-picker
- "Öppna 360°-vy" → Öppnar Ivion i ny flik, manuell synk krävs

**Nytt alternativ:**
- "Starta inventering i 360°" → Går till `/ivion-inventory?building={fmGuid}` i fullskärm

```typescript
// I PositionPickerStep.tsx
{ivionSiteId && (
  <>
    <Button
      variant="outline"
      className="w-full h-20 flex flex-col"
      onClick={() => navigate(`/ivion-inventory?building=${formData.buildingFmGuid}`)}
    >
      <Camera className="h-8 w-8" />
      <span>Starta inventering i 360°</span>
      <span className="text-xs">Skapa POI → Registrera direkt</span>
    </Button>
  </>
)}
```

### Del 4: Förbättra POI-hämtning (fallback om auth fungerar)

Uppdatera `ivion-poi` edge-funktionen med en ny action `get-latest-poi`:

```typescript
case 'get-latest-poi':
  // Get most recent POI created by user in the last hour
  if (!params.siteId) throw new Error('siteId required');
  const pois = await getPois(params.siteId);
  
  // Sort by creation date, return newest
  const sortedPois = pois.sort((a, b) => 
    (b.id || 0) - (a.id || 0) // Higher ID = newer
  );
  
  result = sortedPois.length > 0 ? sortedPois[0] : null;
  break;
```

---

## Filer att skapa/ändra

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `src/pages/IvionInventory.tsx` | NY | Fullskärms Ivion + floating registrering |
| `src/components/inventory/IvionRegistrationPanel.tsx` | NY | Flyttbar registreringspanel |
| `src/App.tsx` | ÄNDRA | Lägg till route `/ivion-inventory` |
| `src/components/layout/MainContent.tsx` | ÄNDRA | Lägg till IvionInventory som route |
| `src/components/inventory/mobile/PositionPickerStep.tsx` | ÄNDRA | Lägg till "Starta i 360°" knapp |
| `src/components/inventory/InventoryForm.tsx` | ÄNDRA | Lägg till "Starta i 360°" alternativ |
| `supabase/functions/ivion-poi/index.ts` | ÄNDRA | Lägg till `get-latest-poi` action |

---

## Framtida förbättringar (om NavVis admin-access finns)

Om kunden har access till NavVis admin kan man:

1. **Skapa Custom Plugin** i Ivion som lyssnar på `onPoiSave`
2. **postMessage till parent** när POI skapas (om embedded i iframe)
3. **Automatisk popup** av registreringsformulär utan manuellt klick

```javascript
// Custom plugin i Ivion (kräver admin-access)
api.poi.onPoiSave.connect((poi) => {
  window.parent.postMessage({
    type: 'ivion-poi-created',
    poi: {
      id: poi.id,
      location: poi.location,
      imageId: poi.pointOfView?.imageId
    }
  }, '*');
});
```

---

## Sammanfattning

1. **Ny sida** `/ivion-inventory` med fullskärms-Ivion och flytande registreringsformulär
2. **Användare skapar POI** direkt i Ivion med deras standardfunktionalitet
3. **Klickar på FAB-knapp** för att öppna registreringsformuläret
4. **Hämtar POI-data** genom att ange ID eller URL (eller automatiskt om auth fungerar)
5. **Sparar direkt** till Lovable backend utan manuell synk

Detta flöde är helt oberoende av den problematiska Ivion API-autentiseringen för att fungera som grundläggande funktion - POI-hämtning är en bonus om credentials är korrekta.
