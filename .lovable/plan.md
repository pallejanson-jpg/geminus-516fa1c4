

# Fix: 3D-viewer kraschar pa mobil

## Problemanalys

Efter att ha granskat hela flödet har jag identifierat flera potentiella kraschkällor:

1. **Inga felgränser (Error Boundaries)**: Om AssetPlusViewer eller det underliggande Asset+-biblioteket kastar ett ohanterligt fel, kraschar hela React-appen till en vit skärm. Det finns ingen React Error Boundary som fångar detta.

2. **Ohanterade asynkrona avvisningar (unhandled rejections)**: `handleAllModelsLoaded`-callbacken anropar `loadLocalAnnotations()` och `loadAlarmAnnotations()` -- om dessa kastar fel utanför try/catch (t.ex. nätverksfel eller timeout), kraschar appen. Dessutom kan Asset+-biblioteket generera ohanterade promise-rejections internt.

3. **WebGL-kontextförlust**: Mobila GPU:er har begränsat minne. När stora BIM-modeller laddas kan WebGL-kontexten förloras (context lost), vilket kraschar viewer-canvasen utan möjlighet till återhämtning.

4. **Fetch-interceptorn återställs inte vid krasch**: `setupCacheInterceptor` ersätter `window.fetch` globalt. Om viewern kraschar innan `restoreFetch` anropas, förblir den modifierade fetch-funktionen aktiv, vilket kan orsaka följdproblem.

---

## Lösning: 4 ändringar

### Steg 1: Lägg till global unhandledrejection-handler

**Fil:** `src/App.tsx`

Lägg till en `useEffect` i App-komponenten som lyssnar på `unhandledrejection`-event. Detta fångar alla ohanterade promise-avvisningar (t.ex. från Asset+-biblioteket) och förhindrar att hela appen kraschar. Visar ett toast-meddelande istället.

```
useEffect(() => {
  const handleRejection = (event: PromiseRejectionEvent) => {
    console.error("Unhandled rejection:", event.reason);
    event.preventDefault(); // Prevent crash
  };
  window.addEventListener("unhandledrejection", handleRejection);
  return () => window.removeEventListener("unhandledrejection", handleRejection);
}, []);
```

### Steg 2: Lägg till React Error Boundary

**Ny fil:** `src/components/common/ViewerErrorBoundary.tsx`

Skapa en React Error Boundary-komponent som fångar rendering-fel i AssetPlusViewer. Visar ett användarvänligt felmeddelande med en "Försök igen"-knapp istället för en vit skärm.

**Fil:** `src/pages/Mobile3DViewer.tsx`

Wrappa `<AssetPlusViewer>` i `<ViewerErrorBoundary>` med en `onReset`-callback som navigerar tillbaka.

**Fil:** `src/pages/Viewer.tsx`

Wrappa `<AssetPlusViewer>` i `<ViewerErrorBoundary>` på samma sätt.

### Steg 3: Hantera WebGL context lost

**Fil:** `src/components/viewer/AssetPlusViewer.tsx`

Lägg till en `useEffect` som lyssnar på `webglcontextlost` och `webglcontextrestored` på viewer-canvasen. Vid context lost:
- Visa ett felmeddelande: "3D-motorn förlorade anslutningen. Klicka 'Försök igen'."
- Förhindra default-beteende (`event.preventDefault()`)
- Vid context restored: rensa felmeddelandet och försök initiera om viewern

```
useEffect(() => {
  const canvas = viewerContainerRef.current?.querySelector('canvas');
  if (!canvas) return;
  
  const handleContextLost = (e: Event) => {
    e.preventDefault();
    setState(prev => ({
      ...prev,
      error: 'WebGL-kontext förlorad. Enheten har slut på grafikminne.',
      isLoading: false,
    }));
    setShowError(true);
  };
  
  canvas.addEventListener('webglcontextlost', handleContextLost);
  return () => canvas.removeEventListener('webglcontextlost', handleContextLost);
}, [state.isInitialized]);
```

### Steg 4: Defensiv wrapping av handleAllModelsLoaded

**Fil:** `src/components/viewer/AssetPlusViewer.tsx`

Wrappa hela `handleAllModelsLoaded`-callbackens body i en try/catch. Specifikt:
- Wrappa `loadLocalAnnotations()` och `loadAlarmAnnotations()` i individuella try/catch-block
- Wrappa NavCube-initieringen (redan har try/catch, behåll)
- Säkerställ att `restoreFetch` alltid anropas vid cleanup, även vid krasch

---

## Sammanfattning av filändringar

| Fil | Ändring |
|-----|---------|
| `src/App.tsx` | Global unhandledrejection-handler |
| `src/components/common/ViewerErrorBoundary.tsx` | Ny Error Boundary-komponent |
| `src/pages/Mobile3DViewer.tsx` | Wrappa AssetPlusViewer i ErrorBoundary |
| `src/pages/Viewer.tsx` | Wrappa AssetPlusViewer i ErrorBoundary |
| `src/components/viewer/AssetPlusViewer.tsx` | WebGL context lost-hantering + defensiv try/catch i handleAllModelsLoaded |

## Tekniska detaljer

### Error Boundary-komponent (pseudokod)
```text
class ViewerErrorBoundary extends Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error, info) {
    console.error('Viewer crashed:', error, info);
  }
  
  handleReset() {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  }
  
  render() {
    if (this.state.hasError) {
      return <CrashUI onRetry={this.handleReset} />;
    }
    return this.props.children;
  }
}
```

### Risker och begränsningar
- Error Boundary fångar bara synkrona rendering-fel, inte asynkrona. Därför behövs BÅDE error boundary OCH unhandledrejection-handler.
- WebGL context lost kan bero på att enheten har för lite minne -- i det fallet hjälper inte en omstart, men åtminstone kraschar inte appen.

