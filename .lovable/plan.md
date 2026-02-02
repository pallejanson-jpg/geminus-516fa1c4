
# Utökad Åtgärdsplan: 3D-viewer, Inventering, Gunnar AI och TreeView

## Sammanfattning
Denna plan adresserar alla rapporterade problem plus det nya TreeView-kravet:

1. **AI-inventering**: Bakåtknapp fungerar inte + objekttyper ska vara förvalda med välj alla-funktion
2. **Rumsetiketter**: Fel position + visas för alla våningar oavsett Solo-val
3. **Visa rum**: Samma problem - alla rum visas istället för filtrerade per våning
4. **Gunnar-ikon**: I vägen, saknar toggle i inställningar, ej flyttbar, behöver bli smartare
5. **TreeView**: Långsam laddning + selektering ska påverka vad som syns i 3D

---

## Del 1: AI-inventering - Bakåtknapp och kategoriförval

### Problem
- Bakåtknappen i wizard-headern fungerar inte korrekt
- Objekttyper borde ha alla markerade som standard
- Saknar "Välj alla / Avmarkera alla"-funktion

### Analys
Bakåtknappen visas korrekt (`currentStep !== 'detection'`) och `goBack()` ser korrekt ut. Men `CategorySelectionStep` auto-avancerar efter val utan att visa förvalt läge.

### Lösning

**1.1 Verifiera bakåtknapp i MobileInventoryWizard.tsx**
- Koden vid rad 311-314 ser korrekt ut men behöver testas
- Eventuellt problem: knappen döljs felaktigt eller `goBack()` anropas inte

**1.2 Lägg till "Välj alla"-funktionalitet i CategorySelectionStep.tsx**
- Ändra från "auto-advance efter val" till att visa alla kategorier med förval
- Lägg till knappar "Välj alla" och "Avmarkera alla" överst
- Visa en "Fortsätt"-knapp istället för auto-advance

---

## Del 2: Rumsetiketter - Korrekt positionering och våningsfiltrering

### Problem
- Etiketter placeras i mitten av rummet (kan bli högt upp)
- Alla rum i hela byggnaden visas oavsett Solo-val

### Lösning

**useRoomLabels.ts - Ändra positionering och lägg till floor-filtrering**

```typescript
// Ändra från:
const center = [
  (aabb[0] + aabb[3]) / 2,
  (aabb[1] + aabb[4]) / 2 + 0.5,  // Mitten + 0.5m
  (aabb[2] + aabb[5]) / 2,
];

// Till:
const center = [
  (aabb[0] + aabb[3]) / 2,
  aabb[1] + 1.2,  // 1.2m ovanför golvet
  (aabb[2] + aabb[5]) / 2,
];
```

**Lägg till floor-filtrering:**
- Utöka `createLabels()` med parameter `visibleFloorFmGuids: string[]`
- För varje IfcSpace, hitta förälder-storey genom att traversera `metaObject.parent`
- Jämför storey's `originalSystemId` med `visibleFloorFmGuids`
- Skippa rum som inte tillhör synliga våningar

**AssetPlusViewer.tsx - Skicka synliga våningar till useRoomLabels**
- Uppdatera hooken att ta emot `visibleFloorFmGuids`
- Anropa `refreshLabels()` när `visibleFloorFmGuids` ändras

---

## Del 3: Visa rum - Filtrering per våning

### Problem
"Visa rum" visar alla rum istället för bara det Solo-valda våningsplanet.

### Analys
Koden i `filterSpacesToVisibleFloors()` (rad 212-293) ser korrekt ut och borde filtrera. Problemet kan vara:
1. `visibleFloorFmGuids` innehåller inte rätt värden
2. Matchningen `storeyFmGuid` vs `visibleGuidsLower` misslyckas

### Lösning
Logiken finns redan men behöver debugging. Säkerställ att:
- `handleVisibleFloorsChange()` anropas vid Solo-val
- `storeyFmGuid` extraheras korrekt från `parentStorey.originalSystemId`
- Case-insensitive matchning fungerar

---

## Del 4: Gunnar AI - Toggle, drag och intelligens

### Problem
- Gunnar-ikonen ligger i vägen för NavCube
- Saknar inställning för att visa/dölja
- Kan inte flyttas
- Behöver bättre kontextförståelse och följdförslag

### Lösning

**4.1 Ny fil: src/components/settings/GunnarSettings.tsx**
```typescript
const GUNNAR_SETTINGS_KEY = 'gunnar-settings';
export const GUNNAR_SETTINGS_CHANGED_EVENT = 'gunnar-settings-changed';

export interface GunnarSettingsData {
  visible: boolean;
  buttonPosition: { x: number; y: number } | null;
}

// Visa toggle för att visa/dölja Gunnar-knappen
// Spara i localStorage och dispatcha event vid ändring
```

**4.2 Uppdatera ApiSettingsModal.tsx**
- Lägg till ny tab "Gunnar" med GunnarSettings-komponenten

**4.3 Uppdatera AppLayout.tsx**
- Lyssna på `GUNNAR_SETTINGS_CHANGED_EVENT`
- Villkorligt rendera `<GunnarButton />` baserat på inställning

**4.4 Gör trigger-knappen draggable i GunnarButton.tsx**
- Trigger-knappen (rad 187-216) är idag `fixed bottom-20 right-4`
- Lägg till drag-logik liknande panelens men för knappen
- Spara position i localStorage via GunnarSettings
- Återställ position vid sidladdning

**4.5 Förbättra Gunnar-intelligens**

**gunnar-chat/index.ts - Lägg till följdförslag i system-prompt:**
```
EFTER VARJE SVAR:
Föreslå 2-3 relevanta följdfrågor som användaren kan ställa.
Returnera dem i ett JSON-block:
\`\`\`json
{"suggested_followups": ["Hur många rum finns på Plan 2?", "Visa mig alla brandsläckare", "Öppna 3D-vyn"]}
\`\`\`
```

**GunnarChat.tsx - Visa föreslagna följdfrågor:**
```tsx
const [suggestedFollowups, setSuggestedFollowups] = useState<string[]>([]);

// Parsa följdförslag från AI-svar
// Visa som klickbara chips under senaste svaret
{suggestedFollowups.length > 0 && (
  <div className="flex flex-wrap gap-2 mt-2 mb-3">
    {suggestedFollowups.map((q, i) => (
      <Button key={i} variant="outline" size="sm" 
        onClick={() => { setInput(q); /* auto-send */ }}>
        {q}
      </Button>
    ))}
  </div>
)}
```

---

## Del 5: TreeView - Bakgrundsladdning och synlighetsfiltrering

### Problem
1. TreeView är långsam att ladda
2. Val i TreeView påverkar inte vad som syns i 3D

### Analys
TreeView byggs från `metaScene` vid första öppning (rad 678-690). Den har redan visibility-checkboxar men de kontrollerar individuella objekt, inte floor-baserad filtrering.

### Lösning

**5.1 Preload TreeView-data i bakgrunden**

**AssetPlusViewer.tsx - Starta trädbyggnad efter modell-laddning:**
```typescript
// Ny ref för att cacha träddata
const cachedTreeDataRef = useRef<TreeNode[] | null>(null);
const cachedExpandedIdsRef = useRef<Set<string>>(new Set());

// Efter modell är laddad (i effect efter 'ready'-state):
useEffect(() => {
  if (initStep === 'ready' && !cachedTreeDataRef.current) {
    // Trigga background tree build
    setTimeout(() => {
      // Anropa ViewerTreePanel's buildTree via ref eller event
      window.dispatchEvent(new CustomEvent('PRELOAD_VIEWER_TREE'));
    }, 1000);
  }
}, [initStep]);
```

**ViewerTreePanel.tsx - Lyssna på preload-event:**
```typescript
useEffect(() => {
  const handlePreload = () => {
    if (treeData.length === 0) {
      buildTree();
    }
  };
  window.addEventListener('PRELOAD_VIEWER_TREE', handlePreload);
  return () => window.removeEventListener('PRELOAD_VIEWER_TREE', handlePreload);
}, [buildTree, treeData]);
```

**5.2 TreeView-selektering påverkar 3D-synlighet**

Nuvarande `handleVisibilityChange()` (rad 460-482) togglar redan synlighet. Men det ska också synka med floor-filter.

**Ny callback: `onVisibilitySelectionChange`**
```typescript
interface ViewerTreePanelProps {
  // ...existing props...
  onVisibilitySelectionChange?: (visibleNodeIds: string[], visibleFloorIds: string[]) => void;
}
```

**Logik för att extrahera synliga våningar:**
```typescript
const handleVisibilityChange = (node: TreeNode, visible: boolean) => {
  // Befintlig logik för att toggla entitet
  
  // Efteråt: samla alla synliga floor-ids
  const collectVisibleFloors = (nodes: TreeNode[]): string[] => {
    const floors: string[] = [];
    nodes.forEach(n => {
      if (n.type === 'IfcBuildingStorey' && n.visible) {
        floors.push(n.fmGuid || n.id);
      }
      if (n.children) {
        floors.push(...collectVisibleFloors(n.children));
      }
    });
    return floors;
  };
  
  const visibleFloors = collectVisibleFloors(treeData);
  onVisibilitySelectionChange?.(/* allVisibleIds */, visibleFloors);
};
```

**AssetPlusViewer.tsx - Hantera floor-synlighet från TreeView:**
```typescript
const handleTreeVisibilityChange = (visibleNodeIds: string[], visibleFloorIds: string[]) => {
  setVisibleFloorFmGuids(visibleFloorIds);
  
  // Om showSpaces är på, filtrera rum
  if (showSpaces) {
    filterSpacesToVisibleFloors(visibleFloorIds, true);
  }
  
  // Uppdatera rumsetiketter
  // ... trigga refresh
};
```

---

## Filer som ändras

### Frontend
| Fil | Ändring |
|-----|---------|
| `src/components/inventory/mobile/MobileInventoryWizard.tsx` | Verifiera/fixa bakåtknapp |
| `src/components/inventory/mobile/CategorySelectionStep.tsx` | Förval alla + välj alla-knappar + manuell "Fortsätt" |
| `src/hooks/useRoomLabels.ts` | Y-höjd = 1.2m + floor-filtrering |
| `src/components/viewer/AssetPlusViewer.tsx` | Skicka visibleFloors till labels + preload tree + hantera tree-visibility |
| `src/components/viewer/ViewerTreePanel.tsx` | Preload-event + callback för visibility-ändringar |
| `src/components/settings/GunnarSettings.tsx` | **NY FIL** - toggle + position-inställningar |
| `src/components/settings/ApiSettingsModal.tsx` | Lägg till Gunnar-tab |
| `src/components/layout/AppLayout.tsx` | Villkorlig rendering av GunnarButton |
| `src/components/chat/GunnarButton.tsx` | Draggable trigger-knapp + localStorage |
| `src/components/chat/GunnarChat.tsx` | Visa föreslagna följdfrågor |

### Backend
| Fil | Ändring |
|-----|---------|
| `supabase/functions/gunnar-chat/index.ts` | System-prompt med följdförslag |

---

## Tekniska detaljer

### Rumsetiketter - Floor-filtrering i useRoomLabels.ts
```typescript
const createLabels = useCallback((visibleFloorFmGuids: string[] = []) => {
  const viewer = getXeokitViewer();
  if (!viewer?.metaScene?.metaObjects || !viewer?.scene) return;

  const container = ensureContainer();
  if (!container) return;

  const metaObjects = viewer.metaScene.metaObjects;
  const scene = viewer.scene;
  const visibleLower = new Set(visibleFloorFmGuids.map(g => g.toLowerCase()));
  
  Object.values(metaObjects).forEach((metaObj: any) => {
    if (metaObj.type?.toLowerCase() !== 'ifcspace') return;

    // Hitta förälder-storey
    let parentStorey: any = null;
    let current = metaObj;
    while (current?.parent) {
      current = current.parent;
      if (current?.type?.toLowerCase() === 'ifcbuildingstorey') {
        parentStorey = current;
        break;
      }
    }
    
    // Floor-filtrering
    if (visibleFloorFmGuids.length > 0 && parentStorey) {
      const storeyGuid = (parentStorey.originalSystemId || parentStorey.id || '').toLowerCase();
      if (!visibleLower.has(storeyGuid)) {
        return; // Skippa detta rum
      }
    }

    const entity = scene.objects?.[metaObj.id];
    if (!entity?.aabb) return;

    // Beräkna position - 1.2m ovanför golvet
    const aabb = entity.aabb;
    const center = [
      (aabb[0] + aabb[3]) / 2,
      aabb[1] + 1.2,  // Fixad höjd
      (aabb[2] + aabb[5]) / 2,
    ];
    
    // ... skapa etikett-element ...
  });
}, [getXeokitViewer, ensureContainer, updateLabelPositions]);
```

### GunnarSettings localStorage-mönster
```typescript
const GUNNAR_SETTINGS_KEY = 'gunnar-settings';
export const GUNNAR_SETTINGS_CHANGED_EVENT = 'gunnar-settings-changed';

export interface GunnarSettingsData {
  visible: boolean;
  buttonPosition: { x: number; y: number } | null;
}

const DEFAULT_SETTINGS: GunnarSettingsData = {
  visible: true,
  buttonPosition: null,
};

export function getGunnarSettings(): GunnarSettingsData {
  try {
    const stored = localStorage.getItem(GUNNAR_SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {}
  return DEFAULT_SETTINGS;
}

export function saveGunnarSettings(settings: GunnarSettingsData): void {
  try {
    localStorage.setItem(GUNNAR_SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(GUNNAR_SETTINGS_CHANGED_EVENT, { detail: settings }));
  } catch (e) {}
}
```

### TreeView synlighetssynk
```text
+------------------+       visibilityChange       +-------------------+
|  ViewerTreePanel | --------------------------> | AssetPlusViewer   |
|  (checkbox click)|                             | handleTreeVisibility|
+------------------+                             +-------------------+
                                                          |
                                                          v
                                            +---------------------------+
                                            | setVisibleFloorFmGuids()  |
                                            | filterSpacesToVisibleFloors|
                                            | refreshRoomLabels()       |
                                            +---------------------------+
```

---

## Prioritetsordning
1. **Rumsetiketter och Visa rum** (kritiskt för 3D-viewer)
2. **TreeView synlighetsfiltrering** (kritiskt för 3D-workflow)
3. **TreeView preload** (performance)
4. **Gunnar toggle och drag** (UX)
5. **Bakåtknapp + kategoriförval** (inventering)
6. **Gunnar intelligens** (kräver prompt-iteration)

---

## Testning efter implementation
1. Solo-välj ett våningsplan -> verifiera att bara det våningsplanets rum och etiketter visas
2. Öppna TreeView -> bocka av ett våningsplan -> verifiera att det försvinner i 3D
3. Bocka i endast en dörr i TreeView -> verifiera att bara den visas
4. Gå till Inställningar -> Gunnar -> stäng av -> verifiera att knappen försvinner
5. Dra Gunnar-knappen till nytt läge -> ladda om -> verifiera att position sparades
6. AI-inventering: klicka bakåt i wizard -> verifiera att man kommer till föregående steg
7. Ställ Gunnar en fråga -> verifiera att förslag på följdfrågor visas
