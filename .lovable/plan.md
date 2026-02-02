
# Plan: BCF-baserad Modellärende­hantering

## ✅ Implementationsstatus

### Fas 1: Grundfunktionalitet - KLAR ✅

**Databas:**
- [x] `bcf_issues` tabell med BCF-viewpoint, skärmdump, status, prioritet
- [x] `bcf_comments` tabell för konversationer
- [x] `issue-screenshots` storage bucket
- [x] RLS-policies för säker åtkomst
- [x] Realtime aktiverat för live-uppdateringar

**Frontend-komponenter:**
- [x] `useBcfViewpoints.ts` - Hook för att fånga/återställa BCF viewpoints
- [x] `CreateIssueDialog.tsx` - Dialog för att skapa ärenden
- [x] `IssueListPanel.tsx` - Panel som visar ärenden per byggnad
- [x] `IssueDetailSheet.tsx` - Detaljvy med kommentarer
- [x] Integrerat i `VisualizationToolbar.tsx`

**Funktioner:**
- [x] Skapa ärende direkt från 3D-viewern
- [x] Automatisk skärmdump + BCF viewpoint-fångst
- [x] Visa lista över ärenden i sidopanel
- [x] Klicka på ärende → navigera till exakt samma vy
- [x] Kommentarsfunktion
- [x] Admin kan ändra status (open → in_progress → resolved)
- [x] Realtime-uppdateringar via Supabase

---

### Fas 2: Admin-flöde (PLANERAD)

| Uppgift | Status |
|---------|--------|
| Admin-sida `/issues` med tabell | ⏳ |
| Filtrering per byggnad/status/typ | ⏳ |
| Tilldelning till användare | ⏳ |
| Batch-operationer | ⏳ |

### Fas 3: Notifikationer (PLANERAD)

| Uppgift | Status |
|---------|--------|
| In-app notis-badge | ⏳ |
| E-postnotis vid statusändring | ⏳ |
| Push-notiser (mobil) | ⏳ |

### Fas 4: BCF-export (VALFRITT)

| Uppgift | Status |
|---------|--------|
| Exportera som .bcfzip | ⏳ |
| Importera BCF-filer | ⏳ |
| BIMcollab-kompatibilitet | ⏳ |

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
│   1. Ser lista över inkomna ärenden                                         │
│   2. Klickar på ärende → 3D-viewer navigerar till exakt samma vy            │
│   3. Utför åtgärd, skriver kommentar                                        │
│   4. Sätter status till "Utförd"                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Filer skapade

| Fil | Beskrivning |
|-----|-------------|
| `src/hooks/useBcfViewpoints.ts` | Hook för BCF viewpoint-hantering |
| `src/components/viewer/CreateIssueDialog.tsx` | Dialog för att skapa ärende |
| `src/components/viewer/IssueListPanel.tsx` | Panel som visar ärenden |
| `src/components/viewer/IssueDetailSheet.tsx` | Detaljvy för enskilt ärende |
| `src/components/viewer/VisualizationToolbar.tsx` | Uppdaterad med ärende-knappar |

---

## BCF Viewpoint JSON-struktur

```json
{
  "perspective_camera": {
    "camera_view_point": { "x": 10.5, "y": 20.3, "z": 15.2 },
    "camera_direction": { "x": -0.5, "y": -0.3, "z": -0.8 },
    "camera_up_vector": { "x": 0, "y": 0, "z": 1 },
    "field_of_view": 60
  },
  "components": {
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

---

## Testning

1. **Skapa ärende**: Från 3D-viewern, klicka "Skapa ärende" och verifiera att viewpoint + skärmdump sparas
2. **Öppna ärende**: Klicka på ett ärende i listan och verifiera att 3D-vyn återställs exakt
3. **Kommentarer**: Skriv en kommentar och verifiera att den visas
4. **Statusändring**: Som admin, ändra status och verifiera att det sparas
5. **Realtime**: Öppna i två fönster och verifiera att ändringar synkas
