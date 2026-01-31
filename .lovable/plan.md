
# Plan: Responsivitet, AI-skanning fix & IoT Labels i 3D

## Översikt

Denna plan åtgärdar tre områden:
1. **Mallsidans responsivitet** - Det lila/överlappande layouten
2. **AI-skanning 0 detektioner** - Regex-bugg som bryter JSON-parsning
3. **IoT-labels i 3D** - Hover-labels med sensordata i rumsvisualiseringen

---

## Del 1: Fixa mallsidans responsivitet

### Problem
På mobil (lila skärmdump) överlappar kontrollerna (Switch, Pencil, Trash2) med mallnamn och Badge. Layouten `flex items-start justify-between gap-4` på rad 349 i `TemplateManagement.tsx` fungerar inte på smala skärmar.

### Lösning
Ändra till staplad layout på mobil med `useIsMobile` hook:

```text
Desktop:                          Mobil:
┌─────────────────────────────────┐   ┌─────────────────────┐
│ Brandsläckare [Aktiv] [⚡][✏️][🗑️]│   │ Brandsläckare       │
│ Beskrivning...                  │   │ [Aktiv]             │
└─────────────────────────────────┘   │ Beskrivning...      │
                                      │ ┌─[⚡]─┬─[✏️]─┬─[🗑️]─┐│
                                      │ │ På  │Ändra│ Ta  ││
                                      │ └─────┴─────┴─bort─┘│
                                      └─────────────────────┘
```

### Teknisk implementation
- Importera `useIsMobile` hook
- På mobil: flytta kontrollerna till en egen rad under AI-prompt-rutan
- Gör knapparna större och mer touch-vänliga
- Lägg till textlabels på mobil för tydlighet

---

## Del 2: Fixa AI-skanning (0 detektioner)

### Problemanalys
Jag hittade buggen! På rad 717 i `ai-asset-detection/index.ts`:

```javascript
const jsonMatch = content.match(/\[[\s\S]*?\]/);
```

Denna regex är **non-greedy** (`*?`) vilket gör att den bara matchar till den första `]`. Om AI:n returnerar:
```json
[{"object_type":"fire_extinguisher","bounding_box":[1,2,3,4]}]
```
Så fångar den bara `[{"object_type":"fire_extinguisher","bounding_box":[1,2,3,4]` - avbruten mitt i nested array!

### Lösning
Byt till en mer robust JSON-extraktion som räknar brackets:

```typescript
// Hitta det första "[" och matcha till motsvarande "]"
function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
```

### Utökad loggning
Lägg till detaljerad loggning för felsökning:
- Logga AI:ns råsvar (första 500 tecken)
- Logga om JSON-extraktionen lyckades
- Logga antal parsade detektioner

---

## Del 3: IoT-labels i 3D rumsvisualisering

### Koncept (inspirerat av Autodesk Tandem)
När användaren har aktiverat en rumsvisualisering (t.ex. Temperatur) och hovrar över ett färglagt rum, ska en label visas med:
- Rumsnamn
- Aktuellt värde med enhet (t.ex. "22.5°C")
- Färgindikator som matchar rumsfärgen

### Teknisk approach

```text
┌─────────────────────────────────────────┐
│              3D Viewer                   │
│                                         │
│     ┌──────────────────┐                │
│     │ 🌡️ Kontor 301    │  ← Hover-label │
│     │ 21.8°C           │                │
│     └──────────────────┘                │
│          ▼                              │
│    [Färglagt rum]                       │
│                                         │
└─────────────────────────────────────────┘
```

### Implementation

1. **Skapa `IoTHoverLabel` komponent** - En CSS-positionerad label som följer musen
2. **Utöka `RoomVisualizationPanel`** - Lägg till hover-detektering via xeokit `cameraControl.on('hover')`
3. **Koppla till sensordata** - Hämta värde från `allData` baserat på hovrat rum

### Dataflöde

```text
1. Användaren väljer "Temperatur" i RoomVisualizationPanel
2. Rum färgläggs baserat på sensor-/mockdata
3. Användaren hovrar över ett rum i 3D
4. xeokit emittar hover-event med entity ID
5. Vi slår upp rummet i allData via fmGuid
6. Vi extraherar sensorvärde med extractSensorValue()
7. Vi visar label med namn + värde + enhet
```

---

## Teknisk sammanfattning

### Filer som ändras

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `src/components/ai-scan/TemplateManagement.tsx` | Ändra | Responsiv layout för mallkort |
| `supabase/functions/ai-asset-detection/index.ts` | Ändra | Fixa JSON-parsning + loggning |
| `src/components/viewer/RoomVisualizationPanel.tsx` | Ändra | Lägg till hover-label för sensordata |

### Ny komponent

| Fil | Beskrivning |
|-----|-------------|
| `src/components/viewer/IoTHoverLabel.tsx` | Hover-label komponent för 3D-vyn |

---

## Del 3a: IoT-label implementation

### IoTHoverLabel.tsx (ny fil)

Skapar en flyttbar, CSS-positionerad label:

```typescript
interface IoTHoverLabelProps {
  visible: boolean;
  position: { x: number; y: number };
  roomName: string;
  value: number;
  unit: string;
  color: [number, number, number];
}

const IoTHoverLabel: React.FC<IoTHoverLabelProps> = ({
  visible, position, roomName, value, unit, color
}) => {
  if (!visible) return null;
  
  return (
    <div 
      className="absolute pointer-events-none z-50 bg-card/95 backdrop-blur-sm 
                 border rounded-lg shadow-lg px-3 py-2 text-sm"
      style={{ 
        left: position.x + 12, 
        top: position.y - 20,
        borderLeftColor: `rgb(${color.join(',')})`,
        borderLeftWidth: 3
      }}
    >
      <div className="font-medium text-foreground">{roomName}</div>
      <div className="text-lg font-bold" style={{ color: `rgb(${color.join(',')})` }}>
        {value.toFixed(1)}{unit}
      </div>
    </div>
  );
};
```

### Hover-integration i RoomVisualizationPanel

Lägger till hover-lyssnare på xeokit viewer:

```typescript
// Ny state för hover-label
const [hoverLabel, setHoverLabel] = useState<{
  visible: boolean;
  position: { x: number; y: number };
  roomName: string;
  value: number;
  unit: string;
  color: [number, number, number];
} | null>(null);

// Hover-lyssnare på viewer
useEffect(() => {
  const viewer = viewerRef.current;
  const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (!xeokitViewer) return;
  
  const onHover = (hit: any, coords: number[]) => {
    if (!hit?.entity?.id || visualizationType === 'none') {
      setHoverLabel(null);
      return;
    }
    
    // Hitta rum via entity ID → fmGuid mappning
    const fmGuid = getRoomFmGuidFromEntity(hit.entity.id);
    if (!fmGuid) {
      setHoverLabel(null);
      return;
    }
    
    // Hämta rumsdata och sensorvärde
    const room = rooms.find(r => r.fmGuid.toLowerCase() === fmGuid.toLowerCase());
    if (!room) return;
    
    const value = useMockData 
      ? generateMockSensorData(room.fmGuid, visualizationType)
      : extractSensorValue(room.attributes, visualizationType);
    
    if (value === null) {
      setHoverLabel(null);
      return;
    }
    
    const color = getVisualizationColor(value, visualizationType);
    const config = VISUALIZATION_CONFIGS[visualizationType];
    
    setHoverLabel({
      visible: true,
      position: { x: coords[0], y: coords[1] },
      roomName: room.name || 'Okänt rum',
      value,
      unit: config.unit,
      color: color || [128, 128, 128]
    });
  };
  
  xeokitViewer.cameraControl.on('hover', onHover);
  return () => xeokitViewer.cameraControl.off('hover', onHover);
}, [viewerRef, visualizationType, rooms, useMockData]);
```

---

## Testplan

### 1. Mallsidans responsivitet
- Öppna AI-skanning på mobil (390px)
- Verifiera att kontroller inte överlappar mallnamn
- Verifiera att knappar är touch-vänliga

### 2. AI-skanning detektioner
- Starta ny skanning med existerande mallar
- Kontrollera loggar för AI-svarsutskrifter
- Verifiera att detektioner hittas och sparas

### 3. IoT hover-labels
- Öppna 3D-viewer för en byggnad
- Aktivera RoomVisualizationPanel
- Välj "Temperatur" (med simulerad data om nödvändigt)
- Hovra över färglagda rum
- Verifiera att label visas med namn + temperatur

---

## Framtida förbättringar (ej i denna plan)

1. **SensorURL-embed** - Bädda in Senslinc-dashboard via IOT+-knappen
2. **Realtidsdata** - Koppla till Senslinc API för live-sensorvärden
3. **Timeline-kontroll** - Scrubba genom historisk sensordata
4. **3D-heatmap overlay** - Färglägg golv/väggar som i Tandem
