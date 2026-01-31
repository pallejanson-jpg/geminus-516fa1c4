
# Lägg till AI Skanning-knapp i MobileNav

## Sammanfattning

AI Skanning-knappen finns för närvarande endast inne i Inventering-vyn (`MobileInventoryWizard`), vilket gör den svår att hitta på mobil. Planen är att lägga till en **direkt genväg** till AI Skanning i mobilnavigeringsmenyn (`MobileNav`).

## Nuvarande flöde (problematiskt)

| Steg | Åtgärd |
|------|--------|
| 1 | Öppna hamburgermenyn |
| 2 | Klicka "Inventering" |
| 3 | Klicka Scan-ikonen i headern |
| 4 | Kommer till AI Skanning |

## Nytt flöde (förenklat)

| Steg | Åtgärd |
|------|--------|
| 1 | Öppna hamburgermenyn |
| 2 | Klicka "AI Skanning" |
| 3 | Kommer direkt till AI Skanning |

## Planerad ändring

### Fil: `src/components/layout/MobileNav.tsx`

| Ändring | Beskrivning |
|---------|-------------|
| Importera `Scan` ikon | Lägg till `Scan` från lucide-react |
| Importera `useNavigate` | För att navigera till `/inventory/ai-scan` |
| Lägg till AI Skanning-knapp | Ny knapp i andra raden med Scan-ikon |

**Kod-förändring:**

```tsx
// Lägg till imports
import { useNavigate } from 'react-router-dom';
import { Box, LayoutGrid, Globe, Network, Cuboid, Home, X, ClipboardList, Scan } from 'lucide-react';

// Inne i komponenten
const navigate = useNavigate();

// I andra raden av grid (rad 85-118), lägg till efter Inventering:
<AppButton 
    onClick={() => {
        navigate('/inventory/ai-scan');
        setIsMobileMenuOpen(false);
    }} 
    variant="ghost" 
    className="flex-col !h-auto !w-auto !p-2 text-primary"
>
    <Scan size={22} />
    <span className="text-[10px] mt-1">AI Skanning</span>
</AppButton>
```

## Visuell förändring

**Före:**
```
Row 1: [Home] [Portfolio] [Navigator] [Map]
Row 2: [3D Viewer] [Inventering] [Extra1] [Extra2]
```

**Efter:**
```
Row 1: [Home] [Portfolio] [Navigator] [Map]
Row 2: [3D Viewer] [Inventering] [AI Skanning] [Extra1]
```

## Fördelar

- **Snabbare åtkomst**: Direkt genväg till AI Skanning från mobilmenyn
- **Enklare för automatiska tester**: Testerna kan hitta "AI Skanning" direkt i hamburgermenyn
- **Konsistent UX**: Alla huvudfunktioner tillgängliga på ett ställe
