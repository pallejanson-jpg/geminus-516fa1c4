

# Koppla Felanmälan till er-rep.com API

## Sammanfattning

Felanmälan ska skickas till er-rep.com:s API istallet for att sparas lokalt i work_orders-tabellen. Baserat pa nätverksanalysen från er-rep.com har vi identifierat följande API-mönster:

| Egenskap | Värde |
|----------|-------|
| Hämta konfiguration | `GET https://er-rep.com/api/v1/errorreport/register/{qr_key}` |
| Skicka felanmälan | `PUT https://er-rep.com/api/v1/errorreport/register/{qr_key}` |
| Autentisering | Ingen (publikt API, QR-nyckeln fungerar som identifierare) |

**Payload-format (PUT):**
```text
{
  "errorDescription": "Beskrivning av felet",
  "attachments": [],
  "contactEmail": "email@example.com",
  "contactPhone": "0701234567",
  "errorCode": {
    "description": "",
    "context": null,
    "guid": 4400051551,
    "id": "avkalka",
    "title": "Kalka av kaffemaskin"
  }
}
```

## Arkitekturandringar

Istallet for att anvanda FM Access-konfigurationen (Keycloak, token URL etc.) skapas en dedikerad edge function som proxar direkt till er-rep.com. API:t ar publikt och kraver ingen autentisering -- QR-nyckeln fungerar som identifierare.

GET-anropet vid sidladdning returnerar installationsinfo OCH tillgangliga felkoder, vilket innebar att vi kan ta bort den hardkodade felkodslistan och istallet anvanda dynamiska felkoder fran API:t.

## Plan

### Steg 1: Skapa ny edge function -- errorreport-proxy

Ny fil: `supabase/functions/errorreport-proxy/index.ts`

Denna edge function proxar anrop till er-rep.com:s API:

- **action: 'get-config'** -- Gor GET till `er-rep.com/api/v1/errorreport/register/{qrKey}` och returnerar installationsinfo och tillgangliga felkoder
- **action: 'submit'** -- Gor PUT till `er-rep.com/api/v1/errorreport/register/{qrKey}` med formulardatan

Edge functionen behover inget JWT (publikt formulär) och konfigureras i `supabase/config.toml` med `verify_jwt = false`.

Basen-URL:en (`https://er-rep.com`) lagras som en Supabase-secret (`ERRORREPORT_API_URL`) for flexibilitet.

### Steg 2: Uppdatera FaultReport.tsx

Andrar den publika QR-baserade felanmälans flöde:

**Nuvarande flöde:**
1. Lasa QR-nyckel fran `?key=XXX`
2. Sla upp i `qr_report_configs`-tabellen
3. Visa formulär med lokal data
4. Spara i `work_orders`-tabellen

**Nytt flöde:**
1. Lasa QR-nyckel fran `?key=XXX`
2. Anropa edge function GET for att hamta installationsinfo och felkoder fran er-rep.com
3. Visa formulär med data fran API:t (inklusive dynamiska felkoder)
4. Vid "Skicka" -- anropa edge function PUT for att skicka till er-rep.com
5. (Valfritt) Spara en lokal kopia i `work_orders` for historik

### Steg 3: Uppdatera ErrorCodeCombobox

Andrar fran hardkodade felkoder till dynamiska:

**Nuvarande:** Hardkodade platshallare (EL001, VVS001 etc.)

**Nytt:** Tar emot en lista med felkoder som prop fran API-svaret:
```text
interface ErrorCode {
  guid: number;
  id: string;
  title: string;
  description: string;
  context: string | null;
}
```

Comboboxen visar `title` (t.ex. "Kalka av kaffemaskin") och returnerar hela errorCode-objektet vid val.

### Steg 4: Uppdatera FaultReportForm och MobileFaultReport

- Lagg till en ny prop `errorCodes` som skickas till ErrorCodeCombobox
- Andra `errorCode`-fältet i formulärdata fran `string` till det strukturerade errorCode-objektet (med guid, id, title etc.)
- Uppdatera `FaultReportFormData`-typen for att matcha det nya payload-formatet

### Steg 5: Uppdatera InAppFaultReport.tsx

Samma andring av submit-logik -- skicka till edge function istallet for `work_orders`. 
Dock beror in-app-versionen pa `faultReportPrefill` fran AppContext istallet for QR-nyckel. Om ingen QR-nyckel finns tillganglig faller vi tillbaka till lokal sparning.

### Steg 6: Uppdatera FaultReportSuccess

Visa referensnumret/bekraftelsen fran er-rep.com API:ts svar istallet for det lokalt genererade `FR-xxxx`-ID:t.

## Filer som andras

| Fil | Andring |
|-----|---------|
| `supabase/functions/errorreport-proxy/index.ts` | **Ny** -- proxy-edge function for er-rep.com API |
| `supabase/config.toml` | Lagg till `[functions.errorreport-proxy]` med `verify_jwt = false` |
| `src/pages/FaultReport.tsx` | Byt fran lokal DB-sparning till edge function-anrop |
| `src/components/fault-report/InAppFaultReport.tsx` | Samma andring av submit-logik |
| `src/components/fault-report/FaultReportForm.tsx` | Ny prop for dynamiska felkoder, uppdaterad formulärdatatyp |
| `src/components/fault-report/MobileFaultReport.tsx` | Samma andring som FaultReportForm |
| `src/components/fault-report/ErrorCodeCombobox.tsx` | Dynamiska felkoder via props istallet for hardkodade |
| `src/components/fault-report/FaultReportSuccess.tsx` | Visa API-referensnummer |

## Secrets som behövs

| Secret | Värde | Syfte |
|--------|-------|-------|
| `ERRORREPORT_API_URL` | `https://er-rep.com` | Bas-URL for er-rep.com API |

## Risker och osäkerheter

1. **GET-svarets exakta format** -- Vi vet PUT-payloaden men inte exakt hur GET-svaret ser ut (vilka falt som returneras for installationsinfo och felkoder). Implementationen görs flexibelt och justeras efter testning.

2. **Bilagor (attachments)** -- Nuvarande payload har `attachments: []`. Om er-rep.com stodjer bilduppladdning behover vi ta reda pa formatet (base64, URL, multipart). Tills vidare skickas en tom array och bilder sparas lokalt.

3. **InApp-felanmälan utan QR-nyckel** -- In-app-versionen har ingen QR-nyckel. Behover utredas om den ocksa ska anvanda er-rep.com eller fortsatta spara lokalt.
