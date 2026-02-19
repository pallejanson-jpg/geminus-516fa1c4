
## Plan: Fix duplicerat ID som bryter 3D-laddning

### Rot-orsaken (nu bekräftad)

JSX-renderingen i `AssetPlusViewer.tsx` har:

```tsx
<div 
  ref={viewerContainerRef}
  id="AssetPlusViewer"   // ← yttre container med ID
  ...
/>
```

Den tidigare "fix"-koden gör sedan i `initializeViewer`:

```typescript
container.innerHTML = '';        // Rensar containern
const freshDiv = document.createElement('div');
freshDiv.id = 'AssetPlusViewer'; // ← SKAPAR EN TILL div med SAMMA ID inuti
container.appendChild(freshDiv);
```

Nu finns **två element med `id="AssetPlusViewer"`** i DOM — den yttre JSX-divven OCH den nyskapade inre divven. Det är ogiltig HTML och Asset+ Vue-runtime hittar fel element som monteringspunkt.

DOM-trädet ser ut såhär (felaktigt):
```text
<div id="AssetPlusViewer" ref={viewerContainerRef}>  ← JSX yttre
  <div id="AssetPlusViewer">                           ← nyskapad (fel!)
  </div>
</div>
```

Det gör att Asset+ antingen monterar sig i fel div, eller att `document.getElementById('AssetPlusViewer')` i DOM-check-loopen hittar den yttre divven (som alltid finns) och aldrig väntar tillräckligt.

---

### Korrekt fix

**Strategi**: Behåll `id="AssetPlusViewer"` på JSX-containern (Asset+ behöver den), men istället för att skapa en ny inre div — lägg ett unikt `data-viewer-key`-attribut på containern vid varje ny initiering. Detta tvingar Vue att betrakta elementet som nytt.

Men det räcker inte — Vue cachelagrar baserat på DOM-noden, inte attribut. Den verkliga lösningen är att:

1. Ta bort `id="AssetPlusViewer"` från JSX-divven
2. Låt containern bara ha `ref={viewerContainerRef}` utan ID
3. Behåll skapandet av `freshDiv` med `id="AssetPlusViewer"` inuti containern — nu finns det bara **ett** element med rätt ID i DOM

DOM-trädet ser ut såhär (korrekt):
```text
<div ref={viewerContainerRef} class="...">  ← JSX yttre (inget ID)
  <div id="AssetPlusViewer">                 ← nyskapad, enda med ID
  </div>
</div>
```

DOM-check-loopen `document.getElementById('AssetPlusViewer')` i `initializeViewer` letar efter detta ID — och hittar **ingenting** tills vi skapat `freshDiv`. Men vi skapar `freshDiv` **efter** att loopen är klar, vilket är korrekt ordning.

**Waitloop-check**: Loopen kontrollerar `viewerContainerRef.current && document.getElementById('AssetPlusViewer')`. Om JSX-divven inte längre har `id="AssetPlusViewer"`, kommer `document.getElementById` returnera `null` — och loopen väntar i upp till 3 sekunder i onödan.

Rätt lösning för loopen: Ta bort `document.getElementById('AssetPlusViewer')` från villkoret — det räcker att kontrollera `viewerContainerRef.current`. Containern är alltid kopplad via ref.

---

### Ändringar

**`src/components/viewer/AssetPlusViewer.tsx`** — tre punkter:

**1. Ta bort `id="AssetPlusViewer"` från JSX-divven** (rad ~3620):
```tsx
// Före:
<div 
  ref={viewerContainerRef}
  id="AssetPlusViewer"
  className={...}
/>

// Efter:
<div 
  ref={viewerContainerRef}
  className={...}
/>
```

**2. Förenkla DOM-check-loopen** (rad ~2941):
```typescript
// Före:
if (viewerContainerRef.current && document.getElementById('AssetPlusViewer')) {

// Efter:
if (viewerContainerRef.current) {
```

**3. Behåll `freshDiv`-skapandet** (rad ~2968-2975) — oförändrat, det är korrekt nu:
```typescript
container.innerHTML = '';
const freshDiv = document.createElement('div');
freshDiv.id = 'AssetPlusViewer';
container.appendChild(freshDiv);
await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
await new Promise<void>(r => setTimeout(r, 50));
```

---

### Sammanfattning

| Problem | Orsak | Fix |
|---|---|---|
| Duplicerat `id="AssetPlusViewer"` | JSX-div + nyskapad div har samma ID | Ta bort ID från JSX-div |
| DOM-loop väntar i onödan | Letar efter ID som inte finns förrän efter loopen | Ta bort `getElementById`-check från loop |
| Asset+ monterar i fel element | Hittar yttre div istället för inner | Nu finns bara ett element med rätt ID |

Inga DB-ändringar, inga nya filer, inga edge functions.
