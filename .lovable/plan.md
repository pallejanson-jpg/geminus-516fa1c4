

## Geminus UI/UX Deep Audit -- Analys och Atgardsforslag

### 1. Typografisk Inkonsistens

Kodbasen anvander 14+ olika fontstorlekar utan ett enhetligt system. Samma typ av element (t.ex. en rubrik i ett Card) har olika storlekar pa olika skarmar.

**Problemomraden:**
- `text-[9px]`, `text-[10px]`, `text-[11px]` anvands flitigt (1039 forekomster i 59 filer) -- dessa arbitrara storlekar skapar visuellt brus
- KpiCard: titel = `text-[10px] sm:text-xs`, varde = `text-lg sm:text-2xl`
- FacilityCard: titel i bild = `text-base sm:text-lg`, stats-varden = `text-xs sm:text-sm`
- HomeLanding favoritkort: titel = `text-xs sm:text-sm`, stats = `text-[10px] sm:text-xs`
- QuickActions knappar = `text-[10px] sm:text-xs` med ikoner pa 12px
- Header = `h-14 sm:h-16`, Sidebar = `h-14 sm:h-16` (bra, men knappar inne i dem varierar: `h-8`, `h-9`, `h-10`)

**Forslag: Definiera ett Type Scale System**

```
Label/Caption:  text-[11px] sm:text-xs    (ersatter text-[9px], text-[10px], text-[11px])
Body Small:     text-xs sm:text-sm
Body:           text-sm sm:text-base
Heading 4:      text-sm sm:text-base font-semibold
Heading 3:      text-base sm:text-lg font-semibold
Heading 2:      text-lg sm:text-xl font-bold
Heading 1:      text-xl sm:text-2xl font-bold
Display:        text-2xl sm:text-3xl md:text-4xl font-bold
```

Migrera alla skarmvyer till dessa 8 steg. Inga fler arbitrara `text-[Xpx]`.

---

### 2. Card- och Komponentstorlekar -- Inkonsistens

Kortstorlekarna varierar onodigtvis mellan skarmar:

| Skarm | Hero-hojd | Padding | Stats |
|---|---|---|---|
| HomeLanding fav-kort | `h-20 sm:h-24` | `p-2 sm:p-3` | 3 varden i rad |
| FacilityCard (Portfolio) | `h-32 sm:h-40` | `p-3 sm:p-4` | 3 varden i grid |
| FacilityLandingPage hero | Full-bleed | `p-3 sm:p-4 md:p-6` | KpiCards |
| Storey Carousel kort | `h-24 sm:h-32` | implicit | Ingen stats |

**Forslag:**
- Definiera 2 korttyper: `CompactCard` (hem/favoriter) och `StandardCard` (portfolio/rum)
- `CompactCard`: hero `h-24 sm:h-28`, padding `p-2.5 sm:p-3`, border-radius `rounded-lg`
- `StandardCard`: hero `h-36 sm:h-44`, padding `p-3 sm:p-4`, border-radius `rounded-xl`
- Alla kort anvander samma gradient overlay: `bg-gradient-to-t from-black/60 to-transparent`

---

### 3. Duplicerad Kod

**`extractNtaFromAttributes`** ar identisk i 2 filer:
- `src/components/home/HomeLanding.tsx` (rad 59-70)
- `src/components/portfolio/PortfolioView.tsx` (rad 57-68)

**Forslag:** Flytta till `src/lib/utils.ts` eller ny `src/lib/building-utils.ts`.

**Andra dupliceringar:**
- Byggnadsdata-berakning (spaces, storeys, area) upprepas i HomeLanding och PortfolioView
- `SIDEBAR_ITEM_META` definieras bade i `LeftSidebar.tsx` och `MobileNav.tsx`

**Forslag:** Skapa `src/lib/sidebar-config.ts` for delat SIDEBAR_ITEM_META.

---

### 4. Spacing och Layout-System

Padding varierar inkonsekvent:

| Komponent | Padding |
|---|---|
| HomeLanding | `px-3 sm:px-4 md:px-6 py-4 sm:py-6` |
| PortfolioView | `p-3 sm:p-4 md:p-6` |
| InsightsView | `p-2 sm:p-3 md:p-4 lg:p-6` |
| FacilityLandingPage | `p-3 sm:p-4 md:p-6 lg:p-8` |

**Forslag:** Standardisera pa `px-3 sm:px-4 md:px-6` for alla sidvyer.

---

### 5. Konkurrentanalys

#### Autodesk Tandem
- **Ren vertikal navigation**: Minimal sidopanel med ikoner, expanderar vid hover
- **Property Panel**: Fast hogerpanel med systematisk datavisning, ren hierarki
- **3D-fokus**: Viewern tar 80%+ av skarmytan, minimal UI overlag
- **Morklagt**: Mork bakgrund som default, skarpa kontraster pa aktiva element
- **Insights**: "Tandem Insights" anvander dedikerade dashboards, inte overlagrade pa 3D
- **Hierarkiskt**: Tydlig trad med klickbara noder, varje niva har konsistent presentation

#### Twinmotion (Epic Games)
- **Toolbar-design**: Horisontell toolbar langst ner med stora ikoner och tydliga grupperingar
- **Material-forhandsvisning**: Stora thumbnails for visuella val
- **Fullskarms-fokus**: Noll chrome runt viewern, allt ar overlay
- **Quick-access radial menu**: Hogerklick ger radialmeny for snabbval
- **Sidebar tabs**: Vanstersida med tydliga ikoner for Scene/Library/Settings

#### Vad Geminus kan lara sig:
1. **Reducera UI-lager**: QuickActions har 15+ knappar i ett grid -- bryt ut de mest anvanda (3D, 360, Insights) som primare CTA:er
2. **Property Panel**: Inspireras av Tandems systematiska hogerpanel istallet for dialogrutor
3. **Toolbar**: ViewerToolbar ar bra, men VisualizationToolbar ar for komplex -- forenkla till 2 nivaer (primart/sekondart)
4. **Fullskarm som default pa mobil**: Geminus gor detta ratt med immersive views

---

### 6. Prestandaoptimering

**Identifierade problem:**
- `allData.filter()` anropas upprepade ganger i PortfolioView (rad 79, 84, 288, 300) utan memoization for samma berakning
- `extractNtaFromAttributes` itererar alla attributnycklar vid varje anrop -- kan cache:as
- HomeLanding beraknar `favoriteBuildings` med `allData.filter()` inuti `useMemo` men `allData` ar ett stort objekt som omproceseras varje gang navigatorTreeData andras
- `FloatingFloorSwitcher`: 658 rader for en floorpicker -- komplex logik som kan delas upp

**Forslag:**
- Skapa en `useBuildingSpaces(buildingFmGuid)` hook som memoize:ar spaces/storeys for en byggnad
- Flytta berakningen av facilities-listan till en delad hook `useFacilities()` som bade HomeLanding och PortfolioView kan anvanda
- Lazy-ladda `FloatingFloorSwitcher` subkomponenter

---

### 7. Mobil UX -- Forbattringspunkter

**Bra idag:**
- Immersive mode for 3D/360/Karta fungerar korrekt
- MobileNav med Drawer/FAB ar modernt
- Safe-area-insets hanteras

**Problem:**
- QuickActions pa mobil: 15 knappar i `grid-cols-3` med `text-[10px]` ar svasrt att traffa. Minsta touch target = 44x44px rekommenderas av Apple/Google, men knapparna ar `py-2 px-2` (ca 32x28px)
- FacilityLandingPage: Scrollarea med mange sektioner -- pa mobil kan man scrolla forbi viktiga actions utan att se dem
- MobileNav: 72px breda knappar ar bra, men `text-[11px]` label under 48px ikon ar i minsta laget

**Forslag:**
- QuickActions: Oka touch targets till `py-3 px-3` pa mobil, visa max 6 knappar i primarrad + "Mer..." expansion
- FacilityLandingPage: Latt till "sticky" KPI-rad langst upp som visas vid scroll
- MobileNav labels: Oka till `text-xs` (12px)

---

### 8. Visuell Hierarki och Farganvandning

**Problem:**
- QuickActions: Ikonfarger ar inkonsistenta (`text-primary`, `text-accent`, `text-destructive`, `text-orange-500`) utan tydlig logik
- Skarmar blandar svenska och engelska godtyckligt: "My Favorites" (eng) men "Felanmalan" (sve), "Inventering" (sve) men "Quick Actions" (eng)

**Forslag:**
- Definiera en ikonfargpalett: Visualization=primary, Data=accent, Tools=muted-foreground, Danger=destructive
- Bestam sprak: Antingen konsekvent svenska ELLER engelska i UI (labels, rubriker, placeholders)

---

### 9. Login-skarm

Nuvarande login ar funktionell men minimal. Jamnfort med Autodesk Tandem (som har en marknadsforing-hero + login) ar Geminus login spartansk.

**Forslag:**
- Lagg till en hero-bild eller animation (3D-modell preview) pa vanster sida pa desktop
- Visa produktnamn + tagline tydligare
- Behall det enkla pa mobil (bara Google-knapp)

---

### 10. Sammanfattning av Prioriterade Atgarder

**Hog prioritet (Visuell konsistens):**
1. Infora Type Scale System och migrera alla `text-[Xpx]` till det
2. Standardisera Card-storlekar mellan HomeLanding och Portfolio
3. Extrahera `extractNtaFromAttributes` och `SIDEBAR_ITEM_META` till delade moduler
4. Enhetlig sidpadding pa alla sidor

**Medel prioritet (UX):**
5. Oka touch targets i QuickActions pa mobil
6. Forenkla QuickActions till primar/sekundar-layout
7. Bestam sprakstrategi (sve/eng)
8. Enhetlig ikonfargspalette

**Lag prioritet (Prestanda):**
9. Skapa `useFacilities()` delad hook
10. Skapa `useBuildingSpaces()` hook
11. Dela upp `FloatingFloorSwitcher` i subkomponenter

---

### Teknisk Implementation

Alla forandringar gors **inkrementellt** i befintliga filer -- ingen omskrivning. Varje punkt ovan ar en isolerad andring som kan godkannas separat. Ingen ny sidstruktur, inga nya beroenden, inga databasandringar.

**Filer som beroers:**
- `src/lib/building-utils.ts` (ny, for delade hjalp-funktioner)
- `src/lib/sidebar-config.ts` (ny, for delat SIDEBAR_ITEM_META)
- `src/components/home/HomeLanding.tsx` (typografi, kort-storlekar)
- `src/components/portfolio/PortfolioView.tsx` (typografi, ta bort duplicering)
- `src/components/portfolio/FacilityCard.tsx` (standardisera kort)
- `src/components/portfolio/FacilityLandingPage.tsx` (typografi, padding)
- `src/components/portfolio/KpiCard.tsx` (typografi)
- `src/components/portfolio/QuickActions.tsx` (touch targets, layout)
- `src/components/layout/LeftSidebar.tsx` (anvand delat config)
- `src/components/layout/MobileNav.tsx` (anvand delat config, oka labels)
- `src/components/insights/InsightsView.tsx` (padding)
- `src/pages/Login.tsx` (hero-bild pa desktop)

