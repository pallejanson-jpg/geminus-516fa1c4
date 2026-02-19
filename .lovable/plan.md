
# Orsak till "Sorry, we ran into an issue starting the live preview!"

## Vad som händer

Det nyligen tillagda `HomeMapPanel` i `HomeLanding.tsx` orsakar att appen kraschar vid start på `/`-routen.

Orsakskedjan:

```
HomeLanding.tsx
  → importerar HomeMapPanel (direkt import, inte lazy)
    → HomeMapPanel lazy-laddar CesiumGlobeView (standard är 'cesium')
      → CesiumGlobeView.tsx importerar resium + @cesium/engine
        → Cesium kraschar previews / laddas instabilt
```

Det finns **tre problem** i kombination:

1. **`HomeLanding` importerar `HomeMapPanel` utan `Suspense`** – om lazy-laddningen av Cesium kastar ett fel fångas det inte, och appen kraschar.

2. **Standard-läge är `'cesium'`** – Cesium är den tyngsta och mest instabila komponenten i projektet (den kräver Cesium Ion-token, WASM, WebGL). Den laddas omedelbart när startsidan öppnas.

3. **`HomeMapPanel` saknar Error Boundary** – om `CesiumGlobeView` kastar ett fel (t.ex. misslyckad token-hämtning, WebGL-problem) bubblar felet upp och kraschar hela appen.

## Lösning

Tre konkreta fixes:

### Fix 1 – Sätt Mapbox som standard-läge
Ändra `useState<MapMode>('cesium')` → `useState<MapMode>('mapbox')` i `HomeMapPanel.tsx`. Mapbox är stabilare och kräver ingen WASM eller Ion-token för att initieras. Cesium finns fortfarande tillgänglig via toggle-knappen.

### Fix 2 – Lägg till `Suspense` runt `HomeMapPanel` i `HomeLanding.tsx`
`HomeMapPanel` är en tung komponent som lazy-laddar underkomponenter. Den ska wrappas i `<Suspense>` med en loading-spinner som fallback.

### Fix 3 – Lägg till Error Boundary runt kartinnehållet i `HomeMapPanel.tsx`
En enkel `try/catch`-baserad Error Boundary runt `CesiumGlobeView` och `MapView` så att om kartan kraschar visas ett felmeddelande istället för att hela appen går ned.

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/home/HomeMapPanel.tsx` | Ändra default till `'mapbox'`, lägg till Error Boundary runt kartinnehållet |
| `src/components/home/HomeLanding.tsx` | Wrappa `<HomeMapPanel>` i `<Suspense>` med fallback |

## Implementationsdetaljer

**HomeMapPanel.tsx:**
```tsx
// Fix 1: Mapbox som default (stabilt, ingen WASM)
const [mapMode, setMapMode] = useState<MapMode>('mapbox');

// Fix 3: Error Boundary runt kartan
class MapErrorBoundary extends React.Component<...> {
  // visar "Kartan kunde inte laddas" + retry-knapp vid fel
}
```

**HomeLanding.tsx:**
```tsx
// Fix 2: Suspense-wrapper
<div className="hidden xl:block xl:flex-1 xl:min-h-[600px] xl:sticky xl:top-4 self-stretch">
  <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>}>
    <HomeMapPanel />
  </Suspense>
</div>
```

Dessa tre fixes säkerställer att startsidan alltid kan laddas utan att Cesium-problemet påverkar resten av appen.
