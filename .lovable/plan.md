

# Plan: Mobiloptimering av alla skärmar

## Sammanfattning av problem

Efter en grundlig genomgång av kodbasen har jag identifierat följande mobilrelaterade problem:

---

## 1. Egenskapsdialogen (UniversalPropertiesDialog) - Mobilt problem

**Nuläge:** Dialogen använder redan `Sheet` (bottom drawer) på mobil via `useIsMobile()`. Problemet är troligen att SheetContent har `h-[85vh]` men att innehållet (sektioner, sökfält, fotobar) inte anpassas tillräckligt för mindre skärmar.

**Problem:**
- Header med kategori-badge och titel kan bli trång
- Sökfältet tar plats som kunde vara dold initialt
- Sektionerna öppnas automatiskt (`system`, `local`, `area`) och fyller snabbt skärmen
- FM GUID och långa strängar kan bryta ut ur sin container
- Footer-knappar (Edit/Save) kan hamna under safe-area på iOS

**Fix:**
- Justera SheetContent till `h-[90vh]` med `pb-safe` (iOS safe area)
- Stäng alla sektioner som standard på mobil (bara visa Local öppen)
- Gör sökfältet kompaktare (h-8 istället för h-9)
- Lägg till `overflow-hidden` och `truncate` på FM GUID-fältet
- Lägg till iOS safe-area padding på footer

---

## 2. 360+ (Ivion360View) - Mobilt problem

**Nuläge:** 360-vyn renderas inuti `MainContent` via `activeApp === 'radar'` med AppHeader och sidebars fortfarande synliga. På mobil tar headern och menyrad onödig plats.

**Problem:**
- Ivion-toolbaren (rad 264) tar plats med text och knappar
- Ivion-iframen delas med AppHeader, vilket minskar visningsytan
- Ivion har sin egen sidebar/meny som tar ytterligare plats

**Fix - Två delar:**

**a) Ivion URL-parameter för att dölja UI:**
NavVis IVION stöder URL-parametrar som kan minimera sidomenyn. Vi kan lägga till `&kiosk=true` eller använda deras Frontend API via postMessage för att skicka `hideMenu`-kommandon. Dock har detta inte dokumenterats exakt - vi bör testa parametern `&sidebar=false` och om det inte fungerar, skicka ett `postMessage` med `{ command: 'setSidebarVisibility', params: { visible: false } }` efter iframe-load.

**b) Fullskärmsläge på mobil:**
- När 360-vyn öppnas på mobil, byt till en dedikerad fullskärmsroute (`/360-viewer`) istället för att renderas inuti AppLayout
- Alternativt: på mobil, dölj AppHeader och visa bara en tillbaka-knapp som overlay (likt Mobile3DViewer)

**Implementering:**
- Skapa ny sida `src/pages/Mobile360Viewer.tsx` som wrapper för Ivion360View med fullskärmslayout
- På mobil, navigera dit istället för att sätta `activeApp = 'radar'`
- Förenklad toolbar: bara tillbaka-knapp, registrera-knapp, extern länk
- Skicka `postMessage` efter iframe-load för att minimera Ivion-menyn

---

## 3. 3D Viewer - Fungerar inte på mobil

**Nuläge:** Det finns redan en dedikerad `Mobile3DViewer` (route `/viewer`) och `MobileViewerOverlay` komponent. Men det verkar som att viewern inte fungerar alls på mobil.

**Troliga orsaker:**
- `AssetPlusViewer` (3034 rader) förlitar sig på den externa `assetplusviewer.umd.min.js` biblioteket. Detta bibliotek kanske kräver WebGL-funktioner som inte är tillgängliga eller har prestandaproblem på mobil
- Viewerns CSS klass `dx-device-desktop` (rad 2731) tvingar desktop-läge
- Container-elementets `display: flex; flex: 1 0 auto` kan orsaka layoutproblem i en `h-screen` container på mobil
- `MobileViewerOverlay` renderas korrekt men viewern själv kraschar/fastnar

**Fix:**
- Byt `dx-device-desktop` till `dx-device-mobile` när `isMobile` är true
- Lägg till `touch-action: none` på viewer-container för att förhindra browser-zoom
- Säkerställ att viewern i `Mobile3DViewer` inte har dubbla close-knappar (en i Mobile3DViewer och en i MobileViewerOverlay)
- Reducera NavCube-storlek ytterligare på mobil (50px istället för 60px)
- Lägg till en timeout med felmeddelande om viewern inte initialiseras inom 15 sekunder

---

## 4. Split Screen - Fungerar inte på mobil

**Nuläge:** `SplitViewer.tsx` använder `ResizablePanelGroup direction="horizontal"` med `ResizableHandle withHandle`. På mobil ger detta två extremt smala paneler sida vid sida - oanvändbart.

**Fix:**
- På mobil: Byt till vertikal stacking (`direction="vertical"`) med en tab-switcher
- Alternativt: visa bara EN vy i taget med en toggle-knapp för att byta mellan 3D och 360
- Header-knapparna (sync toggle, manual sync, fullscreen) konsolideras till en kompakt rad

**Implementering:**
- Detektera `isMobile` i `SplitViewerContent`
- På mobil: rendera en tab-baserad layout med "3D" och "360°" flikar
- Aktiv vy tar 100% av höjden
- Sync-status visas som en kompakt badge i header
- Header förenklas: tillbaka-knapp + byggnad + sync-toggle + vy-switch

---

## 5. FloatingRoomCard - Fast position på mobil

**Problem:** Kortet använder `fixed` positioning med pixelvärden och kan flyta ut ur skärmens visningsyta.

**Fix:**
- På mobil: fasta kortet till botten av skärmen (`fixed bottom-0 left-0 right-0`) istället för fri positionering
- Ta bort drag-funktionalitet på mobil
- Gör kortet till en kompakt "bottom sheet" med swipe-to-dismiss

---

## 6. Generella mobila förbättringar

### a) AppHeader - Kompaktare på mobil
- Dölj desktop-navigeringsfliken (Portfolio, Map, 3D) helt - ersätts av MobileNav
- Sökfältet collapsas till en sök-ikon som expanderar vid klick
- User-avatar och settings-knapp kompaktare (h-8 w-8)

### b) PortfolioView / FacilityLandingPage
- QuickActions grid redan responsivt (`grid-cols-3 sm:grid-cols-4`)
- Verifiera att KPI-kort inte bryter ut
- Scroll-indikatorer för horisontell scroll

### c) NavigatorView
- Redan optimerad enligt minne, men verifiera att VirtualTree fungerar korrekt med touch

### d) MapView
- Verifiera att kartan fungerar med touch-events
- Popup-kort ska inte överlappa kartkontroller

---

## Implementationsordning

| Prio | Skärm | Åtgärd | Fil(er) |
|------|-------|--------|---------|
| 1 | 3D Viewer | Fixa dx-device-klass, touch-action, layout | `AssetPlusViewer.tsx`, `Mobile3DViewer.tsx` |
| 2 | Split Screen | Tab-baserat läge på mobil | `SplitViewer.tsx` |
| 3 | 360+ | Fullskärms mobile route | Ny `Mobile360Viewer.tsx`, `MainContent.tsx` |
| 4 | Egenskaper | iOS safe-area, kompaktare layout | `UniversalPropertiesDialog.tsx` |
| 5 | FloatingRoomCard | Fixed bottom-sheet på mobil | `FloatingRoomCard.tsx` |
| 6 | Generellt | AppHeader, MobileNav polish | `AppHeader.tsx` |

---

## Tekniska detaljer

### 3D Viewer - Device class fix

```typescript
// I AssetPlusViewer.tsx rad 2731
// Nuvarande:
className="... dx-device-desktop dx-device-generic ..."
// Nytt:
className={`... ${isMobile ? 'dx-device-mobile dx-device-generic' : 'dx-device-desktop dx-device-generic'} ...`}
```

### 3D Viewer - Touch-action

```css
/* I index.css */
#AssetPlusViewer {
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
}
```

### Split Screen - Mobilt tab-läge

```typescript
// I SplitViewer.tsx
const isMobile = useIsMobile();
const [activePanel, setActivePanel] = useState<'3d' | '360'>('3d');

if (isMobile) {
  return (
    <div className="h-screen flex flex-col">
      {/* Kompakt header med vy-switch */}
      <div className="flex items-center p-2 border-b">
        <Button size="sm" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 flex justify-center gap-1">
          <Button 
            size="sm" 
            variant={activePanel === '3d' ? 'default' : 'outline'}
            onClick={() => setActivePanel('3d')}
          >
            3D
          </Button>
          <Button 
            size="sm" 
            variant={activePanel === '360' ? 'default' : 'outline'}
            onClick={() => setActivePanel('360')}
          >
            360deg
          </Button>
        </div>
        {/* Sync toggle */}
      </div>
      {/* Aktiv vy */}
      <div className="flex-1 min-h-0">
        {activePanel === '3d' ? (
          <AssetPlusViewer ... />
        ) : (
          <Ivion360View ... />
        )}
      </div>
    </div>
  );
}
```

### 360+ Fullskärmsvy på mobil

```typescript
// Ny fil: src/pages/Mobile360Viewer.tsx
// Liknande Mobile3DViewer men med Ivion360View
// Route: /360-viewer?building=<fmGuid>
// I MainContent.tsx: på mobil, navigera till /360-viewer istället
```

### Ivion UI-minimering via postMessage

```typescript
// I Ivion360View handleIframeLoad:
if (isMobile) {
  // Try to minimize Ivion sidebar on mobile
  setTimeout(() => {
    iframeRef.current?.contentWindow?.postMessage({
      command: 'setSidebarVisibility',
      params: { visible: false }
    }, '*');
  }, 3000);
}
```

### FloatingRoomCard - Bottom sheet på mobil

```typescript
// I FloatingRoomCard.tsx
const isMobile = useIsMobile();

if (isMobile) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t rounded-t-xl shadow-2xl p-4"
         style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Kompakt rumsinfo utan drag */}
    </div>
  );
}
```

### UniversalPropertiesDialog - iOS safe-area

```typescript
// Ändra SheetContent
<SheetContent 
  side="bottom" 
  className="h-[90vh] flex flex-col p-0"
  style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
>
```

---

## Ivion API-undersökning

NavVis IVION stöder primärt två sätt att styra UI:t:

1. **Frontend API** - Kräver att man laddar deras SDK separat (inte via iframe)
2. **URL-parametrar** - Begränsat stöd (`&sidebar=false` är inte officiellt dokumenterat)
3. **postMessage** - Vi kan skicka kommandon men sidbar-kontroll är inte garanterad

Rekommendation: Testa `postMessage`-kommandon för att minimera menyn. Om det inte fungerar, acceptera Ivions standard-UI men maximera iframe-ytan genom att ta bort vår egen toolbar och bara visa en tillbaka-knapp som overlay.

