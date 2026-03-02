

## Förbättrad Supportportal

### Problem
Ärendelistan saknar tillräcklig detalj (kategori-etikett, ärendenummer, beskrivningsförhandsgranskning) och registreringsformuläret har begränsade fält jämfört med den ursprungliga SWG-portalen.

### Ändringar

**1. SupportCaseList.tsx — Rikare ärendelista**
- Visa kategori-badge med svenska etiketter (Fråga, Fel, Service, Övrigt) bredvid prioritet
- Visa ärendenummer (kortat UUID eller löpnummer) som referens
- Visa beskrivningsförhandsgranskning (max 1 rad, trunkerad)
- Lägg till textsökning (filtrera på titel/beskrivning)
- Visa kontaktinfo-indikator om e-post/telefon finns
- Visa antal kommentarer per ärende

**2. CreateSupportCase.tsx — Utökat registreringsformulär**
- Lägg till "Typ av ärende" (ärendetyp) som nytt fält — mappar till en utökad `category` med fler alternativ:
  - Felanmälan, Servicebeställning, Garantiärende, Besiktning, Fråga/Rådgivning, Övrigt
- Lägg till "Plats/Utrymme" fritext-fält
- Lägg till "Installationsnummer" fritext-fält
- Lägg till "Önskat åtgärdsdatum" datumväljare
- Lägg till byggnadsväljare (dropdown från `building_settings`)

**3. Databasändring — Nya kolumner på `support_cases`**
- `location_description` (text, nullable) — fritext plats
- `installation_number` (text, nullable)
- `desired_date` (timestamptz, nullable) — önskat åtgärdsdatum

**4. SupportCaseDetail.tsx — Visa nya fält**
- Visa plats, installationsnummer och önskat datum i detaljvyn

**5. CustomerPortalView.tsx — Ingen ändring behövs**

### Filer att ändra/skapa

| Fil | Ändring |
|---|---|
| Migration | Lägg till 3 kolumner på `support_cases` |
| `SupportCaseList.tsx` | Textsökning, kategori-badges, ärendenummer, beskrivningspreview |
| `CreateSupportCase.tsx` | Fler ärendetyper, plats, installationsnr, önskat datum, byggnadsväljare |
| `SupportCaseDetail.tsx` | Visa de nya fälten |

