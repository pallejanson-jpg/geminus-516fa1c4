

## Koppla frontend till SWG Support-proxy

### Problem
1. **SupportCaseList** hämtar ärenden från lokal databas (`support_cases`-tabellen) istället för SWG:s API via `support-proxy`
2. **CreateSupportCase** har felaktiga kategorier -- ska matcha SWG-portalens "Typ av ärende" (se bild 1)

### Ändringar

#### 1. SupportCaseList.tsx -- Hämta från SWG-proxy
- Byt `fetchCases` från `supabase.from('support_cases')` till `supabase.functions.invoke('support-proxy', { body: { action: 'list-requests', filter } })`
- Mappa SWG:s datastruktur (id, namn, område, skapad, typ av ärende, status) till komponentens `SupportCase` interface
- Uppdatera STATUS_FILTERS till SWG:s statusar: New, UnderReview, AwaitingResponse, AwaitingOrder, Planned, InProgress, Done, Completed, Closed
- Uppdatera STATUS_CONFIG med matchande svenska etiketter och ikoner
- Uppdatera CATEGORY_LABELS till SWG:s ärendetyper
- Ta bort Supabase realtime-prenumeration (inte relevant för externt API)

#### 2. CreateSupportCase.tsx -- Rätt ärendetyper + skicka via proxy
- Byt CATEGORY_OPTIONS till SWG:s typer:
  - Ritningsfiler - inleverans
  - Ritningsfiler - inleverans - Revit A
  - Ritningsfiler - inleverans - Modell, CAD
  - Ritningsfiler - plottning
  - Ritningsfiler - utskick
  - Ändring av areor
  - Visualisering
  - Laserskanning
  - Outdoor
  - Asset+
  - Interaxo
  - Supportärende
  - Annat ärende
- Uppdatera `handleSubmit` att skicka till proxy: `supabase.functions.invoke('support-proxy', { body: { action: 'create-request', payload } })`
- Behåll lokal kopia i `support_cases` som backup

#### 3. SupportCaseDetail.tsx -- Hämta detaljer via proxy
- Ladda ärende-detaljer och kommentarer via `support-proxy` (actions: `get-request`, `add-comment`)
- Mappa SWG:s kommentarformat till befintligt interface

#### 4. Notering
Vi behöver först testa vad `list-requests` returnerar för datastruktur från SWG:s API, så vi kan mappa rätt fält. Jag kör ett test-anrop som del av implementationen och loggar svaret.

