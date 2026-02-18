
# Tre konkreta fixes: Dashboard, `days`-bugg, och Demo-skylt

## Bugg 1: `days is not defined` – Edge function kraschar

### Rotorsak
På rad 260 i `senslinc-query/index.ts` destructureras `req.json()` men `days` saknas i listan:

```typescript
// Rad 260 – days saknas!
const { action, fmGuid, siteCode, indiceId, workspaceKey, query } = await req.json();
```

Sedan på rad 432 används `days`:
```typescript
const daysBack = days ?? 7;  // ReferenceError: days is not defined
```

Loggen bekräftar exakt: `Error: ReferenceError: days is not defined at Server.<anonymous> (senslinc-query/index.ts:467:28)`

### Fix
Lägg till `days` i destructureringen:
```typescript
const { action, fmGuid, siteCode, indiceId, workspaceKey, query, days } = await req.json();
```

---

## Bugg 2: Småviken dashboard hittas inte

### Rotorsak
`get-dashboard-url` söker med `/api/sites?code=${fmGuid}` – men Senslincs `site.code` är ett UUID (t.ex. `a8fe5835-e293-4ba3-92c6-c7e36f675f23`) medan Asset+ byggnads-fmGuid kan vara ett annat format.

Dessutom: `useSenslincData`-hooken anropar `get-machine-data` med fmGuid för att hitta maskinen. Om fmGuid är ett byggnads-GUID (inte ett rums-GUID) hittas ingen maskin – `get-machine-data` returnerar `success: false` → hook faller tillbaka på mock-data → `data.dashboardUrl` är tom.

**För byggnader** ska `useSenslincBuildingData` användas (som anropar `get-building-sensor-data`) – denna hämtar site-dashboardUrl korrekt. Men i `SenslincDashboardView` används alltid `useSenslincData` (maskin-hooken), inte byggnadshooken.

### Fix
I `SenslincDashboardView.tsx`: identifiera om facilityType är 'building'/'site' och använd i så fall `get-building-sensor-data` (via en separat lookup). Enklast: lägg till `get-building-sensor-data`-stöd i hooken, eller bättre – lägg till ett fallback-anrop i `useSenslincData` som när ingen maskin hittas söker site.

Konkret fix i `useSenslincData.ts`: när `get-machine-data` returnerar "No machine found", gör ett extra anrop till `get-dashboard-url` med fmGuid för att hitta site- eller line-dashboardUrl. Returnera det som `dashboardUrl` med mock sensordata.

Alternativt och renare: i `SenslincDashboardView`, om `senslincDashboardContext` innehåller facilityCategory, välj rätt hook. Men context behöver utökas.

**Vald lösning:** Uppdatera `useSenslincData` (redan befintlig hook) att när machine inte hittas, försöka `get-dashboard-url` för att hämta site/line-URL. Maskindatan fallbackar till mock men dashboardUrl sätts korrekt.

---

## Bugg 3: "Demo"-skylt – ta bort, visa med färg istället

### Var "Demo" visas
1. `SenslincDashboardView.tsx` rad 31-34: `StatusBadge` visar "Demo"-badge
2. `SensorsTab.tsx` rad 37-41: `LiveBadge` visar "Demo"-badge
3. `SensorChart` i `SenslincDashboardView.tsx` rad 309: text "Demodata – ingen Senslinc-koppling"
4. `SenslincDashboardView.tsx` rad 325: "Anslutning till Senslinc ej tillgänglig – visar demodata."

### Fix
- Ta bort "Demo"-badge-varianten ur `StatusBadge` och `LiveBadge` – när inte LIVE, visa ingenting (eller en liten neutral ikon)
- Behåll lila linjer för mock-data i chart (det är den visuella markören)
- Ta bort texten "Demodata – ingen Senslinc-koppling" i `SensorChart`
- Behåll WifiOff-indikatorn men ändra texten till neutral

---

## Tekniska filändringar

### 1. `supabase/functions/senslinc-query/index.ts` (rad 260)
Lägg till `days` i destructuring:
```typescript
const { action, fmGuid, siteCode, indiceId, workspaceKey, query, days } = await req.json() as SenslincRequest;
```

### 2. `src/hooks/useSenslincData.ts`
Lägg till fallback-lookup när maskin inte hittas:
```typescript
// Om get-machine-data returnerar "No machine found":
// Gör ett extra anrop till get-dashboard-url för att hitta site/line-URL
const { data: urlData } = await supabase.functions.invoke('senslinc-query', {
  body: { action: 'get-dashboard-url', fmGuid }
});
if (urlData?.success) {
  dashboardUrl = urlData.data.dashboardUrl;
}
```

### 3. `src/components/viewer/SenslincDashboardView.tsx`
- `StatusBadge`: ta bort "Demo"-variant, visa inget badge (eller liten grå wifi-ikon) när inte LIVE
- Ta bort "Demodata"-text i `SensorChart`-sektionen
- Mjuka upp felmeddelandet

### 4. `src/components/insights/tabs/SensorsTab.tsx`
- `LiveBadge`: ta bort "Demo"-variant, visa inget badge när inte LIVE

---

## Deploy-ordning

1. Fixa edge function (`days`-bugg) → deploy
2. Fixa hook (fallback för site-URL)
3. Ta bort Demo-skyltar i UI-komponenterna

Allt i ett steg för snabbast resultat.
