# Hantering av system från BIM-modeller (IFC & ACC)

> Teknisk översikt för utvecklingsteamet. Beskriver hur Geminus extraherar,
> normaliserar och persisterar **system** (ventilation, värme, el, VS, brand m.fl.)
> samt **objekt-till-system-relationer** och **flödeskopplingar** från BIM-källor.

---

## 1. Bakgrund och designprinciper

BIM-modeller representerar "system" på minst tre olika sätt – och sällan
konsekvent mellan discipliner/leverantörer:

1. **Explicita IFC-system** – `IfcSystem` / `IfcDistributionSystem`, kopplade till
   element via `IfcRelAssignsToGroup`.
2. **Property-baserade system** – elementen har en `Pset_*`-property som
   `SystemName`, `System Type`, `Systemförkortning` etc., men ingen explicit
   gruppering.
3. **Flödestopologi** – kopplingar mellan element via `IfcRelConnects…`,
   `IfcRelFlowControlElements`, portar etc.

Vår lösning hanterar **alla tre** och slår ihop dem i en gemensam, normaliserad
datamodell. Två separata extraktionspipelines används beroende på källan:

| Källa | Edge function | Råformat |
|-------|---------------|----------|
| IFC-uppladdning | `ifc-extract-systems` | `.ifc` → web-ifc (WASM) → metaObjects |
| Autodesk ACC | `acc-sync` | ACC Model Derivative properties (JSON) |

Båda skriver till **samma tabeller** (`systems`, `asset_system`, `asset_connections`,
`asset_external_ids`) så att klient- och AI-kod inte behöver bry sig om ursprunget.

---

## 2. Datamodell

```
┌──────────────────────┐        ┌───────────────────────┐
│       systems        │        │      asset_system     │
│──────────────────────│        │───────────────────────│
│ id (uuid PK)         │◀───────│ system_id (FK)        │
│ fm_guid (unik)       │   N:N  │ asset_fm_guid (FK)    │
│ name                 │        │ role                  │
│ system_type          │        └───────────────────────┘
│ discipline           │                  │
│ source ('ifc'|'ifc-  │                  │
│   property'|'acc')   │                  ▼
│ building_fm_guid     │        ┌───────────────────────┐
│ is_active            │        │        assets         │
└──────────────────────┘        │ fm_guid (PK)          │
                                │ name, category, …     │
┌──────────────────────┐        └───────────────────────┘
│   asset_connections  │                  ▲
│──────────────────────│                  │
│ from_fm_guid         │──────────────────┘
│ to_fm_guid           │   används av flödesvisualisering / AI
│ connection_type      │   (flow / port / structural)
│ direction            │
│ source               │
└──────────────────────┘

┌──────────────────────┐
│ asset_external_ids   │   brygga mellan BIM-källors GUIDs och våra fm_guid
│──────────────────────│
│ fm_guid              │
│ source ('ifc'|'acc') │
│ external_id          │   ← IFC GlobalId eller ACC externalId
│ model_version        │
│ last_seen_at         │
└──────────────────────┘
```

`fm_guid` för system är deterministisk: `sys-{buildingFmGuid}-{systemName}`.
Detta gör upserts idempotenta – samma system från flera modellversioner kollapsar
till samma rad.

---

## 3. IFC-pipeline – `supabase/functions/ifc-extract-systems/`

### 3.1 Indata
- IFC-fil i Supabase Storage (`ifc-uploads/{buildingFmGuid}/...`), **eller**
- redan genererad `*_metadata.json` (XKT-meta) i `xkt-models/{buildingFmGuid}/`.
  Om metafilen finns används den direkt – mycket snabbare än att starta WASM.

### 3.2 Steg

1. **Ladda metaObjects** – antingen från cached metadata eller via `web-ifc`.
   Mappar IFC-typer → Geminus kategorier (`Wall`, `Door`, `Pipe`, `Sensor`…)
   via tabellen `IFC_TO_GEMINUS_CATEGORY`.

2. **`extractSystemsAndConnections(metaObjects)`** – kärnan:
   - **Explicita system**: alla objekt med `metaType` = `IfcSystem` eller
     `IfcDistributionSystem` skapar en `ExtractedSystem`. Barn (via
     `parentMetaObjectId`) blir `memberIds`.
   - **Property-grupperade system**: alla objekt vars propertyset innehåller
     `SystemName` / `System Name` / `System_Name` grupperas. Medlemmar som
     **inte** redan ingår i ett explicit system bildar ett `PropertyGrouped`-system.
   - **Connections**: alla relationer vars typ börjar med `ifcrelconnects` eller
     är `ifcrelflowcontrolelements` blir `asset_connections` (flow/port/structural).

3. **`inferDiscipline(name, type)`** – regex-baserad klassning till
   `Ventilation | Heating | Cooling | Electrical | Plumbing | FireProtection | Other`.
   Matchar både svenska och engelska termer (`vent`, `vs`, `kyl`, `el-`, `brand`…).

4. **`reconcileGuids(...)`** – matchar IFC `GlobalId` mot befintliga assets med
   3-stegsstrategi:
   1. Direkt slå upp i `asset_external_ids` (source='ifc').
   2. Namn+kategori-match mot redan synkade assets i byggnaden.
   3. Fallback: använd `GlobalId` självt som `fm_guid` (identity mapping).
   Resultatet är en `Map<ifcGuid, fm_guid>` som används för alla upserts.

5. **`persistSystemsAndConnections(...)`** – upsertar i ordning:
   1. `asset_external_ids` (chunk 500) – för framtida rekonciliering.
   2. `systems` (onConflict `fm_guid`).
   3. `asset_system` (onConflict `asset_fm_guid,system_id`).
   4. `asset_connections` (onConflict `from_fm_guid,to_fm_guid,connection_type`).

### 3.3 Anrop från klient
`src/components/settings/CreateBuildingPanel.tsx` triggar funktionen direkt efter
IFC-uppladdning eller XKT-konvertering:

```ts
supabase.functions.invoke('ifc-extract-systems', {
  body: { buildingFmGuid, ifcStoragePath, mode: 'systems-only' }
});
```

Vid timeout sker automatisk retry mot cached metadata.

---

## 4. ACC-pipeline – `supabase/functions/acc-sync/`

ACC (Autodesk Construction Cloud) levererar inte IFC – istället hämtas
**Model Derivative properties** som platt JSON. Pipelinen i `acc-sync` gör
motsvarande extraktion men från property-namn istället för IFC-relationer.

### 4.1 Property-detektion
Vid första passet över ett ACC-objekts properties identifieras fyra
nycklar dynamiskt (case/space-insensitivt, sv+en):

| Logisk roll  | Matchade nycklar |
|--------------|------------------|
| `systemName` | `System Name`, `Systemnamn`, `system_name` |
| `systemType` | `System Type`, `Systemtyp` |
| `systemClass`| `System Classification`, `Systemklassificering` |
| `systemAbbr` | `System Abbreviation`, `Systemförkortning` |

Per instans resolveras `systemName = sysName ?? sysAbbr` och
`systemType = sysType ?? sysClass` – så att modeller som bara fyllt i
förkortning/klassificering ändå grupperas.

### 4.2 Gruppering & persistens
Identisk tabellstruktur som IFC-pipen:
- `systemGroups: Map<sysName, { type, memberFmGuids[] }>`
- Genererar `fm_guid = sys-{buildingFmGuid}-{name}`
- Använder samma `inferDiscipline()`-regex
- `source = 'acc'` istället för `'ifc'` / `'ifc-property'`

Medlemmarna länkas via `acc-bim-instance-{externalId}` som matchar
ACC-instansernas fm_guid-konvention. `asset_external_ids` skrivs i steg 6 så
att samma externalId kan rekoncilieras när IFC kommer från samma modell.

---

## 5. Cross-source-rekonciliering

Eftersom både IFC- och ACC-pipelines kan köra på **samma byggnad** (t.ex. ACC
levererar instanser, en separat IFC-export levererar `IfcSystem`-grupperingen)
delas allt via:

- **`asset_external_ids`** – varje fm_guid kan ha flera external_ids
  (`source='ifc'` och `source='acc'`) för samma fysiska objekt.
- **Deterministiska system-fm_guid** – `sys-{building}-{name}` säkerställer att
  ett system som heter "VS01" från ACC + samma "VS01" från IFC mergas till
  **en** rad i `systems`, med medlemmar från båda källorna i `asset_system`.

---

## 6. Konsumenter

| Yta | Hur den använder data |
|-----|-----------------------|
| 3D-viewer (`ObjectColorFilterPanel`) | Färgar objekt per `discipline` eller `system_id` |
| `InventoryPanel` | Listar system per byggnad, drill-down till medlemmar |
| AI / Gunnar (`geminus-ai`) | Tools `get_assets_by_system`, `get_systems_in_building` |
| Insights / Flödesgrafer | Använder `asset_connections` för rörnät/elnät |

---

## 7. Kända begränsningar

1. **Inga port-koordinater** – `asset_connections` lagrar enbart from/to, inte
   geometriska anslutningspunkter. För visualisering av exakta kopplingspunkter
   krävs en tillägsextraktion av `IfcDistributionPort`.
2. **Disciplin-inferens är heuristisk** – beroende av namnkonventioner.
   Modeller utan tydlig namnstandard hamnar i `Other`. Ska på sikt ersättas av
   regelmotor per kund/template.
3. **PropertyGrouped vs IfcSystem-dubbletter** – om ett objekt ingår i både en
   `IfcSystem` *och* har en avvikande `SystemName`-property hamnar det endast i
   IfcSystem-gruppen (PropertyGrouped tar bara `uncovered` medlemmar). Detta är
   medvetet, men kan dölja avvikande propertysättning – övervaka via
   `systems.source`-fördelning.
4. **Stora IFC-filer** – `ifc-extract-systems` cap:ar IFC-uppladdning till
   ~100 MB i edge runtime; större modeller måste konverteras via
   conversion-worker först och köras i `metadata-only`-läge.

---

## 8. Filer att läsa vid felsökning

- `supabase/functions/ifc-extract-systems/index.ts` – hela IFC-pipen
- `supabase/functions/acc-sync/index.ts` rad ~840–1410 – ACC system-blocket
- `src/components/settings/CreateBuildingPanel.tsx` – orkestrering från UI
- `src/components/viewer/ObjectColorFilterPanel.tsx` – viewer-konsumtion
- Tabeller: `systems`, `asset_system`, `asset_connections`, `asset_external_ids`
