
# Plan: Omstrukturering av Insights med Flikar

## Översikt

Insights-vyn ska få en ny flikbaserad struktur med fem kategorier av insikter. Den nuvarande energifokuserade vyn blir "Performance"-fliken, och fyra nya flikar läggs till med mockdata som kopplas till de faktiska byggnaderna i systemet.

## Ny Flikstruktur

| Flik | Beskrivning | Innehåll |
|------|-------------|----------|
| **Performance** | Befintlig energivy | Energieffektivitet, kWh/m², CO2-utsläpp, trender |
| **Facility Management** | Fastighetsförvaltning | Underhållsscheman, felanmälningar, serviceavtal |
| **Space Management** | Ytor och beläggning | Rumsanvändning, beläggningsgrad, optimering |
| **Asset Management** | Tillgångar och utrustning | Inventarier, livscykel, värdering |
| **Portfolio Management** | Portföljöversikt | Ägarstruktur, ekonomi, benchmarking |

## Visuell Layout

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Insights                                                           │
│  Analys och insikter för din fastighetsportfölj                    │
├─────────────────────────────────────────────────────────────────────┤
│  [Performance] [Facility Mgmt] [Space Mgmt] [Asset Mgmt] [Portfolio]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                  │
│   │ KPI 1   │ │ KPI 2   │ │ KPI 3   │ │ KPI 4   │    <- KPI-kort   │
│   └─────────┘ └─────────┘ └─────────┘ └─────────┘                  │
│                                                                     │
│   ┌────────────────────┐  ┌────────────────────┐                   │
│   │                    │  │                    │                   │
│   │    Diagram 1       │  │    Diagram 2       │    <- Charts      │
│   │                    │  │                    │                   │
│   └────────────────────┘  └────────────────────┘                   │
│                                                                     │
│   ┌──────────────────────────────────────────────┐                 │
│   │   Byggnadslista/Tabell                       │  <- Data grid   │
│   └──────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Teknisk Implementation

### Steg 1: Skapa komponentstruktur

Skapa nya komponenter för varje flik:

| Fil | Syfte |
|-----|-------|
| `src/components/insights/tabs/PerformanceTab.tsx` | Flytta befintlig energivy hit |
| `src/components/insights/tabs/FacilityManagementTab.tsx` | FM-insikter med mockdata |
| `src/components/insights/tabs/SpaceManagementTab.tsx` | Ythantering med mockdata |
| `src/components/insights/tabs/AssetManagementTab.tsx` | Tillgångsinsikter med mockdata |
| `src/components/insights/tabs/PortfolioManagementTab.tsx` | Portföljanalys med mockdata |

### Steg 2: Uppdatera InsightsView.tsx

Huvudvyn får fliknavigering med Radix Tabs:

```typescript
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// Flikstruktur
<Tabs defaultValue="performance">
  <TabsList className="w-full justify-start overflow-x-auto">
    <TabsTrigger value="performance">Performance</TabsTrigger>
    <TabsTrigger value="facility">Facility Management</TabsTrigger>
    <TabsTrigger value="space">Space Management</TabsTrigger>
    <TabsTrigger value="asset">Asset Management</TabsTrigger>
    <TabsTrigger value="portfolio">Portfolio Management</TabsTrigger>
  </TabsList>
  
  <TabsContent value="performance">
    <PerformanceTab />
  </TabsContent>
  {/* ... övriga flikar */}
</Tabs>
```

### Steg 3: Mockdata per Flik

Varje flik använder faktiska byggnader från `navigatorTreeData` med syntetiska värden:

**Facility Management:**
- Aktiva serviceärenden per byggnad
- Planerade underhållsåtgärder
- SLA-efterlevnad
- Kostnadsfördelning

**Space Management:**
- Beläggningsgrad per rum/våning
- Kvadratmeter per funktionstyp
- Vakansgrad
- Effektivitetsmätningar

**Asset Management:**
- Antal tillgångar per kategori
- Genomsnittsålder
- Återanskaffningsvärde
- Underhållsstatus

**Portfolio Management:**
- Totalt portföljvärde
- Avkastning (ROI mockdata)
- Geografisk fördelning
- Riskprofil

### Steg 4: Responsiv Design

Flikarna blir scrollbara horisontellt på mobil:

```typescript
<TabsList className="w-full flex-nowrap overflow-x-auto justify-start">
```

## Filer att Ändra/Skapa

| Åtgärd | Fil |
|--------|-----|
| Skapa | `src/components/insights/tabs/PerformanceTab.tsx` |
| Skapa | `src/components/insights/tabs/FacilityManagementTab.tsx` |
| Skapa | `src/components/insights/tabs/SpaceManagementTab.tsx` |
| Skapa | `src/components/insights/tabs/AssetManagementTab.tsx` |
| Skapa | `src/components/insights/tabs/PortfolioManagementTab.tsx` |
| Uppdatera | `src/components/insights/InsightsView.tsx` |

## Datakoppling

Alla flikar använder:
- `navigatorTreeData` - för byggnadsstruktur
- `allData` - för utrymmen och tillgångar

Mockdata genereras deterministiskt baserat på `fmGuid` för konsistens mellan sessioner.

## Resultat

Efter implementation:
1. Insights får fem klickbara flikar högst upp
2. Performance-fliken innehåller befintlig energivy
3. Fyra nya flikar visar relevanta insikter med mockdata
4. Alla flikar refererar till faktiska byggnader i systemet
5. Responsiv design fungerar på mobil med horisontell scroll

