
# Plan: Verifiera och felsök Ivion-credentials

## Problemanalys

Du har uppdaterat `IVION_USERNAME` till `SWG_PalJ` men systemet visar fortfarande `SWG***` i felmeddelandet. Problemet kan vara:

1. **Edge function cache** - Edge functions kan cacheläsa miljövariabler
2. **Preview visar för lite** - Koden visar bara 3 första tecknen (`SWG`), så vi kan inte se skillnad mellan `SWG_RC` och `SWG_PalJ`

## Lösning

### Del 1: Förbättra debug-visning

Uppdatera `getIvionConfigStatus()` för att visa fler tecken av användarnamnet (6 istället för 3):

**Fil: `supabase/functions/_shared/ivion-auth.ts`**
```typescript
// Rad 331: Ändra från
usernamePreview: config.username ? config.username.slice(0, 3) + '***' : '',

// Till
usernamePreview: config.username ? config.username.slice(0, 6) + '***' : '',
```

Detta visar `SWG_Pa***` om rätt användarnamn används, eller `SWG_RC***` om det gamla fortfarande är kvar.

### Del 2: Deploya edge function

Efter ändringen deployas `ivion-poi` för att:
1. Uppdatera koden
2. **Tvinga omladdning av miljövariabler** (löser eventuell cache-problem)

### Del 3: Testa anslutningen

Kör ett nytt test-anrop för att verifiera:
- Att rätt användarnamn (`SWG_Pa***`) visas
- Att autentiseringen fungerar

---

## Filer som ändras

| Fil | Ändring |
|-----|---------|
| `supabase/functions/_shared/ivion-auth.ts` | Visa 6 tecken av användarnamn i preview |

---

## Förväntade resultat

Efter implementationen:
- Om du ser `SWG_Pa***` → Rätt användarnamn används, problemet är lösenordet
- Om du ser `SWG_RC***` → Secrets uppdateras inte, vi behöver felsöka varför
- Om inloggningen lyckas → Problemet är löst!

---

## Sammanfattning

| Steg | Åtgärd |
|------|--------|
| 1 | Ändra preview från 3→6 tecken |
| 2 | Deploya edge function (tvingar secrets-omladdning) |
| 3 | Testa anslutningen |
