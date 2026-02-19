
# Senslinc Integration – Förbättringsplan

## Nulägesanalys

### Fråga 1: Har vi riktig data i Insights?

**Delvis.** Systemet är korrekt uppbyggt men det finns ett kritiskt gap:

- `useSenslincBuildingData` (används i `SensorsTab`) anropar `get-building-sensor-data` som söker via `/api/sites?code={fmGuid}`. Detta fungerar bara om byggnadens FM GUID matchar Senslincs `code`-fält på en site.
- Om det finns en match (t.ex. Småviken) → vi har live `latest_values` per maskin, men **trendgrafen i SensorsTab är fortfarande mock** – den ignorerar live-data och kör generateMockSensorData.
- `SenslincDashboardView` (IoT+ knappen) anropar `get-machine-data` per rum/entitet och har live-stöd + mock-fallback.

**Slutsats:** IoT-data som finns i Senslinc (Småviken) kan hämtas, men trendgrafen i SensorsTab visar aldrig riktig historisk data. Rutnätet av rum visar live `latest_values` om matchning finns.

### Fråga 2: Fungerar IoT+-knapparna?

IoT+-knappen anropar `onOpenIoT(facility)` i QuickActions. I `FacilityLandingPage` är `onOpenIoT` kopplad till `openSenslincDashboard()` i AppContext, som öppnar `SenslincDashboardView`. Flödet finns – men eftersom `SenslincDashboardView` ligger i en sidopanel och kräver att `senslincDashboardContext` är satt behöver vi verifiera att hanteringen i portfolio-flödet är komplett.

### Fråga 3: Insights-navigering per rum

Idag: Insights → SensorsTab visar bara EN byggnad i ett statiskt rutnät. Det finns inget klickbart rum som öppnar detaljvy.

---

## Vad vi bygger

### Del A – Fixa trendgrafen i SensorsTab med riktig data

**Problem:** `BuildingTrendChart` ignorerar `liveMachineMap` och kör bara mock.

**Fix:** Komplettera trendgrafen för att använda historisk data om det finns maskiner med live-data. Anropa `get-machine-data` för ett representativt urval maskiner (max 5) och aggregera deras tidserier. Visa LIVE-badgen korrekt.

### Del B – Insights-navigering: Byggnadsval → Rumsdrilldown

**Ny flödeslogik i InsightsView + SensorsTab:**

```
Insights (portfolio) 
  → klicka byggnad i Sensors-tab
  → öppnas BuildingInsightsView (befintlig)
    → inom BuildingInsightsView: ny "Sensors"-flik
      → heatmap-grid av rum (klickbart)
        → klicka ett rum 
          → öppnar RoomSensorDetailSheet (NY) 
            = vår egna snygga dashboard (ingen iframe!)
```

### Del C – RoomSensorDetailSheet (ny komponent)

En ny Sheet-komponent som ersätter Senslincs gamla iframe-dashboard. Den visar:
- **4 gauge-kort** (temp, CO₂, fukt, beläggning) – befintlig GaugeCard från SenslincDashboardView
- **7-dagars linjediagram** – befintlig SensorChart
- **Rumsnamn + LIVE/Demo-status**
- **Länk till extern Senslinc-dashboard** (som fallback om man vill se originalet)

### Del D – IoT+-knappen verifieras och förbättras

IoT+-knappen via Portfolio → Building → QuickActions ska öppna vår egna dashboard (RoomSensorDetailSheet/SenslincDashboardView) korrekt. Vi verifierar koppling och fixar om länken saknas.

### Del E – SensorsTab: Byggnadsselektor

Idag tar SensorsTab `navigatorTreeData[0]` (första byggnaden). Lägg till en enkel byggnadsselektor högst upp om det finns flera byggnader, så man kan byta aktivt.

---

## Filer som ändras

| Fil | Vad ändras |
|-----|-----------|
| `src/components/insights/tabs/SensorsTab.tsx` | Byggnadsselektor, klickbara rum-kort, trendgraf med riktig data |
| `src/components/insights/BuildingInsightsView.tsx` | Lägg till Sensors-flik med klickbara rum |
| `src/components/viewer/SenslincDashboardView.tsx` | Exportera GaugeCard + SensorChart för återanvändning |
| `src/components/insights/RoomSensorDetailSheet.tsx` | NY – vår egna snygga rum-dashboard utan iframe |

## Ny komponent: RoomSensorDetailSheet

```
┌──────────────────────────────────────────────────┐
│  ⚡ Konferensrum 3A                    LIVE  [X] │
│  Senslinc IoT · Maskin #142                       │
├──────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────┐ │
│  │ 22.3 °C │  │ 687 ppm │  │  48 %   │  │ 65% │ │
│  │  Temp   │  │   CO₂   │  │  Fukt   │  │ Belägg│
│  └─────────┘  └─────────┘  └─────────┘  └─────┘ │
├──────────────────────────────────────────────────┤
│  Senaste 7 dagarna                                │
│  [Linjediagram - Temp/CO₂/Fukt, toggle-knappar] │
├──────────────────────────────────────────────────┤
│  [↗ Öppna i Senslinc]                            │
└──────────────────────────────────────────────────┘
```

Komponenten återanvänder GaugeCard och SensorChart från SenslincDashboardView och hämtar data via `useSenslincData(roomFmGuid)`.

## Prioritering

1. **RoomSensorDetailSheet** – den centrala förbättringen (vår egna dashboard)
2. **Klickbara rum i SensorsTab** – kopplar rum → RoomSensorDetailSheet
3. **Klickbara rum i BuildingInsightsView** – samma sheet från Sensors-fliken
4. **Fixa trendgrafen** – visa live-data korrekt
5. **Byggnadsselektor i SensorsTab** – bra UX om flera byggnader

## Teknisk not om Småviken

Småviken-byggnaden är det primära testfallet. Om byggnadens `fmGuid` matchar Senslincs site `code` → `get-building-sensor-data` returnerar maskiner med `latest_values`. För rum-nivå: om rummets `fmGuid` matchar en maskins `code` → `get-machine-data` returnerar full tidsserie. Om det inte matchar visas demo-data med lila streckad linje (befintligt beteende).
