
# Plan: Uppdatera Login-sidan till Engelska

## Sammanfattning
Ändra alla svenska texter på inloggningssidan till engelska, med titeln **"Welcome to Geminus"** istället för "Välkommen till AssetPlus".

## Ändringar

### Fil: `src/pages/Login.tsx`

| Element | Före | Efter |
|---------|------|-------|
| Titel (rad 72) | `Välkommen till AssetPlus` | `Welcome to Geminus` |
| Beskrivning (rad 74) | `Logga in för att få tillgång till byggnadsdata och 3D-modeller` | `Sign in to access building data and 3D models` |
| Knapptext (rad 106) | `Logga in med Google` | `Sign in with Google` |
| Villkorstext (rad 110) | `Genom att logga in godkänner du våra användarvillkor och integritetspolicy.` | `By signing in, you agree to our terms of service and privacy policy.` |
| Felmeddelande 1 (rad 47) | `Kunde inte logga in med Google` | `Could not sign in with Google` |
| Felmeddelande 2 (rad 55) | `Ett fel uppstod vid inloggning` | `An error occurred during sign-in` |

## Visuell förhandsvisning

```text
┌─────────────────────────────────────┐
│                                     │
│       Welcome to Geminus            │
│                                     │
│  Sign in to access building data    │
│  and 3D models                      │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  G  Sign in with Google       │  │
│  └───────────────────────────────┘  │
│                                     │
│  By signing in, you agree to our    │
│  terms of service and privacy       │
│  policy.                            │
│                                     │
└─────────────────────────────────────┘
```

## Teknisk implementation

Endast en fil behöver ändras:
- **`src/pages/Login.tsx`** - Byt ut 6 svenska textsträngar mot engelska

Inga nya beroenden eller komponenter krävs.
