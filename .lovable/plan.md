
# Visningsmeny: Mobil paritet + Navigation omskrivning

## Diagnos

Det finns **två separata implementationer** av visningsmenyn som divergerat:

- **Desktop**: `ViewerRightPanel` → använder `FloorVisibilitySelector` med fullständig funktionalitet (Solo-läge, localStorage-persistens, DB-namnhämtning, takklippning, Solo-knapp per våning)
- **Mobil**: `MobileViewerOverlay` → har ett eget förenklat våningssystem (`MobileFloorInfo[]`) med bara ögat/toggle, **utan Solo-läge, utan FloorVisibilitySelector**

All kod vi lagt till i desktop-panelen (Solo-läge, klippning, våningsnamnslösning från databas) syns **aldrig** på mobilen.

Det är dessutom bekräftat att navigationsmenyn (`MobileNav`) aldrig fungerat bra och ska skrivas om från grunden.

---

## Del 1: Mobil Visningsmeny — ersätt `MobileViewerOverlay` med `ViewerRightPanel`

### Vad förändras

Istället för att underhålla två separata implementationer ska mobilvisningsmenyn använda **samma `ViewerRightPanel`** som desktop, men konfigurerad för mobile sheet-layout (den är redan en Sheet och fungerar på mobil).

`MobileViewerOverlay`-filen bevaras men görs tunnare — den håller bara headern (tillbaka-knapp + byggnadsnamn + träd-knapp + inställningsknapp). Inställningsknappen öppnar istället `ViewerRightPanel` direkt, precis som på desktop.

### Ordning i panelen (våningsväljaren högst upp)

`ViewerRightPanel` visar idag sektionerna i den här ordningen:
1. BIM-modeller
2. Våningsplan
3. Visa (2D/3D, rum, annotationer)
4. Rumsvisualisering
5. Viewer settings
6. Åtgärder

**Ändring:** Flytta "Våningsplan" till **allra överst**, före BIM-modeller. Detta gäller både desktop och mobil.

### Solo-läge i våningsväljaren

Idag finns en liten "Solo"-knapp som text bredvid varje rad i `FloorVisibilitySelector`. Användaren förväntar sig att det ska finnas ett **Solo-läge som en riktig väljare**, inte bara en toggle med ögat.

**Ny design för `FloorVisibilitySelector` (listOnly-läget):**

```text
┌─────────────────────────────────────────┐
│ [Välj visningsläge]  ●Alla  ○Solo  ○Multi│
├─────────────────────────────────────────┤
│ Plan 1   [ ● ]  (i Solo-läge = aktiv pill)│
│ Plan 2   [   ]                           │
│ Plan 3   [   ]                           │
│ Plan 4   [   ]                           │
├─────────────────────────────────────────┤
│        [Visa alla]                       │
└─────────────────────────────────────────┘
```

- **"Alla"-läge**: alla våningar visas, inga switchar (default)
- **"Solo"-läge**: klicka en våning för att isolera den (pill-stil, aktiv = primärfärg), med klippning automatiskt aktiverad
- **"Multi"-läge** (nuvarande beteende): switchar per våning för manuell val

### Smalare mobil-layout

`ViewerRightPanel` öppnar ett Sheet med `w-[320px] sm:w-[340px]`. På mobil ska bredden minskas till `w-[280px]` för att ta upp mindre skärmyta.

---

## Del 2: Navigationsmenyn — omskrivning från grunden

`MobileNav` har fungerat dåligt från start. Den ska raderas och skrivas om från grunden med dessa principer:

### Ny design

- **Bottom navigation bar** (fast längst ner på skärmen, alltid synlig) med 4-5 core-ikoner
- Ingen popup-meny — core-navigationen är direkt tillgänglig
- En "Mer"-knapp öppnar ett bottom sheet för appar (FMA+, Asset+, IoT+, etc.)
- Bottom sheet är en `Drawer` (vaul) från botten, scrollbar, använder `getSidebarOrder()` för dynamisk lista

```text
[Home] [Portfolio] [Navigator] [Karta] [...Mer]
```

- Enkel, tydlig, stor touch-target (h-14)
- Visar aktiv route med primary-färg
- Säker area-inset-bottom

### Teknisk implementation

**`src/components/layout/MobileNav.tsx`** — radera all kod, skriv om från grunden:
- `BottomNavBar` komponent: fast bar med 5 knappar
- `AppDrawer` komponent: Drawer/Sheet från botten med dynamiska app-ikoner från `getSidebarOrder()`
- Korrekt hantering av `activeApp` från `AppContext`
- Säker inset-bottom med `env(safe-area-inset-bottom)`

---

## Tekniska filer som ändras

```text
src/components/viewer/FloorVisibilitySelector.tsx
  - Ny tri-state mode selector (Alla / Solo / Multi)
  - Solo-läge: pill-knappar istallet for switchar
  - Gäller BÅDA desktop och mobil (listOnly-läget)

src/components/viewer/ViewerRightPanel.tsx
  - Flytta "Våningsplan" till överst (före BIM-modeller)
  - Smalare mobil-bredd: w-[280px] på mobil, w-[320px] på desktop
  - Öppnas direkt från MobileViewerOverlay

src/components/viewer/mobile/MobileViewerOverlay.tsx
  - Ta bort det interna floors/models-systemet
  - Behåll bara header-overlay (tillbaka, byggnadsnamn, träd-knapp)
  - Inställningsknapp öppnar nu ViewerRightPanel direkt (via prop/callback)
  - Tar emot en `onOpenSettings` prop

src/components/viewer/AssetPlusViewer.tsx
  - Koppla ihop MobileViewerOverlay.onOpenSettings → setRightPanelOpen(true)
  - MobileViewerOverlay behöver inte längre floors/models props

src/components/layout/MobileNav.tsx
  - Radera all befintlig kod
  - Ny BottomNavBar med 5 fasta knappar + Mer-knapp
  - AppDrawer (bottom sheet) för övriga appar
```

---

## Vad detta löser

| Problem | Lösning |
|---|---|
| Visningsmeny saknar Solo-läge | FloorVisibilitySelector får tri-state Solo-läge |
| Mobilmenyn saknar allt desktop-innehåll | MobileViewerOverlay öppnar ViewerRightPanel |
| Våningsväljaren syns inte högt upp | Flyttas till överst i ViewerRightPanel |
| Menyn är för bred på mobil | Smalare sheet-bredd på mobil |
| Navigationsmenyn fungerar dåligt | Komplett omskrivning till BottomNavBar + Drawer |
| Desktop och mobil har parity-problem | En enda ViewerRightPanel används på alla enheter |
