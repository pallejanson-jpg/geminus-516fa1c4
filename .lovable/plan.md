

# Integrera @navvis/ivion SDK (.tgz) for fullt SDK-lage

## Oversikt

NavVis distribuerar sitt Frontend API som en privat `.tgz`-fil (inte via npmjs.org). Genom att lagga in den i projektet och referera den i `package.json` far vi tillgang till `getApi` via en riktig ES-import -- vilket ger fullstandig bi-direktionell kamerasynkronisering i Split View utan CORS-problem.

## Forutsattning

Du behover hamta `.tgz`-filen fran NavVis Knowledge Base (kräver inloggning med IVION Professional/Enterprise-licens). Filen heter nagot i stil med `navvis-ivion-X.X.X.tgz`.

## Steg-for-steg

### Steg 1: Lagg till .tgz-filen i projektet

Placera den nedladdade filen i projektroten, t.ex.:

```
/navvis-ivion-X.X.X.tgz
```

### Steg 2: Uppdatera package.json

Lagg till en dependency som pekar pa den lokala .tgz-filen:

```json
{
  "dependencies": {
    "@navvis/ivion": "file:navvis-ivion-X.X.X.tgz"
  }
}
```

Kör sedan `npm install` sa att paketet paketeras ut i `node_modules/@navvis/ivion/`.

### Steg 3: Uppdatera ivion-sdk.ts -- importera getApi direkt

Den nuvarande `loadIvionSdk()`-funktionen soker efter `window.getApi` globalt och ger sedan upp. Med det installerade npm-paketet kan vi istallet importera `getApi` direkt och skapa en riktig SDK-anslutning.

**Andringar i `src/lib/ivion-sdk.ts`:**

- Lagg till `import { getApi } from '@navvis/ivion'` langst upp
- Ta bort logiken som soker efter `window.getApi` / `window.NavVis.getApi`
- Anropa `getApi(baseUrl, config)` direkt i `loadIvionSdk()`
- Behall typ-interfacen (`IvionApi`, `IvionVector3`, etc.) som redan ar definierade -- de matchar SDK:ts `ApiInterface`
- Behall `createIvionElement()` och `destroyIvionElement()` som de ar (SDK renderar in i `<ivion>`-elementet)

Resulterande flode:

```text
loadIvionSdk(baseUrl, timeout, loginToken)
  |
  +-- import { getApi } from '@navvis/ivion'
  +-- getApi(baseUrl, { loginToken? })
  +-- return IvionApi (= ApiInterface)
```

### Steg 4: Verifiera att Ivion360View.tsx fungerar utan andringar

Komponenten `Ivion360View.tsx` anropar redan `loadIvionSdk()` och hanterar bade SDK-lage och iframe-fallback. Nar `getApi` nu returnerar ett riktigt API-objekt kommer:

- `sdkStatus` att sattes till `'ready'`
- `renderMode` att bli `'sdk'` (inte `'iframe'`)
- SDK-containern (`<ivion>`-elementet) visas istallet for iframe:n
- Kamerasync-hooken (`useIvionCameraSync`) aktiverar SDK-pollning automatiskt

Ingen andring behövs i `Ivion360View.tsx` eller `useIvionCameraSync.ts`.

### Steg 5: CORS-proxyn behovs inte langre for SDK-laddning

`ivion-proxy` edge function kan behallar for andra andamal (t.ex. proxya tillgangsforfragan), men den behover inte langre laddas for `main.js` eller `ivion.js`. Inget behover andras eller tas bort -- den anropas helt enkelt inte langre for SDK-laddning.

## Tekniska detaljer

### Filer som andras

| Fil | Andring |
|-----|---------|
| `package.json` | Lagg till `"@navvis/ivion": "file:navvis-ivion-X.X.X.tgz"` |
| `src/lib/ivion-sdk.ts` | Importera `getApi` fran `@navvis/ivion`, forenkla `loadIvionSdk()` |

### Filer som INTE andras

| Fil | Anledning |
|-----|-----------|
| `Ivion360View.tsx` | Anvander redan `loadIvionSdk()` korrekt |
| `useIvionCameraSync.ts` | Har redan SDK-mode med pollning och `moveToImageId()` |
| `SplitViewer.tsx` | Passerar redan ratt props till `Ivion360View` |
| `ivion-proxy/index.ts` | Behallar for framtida bruk, men anropas inte for SDK |

### Typ-kompatibilitet

Var `IvionApi`-interface matchar NavVis `ApiInterface` (metoderna `getMainView()`, `moveToImageId()`, `moveToImage()`, `auth`, `pov`, etc.). Om paketet exporterar TypeScript-typer kan vi eventuellt byta ut vara egna definitioner mot SDK:ts, men det ar valfritt och behover inte goras direkt.

### Versionsmatchning

Viktigt: `.tgz`-versionen maste matcha Ivion-instansens version (kontrollera via About-menyn i `swg.iv.navvis.com`). Felaktig version kan orsaka laddningsfel eller ovaentade API-skillnader.

## Vad du behover gora

1. Logga in pa NavVis Knowledge Base
2. Ladda ned ratt version av `navvis-ivion-X.X.X.tgz`
3. Ladda upp filen till projektet (dra in i Lovable eller lagg i repot)
4. Meddela mig sa implementerar jag integrationen

