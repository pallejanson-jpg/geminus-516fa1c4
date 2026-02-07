

# Felanmalan till FM-systemet via FM Access API

## Sammanfattning

Nuvarande implementation sparar felanmalan lokalt i 'work_orders'-tabellen i databasen. Det riktiga flödet ska istallet skicka felanmalan till FM Access API:t (samma system som er-rep.com anvander). Dessutom ska QR-kodens artikelnummer (t.ex. 000000042) anvandas for att sla upp installationsinformation via 'qr_report_configs'-tabellen, och felkoderna i comboboxen ska matcha de som finns i FM-systemet.

## Identifierade brister

| Problem | Beskrivning |
|---------|-------------|
| Skicka-logik | Sparar lokalt i 'work_orders' istallet for att skicka till FM Access API |
| QR-uppslag | Tabellen 'qr_report_configs' ar tom -- behover fyllas med data, t.ex. for artikelnummer 000000042 |
| Felkoder | Hardkodade platshallare (EL001, VVS001 etc.) -- ska hamtas fran FM Access eller konfigureras ratt |
| FM Access edge function | Har bara 'test-connection', 'get-drawings', 'get-documents' -- saknar 'create-work-order'/'submit-fault-report' |

## Plan

### Steg 1: Utoka fm-access-query edge function

Lagga till en ny action 'create-fault-report' i 'supabase/functions/fm-access-query/index.ts' som:

1. Tar emot felanmalans data (beskrivning, felkod, e-post, telefon, bilder, installationsnummer)
2. Autentiserar mot FM Access via samma Keycloak-flode som redan finns
3. Skickar en POST till FM Access API:t for att skapa en arbetsorder/felanmalan
4. Returnerar det skapade arende-ID:t tillbaka till klienten

Eftersom er-rep.com anvander samma FM Access API behover vi ta reda pa exakt vilken endpoint som anvands. Baserat pa FM Access-konfigurationen i projektet (auth via Keycloak pa auth.bim.cloud med realm 'swg_demo') kommer vi att:
- Anvanda samma autentiseringsflode som redan finns i 'getToken()' och 'getVersionId()'
- Anropa en endpoint som '/api/workorders' eller liknande (standard FM Access mönster)

Steg 1 kraver att vi far veta exakt API-endpoint och payload-format. Jag foreslår att vi borjar med en rimlig implementation baserad pa vanliga FM Access-mönster, och sen justerar om det behövs.

### Steg 2: Uppdatera FaultReport.tsx -- handleSubmit

Andra 'handleSubmit' i 'src/pages/FaultReport.tsx' fran att skriva till 'work_orders'-tabellen till att anropa edge function:

```text
Nuvarande:  supabase.from('work_orders').insert(workOrder)
Nytt:       supabase.functions.invoke('fm-access-query', { body: { action: 'create-fault-report', ... } })
```

Samma andring i 'src/components/fault-report/InAppFaultReport.tsx'.

Optionellt kan vi spara en lokal kopia i work_orders-tabellen ocksa (for historik), men primarflodet ska vara att skicka till FM Access.

### Steg 3: Fylla QR-konfigtabellen

Tabellen 'qr_report_configs' ar tom. For att QR-koden med artikelnummer 000000042 ska fungera behover vi lagga in minst en rad, t.ex.:

```text
qr_key: "000000042"
building_fm_guid: [ratt GUID fran assets-tabellen]
building_name: [byggnadens namn]
asset_fm_guid: [om det finns]
asset_name: "Kaffemaskin K12" (eller liknande)
installation_number: "000000042"
```

Jag slar upp ratt data i assets-tabellen baserat pa artikelnumret.

### Steg 4: Uppdatera felkoderna i ErrorCodeCombobox

De nuvarande platshallarna (EL001, VVS001 etc.) ska bytas ut mot riktiga felkoder. Tva alternativ:

1. **Dynamiskt fran FM Access** -- lagga till en action 'get-error-codes' i edge function som hamtar tillgangliga felkoder
2. **Statisk lista** -- konfigurera felkoderna manuellt om FM Access inte har ett sadant endpoint

Borjar med alternativ 2 (statisk lista) och kan bygga ut till dynamisk hamtning senare.

### Steg 5: Justera QR-flodet

Nuvarande QR-URL-format: '/fault-report?key=XXX'
er-rep.com-format: Artikelnumret ar direkt i URL:en

Vi behover mojligtvis justera URL-formatet sa att det matchar QR-koderna som redan finns utskrivna, t.ex.:
- '/fault-report?key=000000042' (nuvarande format, fungerar redan)
- Alternativt: '/fault-report/000000042' (om QR-koderna pekar hit)

### Filer som andras

| Fil | Andring |
|-----|---------|
| 'supabase/functions/fm-access-query/index.ts' | Lagg till 'create-fault-report' action |
| 'src/pages/FaultReport.tsx' | Andra handleSubmit fran lokal sparning till FM Access API-anrop |
| 'src/components/fault-report/InAppFaultReport.tsx' | Samma andring av handleSubmit |
| 'src/components/fault-report/ErrorCodeCombobox.tsx' | Uppdatera felkodslistan |
| 'src/components/fault-report/FaultReportSuccess.tsx' | Visa FM Access-referensnummer istallet for lokalt ID |

### Databas

- Infoga testdata i 'qr_report_configs' for artikelnummer 000000042

### Osakerhet: FM Access API-endpoint

Den kritiska osakerheten ar exakt vilken endpoint FM Access API:t har for att skapa arbetsordrar. Baserat pa README-dokumentationen finns 'GET /workorders' for lasning, men vi behover POST-endpointen. Jag implementerar en rimlig standard (POST till '/api/workorders' eller '/api/errorreports') och vi justerar om det behövs efter testning.

