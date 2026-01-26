
# Plan: Egenskap-panel förenkling, 3D-menyfix, och FM ACCESS-integration

## Sammanfattning
Denna plan adresserar fem huvudområden:
1. Förenkla egenskapsdialogen på landningssidor (slå ihop tabbar, mobilvänlig, sökbar)
2. Fixa höger-meny i 3D-viewer (positionering och funktionalitet)
3. Integrera xeokit-trädnavigator i höger-menyn
4. Implementera FM ACCESS API-integration
5. Utöka API-dokumentationen i Hjälpcentret

---

## Problem 1: UniversalPropertiesDialog - Förenkla och mobilanpassa

### Nuvarande läge
`UniversalPropertiesDialog` (rad 319-329) har två tabbar:
- **Lovable**: Redigerbara lokala egenskaper
- **Asset+**: Synkade egenskaper från Asset+

Mobilanvändare har problem med:
- Horizontal tabbar tar plats
- Ingen sök/filter-funktion för ~50+ egenskaper
- Fast bredd `w-[400px]` fungerar inte på mobil

### Lösning
Slå ihop till en enda sammanslagen vy med sektioner och sökfunktion:

**Fil**: `src/components/common/UniversalPropertiesDialog.tsx`

```text
Förändringar:
1. Ta bort Tabs-komponenten helt
2. Lägg till sökfält för att filtrera egenskaper
3. Gruppera egenskaper i kollapserbara sektioner:
   - System (fm_guid, category, etc.)
   - Koordinater (x, y, z)
   - Lovable (redigerbara)
   - Asset+ System
   - Asset+ User Defined Parameters
4. Mobil layout: Ändra från `w-[400px]` till `w-full max-w-[400px]`
5. Vertikal layout på mobil med staplad etikett/värde
6. Markera redigerbara fält tydligt med ikon
```

**Ny struktur**:
```text
+--------------------------------+
| [⠿] Labradorgatan 18    [—][X] |
+--------------------------------+
| 🔍 Sök egenskaper...           |
+--------------------------------+
| ▼ System                       |
|   FM GUID: 42495e64-...        |
|   Kategori: Building           |
+--------------------------------+
| ▼ Lokala inställningar    [✏️] |
|   Namn: Labradorgatan 18       |
|   Ivion Site ID: —             |
|   Favorit: Ja                  |
+--------------------------------+
| ▼ Area & Mått                  |
|   NTA: 1,234.56 m²             |
|   BRA: 1,156.78 m²             |
+--------------------------------+
| ▼ Användardefinierade          |
|   Hyresobjekt: ABC123          |
|   Golvmaterial: Klinker        |
+--------------------------------+
```

---

## Problem 2: Höger-meny i 3D fungerar inte

### Identifierade problem
1. **Positionering**: `top-4 right-14` kolliderar med AnnotationToggleMenu som renderas i samma rad
2. **Blockerad**: Headern i AssetPlusViewer har en container som kan blockera klick
3. **Ej synlig**: Knappen hamnar under/bakom andra element

### Nuvarande header-struktur (rad 1054-1092)
```text
<div className="absolute top-3 left-3 right-3 z-20 flex justify-between items-start pointer-events-none">
  <div className="flex gap-1.5 pointer-events-auto">
    [Stäng] [Maximera]
  </div>
  <div className="flex gap-1.5 pointer-events-auto">
    [AnnotationToggleMenu]
  </div>
</div>
```

### Lösning
Integrera VisualizationToolbar-knappen i samma header-rad som övriga knappar:

**Fil**: `src/components/viewer/AssetPlusViewer.tsx`

```text
Ändra rad 1054-1092:
<div className="absolute top-3 left-3 right-3 z-20 flex justify-between items-start pointer-events-none">
  {/* Vänster: Stäng + Maximera */}
  <div className="flex gap-1.5 pointer-events-auto">
    [Stäng] [Maximera]
  </div>
  
  {/* Höger: Visualisering + Annotationer */}
  <div className="flex gap-1.5 pointer-events-auto">
    <VisualizationToolbarButton /> {/* NY! */}
    [AnnotationToggleMenu]
  </div>
</div>
```

**Fil**: `src/components/viewer/VisualizationToolbar.tsx`

```text
Ändra rad 240-241:
Ta bort "absolute" positionering helt. 
Exportera endast knappen och Sheet-innehållet som en inline-komponent.
```

**Mobil**: Gör knapparna mindre med `h-8 w-8 sm:h-10 sm:w-10`

---

## Problem 3: Xeokit Tree Navigator saknas i höger-menyn

### Nuvarande läge
`ViewerTreePanel` (src/components/viewer/ViewerTreePanel.tsx) renderas separat som en absolut positionerad panel till vänster (`left-3`). Den aktiveras via en toggle i VisualizationToolbar, men är inte integrerad i menyn själv.

### Lösning
Lägg till trädnavigatorn som en inbäddad sektion i VisualizationToolbar Sheet:

**Fil**: `src/components/viewer/VisualizationToolbar.tsx`

```text
Under "Visualisering"-sektionen (rad 315-339), lägg till:

<Separator />

{/* Modellträd inline */}
<div>
  <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
    Navigator
  </Label>
  <div className="border rounded-lg max-h-[40vh] overflow-hidden">
    <ViewerTreePanel 
      viewerRef={viewerRef}
      isVisible={true}
      onClose={() => {}}
      embedded={true}  // Ny prop för inbäddad styling
    />
  </div>
</div>
```

**Fil**: `src/components/viewer/ViewerTreePanel.tsx`

Lägg till prop `embedded?: boolean`:
- Om `embedded=true`: Ta bort position absolut, border, shadow
- Visa trädinnehållet direkt utan header

---

## Problem 4: FM ACCESS API-integration

### Autentiseringsflöde
Baserat på dokumentationen:

```text
1. POST https://auth.bim.cloud/auth/realms/swg_demo/protocol/openid-connect/token
   Body: grant_type=client_credentials&client_id=HDCAgent+Basic
   → Returnerar: access_token

2. GET /api/version eller liknande för att hämta aktuell version-id
   Header: Authorization: Bearer {token}
   → Returnerar: version_id

3. Alla efterföljande API-anrop:
   Headers:
     - Authorization: Bearer {token}
     - X-Hdc-Version-Id: {version_id}
```

### Implementation

**Nya Supabase secrets som behövs**:
- `FM_ACCESS_TOKEN_URL` = "https://auth.bim.cloud/auth/realms/swg_demo/protocol/openid-connect/token"
- `FM_ACCESS_CLIENT_ID` = "HDCAgent Basic"
- `FM_ACCESS_API_URL` = (användarens FM Access API-URL)
- `FM_ACCESS_USERNAME` (om password grant flow)
- `FM_ACCESS_PASSWORD` (om password grant flow)

**Ny edge function**: `supabase/functions/fm-access-query/index.ts`

```text
Funktioner:
- POST /fm-access-query
  Body: { action: 'get-token' } → Hämtar och returnerar token + version
  Body: { action: 'get-drawings', buildingId: '...' } → Hämtar ritningar
  Body: { action: 'get-documents', buildingId: '...' } → Hämtar dokument
  Body: { action: 'test-connection' } → Testar anslutningen

Implementation:
1. Hämta token via client_credentials grant
2. Hämta version-id från FM Access API
3. Gör faktiska API-anrop med båda headers
4. Returnera data
```

**Fil**: `src/components/settings/ApiSettingsModal.tsx`

Uppdatera FM Access-sektionen (rad 881-908):

```text
Aktivera fälten istället för "Kommer snart":
- Token URL (https://auth.bim.cloud/auth/realms/swg_demo/protocol/openid-connect/token)
- Client ID (HDCAgent Basic)
- API Base URL
- Username (valfritt)
- Password (valfritt)
- Test Connection-knapp

Samma mönster som Asset+-konfigurationen.
```

---

## Problem 5: API-dokumentation för FM ACCESS i Hjälpcentret

### Nuvarande läge
`RightSidebar.tsx` (rad 81-114) har `API_CATEGORIES` med dokumentation för Asset+ API.

### Lösning
Lägg till FM ACCESS API-dokumentation:

**Fil**: `src/components/layout/RightSidebar.tsx`

```text
Lägg till i API_CATEGORIES (rad 81):

{
  name: 'FM Access - Ritningar',
  endpoints: [
    { method: 'GET', path: '/drawings', description: 'Hämta ritningar för byggnad' },
    { method: 'GET', path: '/drawings/{id}/pdf', description: 'Hämta ritning som PDF' },
    { method: 'GET', path: '/drawings/{id}/dwg', description: 'Hämta ritning som DWG' },
  ],
},
{
  name: 'FM Access - Dokument',
  endpoints: [
    { method: 'GET', path: '/documents', description: 'Hämta dokument för byggnad' },
    { method: 'GET', path: '/documents/{id}', description: 'Hämta specifikt dokument' },
    { method: 'POST', path: '/documents', description: 'Ladda upp dokument' },
  ],
},
{
  name: 'FM Access - Version',
  endpoints: [
    { method: 'GET', path: '/version', description: 'Hämta aktuell systemversion' },
    { method: '-', path: 'X-Hdc-Version-Id', description: 'Obligatorisk header för de flesta anrop' },
  ],
},
```

---

## Filändringar

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `src/components/common/UniversalPropertiesDialog.tsx` | Stor ändring | Ta bort tabbar, lägg till sök, mobilvänlig vertikal layout, grupperade sektioner |
| `src/components/viewer/VisualizationToolbar.tsx` | Ändra | Ta bort absolut positionering, exportera som inline-knapp, integrera trädnavigator |
| `src/components/viewer/ViewerTreePanel.tsx` | Ändra | Lägg till `embedded` prop för inbäddad styling |
| `src/components/viewer/AssetPlusViewer.tsx` | Ändra | Integrera VisualizationToolbar-knappen i header-raden, mobila knappstorleker |
| `src/components/settings/ApiSettingsModal.tsx` | Ändra | Aktivera FM Access-fält, spara till Supabase secrets |
| `src/components/layout/RightSidebar.tsx` | Ändra | Lägg till FM Access API-dokumentation |
| `supabase/functions/fm-access-query/index.ts` | Ny | Edge function för FM Access API |

---

## Tekniska detaljer

### UniversalPropertiesDialog - Söklogik
```text
const [searchQuery, setSearchQuery] = useState('');

// Filtrera alla egenskaper
const filteredProperties = useMemo(() => {
  const all = [...lovableProperties, ...assetPlusProperties];
  if (!searchQuery.trim()) return all;
  
  const q = searchQuery.toLowerCase();
  return all.filter(p => 
    p.label.toLowerCase().includes(q) ||
    String(p.value ?? '').toLowerCase().includes(q)
  );
}, [lovableProperties, assetPlusProperties, searchQuery]);
```

### FM Access Token Flow
```text
async function getFmAccessToken(): Promise<{ token: string; versionId: string }> {
  // 1. Get token
  const tokenRes = await fetch(FM_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&client_id=' + encodeURIComponent(FM_ACCESS_CLIENT_ID),
  });
  const { access_token } = await tokenRes.json();
  
  // 2. Get version ID
  const versionRes = await fetch(`${FM_ACCESS_API_URL}/version`, {
    headers: { 'Authorization': `Bearer ${access_token}` }
  });
  const { versionId } = await versionRes.json();
  
  return { token: access_token, versionId };
}
```

### NavCube mobilanpassning
```text
Rad 1100-1112: Ändra storlek på mobil:
width: window.innerWidth < 640 ? '60px' : '80px',
height: window.innerWidth < 640 ? '60px' : '80px',
```

---

## Prioritering

1. **Kritiskt**: Fixa höger-meny positionering (15 min)
2. **Viktigt**: Förenkla UniversalPropertiesDialog (30 min)
3. **Viktigt**: Integrera trädnavigator i höger-meny (20 min)
4. **Funktion**: FM Access API-inställningar UI (20 min)
5. **Funktion**: FM Access edge function (30 min)
6. **Komplettering**: API-dokumentation i Hjälpcentret (10 min)
7. **Polish**: Mobila knappstorleker (10 min)

**Total uppskattad tid**: ~2.5 timmar

---

## Framtida utbyggnad

- FM Access dokument-viewer integrerad i landningssidor
- Ritningsöverlägg i 3D-viewern
- Synkronisering av FM Access-data till lokal databas
- Sökbar ritningsarkiv-vy i Navigator
