
# Mobilnavigeringen — tre buggar att åtgärda

## Problem 1: Karta och Portfolio fungerar inte

**Rotorsak bekräftad**: I `AppLayout.tsx` rad 19 finns:
```typescript
const IMMERSIVE_APPS = ['assetplus_viewer', 'viewer', 'radar', 'map', 'fma_plus'];
```

`'map'` finns i listan — det gör att när användaren trycker Karta sätts `isImmersive = true` → `MobileNav` döljs → knappar verkar "dö". Även `'fma_plus'` bör troligen tas bort här eftersom kartan ska behålla sin nav.

**Fix**: Ta bort `'map'` och `'fma_plus'` från `IMMERSIVE_APPS`. Immersiva appar ska bara vara de som verkligen behöver fullscreen utan navigationsbar: `'assetplus_viewer'`, `'viewer'`, `'radar'`.

---

## Problem 2: Fast navbar tar för mycket skärm — ersätt med hamburger-FAB

**Nuläge**: `MobileNav.tsx` renderar alltid en fast `<nav>`-bar på 3.5rem längst ned med 5 knappar (Hem, Portfolio, Navigator, Karta, Mer).

**Nytt beteende**:
- Ta bort den fasta navbar-baren helt
- Lägg till en **liten flytande FAB-knapp** (pill-formad) centrerad längst ned: `fixed bottom-5 left-1/2 -translate-x-1/2 z-40`
- Designen: semi-transparent `bg-card/80 backdrop-blur-md border border-border rounded-full px-5 py-2.5 shadow-lg`
- Innehåll i FAB: hamburgermenyikon + ev. "Meny" text
- Tryck på FAB → öppnar befintlig `Drawer` (AppDrawer)
- I drawern: flytta CORE_NAV-alternativen (Hem, Portfolio, Navigator, Karta) som ett grid-avsnitt **överst** i drawern, sedan Viewer och Integrationer som idag

**Konsekvens i AppLayout.tsx**: Ta bort `pb-14`-paddingen som tidigare reserverade plats för den fasta navbaren (rad 85):
```typescript
// Nuvarande (tar bort):
className={`flex-1 min-h-0 ${isMobile && !isImmersive ? 'pb-14' : ''}`}
style={isMobile && !isImmersive ? { paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' } : {}}

// Nytt (enkel):
className="flex-1 min-h-0"
```

FAB:en flötar ovanpå innehållet utan att blockera — liten och diskret.

---

## Problem 3: Landningssidan går inte att scrolla

**Rotorsak bekräftad**: 
- `AppLayout` sätter `h-screen overflow-hidden` på root-diven (rad 72)
- `MainContent` (rad 196) wrappar allt i `<div className="w-full h-full">` — detta fixerar höjden
- `HomeLanding` (rad 164) har `min-h-full` på sin ytterdiv men kan inte expandera bortom sin fixerade förälders höjd

**Fix i `MainContent.tsx`** — ändra inner wrapper (rad 196):
```tsx
// Nuvarande:
<div className="w-full h-full">

// Nytt — h-full bara för immersiva viewers, annars min-h-full:
<div className={isImmersiveViewer ? "w-full h-full" : "w-full min-h-full"}>
```

`min-h-full` tillåter att innehållet växer och `overflow-auto` på `<main>` (rad 193) tar hand om scrollningen.

---

## Teknisk implementation — tre filer, tydliga ändringar

### Fil 1: `src/components/layout/AppLayout.tsx`
- Rad 19: ändra `IMMERSIVE_APPS` — ta bort `'map'` och `'fma_plus'`
- Rad 85: ta bort `pb-14`-padding och inline style

### Fil 2: `src/components/layout/MobileNav.tsx`
- Ta bort hela `<nav>`-blocket (rader 92–128)
- Ersätt med en FAB-knapp:
  ```tsx
  <button
    onClick={() => setIsMobileMenuOpen(true)}
    className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-card/80 backdrop-blur-md border border-border rounded-full px-5 py-2.5 shadow-lg"
    style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
  >
    <Menu className="h-4 w-4 text-foreground" />
    <span className="text-sm font-medium text-foreground">Meny</span>
  </button>
  ```
- I `DrawerContent` — lägg till CORE_NAV-grid överst (före "Viewer"-sektionen):
  ```tsx
  {/* Core navigation */}
  <div>
    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Navigation</p>
    <div className="grid grid-cols-4 gap-2">
      {CORE_NAV.map(({ key, icon: Icon, label }) => (
        <button key={key} onClick={() => { setActiveApp(key); setIsMobileMenuOpen(false); }}
          className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-muted/60">
          <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center",
            activeApp === key ? "bg-primary/15" : "bg-muted")}>
            <Icon className={cn("h-6 w-6", activeApp === key ? "text-primary" : "text-foreground/70")} />
          </div>
          <span className="text-[11px]">{label}</span>
        </button>
      ))}
    </div>
  </div>
  ```

### Fil 3: `src/components/layout/MainContent.tsx`
- Rad 196: ändra `<div className="w-full h-full">` till `<div className={isImmersiveViewer ? "w-full h-full" : "w-full min-h-full"}>`

## Vad som INTE ändras
- Desktop-layouten påverkas inte (alla ändringar är bakom `isMobile`-guards)
- Drawer-designen och integrationsavsnittet är oförändrat
- Immersiva appar (viewer, radar, assetplus_viewer) förblir fullscreen utan navbar
