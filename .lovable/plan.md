
# Cesium Globe — Fas 1 (extruderade byggnader) + Fas 2 (BIM-modeller via glTF)

## Vad som byggs

En ny fullskärmssida `/cesium-globe` utanför AppLayout (precis som `/virtual-twin`) med interaktiv 3D-glob. Fas 1 visar alla 5 byggnader med koordinater som extruderade volymer. Fas 2 laddar faktiska BIM-modeller (XKT → glTF konverterade server-side).

---

## Befintlig data i systemet

**5 byggnader med koordinater** (från `building_settings`):
| Byggnad | Lat | Lng | Rotation |
|---|---|---|---|
| Centralstationen (755950d9...) | 59.336 | 18.013 | 0° |
| Akerselva Atrium (9baa7a3a...) | 59.330 | 18.060 | 108° |
| Stadshuset Nyköping (acc-bim...) | 58.757 | 16.995 | 190° |
| Enköping (e471ea3a...) | 59.523 | 17.495 | 0° |
| Bredäng (cc27795e...) | 59.345 | 18.220 | 0° |

**3 byggnader med XKT-modeller** (Centralstationen: 3 modeller, Akerselva: 2 modeller, Småviken: 2 modeller) — dessa används i Fas 2.

---

## Teknikstack

- **`cesium`** — CesiumJS core (3D globe rendering)
- **`resium`** — React-komponenter för Cesium
- **`vite-plugin-static-copy`** — Kopierar Cesium's statiska workers/assets till public

Cesium Ion-token lagras som backend-hemlighet `CESIUM_ION_TOKEN` och returneras via ny edge function `get-cesium-token` (samma mönster som `get-mapbox-token`).

---

## Arkitektur

```text
/cesium-globe (fullskärmssida, utanför AppLayout)
│
├── CesiumGlobeView (huvud-canvas)
│   ├── Resium Viewer (Cesium Ion bakgrundskarta + terräng)
│   ├── Per byggnad (Fas 1):
│   │   └── BoxGraphics — extruderad 3D-låda med korrekt rotation
│   └── Per byggnad med XKT (Fas 2):
│       └── ModelGraphics — glTF-modell med georeferensmatris
│
├── GlobeBuildingList (vänster sidebar)
│   └── Lista med byggnader → klick flyger till byggnad
│
└── GlobeInfoCard (popup vid val)
    ├── Byggnadsnamn, adress, koordinater
    ├── "Öppna i 3D-visaren" knapp
    └── "Läs in BIM-modell" knapp (Fas 2, om XKT finns)
```

---

## Fas 1: Extruderade byggnadsvolymer

Varje byggnad renderas som en **BoxGraphics** i Cesium Entity API:

- **Position**: `Cartesian3.fromDegrees(lng, lat, höjd/2)`
- **Storlek**: Estimerad baserat på `gross_area` (roten ur area = kant) × antal våningar × 3.2m
- **Rotation**: `HeadingPitchRoll(rotation, 0, 0)` → korrekt orientering
- **Färg**: Semi-transparent primärfärg (indigo-600, alpha 0.7) med vit outline
- **Highlight**: Gul vid hover/val

Antal våningar räknas från `assets`-tabellen (kategori `Building Storey` per byggnad).

### UI-layout

```text
┌─────────────────────────────────────────────────────┐
│ [← Tillbaka]    Cesium Globe    [Lager ▼] [⚙]      │
├───────────┬─────────────────────────────────────────┤
│ Byggnader │                                         │
│ ─────────│          CESIUM ION GLOBE               │
│ 🏢 Central│     (satellitbild + terräng)            │
│ 🏢 Akersel│                                         │
│ 🏢 Stadsh │   [Extruderade byggnader placerade      │
│ 🏢 Enkö.. │    på korrekt geografisk position]      │
│ 🏢 Bredäng│                                         │
│           │              [Info-popup vid val]       │
└───────────┴─────────────────────────────────────────┘
```

---

## Fas 2: Riktiga BIM-modeller via glTF

### Konverteringspipeline

En ny edge function `xkt-to-gltf` konverterar XKT → glTF server-side:

```text
Klient klickar "Läs in BIM-modell"
    ↓
CesiumGlobeView anropar /xkt-to-gltf med { buildingFmGuid, modelId }
    ↓
Edge function:
  1. Kontrollera cache: finns gltf-models/{buildingFmGuid}/{modelId}.gltf?
  2. Om ja → returnera signed URL direkt
  3. Om nej → hämta XKT-fil från xkt-models storage bucket
  4. Parsa XKT med @xeokit/xeokit-convert (XKTModel)
  5. Extrahera geometri och generera glTF JSON + binär buffer
  6. Spara till gltf-models/{buildingFmGuid}/{modelId}.gltf
  7. Returnera signed URL
    ↓
CesiumGlobeView laddar modellen:
  Cesium.Model.fromGltfAsync({
    url: signedUrl,
    modelMatrix: Transforms.headingPitchRollToFixedFrame(
      Cartesian3.fromDegrees(lng, lat, 0),
      new HeadingPitchRoll(toRadians(rotation), 0, 0)
    )
  })
```

### Ny storage bucket

En ny bucket `gltf-models` (icke-publik, signed URLs) skapas via SQL-migration.

### Georeferensmatris

Samma `rotation`-värde från `building_settings` används för att rikta modellen rätt. Cesium's `Transforms.headingPitchRollToFixedFrame()` placerar modellen korrekt på WGS84-ellipsoiden.

---

## Navigering till Cesium Globe

- **Portföljvyn**: Ny knapp "Visa på glob" bredvid befintliga CTA-knappar
- **MobileNav**: Ny knapp i "Mer"-drawern (`cesium_globe`-key)
- **Route**: `/cesium-globe` som fristående route i `App.tsx` (fullskärm, skyddad av auth)

---

## Tekniska filer som ändras/skapas

### Nya filer
```text
src/pages/CesiumGlobe.tsx                    (tunn wrapper, lazy-laddad)
src/components/globe/CesiumGlobeView.tsx     (huvud-komponent, Cesium viewer)
src/components/globe/GlobeBuildingList.tsx   (vänster sidebar)
src/components/globe/GlobeInfoCard.tsx       (info-popup vid byggnadsval)
supabase/functions/get-cesium-token/index.ts (returnerar Ion-token säkert)
supabase/functions/xkt-to-gltf/index.ts     (XKT → glTF konvertering)
```

### Ändrade filer
```text
vite.config.ts                              (viteStaticCopy för Cesium assets)
src/App.tsx                                 (ny /cesium-globe route)
src/components/portfolio/PortfolioView.tsx  (knapp "Visa på glob")
src/components/layout/MobileNav.tsx         (Cesium Globe i Mer-drawern)
supabase/config.toml                        (verify_jwt = false för get-cesium-token)
package.json                                (cesium, resium, vite-plugin-static-copy)
```

### SQL-migration
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('gltf-models', 'gltf-models', false);

CREATE POLICY "Authenticated users can read gltf models"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'gltf-models');

CREATE POLICY "Service role can write gltf models"
ON storage.objects FOR INSERT TO service_role
USING (bucket_id = 'gltf-models');
```

---

## Hemlighet

**`CESIUM_ION_TOKEN`** lagras som backend-hemlighet (token du angav). Hämtas klient-sidan via den nya `get-cesium-token`-funktionen med samma mönster som `get-mapbox-token`. Token visas aldrig i frontend-koden.

---

## Vad detta löser

| Fas | Funktion | Resultat |
|---|---|---|
| Fas 1 | Extruderade 3D-volymer på glob | Portföljöversikt av alla 5 byggnader geografiskt |
| Fas 1 | Klick → info-popup | Byggnadsnamn, koordinater, länk till 3D-visaren |
| Fas 1 | Korrekt rotation per byggnad | Nyköping (190°), Akerselva (108°) pekar rätt |
| Fas 2 | XKT → glTF server-konvertering | Riktiga IFC-modeller på globen |
| Fas 2 | Georeferensmatris + rotation | Korrekt orientering (samma data som Virtual Twin) |
| Fas 2 | glTF-cache i storage | Konverteras en gång, laddas snabbt sedan |
