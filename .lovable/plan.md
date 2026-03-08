
# Plan: Viewer Performance & Mobile Touch Fixes

## Identifierade problem

1. **SDK-laddning tar 10-12s** — NativeXeokitViewer laddar SDK via `fetch()` → `Blob` → `import()` varje gång. Den globala `__xeokitSdk` sparas men återanvänds inte i NativeXeokitViewer vid uppstart.
2. **Fit-view saknas** — Den 500ms-timern i NativeXeokitViewer (rad 490-505) lyssnar på `LOAD_SAVED_VIEW_EVENT` men NativeViewerShell konsumerar eventet i sin egen listener (rad 275-288), så NativeXeokitViewer's `savedViewHandler` kanske aldrig triggas → fitTimer avbryts felaktigt. Dessutom: `duration: 0` men aabb kan vara tomt om modeller inte hunnit rendera.
3. **Standalone 2D fungerar inte** — MobileUnifiedViewer skickar `VIEW_MODE_REQUESTED_EVENT` 4 gånger (rad 819-823) med hårdkodade timeouts (300/800/2000/4000ms). Toolbaren behöver vara mountad och viewer redo. Timing-problem.
4. **Split-view scrollar hela sidan** — MobileUnifiedViewer container (rad 834) har `fixed inset-0` men 2D-panelen saknar `touch-action: none` och `overflow: hidden`, så touch-events bubblar upp.
5. **Kamera-overlay i 2D-split fungerar dåligt** — Kamerapositions-CSS (rad 728-729) använder `calc()` med `%` och `px` som inte fungerar korrekt.
6. **360-knappen visas för byggnader utan Ivion** — Redan delvis hanterat (`{hasIvion && ...}`) men i MobileViewerOverlay (rad 90-100) och i non-split mode-switchern (rad 1018-1028), dock inte i split-mode switchern (rad 922-932).

## Godkända val
- **Fit View**: Instant (duration: 0), alltid
- **360 utan site**: Dölj knappen helt
- **Touch-lås**: Hårt — hela viewer-sidan låst

## Plan

### 1. SDK-cache: undvik dubbelladdning (`NativeXeokitViewer.tsx`)
- Kontrollera `window.__xeokitSdk` FÖRST innan fetch+blob+import
- Om det redan finns: använd det direkt, spara ~3-5 sekunder

### 2. Instant fit-view som aldrig misslyckas (`NativeXeokitViewer.tsx`)
- Ändra fallback-timern (rad 490-505): ta bort `LOAD_SAVED_VIEW_EVENT`-lyssnaren, gör istället en direkt instant fit ALLTID efter att alla modeller laddats (duration: 0)
- Om en sparad startvy finns appliceras den OVANPÅ fit-viewn (via NativeViewerShell's existing handler)

### 3. Fixad 2D-mode i mobil (`UnifiedViewer.tsx`)
- Ta bort de 4 upprepade `setTimeout`-anropen (rad 819-823) och ersätt med en som lyssnar på `VIEWER_MODELS_LOADED` istället (samma mönster som desktop)

### 4. Hårt touch-lås i split-vy (`UnifiedViewer.tsx`)
- Lägg till `touch-action: none` och `overflow: hidden` på 2D-panel-containern (rad 841-855)
- Se till att containern (rad 834) har `overscrollBehavior: 'none'` för att förhindra scroll-bounce

### 5. 360-knapp dold utan Ivion — redan korrekt i de flesta ställen
- Verifiera att split-mode switchern (rad 922-932) redan har `{hasIvion && ...}` guard — den har det

### 6. Kameraindikator-fix i SplitPlanView (`SplitPlanView.tsx`)
- Fixa CSS-beräkningen (rad 728-729) från `calc(${x}% * ${scale} + ${offset}px)` till `${x * scale / 100 * containerWidth + offset}px` — eller enklare: flytta kameran inuti transform-containern

## Filer att ändra
- `src/components/viewer/NativeXeokitViewer.tsx` — SDK-cache + instant fit
- `src/pages/UnifiedViewer.tsx` — 2D-fix + touch-lås + timeout-cleanup
- `src/components/viewer/SplitPlanView.tsx` — kameraindikator-fix
