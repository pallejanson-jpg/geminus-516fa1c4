
# AI-skanning: Felsokningsanalys och atgardsplan

## Sammanfattning av problemet

Skanningen startar och hittar bildlistan (5310 bilder), men bearbetar 0 bilder och markeras som "completed" omedelbart (~4 sekunder). Detta innebar att scan-loopen aldrig kor en enda iteration.

## Rotorsaksanalys (fran databasbevis)

```text
scan_jobs (senaste):
  total_images: 5310   -- bildlistan HITTADES korrekt
  processed_images: 0  -- NOLL bilder bearbetades  
  status: completed    -- markerad som klar direkt
  duration: ~4 sekunder
```

### Problem 1: cancelledRef ar sannolikt true fore loopen borjar

`startScan()` ar en langa async-funktion som anropas fran en `useEffect` utan guard. Under `getImageList()` (som tar flera sekunder med 5310 bilder) kan React-livscykeln orsaka att `cancelledRef.current` satts till `true`, t.ex. om foralder-komponenten re-renderar och browserScanConfig andras. Nar loopen sedan borjar pa rad 345 hoppar den direkt till avslutningen pa rad 409, dar `if (!cancelledRef.current)` forhindrar att `complete-browser-scan` anropas... MEN databasen visar `completed`, sa nagonting annat satter den statusen.

### Problem 2: Avsaknad av isScanRunning-guard

`startScan()` kan anropas flera ganger om `sdkStatus` flippar mellan tillstand (t.ex. vid retry). Varje anrop skapar en ny async-exekvering som delar samma `cancelledRef`, vilket kan leda till race conditions.

### Problem 3: moveToImageId kan misslyckas for alla bilder

Om `findAll()` returnerar bilder med ID:n som inte ar giltiga for den aktiva siten (t.ex. fran en annan site), misslyckas `moveToImageId` for varje bild. Koden gor `continue` vid misslyckande (rad 362), men skriver INTE till databasen fore `continue`, sa `processed_images` forblir 0.

### Problem 4: Scanningskomplettering anropas aven vid 0 bearbetade bilder

Nar loopen ar klar (eller aldrig kordes) markeras jobbet som klart oavsett om nagra bilder faktiskt bearbetades.

## Atgardsplan

### Steg 1: Lagg till isScanRunning-guard och batt cancelledRef-hantering

Forhindra att `startScan()` anropas flera ganger och sakerstall att `cancelledRef` bara satts vid explicit avbrytning:

```text
Nytt:
  const isScanningRef = useRef(false);
  
  const startScan = async () => {
    if (isScanningRef.current) return;  // Forhindra dubbla anrop
    isScanningRef.current = true;
    cancelledRef.current = false;       // Explicit aterställning
    ...
  };
```

### Steg 2: Fixa useEffect-anropet med korrekt depency och cleanup

Det nuvarande useEffect pa rad 81-89 saknar beroendedeklaration for `startScan` och har ingen cleanup. Atgard:

```text
Nytt:
  useEffect(() => {
    if (sdkStatus === 'ready' && scanState === 'initializing') {
      startScan();
    }
    // Ingen cleanup -- cancelledRef hanteras via handleCancel
  }, [sdkStatus]);  // Ta bort scanState fran deps for att undvika re-trigger
```

### Steg 3: Lagg till robustare felhantering i scan-loopen

```text
Nytt:
  - Vid moveToImageId-misslyckande: logga tydligt OCH rakna misslyckanden
  - Om >10 navigeringar misslyckas i rad: avbryt med felmeddelande
  - Vid screenshot-misslyckande: logga storlek och orsak
  - Skriv processed_images till DB aven vid navigeringsfel
```

### Steg 4: Begrinsa antalet bilder per skanning

5310 bilder med 6 rotationer = 31 860 skarmbilder. Det tar timmar. Lagg till en max-grans och sampling:

```text
Nytt:
  - Max 200 bilder per skanning (kan okas i installningar)
  - Jamn sampling over hela bildlistan (var N:e bild)
  - Visa uppskattat tid i UI:t
```

### Steg 5: Validera att skanningen faktiskt bearbetat bilder innan markering som klar

```text
Nytt:
  if (!cancelledRef.current && processedImages > 0) {
    // complete-browser-scan
  } else if (!cancelledRef.current && processedImages === 0) {
    setScanState('error');
    setErrorMessage('Inga bilder kunde bearbetas');
  }
```

### Steg 6: Forbattra konsolloggning for felsökning

Lagg till tydliga loggar med timestamps vid varje kritiskt steg:
- "cancelledRef.current value at loop start"
- "moveToImageId result for each image" 
- "screenshot result (null/size)"
- "Total consecutive navigation failures"

## Tekniska detaljer

### Filer som andras:
1. **`src/components/ai-scan/BrowserScanRunner.tsx`** -- Alla fixar ovan
2. **`src/components/ai-scan/ScanConfigPanel.tsx`** -- Lagg till maxImages-parameter och tidsuppskattning

### Karnfix (BrowserScanRunner.tsx):

De viktigaste andringarna:
- `isScanningRef` guard mot dubbla anrop
- `cancelledRef.current = false` vid start
- Begransat till 200 bilder med sampling
- Rakna navigeringsfel och avbryt vid for manga
- Kontrollera att minst 1 bild bearbetats innan "completed"
- Utforlig konsolloggning vid varje steg
