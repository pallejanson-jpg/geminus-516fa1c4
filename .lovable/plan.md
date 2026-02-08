

# Fix: Gunnars mobilposition + responsivitetsgranskning

## Sammanfattning

Gunnar och Ilean-knapparnas position ar felaktig pa mobil, och flera skarmvyer saknar optimeringar for sma skarmar. Har ar en fullstandig genomgang med atgarder.

---

## 1. Gunnar-knappens mobilposition (Kritiskt)

**Problem:** Gunnar-knappens standardposition (`bottom-20 right-4 sm:bottom-6`) placerar den pa `bottom-20` (80px) pa mobil, men `bottom-6` (24px) pa desktop (`sm:`). Problemet ar att `bottom-20` kolliderar med MobileNav-overlayens y-position nar den ar oppen, och pa manga mobiler hamnar den bakom browser chrome eller utanfor skarmen.

Dessutom: nar en position sparas i localStorage (via drag), anvands `top/left` pixelvarden fran en annan skarmstorlek, vilket kan placera knappen helt utanfor skarmen vid byte av orientering eller enhet.

**Samma problem finns for Ilean-knappen** (`bottom-20 left-4 sm:bottom-6`).

**Atgard i `src/components/chat/GunnarButton.tsx`:**
- Andra standardpositionen till `bottom-24 right-4` (96px fran botten) pa mobil for att placera den ovanfor MobileNavs bottenomrade
- Lagg till safe-area-inset-bottom i berakningen
- Nar sparad position laddas fran localStorage: validera mot aktuell viewport-storlek och klamma till synligt omrade
- Anvand `sm:bottom-6` for desktop som idag

**Atgard i `src/components/chat/IleanButton.tsx`:**
- Samma fix: `bottom-24 left-4` pa mobil, validering av sparad position

**Atgard i bada filer - position-validering vid laddning:**
```text
// When loading saved position, clamp to current viewport
useEffect(() => {
  const settings = getGunnarSettings();
  if (settings.buttonPosition) {
    const maxX = window.innerWidth - 56;
    const maxY = window.innerHeight - 56;
    setTriggerPosition({
      x: Math.max(0, Math.min(settings.buttonPosition.x, maxX)),
      y: Math.max(0, Math.min(settings.buttonPosition.y, maxY)),
    });
  }
}, []);
```

---

## 2. Gunnars chatpanel pa mobil

**Problem:** Chatpanelen har `width: window.innerWidth - 32` pa mobil, men positionen ar beraknad fran `window.innerWidth - panelWidth - 16` som kan ge negativa varden. Panelen ar ocksa for hog pa sma skarmar.

**Atgard i `src/components/chat/GunnarButton.tsx`:**
- Pa mobil (< 640px): ta over hela skarmen med `inset-0` istallet for att anvanda draggbar position
- Dold drag-header pa mobil -- ersatt med vanlig stangknapp
- Panelhojd: `100vh` pa mobil, befintlig berakning pa desktop

**Atgard i `src/components/chat/IleanButton.tsx`:**
- Samma fullskarms-fix pa mobil

---

## 3. Minimerad bubbla -- safe area

**Problem:** Minimerade bubblan anvander `bottom-20 sm:bottom-6` precis som triggerknappen, och hamnar bakom browser chrome pa mobil.

**Atgard:** Andra till `bottom-24` pa mobil, med `style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}` for konsekvent positionering.

---

## 4. Responsivitetsgranskning -- skarmvyer utan dedikerad mobillayout

### 4a. NavigatorView (`src/components/navigator/NavigatorView.tsx`)
**Status:** Bra responsivitet. Anvander `p-2 sm:p-3 md:p-4`, kompakta soksomraden och virtualiserad lista. Tradvyn har `h-[calc(100vh-200px)]` som ar ok.
**Atgard:** Ingen andring behovs.

### 4b. HomeLanding (`src/components/home/HomeLanding.tsx`)
**Status:** Bra responsivitet. Anvander sm/md-breakpoints genomgaende, grid som anpassas fran 1-3 kolumner.
**Atgard:** Ingen andring behovs.

### 4c. PortfolioView (`src/components/portfolio/PortfolioView.tsx`)
**Status:** Bra. Anvander responsiva grid (2-4 kolumner), kompakta paddings pa mobil, dold grid/list-vaxxlare pa mobil, carousel med swipe-indikator.
**Atgard:** Ingen andring behovs.

### 4d. FacilityLandingPage (`src/components/portfolio/FacilityLandingPage.tsx`)
**Status:** Bra. Responsiva paddings, kompakta knappar pa mobil, ScrollArea for langinnehall. Hero-bakgrund och KPI-kort ar responsiva.
**Atgard:** Ingen andring behovs.

### 4e. RoomsView (`src/components/portfolio/RoomsView.tsx`)
**Status:** Bra. Responsiva header, toolbars, och tabellinnehall med kompakta storlekar pa sma skarmar.
**Atgard:** Ingen andring behovs.

### 4f. InsightsView (`src/components/insights/InsightsView.tsx`)
**Status:** Bra. Tabs-listan ar scrollbar horisontellt pa mobil, responsiva texterstorlekar.
**Atgard:** Ingen andring behovs.

### 4g. QuickActions (`src/components/portfolio/QuickActions.tsx`)
**Status:** Bra. Grid ar `grid-cols-3 sm:grid-cols-4` med kompakta storlekar.
**Atgard:** Ingen andring behovs.

### 4h. InAppFaultReport (`src/components/fault-report/InAppFaultReport.tsx`)
**Status:** Bra. Har redan dedikerad `MobileFaultReport` for mobil.
**Atgard:** Ingen andring behovs.

### 4i. AppHeader (`src/components/layout/AppHeader.tsx`)
**Status:** Bra. Responsive hojd (`h-14 sm:h-16`), dolda menyalternativ pa mobil (visas i MobileNav istallet), kompakt sok.
**Atgard:** Ingen andring behovs.

### 4j. ApiSettingsModal (`src/components/settings/ApiSettingsModal.tsx`)
**Problem:** Ar en stor Dialog (2591 rader) som pa mobil kan vara svar att navigera. Dialog-standarder fran Radix borde hantera grundlaggande responsivitet. Behovs ingen andring for detta pass.
**Atgard:** Ingen andring behovs i detta pass.

---

## Sammanfattning av filandringar

| Fil | Andring |
|------|---------|
| `src/components/chat/GunnarButton.tsx` | Fix standardposition pa mobil (bottom-24), validera sparad position mot viewport, fullskarmpanel pa mobil |
| `src/components/chat/IleanButton.tsx` | Samma fix som Gunnar: standardposition, positionsvalidering, fullskarmpanel pa mobil |

## Tekniska detaljer

### Gunnar/Ilean fullskarms-panel pa mobil

Pa mobil (< 640px) ska chatpanelen renderas som en fullskarms-overlay istallet for en draggbar panel:

```text
// Mobile: fullscreen overlay
const isMobilePanel = typeof window !== 'undefined' && window.innerWidth < 640;

// In render:
style={isMobilePanel ? {
  inset: 0,
  width: '100%',
  height: '100%',
  borderRadius: 0,
} : {
  left: position.x,
  top: position.y,
  width: panelWidth,
  height: panelHeight,
}}
```

### Position-validering

Nar `triggerPosition` laddas fran localStorage, klamma x/y till aktuell viewport:
- `x`: max `window.innerWidth - buttonSize` (56px)
- `y`: max `window.innerHeight - buttonSize`
- Min 0 for bada

Detta forhindrar att knappen hamnar utanfor skarmen vid orienteringsbyte eller om positionen sparades pa en storskarm.

### Risker
- Befintliga anvandare med sparade positioner i localStorage far sin position klammad till synligt omrade, men den atergar alltid till en giltig plats.
- Fullskarmpanelen pa mobil ar en stilandring -- chatfunktionaliteten forblir identisk.

