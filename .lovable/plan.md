# Plan: Split-View Integration - 3D + 360° Side-by-Side Navigation

## ✅ Fas 1 Implementerad

Split-View funktionen är nu implementerad med grundläggande funktionalitet. Du kan öppna 3D-modellen och 360°-vyn sida vid sida med en dragbar separator.

### Skapade filer

| Fil | Beskrivning |
|-----|-------------|
| `src/context/ViewerSyncContext.tsx` | Synkroniseringsmotor med state för position, heading, och source |
| `src/pages/SplitViewer.tsx` | Split View sida med resizable panels |

### Ändrade filer

| Fil | Ändring |
|-----|---------|
| `src/App.tsx` | Lade till `/split-viewer` route |
| `src/components/portfolio/FacilityCard.tsx` | Lade till Split-ikon på byggnadskort |
| `src/components/layout/MainContent.tsx` | Import update |

### Hur man använder

1. Gå till **Portfolio**
2. Hitta ett byggnadskort med konfigurerad Ivion Site ID
3. Klicka på **Split-ikonen** (⊟) i nedre högra hörnet
4. Split View öppnas med 3D till vänster och 360° till höger

### URL-format

```
/split-viewer?building=<fmGuid>
```

---

## 🔜 Fas 2: Kamerasynkronisering (Framtida)

### Ändringar som behövs

| Komponent | Ändring |
|-----------|---------|
| `AssetPlusViewer.tsx` | Lägg till `onCameraChanged` callback och `syncEnabled` prop |
| `Ivion360View.tsx` | Lägg till PostMessage-kommunikation för navigering |
| `ViewerSyncContext.tsx` | Lägg till koordinattransformering (local ↔ geo) |

### PostMessage-protokoll för IVION

```javascript
// Sända till IVION iframe
{
  type: 'navvis-command',
  action: 'moveToGeoLocation',
  params: { lat, lng, heading, pitch }
}

// Ta emot från IVION iframe
{
  type: 'navvis-event',
  event: 'camera-changed',
  data: { location, heading, pitch, panoramaId }
}
```

---

## Arkitektur

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  ViewerSyncProvider                                                     │
│  ├── syncLocked: boolean                                                │
│  ├── syncState: { position, heading, pitch, source, timestamp }         │
│  ├── updateFrom3D(coords, heading)                                      │
│  └── updateFromIvion(coords, heading)                                   │
└─────────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
   ┌──────────────────┐           ┌──────────────────┐
   │  AssetPlusViewer │           │  Ivion360View    │
   │  - 3D Model      │           │  - 360° Panorama │
   │  - xeokit        │           │  - NavVis Ivion  │
   └──────────────────┘           └──────────────────┘
```

---

## Användarflöden

### Scenario 1: Verifikation av inventerade tillgångar

1. Öppna Split View för en byggnad
2. I 3D-vyn: Klicka på en annotation
3. 360°-vyn: Navigerar till närmaste panorama (Fas 2)
4. Verifiera visuellt att positionen matchar

### Scenario 2: Fri utforskning

1. Stäng av synk (Sync Lock = OFF)
2. Navigera fritt i båda vyerna
3. Klicka "Synka" för att matcha positioner (Fas 2)

