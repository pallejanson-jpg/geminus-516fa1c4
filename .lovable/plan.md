

# AI-skanning: Implementera robusta fixar

## Sammanfattning

Skanningen hittar bildlistan (5310 bilder) men bearbetar 0 och avslutas direkt (~4 sekunder). Rotorsaken ar att `cancelledRef` sannolikt satts till `true` av React-livscykeln innan scan-loopen borjar, samt avsaknad av guard mot dubbla anrop.

## Atgarder i `BrowserScanRunner.tsx`

### 1. Lagg till `isScanningRef` guard och aterstart av `cancelledRef`
- Forhindra att `startScan()` anropas flera ganger vid React re-renders
- Explicit aterstall `cancelledRef.current = false` i borjan av `startScan()`

### 2. Fixa `useEffect`-beroendelistan
- Ta bort `scanState` fran beroendelistan for att undvika re-trigger
- Skydda med `isScanningRef` check

### 3. Bildsampling -- begransat antal bilder per skanning
- Max 200 bilder per skanning for att halla rimlig tid (~30 min)
- Jamn sampling over hela bildlistan (var N:e bild)
- Visa totalt antal vs samplade bilder i UI

### 4. Rakna navigeringsfel och avbryt vid for manga
- Halla en raknar for konsekutiva `moveToImageId`-misslyckanden
- Om >10 i rad: avbryt skanningen med felmeddelande

### 5. Validera att bilder bearbetats innan "completed"
- Om `processedImages === 0` efter loopen: satt status `error` istallet for `completed`
- Visa felmeddelande "Inga bilder kunde bearbetas"

### 6. Forbattrad konsolloggning
- Logga `cancelledRef.current` varde vid loopstart
- Logga varje navigeringsforsoek och dess resultat
- Tidsstamplar vid varje kritiskt steg

## Teknisk plan

### `src/components/ai-scan/BrowserScanRunner.tsx`:

```text
Andringar:
1. Ny ref: isScanningRef = useRef(false)
2. startScan(): check isScanningRef, reset cancelledRef
3. useEffect: deps = [sdkStatus] only, check isScanningRef
4. MAX_IMAGES_PER_SCAN = 200, sampling logic
5. consecutiveNavFailures counter, abort at >10
6. Post-loop: check processedImages > 0 before marking complete
7. Detailed console.log at each step
```

### `src/components/ai-scan/ScanConfigPanel.tsx`:
- Ingen andring behoves

