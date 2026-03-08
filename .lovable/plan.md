

## Djupanalys: 3D Viewer Prestanda & Roadmap mot Dalux-nivå

### Nuläge

**Motor:** xeokit SDK med XKTLoaderPlugin. Modeller lagras som XKT-binärer i Supabase Storage.

**Mobil touch-navigering:** Redan justerat (`dollyRate: 10`, `panRate: 0.3`, `touchDollyRate: 0.15`, `touchPanRate: 0.3`, `rotationInertia: 0.7`) men **saknar `dragRotateRate`** — den viktigaste parametern för att bromsa rotationshastigheten vid touch-svep. Dalux-känslan kräver lägre `dragRotateRate` (ca 80-120, default ~360).

**Mobil modell-begränsning:** Hård spärr: om >3 modeller laddas bara A-modeller. Sekundära modeller (brand, el, VVS) laddas aldrig.

**Dalux referens:** Hanterar 1M+ objekt, stödjer IFC nativt, använder eget binärt format (troligen liknande xeokits "SceneModel geometry batching"), split-per-storey, och progressiv streaming.

---

### Åtgärdsplan

#### LÄTT (1-2h vardera)

**1. Sänk touch-rotationshastighet ytterligare**
- I `NativeXeokitViewer.tsx` rad ~127-134, lägg till:
  - `cc.dragRotateRate = 100` (default 360 — detta är huvudproblemet)
  - `cc.touchPanRate = 0.2` (ner från 0.3)
  - `cc.rotationInertia = 0.85` (mer tröghet = lugnare stopp)
- Effekt: Omedelbart Dalux-liknande känsla på mobil

**2. Ta bort hård mobilspärr — lägg till lazy loading av sekundära modeller**
- I `NativeXeokitViewer.tsx` rad 364-373: Istället för att trunkera `loadList`, ladda A-modeller först, sätt `phase: 'ready'`, sedan ladda sekundära modeller i bakgrunden via `requestIdleCallback`
- Logik: Arch-modeller → viewer ready → event dispatched → efter 2s börja ladda brand/el/VVS sekventiellt (CONCURRENT=1)
- Användaren ser modellen direkt, resterande discipliner "rinner in" successivt

**3. Aktivera LOD-culling även på mobil (med lägre tröskel)**
- I `usePerformancePlugins.ts` rad 114: Ta bort `!isMobile`-villkoret
- Sätt `LOD_FAR_DISTANCE = 30` på mobil (istället för 50)
- Effekt: Färre objekt renderas → bättre FPS

**4. Justera FastNav mer aggressivt på mobil**
- `scaleCanvasResolutionFactor: 0.35` (ner från 0.5) under kamerarörelse
- Effekt: Märkbart snabbare orbit/pan på svagare enheter

#### MEDEL (4-8h vardera)

**5. XKT split-per-storey vid konvertering**
- xeokit rekommenderar officiellt att dela IFC → flera XKT (20MB chunks) via manifest
- Implementera i `ifc-to-xkt`: efter IFC→XKT-konvertering, splitta output per `IfcBuildingStorey`
- Lagra varje chunk som separat rad i `xkt_models` med `storey_fm_guid`
- Viewer laddar bara synligt våningsplan + angränsande, övriga cullas
- Effekt: 60-80% minnesreduktion, möjliggör tunga byggnader på mobil

**6. Progressiv streaming med manifest**
- `XKTLoaderPlugin` stödjer `manifestSrc` — ladda en JSON-manifest som pekar ut alla chunks
- Generera manifest vid konvertering, ladda via en signerad URL
- Chunks laddas i prioritetsordning (valt våningsplan först)

**7. Preload sekundära modeller i bakgrunden**
- `useXktPreload` laddar idag bara A-modeller (`secondaryModels = []` rad 215)
- Lägg till en fas 2 som triggas av `requestIdleCallback` efter A-modeller: hämta brand/el/VVS-binärer till `xktMemoryCache`
- När användaren öppnar viewern finns sekundärdata redan i minnet

#### SVÅRT (1-3 dagar vardera)

**8. Eget komprimerat binärformat (som Asset+ gör)**
- Asset+ konverterar XKT → eget binärt format med bättre geometri-batching och quantization
- Alternativ: Använd xeokits `SceneModel` API för att generera batched geometry offline
- Konverteringskedja: IFC → glTF → batched binary (serverside via edge function)
- Effekt: Potentiellt 2-5x snabbare laddning, mindre filstorlekar

**9. WebWorker-baserad dekompression**
- Flytta XKT-dekompression (pako inflate) till en Web Worker
- Main thread förblir responsiv under laddning
- Kräver modifiering av XKTLoaderPlugin eller en wrapper

**10. GPU instancing för repetitiva objekt**
- xeokit stödjer instanced geometry (`createGeometry` + `createMesh` med `geometryId`)
- Identifiera repetitiva IFC-typer (dörrar, fönster, armaturer) vid konvertering
- Lagra en geometri + N transformmatriser istället för N kopior
- Effekt: Dramatisk minnesreduktion för modeller med mycket upprepning

---

### Rekommenderad prioritetsordning

```text
Fas 1 (nu):    #1 Touch-rates   +  #2 Lazy-load sekundärmodeller  +  #3 Mobil LOD
Fas 2 (vecka):  #5 XKT split-per-storey  +  #7 Preload sekundärmodeller  
Fas 3 (månad): #8 Binärformat  +  #9 WebWorker  +  #10 Instancing
```

### Sammanfattning
Punkt #1 (dragRotateRate) och #2 (lazy loading) löser dina två mest akuta problem: för snabb touch-navigering och att sekundära modeller inte laddas alls på mobil. Dessa kan implementeras direkt.

