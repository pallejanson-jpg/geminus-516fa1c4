
# Plan: Samordna Datakonsistens mellan Banner och Sync-flik

## Problembeskrivning

DataConsistencyBanner och Sync-fliken i Settings fungerar oberoende av varandra:
- Bannern kör `sync-with-cleanup` (tar bort orphans) men Sync-fliken vet inte om det
- Sync-flikens "Synka"-knapp kör `sync-structure` som bara lagger till data, aldrig tar bort
- Ingen Realtime-subscription i Sync-fliken - den visar gammal data
- Spinnern har ingen koppling till faktisk status

## Losning

### 1. Lagg till Realtime-subscription i ApiSettingsModal

Sync-fliken ska lyssna pa `asset_sync_state`-andringar via Supabase Realtime. Nar en sync slutfors (fran bannern eller nagon annan kalla) ska UI:t automatiskt uppdateras.

```text
Realtime-flode:
Banner kor sync-with-cleanup
    |
    v
asset_sync_state uppdateras (completed)
    |
    v
Realtime-event --> ApiSettingsModal --> auto-refresh syncCheck
```

**Andringar i `src/components/settings/ApiSettingsModal.tsx`:**
- Lagg till `useEffect` med Supabase Realtime-kanal for `asset_sync_state`
- Vid Realtime-event: kalla `fetchSyncStatus()` och `checkSyncStatus()` automatiskt
- Avsluta kanalen vid unmount/modal-stangning

### 2. Andrastruktur-synk till att anvanda sync-with-cleanup

Byt `handleSyncStructure` fran `sync-structure` till `sync-with-cleanup` sa att orphans tas bort aven fran Sync-fliken.

**Andringar i `src/components/settings/ApiSettingsModal.tsx`:**
- `handleSyncStructure` anropar `sync-with-cleanup` istallet for `sync-structure`
- Lagg till text under knappen: "Synkar och tar bort objekt som inte langre finns i Asset+"

### 3. Forbattra spinner-logik med Realtime-driven status

Ersatt den 300-sekunderska timeouten med Realtime-driven statusuppdatering:
- Nar Realtime-event visar `sync_status === 'completed'` for 'structure' -> stoppa spinner
- Nar `sync_status === 'failed'` -> stoppa spinner, visa felmeddelande
- Ta bort den harda 300s-timeouten

### 4. Emittera custom event fran DataConsistencyBanner

Nar bannern slutfor cleanup, emittera ett custom DOM-event sa att andra komponenter kan reagera.

**Andringar i `src/components/common/DataConsistencyBanner.tsx`:**
- Dispatchera `sync-completed` event efter lyckad sync-with-cleanup
- Inkludera resultat (synced count, orphans removed) i event detail

**Andringar i `src/components/settings/ApiSettingsModal.tsx`:**
- Lyssna pa `sync-completed` event som komplement till Realtime

---

## Filer som andras

| Fil | Andring |
|-----|---------|
| `src/components/settings/ApiSettingsModal.tsx` | Realtime-subscription, sync-with-cleanup, forbattrad spinner |
| `src/components/common/DataConsistencyBanner.tsx` | Dispatchera custom event vid cleanup |

## Tekniska detaljer

### Realtime-subscription i ApiSettingsModal

```typescript
useEffect(() => {
  if (!isOpen) return;
  
  const channel = supabase
    .channel('sync-settings-monitor')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'asset_sync_state'
    }, (payload) => {
      const newState = payload.new as SyncStatus;
      
      // Auto-refresh sync statuses
      fetchSyncStatus();
      
      // If a sync completed or failed, refresh the full check
      if (newState.sync_status === 'completed' || newState.sync_status === 'failed') {
        checkSyncStatus();
        
        // Stop relevant spinner
        if (newState.subtree_id === 'structure') setIsSyncingStructure(false);
        if (newState.subtree_id === 'assets') setIsSyncingAssets(false);
        if (newState.subtree_id === 'xkt') setIsSyncingXkt(false);
      }
    })
    .subscribe();
  
  return () => { supabase.removeChannel(channel); };
}, [isOpen]);
```

### Uppdaterad handleSyncStructure

```typescript
const handleSyncStructure = async () => {
  setIsSyncingStructure(true);
  try {
    // Use sync-with-cleanup instead of sync-structure
    // to also remove orphan objects
    supabase.functions.invoke('asset-plus-sync', {
      body: { action: 'sync-with-cleanup' }
    }).then(({ data }) => {
      if (data?.success) {
        toast({
          title: 'Synkronisering klar',
          description: data.message,
        });
      }
    }).catch((err) => {
      console.log('Edge function call ended:', err?.message);
    });

    toast({
      title: 'Synkar struktur',
      description: 'Hamtar data och tar bort objekt som inte langre finns i Asset+.',
    });
    // Spinner stops via Realtime subscription
  } catch (error: any) {
    toast({ variant: 'destructive', title: 'Synk misslyckades', description: error.message });
    setIsSyncingStructure(false);
  }
};
```

### Custom event fran DataConsistencyBanner

```typescript
// After successful sync-with-cleanup
window.dispatchEvent(new CustomEvent('asset-sync-completed', {
  detail: { totalSynced: data.totalSynced, orphansRemoved: data.orphansRemoved }
}));
```

## Forvantat resultat

1. Nar bannern kor cleanup -> Sync-fliken uppdateras automatiskt via Realtime
2. Sync-flikens "Synka"-knapp tar nu aven bort orphans
3. Spinnern slutar snurra nar synken faktiskt ar klar (inte efter 5 min timeout)
4. Bada vyerna visar konsekvent data
