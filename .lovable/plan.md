

# Implementera er-rep.com API-integration

## Oversikt

Hardkoda `https://er-rep.com` som bas-URL i en ny edge function och koppla felanmälan-formuläret till det externa API:t istallet for lokal databasskrivning.

## Steg-for-steg

### 1. Skapa edge function `errorreport-proxy`

Ny fil: `supabase/functions/errorreport-proxy/index.ts`

- Stodjer tva actions via JSON body:
  - `action: "get-config"` med `qrKey` -- gor `GET` till `https://er-rep.com/api/v1/errorreport/register/{qrKey}` och returnerar konfiguration + felkoder
  - `action: "submit"` med `qrKey` + `payload` -- gor `PUT` till `https://er-rep.com/api/v1/errorreport/register/{qrKey}` med payload
- Hardkodad bas-URL: `https://er-rep.com`
- CORS-headers for webbappanrop
- `verify_jwt = false` i config.toml (publikt formulär)

### 2. Uppdatera `ErrorCodeCombobox`

Fil: `src/components/fault-report/ErrorCodeCombobox.tsx`

- Exportera ett nytt `ErrorCode`-interface: `{ guid: number; id: string; title: string; description: string; context: string | null }`
- Ny prop `errorCodes: ErrorCode[]` (valfri, fallback till hardkodade om tom/undefined)
- Andrad `value`/`onChange` fran `string` till `ErrorCode | null` for att skicka hela objektet
- Visa `title` i comboboxen (t.ex. "Kalka av kaffemaskin")

### 3. Uppdatera `FaultReportForm`

Fil: `src/components/fault-report/FaultReportForm.tsx`

- Ny prop `errorCodes?: ErrorCode[]` som skickas vidare till `ErrorCodeCombobox`
- Andra zod-schema: `errorCode`-faltet fran `string` till `any` (strukturerat ErrorCode-objekt eller null)
- Uppdatera `FaultReportFormData`-typen

### 4. Uppdatera `MobileFaultReport`

Fil: `src/components/fault-report/MobileFaultReport.tsx`

- Samma andringar som FaultReportForm: ny `errorCodes`-prop och uppdaterat zod-schema

### 5. Uppdatera `FaultReport.tsx` (QR-baserad sida)

Fil: `src/pages/FaultReport.tsx`

- Ta bort `qr_report_configs`-uppslag
- Vid sidladdning: anropa edge function med `action: "get-config"` for att hamta installationsinfo och felkoder fran er-rep.com
- Vid submit: anropa edge function med `action: "submit"` istallet for att skriva till `work_orders`
- Skicka dynamiska felkoder till formulärkomponenterna
- Visa API-svar (referensnummer) vid lyckad inskickning

### 6. Uppdatera `InAppFaultReport.tsx`

Fil: `src/components/fault-report/InAppFaultReport.tsx`

- InApp-versionen har ingen QR-nyckel, sa den fortsatter att spara lokalt i `work_orders` (oforandrad submit-logik)
- Skickar dock den uppdaterade `errorCode`-typen (strukturerat objekt istallet for string)

### 7. Uppdatera `FaultReportSuccess`

Fil: `src/components/fault-report/FaultReportSuccess.tsx`

- Stodjer API-referensnummer fran er-rep.com-svaret (om tillgangligt)
- Fallback till lokalt genererat ID om inget API-svar finns

### 8. Uppdatera `supabase/config.toml`

Lagg till:
```text
[functions.errorreport-proxy]
verify_jwt = false
```

## Tekniska detaljer

### Edge function payload-format

**GET config:**
```text
POST /errorreport-proxy
Body: { "action": "get-config", "qrKey": "iEybZKPDykiVFrhDo8AJng" }
```

**Submit:**
```text
POST /errorreport-proxy
Body: {
  "action": "submit",
  "qrKey": "iEybZKPDykiVFrhDo8AJng",
  "payload": {
    "errorDescription": "Felet ar...",
    "attachments": [],
    "contactEmail": "test@test.com",
    "contactPhone": "070123456",
    "errorCode": {
      "guid": 4400051551,
      "id": "avkalka",
      "title": "Kalka av kaffemaskin",
      "description": "",
      "context": null
    }
  }
}
```

### Filer som andras

| Fil | Typ |
|-----|-----|
| `supabase/functions/errorreport-proxy/index.ts` | Ny |
| `supabase/config.toml` | Lagg till entry |
| `src/components/fault-report/ErrorCodeCombobox.tsx` | Uppdatera |
| `src/components/fault-report/FaultReportForm.tsx` | Uppdatera |
| `src/components/fault-report/MobileFaultReport.tsx` | Uppdatera |
| `src/pages/FaultReport.tsx` | Uppdatera |
| `src/components/fault-report/InAppFaultReport.tsx` | Uppdatera |
| `src/components/fault-report/FaultReportSuccess.tsx` | Uppdatera |

### Ingen secret behovs

Bas-URL:en hardkodas direkt i edge function:en som `https://er-rep.com`.

### Risker

- **GET-svarets format ar okant** -- vi tolkar svaret flexibelt och loggar det for felsökning
- **Bilagor** -- skickas som tom array tills vidare (`attachments: []`)
- **InApp saknar QR-nyckel** -- fortsatter anvanda lokal databasskrivning

