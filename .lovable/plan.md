
# Plan: Asset+ Återskrivning, API-dokumentation & Congeria Integration

## Översikt

Denna plan adresserar tre områden:

1. **Asset+ återskrivning** - Implementera `UpdateBimObjectsPropertiesData` för att skriva tillbaka ändringar till Asset+
2. **Geminus API-dokumentation** - Skapa en central dokumentationssamling för alla integrerade system
3. **Congeria dokumentsynk** - Hämta dokument via session-baserad inloggning (ingen API tillgänglig)

---

## Del 1: Asset+ Återskrivning (Write-back)

### API-analys från dokumentationen

Asset+ använder **separata endpoints** för olika operationer:

| Operation | Endpoint | Användning |
|-----------|----------|------------|
| Skapa objekt | `POST /AddObjectList` | Nya assets (redan implementerat via `asset-plus-create`) |
| Uppdatera properties | `POST /UpdateBimObjectsPropertiesData` | Ändra `commonName`, `designation`, user parameters |
| Flytta objekt | `POST /UpsertRelationships` | Ändra förälder (endast om `createdInModel = false`) |
| Radera objekt | `POST /ExpireObject` | Markera som utgånget med datum |

**Viktigt från dokumentationen:**

```text
Updating System and User Parameters:
- System parameters: Endast `designation` och `commonName` kan redigeras
- User parameters: Alla värden kan redigeras
- Key: Använd parameterns "Name" (inte flatPropertyName) vid uppdatering
```

### Payload-format för UpdateBimObjectsPropertiesData

```json
{
  "APIKey": "xxx",
  "UpdateBimObjectProperties": [{
    "FmGuid": "asset-fm-guid-here",
    "UpdateProperties": [
      { "Name": "commonName", "Type": 0, "Value": "Nytt namn" },
      { "Name": "designation", "Type": 0, "Value": "D-001" },
      { "Name": "MyCustomParam", "Type": 0, "Value": "Custom value" }
    ]
  }]
}
```

### Implementation

**Ny Edge Function: `supabase/functions/asset-plus-update/index.ts`**

```typescript
// Stöd för:
// - Batch-uppdatering av flera assets
// - Synkar BÅDE till Asset+ (för is_local=false) OCH lokal databas
// - Returnerar success per asset

interface UpdateAssetRequest {
  fmGuids: string[];  // Array för batch-stöd
  properties: Array<{
    name: string;      // "commonName", "designation", eller user parameter
    value: string | number | boolean;
    dataType?: number; // Default: 0 (String)
  }>;
}

async function updateAssets(request: UpdateAssetRequest) {
  // 1. Hämta assets från lokal DB för att avgöra is_local status
  // 2. Gruppera: locals → endast lokal uppdatering, synced → Asset+ + lokal
  // 3. Anropa Asset+ API för synced assets
  // 4. Uppdatera lokal databas för alla
}
```

**Uppdatera service: `src/services/asset-plus-service.ts`**

```typescript
export async function updateAssetProperties(
  fmGuids: string[],
  properties: AssetProperty[]
): Promise<{ success: boolean; results: UpdateResult[] }> {
  const { data, error } = await supabase.functions.invoke("asset-plus-update", {
    body: { fmGuids, properties },
  });
  // ...
}
```

**Koppla till UniversalPropertiesDialog**

Vid spara i `handleSave()`:
1. Om samtliga assets är `is_local = true` → endast lokal uppdatering
2. Om någon är `is_local = false` → anropa `asset-plus-update` Edge Function
3. Visa progress och resultat

### Filer att skapa/ändra

| Fil | Åtgärd |
|-----|--------|
| `supabase/functions/asset-plus-update/index.ts` | **NY** - Edge Function för återskrivning |
| `src/services/asset-plus-service.ts` | **ÄNDRA** - Implementera `updateAssetProperties()` |
| `src/components/common/UniversalPropertiesDialog.tsx` | **ÄNDRA** - Anropa update-service vid spara |

---

## Del 2: Geminus API-dokumentation

### Syfte

Skapa en central plats för att samla API-dokumentation från alla system som Geminus integrerar med. Detta underlättar framtida utveckling och felsökning.

### Struktur

```
docs/
├── api/
│   ├── README.md                    # Översikt över alla integrationer
│   ├── asset-plus/
│   │   ├── overview.md              # Sammanfattning och auth-flöde
│   │   ├── sync-api.md              # FMGUID sync-dokumentation
│   │   └── openapi.yaml             # OpenAPI-specifikation
│   ├── ivion/
│   │   ├── overview.md              # POI-hantering
│   │   └── endpoints.md             # Dokumenterade endpoints
│   ├── fm-access/
│   │   └── overview.md              # FM Access integration
│   ├── senslinc/
│   │   └── overview.md              # Sensor-data API
│   └── congeria/
│       └── overview.md              # Dokumenthantering (session-baserat)
```

### Innehåll för Asset+ dokumentation

**`docs/api/asset-plus/overview.md`**

```markdown
# Asset+ API Integration

## Autentisering
- OAuth2 Password Grant via Keycloak
- API Key krävs för alla anrop

## Endpoints

### Läsa data
- `POST /PublishDataServiceGetMerged` - Hämta objekt med alla properties

### Skriva data  
- `POST /AddObjectList` - Skapa nya objekt
- `POST /UpdateBimObjectsPropertiesData` - Uppdatera properties
- `POST /UpsertRelationships` - Flytta objekt
- `POST /ExpireObject` - Markera som utgånget

## Object Types
| Type | Namn | Beskrivning |
|------|------|-------------|
| 0 | Complex | Fastighetsportfölj |
| 1 | Building | Byggnad |
| 2 | Level | Våningsplan |
| 3 | Space | Rum |
| 4 | Instance | Asset/Komponent |

## Begränsningar
- Objekt skapade i BIM-modell (`createdInModel = true`) kan inte flyttas
- Endast `designation` och `commonName` kan uppdateras för system-parametrar
```

### Filer att skapa

| Fil | Beskrivning |
|-----|-------------|
| `docs/api/README.md` | Huvudöversikt för alla API:er |
| `docs/api/asset-plus/overview.md` | Asset+ sammanfattning |
| `docs/api/asset-plus/sync-api.md` | Detaljerad sync-dokumentation |
| `docs/api/asset-plus/openapi.yaml` | Kopia av OpenAPI-spec |
| `docs/api/ivion/overview.md` | Ivion POI-integration |
| `docs/api/congeria/overview.md` | Congeria dokumenthantering |

---

## Del 3: Congeria Dokumentsynkronisering

### Situation

- Ingen dokumenterad API tillgänglig
- Inloggning: Username/password
- URL-struktur: `https://fms.congeria.com/` med mappning per byggnad

### Strategi: Session-baserad hämtning

Eftersom det saknas API kommer vi använda en **webb-scraping-approach**:

1. **Logga in** och få session-cookie
2. **Navigera** till mappstruktur för aktuell byggnad
3. **Hämta** dokumentlista med metadata
4. **Ladda ner** dokument till Supabase Storage

### Mappning Geminus → Congeria

Baserat på skärmdumpen (`3272 - Småviken`):

| Geminus Byggnad | Congeria Mapp-URL |
|-----------------|-------------------|
| Småviken | `https://fms.congeria.com/.../3272 - Småviken/DoU/` |

**Förslag:** Lägg till ett fält i `assets`-tabellen eller en ny mappningstabell:

```sql
CREATE TABLE building_external_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid UUID NOT NULL REFERENCES assets(fm_guid),
  system_name TEXT NOT NULL,  -- 'congeria', 'ivion', etc
  external_url TEXT NOT NULL, -- Full URL till mappen
  external_id TEXT,           -- Om systemet har ID (t.ex. "3272")
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Edge Function: `congeria-sync`

```typescript
// supabase/functions/congeria-sync/index.ts

interface CongeriaSyncRequest {
  buildingFmGuid: string;
  congeriaUrl: string;  // Full URL till dokumentmappen
}

async function syncDocuments(request: CongeriaSyncRequest) {
  const username = Deno.env.get("CONGERIA_USERNAME");
  const password = Deno.env.get("CONGERIA_PASSWORD");
  
  // 1. Login - få session cookie
  const loginRes = await fetch("https://fms.congeria.com/login", {
    method: "POST",
    body: new URLSearchParams({ username, password }),
    redirect: "manual",
  });
  const cookies = loginRes.headers.get("set-cookie");
  
  // 2. Navigera till dokumentmapp
  const docListRes = await fetch(request.congeriaUrl, {
    headers: { Cookie: cookies },
  });
  
  // 3. Parsa HTML för att hitta dokument och metadata
  const html = await docListRes.text();
  const documents = parseDocumentList(html);
  
  // 4. Ladda ner varje dokument
  for (const doc of documents) {
    const fileData = await fetch(doc.downloadUrl, { headers: { Cookie: cookies } });
    // Spara till Supabase Storage
  }
}
```

### Databastabell för dokument

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,       -- Sökväg i Supabase Storage
  file_size INTEGER,
  mime_type TEXT,
  source_system TEXT DEFAULT 'congeria',
  source_url TEXT,               -- Original URL
  metadata JSONB DEFAULT '{}',   -- Congeria metadatafält
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index för snabb lookup per byggnad
CREATE INDEX idx_documents_building ON documents(building_fm_guid);
```

### UI-komponenter

**DocumentsTab i FacilityLandingPage**

```tsx
// src/components/portfolio/DocumentsTab.tsx
const DocumentsTab = ({ buildingFmGuid }: { buildingFmGuid: string }) => {
  const [documents, setDocuments] = useState([]);
  
  // Hämta dokument från lokal databas
  useEffect(() => {
    supabase
      .from("documents")
      .select("*")
      .eq("building_fm_guid", buildingFmGuid)
      .then(({ data }) => setDocuments(data || []));
  }, [buildingFmGuid]);
  
  return (
    <div>
      <h3>Dokument</h3>
      <DocumentList documents={documents} />
      <SyncFromCongeriaButton buildingFmGuid={buildingFmGuid} />
    </div>
  );
};
```

### Secrets att konfigurera

```
CONGERIA_USERNAME = [ditt användarnamn]
CONGERIA_PASSWORD = [ditt lösenord]
```

### Filer att skapa/ändra

| Fil | Åtgärd |
|-----|--------|
| `supabase/functions/congeria-sync/index.ts` | **NY** - Session-baserad dokumenthämtning |
| `supabase/migrations/xxx_create_documents_table.sql` | **NY** - Databastabell |
| `supabase/migrations/xxx_create_building_links_table.sql` | **NY** - Mappningstabell |
| `src/components/portfolio/DocumentsTab.tsx` | **NY** - UI för dokumentlista |
| `src/components/portfolio/FacilityLandingPage.tsx` | **ÄNDRA** - Lägg till Documents-flik |

---

## Implementeringsordning

### Fas 1: Asset+ återskrivning (prioritet)
1. Skapa `asset-plus-update` Edge Function
2. Implementera `updateAssetProperties()` i service
3. Koppla till UniversalPropertiesDialog
4. Testa med både lokala och synkade assets

### Fas 2: API-dokumentation
1. Skapa docs/api/ struktur
2. Kopiera och bearbeta Asset+ dokumentation
3. Dokumentera befintliga integrationer (Ivion, FM Access)

### Fas 3: Congeria (efter Fas 1 & 2)
1. Konfigurera secrets
2. Skapa byggnadsmappning
3. Implementera Edge Function
4. Skapa databastabeller
5. Bygga UI

---

## Tekniska detaljer

### Asset+ Write-back flöde

```text
┌─────────────────────────────┐
│ UniversalPropertiesDialog   │
│ handleSave()                │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Check: is_local status      │
│ för valda assets            │
└──────────────┬──────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐  ┌─────────────────────┐
│ is_local    │  │ is_local = false    │
│ = true      │  │ (synkade assets)    │
└──────┬──────┘  └──────────┬──────────┘
       │                    │
       ▼                    ▼
┌─────────────┐  ┌─────────────────────┐
│ Lokal DB    │  │ asset-plus-update   │
│ uppdatering │  │ Edge Function       │
└─────────────┘  └──────────┬──────────┘
                            │
                ┌───────────┼───────────┐
                ▼           ▼           ▼
         ┌──────────┐ ┌──────────┐ ┌──────────┐
         │Asset+ API│ │Lokal DB  │ │Response  │
         │UpdateBim │ │uppdatera │ │till UI   │
         └──────────┘ └──────────┘ └──────────┘
```

### Congeria Login-flöde

```text
┌─────────────────────────────┐
│ congeria-sync Edge Function │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ POST /login                 │
│ username + password         │
│ → Session cookie            │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ GET /path/to/folder         │
│ Cookie: session=xxx         │
│ → HTML med dokumentlista    │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Parse HTML                  │
│ → [{ name, url, meta }]     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Download varje fil          │
│ → Supabase Storage          │
│ → documents tabell          │
└─────────────────────────────┘
```
