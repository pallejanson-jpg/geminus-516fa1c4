

# Mobiloptimering: 3D-viewer, Header och 360-vy

## Sammanfattning

Tre separata problem ska fixas:

1. **3D-viewern fungerar inte i AppLayout pa mobil** -- Pa desktop renderas den inuti AppLayout med header/sidebars. Pa mobil tar headern onodig plats och touch-interaktion med 3D:n fungerar daligt. Losningen: omdirigera till fullskarmssidan `/viewer` pa mobil.

2. **Headern tar onodig skarmyta pa mobil** -- AppHeader (56px) visas alltid, aven i fullskarmsappar (3D, 360, karta). Pa mobil ska headern doljas for dessa appar och ersattas av en tillbaka-knapp som overlay.

3. **360-vyn "flyter" och Ivion-komponenter ar for stora** -- Sidans overflow ar inte lastad, och Ivions sidebar visas trots att vi forsaker dolja den. Behover mer aggressiv dolning och stabilisering.

---

## Steg 1: Omdirigera 3D-viewer till fullskarm pa mobil

**Fil:** `src/components/layout/AppHeader.tsx`

Nar `isMobile` ar true och anvandaren klickar "3D Viewer"-knappen, navigera till `/viewer` istallet for att satta `setActiveApp('assetplus_viewer')`. MobileNav gor redan detta korrekt -- den anvander `navigate('/viewer')`.

**Andring:**
- I `viewButtons`-arrayen (rad 111-116), lagg till en `mobileRoute`-egenskap for `assetplus_viewer`
- I `handleMenuClick`, kontrollera `isMobile` och om knappen har `mobileRoute`, anvand `navigate()` istallet for `setActiveApp()`

---

## Steg 2: Dolj header pa mobil for "immersive" appar

**Fil:** `src/components/layout/AppLayout.tsx`

Definiera en lista av "immersive" appar som ska dolja headern pa mobil: `assetplus_viewer`, `viewer`, `radar`, `map`.

Nar `isMobile && activeApp` ar en immersive app:
- Dolj `AppHeader`, `SyncProgressBanner`, `DataConsistencyBanner`
- Dolj `LeftSidebar` och `RightSidebar`
- Lat `MainContent` fylla hela skarmen

Varje immersive app-komponent har redan sina egna tillbaka-knappar (MobileViewerOverlay for 3D, back-overlay for 360).

**Fil:** `src/context/AppContext.tsx` (las activeApp)

AppLayout behover lasa `activeApp` fran context -- den gor det redan via att importera och anvanda `useContext(AppContext)` indirekt via barnen, men sjalva `AppLayoutInner` lser inte context. Behover lagga till `useContext(AppContext)` for att lasa `activeApp`.

---

## Steg 3: Stabilisera 360-vyn pa mobil

**Fil:** `src/components/viewer/Ivion360View.tsx`

- Pa mobil: lagg till `overflow-hidden` och `style={{ touchAction: 'none' }}` pa rot-containern (rad 389) for att forhindra sidans scrollning
- Oka postMessage-retry for `setSidebarVisibility`: skicka meddelandet tre ganger med 1s, 3s, 5s fordrojning istallet for bara en gang vid 3s

**Fil:** `src/pages/Mobile360Viewer.tsx`

- Lagg till `style={{ touchAction: 'none' }}` pa rot-containern (redan `overflow-hidden` -- bra)
- Sakerstall att hela sidan ar lastad med `position: fixed` for att undvika iOS-studs

---

## Steg 4: Minimera Ivion UI-element pa mobil

**Fil:** `src/components/viewer/Ivion360View.tsx`

**SDK-lage (api ar tillgangligt):**
Nar SDK ar `ready` och `isMobile`:
- Forsok anropa `api.getMenuItems()` och satta `isVisible = () => false` for varje item
- Forsok anropa `api.closeMenu?.()` eller liknande for att dolja sidebaren

**Iframe-lage:**
- Skicka `setSidebarVisibility` med fler retries (1s, 3s, 5s, 8s)
- Skicka postMessage for att dolja eventuella andra UI-element om mojligt

**Fil:** `src/lib/ivion-sdk.ts`

Utoka `IvionApi`-interfacet med:
- `getMenuItems?: () => any[]` -- for att hamta och manipulera sidebar-poster
- `closeMenu?: () => void` -- for att stanga sidebaren programmatiskt

**Begransningar:**
- Floor changer-widgeten och sokrutan kan inte doljas programmatiskt -- de maste konfigureras i NavVis IVION Site Configuration av en admin
- Rekommendation till anvandaren: ga till IVION admin-panelen och avmarkera "Floor changer widget" och "Search box" under Site Configuration

---

## Sammanfattning av filandringar

| Fil | Andring |
|-----|---------|
| `src/components/layout/AppLayout.tsx` | Dolj header/sidebars pa mobil for immersive appar |
| `src/components/layout/AppHeader.tsx` | Omdirigera till `/viewer` pa mobil for 3D-knappen |
| `src/components/viewer/Ivion360View.tsx` | Touch-fix, fler postMessage-retries, SDK sidebar-dolning |
| `src/lib/ivion-sdk.ts` | Utoka IvionApi-typer med getMenuItems/closeMenu |
| `src/pages/Mobile360Viewer.tsx` | Sakerstall touch-action och position-fixed |

---

## Tekniska detaljer

### Immersive app-lista
```text
const IMMERSIVE_APPS = ['assetplus_viewer', 'viewer', 'radar', 'map'];
```

### AppLayout conditional rendering (pseudokod)
```text
const isImmersive = isMobile && IMMERSIVE_APPS.includes(activeApp);

return (
  <div>
    {!isImmersive && <LeftSidebar />}
    <div>
      {!isImmersive && <AppHeader ... />}
      {!isImmersive && <SyncProgressBanner />}
      {!isImmersive && <DataConsistencyBanner />}
      <MainContent />
    </div>
    {!isImmersive && <RightSidebar />}
    ...
  </div>
);
```

### PostMessage retry-strategi
```text
const RETRY_DELAYS = [1000, 3000, 5000, 8000];
RETRY_DELAYS.forEach(delay => {
  setTimeout(() => {
    iframeRef.current?.contentWindow?.postMessage({
      command: 'setSidebarVisibility',
      params: { visible: false }
    }, '*');
  }, delay);
});
```

### Risker och begransningar

- **Floor changer och sokruta** kan inte doljas via API -- kraver NavVis admin-andring
- **Kartvyn (MapView)** pa mobil ar redan relativt fullskarm men kan gynnas av att headern doljs
- **Tillbaka-navigering** -- varje immersive vy behover sin egen tillbaka-knapp. 3D har `MobileViewerOverlay`, 360 har back-overlay, men kartvyn kan behova en tillagd tillbaka-knapp
- **Steg 1 (omdirigering)** gor att 3D pa mobil aldrig renderas i AppLayout, sa Steg 2 paverkar framsfor allt 360 och karta

