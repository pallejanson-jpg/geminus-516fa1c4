
# Plan: Fixa Split View som fastnar på laddning

## Sammanfattning

Split View-sidan fastnar på "Laddar Split View..." eftersom den saknar tillgång till applikationens data. Orsaken är att sidan inte är inkapslad i `AppProvider`, vilket gör att `allData` förblir tom.

## Grundorsak

| Problem | Orsak |
|---------|-------|
| Split View fastnar på laddning | `SplitViewer` är en fristående route utanför `AppProvider` |
| `allData` är alltid tom | Standard context-värde används istället för data från providern |
| `loadBuilding()` anropas aldrig | Guard `if (allData.length > 0)` blockerar exekvering |

```text
Nuvarande struktur:
┌─────────────────────────────────────────┐
│ App.tsx                                 │
│ ├── /login                              │
│ ├── /split-viewer ←── SplitViewer       │ ◄── INGEN AppProvider!
│ │                     (allData = [])    │
│ └── /* ─────────────────────────────────┤
│     └── AppLayout                       │
│         └── AppProvider ←── DATA FINNS  │
│             └── allData = [...]         │
└─────────────────────────────────────────┘
```

## Lösning

Flytta `AppProvider` från `AppLayout.tsx` till `App.tsx` så att den omsluter **alla** skyddade routes. Detta ger alla sidor tillgång till `allData`.

```text
Ny struktur:
┌─────────────────────────────────────────┐
│ App.tsx                                 │
│ └── AppProvider ←── OMSLUTER ALLT       │
│     ├── /login (utanför)                │
│     ├── /split-viewer                   │
│     │   └── SplitViewer                 │
│     │       └── allData = [...] ✓       │
│     └── /*                              │
│         └── AppLayout                   │
│             └── allData = [...] ✓       │
└─────────────────────────────────────────┘
```

## Ändringar

### 1. Flytta AppProvider till App.tsx

| Fil | Åtgärd |
|-----|--------|
| `src/App.tsx` | Importera och lägg `AppProvider` runt `BrowserRouter` |

**Före:**
```typescript
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* routes... */}
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);
```

**Efter:**
```typescript
import { AppProvider } from '@/context/AppContext';

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AppProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* routes... */}
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);
```

### 2. Ta bort AppProvider från AppLayout.tsx

| Fil | Åtgärd |
|-----|--------|
| `src/components/layout/AppLayout.tsx` | Ta bort `AppProvider`-wrapper och behåll endast `AppLayoutInner` |

**Före:**
```typescript
const AppLayout: React.FC = () => {
    return (
        <AppProvider>
            <AppLayoutInner />
        </AppProvider>
    );
};
```

**Efter:**
```typescript
const AppLayout: React.FC = () => {
    return <AppLayoutInner />;
};
```

## Filer att ändra

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `src/App.tsx` | Ändra | Lägg till `AppProvider` runt `BrowserRouter` |
| `src/components/layout/AppLayout.tsx` | Ändra | Ta bort `AppProvider`-wrapper |

## Fördelar med denna lösning

| Fördel | Beskrivning |
|--------|-------------|
| **Konsistent data** | Alla sidor får tillgång till samma `allData` och app-state |
| **Enklare underhåll** | En enda provider-plats istället för dubblerad logik |
| **Fungerar för fristående sidor** | SplitViewer, Mobile3DViewer, IvionInventory etc. får data |
| **Bakåtkompatibelt** | Befintlig funktionalitet påverkas inte |

## Övriga fristående sidor som gynnas

Samma problem kan finnas för andra fristående routes som använder `allData`:
- `/ivion-inventory` - kan behöva `allData`
- `/viewer` (Mobile3DViewer) - kan behöva `allData`
- `/onboarding` - troligen oberoende

Med denna fix löses potentiella problem för alla dessa sidor.
