

# Plan: Fix 3D-laddning, spinner-redesign och Cesium-översyn

## 1. Fix: Xeokit SDK dynamisk import misslyckas

**Problem**: `import(/* @vite-ignore */ '/lib/xeokit/xeokit-sdk.es.js')` misslyckas i preview-miljön. Vite lägger till `?import` suffix som gör att filen bearbetas felaktigt.

**Fix**: Byt laddningsmetod i `NativeXeokitViewer.tsx` — använd `fetch()` + blob URL istället av direkt `import()`:
```ts
const response = await fetch(XEOKIT_CDN);
const text = await response.text();
const blob = new Blob([text], { type: 'application/javascript' });
const blobUrl = URL.createObjectURL(blob);
const sdk = await import(/* @vite-ignore */ blobUrl);
URL.revokeObjectURL(blobUrl);
```
Samma ändring i `usePerformancePlugins.ts` (rad 13 använder samma path).

## 2. Spinner-redesign

**Problem**: Två spinners — en orange (Suspense fallback i `MainContent.tsx`) och den lila (`Spinner`-komponenten i `NativeXeokitViewer.tsx`). Användaren vill ta bort den oranga och göra den lila mer visuellt intressant.

**Fix i `src/components/ui/spinner.tsx`**:
- Lägg till en CSS-animation som skiftar genom lila/blå/cyan nyanser (hue-rotate eller gradient-animation)
- Använd `@keyframes` i Tailwind/inline för mjuk färgskiftning
- Behåll Loader2-ikonen men applicera `animate-spin` + `animate-[colorShift_3s_ease-in-out_infinite]`

**Fix i `MainContent.tsx`**: Ändra Suspense fallback från orange Loader2 till den nya `Spinner`-komponenten med text.

## 3. Cesium-översyn (React error #31)

**Problem**: `CesiumGlobeView.tsx` använder `<Viewer>` från `resium` deklarativt (rad 302-315). `resium`-komponenter returnerar React-element wrappade runt Cesium-objekt som ibland kolliderar med Reacts rendering (error #31: objekt som barn). Dessutom misslyckas dynamisk import av hela modulen (`Failed to fetch dynamically imported module: .../CesiumGlobeView.tsx`).

**Rotorsak**: `resium` kräver att `cesium`-paketet matchar exakt den interna versionen. Projektet har `cesium@1.139.0` som buntar `@cesium/engine@23` internt, medan `@cesium/engine@22.3.0` finns separat. Denna dubbel-instans gör att Cesium-klasser inte är `instanceof`-kompatibla, vilket kraschar resium.

**Fix**: Gör CesiumGlobeView **helt imperativ** — ta bort `resium`-beroenden och skapa Cesium-viewern direkt:
- `import { Viewer } from 'resium'` → `import * as Cesium from 'cesium'`
- Ersätt `<Viewer ref={viewerRef} .../>` med en `<div ref={containerRef}/>` + `useEffect` som kör `new Cesium.Viewer(container, {...options})`
- Behåll all befintlig pin-logik, event-handlers, OSM buildings osv. (redan imperativ)
- Cleanup i `useEffect` return: `viewer.destroy()`
- Detta eliminerar resium helt och undviker React #31

## Filer att ändra

| Fil | Ändring |
|-----|---------|
| `NativeXeokitViewer.tsx` | Byt `import()` till fetch+blob, ta bort orange/orange relaterad styling |
| `usePerformancePlugins.ts` | Samma fetch+blob-fix för SDK-laddning |
| `spinner.tsx` | Lägg till färgskiftande animation |
| `MainContent.tsx` | Uppdatera Suspense fallback till `Spinner`-komponent |
| `CesiumGlobeView.tsx` | Skriv om till imperativ Cesium.Viewer, ta bort resium-import |

