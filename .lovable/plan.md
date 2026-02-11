

# AI-skanning: Analys och atgardsplan

## Problem

Webblasar-baserad AI-skanning startar men visar ingen progress och hittar inga objekt. Tre huvudproblem har identifierats:

## Rotorsaksanalys

### 1. Bildlistan ar tom -- skanningen navigerar aldrig
`BrowserScanRunner.getImageList()` (rad 192-235) forsoker:
- Anropa edge-funktionen `test-image-access` for att fa datasets (detta ar backend-baserat och returnerar dataset-namn, inte bild-IDn for SDK:n)
- Sedan forsoka `api.image.repository.findAll()` -- men detta anvander fel API-stig. SDK:ns `image`-objekt ar `api.image` inte `api.image.repository`

Aven om det lyckas finns ett fallback med `for (let i = 0; i < 200; i++)` som genererar sekventiella IDn -- men `api.moveToImageId(i)` med godtyckliga nummer misslyckas sannolikt tyst.

**Konsekvens:** Skanningen far en tom eller felaktig bildlista, navigerar inte till nagon bild, och tar skarmbilder av startpositionen.

### 2. Screenshot-metoden ar felaktig
`captureScreenshot()` (rad 102-128) forsoker:
- `mainView.getScreenshot()` -- men anropar det som async med `await`. Enligt Ivion API:t returnerar `getScreenshot()` ett `ScreenshotDataInterface`-objekt (inte en Promise). Objektet har `data` (data-URI), `width`, `height`.
- Koden forvantar sig en ren strang (`dataUri`), men SDK:n returnerar ett objekt.
- Fallback: soker `canvas`-element, men panorama-canvasen ar ofta WebGL-skyddad mot `toDataURL`.

**Konsekvens:** Inga skarmbilder fangas = ingenting att analysera.

### 3. Rotation fungerar sannolikt inte
`rotateView()` (rad 146-161) anvander `mainView.updateOrientation()` men skickar bara `lon` utan `lat`. Enligt API-typen kraver `updateOrientation` ett `ViewOrientationInterface` med bade `lon` och `lat`.

## Atgardsplan

### Steg 1: Fixa bildnavigering med korrekta SDK-anrop
Ersatt `getImageList()` med korrekt anvandning av Ivion SDK:

```text
Nuvarande (trasigt):
  api.image.repository.findAll() -- fel API-stig

Nytt (korrekt):
  const imageApi = (api as any).image;
  const images = await imageApi.repository.findAll();
  -- returnerar ImageInterface[] med id, location, etc.
```

Om `findAll()` misslyckas, anvand `imageApi.service.getClosestImage()` for att iterativt hitta nasta bild.

### Steg 2: Fixa screenshot-infangning
Korrigera `captureScreenshot()` for att hantera SDK:ns returtyp:

```text
Nuvarande (trasigt):
  const dataUri = await mainView.getScreenshot();  // Returnerar objekt, inte strang

Nytt (korrekt):
  const screenshotData = mainView.getScreenshot('image/jpeg', 0.85);
  const base64 = screenshotData.data.split(',')[1];
```

### Steg 3: Fixa kamerarotation
Uppdatera `rotateView()` for att skicka komplett `ViewOrientationInterface`:

```text
Nytt:
  mainView.updateOrientation({
    lon: (currentDir.lon || 0) + deltaDeg * Math.PI / 180,
    lat: currentDir.lat || 0,
  });
```

### Steg 4: Forbattra progress-feedback
- Lagg till detaljerade konsolloggar for varje steg (bildlista, navigation, screenshot-storlek, AI-svar)
- Visa aktuellt bildnummer och detekteringsantal tydligt i UI:t
- Visa felmeddelande om screenshot misslyckas

### Steg 5: Hantera `moveToImageId` korrekt
Anvand riktig bild-ID fran `findAll()` istallet for sekventiella nummer. Lagg till felhantering for navigeringsfel.

## Tekniska detaljer

### Filer som andras:
1. **`src/components/ai-scan/BrowserScanRunner.tsx`** -- Huvudsakliga fixar i `getImageList()`, `captureScreenshot()`, `rotateView()`, och `getImagePosition()`
2. **Ingen andring i edge-funktionen** -- `analyze-screenshot`-actionen fungerar redan korrekt

### Viktiga SDK API-metoder (fran api.d.ts):
- `api.image.repository.findAll()` -> `Promise<ImageInterface[]>` -- listar alla bilder
- `api.moveToImageId(id)` -> `Promise<void>` -- navigerar till en bild
- `mainView.getScreenshot(mimeType?, quality?)` -> `ScreenshotDataInterface` -- tar skarm-dump (synkron)
- `mainView.getImage()` -> `ImageInterface` -- aktuell bild med `location: Vector3`
- `mainView.updateOrientation({lon, lat})` -- andrar kamerariktning

