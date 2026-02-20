

## Fix: Byggfel (412) och 3D i Smaviken

### Rotorsak: Bygget ar trasigt

Hela appen visar "HTTP ERROR 412" -- ingenting fungerar, inte bara 3D. Detta beror pa ett kompileringsfel fran de senaste andringarna. Tva specifika problem har identifierats:

### Problem 1: Inkonsekvent alarm-event-format i BuildingInsightsView

I `BuildingInsightsView.tsx` finns TVA olika format for alarm-events:

- **Rad 992** (ovannivaknappar): Skickar gamla formatet med `x, y, z` koordinater (som alltid ar null)
- **Rad 1112 och 1185** (vanings- och enskilda alarm): Skickar det nya formatet med `roomFmGuid`

Det gamla formatet pa rad 992 matchar inte langre `AlarmAnnotationsShowDetail`-typen som nu forvanter `roomFmGuid` istallet for `x/y/z`. Detta kan orsaka TypeScript-kompileringsfel.

**Fix:** Uppdatera rad 991-992 sa att det anvander samma `roomFmGuid`-format som de andra dispatcherna:
```
.map((a: any) => ({ fmGuid: a.fm_guid, roomFmGuid: a.in_room_fm_guid }))
```

### Problem 2: XKT-filter loggbugg (kosmetisk)

Loggen visar "Initial load restricted to 0.5 A-model(s)" for att `aModelIds.add(id)` och `aModelIds.add(id.toLowerCase())` laggar till samma strang (UUID ar redan lowercase), sa Set-storleken = 1 istallet for 2. Delat med 2 = 0.5. Sjalva filtret fungerar korrekt -- det ar bara loggen som visar fel.

**Fix:** Andra loggberakningen fran `aModelIds.size / 2` till att rakna unika modell-ID:n korrekt.

### Filer som andras

| Fil | Andring |
|---|---|
| `src/components/insights/BuildingInsightsView.tsx` | Fixa rad 991-992: byt `x/y/z`-format till `roomFmGuid`-format for alarm-event dispatch |
| `src/components/viewer/AssetPlusViewer.tsx` | Fixa XKT-filter-logg: byt `aModelIds.size / 2` till korrekt rakning |

### Prioritetsordning

1. **Fixa alarm-event-formatet** -- detta loser troligen byggfelet (412)
2. **Fixa XKT-logg** -- kosmetisk fix

