
# Plan: Skapa dedikerad mobil 3D-vy (fullscreen)

## Översikt

Precis som för inventering (`MobileInventoryWizard` + `/ivion-inventory`) ska 3D-viewern ha en helt egen mobil sida som är fullscreen utan AppLayout-ramverket. Detta ger optimal touch-upplevelse utan sidebars, headers eller andra distraktioner.

## Nuvarande situation

```text
┌────────────────────────────────────────────┐
│  AppLayout (header + sidebar + content)    │
│  ┌──────────────────────────────────────┐  │
│  │  MainContent                         │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │  Viewer.tsx                    │  │  │
│  │  │  ┌──────────────────────────┐  │  │  │
│  │  │  │  AssetPlusViewer         │  │  │  │
│  │  │  │  + MobileViewerOverlay   │  │  │  │
│  │  │  └──────────────────────────┘  │  │  │
│  │  └────────────────────────────────┘  │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

**Problem**: På mobil är 3D-viewern fortfarande inbäddad i AppLayout med header, vilket tar värdefull skärmyta.

## Önskad lösning

```text
┌────────────────────────────────────────────┐
│  /viewer (dedikerad route utan AppLayout)  │
│  ┌──────────────────────────────────────┐  │
│  │  Mobile3DViewer (fullscreen)         │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │ ← Tillbaka-knapp (vänster)     │  │  │
│  │  ├────────────────────────────────┤  │  │
│  │  │                                │  │  │
│  │  │      AssetPlusViewer           │  │  │
│  │  │      (100vh, 100vw)            │  │  │
│  │  │                                │  │  │
│  │  ├────────────────────────────────┤  │  │
│  │  │  MobileViewerOverlay           │  │  │
│  │  │  (Floors, Spaces, Reset)       │  │  │
│  │  └────────────────────────────────┘  │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

---

## Steg 1: Skapa dedikerad mobil 3D-sida

### Ny fil: `src/pages/Mobile3DViewer.tsx`

Denna sida är en fristående fullscreen-vy som:
- Tar emot `building` (fmGuid) som URL-parameter eller state
- Visar AssetPlusViewer i fullscreen
- Har en tydlig tillbaka-knapp i övre vänstra hörnet
- Hanterar iOS safe-area insets

```text
Struktur:
┌─────────────────────────────────────┐
│ [←] Building Name          [🌲]    │  ← Header (semi-transparent gradient)
├─────────────────────────────────────┤
│                                     │
│                                     │
│         3D Viewer Canvas            │  ← 100% höjd/bredd
│                                     │
│                                     │
├─────────────────────────────────────┤
│ [Spaces]  [Floors]  [Reset]         │  ← MobileViewerOverlay (redan implementerad)
└─────────────────────────────────────┘
```

---

## Steg 2: Lägg till route i App.tsx

Lägg till en ny route för mobil 3D-vy utanför AppLayout:

```typescript
// Ny route (utanför AppLayout)
<Route 
  path="/viewer" 
  element={
    <Suspense fallback={<div>Loading...</div>}>
      <ProtectedRoute>
        <Mobile3DViewer />
      </ProtectedRoute>
    </Suspense>
  } 
/>
```

---

## Steg 3: Uppdatera MobileNav för att navigera till mobil-route

När användaren klickar på "3D Viewer" i mobil-menyn ska de navigeras till `/viewer` med vald byggnad:

```typescript
// I MobileNav.tsx
const handleViewer3dClick = () => {
  navigate('/viewer');
  setIsMobileMenuOpen(false);
};
```

---

## Steg 4: Skapa mobil byggnadväljare

Om ingen byggnad är vald ska sidan visa en enkel byggnadväljare med touch-optimerade kort:

```text
┌─────────────────────────────────────┐
│ [←] 3D Viewer                       │
├─────────────────────────────────────┤
│                                     │
│  Välj en byggnad                    │
│                                     │
│  ┌─────────┐  ┌─────────┐          │
│  │ 🏢      │  │ 🏢      │          │
│  │ Hus A   │  │ Hus B   │          │
│  │ 5 vån   │  │ 3 vån   │          │
│  └─────────┘  └─────────┘          │
│                                     │
│  ┌─────────┐  ┌─────────┐          │
│  │ 🏢      │  │ 🏢      │          │
│  │ Hus C   │  │ Hus D   │          │
│  │ 8 vån   │  │ 2 vån   │          │
│  └─────────┘  └─────────┘          │
│                                     │
└─────────────────────────────────────┘
```

---

## Steg 5: Hantera tillbaka-navigation

Tillbaka-knappen ska:
1. Om man kom från inventering (`/inventory`) → återvänd dit
2. Om man kom från Navigator → återvänd till Navigator
3. Standard: återvänd till startsidan (`/`)

Implementeras med `useNavigate` och `location.state`:

```typescript
const handleClose = () => {
  // Om vi har history, gå tillbaka
  if (window.history.length > 1) {
    navigate(-1);
  } else {
    navigate('/');
  }
};
```

---

## Tekniska detaljer

### Filer som skapas/ändras

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `src/pages/Mobile3DViewer.tsx` | **Ny fil** | Fullscreen mobil 3D-vy |
| `src/App.tsx` | Ändra | Lägg till `/viewer` route utanför AppLayout |
| `src/components/layout/MobileNav.tsx` | Ändra | Navigera till `/viewer` istället för att sätta `activeApp` |

### Komponentstruktur

```typescript
// Mobile3DViewer.tsx
const Mobile3DViewer: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { allData } = useContext(AppContext);
  
  const [selectedBuildingFmGuid, setSelectedBuildingFmGuid] = useState<string | null>(
    searchParams.get('building') || null
  );
  
  // Visa byggnadväljare om ingen byggnad vald
  if (!selectedBuildingFmGuid) {
    return <MobileBuildingSelector onSelect={setSelectedBuildingFmGuid} onClose={() => navigate(-1)} />;
  }
  
  // Visa fullscreen 3D-vy
  return (
    <div className="h-screen w-screen relative bg-background">
      <AssetPlusViewer 
        fmGuid={selectedBuildingFmGuid} 
        onClose={() => navigate(-1)} 
      />
    </div>
  );
};
```

### iOS Safe Area Support

```css
/* Tillbaka-knappen respekterar iOS-notch */
.mobile-viewer-back-button {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 0.5rem);
  left: calc(env(safe-area-inset-left, 0px) + 0.5rem);
  z-index: 50;
}
```

---

## Förväntad användarupplevelse

### Flöde 1: Från mobilmenyn
1. Användare öppnar hamburgermenyn
2. Klickar på "3D Viewer"
3. Navigeras till `/viewer`
4. Ser fullscreen byggnadväljare
5. Väljer byggnad → 3D-vy laddas i fullscreen
6. Klickar tillbaka → återvänder till startsidan

### Flöde 2: Från Navigator/Portfolio
1. Användare navigerar till en byggnad i Navigator
2. Klickar "Visa i 3D"
3. Navigeras till `/viewer?building={fmGuid}`
4. 3D-vy laddas direkt i fullscreen (ingen byggnadväljare)
5. Klickar tillbaka → återvänder till Navigator

### Flöde 3: Från inventering
1. Användare är i mobil inventering
2. Klickar "Välj position i 3D"
3. Navigeras till `/viewer?building={fmGuid}&pickMode=true`
4. Kan välja position
5. Bekräftar → återvänder till inventering med koordinater

---

## Sammanfattning

| Aspekt | Lösning |
|--------|---------|
| Fullscreen | Egen route `/viewer` utanför AppLayout |
| Tillbaka-knapp | Prominent knapp övre vänstra hörnet |
| Byggnadval | Dedikerad mobil byggnadväljare |
| iOS-stöd | Safe area insets för notch/home indicator |
| Navigation | Stöd för djuplänkning och history-navigation |
| Befintlig mobil-overlay | Återanvänds (MobileViewerOverlay) |
