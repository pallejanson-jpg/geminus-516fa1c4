

# Plan: Lägg till Rotation i Building Settings för alla byggnader

## Sammanfattning

Georeferering-inställningar (lat/lng och rotation) ska vara tillgängliga för **alla byggnader med Ivion Site ID**, inte bara via en separat Ivion-konfigurationsdialog. Användaren ska kunna konfigurera detta direkt i byggnadens Settings-panel på landing page.

## Nuläge

| Komponent | Vad finns | Vad saknas |
|-----------|-----------|------------|
| `FacilityLandingPage.tsx` | Latitude/Longitude via kart-picker | **Rotation-fält** |
| `GeoreferencingSettings.tsx` | Komplett (lat/lng/rotation) | Används bara i `IvionConnectionModal` |
| `useBuildingSettings.ts` | `updateRotation` metod finns | Används inte i FacilityLandingPage |

## Lösning

Lägg till rotation-slider i Building Settings-sektionen i `FacilityLandingPage`, så att alla byggnader kan konfigurera sin rotation för Split View-synkronisering.

## Ändring i FacilityLandingPage.tsx

### Steg 1: Lägg till state för rotation

```typescript
const [rotationInput, setRotationInput] = useState(0);
```

### Steg 2: Synka med settings

```typescript
React.useEffect(() => {
  // ... existing code for lat/lng
  if (settings?.rotation !== null && settings?.rotation !== undefined) {
    setRotationInput(settings.rotation);
  }
}, [/* ... */, settings?.rotation]);
```

### Steg 3: Lägg till UI efter Map Position-sektionen

```text
┌─────────────────────────────────────────────────┐
│ Building Settings                               │
├─────────────────────────────────────────────────┤
│ Ivion Site ID: [______________] [Save]          │
│ Show on Home Page: [★ In Favorites]             │
│                                                 │
│ ─────────────────────────────────────           │
│ 📍 Map Position                                 │
│ [Interactive Map Picker]                        │
│ 59.3303, 18.0601                    [Spara]     │
│                                                 │
│ ─────────────────────────────────────           │
│ 🔄 Rotation (för 3D/360° synk)         ← NY!    │
│ [=====●=========================] 45°           │
│ Byggnaden orientering relativt norr             │
│                                    [Spara]      │
│                                                 │
│ ─────────────────────────────────────           │
│ 🖼️ Hero Image                                   │
│ ...                                             │
└─────────────────────────────────────────────────┘
```

### Steg 4: Lägg till handler för att spara rotation

```typescript
const handleSaveRotation = async () => {
  await updateRotation(rotationInput);
  onSettingsChanged?.();
};
```

## Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/components/portfolio/FacilityLandingPage.tsx` | Lägg till rotation-slider och state |
| `src/hooks/useBuildingSettings.ts` | ✓ Redan klar - har `updateRotation` |

## Tekniska detaljer

### Slider-komponent (redan tillgänglig)

```typescript
import { Slider } from "@/components/ui/slider";

<Slider
  value={[rotationInput]}
  onValueChange={(values) => setRotationInput(values[0])}
  min={0}
  max={360}
  step={1}
/>
```

### Spara rotation

```typescript
// Använd befintlig updateRotation från useBuildingSettings hook
const { updateRotation } = useBuildingSettings(facility.fmGuid);
```

## Sekvensdiagram

```text
FacilityLandingPage
    │
    ├─ useBuildingSettings(fmGuid)
    │       ├─ settings.rotation → rotationInput state
    │       └─ updateRotation() → Supabase
    │
    └─ Building Settings UI
            ├─ Map Position (lat/lng)
            ├─ Rotation Slider ← NY!
            └─ Hero Image
```

## Acceptanskriterier

1. ✓ Rotation-slider visas i Building Settings för alla byggnader
2. ✓ Rotation-värdet laddas från databasen
3. ✓ Rotation sparas korrekt vid klick på "Spara"
4. ✓ Split View använder rätt rotation för koordinat-transformation
5. ✓ Befintlig GeoreferencingSettings i IvionConnectionModal fungerar fortfarande

