
# Granskning: Responsivitet, Lokalisering & Synkronisering

## Sammanfattning av Identifierade Problem

### 1. Responsivitetsproblem

#### UniversalPropertiesDialog (Egenskapsdialogrutan)
**Problem:** På mobil visas dialogen med fixed positioning som kan hamna utanför skärmen
- **Rad 398-412:** Dialogens position (`left: position.x, top: position.y`) är baserad på desktop-drag och tar inte hänsyn till mobilskärmar
- **Rad 400-405:** `max-w-[400px] max-h-[85vh]` är bra för mobil, men dragging/resizing bör inaktiveras helt på mobil

**Åtgärd:** Använd en fullskärmsvy eller bottom sheet på mobil istället för draggable dialog

#### Insights Charts - Etiketter klipps
**Problem:** Pie chart-etiketter (`label={...}`) renderas inline och kan överlappa eller klippas på små skärmar
- **Fil:** `BuildingInsightsView.tsx` rad 242-243, `PerformanceTab.tsx` rad 297-298
- **Exempelkod:** `label={({ name, percent }) => \`${name} ${(percent * 100).toFixed(0)}%\`}` 

**Åtgärd:** På mobil (< 640px), använd `labelLine={true}` med kortare etiketter eller göm interna etiketter helt och förlita dig på Legend

#### Y-Axis i BarCharts trunkeras
**Problem:** `YAxis width={100}` är fast, men byggnamn kan vara längre
- **Fil:** `PerformanceTab.tsx` rad 244-250, `FacilityManagementTab.tsx` rad 322-326

**Åtgärd:** Dynamisk trunkering av namn i data eller responsiv bredd baserat på containerns storlek

---

### 2. Lokalisering - Svenska → Engelska

#### UniversalPropertiesDialog
| Rad | Nuvarande (Svenska) | Ändra till (Engelska) |
|-----|---------------------|----------------------|
| 42-48 | `SECTION_LABELS` objekt | Översätt alla labels |
| 42 | `'system': 'System'` | Behåll |
| 43 | `'local': 'Lokala inställningar'` | `'local': 'Local Settings'` |
| 44 | `'coordinates': 'Position'` | `'coordinates': 'Position'` (OK) |
| 45 | `'area': 'Area & Mått'` | `'area': 'Area & Dimensions'` |
| 46 | `'user-defined': 'Användardefinierade'` | `'user-defined': 'User-Defined'` |
| 120 | `'Kunde inte hämta data'` | `'Could not fetch data'` |
| 196 | `label: 'Kategori'` | `label: 'Category'` |
| 198-227 | Alla property labels | Översätt |
| 339 | `'Egenskaper sparade'` | `'Properties saved'` |
| 343-344 | Felmeddelanden | Översätt |
| 377-379 | `'Ja' : 'Nej'` | `'Yes' : 'No'` |
| 444 | `placeholder="Sök egenskaper..."` | `placeholder="Search properties..."` |
| 461-466 | `'Ingen data hittad'`, etc. | Översätt |
| 524-534 | Knappar: `'Avbryt'`, `'Spara'`, `'Redigera'` | `'Cancel'`, `'Save'`, `'Edit'` |

#### InsightsView.tsx
| Rad | Nuvarande | Ändra till |
|-----|-----------|-----------|
| 34-35 | `'Analys och insikter för din fastighetsportfölj'` | `'Analytics and insights for your property portfolio'` |

#### PerformanceTab.tsx
| Rad | Nuvarande | Ändra till |
|-----|-----------|-----------|
| 114 | `'Antal byggnader'` | `'Building Count'` |
| 123 | `'Snitt energi (kWh/m²)'` | `'Avg. Energy (kWh/m²)'` |
| 132 | `'CO₂-utsläpp (ton)'` | `'CO₂ Emissions (tons)'` |
| 140 | `'Snitt energiklass'` | `'Avg. Energy Rating'` |
| 143 | `'Förbättrad'` | `'Improved'` |
| 187 | `'Byggnader'` | `'Buildings'` |
| 189 | `'Klicka på en byggnad för detaljerade insikter'` | `'Click a building for detailed insights'` |
| 234 | `'Energiförbrukning per byggnad'` | `'Energy Consumption per Building'` |
| 236 | `'kWh per m² (lägre är bättre)'` | `'kWh per m² (lower is better)'` |
| 281 | `'Energifördelning per kategori'` | `'Energy Distribution by Category'` |
| 283 | `'Nedbrytning av energianvändning'` | `'Breakdown of energy usage'` |
| 325 | `'Månatlig energitrend'` | `'Monthly Energy Trend'` |
| 327 | `'Faktisk vs målförbrukning (MWh)'` | `'Actual vs Target consumption (MWh)'` |
| 353-363 | Legend names `'Faktisk'`, `'Mål'` | `'Actual'`, `'Target'` |

#### FacilityManagementTab.tsx
| Rad | Nuvarande | Ändra till |
|-----|-----------|-----------|
| 48-55 | Work order categories på svenska | `['HVAC', 'Electrical', 'Elevator', 'Doors/Locks', 'Ventilation', 'Cleaning', 'Other']` |
| 53-56 | Titles på svenska | Översätt till engelska |
| 79 | `'Okänd byggnad'` | `'Unknown building'` |
| 92-98 | `statusConfig` med svenska etiketter | Översätt alla till engelska |
| 100-105 | `priorityConfig` med svenska | `'Low'`, `'Medium'`, `'High'`, `'Critical'` |
| 129-134 | Chart data names | Översätt |
| 209-236 | KPI-kort titlar | Översätt |
| 266-268 | `'Arbetsorderstatus'`, etc. | `'Work Order Status'`, `'Distribution by status - click for details'` |

#### SpaceManagementTab.tsx
| Rad | Nuvarande | Ändra till |
|-----|-----------|-----------|
| 39 | `'Okänd'` | `'Unknown'` |
| 102-125 | KPI-kort titlar | Översätt |
| 150-154 | Chart titles | Översätt |
| 173-174 | Tooltip formatter | Översätt |
| 191-195 | `'Rumstyper'`, etc. | `'Room Types'`, `'Distribution by category'` |
| 239-242 | `'Yteffektivitet per byggnad'` | `'Space Efficiency per Building'` |
| 251 | `'rum'` | `'rooms'` |

#### AssetManagementTab.tsx
| Rad | Nuvarande | Ändra till |
|-----|-----------|-----------|
| 34 | `'Okänd'` | `'Unknown'` |
| 69-73 | Category distribution names | Översätt |
| 82-85 | Maintenance status | `'OK'`, `'Planned'`, `'Critical'` |
| 88-112 | KPI-kort | Översätt |
| 117-125 | Status badge labels | Översätt |
| 151-154 | Chart titles | Översätt |
| 193-196 | `'Tillgångar per byggnad'` | `'Assets per Building'` |
| 234-237 | Table header | Översätt |
| 245-248 | Table headers: `'Byggnad'`, `'Antal'`, etc. | Översätt |
| 257 | `' år'` | `' years'` |

#### PortfolioManagementTab.tsx
| Rad | Nuvarande | Ändra till |
|-----|-----------|-----------|
| 40 | `'Byggnad'` | `'Building'` |
| 45 | Risk levels `'Hög'`, `'Medel'`, `'Låg'` | `'High'`, `'Medium'`, `'Low'` |
| 66-68 | Risk chart names | Översätt |
| 97-121 | KPI-kort | Översätt |
| 124-134 | Risk badge labels | Översätt |
| 159-163 | Chart titles | Översätt |
| 200-204 | `'Riskprofil'` | `'Risk Profile'` |
| 243-247 | `'Portföljvärdering över tid'` | `'Portfolio Valuation Over Time'` |
| 286-290 | `'Fastighetsportfölj'` | `'Property Portfolio'` |
| 296-303 | Table headers | Översätt |

#### MobileViewerOverlay.tsx
| Rad | Nuvarande | Ändra till |
|-----|-----------|-----------|
| 82 | `'våningar'` | `'floors'` |
| 112 | `'Modellträd'` | `'Model Tree'` |
| 149 | `'Rum'` | `'Spaces'` |
| 162 | `'Våningar'` | `'Floors'` |
| 176 | `'Återställ'` | `'Reset'` |
| 185 | `'Välj våningar'` | `'Select Floors'` |
| 191-198 | `'Visa alla'`, `'Dölj alla'` | `'Show All'`, `'Hide All'` |
| 229-230 | `'Inga våningar hittades'` | `'No floors found'` |

---

### 3. Synkroniseringsstatus

#### Asset+ Sync Status
**Aktuell status:**
- `structure`: ✅ Completed - 4,034 objekt (Buildings: 14, Storeys: 87, Spaces: 3,933)
- `assets`: ⚠️ Running - 278 synkade hittills (41,355 Instance i databasen totalt)
- `xkt`: ⚠️ Completed men 0 modeller nedladdade

**Analys:**
- Struktursynk fungerar korrekt
- Asset-synken verkar ha fastnat i "running" status (subtree_name visar "Alla Tillgångar (4/14)")
- XKT-synk rapporterar completed men har inte laddat ner några modeller

**Problem identifierat:** XKT-tabellen (`xkt_models`) är tom trots att synk visar "completed"

---

## Teknisk Implementeringsplan

### Steg 1: Responsivitet för UniversalPropertiesDialog
**Fil:** `src/components/common/UniversalPropertiesDialog.tsx`

- Lägg till mobil-detektion med `useIsMobile()` hook
- På mobil: Använd full-width bottom sheet istället för draggable dialog
- Inaktivera resize och drag på touch-enheter
- Förbättra scroll-beteende för properties-listan

### Steg 2: Chart Responsivitet i Insights
**Filer:** Alla tabs i `src/components/insights/tabs/`

- Minska pie chart-etiketter på mobil eller visa endast i Legend
- Dynamisk trunkering av byggnad-/objektnamn i Y-axis (max 12-15 tecken)
- Använd responsive font sizes (`text-[10px] sm:text-xs`)

### Steg 3: Lokalisering till Engelska
**Filer:** 8 filer behöver uppdateras

1. `UniversalPropertiesDialog.tsx` - ~25 strängar
2. `InsightsView.tsx` - 2 strängar  
3. `PerformanceTab.tsx` - ~20 strängar
4. `FacilityManagementTab.tsx` - ~40 strängar
5. `SpaceManagementTab.tsx` - ~15 strängar
6. `AssetManagementTab.tsx` - ~20 strängar
7. `PortfolioManagementTab.tsx` - ~25 strängar
8. `MobileViewerOverlay.tsx` - ~10 strängar

### Steg 4: XKT-synkronisering Diagnostik
**Status:** Kräver utredning

XKT-synk-logiken finns i `asset-plus-sync/index.ts` men rapporterar completed med 0 modeller. Möjliga orsaker:
1. Inga 3D-modeller konfigurerade i Asset+ för dessa byggnader
2. URL-endpoints för GetModels returnerar tomma resultat
3. Bucket-skrivning misslyckas tyst

---

## Sammanfattning

| Kategori | Antal problem | Prioritet |
|----------|---------------|-----------|
| Responsivitet | 3 komponenter | Hög |
| Lokalisering | ~160 strängar i 8 filer | Hög |
| Asset+ sync | Fungerar men behöver övervakning | Medium |
| XKT sync | Slutförd men 0 resultat - behöver diagnostik | Medium |
