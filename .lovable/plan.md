

# Aktivera NavVis SDK -- Lagg till saknad dependency

## Problem

`navvis-ivion-11.9.8.tgz` finns redan i projektroten, men `@navvis/ivion` lades aldrig till i `package.json`. Darfor hittar byggsystemet inte paketet och SDK:n laddas aldrig -- systemet faller tillbaka till iframe-lage utan kamerasync.

## Fix

### Steg 1: Lagg till dependency i package.json

Lagg till foljande rad i `dependencies`-sektionen:

```json
"@navvis/ivion": "file:navvis-ivion-11.9.8.tgz"
```

Det ar bokstavligen den enda andringen som behovs. Nar `package.json` sparas kors `npm install` automatiskt av byggsystemet, vilket:

1. Packar upp `.tgz`-filen till `node_modules/@navvis/ivion/`
2. Gor `import('@navvis/ivion')` i `src/lib/ivion-sdk.ts` tillganglig
3. `Ivion360View.tsx` byter automatiskt fran iframe till SDK-lage
4. Kamerasync aktiveras i `useIvionCameraSync.ts`

### Varfor ingen terminal behovs

Lovable kanner av andringar i `package.json` och kor installationen automatiskt. Du behover inte oppna nagon terminal eller kora `npm install` manuellt.

## Filer som andras

| Fil | Andring |
|-----|---------|
| `package.json` | Lagg till `"@navvis/ivion": "file:navvis-ivion-11.9.8.tgz"` i dependencies |

## Forvantad effekt

- Split View: SDK-lage aktiveras, `renderMode = 'sdk'`, bi-direktionell kamerapolling startar
- Ingen annan kodfil behover andras -- allt ar redan forberett

