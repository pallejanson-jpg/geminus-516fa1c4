

## Plan: Adressinmatning, klickbara steg och "Visa i byggnaden"-fix

### Problem
1. **Origin**: Idag kan man bara använda GPS — ingen möjlighet att skriva in adress eller klicka i kartan
2. **"Visa i byggnaden"**: Knappen visas bara om `indoorRoute` finns (kräver valt rum + navigationsgraf) — syns sällan
3. **Steg ej klickbara**: Timeline-stegen har ingen interaktion — klick bör zooma kartan till stegets position

### Ändringar

#### 1. Adressinmatning + kartklick som origin (`NavigationMapPanel.tsx` + `MapView.tsx`)

**NavigationMapPanel:**
- Gör origin-inputfältet **redigerbart** (ta bort `readOnly`)
- Lägg till **Mapbox Geocoding** via edge function `get-mapbox-token` + klientanrop till `https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json`
- Visa en enkel dropdown med geocoding-resultat under inputfältet vid inmatning (debounce 300ms)
- Lägg till en tredje knapp bredvid GPS-knappen: 📍 "Välj i kartan" som aktiverar ett klick-läge
- Ny prop `onRequestMapClick` + `mapClickedPosition` — när användaren klickar kartan sätts origin

**MapView:**
- Nytt state `pickingOrigin: boolean` — när aktivt, nästa kartklick sätter origin istället för normal interaktion
- Skicka `onRequestMapClick` och `mapClickedPosition` som props till `NavigationMapPanel`
- Visuell indikator (cursor crosshair + liten banner "Klicka i kartan") under pick-läge

#### 2. Visa "Visa i byggnaden" alltid när byggnad är vald (`NavigationMapPanel.tsx`)

Ändra villkoret från `hasIndoorRoute && onShowIndoor` till `routeSummary && selectedBuildingGuid && onShowIndoor` — knappen ska alltid visas efter att en rutt beräknats, oavsett om indoor-rutt beräknats. Uppdatera `onShowIndoor` i MapView att navigera till viewern med byggnaden även utan `indoorRoute`.

#### 3. Klickbara steg med kart-feedback (`NavigationMapPanel.tsx` + `MapView.tsx`)

**NavigationMapPanel:**
- Utöka varje steg i `displaySteps` med `coordinates` (start-koordinat för steget, hämtat från steps-data)
- Ny prop `onStepClick(index: number, coords: {lat, lng})` — anropas vid klick på ett steg
- Ny prop `activeStepIndex` — markerar aktivt steg visuellt (bakgrundsfärg)
- Varje steg-rad får `cursor-pointer`, hover-effekt och `onClick`

**MapView:**
- State `activeStepIndex` + `activeStepCoords`
- Vid steg-klick: `flyTo` med zoom ~15 till stegets koordinat + visa en pulsande markör
- Parsning: Mapbox-steg har redan `maneuver.location`, Google transit-steg behöver start-koordinat från polyline-segmentet

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `src/components/map/NavigationMapPanel.tsx` | Editable origin, geocoding dropdown, kartklick-knapp, klickbara steg, visa-i-byggnaden-fix |
| `src/components/map/MapView.tsx` | Pick-origin-läge, steg-klick flyTo, utökade props till NavigationMapPanel |

### Teknisk sammanfattning

```text
Origin-val (tre alternativ):
├── 📍 GPS (befintlig)
├── ⌨️  Skriv adress → Mapbox Geocoding → dropdown
└── 🗺️  Klicka i kartan → pickingOrigin-läge

Steg-klick:
├── Klick på steg i listan
├── → flyTo(step.coordinates, zoom 15)
└── → visuell markering i både lista och karta

"Visa i byggnaden":
└── Visas alltid efter rutt beräknats (inte bara vid indoor-rutt)
```

