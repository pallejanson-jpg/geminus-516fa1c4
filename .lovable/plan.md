

# Konsolidera 3D, Split och Virtual Twin till en Unified Viewer

## Problemet idag

Tre separata sidor med nästan identisk kod:

| Funktion | VirtualTwin.tsx (547 rader) | SplitViewer.tsx (593 rader) | Viewer.tsx (91 rader) |
|---|---|---|---|
| Byggnadsdata-laddning | Ja (rad 86-151) | Ja (rad 480-549) | Via AppContext |
| SDK-laddning | Ja (rad 153-207) | Via Ivion360View | - |
| Token-refresh | Ja (rad 210-228) | Via Ivion360View | - |
| Alignment-panel | Ja | Nej (saknas!) | - |
| Fullscreen | Ja (rad 254-269) | Ja (rad 171-188) | - |
| Toolbar | Ja | Ja (annorlunda) | - |

Ca 400 rader duplicerad logik. Och Alignment-panelen saknas helt i Split View, trots att den behövs lika mycket dar.

## Losningen: En enda UnifiedViewer-sida

En enda komponent som stodjer fyra lagen, styrda av en toolbar:

```text
+--[Tillbaka]--[Byggnadsnamn]----[360] [Split] [VT] [3D]----[Opacity] [Align] [FS]--+
|                                                                                     |
|                       (innehall baserat pa aktivt lage)                              |
|                                                                                     |
+-------------------------------------------------------------------------------------+
```

| Lage | Beskrivning | Layout |
|------|-------------|--------|
| **3D** | Enbart 3D BIM-modell | Helskarm AssetPlusViewer |
| **Split** | 3D och 360 sida vid sida | ResizablePanelGroup (50/50) |
| **VT** | 3D overlay pa 360 (Virtual Twin) | Lager: SDK (z-0) + transparent 3D (z-10) |
| **360** | Enbart 360-panorama | Helskarm SDK |

### Standardlage baserat pa inkommen route

- `/virtual-twin?building=X` --> startar i **VT**-lage
- `/split-viewer?building=X` --> startar i **Split**-lage
- Navigation fran 3D-knappar --> startar i **3D**-lage

Alla tre routes pekar pa samma komponent med olika `initialMode`.

## Teknisk arkitektur

### Ny hook: `useBuildingViewerData`

Extraherar den duplicerade byggnadsdata-laddningen till en ateranvandbar hook:

```text
useBuildingViewerData(buildingFmGuid: string)
  --> buildingInfo: { fmGuid, name, ivionSiteId, ivionUrl, transform, origin, ... }
  --> isLoading: boolean
  --> error: string | null
```

Denna hook konsoliderar:
- Byggnadsuppslag i allData (identiskt i VT rad 94-98 och Split rad 489-498)
- Databasfraga for building_settings (identiskt i VT rad 107-111 och Split rad 503-506)
- URL-konstruktion for Ivion (identiskt i VT rad 124-128 och Split rad 66-76)
- Transform-bygge fran settings (identiskt i bada)

### Ny hook: `useIvionSdk`

Extraherar SDK-laddning, livscykel och token-refresh:

```text
useIvionSdk({ baseUrl, siteId, buildingFmGuid, containerRef, enabled })
  --> sdkStatus: 'idle' | 'loading' | 'ready' | 'failed'
  --> ivApiRef: MutableRefObject<IvionApi | null>
  --> retry: () => void
```

Konsoliderar:
- SDK-laddning (VT rad 153-207 och Ivion360View rad 131-208)
- Token-refresh (VT rad 210-228 och Ivion360View rad 211-230)
- Cleanup och retry-logik (VT rad 289-300)

### Huvudkomponent: `UnifiedViewer`

```text
UnifiedViewer({ initialMode: '3d' | 'split' | 'vt' | '360' })
  |
  |-- useBuildingViewerData(fmGuid)     // Byggnadsdata (en gang)
  |-- useIvionSdk(...)                  // SDK (en gang)
  |-- useVirtualTwinSync(...)           // VT-synk (aktiv i VT-lage)
  |-- useIvionCameraSync(...)           // Split-synk (aktiv i Split-lage)
  |-- [viewMode] state                  // Aktuellt lage, default fran initialMode
  |
  |-- Render:
  |     |-- <ViewerToolbar />           // Gemensam toolbar med lagvaljare
  |     |-- if (viewMode === '3d')      --> <AssetPlusViewer />
  |     |-- if (viewMode === 'split')   --> <ResizablePanelGroup>
  |     |-- if (viewMode === 'vt')      --> Layered SDK + transparent 3D
  |     |-- if (viewMode === '360')     --> SDK only
  |     |-- <AlignmentPanel />          // Tillganglig i VT och Split
```

### Villkorlig rendering per lage

```text
Lage '3d':
  - SDK-container: display: none (men forblir monterad)
  - AssetPlusViewer: full opacity, vanliga pointer-events
  - Alignment: dold
  - Synk: inaktiv

Lage 'split':
  - ResizablePanelGroup med tva paneler
  - Vanster: AssetPlusViewer (full opacity)
  - Hoger: SDK-container (flyttas in i panelen via React portal eller ref)
  - Alignment: tillganglig
  - Synk: bi-direktionell via ViewerSyncContext

Lage 'vt':
  - SDK-container: z-0, synlig
  - AssetPlusViewer: z-10, transparent, pointer-events: none (utom vid select-verktyg)
  - Alignment: tillganglig
  - Ghost opacity-slider: synlig
  - Synk: en-vags via useVirtualTwinSync

Lage '360':
  - SDK-container: helskarm
  - AssetPlusViewer: display: none (men forblir monterad)
  - Alignment: dold
  - Synk: inaktiv
```

### SDK-container i Split-lage

En utmaning: I VT/360-lage ar SDK-containern en absolut-positionerad div. I Split-lage ska den sitta i en ResizablePanel. Losningen ar att alltid ha SDK-containern som en absolut div, men i Split-lage positionera den via CSS sa den taecker hogerpanelen:

```text
Split-lage:
  <ResizablePanelGroup>
    <Panel> <AssetPlusViewer /> </Panel>
    <Handle />
    <Panel ref={rightPanelRef}> <!-- tom, SDK positioneras over --> </Panel>
  </ResizablePanelGroup>
  
  <div ref={sdkContainerRef}
       style={ splitMode ? positionera over hogerpanelen : 'inset-0' }
  />
```

Alternativt kan vi anvanda en enklare approach: i Split-lage anvanda CSS Grid eller flex istallet for ResizablePanelGroup, sa att SDK-containern naturligt placeras i ena halvan.

### Lagvaljare-tillganglighet

Om byggnaden saknar `ivionSiteId`, ar 360/VT/Split disabled:

```text
Har Ivion Site ID:  [360] [Split] [VT] [3D]   (alla tillgangliga)
Saknar Site ID:     [3D]                        (bara 3D)
SDK-fel:            [3D] [360°*] [Split*] [VT*] (360/Split/VT disabled + retry-knapp)
```

### Vaningsplan-valjare

Dold som standard i VT-lage (samma som nuvarande plan). Synlig i 3D och Split.

## Filandringar

| Fil | Andring |
|---|---|
| `src/hooks/useBuildingViewerData.ts` | **NY** -- Extraherar byggnadsdata-laddning |
| `src/hooks/useIvionSdk.ts` | **NY** -- Extraherar SDK-laddning och token-refresh |
| `src/pages/UnifiedViewer.tsx` | **NY** -- Konsoliderad viewer med alla fyra lagen |
| `src/pages/VirtualTwin.tsx` | **RENSAS** -- Tunnt wrapper som importerar UnifiedViewer med initialMode='vt' |
| `src/pages/SplitViewer.tsx` | **RENSAS** -- Tunnt wrapper som importerar UnifiedViewer med initialMode='split' |
| `src/pages/Viewer.tsx` | Behalls for inbaddad 3D i AppLayout (ingen andring, den ar redan minimal) |
| `src/components/viewer/Ivion360View.tsx` | Behalls for standalone 360-vy (inbaddad i MainContent under 'radar' app) |
| `src/App.tsx` | Routes uppdateras att ladda UnifiedViewer med ratt initialMode |

### Tunna wrappers (for bakatkompabilitet)

```text
// src/pages/VirtualTwin.tsx
export default function VirtualTwin() {
  return <UnifiedViewer initialMode="vt" />;
}

// src/pages/SplitViewer.tsx  
export default function SplitViewer() {
  return <UnifiedViewer initialMode="split" />;
}
```

## Implementationsordning

1. Skapa `useBuildingViewerData` hook (extrahera fran VirtualTwin.tsx)
2. Skapa `useIvionSdk` hook (extrahera fran VirtualTwin.tsx + Ivion360View.tsx)
3. Skapa `UnifiedViewer.tsx` med alla fyra lagen
4. Uppdatera VirtualTwin.tsx och SplitViewer.tsx till tunna wrappers
5. Testa alla lagen

## Riskbedomning

- **SDK-container delning (medel risk):** Samma `<ivion>` element maste funka bade som helskarmslager (VT/360) och som halva skarmens bredd (Split). Hanteras via dynamisk CSS-positionering baserat pa lage.
- **Tva synk-mekanismer (lag risk):** `useVirtualTwinSync` (VT) och `useIvionCameraSync` (Split) aktiveras villkorligt baserat pa lage. Bara en ar aktiv at gangen.
- **Bakatkompabilitet (ingen risk):** Routes behalls, bara underliggande komponent byts ut.
- **Inbaddad 3D (ingen risk):** `Viewer.tsx` och dess anvandning i AppLayout paverkas inte.
