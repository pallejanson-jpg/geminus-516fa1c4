

# Plan: Fixa fastlast synk och forbattra testbarhet

## Problem 1: Synken fastnar pa "3/11"

### Rotorsak

Synken ar designad som en **resumable loop**: varje anrop processar byggnader i 45 sekunder, returnerar `interrupted: true`, och forvantar att frontend anropar funktionen igen. Loopen lever i `ApiSettingsModal` via `setTimeout(() => runResumableSync(), 1000)`.

Men om anvandaren stanger fliken, navigerar bort, eller edge function timeout:ar sa hamnar databasen i ett "stale running"-tillstand -- `sync_status = 'running'` men ingen process driver den framåt. `SyncProgressBanner` laser bara status och visar spinnern -- den har ingen logik for att:

1. Upptacka att synken ar stal (startad for 13+ timmar sedan)
2. Erbjuda "Fortsatt synk" eller auto-resume

### Losning: Tre delar

#### a) Stale-detektion i SyncProgressBanner

Lagg till logik som kontrollerar om `last_sync_started_at` ar aldre an 5 minuter och status fortfarande ar `running`. I sa fall:
- Visa en "Synken verkar ha stannat" badge istallet for spinner
- Visa en **"Fortsatt"**-knapp som anropar `sync-assets-resumable`
- Visa en **"Aterstall"**-knapp som nollstaller progress

```text
Logik:
if sync_status === 'running' AND (now - last_sync_started_at) > 5 min:
  -> Visa "Avbruten" med Resume/Reset-knappar
else if sync_status === 'running':
  -> Visa spinner som vanligt
```

#### b) Auto-resume vid appladdning (valfritt)

Nar appen laddas och en stale sync detekteras, auto-trigga `sync-assets-resumable` med en 3-sekunders fordrojning. Visar en toast "Fortsatter avbruten synk...".

#### c) Direkt fix: Nollstall den fastnada synken

For att losa det omedelbara problemet, uppdatera `asset_sync_state` sa att raden for `assets` slattar `running`-status. Detta kan goras genom:
- Edge function-anrop `reset-assets-progress` (finns redan i koden)
- Eller direkt via en knapp i bannern

---

## Problem 2: Senslinc 429

Senslinc-API:t har rate limit. Den exponential backoff som redan implementerats i edge-funktionen kommer hantera detta automatiskt nar ban-perioden slappt. Ingen kodandring behovs -- bara vantan.

For att kunna testa: Lagg till en "Testa anslutning"-knapp i Settings som gor ett minimalt API-anrop (bara `get-indices`) och rapporterar om anslutningen fungerar eller fortfarande ar blockerad.

---

## Filer som andras

| Fil | Andring |
|-----|---------|
| `src/components/layout/SyncProgressBanner.tsx` | Stale-detektion, resume/reset-knappar, auto-resume |
| `src/components/settings/ApiSettingsModal.tsx` | Lagg till "Testa Senslinc"-knapp i Senslinc-fliken |

---

## Tekniska detaljer

### SyncProgressBanner - Stale-detektion och resume

```typescript
// Ny konstant
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// I renderingen, for varje sync:
const isStale = sync.sync_status === 'running' && 
  sync.last_sync_started_at &&
  (Date.now() - new Date(sync.last_sync_started_at).getTime()) > STALE_THRESHOLD_MS;

// Resume-funktion
const handleResume = async (subtreeId: string) => {
  if (subtreeId === 'assets') {
    // Trigger resumable sync
    supabase.functions.invoke('asset-plus-sync', {
      body: { action: 'sync-assets-resumable' }
    }).then(({ data }) => {
      if (data?.interrupted) {
        // Will continue via Realtime updates
        // Call again after delay
        setTimeout(() => handleResume(subtreeId), 2000);
      }
    });
  }
};

// Reset-funktion
const handleReset = async (subtreeId: string) => {
  if (subtreeId === 'assets') {
    await supabase.functions.invoke('asset-plus-sync', {
      body: { action: 'reset-assets-progress' }
    });
  }
};
```

### UI for stale sync

```text
Stalldetektion (isStale = true):
+----------------------------------------------------+
| (!) Synken har stannat - Alla Tillgangar (3/11)     |
|     8 757 objekt synkade                            |
|     [Fortsatt]  [Aterstall]                   [X]   |
+----------------------------------------------------+

Normal running:
+----------------------------------------------------+
| (spin) Synkar Alla Tillgangar (3/11)   8 757 objekt |
|     ==================---  67%                [X]   |
+----------------------------------------------------+
```

### Senslinc-testknapp i Settings

```typescript
const testSenslincConnection = async () => {
  const { data, error } = await supabase.functions.invoke('senslinc-query', {
    body: { action: 'get-indices' }
  });
  
  if (error || !data?.success) {
    toast({
      variant: 'destructive',
      title: 'Anslutningsfel',
      description: data?.error || 'Kunde inte na Senslinc API (mojlig rate limit)',
    });
  } else {
    toast({
      title: 'Anslutning OK',
      description: `Hittade ${data.indices?.length || 0} index`,
    });
  }
};
```

### SyncProgressBanner - Auto-resume vid laddning

Nar komponenten mountar och hittar en stale sync, starta en resume automatiskt efter 3 sekunder:

```typescript
useEffect(() => {
  const staleSync = activeSyncs.find(s => {
    if (s.sync_status !== 'running' || !s.last_sync_started_at) return false;
    return Date.now() - new Date(s.last_sync_started_at).getTime() > STALE_THRESHOLD_MS;
  });
  
  if (staleSync && staleSync.subtree_id === 'assets') {
    const timer = setTimeout(() => handleResume('assets'), 3000);
    return () => clearTimeout(timer);
  }
}, [activeSyncs]);
```

---

## Testplan efter implementering

1. **Omedelbara tester (utan att vanta pa Senslinc):**
   - Oppna appen -- bannern ska visa "Synken har stannat" med resume/reset-knappar
   - Klicka "Aterstall" -- bannern forsvinner, sync-status nollstalls
   - Oppna Settings > Sync -- verifiera att progress-kortet visar "Ej synkad" efter aterstallning
   - Klicka "Synka" pa Tillgangar -- verifiera att loopen kors och progress uppdateras live

2. **CRUD-tester:**
   - Oppna Inventering, skapa ett nytt objekt -- verifiera att det sparas med `is_local = true`
   - Oppna egenskapsdialogen pa det nya objektet -- kontrollera att orange "Lokal" badge visas
   - Testa "Ta bort"-knappen pa det lokala objektet
   - Testa "Pusha till Asset+"-knappen (kraver att Asset+ API fungerar)

3. **Senslinc-test (nar ban slappt):**
   - Oppna Settings > Senslinc > "Testa anslutning"
   - Om OK: oppna en byggnad med sensorer och verifiera att IoT-data visas

