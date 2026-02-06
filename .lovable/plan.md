

# Plan: Prestandafix, kollapserbara sektioner, namngivning och positionering

## Sammanfattning av problem

1. **Prestanda**: ViewerRightPanel renderar alla tunga barn (ModelVisibilitySelector, FloorVisibilitySelector, RoomVisualizationPanel, LightingControlsPanel) oavsett om panelen ar oppen eller stangd. Sheet mountar alltid sitt innehall.
2. **Kollapserbara sektioner**: "Visa", "Rumsvisualisering" och "Atgarder" ar inte kollapserbara -- bara BIM-modeller, Vaningar och Viewer Settings ar det.
3. **Vaningsnamn**: Vissa vaningsplan i Smaviken saknar `common_name` i databasen (3 av 13 storeys har `null`). Da faller koden tillbaka till `Vaningsplan {GUID-fragment}`. Problemet: metaObject.name fran xeokit ar ocksa ett GUID.
4. **FloatingFloorSwitcher position**: Initieras med `x = window.innerWidth - 80` (fixed position), men med den nya hogerpanelen (320px bred) hamnar den utanfor synligt omrade. Dessutom ar den for lang vertikalt.
5. **BIM-modellnamn**: `xkt_models`-tabellen ar tom for Smaviken, sa ModelVisibilitySelector faller tillbaka till Asset+ API. Men bara modeller som faktiskt ar laddade i scenen visas -- modeller som inte ar laddade (E, B, V) syns inte.

---

## Losning 1: Prestanda -- lazy rendering

Problemet ar att Sheet alltid monterar sina barn. Losningen ar att villkorligt rendera tunga komponenter baserat pa `isOpen`:

```text
Andringar i ViewerRightPanel.tsx:

- Wrappa hela ScrollArea-innehallet i: {isOpen && (...)}
- Alternativt: anvand CSS visibility/display for att behalla state men undvika rendering
- ModelVisibilitySelector, FloorVisibilitySelector, RoomVisualizationPanel,
  LightingControlsPanel renderas bara nar panelen ar oppen
```

Detta forhindrar att alla underkomponenter (som gor Supabase-queries, itererar metaScene, etc.) kor nar panelen ar stangd.

---

## Losning 2: Kollapserbara sektioner

Gora om "Visa", "Rumsvisualisering" och "Atgarder" till Collapsible-komponenter. Bara "Visa" ska vara expanderad som standard.

| Sektion | Standard | Nu |
|---------|----------|----|
| BIM-modeller | Kollapsad | Redan collapsible, standard kollapsad |
| Vaningsplan | Kollapsad | Redan collapsible, standard kollapsad |
| **Visa** | **Expanderad** | Ej collapsible (fast div) |
| **Rumsvisualisering** | **Kollapsad** | Ej collapsible |
| **Viewer Settings** | Kollapsad | Redan collapsible, standard kollapsad |
| **Atgarder** | **Kollapsad** | Ej collapsible |

Ny state:

```typescript
const [displayOpen, setDisplayOpen] = useState(true);      // Expanderad som standard
const [roomVizOpen, setRoomVizOpen] = useState(false);      // Kollapsad
const [actionsOpen, setActionsOpen] = useState(false);       // Kollapsad
```

---

## Losning 3: Vaningsnamn

Problemet ar att vaningsplan utan `common_name` i databasen visas som GUID-fragment. Losningen ar att forbattra fallback-logiken i bade `FloorVisibilitySelector.tsx` och `FloatingFloorSwitcher.tsx`:

```text
Nuvarande fallback-kedja:
1. common_name fran databas -> OK om finns
2. metaObject.name -> Ofta ocksa ett GUID
3. "Vaningsplan {GUID.substring(0,8)}" -> Darligt

Ny fallback-kedja:
1. common_name fran databas -> OK om finns
2. metaObject.name (om det INTE ar ett GUID) -> Anvand det
3. name fran assets-tabellen (om den finns) -> Anvand det
4. "Plan {index+1}" -> Numrera sekventiellt baserat pa position i listan
```

Dessutom: nar `common_name` ar null men assets-tabellen har raden, inkludera `name`-faltet i DB-queryn (det ar redan inkluderat men inte anvant som fallback):

```typescript
// I fetchFloorNames:
const displayName = f.common_name || f.name || null; // Bara satt i map om vi har ett namn
if (displayName) {
  nameMap.set(f.fm_guid, displayName);
}
// Vaningsplan utan bade common_name och name i DB far "Plan X" som fallback
```

For att ge sekventiella namn ("Plan 1", "Plan 2") snarare an GUID-fragment, numbrera de ej-namngivna vaningarna baserat pa deras position i den sorterade listan.

---

## Losning 4: FloatingFloorSwitcher position och storlek

### Position
Andra initial position fran `window.innerWidth - 80` till `window.innerWidth - 400` (utanfor hogerpanelen). Samt gora den relativ till viewerns container istallet for `fixed` om mojligt. Enklaste fix: justera startposition och klamma till synligt omrade.

### Vertikal storlek
Minska `MAX_VISIBLE_PILLS_DESKTOP` fran 8 till 5 for att gora panelen kortare. Overflow-menyn handskas redan med resten.

### Namnproblem
Samma fix som Losning 3 -- `FloatingFloorSwitcher` anvander exakt samma fallback-logik.

---

## Losning 5: BIM-modellnamn och synlighet

### Problem A: Inte alla modeller visas
`ModelVisibilitySelector` kombinerar scen-modeller med `dbModels` (fran xkt_models-tabellen). Men xkt_models ar tom for Smaviken, sa inga extra modeller laggs till. Asset+ API-svaret anvands bara for namngivning, inte for att populera listan.

Fix: Nar modellnamn hamtas fran Asset+ API (GetModels), spara aven dessa som "tillgangliga men ej laddade" modeller i komponentens state, precis som dbModels redan gor for xkt_models-data.

```typescript
// I fetchModelNames, nar Asset+ API svarar:
if (response.ok) {
  const apiModels = await response.json();
  // Spara som apiModels for att visa i listan (ej laddade)
  setDbModels(apiModels.map(m => ({
    id: m.id || '',
    name: m.name || '',
    fileName: m.xktFileUrl ? extractModelIdFromUrl(m.xktFileUrl) + '.xkt' : m.id
  })));
  // ... namn-mappning som redan finns
}
```

### Problem B: Namngivning
Nar varken xkt_models eller Asset+ API ger namn, visas filnamnet utan formatering. Med Asset+ API-data lagd i dbModels-listen losas bade synlighet och namngivning.

---

## Filer som andras

| Fil | Andring |
|-----|---------|
| `src/components/viewer/ViewerRightPanel.tsx` | Lazy rendering (isOpen guard), kollapserbara Visa/RumsViz/Atgarder |
| `src/components/viewer/FloorVisibilitySelector.tsx` | Forbattrad vaningsnamn-fallback (Plan X) |
| `src/components/viewer/FloatingFloorSwitcher.tsx` | Positionsfix, max 5 pills, vaningsnamn-fallback |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Populera dbModels fran Asset+ API-svar |

---

## Tekniska detaljer

### ViewerRightPanel -- lazy rendering

```typescript
// Wrappa hela innehallet i isOpen-check
<ScrollArea className="h-[calc(100vh-80px)]">
  {isOpen && (
    <div className="p-4 space-y-3">
      {/* BIM Models, Floors, Display, etc. */}
    </div>
  )}
</ScrollArea>
```

### ViewerRightPanel -- kollapserbara sektioner

```typescript
// Nya state
const [displayOpen, setDisplayOpen] = useState(true);
const [roomVizOpen, setRoomVizOpen] = useState(false);
const [actionsOpen, setActionsOpen] = useState(false);

// Visa-sektionen blir:
<Collapsible open={displayOpen} onOpenChange={setDisplayOpen}>
  <CollapsibleTrigger asChild>
    <Button variant="ghost" className="w-full justify-between h-10 px-2">
      <span>Visa</span>
      <ChevronDown className={cn(...)} />
    </Button>
  </CollapsibleTrigger>
  <CollapsibleContent>
    {/* 2D/3D, Modellrad, Visa rum, Annotationer */}
  </CollapsibleContent>
</Collapsible>
```

### FloatingFloorSwitcher -- position och storlek

```typescript
// Initiell position: langre till vanster for att inte hamna under hogerpanelen
const x = window.innerWidth - 400;
const y = 150;

// Minska max synliga pills
const MAX_VISIBLE_PILLS_DESKTOP = 5; // Tidigare 8
```

### Vaningsnamn -- forbattrad fallback

```typescript
// I bade FloorVisibilitySelector och FloatingFloorSwitcher:
let displayName = metaObject.name || 'Unknown Floor';
if (dbName) {
  displayName = dbName;
} else if (displayName.match(/^[0-9A-Fa-f-]{30,}$/)) {
  // Namn ar ett GUID - ge sekventiellt nummer
  // (beraknas efter sortering, se nedan)
  displayName = null; // Markera for numrering
}

// Efter extraktion, numrera icke-namngivna vaningar:
let unknownIndex = 1;
extractedFloors.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
extractedFloors.forEach(floor => {
  if (!floor.name || floor.name.match(/^[0-9A-Fa-f-]{30,}$/)) {
    floor.name = `Plan ${unknownIndex}`;
    floor.shortName = String(unknownIndex);
    unknownIndex++;
  }
});
```

### ModelVisibilitySelector -- Asset+ API-modeller i listan

```typescript
// I fetchModelNames, nar Asset+ API svarar framgangsrikt:
if (response.ok) {
  const apiModels = await response.json();

  // Spara som dbModels sa att extractModels() inkluderar dem
  setDbModels(apiModels.map((m: any) => ({
    id: m.id || '',
    name: m.name || '',
    fileName: m.xktFileUrl
      ? extractModelIdFromUrl(m.xktFileUrl) + '.xkt'
      : (m.id || '')
  })));

  // Namn-mappning (redan existerande kod)
  const nameMap = new Map<string, string>();
  apiModels.forEach((m: any) => { ... });
  setModelNamesMap(nameMap);
}
```

---

## Implementationsordning

| Prio | Steg |
|------|------|
| 1 | Lazy rendering i ViewerRightPanel (prestanda) |
| 2 | Kollapserbara sektioner (Visa, RumsViz, Atgarder) |
| 3 | Vaningsnamn-fallback i FloorVisibilitySelector + FloatingFloorSwitcher |
| 4 | FloatingFloorSwitcher position + max pills |
| 5 | ModelVisibilitySelector -- visa alla modeller fran Asset+ API |

