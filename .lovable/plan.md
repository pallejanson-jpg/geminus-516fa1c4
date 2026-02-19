
## Koppla IfcAlarm till Insights FM-vy + Alarmhantering

### Nulägesanalys

Systemet har tre separata delar att koppla ihop:

1. **IfcAlarm i databasen** — Småviken har 17 397 IfcAlarm-objekt med `level_fm_guid`, `in_room_fm_guid`, `fm_guid`. De saknar `name`/`common_name` men har IFC-identitet via `attributes`.

2. **BuildingInsightsView** — Byggnadsnivå-vyn har flikarna Performance, Space, Asset, Sensors men **ingen FM-flik**. Den bör få en "Larm"-flik som visar riktiga IfcAlarm-objekt från databasen.

3. **FacilityManagementTab** — Portfolio-nivåvyn (InsightsView → FM-flik) visar idag enbart mock-arbetsordrar. Denna ska **även visa IfcAlarm** som arbetsordrar i listan och diagrammen.

---

### Del A — Tidigare plan (annotations + minimap): samma som godkänd plan

Dessa tre fixar genomförs som planerat:
- **Fix Småviken hang:** Ta bort batch-uppdatering av `symbol_id` i `loadAlarmAnnotations`
- **Fix annotation-synlighet:** Anropa `updatePositions()` i `showAnnotations`-effekten
- **Fix minimap-skala:** Beräkna AABB från synliga IfcSpace istället för hela scenen

---

### Del B — Ny funktionalitet: IfcAlarm → FM-Insights

#### B1. Ny "Larm"-flik i BuildingInsightsView

Lägg till en femte flik **"Larm"** i `BuildingInsightsView` (bredvid Performance, Space, Asset, Sensors). Denna flik:

- Hämtar IfcAlarm-objekt för byggnaden från `assets`-tabellen (med paginering, max 500 visas)
- Visar tre KPI-kort: Totalt antal larm, Fördelning per våning, Larm per rum (top 5)
- Visar ett stapeldiagram: Antal larm per våningsplan (RIKTIGT från DB)
- Visar en lista med de 50 senaste larmen med kolumnerna: FM-GUID (trunkerat), Våning, Rum, Datum-modifierad
- Varje rad i listan har en **soptunna-knapp** för att radera larmet (DELETE från `assets` — möjligt eftersom `is_local=true` eller admin)
- Visar ett "Live data"-märke (inga mock-data för larm)

```
Larmfliken
┌──────────────────────────────────────────────────┐
│  🔔 Larm  [Live]                                  │
│  KPI: Totalt | Per våning | Per rum (top)         │
│                                                    │
│  Diagram: Larm per våning (stapeldiagram)         │
│                                                    │
│  Lista: FM-GUID | Våning | Rum | Datum | [🗑️]    │
└──────────────────────────────────────────────────┘
```

#### B2. Uppdatera FacilityManagementTab med riktiga IfcAlarm

I portfolio-FM-fliken (`FacilityManagementTab`) ersätts den nuvarande mock-generatorn för arbetsordrar med en **blandmodell**:

- Hämta IfcAlarm-aggregering per byggnad från `assets`-tabellen (GROUP BY building_fm_guid, COUNT)
- Visa antal riktiga larm i "Issues per Building"-diagrammet (RIKTIGT för byggnader med IfcAlarm, annars mock för resten)
- Lägg till en "Alarm"-tagg i KPI-korten som visar totalt antal IfcAlarm i hela portföljen
- KPI-kortet "Active Issues" uppdateras: visar riktigt larmantal om det finns, annars mock

#### B3. Ny AlarmManagementView-komponent

Skapa `src/components/insights/tabs/AlarmManagementTab.tsx` — en dedikerad alarmhanteringsvy som kan öppnas från byggnadens Larm-flik via en "Hantera larm"-knapp:

**Funktioner:**
- Lista ALLA larm för en byggnad (paginerad, 100 åt gången)
- Sök/filtrering på våning (`level_fm_guid` → mappas till våningsnamn)
- Multi-select med checkbox för batch-radering
- "Radera valda larm"-knapp med bekräftelsedialog
- "Radera alla larm för denna byggnad"-knapp (med extra bekräftelse)

**Radering:** Använder `supabase.from('assets').delete().in('fm_guid', selectedIds)` — detta fungerar eftersom IfcAlarm-objekten har `is_local=false` men RLS-policyn "Authenticated users can delete local assets" kräver `is_local=true`. Vi behöver **en edge function** som kör delete med `service_role_key` för att kringgå RLS.

Alternativt: Skapa en ny RLS-policy: `DELETE WHERE asset_type = 'IfcAlarm'` — enklare och mer direkt.

#### B4. IfcAlarm visas i Portfolio-FM mock-datan

I `FacilityManagementTab` (portfolio-vy):
- Hämta alarm-antal per byggnad från DB
- Ersätt mock "Issues per Building" med riktiga larmantal för de byggnader som har IfcAlarm
- Behåll mock för byggnader utan IfcAlarm
- Lägg till ett "Real data"-badge bredvid diagramtiteln när riktiga data används

---

### Filer som ändras

| Fil | Ändring |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Del A: Fix hang + annotation-sync |
| `src/components/viewer/MinimapPanel.tsx` | Del A: Fix AABB-beräkning |
| `src/components/insights/BuildingInsightsView.tsx` | Del B1: Lägg till "Larm"-flik med IfcAlarm-data |
| `src/components/insights/tabs/FacilityManagementTab.tsx` | Del B2 + B4: Blanda in riktiga alarm-KPI:er i portfolio-FM-vyn |
| `src/components/insights/tabs/AlarmManagementTab.tsx` | **NY** Del B3: Dedikerad alarmhanteringsvy med lista + radering |

### Databasändring

Ny RLS-policy på `assets`-tabellen för att tillåta radering av IfcAlarm-objekt (för autentiserade användare):

```sql
CREATE POLICY "Authenticated users can delete alarm assets"
ON public.assets FOR DELETE
USING (auth.uid() IS NOT NULL AND asset_type = 'IfcAlarm');
```

Alternativt: tillåt radering via service-role edge function (ingen schema-ändring).

Rekommendation: **RLS-policy** är enklare och mer transparent — ingen edge function behövs.

### Varför detta är rätt approach

- IfcAlarm-data finns redan i databasen — noll extra API-anrop eller synkning behövs
- Radering via RLS-policy är säkrare än att exponera service-role i frontend
- Portfolio-FM-vyn förbättras med riktiga data för Småviken utan att bryta mock för övriga byggnader
- AlarmManagementTab är en isolerad komponent som kan widareutvecklas (t.ex. exportera till CSV, koppla till arbetsordersystem)
