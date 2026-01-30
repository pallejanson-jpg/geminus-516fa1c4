
# Åtgärdsplan: Ivion 360° Inventeringsflöde

## Identifierade problem

### Problem 1: Access token utgår efter ~30 minuter
Den nuvarande strategin med `IVION_ACCESS_TOKEN` och `IVION_REFRESH_TOKEN` har begränsningar:
- Access token: 30 min livslängd
- Refresh token: 7 dagars livslängd, men måste vara giltig

**Effekt:** Polling misslyckas helt när token utgår.

### Problem 2: Polling stannar när formuläret är öppet
I `IvionInventory.tsx` rad 124:
```typescript
if (!currentIvionSiteId || !pollingEnabled || formOpen) {
  // Polling avstängd
}
```

**Effekt:** Även om token fungerar, upptäcks inga nya POIs när registreringspanelen är öppen.

### Problem 3: Cross-origin iframe-begränsningar
NavVis Ivion laddas i en standard `<iframe>`. På grund av webbläsarsäkerhet kan Lovable INTE:
- Injicera JavaScript i iframe
- Lyssna på events (som "POI skapad")
- Läsa eller skriva data direkt till Ivion

---

## Tillgängliga lösningsvägar

### Väg A: NavVis Frontend API (Rekommenderas för framtiden)
NavVis erbjuder ett JavaScript/TypeScript SDK som gör det möjligt att:
- Lyssna på POI-events (`poiRepository.save()` callbacks)
- Skapa POIs programmatiskt med korrekt position
- Bädda in Ivion med full kontroll

**Krav:**
- Ladda ner NavVis IVION NPM-paket från NavVis
- Implementera egen Ivion-wrapper istället för enkel iframe
- Kräver IVION Professional eller Enterprise licens

**Fördel:** Fullständig integration utan polling-delay

### Väg B: Förbättrad polling med token-hantering (Snabb fix)
Åtgärda de aktuella problemen för att få polling att fungera:

1. **Automatisk token-uppdatering**: Visa tydlig varning när token utgått + knapp för att uppdatera
2. **Polling även när formuläret är öppet**: Lägg till en "Ny POI väntar"-notifikation
3. **Fallback till manuell hämtning**: "Hämta senaste POI"-knapp som alltid fungerar

### Väg C: Alternativt arbetsflöde utan realtidsintegrering
Förenkla flödet helt:
1. Användaren skapar POI i Ivion
2. Användaren kopierar POI-ID manuellt
3. Användaren klistrar in i registreringsformuläret

---

## Rekommenderad lösning: Väg B (med förberedelse för Väg A)

### Steg 1: Fixa token-hantering och synlighet
**Fil:** `src/pages/IvionInventory.tsx`

- Lägg till state för token-status: `tokenExpired`, `tokenError`
- Visa varningsmeddelande i headern när API:et inte fungerar
- Lägg till knapp "Kontrollera anslutning" som testar token

### Steg 2: Förbättra polling-logiken
**Fil:** `src/pages/IvionInventory.tsx`

- Ta bort `formOpen` från polling-villkoret
- Lägg till `pendingPoi`-state som sparar nydetekterade POIs
- Visa notifikation: "Ny POI upptäckt! Klicka för att registrera"
- Uppdatera formuläret med den nya POI:ns data när användaren bekräftar

### Steg 3: Förbättra manuell hämtning
**Fil:** `src/components/inventory/IvionRegistrationPanel.tsx`

- Lägg till prominent "Hämta senaste POI"-knapp som alltid är synlig
- Visa feedback om API-status direkt i formuläret

### Steg 4: Lägg till instruktioner i gränssnittet
**Fil:** `src/pages/IvionInventory.tsx`

- Lägg till en infobanner under headern:
  "Skapa en POI i Ivions 360°-vy. Registreringsformuläret upptäcker den automatiskt."
- Lägg till visuell indikator för polling-status (grön puls = aktivt, röd = problem)

---

## Arbetsflöde efter implementering

```text
1. Användaren öppnar 360°-inventering
   ↓
2. System testar API-anslutning
   ├─ OK → Polling startar (grön indikator)
   └─ FEL → Visar varning + instruktioner för att uppdatera token
   ↓
3. Användaren navigerar i Ivion och skapar POI med Ivions verktyg
   ↓
4. Polling upptäcker ny POI (3 sek intervall)
   ├─ Formuläret STÄNGT → Öppnar automatiskt med data
   └─ Formuläret ÖPPET → Visar "Ny POI väntar"-badge
   ↓
5. Användaren fyller i namn, kategori, symbol
   ↓
6. Spara → Asset skapas, FMGUID skrivs tillbaka till Ivion POI
   ↓
7. Formuläret återställs, redo för nästa registrering
```

---

## Teknisk sammanfattning

| Fil | Ändringar |
|-----|-----------|
| `src/pages/IvionInventory.tsx` | Token-status, förbättrad polling, pending POI-kö, UI-instruktioner, statusindikator |
| `src/components/inventory/IvionRegistrationPanel.tsx` | Bättre manuell hämtning, API-statusvisning |
| `supabase/functions/ivion-poi/index.ts` | Bättre felmeddelanden med åtgärdsförslag |

---

## Om tokens (viktig bakgrund)

NavVis IVION använder OAuth mandate-baserad inloggning. Tokens kan INTE förnyas automatiskt utan användarinteraktion efter att refresh token gått ut. Långsiktig lösning kräver antingen:

1. **Service account** (om NavVis erbjuder det)
2. **Frontend API SDK** (bädda in Ivion med JavaScript istället för iframe)
3. **Webhook från NavVis** (om NavVis stödjer det - verkar inte finnas)

Tills vidare måste användaren manuellt uppdatera tokens ca var 7:e dag.
