

# Plan: Swipe-stängning, localStorage och Transparenta Dialoger

## Sammanfattning

Förbättra 3D-visarens menyer med tre förbättringar:
1. Swipe-gest för att stänga panelen på mobil
2. Spara BIM-modell och våningsplansval i localStorage
3. Semi-transparenta dialoger så man ser 3D-modellen bakom

## Teknisk Implementation

### 1. Swipe-stängning (VisualizationToolbar)

Lägg till touch-events för att upptäcka nedåt-svep och stänga panelen.

**Logik:**
- `onTouchStart`: Spara startposition
- `onTouchMove`: Beräkna delta-Y
- `onTouchEnd`: Om delta > 80px nedåt, stäng panelen

```typescript
// Touch swipe state
const [touchStart, setTouchStart] = useState<number | null>(null);
const [touchDelta, setTouchDelta] = useState(0);

const handleTouchStart = (e: React.TouchEvent) => {
  setTouchStart(e.touches[0].clientY);
};

const handleTouchMove = (e: React.TouchEvent) => {
  if (!touchStart) return;
  const delta = e.touches[0].clientY - touchStart;
  setTouchDelta(Math.max(0, delta)); // Endast nedåt
};

const handleTouchEnd = () => {
  if (touchDelta > 80) {
    setIsOpen(false); // Stäng vid tillräckligt långt svep
  }
  setTouchStart(null);
  setTouchDelta(0);
};
```

**Visuell feedback:**
- Panelen rör sig nedåt med svepet (transform: translateY)
- Opacity minskar vid svep
- "Drag-handle" bar överst för att indikera att man kan svepa

### 2. localStorage för val

**Nyckelstruktur:**
- `viewer-visible-floors-{buildingFmGuid}`: Array av floor IDs
- `viewer-visible-models-{buildingFmGuid}`: Array av model IDs

**FloorVisibilitySelector.tsx:**
```typescript
// Ladda sparade val vid mount
useEffect(() => {
  if (!buildingFmGuid) return;
  const saved = localStorage.getItem(`viewer-visible-floors-${buildingFmGuid}`);
  if (saved) {
    try {
      const savedIds = JSON.parse(saved);
      setVisibleFloorIds(new Set(savedIds));
    } catch (e) {}
  }
}, [buildingFmGuid]);

// Spara vid ändring
useEffect(() => {
  if (!buildingFmGuid || !isInitialized) return;
  localStorage.setItem(
    `viewer-visible-floors-${buildingFmGuid}`,
    JSON.stringify(Array.from(visibleFloorIds))
  );
}, [visibleFloorIds, buildingFmGuid, isInitialized]);
```

**ModelVisibilitySelector.tsx:**
- Samma mönster med `viewer-visible-models-{buildingFmGuid}`

### 3. Transparenta Dialoger

**Ändra VisualizationToolbar-panelens styling:**

```typescript
// Från:
"fixed z-[60] bg-card border rounded-lg shadow-xl"

// Till:
"fixed z-[60] bg-card/80 backdrop-blur-md border rounded-lg shadow-xl"
```

**Fördelar:**
- 80% opacitet visar 3D-modellen bakom
- `backdrop-blur-md` ger en "frosted glass" effekt
- Fortfarande läsbart men man ser vad som händer

**Alternativ nivå för bättre synlighet av 3D:**
```typescript
"bg-card/70 backdrop-blur-sm"  // 70% + mindre blur = mer synlig 3D
```

## Filändringar

### VisualizationToolbar.tsx

1. **Touch swipe-handlers:**
   ```typescript
   // Nya state-variabler
   const [touchStart, setTouchStart] = useState<number | null>(null);
   const [touchDelta, setTouchDelta] = useState(0);
   
   // Touch event handlers för swipe-stängning
   const handleTouchStart = useCallback((e: React.TouchEvent) => {
     setTouchStart(e.touches[0].clientY);
   }, []);
   
   const handleTouchMove = useCallback((e: React.TouchEvent) => {
     if (!touchStart) return;
     const delta = e.touches[0].clientY - touchStart;
     setTouchDelta(Math.max(0, delta));
   }, [touchStart]);
   
   const handleTouchEnd = useCallback(() => {
     if (touchDelta > 80) {
       setIsOpen(false);
     }
     setTouchStart(null);
     setTouchDelta(0);
   }, [touchDelta]);
   ```

2. **Panel med transparens och swipe:**
   ```tsx
   <div
     className={cn(
       "fixed z-[60] border rounded-lg shadow-xl",
       // Transparens för att se 3D-modellen
       "bg-card/75 backdrop-blur-md",
       // Responsiv positionering
       "left-2 right-2 bottom-16 sm:inset-auto",
       "sm:w-80 md:w-96",
       isDragging && "cursor-grabbing opacity-90"
     )}
     style={{
       // Swipe transform på mobil
       transform: touchDelta > 0 ? `translateY(${touchDelta}px)` : undefined,
       opacity: touchDelta > 0 ? 1 - (touchDelta / 200) : undefined,
       // Desktop position
       ...(window.innerWidth >= 640 ? { left: position.x, top: position.y } : {})
     }}
     onTouchStart={handleTouchStart}
     onTouchMove={handleTouchMove}
     onTouchEnd={handleTouchEnd}
   >
     {/* Swipe-indikator bar (mobil) */}
     <div className="sm:hidden flex justify-center pt-2 pb-1">
       <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
     </div>
     
     {/* Header... */}
   </div>
   ```

### FloorVisibilitySelector.tsx

1. **localStorage-hook för att ladda sparade val:**
   ```typescript
   // Ladda sparade val från localStorage
   useEffect(() => {
     if (!buildingFmGuid) return;
     
     const storageKey = `viewer-visible-floors-${buildingFmGuid}`;
     const saved = localStorage.getItem(storageKey);
     
     if (saved) {
       try {
         const savedIds = JSON.parse(saved) as string[];
         if (Array.isArray(savedIds) && savedIds.length > 0) {
           console.debug("Restoring saved floor selection:", savedIds);
           setVisibleFloorIds(new Set(savedIds));
         }
       } catch (e) {
         console.debug("Failed to parse saved floor selection:", e);
       }
     }
   }, [buildingFmGuid]);
   ```

2. **Spara till localStorage vid ändring:**
   ```typescript
   // Spara val till localStorage
   useEffect(() => {
     if (!buildingFmGuid || !isInitialized || visibleFloorIds.size === 0) return;
     
     const storageKey = `viewer-visible-floors-${buildingFmGuid}`;
     localStorage.setItem(storageKey, JSON.stringify(Array.from(visibleFloorIds)));
   }, [visibleFloorIds, buildingFmGuid, isInitialized]);
   ```

### ModelVisibilitySelector.tsx

Samma mönster som FloorVisibilitySelector:

1. **Ladda sparade val:**
   ```typescript
   useEffect(() => {
     if (!buildingFmGuid) return;
     
     const storageKey = `viewer-visible-models-${buildingFmGuid}`;
     const saved = localStorage.getItem(storageKey);
     
     if (saved) {
       try {
         const savedIds = JSON.parse(saved) as string[];
         if (Array.isArray(savedIds) && savedIds.length > 0) {
           setVisibleModelIds(new Set(savedIds));
         }
       } catch (e) {}
     }
   }, [buildingFmGuid]);
   ```

2. **Spara vid ändring:**
   ```typescript
   useEffect(() => {
     if (!buildingFmGuid || !isInitialized || visibleModelIds.size === 0) return;
     
     localStorage.setItem(
       `viewer-visible-models-${buildingFmGuid}`,
       JSON.stringify(Array.from(visibleModelIds))
     );
   }, [visibleModelIds, buildingFmGuid, isInitialized]);
   ```

## Visuellt Resultat

### Före vs Efter

**Före:**
- Solid bakgrund blockerar vyn
- Ingen swipe-stängning
- Val försvinner vid sidladdning

**Efter:**
- Semi-transparent: ser 3D-modellen genom panelen
- Svep nedåt för snabb stängning
- Val bevaras mellan sessioner

### Transparens-nivåer (kan justeras)

| Nivå | CSS | Effekt |
|------|-----|--------|
| Lätt | `bg-card/85 backdrop-blur-sm` | Mest läsbart, lite genomskinlig |
| Medium | `bg-card/75 backdrop-blur-md` | Bra balans (rekommenderas) |
| Stark | `bg-card/60 backdrop-blur-lg` | Mest genomskinlig, kan vara svårläst |

## Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/VisualizationToolbar.tsx` | Swipe-stängning + transparens |
| `src/components/viewer/FloorVisibilitySelector.tsx` | localStorage för våningsval |
| `src/components/viewer/ModelVisibilitySelector.tsx` | localStorage för modellval |

## Förväntat Resultat

- Panelen är semi-transparent så man ser BIM-modellen bakom
- Svep nedåt på mobil stänger panelen snabbt
- Val av modeller och våningar sparas automatiskt per byggnad
- Frosted glass-effekt ger modern, snygg look

