

# Plan: Förbättra Quick Actions med Split View och Tooltips

## Sammanfattning

Omstrukturera Quick Actions-panelen för att:
1. Lägga visualiseringsverktygen (2D, 3D, 360+, 3D+360+) överst på första raden
2. Lägga till tooltips på alla knappar för bättre användbarhet
3. Lägga till ny "3D + 360°" Split View-knapp
4. Gråa ut 360+ och 3D+360+ om byggnaden saknar Ivion Site ID

## Ny knappordning

| Rad | Knappar |
|-----|---------|
| **Rad 1 (Visualisering)** | 2D • 3D • 360+ • 3D+360+ |
| **Rad 2+ (Data & Verktyg)** | Insights • Assets • Rooms • Map • Navigator • Docs+ • IOT+ • Add Asset • Inventering |

## Ändringar

### 1. Lägg till Split View-knapp och onOpenSplitView prop

| Nytt | Beskrivning |
|------|-------------|
| `onOpenSplitView` prop | Callback för att öppna Split View |
| Split View-knapp | Visar "3D+360+" med Split-ikon |
| Disabled state | Utgråad om `ivionSiteId` saknas |

### 2. Lägg till Tooltips på alla knappar

Varje knapp får en Tooltip med förklarande text:

| Knapp | Tooltip |
|-------|---------|
| 2D | "Visa 2D-planritning" |
| 3D | "Visa 3D-modell" |
| 360+ | "Öppna 360°-panorama" (eller "Konfigurera Ivion Site ID först" om saknas) |
| 3D+360+ | "Synkroniserad 3D och 360°-vy" (eller "Konfigurera Ivion Site ID först" om saknas) |
| Insights | "Visa nyckeltal och analyser" |
| Assets | "Visa tillgångar" |
| Rooms | "Visa rum och utrymmen" |
| Map | "Visa på karta" |
| Navigator | "Öppna hierarkisk navigator" |
| Docs+ | "Visa dokument" |
| IOT+ | "Visa IoT-sensorer" |
| Add Asset | "Registrera ny tillgång" |
| Inventering | "Inventera tillgångar här" |

### 3. Gråa ut knappar som kräver Ivion

| Knapp | Villkor för disabled |
|-------|----------------------|
| 360+ | `!ivionSiteId` |
| 3D+360+ | `!ivionSiteId` |

## Filer att ändra

| Fil | Åtgärd |
|-----|--------|
| `src/components/portfolio/QuickActions.tsx` | Lägg till Split View-knapp, Tooltips, ordna om knappar |
| `src/components/portfolio/FacilityLandingPage.tsx` | Skicka `onOpenSplitView` prop till QuickActions |

## Tekniska detaljer

### QuickActions.tsx - Ny struktur

```text
<CardContent>
  <div className="grid grid-cols-4 gap-2">
    {/* VISUALISERINGSRAD (alltid först) */}
    {isStorey && <2D Button med Tooltip />}
    {(isBuilding || isStorey) && <3D Button med Tooltip />}
    {(isBuilding || isStorey) && <360+ Button med Tooltip disabled={!ivionSiteId} />}
    {isBuilding && <3D+360+ Button med Tooltip disabled={!ivionSiteId} />}
    
    {/* ÖVRIGA VERKTYG */}
    <Insights Button med Tooltip />
    <Assets Button med Tooltip />
    <Rooms Button med Tooltip />
    <Map Button med Tooltip />
    ...
  </div>
</CardContent>
```

### Tooltip-implementering

```text
<Tooltip>
  <TooltipTrigger asChild>
    <Button ...>
      <Icon />
      <span>Label</span>
    </Button>
  </TooltipTrigger>
  <TooltipContent>
    <p>Beskrivande text</p>
  </TooltipContent>
</Tooltip>
```

