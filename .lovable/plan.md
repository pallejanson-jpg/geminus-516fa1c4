
## Plan: Ta bort kartan från startsidan och återställa till ursprungligt utseende

Problemet är att Cesium-biblioteket orsakar krascher (React error #31 + module specifier-fel) och att kartan på startsidan som lades till idag inte fungerar stabilt. Lösningen är att ta bort allt som lades till idag och återgå till det ursprungliga utseendet.

---

### Vad som ändrades idag (och behöver återställas)

1. **`HomeLanding.tsx`** — Det lades till en höger kolumn med `HomeMapPanel`. Denna ska tas bort så att layouten enbart visar vänster kolumn (assistenter + favoriter), centrerat som tidigare.

2. **`vite.config.ts`** — Cesium-specifik konfiguration lades till (`exclude: ['cesium', 'resium']`, `manualChunks` för cesium-vendor). Dessa ska tas bort och återgå till den enkla konfigurationen som fanns innan.

3. **`package.json`** — Paketet `cesium` installerades (utöver `@cesium/engine` som redan fanns). Detta ska tas bort.

4. **`src/components/globe/CesiumGlobeView.tsx`** — Importen ändrades från `@cesium/engine` till `cesium`. Denna ska återgå till `@cesium/engine`.

---

### Konkreta ändringar

**`src/components/home/HomeLanding.tsx`**
- Ta bort importen av `HomeMapPanel` och `Loader2`
- Ta bort den högra kolumnen (div med `hidden xl:block xl:flex-1 ...` och `<HomeMapPanel />`)
- Ändra huvudlayouten från `xl:flex-row` tillbaka till enkel `flex-col` centrerad layout, exakt som den var innan idag

**`vite.config.ts`**
- Ta bort `optimizeDeps.exclude: ['cesium', 'resium']`-blocket
- Ta bort `build.rollupOptions.output.manualChunks`-blocket
- Återgå till den enkla konfigurationen med enbart `@`-aliaset

**`src/components/globe/CesiumGlobeView.tsx`**
- Återgå till `import * as Cesium from '@cesium/engine'` (originalimport)

**`package.json`**
- Ta bort `cesium`-paketet (behåll `@cesium/engine` och `resium` som var där sedan tidigare)

---

### Resultat

Startsidan återgår till den enkla, fungerande layouten med enbart AI-assistenter och My Favorites-kortet, centrerat med bakgrundsbilden — precis som den såg ut innan idag.

Cesium-globen (på sin dedikerade route `/globe`) behålls men återgår till att använda `@cesium/engine` som den ursprungligen gjorde.
