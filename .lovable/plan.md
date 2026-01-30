
# Plan: Förbättra Mobil Inventering UI/UX

## Sammanfattning

Användaren har identifierat flera UI/UX-problem med den mobila inventeringsvyn:

1. **"Ny"-knappen** har en för "fet" lila bakgrund - vill ha bara plus-tecknet
2. **Spara-knappen** hamnar under iPhones browser-navigering och är svår att nå
3. **Färgglada emoji-ikoner** ser oprofessionella ut - ska ersättas med Lucide-ikoner
4. **Allt känns för stort** - behöver kompaktare layout

---

## Ändringar

### 1. "Ny"-knappen - Ta bort bakgrund

**Fil:** `src/components/inventory/mobile/MobileInventoryWizard.tsx`

Ändra knappstilen från solid bakgrund till ghost/minimal:

```tsx
// FÖRE (rad 315-323):
<Button
  variant={viewMode === 'wizard' ? 'default' : 'outline'}
  size="sm"
  onClick={() => setViewMode('wizard')}
  className="h-9"
>
  <Plus className="h-4 w-4 mr-1" />
  Ny
</Button>

// EFTER:
<Button
  variant="ghost"
  size="icon"
  onClick={() => setViewMode('wizard')}
  className={cn(
    "h-9 w-9",
    viewMode === 'wizard' && "bg-primary/10 text-primary"
  )}
>
  <Plus className="h-5 w-5" />
</Button>
```

### 2. Spara-knappen - Fixa iOS safe-area

**Problem:** Knappen hamnar under iPhones browser-navigering (home indicator, toolbar).

**Fil:** `src/components/inventory/mobile/QuickRegistrationStep.tsx`

Lägg till `pb-safe` (safe-area-inset-bottom) och minska storlek:

```tsx
// FÖRE (rad 339-362):
<div className="space-y-3 pt-4">
  <Button className="w-full h-14 text-lg">...</Button>
  <Button className="w-full h-12">...</Button>
</div>

// EFTER:
<div className="space-y-2 pt-3 pb-[env(safe-area-inset-bottom,0px)]">
  <Button className="w-full h-12 text-base">...</Button>
  <Button className="w-full h-10">...</Button>
</div>
```

Säkerställ också att `ScrollArea` har rätt padding i botten.

### 3. Ersätt Emoji-ikoner med Lucide-ikoner

**Fil:** `src/components/inventory/InventoryForm.tsx`

Ändra `INVENTORY_CATEGORIES` från emojis till Lucide-ikoner:

```tsx
// FÖRE:
export const INVENTORY_CATEGORIES = [
  { value: 'fire_extinguisher', label: 'Brandsläckare', icon: '🔥' },
  { value: 'fire_blanket', label: 'Brandfilt', icon: '🧯' },
  // ...
];

// EFTER:
import { Flame, Siren, Hose, DoorOpen, Radio, Droplets, 
         Fan, Lightbulb, Armchair, Monitor, Package } from 'lucide-react';

export const INVENTORY_CATEGORIES = [
  { value: 'fire_extinguisher', label: 'Brandsläckare', icon: Flame, color: 'text-red-500' },
  { value: 'fire_blanket', label: 'Brandfilt', icon: Siren, color: 'text-orange-500' },
  { value: 'fire_hose', label: 'Brandslang', icon: Hose, color: 'text-red-600' },
  { value: 'emergency_exit', label: 'Nödutgång', icon: DoorOpen, color: 'text-green-500' },
  { value: 'sensor', label: 'Sensor', icon: Radio, color: 'text-blue-500' },
  { value: 'sprinkler', label: 'Sprinkler', icon: Droplets, color: 'text-cyan-500' },
  { value: 'hvac_unit', label: 'Luftbehandling', icon: Fan, color: 'text-slate-500' },
  { value: 'lamp', label: 'Lampa', icon: Lightbulb, color: 'text-yellow-500' },
  { value: 'furniture', label: 'Möbel', icon: Armchair, color: 'text-amber-600' },
  { value: 'it_equipment', label: 'IT-utrustning', icon: Monitor, color: 'text-purple-500' },
  { value: 'other', label: 'Övrigt', icon: Package, color: 'text-gray-500' },
];
```

**Fil:** `src/components/inventory/mobile/CategorySelectionStep.tsx`

Uppdatera renderingen för att använda Lucide-komponenter:

```tsx
// FÖRE (rad 55):
<span className="text-3xl">{cat.icon}</span>

// EFTER:
const IconComponent = cat.icon;
<IconComponent className={cn("h-8 w-8", cat.color)} />
```

**Fil:** `src/components/inventory/mobile/MobileInventoryWizard.tsx`

Ersätt step-indicator emojis med Lucide-ikoner:

```tsx
// FÖRE (rad 266-272):
const steps = [
  { key: 'detection', label: '📍' },
  { key: 'location', label: '🏢' },
  { key: 'category', label: '📋' },
  { key: 'position', label: '🎯' },
  { key: 'registration', label: '✏️' },
];

// EFTER:
import { MapPin, Building2, LayoutGrid, Crosshair, FileEdit } from 'lucide-react';

const steps = [
  { key: 'detection', icon: MapPin },
  { key: 'location', icon: Building2 },
  { key: 'category', icon: LayoutGrid },
  { key: 'position', icon: Crosshair },
  { key: 'registration', icon: FileEdit },
];

// I renderingen:
const StepIcon = step.icon;
<StepIcon className="h-4 w-4" />
```

### 4. Kompaktare Layout

**Fil:** `src/components/inventory/mobile/MobileInventoryWizard.tsx`

- Minska header padding: `p-4` → `p-3`
- Minska step-indicator storlek: `w-8 h-8` → `w-7 h-7`
- Minska gap mellan element

**Fil:** `src/components/inventory/mobile/QuickRegistrationStep.tsx`

- Minska input-höjd: `h-14` → `h-12`
- Minska "Ta foto"-knappens höjd: `h-28` → `h-20`
- Minska space mellan sektioner: `space-y-5` → `space-y-4`

---

## Filer som Påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/components/inventory/InventoryForm.tsx` | Ersätt emoji med Lucide-ikoner i INVENTORY_CATEGORIES |
| `src/components/inventory/mobile/MobileInventoryWizard.tsx` | Minimal "Ny"-knapp, Lucide step-ikoner, kompaktare layout |
| `src/components/inventory/mobile/CategorySelectionStep.tsx` | Rendera Lucide-ikoner istället för emojis |
| `src/components/inventory/mobile/QuickRegistrationStep.tsx` | iOS safe-area, kompaktare knappar |

---

## Visuell Jämförelse

```text
FÖRE                              EFTER
┌─────────────────────────┐      ┌─────────────────────────┐
│ 📋 Inventering  [■ Ny] │      │ 📋 Inventering    [+]   │
├─────────────────────────┤      ├─────────────────────────┤
│ 📍 🏢 📋 🎯 ✏️         │      │ ○  ○  ●  ○  ○           │
├─────────────────────────┤      ├─────────────────────────┤
│                         │      │                         │
│ 🔥 Brandsläckare       │      │ [🔥] Brandsläckare      │
│ 🧯 Brandfilt           │      │ [⚠️] Brandfilt          │
│ 🚒 Brandslang          │      │ [💧] Brandslang         │
│                         │      │                         │
├─────────────────────────┤      ├─────────────────────────┤
│ [████ SPARA ████]      │      │ [   SPARA   ]           │
│ (dold under browser)   │      │ ← Synlig med safe-area  │
└─────────────────────────┘      └─────────────────────────┘
```

---

## Tekniska Detaljer

### iOS Safe Area

CSS-variabeln `env(safe-area-inset-bottom)` ger oss höjden på iPhones "home indicator" bar. Genom att lägga till denna som padding-bottom säkerställer vi att innehållet alltid är synligt.

```css
/* Tailwind custom utility (om det inte redan finns) */
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

Om Tailwind inte har denna utility inbyggd, kan vi använda inline style:
```tsx
style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
```

### Lucide-ikoner

Lucide React har ingen inbyggd `Hose`-ikon, så vi använder närmaste alternativ:
- `Hose` → `Droplet` eller custom
- `Siren` → `AlertTriangle` eller `Bell`

Om specifika ikoner saknas, använd generella alternativ från Lucide-biblioteket.

---

## Förväntade Resultat

1. **Minimal "Ny"-knapp** - Bara ett plus-tecken, inget "fett" bakgrund
2. **Synlig Spara-knapp** - Alltid ovanför iPhones browser-navigering
3. **Professionella ikoner** - Lucide-ikoner istället för emojis
4. **Kompaktare layout** - Mindre storlek på element, bättre utnyttjande av skärmutrymme
