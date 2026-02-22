

## Forbattrad kamerasynk i Split-lage (3D foljer 360)

### Problem

Nar 360-panoramans position mappas direkt till 3D-kamerans `eye` hamnar man ofta inne i vaggar, golv eller for nara objekt. Originalforslaget med +3m Y-offset ar for mycket — det gar igenom bjalklag i vanliga rum (2.4m takhhojd).

### Reviderad strategi

Istallet for en stor vertikal offset, anvands en **kombinerad offset**:

1. **Liten Y-offset: +0.8 meter** — lyfter kameran fran panoramahojden (~1.5m) till ~2.3m, under taket men over mobelhojd
2. **Bakat-offset: 1.5 meter langs motsatt blickriktning** — backar kameran fran positionen sa man ser rummet med lite perspektiv istallet for att sta mitt i det
3. **Pitch-clamp: max -20 grader nedat** — forhindrar att kameran tittar rakt i golvet, men tillater rimlig nedatvinkel
4. **flyTo med 0.5s duration** — smidig overgang (redan implementerat, behover bara justeras)

### Teknisk implementation

**Fil: `src/hooks/useViewerCameraSync.ts`**

I effekten som reagerar pa `syncState.source === 'ivion'` (ca rad 97-130):

```text
Nuvarande logik:
  eye = [position.x, position.y, position.z]
  look = calculateLookFromHeadingPitch(eye, heading, pitch)

Ny logik:
  // Berakna blickriktning som enhetsvektor fran heading
  headingRad = heading * (PI / 180)
  dirX = sin(headingRad)
  dirZ = cos(headingRad)

  // Offset eye: +0.8m uppat, -1.5m langs blickriktningen (bakat)
  eye = [
    position.x - dirX * 1.5,
    position.y + 0.8,
    position.z - dirZ * 1.5
  ]

  // Clamp pitch till [-20, 90]
  clampedPitch = max(-20, min(90, pitch))

  // Look-punkt: fran det nya eye, 10m framat i blickriktningen
  look = calculateLookFromHeadingPitch(eye, heading, clampedPitch)
```

Denna andring paverkar **bara Split-lage** (nar `syncState.source === 'ivion'` i `useViewerCameraSync`). Virtual Twin-laget anvander en annan synkmekanism och paverkas inte.

### Ovriga delar fran foregaende plan (oforandrade)

- **Ta bort alignment-knapp**: Ny knapp i AlignmentPanel med bekraftelsedialog, nollstaller alla 4 falt i `building_settings`
- **Forenkla AlignmentPanel**: Gom manuella reglage (Offset X/Y/Z, Rotation) bakom kollapserbar "Avancerat"-sektion, lat punktkalibrering vara primarverktyget

