

## Plan: Lägg till "Köa alla byggnader"-knapp i Buildings-panelen

### Ändring

**`src/components/settings/CreateBuildingPanel.tsx`**

Lägg till en knapp **ovanför** byggnadsväljaren (eller nedanför accordion-listan) som:

1. Anropar edge-funktionen `conversion-worker-api` med action `batch-enqueue` och `created_by` satt till inloggad användare
2. Visar laddningsindikator under anropet
3. Visar toast med antal köade jobb efter framgång
4. Knappen visas alltid (inte bara när en byggnad är vald) — den köar **alla** byggnader

**UI**: En `Button` med ikon `PlayCircle` och text "Köa alla byggnader" placerad som en separat sektion under byggnadsväljaren, separerad med en divider.

### Tekniska detaljer

- Anropet görs via `supabase.functions.invoke('conversion-worker-api', { body: { created_by: userId } })` med custom header för action
- Alternativt: fetch direkt mot edge function URL med `?action=batch-enqueue` och `WORKER_API_SECRET` — men eftersom det är en autentiserad användare bör vi använda SDK:n
- Behöver hämta `auth.uid()` via `supabase.auth.getUser()`

