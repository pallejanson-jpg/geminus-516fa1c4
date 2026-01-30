
# Plan: Felsökning och förbättring av TreeView, Asset-synk & XKT-synk

## ✅ STATUS: GENOMFÖRD

Alla fyra delar av planen har implementerats:

---

## ✅ Del 1: TreeView - Chunked rendering (KLAR)

**Ändrad fil:** `src/components/viewer/ViewerTreePanel.tsx`

**Ändringar:**
- Implementerade **chunked tree rendering** som bygger trädet i bitar om 5 root-items åt gången
- Lade till `buildProgress` state för att visa `X / Y våningar` under laddning
- Använder `requestIdleCallback` med 100ms timeout mellan varje chunk
- Lade till `buildCancelledRef` för att avbryta pågående byggen när panelen stängs
- Lade till visuell progress-indikator med `Loader2` spinner

---

## ✅ Del 2: Asset-synk - Robust mount-trigger (KLAR)

**Ändrad fil:** `src/components/portfolio/AssetsView.tsx`

**Ändringar:**
- Refaktorerade `useEffect` till att ALLTID hämta från databasen vid mount (ignorerar props)
- Om inga assets finns i databasen → triggar synk automatiskt
- Detaljerad logging med `console.log('AssetsView: Initializing assets...')`
- Visar toast när synk är klar

---

## ✅ Del 3: XKT-synk - Statusindikator (KLAR)

**Ändrad fil:** `src/components/viewer/AssetPlusViewer.tsx`

**Ändringar:**
- Lade till `xktSyncStatus` state: `'idle' | 'checking' | 'syncing' | 'done' | 'error'`
- Visuell indikator i övre vänstra hörnet:
  - 🔵 "Kontrollerar modeller..." (checking)
  - 🟡 "Synkar 3D-modeller..." (syncing, med pulsande animation)
- Indikatorn visas endast när viewern är initialiserad

---

## ✅ Del 4: React ref-varning (KLAR)

**Ändrad fil:** `src/components/viewer/ViewerTreePanel.tsx`

**Ändringar:**
- Wrappade komponenten med `React.forwardRef<HTMLDivElement, ViewerTreePanelProps>`
- Lade till `ref` på root-div i både embedded och floating mode
- Lade till `displayName` för debugging

---

## Sammanfattning

| Del | Status | Fil |
|-----|--------|-----|
| TreeView chunked rendering | ✅ Klar | ViewerTreePanel.tsx |
| Asset-synk mount-trigger | ✅ Klar | AssetsView.tsx |
| XKT-synk statusindikator | ✅ Klar | AssetPlusViewer.tsx |
| React ref-varning | ✅ Klar | ViewerTreePanel.tsx |
