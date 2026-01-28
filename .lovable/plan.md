
# Plan: Fixa Ivion URL-format och visa 360+ bredvid formuläret

## Problem identifierade

1. **Fel URL-format för Ivion**: Koden genererar `/site/3045176558137335` men korrekt format är `/?site=3045176558137335`
2. **360+ öppnas i ny flik istället för side-by-side**: På desktop finns plats för att visa Ivion-vyn bredvid inventeringsformuläret

---

## Del 1: Fixa URL-formatet

### Orsak
URL:en byggs fel på två ställen:
- `src/components/inventory/InventoryForm.tsx` rad 197: `` `${baseUrl}/site/${siteId}` ``
- `src/components/portfolio/PortfolioView.tsx` rad 147: `` `${baseUrl}/site/${siteId}` ``

### Lösning
Ändra till korrekt query parameter-format: `` `${baseUrl}/?site=${siteId}` ``

---

## Del 2: Visa Ivion side-by-side med formuläret (Desktop)

### Nuvarande beteende
- 360+ knappen anropar `handleOpen360()` som öppnar Ivion i ny flik via `window.open()`

### Nytt beteende
- På desktop: Visa Ivion i en resizable panel bredvid formuläret
- På mobil: Behåll Sheet/modal-beteende

### Implementation

1. **Lägg till state i `Inventory.tsx`**:
   - `ivion360Open: boolean` - styr om Ivion-panelen visas
   - `ivion360Url: string | null` - URL att ladda i iframe

2. **Uppdatera `InventoryForm` props**:
   - Lägg till `onOpen360: (url: string) => void` callback
   - Istället för `window.open()`, anropa denna callback

3. **Modifiera desktop-layouten i `Inventory.tsx`**:
   - Använd `ResizablePanelGroup` från befintlig `@/components/ui/resizable`
   - Tre paneler: Lista | Formulär | Ivion 360 (conditionally visible)
   - Ivion-panelen visar `Ivion360View` component med den URL som skickades

4. **Mobil-läge**:
   - Behåll nuvarande Sheet-modal för formuläret
   - 360+ öppnar i extern flik (svårt att visa side-by-side på mobil)

---

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/inventory/InventoryForm.tsx` | Fixa URL-format (`/?site=`), lägg till `onOpen360` prop |
| `src/components/portfolio/PortfolioView.tsx` | Fixa URL-format (`/?site=`) |
| `src/pages/Inventory.tsx` | Lägg till Ivion-panel med resizable layout |
| `src/components/viewer/Ivion360View.tsx` | Acceptera URL som prop istället för localStorage |

---

## Detaljerade kodändringar

### InventoryForm.tsx - Fixa URL och lägg till callback

```typescript
// Nya props
interface InventoryFormProps {
  // ... befintliga
  onOpen360?: (url: string) => void; // Callback för att visa 360 inline
}

// I handleOpen360:
const handleOpen360 = () => {
  const ivionApiUrl = localStorage.getItem('ivionApiUrl');
  const siteId = buildingSettings?.ivion_site_id;

  if (!siteId) {
    toast.error('Ingen Ivion-site kopplad', {
      description: 'Koppla byggnaden till en Ivion-site i byggnadsinställningar',
    });
    return;
  }

  // FIXA: Använd /?site= istället för /site/
  const baseUrl = ivionApiUrl || 'https://swg.iv.navvis.com';
  const fullUrl = `${baseUrl}/?site=${siteId}`;

  // Om callback finns (desktop), visa inline. Annars öppna i ny flik
  if (onOpen360) {
    onOpen360(fullUrl);
  } else {
    window.open(fullUrl, '_blank');
    toast.info('Ivion öppnat i ny flik');
  }
};
```

### PortfolioView.tsx - Fixa URL

```typescript
// Rad 147: Ändra från
const fullUrl = `${baseUrl}/site/${siteId}`;
// Till
const fullUrl = `${baseUrl}/?site=${siteId}`;
```

### Inventory.tsx - Desktop layout med Ivion-panel

```typescript
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import Ivion360View from '@/components/viewer/Ivion360View';

// Lägg till state
const [ivion360Url, setIvion360Url] = useState<string | null>(null);

// Handler för 360-knappen
const handleOpen360 = (url: string) => {
  setIvion360Url(url);
};

const handleClose360 = () => {
  setIvion360Url(null);
};

// Desktop layout med resizable panels
return (
  <div className="h-full p-6 bg-background">
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* Left: List */}
      <ResizablePanel defaultSize={25} minSize={20}>
        <div className="h-full pr-4">
          <div className="flex items-center gap-3 mb-4">
            <ClipboardList className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">Inventering</h1>
          </div>
          <InventoryList items={savedItems} isLoading={isLoading} onEdit={handleEdit} />
        </div>
      </ResizablePanel>
      
      <ResizableHandle withHandle />
      
      {/* Middle: Form */}
      <ResizablePanel defaultSize={ivion360Url ? 35 : 75} minSize={30}>
        <Card className="p-6 h-full overflow-y-auto mx-4">
          <InventoryForm
            onSaved={handleSaved}
            onCancel={handleClearEdit}
            prefill={inventoryPrefill || undefined}
            editItem={editItem}
            onClearEdit={handleClearEdit}
            onOpen360={handleOpen360}
          />
        </Card>
      </ResizablePanel>
      
      {/* Right: Ivion 360 (conditional) */}
      {ivion360Url && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={40} minSize={25}>
            <div className="h-full pl-4">
              <Ivion360View url={ivion360Url} onClose={handleClose360} />
            </div>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  </div>
);
```

### Ivion360View.tsx - Acceptera URL som prop

```typescript
interface Ivion360ViewProps {
  url?: string;          // URL direkt som prop
  onClose?: () => void;
}

export default function Ivion360View({ url, onClose }: Ivion360ViewProps) {
  // Använd prop-URL eller fallback till localStorage
  const ivionUrl = url || localStorage.getItem('ivion360Url');
  // ... resten av komponenten
}
```

---

## Visuell översikt (Desktop)

```text
+------------------+------------------------+------------------------+
|    Lista         |      Formulär          |     Ivion 360          |
|  (senaste)       |                        |                        |
|                  |  Namn: [___________]   |   [iframe med          |
|  > Asset 1       |  Kategori: [v]         |    360-panorama]       |
|  > Asset 2       |  ...                   |                        |
|  > Asset 3       |  Position:             |   [Stäng X]            |
|                  |  [3D] [360+]           |                        |
|                  |                        |                        |
+------------------+------------------------+------------------------+
```

---

## Sammanfattning

1. **URL-fix**: Ändra från `/site/` till `/?site=` på två ställen
2. **Desktop side-by-side**: Använd ResizablePanelGroup för att visa Ivion bredvid formuläret
3. **Mobil**: Behåll extern flik-beteende (begränsat utrymme)
4. **Ivion360View**: Stöd för URL som prop för flexibilitet
