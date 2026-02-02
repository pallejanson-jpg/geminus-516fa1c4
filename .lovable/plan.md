
# Plan: BCF-baserad Modellärende­hantering

## Sammanfattning

Implementera ett ärendehanteringssystem baserat på **BCF-standarden** (BIM Collaboration Format) som låter användare rapportera problem och önskemål direkt från 3D-viewern. Systemet fångar automatiskt viewpoints, skärmdumpar och position - precis som när ni sparar vyer idag, men med ett arbetsflöde för rapportering, hantering och återkoppling.

---

## Vad är BCF?

BCF (BIM Collaboration Format) är en öppen standard för att utbyta problem och frågor kopplat till BIM-modeller. Varje "issue" innehåller:

- **Viewpoint**: Kameraposition, synliga objekt, sektionsplan
- **Skärmdump**: Bild av vad användaren såg
- **Markerade objekt**: Vilka BIM-objekt som berörs
- **Metadata**: Titel, beskrivning, status, prioritet

xeokit har inbyggt stöd via `BCFViewpointsPlugin`.

---

## Arkitektur

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BCF Ärendehantering                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ANVÄNDARE (i 3D-viewer)                                                   │
│   ─────────────────────────                                                 │
│   1. Klickar "Skapa ärende" i VisualizationToolbar                          │
│   2. BCF viewpoint + skärmdump fångas automatiskt                           │
│   3. Fyller i formulär: Titel, Beskrivning, Typ, Prioritet                  │
│   4. Skickar ärendet                                                        │
│                    │                                                        │
│                    ▼                                                        │
│   ┌────────────────────────────────────────────────┐                        │
│   │              bcf_issues (databas)              │                        │
│   │  • Viewpoint (JSON med kamera, synliga objekt) │                        │
│   │  • Skärmdump (Storage URL)                     │                        │
│   │  • Status: open → in_progress → resolved       │                        │
│   │  • Kommentarer (bcf_comments)                  │                        │
│   └────────────────────────────────────────────────┘                        │
│                    │                                                        │
│                    ▼                                                        │
│   ADMIN/UTVECKLARE                                                          │
│   ─────────────────                                                         │
│   1. Ser lista över inkomna ärenden i admin-vy                              │
│   2. Klickar på ärende → 3D-viewer öppnas med exakt samma vy                │
│   3. Utför åtgärd, skriver kommentar                                        │
│   4. Sätter status till "Utförd"                                            │
│                    │                                                        │
│                    ▼                                                        │
│   NOTIFIKATION                                                              │
│   ─────────────────                                                         │
│   • Användaren ser att ärendet är löst (i app-notis eller e-post)           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Del 1: Databasstruktur

### Ny tabell: `bcf_issues`

Följer BCF-standarden men anpassad för era behov:

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | UUID | Primärnyckel |
| title | TEXT | Rubrik (obligatorisk) |
| description | TEXT | Detaljerad beskrivning |
| issue_type | TEXT | `fault`, `improvement`, `question`, `observation` |
| priority | TEXT | `low`, `medium`, `high`, `critical` |
| status | TEXT | `open`, `in_progress`, `resolved`, `closed` |
| viewpoint_json | JSONB | BCF-viewpoint (kamera, synliga objekt, sektioner) |
| screenshot_url | TEXT | URL till skärmdump i Storage |
| building_fm_guid | TEXT | Koppling till byggnad |
| building_name | TEXT | Byggnadsnamn för visning |
| selected_object_ids | TEXT[] | Markerade objekt i scenen |
| reported_by | UUID | Användare som skapade ärendet |
| assigned_to | UUID | Ansvarig för ärendet |
| created_at | TIMESTAMPTZ | Skapad tidpunkt |
| updated_at | TIMESTAMPTZ | Senast uppdaterad |
| resolved_at | TIMESTAMPTZ | När ärendet löstes |
| resolved_by | UUID | Vem som löste ärendet |

### Ny tabell: `bcf_comments`

Kommentarer/konversation på ett ärende:

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | UUID | Primärnyckel |
| issue_id | UUID | FK till bcf_issues |
| user_id | UUID | Vem som skrev |
| comment | TEXT | Kommentarstext |
| viewpoint_json | JSONB | Valfri: ny viewpoint kopplad till kommentar |
| screenshot_url | TEXT | Valfri: ny skärmdump |
| created_at | TIMESTAMPTZ | Skapad tidpunkt |

### RLS-policies

- Alla autentiserade användare kan läsa ärenden
- Alla autentiserade användare kan skapa ärenden
- Admins kan uppdatera alla ärenden
- Användare kan uppdatera egna ärenden (men inte status till resolved)
- Admins kan ta bort ärenden

---

## Del 2: BCF Viewpoints med xeokit

### Ny hook: `useBcfViewpoints.ts`

xeokit har inbyggt `BCFViewpointsPlugin` som vi kan använda:

```typescript
// Fånga viewpoint (kamera, synliga objekt, sektionsplan)
const getViewpoint = () => {
  const bcfPlugin = new BCFViewpointsPlugin(viewer);
  return bcfPlugin.getViewpoint({
    snapshot: false, // Vi tar skärmdump separat
    defaultInvisible: false,
    reverseClippingPlanes: false,
  });
};

// Återställ viewpoint (när admin öppnar ett ärende)
const setViewpoint = (viewpointJson: any) => {
  const bcfPlugin = new BCFViewpointsPlugin(viewer);
  bcfPlugin.setViewpoint(viewpointJson, {
    duration: 1.0, // Animerad övergång
  });
};
```

Viewpoint-objektet innehåller:
- Camera position (eye, look, up)
- Field of view
- Visible components (IFC GUIDs)
- Hidden components
- Selected components
- Section planes

---

## Del 3: UI-komponenter

### 3.1 Knapp i VisualizationToolbar

Ny knapp "Skapa ärende" (MessageSquarePlus-ikon) i verktygsfältet:

```text
┌──────────────────────────────┐
│  Visning                     │
│  ────────────────────────    │
│  📷 Spara vy                 │
│  📩 Skapa ärende  ← NY       │
│  ...                         │
└──────────────────────────────┘
```

### 3.2 CreateIssueDialog

Dialogruta för att skapa ett ärende:

```text
┌─────────────────────────────────────────┐
│  📩 Skapa ärende                    [X] │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [Skärmdump av vyn]              │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Byggnad: Karolinska Sjukhuset          │
│                                         │
│  Typ *                                  │
│  ┌─────────────────────────────────┐    │
│  │ Fel/Problem              ▼      │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Prioritet                              │
│  ○ Låg  ● Medel  ○ Hög  ○ Kritisk      │
│                                         │
│  Rubrik *                               │
│  ┌─────────────────────────────────┐    │
│  │ Ventilationsdon saknas plan 3   │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Beskrivning                            │
│  ┌─────────────────────────────────┐    │
│  │ Jag ser att det saknas...       │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│           [Avbryt]    [Skicka ärende]   │
└─────────────────────────────────────────┘
```

### 3.3 IssueListPanel (i sidopanelen)

Lista över ärenden kopplat till aktuell byggnad:

```text
┌─────────────────────────────────────────┐
│  Ärenden (3)                       [+]  │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ 🔴 Ventilationsdon saknas          ││
│  │    Hög prioritet • 2 timmar sedan  ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ 🟡 Uppdatera rumsindelning         ││
│  │    Medel • Igår                    ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ ✅ Dörrplacering justerad          ││
│  │    Löst • 3 dagar sedan            ││
│  └─────────────────────────────────────┘│
│                                         │
└─────────────────────────────────────────┘
```

### 3.4 IssueDetailSheet

Detaljvy för ett ärende med möjlighet att:
- Se skärmdump och klicka för att öppna viewpoint i 3D
- Läsa/skriva kommentarer
- Ändra status (endast admin)
- Se historik

---

## Del 4: Admin-vy för ärendehantering

### Ny route: `/issues`

En dedikerad sida för att hantera alla ärenden:

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Ärendehantering                                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Filter:  [Alla byggnader ▼]  [Alla typer ▼]  [Öppna ▼]  🔍        │
│                                                                     │
│  ┌─────┬───────────────────────┬────────────┬────────┬───────────┐  │
│  │  #  │ Rubrik                │ Byggnad    │ Status │ Skapad    │  │
│  ├─────┼───────────────────────┼────────────┼────────┼───────────┤  │
│  │ 001 │ Ventilationsdon sakn. │ Karolinska │ 🔴 Ny  │ 2h sedan  │  │
│  │ 002 │ Rumsindelning         │ Södersjukh.│ 🟡 Pgn │ Igår      │  │
│  │ 003 │ Dörrplacering         │ Karolinska │ ✅ Löst│ 3d sedan  │  │
│  └─────┴───────────────────────┴────────────┴────────┴───────────┘  │
│                                                                     │
│  [Klicka på rad för att öppna ärende i 3D-vy]                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Del 5: Notifikationssystem

### Enkel första version

1. **Realtime-uppdateringar** via Supabase Realtime
2. **In-app notifikation** när ett ärende uppdateras
3. **E-postnotis** (fas 2) via Edge Function + Resend/SendGrid

### Notifikationsflöde

```text
Ärende skapas → Admin får notis
Admin svarar → Användare får notis
Status ändras → Användare får notis
```

---

## Filer som skapas/ändras

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `supabase/migrations/xxx_bcf_issues.sql` | NY | Databasschema för BCF-ärenden |
| `src/hooks/useBcfViewpoints.ts` | NY | Hook för BCF viewpoint-hantering |
| `src/components/viewer/CreateIssueDialog.tsx` | NY | Dialog för att skapa ärende |
| `src/components/viewer/IssueListPanel.tsx` | NY | Panel som visar ärenden i viewer |
| `src/components/viewer/IssueDetailSheet.tsx` | NY | Detaljvy för enskilt ärende |
| `src/pages/Issues.tsx` | NY | Admin-sida för ärendehantering |
| `src/components/viewer/VisualizationToolbar.tsx` | ÄNDRA | Lägg till knapp för ärenderapportering |
| `src/components/layout/AppLayout.tsx` | ÄNDRA | Lägg till route för Issues |

---

## Fasindelning

### Fas 1: Grundfunktionalitet (denna plan)
- Databasstruktur
- Skapa ärende från 3D-viewer
- Lista ärenden i viewer
- Öppna ärende → ladda viewpoint

### Fas 2: Admin-flöde
- Admin-sida med filtrering
- Statushantering
- Kommentarsfunktion

### Fas 3: Notifikationer
- In-app notiser
- E-postnotiser
- Realtime-uppdateringar

### Fas 4: BCF-export (valfritt)
- Exportera ärenden som .bcfzip
- Kompatibilitet med andra BCF-verktyg (Solibri, BIMcollab, etc.)

---

## Tekniska detaljer

### BCF Viewpoint JSON-struktur

```json
{
  "perspective_camera": {
    "camera_view_point": { "x": 10.5, "y": 20.3, "z": 15.2 },
    "camera_direction": { "x": -0.5, "y": -0.3, "z": -0.8 },
    "camera_up_vector": { "x": 0, "y": 0, "z": 1 },
    "field_of_view": 60
  },
  "components": {
    "visibility": {
      "default_visibility": true,
      "exceptions": [
        { "ifc_guid": "ABC123...", "visible": false }
      ]
    },
    "selection": [
      { "ifc_guid": "XYZ789..." }
    ]
  },
  "clipping_planes": [
    {
      "location": { "x": 0, "y": 0, "z": 5 },
      "direction": { "x": 0, "y": 0, "z": 1 }
    }
  ]
}
```

### Återanvändning av befintlig kod

Mycket av logiken för att fånga viewstate finns redan i `VisualizationToolbar.tsx` (rad 240-299). Vi kan återanvända:
- Screenshot-logik
- Camera state capture
- Visible models/floors tracking

Skillnaden är att vi lägger till BCF-plugin för standardiserat format och markerade objekt.

---

## Testning efter implementation

1. **Skapa ärende**: Från 3D-viewern, skapa ett ärende och verifiera att viewpoint + skärmdump sparas
2. **Öppna ärende**: Klicka på ett ärende i listan och verifiera att 3D-vyn återställs exakt
3. **Statusflöde**: Testa statusändringar (open → in_progress → resolved)
4. **RLS**: Verifiera att vanliga användare inte kan ändra status till resolved
5. **Mobil**: Testa formuläret på mobil
