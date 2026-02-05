
# Plan: Asset+ Datakonsistens och XKT-caching

## ✅ IMPLEMENTERAT

### Del 1: Automatisk datakonsistenskontroll - ✅ KLART

**Implementerade komponenter:**

1. **`check-delta` action** i `asset-plus-sync` edge function
   - Jämför lokal vs remote asset-antal
   - Returnerar: `{ orphanCount, newCount, inSync, discrepancy }`
   - Testad: Bekräftade **1,232 orphan-objekt**

2. **`sync-with-cleanup` action** i `asset-plus-sync` edge function  
   - Hämtar alla remote fmGuids
   - Upsertar alla structure-objekt
   - Tar bort lokala objekt som inte finns i Asset+

3. **DataConsistencyBanner** (`src/components/common/DataConsistencyBanner.tsx`)
   - Visar varning vid appstart om data är osynkad
   - Knapp för "Synka & rensa" som anropar `sync-with-cleanup`
   - Kan ignoreras av användaren

4. **SyncProgressBanner** (`src/components/layout/SyncProgressBanner.tsx`)
   - Visar realtidsframsteg under pågående synk
   - Lyssnar på Supabase Realtime för `asset_sync_state`

5. **Realtime aktiverat** för `asset_sync_state` tabell
   - Live-uppdateringar av synkstatus

6. **AppLayout uppdaterad** med banners
   - DataConsistencyBanner visas vid diskrepans
   - SyncProgressBanner visas under aktiv synk

---

## 🔜 NÄSTA STEG

### Del 2: XKT-caching (ej ännu implementerat)

Problemet kvarstår: Server-side synk kan inte hämta XKT-filer pga API-restriktioner.

**Planerad lösning:**
- Fortsätt med "Cache-on-Load" strategi via fetch-interceptor
- Lägg till statusspårning för vilka byggnader som har cache
- Överväg `xkt_cache_status` tabell för snabb kontroll

---

## Test-resultat

```json
// check-delta response:
{
  "success": true,
  "localCount": 4034,
  "remoteCount": 2802,
  "orphanCount": 1232,
  "newCount": 0,
  "inSync": false,
  "discrepancy": 1232,
  "message": "1232 objekt finns lokalt men inte i Asset+"
}
```

---

## Implementerade filer

| Fil | Status |
|-----|--------|
| `supabase/functions/asset-plus-sync/index.ts` | ✅ Uppdaterad med check-delta & sync-with-cleanup |
| `src/components/common/DataConsistencyBanner.tsx` | ✅ Ny |
| `src/components/layout/SyncProgressBanner.tsx` | ✅ Ny |
| `src/components/layout/AppLayout.tsx` | ✅ Uppdaterad med banners |
| Migration: Realtime för asset_sync_state | ✅ Klar |
