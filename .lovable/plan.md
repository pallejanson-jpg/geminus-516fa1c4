
# Plan: Intelligent & Kontextmedveten AI-Assistent "Gunnar"

## Sammanfattning

Denna plan transformerar Gunnar från en enkel dataassistent till en kontextmedveten AI-copilot som följer användaren överallt i systemet och kan besvara frågor baserat på:
1. **Databasdata** - Direkt SQL-förfrågan mot 44,000+ assets i Supabase
2. **Applikationskontext** - Var användaren befinner sig (byggnad, våning, rum, 3D-vy)
3. **Användarens nuvarande val** - Aktiv selektion, visningsläge, filtreringar

---

## Del 1: Gunnar-ikon Överallt i Systemet

### Problem
Gunnar finns endast på startsidan. Användaren vill ha tillgång till assistenten oavsett var de befinner sig.

### Lösning: Flytande Gunnar-ikon

**Ny komponent: `src/components/chat/GunnarButton.tsx`**

```text
Design:
- Rund, modern ikon (48x48px desktop, 40x40px mobil)
- Mjuk gradient eller glasmorfism-effekt
- Subtil pulse-animation när Gunnar har något att säga
- Positionerad bottom-right corner (fixed position)
- Respekterar säkerhetszoner på mobil
- Tooltip "Fråga Gunnar" på hover

Ikon-design:
- Stiliserad "G" med AI-sparkles
- Eller: Chat-bubbla med hjärna/spark
- Färg: Primär app-färg med accent
```

**Placering: `src/components/layout/AppLayout.tsx`**

```tsx
// Ny import
import GunnarButton from '@/components/chat/GunnarButton';

// I AppLayoutInner, lägg till efter VoiceControlButton:
<GunnarButton />
```

**Ikon ska visas på:**
- Home
- Portfolio / Facility Landing Page  
- Navigator
- Insights
- Map
- 3D Viewer
- Inventory

---

## Del 2: Kontextmedveten Gunnar-Backend

### Nuvarande Problem
Edge-funktionen `gunnar-chat/index.ts` hämtar bara grundläggande statistik (kategorier, sample-data). Den vet inte:
- Vilken byggnad användaren tittar på
- Vilket våningsplan som är aktivt
- Vilka assets som är synliga i 3D

### Lösning: Skicka Applikationskontext till Backend

**Uppdaterad frontendanrop (`GunnarChat.tsx`):**

```typescript
// Ny context-struktur som skickas till edge function
interface GunnarContext {
  // Var i appen användaren befinner sig
  activeApp: string; // 'home' | 'portfolio' | 'viewer' | 'navigator' etc.
  
  // Byggnadsnivå
  currentBuildingFmGuid?: string;
  currentBuildingName?: string;
  
  // Våningsnivå
  currentStoreyFmGuid?: string;
  currentStoreyName?: string;
  
  // Rumsnivå
  currentSpaceFmGuid?: string;
  currentSpaceName?: string;
  
  // 3D Viewer-specifikt
  viewerState?: {
    viewMode: '2d' | '3d';
    visibleFloorIds: string[];
    visibleModelIds: string[];
    selectedFmGuids: string[];
  };
  
  // Aktiv selektion i navigator
  selectedFmGuids?: string[];
}
```

**Källa för kontext:**
```text
- activeApp: från AppContext
- currentBuilding: från selectedFacility eller viewer3dFmGuid
- currentStorey: från FloorCarousel val eller navigator-val
- currentSpace: från selectedFacility om category='Space'
- viewerState: från viewer component state (behöver event/context)
```

---

## Del 3: Intelligenta SQL-frågor i Backend

### Nuvarande Problem
Backend gör bara hårdkodade frågor för floor covering och brandredskap.

### Lösning: Dynamisk Frågeförståelse

**Uppdaterad `gunnar-chat/index.ts`:**

```typescript
// Ny systemprompt med SQL-generation capability
const dataContext = `
Du är Gunnar, en intelligent AI-assistent för fastighetssystem.

TILLGÄNGLIG DATA (Supabase tabell: assets):
- Totalt: ${totalAssets} assets
  - Byggnader: ${categoryCounts['Building'] || 0}
  - Våningsplan: ${categoryCounts['Building Storey'] || 0}
  - Rum (Spaces): ${categoryCounts['Space'] || 0}
  - Inventarier/Tillgångar: ${categoryCounts['Instance'] || 0}

NUVARANDE KONTEXT (var användaren befinner sig):
${context.currentBuildingName ? `- Aktiv byggnad: ${context.currentBuildingName}` : ''}
${context.currentStoreyName ? `- Aktivt våningsplan: ${context.currentStoreyName}` : ''}
${context.currentSpaceName ? `- Aktivt rum: ${context.currentSpaceName}` : ''}
${context.activeApp ? `- Aktiv vy: ${context.activeApp}` : ''}

KOLUMNER I ASSETS-TABELLEN:
- fm_guid: Unik identifierare
- common_name: Beskrivande namn
- category: 'Building' | 'Building Storey' | 'Space' | 'Instance'
- building_fm_guid: Referens till byggnad
- level_fm_guid: Referens till våningsplan  
- in_room_fm_guid: Referens till rum (för Instance)
- gross_area: Yta i m²
- attributes: JSONB med utökade egenskaper

FRÅGEEXEMPEL DU KAN BESVARA:
- "Hur många rum finns i Småviken?" → Räkna spaces med building_fm_guid
- "Vilka våningsplan har byggnaden?" → Lista storeys för vald byggnad
- "Hur många tillgångar finns på plan 2?" → Räkna instances på level
- "Vilken area har byggnaden?" → Summera gross_area för spaces

FÖR FRÅGOR SOM KRÄVER DATA:
Generera en SQL-fråga i format:
\`\`\`sql
SELECT ... FROM assets WHERE ...
\`\`\`

Jag kommer köra frågan och ge dig resultatet.
`;
```

**Ny fråge-loop i edge function:**

```typescript
// 1. Första AI-anrop: Förstå frågan, generera ev. SQL
const initialResponse = await callAI(messages, dataContext);

// 2. Extrahera SQL om genererad
const sqlMatch = initialResponse.match(/```sql\n([\s\S]*?)\n```/);
if (sqlMatch) {
  const sql = sqlMatch[1];
  // Validera: endast SELECT, inga DROP/DELETE etc.
  if (sql.trim().toLowerCase().startsWith('select')) {
    const { data, error } = await supabase.rpc('execute_readonly_query', { query: sql });
    // Eller direkt: await supabase.from('assets').select(...)
    
    // 3. Andra AI-anrop: Formulera svar baserat på resultat
    const finalResponse = await callAI([
      ...messages,
      { role: 'assistant', content: initialResponse },
      { role: 'system', content: `Query result: ${JSON.stringify(data)}` }
    ], 'Formulera ett tydligt svar baserat på query-resultatet.');
  }
}
```

---

## Del 4: Byggnadsspecifika Frågor

### Exempel på frågor Gunnar ska kunna besvara

| Fråga | Logik |
|-------|-------|
| "Hur många våningsplan finns i Småviken?" | `SELECT COUNT(*) FROM assets WHERE building_fm_guid = '...' AND category = 'Building Storey'` |
| "Hur många rum finns på plan 2?" | `SELECT COUNT(*) FROM assets WHERE level_fm_guid = '...' AND category = 'Space'` |
| "Vilka rum har störst area?" | `SELECT common_name, gross_area FROM assets WHERE category = 'Space' ORDER BY gross_area DESC LIMIT 10` |
| "Hur många brandsläckare finns i denna byggnad?" | `SELECT COUNT(*) FROM assets WHERE building_fm_guid = '...' AND asset_type ILIKE '%brand%'` |
| "Lista alla tillgångar i detta rum" | `SELECT * FROM assets WHERE in_room_fm_guid = '...'` |

---

## Del 5: 3D Viewer Integration

### Problem
Gunnar vet inte vad som visas i 3D-viewern.

### Lösning: Viewer-context Events

**Ny event i `viewer-events.ts`:**
```typescript
export const VIEWER_CONTEXT_CHANGED_EVENT = 'VIEWER_CONTEXT_CHANGED';

export interface ViewerContextDetail {
  buildingFmGuid: string;
  viewMode: '2d' | '3d';
  visibleFloorFmGuids: string[];
  visibleModelIds: string[];
  selectedFmGuids: string[];
  clipHeight: number;
}
```

**AssetPlusViewer dispatchar vid ändringar:**
```typescript
// När state ändras, dispatcha event
useEffect(() => {
  window.dispatchEvent(new CustomEvent(VIEWER_CONTEXT_CHANGED_EVENT, {
    detail: {
      buildingFmGuid: fmGuid,
      viewMode: currentViewMode,
      visibleFloorFmGuids,
      selectedFmGuids,
      // ...
    }
  }));
}, [fmGuid, currentViewMode, visibleFloorFmGuids, selectedFmGuids]);
```

**GunnarButton lyssnar och uppdaterar kontext:**
```typescript
// I GunnarButton.tsx
const [viewerContext, setViewerContext] = useState<ViewerContextDetail | null>(null);

useEffect(() => {
  const handler = (e: CustomEvent<ViewerContextDetail>) => {
    setViewerContext(e.detail);
  };
  window.addEventListener(VIEWER_CONTEXT_CHANGED_EVENT, handler);
  return () => window.removeEventListener(VIEWER_CONTEXT_CHANGED_EVENT, handler);
}, []);
```

---

## Del 6: Viewer-kommandon

### Gunnar ska kunna ge instruktioner till viewern

**Ny action-typ i chat-respons:**
```typescript
// Existerande:
{"action": "selectInTree", "fmGuids": ["guid1", "guid2"]}

// Nya:
{"action": "showFloor", "floorFmGuid": "..."}
{"action": "highlight", "fmGuids": ["guid1", "guid2"]}
{"action": "switchTo2D"}
{"action": "switchTo3D"}
{"action": "toggleModel", "modelId": "...", "visible": true}
{"action": "flyTo", "fmGuid": "..."}
```

**Systemprompt-tillägg:**
```text
I 3D-VIEWERN KAN DU:
- Visa ett specifikt våningsplan: {"action": "showFloor", "floorFmGuid": "..."}
- Highlighta objekt: {"action": "highlight", "fmGuids": [...]}
- Växla till 2D-vy: {"action": "switchTo2D"}
- Växla till 3D-vy: {"action": "switchTo3D"}
- Flyga till ett objekt: {"action": "flyTo", "fmGuid": "..."}

Använd dessa actions när användaren ber om saker som:
- "Visa plan 2" → {"action": "showFloor", "floorFmGuid": "..."}
- "Tänd modell X" → {"action": "toggleModel", "modelId": "...", "visible": true}
```

---

## Del 7: UI/UX Förbättringar

### Gunnar-ikon Design
```text
Alternativ 1: Spark-ikon
- Lucide "Sparkles" med gradient
- Blå/lila gradient (#6366F1 → #8B5CF6)

Alternativ 2: Custom "G"
- Stiliserad bokstav G i cirkel
- Med små AI-sparkles runt

Alternativ 3: Robot/Hjärna
- Lucide "Brain" eller "Bot"
- Med chat-bubbla overlay
```

### Kontextuell Hälsning
```typescript
// GunnarChat öppnas med kontextbaserad hälsning
const getGreeting = (context: GunnarContext) => {
  if (context.currentBuildingName) {
    return `Hej! Jag ser att du tittar på ${context.currentBuildingName}. Vad vill du veta om den?`;
  }
  if (context.activeApp === 'assetplus_viewer') {
    return `Hej! Du är i 3D-viewern. Jag kan hjälpa dig navigera eller hitta specifika objekt.`;
  }
  return `Hej! Jag är Gunnar, din dataassistent. Vad kan jag hjälpa dig med?`;
};
```

---

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/chat/GunnarButton.tsx` | **NY** - Flytande ikon-komponent |
| `src/components/chat/GunnarChat.tsx` | Utöka med context-stöd, nya actions |
| `src/components/layout/AppLayout.tsx` | Lägg till GunnarButton |
| `src/context/AppContext.tsx` | Lägg till gunnarContext state |
| `src/lib/viewer-events.ts` | Lägg till VIEWER_CONTEXT_CHANGED_EVENT |
| `src/components/viewer/AssetPlusViewer.tsx` | Dispatcha viewer context events |
| `supabase/functions/gunnar-chat/index.ts` | Utöka med SQL-generation, context |

---

## Tekniska Detaljer

### Context State i AppContext
```typescript
// Ny typ
export interface GunnarContext {
  activeApp: string;
  currentBuilding: { fmGuid: string; name: string } | null;
  currentStorey: { fmGuid: string; name: string } | null;
  currentSpace: { fmGuid: string; name: string } | null;
  viewerState: ViewerContextDetail | null;
}

// Ny state
const [gunnarContext, setGunnarContext] = useState<GunnarContext>({
  activeApp: 'home',
  currentBuilding: null,
  currentStorey: null,
  currentSpace: null,
  viewerState: null,
});
```

### Säker SQL i Edge Function
```typescript
// Validera att query är säker
function validateReadOnlyQuery(sql: string): boolean {
  const normalized = sql.toLowerCase().trim();
  // Måste starta med SELECT
  if (!normalized.startsWith('select')) return false;
  // Får inte innehålla farliga operationer
  const forbidden = ['drop', 'delete', 'update', 'insert', 'alter', 'create', 'truncate'];
  for (const word of forbidden) {
    if (normalized.includes(word)) return false;
  }
  return true;
}
```

---

## Leveransordning

1. **GunnarButton.tsx** - Ny flytande ikon
2. **AppLayout.tsx** - Integrera GunnarButton
3. **AppContext.tsx** - GunnarContext state
4. **GunnarChat.tsx** - Skicka context, hantera nya actions
5. **viewer-events.ts** - VIEWER_CONTEXT_CHANGED_EVENT
6. **AssetPlusViewer.tsx** - Dispatcha context events
7. **gunnar-chat/index.ts** - SQL-generation, kontextförståelse, nya actions

---

## Testfall

1. **Hem** - Öppna Gunnar, fråga "Hur många byggnader finns det?" → Ska svara "14 byggnader"
2. **Portfolio/Småviken** - Fråga "Hur många våningsplan?" → Ska svara baserat på aktuell byggnad
3. **3D Viewer** - Fråga "Visa plan 2" → Ska dispatcha showFloor action
4. **Navigator** - Fråga "Hitta alla rum med betong" → Ska visa "Show in Navigator" knapp
5. **Kontext** - Byt byggnad, öppna Gunnar igen → Hälsning ska nämna ny byggnad
