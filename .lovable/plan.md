
## Rot-orsaken: CSS-toolbar-gömning matchar inte längre

Tidigare hade containern `id="AssetPlusViewer"` OCH klassen `asset-plus-hide-builtin-toolbar`, vilket fick CSS-regeln att fungera:

```css
#AssetPlusViewer.asset-plus-hide-builtin-toolbar [class*="toolbar"] { display: none !important; }
```

Nu (efter senaste fix) ser DOM-trädet ut såhär:

```text
<div ref={viewerContainerRef} class="asset-plus-hide-builtin-toolbar ...">  ← har KLASSEN men inte ID
  <div id="AssetPlusViewer">                                                   ← har ID:t men inte KLASSEN
    ... (Asset+ Vue-innehåll, toolbars visas här)
  </div>
</div>
```

CSS-selektorn kräver att SAMMA element har **båda** — `#AssetPlusViewer` OCH `.asset-plus-hide-builtin-toolbar`. Det stämmer inte längre → toolbars visas.

Dessutom: `freshDiv` (med `id="AssetPlusViewer"`) ärver klasser från sin parent men CSS-selektorn `#AssetPlusViewer.asset-plus-hide-builtin-toolbar` kollar inte parent-element.

---

## Lösning: Tre delar

### Del 1 — Lägg klassen på `freshDiv` (inte containern)

I `initializeViewer` (rad ~2968–2971), när vi skapar `freshDiv`, lägg till alla DX-klasser OCH `asset-plus-hide-builtin-toolbar` direkt på `freshDiv`:

```typescript
// Före:
const freshDiv = document.createElement('div');
freshDiv.id = 'AssetPlusViewer';
container.appendChild(freshDiv);

// Efter:
const freshDiv = document.createElement('div');
freshDiv.id = 'AssetPlusViewer';
// Lägg DX-klasser + toolbar-hiding på freshDiv — CSS-selector kräver att ID och klass är på SAMMA element
freshDiv.className = [
  'w-full', 'h-full',
  isMobile ? 'dx-device-mobile' : 'dx-device-desktop',
  'dx-device-generic', 'dx-theme-material', 'dx-theme-material-typography',
  'asset-plus-hide-builtin-toolbar'
].join(' ');
freshDiv.style.cssText = 'width:100%;height:100%;display:flex;flex:1 0 auto;';
container.appendChild(freshDiv);
```

### Del 2 — Ta bort klassen från JSX-containern

JSX-containern (`viewerContainerRef`) behöver inte längre klassen `asset-plus-hide-builtin-toolbar` — den är nu på `freshDiv`. Ta bort den för att undvika duplicering. Behåll övriga klasser för layout.

```tsx
// Före:
className={`w-full h-full ${isMobile ? 'dx-device-mobile' : 'dx-device-desktop'} dx-device-generic dx-theme-material dx-theme-material-typography asset-plus-hide-builtin-toolbar`}

// Efter (containern är bara ett layout-skal):
className="w-full h-full"
```

### Del 3 — Säkerställ att `assetplusviewer()` hittar rätt element

`assetplusviewer()`-biblioteket anropar `document.getElementById('AssetPlusViewer')` internt för att hitta sin mount-target. Nu finns det bara ett sådant element i DOM (`freshDiv`). Det stämmer.

Men: Vi måste se till att `assetplusviewer()` anropas EFTER att `freshDiv` är tillagd i DOM — vilket det redan är (vi lägger till `freshDiv` och väntar 2 rAF + 50ms innan `assetplusviewer()` anropas). Bra.

---

## Filer som ändras

**`src/components/viewer/AssetPlusViewer.tsx`** — två ställen:

1. `initializeViewer` (~rad 2969): Lägg klasser + stilar på `freshDiv`
2. JSX-container (~rad 3619): Förenkla className till bara layout-klasser

**`src/index.css`** — inga ändringar behövs (CSS-selektorn är redan korrekt, det var bara DOM som var fel)

---

## Teknisk sammanfattning

| Problem | Orsak | Fix |
|---|---|---|
| Toolbars visas | `#AssetPlusViewer.asset-plus-hide-builtin-toolbar` matchar ingenting — ID och klass är på olika element | Flytta klassen till `freshDiv` som har ID:t |
| Ingen 3D på desktop | Asset+ Vue-runtime kan ha haft problem med ny DOM-struktur | `freshDiv` har nu rätt klasser + inline-stilar för korrekt layout |
| Fungerar på mobil men inte desktop | `isMobile`-check på DX-klassen sattes fel | Klassen sätts nu dynamiskt baserat på `isMobile` på `freshDiv` |

Inga DB-ändringar, inga nya filer, inga edge functions.
