

# Bygg om Felanmälan -- replikera er-rep.com-formularet med modernt UI

## Bakgrund

Det gamla formularet pa er-rep.com (SWG Nordic) har dessa falt:

| Falt | Typ | Obligatoriskt |
|------|-----|---------------|
| Installation (fran QR) | Visas som rubrik, ej redigerbart | Automatiskt |
| Beskrivning | Textarea | Ja |
| Felkod | Textfalt | Nej |
| Aterkoppling via e-post | E-postfalt | Nej |
| Kontakt, telefonnummer | Telefonfalt | Nej |
| Bifoga bilder | Kamera/filval | Nej |

Det nuvarande formularet i Lovable har helt andra falt (Kategori, Rubrik, Prioritet, Namn) som INTE finns i originalet. Dessa ska bort och ersattas med falt som matchar er-rep.com.

## Vad andras

### 1. Utoka `qr_report_configs`-tabellen

Lagga till falt for installation/utrustningsinfo som QR-koden kopplas till:

- `asset_fm_guid` (text, nullable) -- kopplar till en specifik installation/tillgang
- `asset_name` (text, nullable) -- t.ex. "Kaffemaskin K12"
- `installation_number` (text, nullable) -- t.ex. "000000042"

### 2. Skriva om `FaultReportForm.tsx` helt

Bort med: Kategori, Rubrik, Prioritet, Anmalarens namn.

Nya falt som matchar er-rep.com:

```text
+-----------------------------------------------+
|  Anmal fel                                     |
|                                                |
|  Installation 000000042 Kaffemaskin K12         |
|  (grat inforuta med byggnads/rumskontext)      |
|                                                |
|  Beskrivning *                                 |
|  [ Beskriv felet sa tydligt du kan for att     ]|
|  [ underlatta processen for alla involverade   ]|
|  [ personer                                    ]|
|                                                |
|  Felkod                                        |
|  [ Ange en matchande felkod.                  ]|
|                                                |
|  Aterkoppling via e-post                       |
|  [ Fyll i e-post om du vill ha aterkoppling   ]|
|                                                |
|  Kontakt, telefonnummer                        |
|  [ Fyll i telefonnummer om du vill bli         ]|
|  [ kontaktad                                   ]|
|                                                |
|  Bifoga bilder                                 |
|  [ Ta Bild/Bladdra... ] [bild1] [bild2]        |
|                                                |
|  [ Skicka felanmalan                         ] |
+-----------------------------------------------+
```

### 3. Skriva om `MobileFaultReport.tsx`

Ta bort steg-wizarden (3 steg). Ersatt med ett enda scrollbart formulat med alla falt synliga direkt -- precis som er-rep.com. Modern mobilanpassad layout med:
- Installationsinfo visas prominent i toppen
- Stora knappar for kamera/foto
- "Skicka"-knapp langst ner

### 4. Uppdatera `FaultReport.tsx` (sidan)

- Utoka `QrConfig` interfacet med `asset_fm_guid`, `asset_name`, `installation_number`
- Hamta och visa installationsinfo fran QR-konfigurationen
- Skicka installationsinfo till formularet

### 5. Uppdatera `InAppFaultReport.tsx`

- Anpassa submit-hanteraren till nya faltnamn
- Auto-generera `title` fran installationsinfo + beskrivning (forsta 50 tecken)
- Spara `felkod`, `email`, `phone` i work_order attributes

### 6. Uppdatera submit-logiken

Mappningen fran formularet till `work_orders`-tabellen andras:

| Formularfalt | work_orders-falt |
|---|---|
| Beskrivning | `description` |
| (auto-genererad) | `title` = "Felanmalan: [asset_name]" eller forsta 50 tecken av beskrivning |
| -- | `category` = null (tas bort fran formularet) |
| -- | `priority` = 'medium' (default) |
| -- | `reported_by` = null (inget namnfalt langre) |
| Felkod | `attributes.error_code` |
| E-post | `attributes.reporter_email` |
| Telefon | `attributes.reporter_phone` |
| Foton | `attributes.images` |
| QR-nyckel | `attributes.qr_key` |
| Installationsnr | `attributes.installation_number` |
| Tillgangsnamn | `attributes.asset_name` |

## Teknisk plan

### Steg 1: Databasmigrering
Utoka `qr_report_configs` med tre nya kolumner:
```sql
ALTER TABLE qr_report_configs
  ADD COLUMN asset_fm_guid text,
  ADD COLUMN asset_name text,
  ADD COLUMN installation_number text;
```

### Steg 2: Ny formularschema (Zod)
```text
faultReportSchema:
  description: string, required, max 2000
  errorCode: string, optional, max 100
  email: string, optional, email format
  phone: string, optional, max 20
```

### Steg 3: Bygga om FaultReportForm.tsx
- Ny props: `installationNumber`, `assetName`, `buildingName`, `spaceName`
- Installationsinfo visas som en informationsruta i toppen (ej redigerbar)
- Alla falt i ett enda formulat (ingen wizard)
- Modern Card-layout med tydliga labels och placeholders som matchar originalet
- Behall befintlig `PhotoCapture`-komponent (den fungerar bra)

### Steg 4: Bygga om MobileFaultReport.tsx
- Ta bort steg-wizard
- Ersatt med scrollbart enstegsformular
- Behall header med tillbakaknapp och platsinfo
- Stora touch-vanliga falt och knappar

### Steg 5: Uppdatera FaultReport.tsx
- Utoka QrConfig-interfacet
- Hamta extra kolumner fran qr_report_configs
- Skicka installationsinfo till formularet

### Steg 6: Uppdatera InAppFaultReport.tsx
- Anpassa till nya FaultReportFormData
- Auto-generera title vid submit

### Andrade filer

| Fil | Andring |
|-----|---------|
| `qr_report_configs` (DB) | 3 nya kolumner |
| `src/components/fault-report/FaultReportForm.tsx` | Total omskrivning av falt och schema |
| `src/components/fault-report/MobileFaultReport.tsx` | Ta bort wizard, nytt enstegsformular |
| `src/pages/FaultReport.tsx` | Utokat QrConfig, ny prop-mappning |
| `src/components/fault-report/InAppFaultReport.tsx` | Anpassad submit + auto-title |
| `src/components/fault-report/FaultReportSuccess.tsx` | Mindre UI-justering (visa installationsinfo) |

