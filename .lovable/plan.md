
## Dölj obstruerande BIM-objekt i 2D-läge

### Problem

I 2D-läget (planlösningsvy) ligger ett grått/vitt objekt -- troligtvis ett `IfcSlab` (bjälklag/tak) från den bärande konstruktionsmodellen (Be-modell) -- ovanpå de gröna rumsytorna och blockerar interaktion. Koden som isolerar våningar (Solo-läge i FloorVisibilitySelector) döljer redan `IfcCovering`-objekt, men 2D-knappen i verktygsfältet gör det inte. Dessutom döljs inte `IfcSlab`, `IfcRoof` eller `IfcPlate` -- vilka alla typiskt täcker planlösningen ovanifrån.

### Lösning

Lägg till ett steg i 2D-togglen (ViewerToolbar) som döljer obstruerande IFC-typer och återställer dem vid byte tillbaka till 3D.

### IFC-typer att dölja i 2D

| IFC-typ | Beskrivning |
|---|---|
| `IfcSlab` | Bjälklag och takplattor |
| `IfcSlabStandardCase` | Variant av bjälklag |
| `IfcSlabElementedCase` | Variant av bjälklag |
| `IfcRoof` | Tak |
| `IfcCovering` | Ytbeklädnad (undertak etc.) |
| `IfcPlate` | Plattor/skivor |

### Teknisk implementation

**Fil: `src/components/viewer/ViewerToolbar.tsx`**

I `handleViewModeChange`, efter steg 2 (setNavMode) och före steg 3 (bounds/clipping), lägg till:

```text
// 2b. Hide obstructing IFC types in 2D plan view
const HIDDEN_2D_TYPES = new Set([
  'ifcslab', 'ifcslabstandardcase', 'ifcslabelementedcase',
  'ifcroof', 'ifccovering', 'ifcplate'
]);

const metaObjects = viewer.scene?.metaScene?.metaObjects || {};
const idsToHide: string[] = [];
Object.values(metaObjects).forEach((mo: any) => {
  if (HIDDEN_2D_TYPES.has(mo.type?.toLowerCase())) {
    idsToHide.push(mo.id);
  }
});
if (idsToHide.length > 0) {
  viewer.scene.setObjectsVisible(idsToHide, false);
  // Store IDs so we can restore them on 3D switch
  hiddenFor2dRef.current = idsToHide;
}
```

Vid byte tillbaka till 3D:

```text
// Restore objects hidden for 2D mode
if (hiddenFor2dRef.current.length > 0) {
  viewer.scene.setObjectsVisible(hiddenFor2dRef.current, true);
  hiddenFor2dRef.current = [];
}
```

En ny `useRef` (`hiddenFor2dRef`) spårar vilka objekt-ID:n som dolts, så att exakt samma objekt visas igen vid 3D-byte utan att påverka annan synlighetsstyrning.

### Filer som ändras

1. **`src/components/viewer/ViewerToolbar.tsx`** -- Lägg till döljning av obstruerande IFC-typer vid 2D och återställning vid 3D

### Förväntat resultat

- Bjälklag, tak och beklädnader döljs automatiskt vid 2D-vy
- De gröna rumsytorna blir fullt synliga och klickbara
- Vid byte tillbaka till 3D återställs alla dolda objekt
