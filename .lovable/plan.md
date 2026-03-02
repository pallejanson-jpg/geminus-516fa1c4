

## SWG Kundportal — Implementationsplan

### Sammanfattning
Bygga en ny "Support" funktion i Geminus som ersätter SWGs gamla Angular/Bootstrap-kundportal med modern Geminus UI. Två huvudfunktioner: **Ärendehantering** och **Kontakt/kommunikation**. BCF-issues från 3D-viewern kan skickas vidare som supportärenden.

### Databasändringar

**Tabell: `support_cases`**

| Kolumn | Typ | Default |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| title | text NOT NULL | — |
| description | text | — |
| status | text NOT NULL | 'new' |
| priority | text NOT NULL | 'medium' |
| category | text NOT NULL | 'question' |
| building_fm_guid | text | — |
| building_name | text | — |
| reported_by | uuid NOT NULL | — |
| bcf_issue_id | uuid | — |
| screenshot_url | text | — |
| contact_email | text | — |
| contact_phone | text | — |
| external_reference | text | — |
| created_at | timestamptz | now() |
| updated_at | timestamptz | now() |
| resolved_at | timestamptz | — |

**Tabell: `support_case_comments`**

| Kolumn | Typ | Default |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| case_id | uuid FK → support_cases | — |
| user_id | uuid NOT NULL | — |
| comment | text NOT NULL | — |
| created_at | timestamptz | now() |

**RLS**: Användare kan läsa/skapa egna ärenden. Admins kan läsa/uppdatera alla. Realtime aktiveras på `support_cases`.

### Nya filer

| Fil | Beskrivning |
|---|---|
| `src/components/support/CustomerPortalView.tsx` | Huvudvy med Tabs: Ärenden + Kontakt |
| `src/components/support/SupportCaseList.tsx` | Lista med statusfilter (Nytt/Pågående/Löst/Stängt), kort per ärende |
| `src/components/support/SupportCaseDetail.tsx` | Sheet med ärendedetaljer, kommentarer, länkad BCF-issue |
| `src/components/support/CreateSupportCase.tsx` | Formulär: titel, beskrivning, prioritet, kategori, byggnad, kontaktinfo |

### Ändringar i befintliga filer

| Fil | Ändring |
|---|---|
| `src/lib/sidebar-config.ts` | Lägg till `support` med `LifeBuoy`-ikon, `text-orange-500` |
| `src/lib/constants.ts` | Lägg till `support` i `DEFAULT_SIDEBAR_ORDER` efter `fault_report` |
| `src/components/layout/MainContent.tsx` | Lägg till `case 'support'` → lazy-ladda `CustomerPortalView` |
| `src/components/viewer/IssueDetailSheet.tsx` | Lägg till "Skicka till Support"-knapp som skapar `support_cases`-rad kopplad till BCF-issue |

### Flöde

```text
IssueDetailSheet                    CustomerPortalView
┌──────────────────┐               ┌──────────────────────┐
│ "Skicka till     │──skapar──→    │  Ärenden  │ Kontakt  │
│  Support" knapp  │  support_case │  ┌────────────────┐  │
└──────────────────┘  med          │  │ Ärendelista    │  │
                      bcf_issue_id │  │  → Detalj Sheet │  │
                                   │  └────────────────┘  │
                                   └──────────────────────┘
```

### Teknisk approach
- Samma mönster som `InAppFaultReport` + `IssueDetailSheet`
- Tabs-komponent med statusfilter-badges
- Detail sheet med kommentarstidslinje och statushantering
- "Skicka till Support" i IssueDetailSheet kopierar titel, beskrivning, screenshot, building-info
- Realtime-subscription på `support_cases` för live-uppdateringar
- Mobilanpassad med glassmorphism-cards

