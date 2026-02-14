

## Fix: 2D FMA med iframe-inbäddning av HDC FM-klienten

### Vad vi vet nu

FM Access (Tessel HDC) har en fullständig webbklient på `/client/` med **inbyggt stöd for iframe-inbäddning** via ett `postMessage`-protokoll. Samma mekanism som er Windows-app använder:

1. Ladda `/client/?awaitConfig=true` -- appen väntar och visar en spinner
2. Appen skickar `HDC_APP_READY_FOR_CONFIG` via `postMessage` till parent
3. Parent svarar med auth-token och navigeringsinstruktioner
4. Appen loggar in och navigerar till rätt ritning
5. Appen skickar `HDC_APP_SYSTEM_READY` när den är klar

### Lösning

Istället for att konstruera en fabricerad `/viewer/2d`-URL (som inte finns), bäddar vi in den riktiga HDC FM-klienten och styr den via `postMessage`. Vi döljer oönskade UI-delar med CSS som injiceras i iframen.

### Del 1: Edge Function -- ny `get-embed-config` action

**Fil: `supabase/functions/fm-access-query/index.ts`**

Lägga till en ny action `get-embed-config` som returnerar allt frontend behöver:

```text
Request:  { action: "get-embed-config", buildingId, floorName, fmAccessBuildingGuid, buildingName }
Response: { 
  success: true, 
  embedUrl: "https://swg-demo.bim.cloud/client/?awaitConfig=true",
  token: "eyJ...",
  versionId: 397,
  drawingObjectId: "11482"   // resolved via perspective tree
}
```

- Återanvänder befintlig logik for building-matchning och floor-matchning (perspective tree lookup)
- Returnerar token, versionId och drawingObjectId separat (inte som URL-parametrar)
- Fix: `fmAccessFetch` ska inte skicka `Content-Type: application/json` för GET-anrop

### Del 2: Frontend -- omskriven FmAccess2DPanel

**Fil: `src/components/viewer/FmAccess2DPanel.tsx`**

Helt ny approach baserad på `postMessage`-protokollet:

1. **Hämta embed-config** via edge function (token + drawingObjectId)
2. **Ladda iframe** med `{apiUrl}/client/?awaitConfig=true`
3. **Lyssna på `message`-event** for `HDC_APP_READY_FOR_CONFIG`
4. **Svara med config** via `postMessage`:
   - Auth-token och versionId
   - Navigeringsinstruktion till rätt ritning (drawingObjectId)
5. **Lyssna på `HDC_APP_SYSTEM_READY`** -- dölj loading-overlay
6. **Dölj oönskade UI-delar** genom att injicera CSS i iframen via `postMessage` eller genom att lägga ett overlay som döljer sidmenyer/header

Flödet:
```text
1. FmAccess2DPanel mountas
2. Hämtar token + drawingObjectId via edge function
3. Sätter iframe src = "https://swg-demo.bim.cloud/client/?awaitConfig=true"
4. Visar loading-overlay (opak, döljer iframen)
5. Lyssnar på postMessage
6. HDC_APP_READY_FOR_CONFIG tas emot -->
     Skickar token, versionId, navigation via postMessage
7. HDC_APP_SYSTEM_READY tas emot -->
     Tar bort loading-overlay, visar iframen
```

**UI-döljning**: Eftersom iframen är cross-origin kan vi inte injicera CSS direkt. Istället:
- Använder CSS `clip-path` eller `overflow: hidden` + negativ margin på iframe-containern for att beskära bort header/sidebar
- Alternativt: HDC FM-klienten kan ha URL-parametrar for att styra UI (behöver testas live)

### Del 3: Behåll befintliga states

Alla befintliga UI-states behålls oförändrade:
- "Ingen våning vald" -- med `onChangeFloor`-knapp
- Loading-state -- med spinner
- Error-state -- med retry + byt våning
- Badge "FM Access 2D" i hörnet

### Filer som ändras

- `supabase/functions/fm-access-query/index.ts` -- ny `get-embed-config` action + fix GET Content-Type
- `src/components/viewer/FmAccess2DPanel.tsx` -- omskrivning: postMessage-baserad iframe-inbäddning

### Tekniska detaljer

**postMessage-config format (baserat på HDC FM-källkoden):**
```text
// Skickas till iframen efter HDC_APP_READY_FOR_CONFIG
iframe.contentWindow.postMessage({
  type: "HDC_CONFIG",
  token: "eyJ...",
  versionId: 397,
  objectId: 11482,       // navigera till ritningen
  // eventuellt: hideHeader, hideNavigation etc.
}, "https://swg-demo.bim.cloud")
```

**fmAccessFetch fix:**
```text
// Ta bort Content-Type: application/json för GET-requests
const headers = { 'X-Authorization': `Bearer ${token}` };
if (versionId) headers['X-Hdc-Version-Id'] = versionId;
// Bara sätt Content-Type om det är POST/PUT/PATCH:
if (method !== 'GET') headers['Content-Type'] = 'application/json';
```

**Loading-overlay strategi:**
```text
// Iframen laddas med opacity: 0
// En opak loading-overlay visas ovanpå
// När HDC_APP_SYSTEM_READY tas emot:
//   - Dölj overlay med transition
//   - Sätt iframe opacity: 1
```

