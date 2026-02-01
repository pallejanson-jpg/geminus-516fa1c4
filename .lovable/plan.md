

# Plan: Flytta onboarding till användarmenyn

## Översikt

Ta bort den automatiska onboarding-redirecten efter inloggning och lägg istället till ett menyval "Starta introduktion" i användarmenyn (dropdown i headern).

---

## Ändringar

### 1. Ta bort automatisk redirect i ProtectedRoute

**Fil:** `src/components/auth/ProtectedRoute.tsx`

**Ändring:** Ta bort hela onboarding-kontrollen och redirecten

```tsx
// TA BORT: Rad 15-16 (state för onboarding)
const [onboardingChecked, setOnboardingChecked] = useState(false);
const [needsOnboarding, setNeedsOnboarding] = useState(false);

// TA BORT: Rad 18-58 (hela useEffect för onboarding-kontroll)

// TA BORT: Rad 82-85 (onboarding redirect)
if (needsOnboarding && location.pathname !== '/onboarding') {
  return <Navigate to="/onboarding" replace />;
}

// FÖRENKLAD loading-kontroll (behöver inte vänta på onboardingChecked)
if (isLoading) { ... }
```

---

### 2. Lägg till onboarding-länk i användarmenyn

**Fil:** `src/components/layout/AppHeader.tsx`

**Ändring:** Lägg till menyval för att starta introduktionen

```tsx
// Importera Sparkles-ikonen
import { ..., Sparkles } from 'lucide-react';

// I DropdownMenuContent, efter "Inställningar" och före separator:
<DropdownMenuItem onClick={() => navigate('/onboarding')}>
  <Sparkles className="mr-2 h-4 w-4" />
  Starta introduktion
</DropdownMenuItem>
<DropdownMenuSeparator />
```

---

## Resultat

### Före (nuvarande flöde):
```
Inloggning → Automatisk redirect till /onboarding → Landningssida
```

### Efter (nytt flöde):
```
Inloggning → Landningssida (direkt)
                   ↓
           Användarmeny → "Starta introduktion" (valfritt)
```

### Användarmeny efter ändring:
```
┌─────────────────────────────┐
│ Anders Andersson     Admin  │
│ anders@example.com          │
├─────────────────────────────┤
│ 👤 Profil                   │
│ ⚙️ Inställningar            │
│ ✨ Starta introduktion      │  ← NY
├─────────────────────────────┤
│ 🚪 Logga ut                 │
└─────────────────────────────┘
```

---

## Tekniska noteringar

1. **Onboarding-sidan förblir skyddad** - Den finns kvar på `/onboarding` och kräver inloggning via ProtectedRoute

2. **Skip-funktionen behålls** - Användare kan fortfarande hoppa över onboarding om de startar den

3. **Ingen databasändring krävs** - Vi tar bara bort redirecten, inte funktionaliteten

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/auth/ProtectedRoute.tsx` | Ta bort onboarding-kontroll och redirect |
| `src/components/layout/AppHeader.tsx` | Lägg till "Starta introduktion" i användarmenyn |

