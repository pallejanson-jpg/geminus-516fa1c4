

# Plan: Tre ändringar — ModelVisibilitySelector refaktorering, Tillbakaknapp, och Enhetlig viewer-start

## 1. Refaktorera ModelVisibilitySelector

`ModelVisibilitySelector.tsx` har 140 rader intern logik (rad 92-233) som hämtar modellnamn från databasen och Asset+ API. Exakt samma logik finns redan i den delade hooken `useModelNames.ts`. Refaktoreringen tar bort den duplicerade koden.

**Ändringar i `ModelVisibilitySelector.tsx`:**
- Ta bort den interna `fetchModelNames`-effekten (rad 92-233)
- Ta bort `isLoadingNames` och `modelNamesMap` state
- Importera `useModelNames` från `@/hooks/useModelNames`
- Använda hookens `modelNamesMap` och `isLoading` istället
- `dbModels`-state behålls men populeras från hookens data istället

---

## 2. Fixa Tillbakaknappen i Split Screen / Virtual Twin

**Problem:** `handleGoBack` använder `navigate(-1)` (webbläsarens historik-back). Om man gjort navigeringar inuti viewern (t.ex. klickat runt i 360-panelen) så backar den inom viewern istället för att ta dig tillbaka till appen.

**Lösning:** Ersätt `navigate(-1)` med `navigate('/')` som alltid tar användaren tillbaka till appens huvudvy (portfolio).

**Ändring i `UnifiedViewer.tsx`:**
```
// Nuvarande:
const handleGoBack = useCallback(() => navigate(-1), [navigate]);

// Nytt:
const handleGoBack = useCallback(() => navigate('/'), [navigate]);
```

---

## 3. Enhetlig viewer-start med gemensam toggle

**Nuvarande situation:**
- **3D-knappen** öppnar viewern *inuti* appen (`setActiveApp('assetplus_viewer')`) — ingen route-ändring, renderas i AppLayout
- **Split/VT-knapparna** navigerar till *separata routes* (`/split-viewer`, `/virtual-twin`) — UnifiedViewer med mode-toggle
- **360-knappen** öppnar en helt separat in-app-vy (radar)

Dessa tre olika startmetoder gör att användaren inte kan toggla fritt mellan alla lägen.

**Ny design:**
- **"3D"-knappen** i QuickActions navigerar till `/split-viewer?building=...` (som redan har UnifiedViewer med alla modes) men med `&mode=3d` som query-param så att 3D blir förvalt
- **"360"-knappen** navigerar till `/split-viewer?building=...&mode=360` så att 360 blir förvalt
- **Split/VT** fortsätter som idag men via samma route

Alla lägen delar sedan samma toggle: **3D | Split | VT | 360**

**Ändringar:**

### `UnifiedViewer.tsx`
- Läs `mode` query-param som `initialMode` om ingen prop skickats:
  ```
  const modeParam = searchParams.get('mode') as ViewMode | null;
  const effectiveInitialMode = initialMode !== 'vt' ? initialMode : (modeParam || '3d');
  ```

### `QuickActions.tsx`
- **3D-knapp:** Ändra `onToggle3D(facility)` till `navigate('/split-viewer?building=...&mode=3d')`
- **360-knapp:** Ändra `onOpen360(ivionSiteId)` till `navigate('/split-viewer?building=...&mode=360')`
- **Split-knapp:** Behåll som den är (redan korrekt)
- **VT-knapp:** Ändra till `navigate('/split-viewer?building=...&mode=vt')`
- Ta bort separata knappar som kräver Ivion; alla lägen är tillgängliga via toggle och disablas automatiskt i UnifiedViewer om Ivion saknas

### `FacilityCard.tsx` och `FacilityLandingPage.tsx`
- Uppdatera `navigate('/split-viewer?building=...')` till att inkludera `&mode=split` för tydlighet

### `AppHeader.tsx`
- Ändra 3D-menyknappen: istället för `setActiveApp('assetplus_viewer')`, navigera till `/split-viewer?mode=3d` (utan building — UnifiedViewer visar byggväljare om building saknas)

### `SplitViewer.tsx` och `VirtualTwin.tsx`
- Dessa wrapper-sidor kan behållas för bakåtkompatibilitet men deras routes (`/split-viewer`, `/virtual-twin`) används med `mode`-param nu

---

## Sammanfattning av filändringar

```
Ändrade filer:
  src/components/viewer/ModelVisibilitySelector.tsx
    - Ersätt intern fetchModelNames med useModelNames-hook (~140 rader borttagna)

  src/pages/UnifiedViewer.tsx
    - handleGoBack: navigate('/') istället för navigate(-1)
    - Läs mode-query-param för initialMode

  src/components/portfolio/QuickActions.tsx
    - 3D/360/VT-knappar navigerar till /split-viewer?building=...&mode=X

  src/components/portfolio/FacilityCard.tsx
    - Lägg till &mode=split i URL

  src/components/portfolio/FacilityLandingPage.tsx
    - Lägg till &mode=split i URL

  src/components/layout/AppHeader.tsx
    - 3D-menyknappen navigerar till /split-viewer?mode=3d
```

## Förväntade resultat

- **ModelVisibilitySelector** delar namnlogik med mobil via samma hook — ett ställe att underhålla
- **Tillbakaknappen** tar alltid tillbaka till appen, oavsett vad man gjort i viewern
- **Alla viewer-lägen** startar via samma UnifiedViewer med gemensam toggle (3D/Split/VT/360) och rätt förvalt läge
