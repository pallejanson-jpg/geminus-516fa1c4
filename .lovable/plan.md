
# Plan: Dynamisk höjd för rumsetiketter baserat på 2D/3D-läge

## Sammanfattning
Rumsetiketterna placeras nu på 1.2m ovanför golvet, vilket fungerar bra i 3D-läge. Men i 2D-läge (planvy) klipper scenens section plane vid denna höjd, vilket gör att etiketterna kan hamna utanför synfältet eller på fel nivå för en riktig planritning.

Lösning: Etiketterna ska automatiskt sänkas till golvnivå (t.ex. 0.1m ovanför golvet) när 2D-läget är aktivt.

---

## Teknisk lösning

### 1. Utöka useRoomLabels-hooken med vy-lägesmedvetenhet

**Fil: `src/hooks/useRoomLabels.ts`**

Lägg till:
- En ny ref `viewModeRef` som håller koll på om vi är i 2D eller 3D
- Uppdatera `createLabels()` för att använda olika Y-höjd beroende på läge
- Ny funktion `updateViewMode(mode: '2d' | '3d')` som återskapar etiketter med rätt höjd

```typescript
// Ny ref för att spåra vy-läge
const viewModeRef = useRef<'2d' | '3d'>('3d');

// I createLabels():
const labelHeight = viewModeRef.current === '2d' 
  ? aabb[1] + 0.1   // Golvnivå för 2D-planvy
  : aabb[1] + 1.2;  // 1.2m ovanför golv för 3D

const center = [
  (aabb[0] + aabb[3]) / 2,
  labelHeight,
  (aabb[2] + aabb[5]) / 2,
];

// Ny funktion att exportera
const updateViewMode = useCallback((mode: '2d' | '3d') => {
  if (viewModeRef.current === mode) return;
  viewModeRef.current = mode;
  
  if (enabledRef.current) {
    // Återskapa alla etiketter med ny höjd
    destroyLabels();
    createLabels();
  }
}, [createLabels, destroyLabels]);
```

### 2. Lyssna på VIEW_MODE_CHANGED_EVENT i AssetPlusViewer

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

Uppdatera:
- Hämta `updateViewMode` från useRoomLabels-hooken
- Lägg till en useEffect som lyssnar på `VIEW_MODE_CHANGED_EVENT`
- Anropa `updateViewMode()` när vy-läget ändras

```typescript
// Utöka destrukturering:
const { setLabelsEnabled: setRoomLabelsEnabled, updateViewMode: updateLabelsViewMode } = useRoomLabels(viewerInstanceRef);

// Ny useEffect:
useEffect(() => {
  const handleViewModeChange = (e: CustomEvent<ViewModeEventDetail>) => {
    console.log('Room labels: View mode changed to', e.detail.mode);
    updateLabelsViewMode?.(e.detail.mode);
  };
  
  window.addEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChange as EventListener);
  return () => {
    window.removeEventListener(VIEW_MODE_CHANGED_EVENT, handleViewModeChange as EventListener);
  };
}, [updateLabelsViewMode]);
```

---

## Sammanfattning av ändringar

| Fil | Ändring |
|-----|---------|
| `src/hooks/useRoomLabels.ts` | Lägg till `viewModeRef`, dynamisk höjdberäkning, och `updateViewMode()`-funktion |
| `src/components/viewer/AssetPlusViewer.tsx` | Lyssna på VIEW_MODE_CHANGED_EVENT och anropa `updateViewMode()` |

---

## Beteende efter implementation

| Läge | Etiketternas Y-position |
|------|------------------------|
| 3D (standard) | `aabb[1] + 1.2` (1.2m ovanför golvet) |
| 2D (planvy) | `aabb[1] + 0.1` (10cm ovanför golvet, nära golvplan) |

När användaren växlar mellan 2D och 3D kommer etiketterna automatiskt att återskapas på rätt höjd för respektive vy.

---

## Testning
1. Aktivera rumsetiketter i 3D-läge → verifiera att de sitter på 1.2m höjd
2. Byt till 2D-läge → verifiera att etiketterna nu ligger på golvnivå och syns i planytan
3. Byt tillbaka till 3D-läge → verifiera att etiketterna åter är på 1.2m höjd
