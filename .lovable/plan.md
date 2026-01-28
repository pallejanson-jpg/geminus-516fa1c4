
# Plan: Förbättrad Menyarkitektur för 3D-visaren

## Sammanfattning

Förbättra VisualizationToolbar så att:
1. Submenyerna (BIM-modeller, Våningsplan) öppnas som separata "pop-out" paneler till sidan
2. Huvudmenyn förblir smal och transparent
3. "Visa rum" och "Visa annotationer" är avstängda som standard

## Problemanalys

### Nuvarande problem:
- Huvudpanelen har `bg-card/75` men Collapsible-innehållet expanderar panelen vertikalt
- När användaren öppnar BIM-modeller eller Våningsplan täcker hela panelen 3D-modellen
- Användaren kan inte se effekten av sina ändringar i realtid
- `showSpaces` och `showAnnotations` är `true` som standard

### Lösning: "Side-pop" Submenyer

Istället för att BIM-modeller/Våningsplan expanderar i huvudpanelen:
1. Klick på "BIM-modeller" öppnar en smal panel **bredvid** huvudmenyn
2. Panelen positioneras automatiskt till vänster eller höger beroende på var huvudmenyn är
3. Submenyerna har också transparens så användaren ser 3D-modellen
4. Endast en submeny kan vara öppen åt gången

## Teknisk Implementation

### 1. Ändra standardvärden i VisualizationToolbar.tsx

```typescript
// Rad 59-60 i VisualizationToolbar.tsx
// FÖRE:
const [showSpaces, setShowSpaces] = useState(true);
const [showAnnotations, setShowAnnotations] = useState(true);

// EFTER:
const [showSpaces, setShowSpaces] = useState(false);
const [showAnnotations, setShowAnnotations] = useState(false);
```

### 2. Skapa ny komponent: SidePopPanel.tsx

Generisk komponent för side-pop menyer:

```typescript
interface SidePopPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  parentPosition: { x: number; y: number };
  parentWidth: number;
  children: React.ReactNode;
}

const SidePopPanel: React.FC<SidePopPanelProps> = ({
  isOpen,
  onClose,
  title,
  parentPosition,
  parentWidth,
  children,
}) => {
  // Beräkna om panelen ska visas till vänster eller höger
  const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const panelWidth = 220; // Smal bredd
  
  // Om huvudmenyn är till höger på skärmen -> visa till vänster
  // Om huvudmenyn är till vänster -> visa till höger
  const showOnLeft = parentPosition.x + parentWidth > screenWidth / 2;
  
  const position = showOnLeft
    ? { left: parentPosition.x - panelWidth - 8, top: parentPosition.y }
    : { left: parentPosition.x + parentWidth + 8, top: parentPosition.y };

  if (!isOpen) return null;

  return (
    <div
      className="fixed z-[61] w-[220px] bg-card/70 backdrop-blur-md border rounded-lg shadow-lg"
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex items-center justify-between p-2 border-b">
        <span className="text-xs font-medium">{title}</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="p-2 max-h-[50vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
};
```

### 3. Uppdatera VisualizationToolbar.tsx

Ersätt Collapsible med click-to-open side panels:

```typescript
// Ny state för submenyer
const [activeSubMenu, setActiveSubMenu] = useState<'models' | 'floors' | null>(null);

// I JSX - ersätt ModelVisibilitySelector Collapsible med en knapp:
<div className="flex items-center justify-between py-1.5">
  <div className="flex items-center gap-2">
    <Box className="h-3.5 w-3.5 text-muted-foreground" />
    <span className="text-xs">BIM-modeller</span>
    <span className="text-[10px] text-muted-foreground">(2/3)</span>
  </div>
  <Button
    variant="ghost"
    size="sm"
    className="h-6 px-2"
    onClick={() => setActiveSubMenu(activeSubMenu === 'models' ? null : 'models')}
  >
    <ChevronRight className="h-3 w-3" />
  </Button>
</div>

// Rendera side-pop panels utanför huvudpanelen:
<SidePopPanel
  isOpen={activeSubMenu === 'models'}
  onClose={() => setActiveSubMenu(null)}
  title="BIM-modeller"
  parentPosition={position}
  parentWidth={320}
>
  <ModelVisibilitySelector ... listOnly={true} />
</SidePopPanel>
```

### 4. Modifiera ModelVisibilitySelector och FloorVisibilitySelector

Lägg till en `listOnly` prop som renderar endast listan (inga Collapsible-headers):

```typescript
interface ModelVisibilitySelectorProps {
  // ... existing props
  listOnly?: boolean;  // Renderar endast listan, ingen header/collapsible
}

// I komponenten:
if (listOnly) {
  return (
    <div className="space-y-1">
      {models.map((model) => (
        // Render switches directly
      ))}
    </div>
  );
}

// Annars rendera som vanligt med Collapsible
```

### 5. Uppdatera transparens i huvudpanelen

```typescript
// VisualizationToolbar.tsx - panelens styling
className={cn(
  "fixed z-[60] border rounded-lg shadow-xl",
  // Ökad transparens för huvudpanelen
  "bg-card/60 backdrop-blur-md",
  // ...
)}
```

## Visuell Arkitektur

```text
┌─────────────────────────────────────────────────────────────┐
│                    3D Viewer (bakgrund)                      │
│                                                             │
│   ┌──────────────┐  ┌───────────────┐                       │
│   │ Side-pop     │  │ Huvudmeny     │                       │
│   │ BIM-modeller │←→│               │                       │
│   │              │  │ [BIM-modeller]│                       │
│   │ □ A-modell   │  │ [Våningsplan] │                       │
│   │ ☑ E-modell   │  │ ────────────  │                       │
│   │ □ V-modell   │  │ □ Visa rum    │                       │
│   │              │  │ □ Annotationer│                       │
│   │ [Solo] [Alla]│  │               │                       │
│   └──────────────┘  └───────────────┘                       │
│                                                             │
│   Användaren ser 3D-modellen genom båda panelerna           │
└─────────────────────────────────────────────────────────────┘
```

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/VisualizationToolbar.tsx` | Standardvärden till false, side-pop arkitektur, ökad transparens |
| `src/components/viewer/SidePopPanel.tsx` | **NY FIL** - Generisk side-pop panel komponent |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Lägg till `listOnly` prop |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Lägg till `listOnly` prop |

## Förväntade Resultat

- **Smalare submenyer:** BIM-modeller/Våningsplan öppnas i smala (220px) sidopaneler
- **Bättre synlighet:** Användaren ser 3D-modellen bakom transparenta paneler
- **Realtidsfeedback:** Direkt visuell feedback när modeller/våningar togglas
- **Korrekta standardinställningar:** Visa rum och annotationer avstängda som standard
- **Smart positionering:** Sidomenyer anpassar sig efter var huvudmenyn är placerad
