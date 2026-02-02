

# Plan: Konfigurerbar rumsetikettering med nytt "Viewer Settings"-flik

## Sammanfattning
Implementera ett flexibelt system för rumsetiketter med:
1. **Ny "Viewer Settings"-flik** i ApiSettingsModal som samlar Teman + ny Etikettkonfiguration
2. **Konfigurerbar etikettvisning** baserad på rumsegenskaper (namn, nummer, area, etc.)
3. **Sparade etikettmallar** som kan väljas i VisualizationToolbar
4. **Förbättrad 2D-klippning** som faktiskt fungerar

---

## 1. Databasstruktur (ny tabell)

Skapa tabell `room_label_configs` i Lovable Cloud för att spara användarens etikettmallar:

```text
room_label_configs
├── id (uuid, PK)
├── name (text)             -- "Namn + Area", "Endast nummer"
├── fields (jsonb)          -- ["commonName", "designation", "nta"]
├── height_offset (float)   -- höjd ovanför golv, t.ex. 1.2
├── font_size (float)       -- basklocka storlek
├── scale_with_distance (bool) -- dynamisk skala
├── click_action (text)     -- 'none' | 'flyto' | 'roomcard'
├── is_default (bool)
├── created_at, updated_at
```

---

## 2. Nya/ändrade filer

| Fil | Ändring |
|-----|---------|
| `src/components/settings/ApiSettingsModal.tsx` | Byt ut "Teman"-flik mot "Viewer"-flik som innehåller både Teman och Etiketter |
| `src/components/settings/RoomLabelSettings.tsx` | **NY** - UI för att skapa/redigera etikettmallar |
| `src/hooks/useRoomLabelConfigs.ts` | **NY** - Hook för CRUD mot `room_label_configs` |
| `src/hooks/useRoomLabels.ts` | Utöka med stöd för dynamiska fält, klickhantering, distansskalning |
| `src/components/viewer/VisualizationToolbar.tsx` | Ersätt enkel switch med etikettmall-väljare |
| `src/hooks/useSectionPlaneClipping.ts` | **Fixa** - uppdatera planet istället för att återskapa det |
| `src/components/viewer/FloatingRoomCard.tsx` | **NY** - Mindre, flytande rumskort vid klick |

---

## 3. Detaljerad implementation

### 3.1 Ny "Viewer Settings"-flik i ApiSettingsModal

Ersätt:
```
Teman (tabindex 4)
```
Med:
```
Viewer (tabindex 4, ikon: View)
  └── Accordion/Collapsible:
      ├── Viewer-teman (befintlig ViewerThemeSettings)
      └── Rumsetiketter (ny RoomLabelSettings)
```

### 3.2 RoomLabelSettings-komponenten

```text
┌──────────────────────────────────────────────────────────┐
│ Rumsetiketter                                            │
│ Konfigurera hur etiketter visas på rum i 3D-viewern    │
├──────────────────────────────────────────────────────────┤
│ [+ Ny etikettkonfiguration]                              │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ 📋 Namn och Area                          [Redigera] │  │
│ │    Fält: commonName, nta                            │  │
│ │    Höjd: 1.2m | Klick: Rumskort                     │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ 📋 Endast rumsnummer                     [Redigera] │  │
│ │    Fält: designation                                │  │
│ │    Höjd: 1.0m | Klick: Flytta kameran              │  │
│ └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Redigeringsformulär:**
- **Namn**: Textruta
- **Fält att visa**: Multi-select chips från tillgängliga rumsegenskaper:
  - `commonName` (Rumsnamn)
  - `designation` (Rumsnummer)
  - `longName` (Långt namn)
  - `nta` (Nettoyta)
  - `bta` (Bruttoyta)
  - `function` (Funktion)
  - Custom property keys från PropertySet
- **Höjd ovanför golv**: Slider 0.1 - 2.5m
- **Skalas med avstånd**: Toggle
- **Klickåtgärd**: Select dropdown
  - "Ingen"
  - "Flytta kamera till rum" (CameraFlightAnimation)
  - "Visa rumskort"

### 3.3 Uppdatering av useRoomLabels.ts

Utöka hooken med:

```typescript
interface RoomLabelConfig {
  id: string;
  name: string;
  fields: string[];
  heightOffset: number;
  fontSize: number;
  scaleWithDistance: boolean;
  clickAction: 'none' | 'flyto' | 'roomcard';
}

// Ny funktion: Applicera konfiguration
const applyConfig = useCallback((config: RoomLabelConfig) => {
  activeConfigRef.current = config;
  if (enabledRef.current) {
    destroyLabels();
    createLabels();
  }
}, []);

// Ny funktion: Extrahera fältvärden från metaObject
const extractFieldValue = (metaObj: any, fieldKey: string): string => {
  // Checka attributes, propertySetValues, etc.
};

// Ny: Distance-based scaling i updateLabelPositions
const distance = vec3.distance(camera.eye, label.worldPos);
const scale = Math.max(0.5, Math.min(1.5, 20 / distance));
label.element.style.transform = `translate(-50%, -50%) scale(${scale})`;

// Ny: Klickhantering
label.element.style.pointerEvents = 'auto';
label.element.addEventListener('click', () => handleLabelClick(label));
```

### 3.4 Uppdatering av VisualizationToolbar

Ersätt nuvarande switch för "Rumsetiketter" med en expanderbar sektion:

```text
┌─────────────────────────────────────┐
│ [Type-ikon] Rumsetiketter      [▼]  │  <-- Klick öppnar lista
│   ├─ ◉ Av                           │
│   ├─ ○ Namn och Area                │
│   ├─ ○ Endast rumsnummer            │
│   └─ ○ [+ Hantera i inställningar]  │
└─────────────────────────────────────┘
```

### 3.5 FloatingRoomCard-komponent

En mindre, icke-modal version av UniversalPropertiesDialog som:
- Visar rummets nyckeldata (namn, nummer, area)
- Är draggbar
- Har en "stäng" X-knapp
- INTE blockerar 3D-interaktion (kameran kan fortfarande rotera)

### 3.6 Fixa 2D-klippning (useSectionPlaneClipping.ts)

**Problemet:** Funktionen `updateFloorCutHeight` återskapar planet varje gång slidern ändras, istället för att uppdatera det befintliga.

**Lösning:**

```typescript
const updateFloorCutHeight = useCallback((newHeight: number) => {
  floorCutHeightRef.current = newHeight;
  
  if (currentClipModeRef.current !== 'floor') return;
  if (!topPlaneRef.current) return;
  
  const topClipY = currentFloorMinYRef.current + newHeight;
  
  // RÄTT: Uppdatera befintligt plan direkt
  topPlaneRef.current.pos = [0, topClipY, 0];
  
  console.log(`2D top plane pos updated to Y=${topClipY.toFixed(2)}`);
}, []);
```

Om xeokit inte tillåter direkt `pos`-uppdatering, fallback till:
```typescript
if (typeof topPlaneRef.current.pos === 'object' && 'set' in topPlaneRef.current.pos) {
  topPlaneRef.current.pos.set([0, topClipY, 0]);
} else {
  // Fallback: recreate but with unique stable ID
  destroyPlane(topPlaneRef);
  topPlaneRef.current = createSectionPlaneOnScene(viewer, '2d-top-clip', [0, topClipY, 0], [0, 1, 0]);
}
```

---

## 4. Svar på dina frågor

### Kan labels skalas med avstånd?
**Ja, absolut.** Vi beräknar avståndet från kameran till etikettens 3D-position och applicerar en CSS `scale()` transform. Detta gör att etiketter är läsbara på nära håll men inte blockerar hela vyn när man zoomar ut.

```typescript
const distance = Math.sqrt(
  (camera.eye[0] - worldPos[0]) ** 2 +
  (camera.eye[1] - worldPos[1]) ** 2 +
  (camera.eye[2] - worldPos[2]) ** 2
);
const scale = Math.max(0.4, Math.min(1.2, 15 / distance));
```

### Kan man klicka på labels?
**Ja.** Vi sätter `pointer-events: auto` på label-elementen och lägger till event listeners. Två åtgärder:

1. **Flytta kamera till rummet** - Använder xeokit CameraFlightAnimation:
```typescript
viewer.cameraFlight.flyTo({
  aabb: entity.aabb,
  duration: 0.8
});
```

2. **Visa rumskort** - Öppnar FloatingRoomCard med rumsdata

### Annotation vs. HTML-labels?
**Rekommendation: Behåll nuvarande HTML-labels.**

Fördelar:
- Full kontroll över styling (CSS)
- Enkel klickhantering med standard DOM-events
- Flexibel innehållsrendering (ikoner, flera rader)
- Redan implementerat och testat

Nackdelar med xeokit AnnotationsPlugin:
- Begränsad styling
- Komplex integration med Asset+ wrapper-paketet
- Mindre flexibelt för dynamiskt innehåll

### Varför fungerar inte 2D-klippning?
**Identifierat problem:** I `updateFloorCutHeight` skapas ett nytt SectionPlane med dynamiskt ID (`2d-top-dynamic-${Date.now()}`) varje gång slidern ändras. Detta kan orsaka:
- Race conditions vid snabb slider-rörelse
- Gammalt plan tas inte alltid bort korrekt
- xeokit kanske inte hinner synkronisera

**Lösningen** är att antingen uppdatera det befintliga planets position direkt (`plane.pos = [...]`) eller använda ett stabilt ID så att samma plan återanvänds.

---

## 5. Migrations-SQL

```sql
CREATE TABLE public.room_label_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '["commonName", "designation"]',
  height_offset REAL NOT NULL DEFAULT 1.2,
  font_size REAL NOT NULL DEFAULT 10,
  scale_with_distance BOOLEAN NOT NULL DEFAULT true,
  click_action TEXT NOT NULL DEFAULT 'none' CHECK (click_action IN ('none', 'flyto', 'roomcard')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.room_label_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for now" ON public.room_label_configs FOR ALL USING (true);

-- Seed default configs
INSERT INTO public.room_label_configs (name, fields, height_offset, click_action, is_default) VALUES
  ('Rumsnamn', '["commonName"]', 1.2, 'none', true),
  ('Namn och nummer', '["commonName", "designation"]', 1.2, 'none', false),
  ('Namn och area', '["commonName", "nta"]', 1.2, 'roomcard', false);
```

---

## 6. Testplan

1. Öppna "Inställningar" -> "Viewer"-fliken
2. Verifiera att Teman fortfarande fungerar
3. Skapa ny etikettkonfiguration med fält "commonName" + "nta"
4. Gå till 3D-viewer, välj etikettmallan i Visning-menyn
5. Verifiera att etiketter visar rätt fält
6. Zooma in/ut - verifiera att etiketter skalas
7. Klicka på etikett - verifiera flyto/rumskort
8. Testa 2D-läge med klipphöjd-slider - verifiera att snittet uppdateras smidigt

