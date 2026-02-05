
# Plan: Asset+ Datakonsistens och XKT-caching

## Problemanalys

Jag har identifierat tre huvudproblem baserat på undersökningen:

### 1. Datadiskrepans (4,034 lokala vs 2,802 i Asset+)
- Lokalt finns 4,034 strukturobjekt (Building, Storey, Space)
- Asset+ har 2,802 - detta innebär **1,232 "orphan"-objekt** i Geminus
- Dessa objekt har tagits bort i Asset+ men finns kvar lokalt
- Nuvarande synk gör bara **upsert** (lägger till/uppdaterar) men **tar aldrig bort**

### 2. XKT-cachning fungerar inte
- Databasen visar **0 XKT-modeller** trots att XKT-synken visas som "completed"
- Problemet: Server-side synk kan inte ladda ner XKT-filer pga API-restriktioner
- Cache-on-Load-strategin fungerar bara när användaren manuellt öppnar 3D-viewern
- Stora modeller laddas om från Asset+ varje gång

### 3. Synk-feedback är otydlig
- Spinner snurrar utan tidsuppskattning eller framsteg
- Svårt att veta om synken verkligen körs eller har fastnat
- "interrupted"-status förklaras inte tydligt

---

## Lösningsstrategi

### Del 1: Automatisk datakonsistenskontroll

**Ny komponent: DataConsistencyChecker**

Vid appstart eller byggnadsbyte kontrolleras automatiskt om lokal data matchar Asset+:

```text
┌────────────────────────────────────┐
│  Datakonsistenskontroll            │
├────────────────────────────────────┤
│  Lokalt: 4,034 objekt              │
│  Asset+: 2,802 objekt              │
│  ⚠️ 1,232 objekt finns bara lokalt │
├────────────────────────────────────┤
│  [Synka nu]  [Visa skillnader]     │
└────────────────────────────────────┘
```

**Ny edge function action: `check-delta`**
- Hämtar fmGuids från Asset+ för struktur och jämför mot lokal databas
- Returnerar: `{ orphanCount, newCount, updatedCount }`

**Ny edge function action: `sync-with-cleanup`**
- Utför full synk med borttagning av objekt som inte längre finns i Asset+
- Använder "soft delete" först (markerar borttagna) innan permanent borttagning

### Del 2: Förbättrad XKT-cachning

**Strategi: Proaktiv Cache-on-Navigate**

När användaren navigerar till en byggnad:

1. Kontrollera om XKT-modeller finns cachade
2. Om inte: Visa overlay "Förbereder 3D-modeller för snabbare laddning..."
3. Ladda viewern - modeller cachas automatiskt via fetch-interceptor
4. Nästa gång: Direktladdning från cache

**Förbättringar i useXktPreload:**
- Visa tydlig status när modeller cachas
- Prioritera aktiv byggnad före andra
- Memory-cache + database-cache fallback

**Ny databas-tabell: `xkt_cache_status`**
- Spårar vilka byggnader som har fullständig XKT-cache
- Möjliggör snabb "är cachen komplett?"-kontroll

### Del 3: Förbättrad synk-UI med realtidsfeedback

**Ny synkstatus-banner i AppHeader:**

```text
┌─────────────────────────────────────────────────┐
│ 🔄 Synkar tillgångar: 24,500 / 82,555 (30%)     │
│     Byggnad 8/14: Smv                           │
│     ████████░░░░░░░░░░░░  ~15 min kvar          │
└─────────────────────────────────────────────────┘
```

**Realtime-uppdateringar:**
- Använd Supabase Realtime för att lyssna på `asset_sync_state`-ändringar
- Visa framstegsindikator med uppskattad tid
- Toast-notifikationer vid fel eller avbrott

### Del 4: Automatisk bakgrundssynk

**Schemalagd kontroll:**
- Vid appstart: Kontrollera `dateModified` för senaste objekt i Asset+
- Om Asset+ har nyare data: Visa banner "Ny data tillgänglig"
- Användaren kan välja att synka eller ignorera

**Webhook-integration (framtida):**
- Asset+ skickar webhook vid ändringar
- Geminus triggar automatisk bakgrundssynk

---

## Implementationsordning

| Prio | Uppgift | Fil(er) |
|------|---------|---------|
| 1 | Skapa `check-delta` action i asset-plus-sync | `supabase/functions/asset-plus-sync/index.ts` |
| 2 | Skapa DataConsistencyBanner komponent | `src/components/common/DataConsistencyBanner.tsx` |
| 3 | Lägg till datakontroll vid appstart | `src/App.tsx` eller `AppLayout.tsx` |
| 4 | Skapa `sync-with-cleanup` action | `supabase/functions/asset-plus-sync/index.ts` |
| 5 | Förbättra synk-UI med realtidsfeedback | `src/components/settings/ApiSettingsModal.tsx` |
| 6 | Skapa SyncProgressBanner för AppHeader | `src/components/layout/SyncProgressBanner.tsx` |
| 7 | Aktivera Realtime för asset_sync_state | Migration + subscription i komponenter |
| 8 | Förbättra XKT-caching med statusspårning | `src/hooks/useXktPreload.ts`, ny tabell |

---

## Dataflöde för konsistenskontroll

```text
App Start
    │
    ▼
┌────────────────────────────┐
│ check-delta (edge function)│
│ - Hämta fmGuids från Asset+│
│ - Jämför med lokal databas │
└────────────────────────────┘
    │
    ▼
┌────────────────────────────┐
│ Om skillnad > tröskelvärde │
│ → Visa DataConsistencyBanner│
└────────────────────────────┘
    │
    ▼
┌────────────────────────────┐
│ Användaren väljer:         │
│ [Synka nu] → sync-with-cleanup
│ [Ignorera] → stäng banner │
└────────────────────────────┘
```

---

## Tekniska detaljer

### Ny edge function action: check-delta

```typescript
case 'check-delta': {
  const accessToken = await getAccessToken();
  
  // Hämta alla fmGuids från Asset+ (endast struktur)
  const remoteGuids = await fetchAllFmGuids(accessToken, [1, 2, 3]);
  
  // Hämta lokala fmGuids
  const { data: localGuids } = await supabase
    .from('assets')
    .select('fm_guid')
    .in('category', ['Building', 'Building Storey', 'Space']);
  
  const localSet = new Set(localGuids.map(g => g.fm_guid));
  const remoteSet = new Set(remoteGuids);
  
  // Hitta orphans (finns lokalt men inte i Asset+)
  const orphans = [...localSet].filter(g => !remoteSet.has(g));
  
  // Hitta nya (finns i Asset+ men inte lokalt)
  const newItems = [...remoteSet].filter(g => !localSet.has(g));
  
  return jsonResponse({
    success: true,
    localCount: localSet.size,
    remoteCount: remoteSet.size,
    orphanCount: orphans.length,
    newCount: newItems.length,
    inSync: orphans.length === 0 && newItems.length === 0
  });
}
```

### Realtime-subscription för synkstatus

```typescript
// I AppLayout eller App.tsx
useEffect(() => {
  const channel = supabase
    .channel('sync-status')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'asset_sync_state'
    }, (payload) => {
      setSyncStatus(payload.new as SyncStatus);
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, []);
```

### Migration för Realtime

```sql
-- Aktivera realtime för asset_sync_state
ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_sync_state;
```

---

## Förväntade resultat

Efter implementation:

1. **Automatisk varning** när data inte stämmer överens
2. **En-klicks-synk** med borttagning av orphan-objekt
3. **Tydlig feedback** under synk med framsteg och tidsuppskattning
4. **Snabbare 3D-laddning** genom förbättrad XKT-caching
5. **Realtime-uppdateringar** av synkstatus i hela appen

---

## Alternativ: Webhook-baserad realtidssynk (Fas 2)

Om Asset+ stödjer webhooks kan vi implementera:
- Asset+ triggar webhook vid CUD-operationer
- Geminus edge function tar emot och uppdaterar lokal databas
- Fullständig realtidssynkronisering utan manuell intervention
