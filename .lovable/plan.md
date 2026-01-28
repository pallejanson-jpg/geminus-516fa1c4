
# Plan: Åtgärda Rumsvisualisering, Dölja Röststyrning & Förbättra Inventeringens Tillgänglighet

## Sammanfattning

Tre huvudproblem att lösa:

1. **Rumsvisualisering hittar 0 rum** - Felsökning visar att `category` i databasen är `'Space'` (inte `'IfcSpace'`), så det borde fungera. Problemet kan vara att `buildingFmGuid` matchning kräver exakt case-matchning. Dessutom ska transparens på färger matcha BIM-modeller.

2. **Röststyrning visas alltid** - Ska döljas som standard och endast visas när aktiverad i Settings.

3. **Inventeringsfunktionen svår att hitta** - Ska läggas i vänster sidomeny, Quick Actions på alla nivåer, och i Navigator med förifylla baserat på navigationskontext.

---

## Problem 1: Rumsvisualisering - Inga Rum Hittas

### Analys
Databasen har 3,933 rum med `category = 'Space'`. RoomVisualizationPanel söker korrekt med `category = 'Space'`, men problemet kan vara:

1. **buildingFmGuid matchar inte** - Frågan söker med OR för olika case-varianter, men kanske blir buildingFmGuid aldrig rätt skickat
2. **buildingFmGuid skickas som uppercase/lowercase fel** - databasen har lowercase GUIDs

### Lösning
```typescript
// RoomVisualizationPanel.tsx rad 124-128
// Nuvarande kod:
.or(`building_fm_guid.eq.${buildingFmGuid},building_fm_guid.eq.${buildingFmGuid.toLowerCase()},building_fm_guid.eq.${buildingFmGuid.toUpperCase()}`)

// Förbättrad: Använd ilike för case-insensitiv matchning
.ilike('building_fm_guid', buildingFmGuid)
```

### Transparens för Rumsvisualisering
```typescript
// RoomVisualizationPanel.tsx rad 289-294
// FÖRE:
className="bg-card/95 backdrop-blur-sm"

// EFTER (samma som VisualizationToolbar):
className="bg-card/60 backdrop-blur-md"
```

### Rumsvisualisering - Transparenta Färger
För att färgerna ska ha samma transparens som BIM-modeller måste vi använda opacity:
```typescript
// visualization-utils.ts - colorizeSpace funktion
// Lägg till opacity på entity:
entity.opacity = 0.6; // Samma transparens som BIM-modeller
```

---

## Problem 2: Röststyrning - Ska Vara Dold Som Standard

### Nuvarande Implementation
`VoiceControlButton` renderas alltid i `AppLayout.tsx` (rad 50).

### Lösning
Läs `enabled`-inställningen från `VoiceSettings` och villkorsrendera:

```typescript
// AppLayout.tsx
import { useState, useEffect } from 'react';
import { getVoiceSettings, VOICE_SETTINGS_CHANGED_EVENT } from '@/components/settings/VoiceSettings';

const AppLayoutInner: React.FC = () => {
  const [voiceEnabled, setVoiceEnabled] = useState(() => getVoiceSettings().enabled);
  
  // Lyssna på ändringar i röstinställningar
  useEffect(() => {
    const handleSettingsChange = (e: CustomEvent) => {
      setVoiceEnabled(e.detail?.enabled ?? false);
    };
    window.addEventListener(VOICE_SETTINGS_CHANGED_EVENT, handleSettingsChange as EventListener);
    return () => window.removeEventListener(VOICE_SETTINGS_CHANGED_EVENT, handleSettingsChange as EventListener);
  }, []);

  return (
    <div>
      {/* ... existing code ... */}
      
      {/* Voice Control - endast synlig när aktiverad i Settings */}
      {voiceEnabled && <VoiceControlButton callbacks={voiceCallbacks()} />}
    </div>
  );
};
```

---

## Problem 3: Inventering - Bättre Tillgänglighet

### A. Lägg till i Vänster Sidomeny

```typescript
// LeftSidebar.tsx - Lägg till "Inventering" före Home-knappen
import { ClipboardList } from 'lucide-react';

// I ICON_COLORS (rad 8-17):
inventory: 'text-orange-500',

// I nav-sektionen (före Home-knappen, rad 69):
<AppButton 
  onClick={() => setActiveApp('inventory')} 
  variant={activeApp === 'inventory' ? 'default' : 'ghost'} 
  className="w-full !justify-start gap-3" 
  title={isSidebarExpanded ? "" : "Inventering"}
>
  <ClipboardList size={18} className={getIconColor('inventory')} />
  <span className={`${!isSidebarExpanded && 'hidden'}`}>Inventering</span>
</AppButton>
```

### B. Lägg till i Quick Actions

```typescript
// QuickActions.tsx - Lägg till "Inventering" för alla nivåer
interface QuickActionsProps {
  // ... existing props
  onInventory?: (facility: Facility, prefill: InventoryPrefill) => void;
}

interface InventoryPrefill {
  buildingFmGuid?: string;
  levelFmGuid?: string;
  roomFmGuid?: string;
}

// I komponenten:
{onInventory && (
  <Button 
    variant="ghost" 
    onClick={() => onInventory(facility, {
      buildingFmGuid: isBuilding ? facility.fmGuid : facility.buildingFmGuid,
      levelFmGuid: isStorey ? facility.fmGuid : facility.levelFmGuid,
      roomFmGuid: isSpace ? facility.fmGuid : undefined,
    })} 
    className="justify-start sm:justify-center gap-1 sm:gap-2 h-auto py-2 sm:py-3 px-2 sm:px-4"
  >
    <ClipboardList size={12} className="sm:w-3.5 sm:h-3.5 text-orange-500" />
    <span className="text-[10px] sm:text-xs">Inventering</span>
  </Button>
)}
```

### C. Förifylla i InventoryForm

```typescript
// InventoryForm.tsx - Acceptera prefill-props
interface InventoryFormProps {
  onSaved: (item: any) => void;
  onCancel: () => void;
  prefill?: {
    buildingFmGuid?: string;
    levelFmGuid?: string;
    roomFmGuid?: string;
  };
}

// I komponenten - initialisera state med prefill:
const [buildingFmGuid, setBuildingFmGuid] = useState(prefill?.buildingFmGuid || '');
const [levelFmGuid, setLevelFmGuid] = useState(prefill?.levelFmGuid || '');
const [roomFmGuid, setRoomFmGuid] = useState(prefill?.roomFmGuid || '');
```

### D. Lägg till i Navigator (TreeNode)

```typescript
// TreeNode.tsx - Lägg till Inventering-ikon vid hover
interface TreeNodeProps {
  // ... existing props
  onInventory?: (node: NavigatorNode) => void;
}

// I hover-actions:
{onInventory && (node.category === 'Building' || node.category === 'Building Storey' || node.category === 'Space') && (
  <Button
    variant="ghost"
    size="icon"
    className="h-5 w-5"
    onClick={(e) => { e.stopPropagation(); onInventory(node); }}
    title="Inventera här"
  >
    <ClipboardList className="h-3 w-3 text-orange-500" />
  </Button>
)}
```

### E. AppContext - Ny Inventering-kontext

```typescript
// AppContext.tsx - Lägg till inventering-prefill state
interface InventoryPrefillContext {
  buildingFmGuid?: string;
  levelFmGuid?: string;
  roomFmGuid?: string;
}

// I context:
inventoryPrefill: InventoryPrefillContext | null;
startInventory: (prefill: InventoryPrefillContext) => void;

// Implementation:
const startInventory = useCallback((prefill: InventoryPrefillContext) => {
  setInventoryPrefill(prefill);
  setActiveApp('inventory');
}, []);
```

---

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/RoomVisualizationPanel.tsx` | Fixa query (ilike), öka transparens till bg-card/60 |
| `src/lib/visualization-utils.ts` | Lägg till opacity på entity.colorize |
| `src/components/layout/AppLayout.tsx` | Villkorsrendera VoiceControlButton baserat på settings |
| `src/components/layout/LeftSidebar.tsx` | Lägg till Inventering-knapp i sidomeny |
| `src/components/portfolio/QuickActions.tsx` | Lägg till Inventering i Quick Actions med prefill |
| `src/components/navigator/TreeNode.tsx` | Lägg till Inventering-ikon vid hover |
| `src/components/navigator/NavigatorView.tsx` | Hantera onInventory callback |
| `src/components/inventory/InventoryForm.tsx` | Acceptera och använd prefill-props |
| `src/pages/Inventory.tsx` | Läs prefill från context |
| `src/context/AppContext.tsx` | Lägg till inventoryPrefill och startInventory |
| `src/components/portfolio/FacilityLandingPage.tsx` | Koppla onInventory till Quick Actions |

---

## Tekniska Detaljer

### Rum-query förbättring
```sql
-- Nuvarande (problematisk OR):
building_fm_guid.eq.XXX OR building_fm_guid.eq.xxx OR building_fm_guid.eq.XXX

-- Förbättrad (case-insensitive):
building_fm_guid ILIKE 'xxx'
```

### Förifylla-logik
```
Användaren är på:        Förifylla-värden:
─────────────────────────────────────────
Byggnad (B1)             building=B1
Våningsplan (F2 i B1)    building=B1, level=F2
Rum (R3 i F2 i B1)       building=B1, level=F2, room=R3
Asset (A4 i R3)          building=B1, level=F2, room=R3
```

### Transparens-nivåer
```
Komponent                  Transparens
─────────────────────────────────────────
VisualizationToolbar       bg-card/60 backdrop-blur-md
SidePopPanel              bg-card/65 backdrop-blur-md
RoomVisualizationPanel    bg-card/60 backdrop-blur-md (uppdaterad)
Rum-färger                opacity: 0.6 (ny)
```
