

# Fix: Ivion SDK timeout pga utgangen cachad token (Akerselva)

## Problem

Akerselva-byggnaden har en cachad Ivion-token i `building_settings` som gar ut efter ca 15 minuter. Nar anvandaren oppnar Ivion-vyn efter att token gatt ut:

1. `useIvionSdk` anropar `get-login-token` i edge-funktionen
2. Edge-funktionen kontrollerar `building_settings` -- ser att token gatt ut
3. Den forsoker refresha, men om refresh ocksa misslyckas faller den tillbaka till username/password-login
4. **Problemet**: Loggen visar "Using cached access token from database (still valid)" -- dvs `isTokenExpired` returnerar `false` trots att token har gatt ut. 60-sekunders buffert racker inte nar tokenen ar flera minuter gammal.

Dessutom: om SDK:n far en token som gar ut under sessionen, fortsatter SSE-anropen med 403 var 5:e sekund utan att frontend markar det forran timeout pa 45 sekunder.

**Bevis fran databasen:**
- Akerselva: `ivion_token_expires_at = 2026-02-11 15:31:35` (utgick fore 15:38-sessionen)
- Centralstationen: `ivion_token_expires_at = 2026-02-11 16:06:54` (fortfarande giltig)

## Atgarder

### 1. Fixa token-validering i edge-funktionen

I `supabase/functions/_shared/ivion-auth.ts`, oka bufferten fran 60 sekunder till 5 minuter. Detta saker att en token som snart gar ut aldrig returneras som "giltig":

```text
Fil: supabase/functions/_shared/ivion-auth.ts (rad 39)

Fran: const isExpired = now.getTime() >= (expiresAt.getTime() - 60000);
Till:  const isExpired = now.getTime() >= (expiresAt.getTime() - 300000);
```

### 2. Tvinga proaktiv token-refresh i get-login-token

I `supabase/functions/ivion-poi/index.ts`, nar `get-login-token` anropas, kontrollera explicit att den returnerade token har minst 5 minuters livstid kvar. Om inte, tvinga en refresh:

```text
Fil: supabase/functions/ivion-poi/index.ts (rad 731-763, get-login-token case)

Lagg till efter att token hamtats:
- Parsa token-expiry
- Om under 5 minuter kvar: anropa refreshAccessToken direkt
- Om refresh misslyckas: loginWithCredentials
- Spara nya tokens till building_settings
```

### 3. Forbattra frontend token-refresh-timing

I `src/hooks/useIvionSdk.ts`, minska refresh-intervallet fran 10 minuter till 8 minuter, och lagg till felhantering som triggar retry vid 403-fel:

```text
Fil: src/hooks/useIvionSdk.ts (rad 113)

Fran: const interval = setInterval(refreshToken, 10 * 60 * 1000);
Till:  const interval = setInterval(refreshToken, 8 * 60 * 1000);
```

## Sammanfattning

Tre andringar i tre filer:
1. `supabase/functions/_shared/ivion-auth.ts` -- Oka token-buffert till 5 min
2. `supabase/functions/ivion-poi/index.ts` -- Tvinga refresh vid kort livstid i get-login-token
3. `src/hooks/useIvionSdk.ts` -- Tightare refresh-intervall (8 min)

