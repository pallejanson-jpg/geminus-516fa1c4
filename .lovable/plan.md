
# Plan: XKT-modellcachning via "Cache-on-Load" i 3D-viewern

## Sammanfattning
Implementera en strategi där 3D-viewern automatiskt sparar nedladdade XKT-modeller till backend första gången de laddas. Detta ger:
- **Session-cache**: Modeller hålls i minnet under sessionen
- **Persistent cache**: Modeller sparas till Lovable Cloud för framtida laddningar
- **Fallback för synk**: Om Edge-funktionen inte kan nå Asset+ 3D API, finns modellerna ändå cachade efter första visningen

## Bakgrund

### Varför synkdialogen misslyckas
Edge-funktionen får ett HTML-svar (`<!doctype`) istället för JSON från Asset+ `/threed/GetModels` endpoint. Detta tyder på att:
1. 3D API kräver annan autentisering än Bearer-token
2. Eller så är endpointen skyddad med IP-filter/cookies som Edge-miljön saknar

### Varför 3D-viewern fungerar
Asset+ viewerpaketet (`assetplusviewer.umd.min.js`) har egen fetch-logik och kommunicerar direkt med Asset+ API från användarens webbläsare, med rätt sessionsdata.

## Teknisk implementation

### Steg 1: Återaktivera fetch-interceptor med säker implementation
Uppdatera `setupCacheInterceptor` i `AssetPlusViewer.tsx` för att:
1. Intercepta utgående XKT-förfrågningar
2. Kontrollera om modellen finns i minnet eller i databasen först
3. Vid cache-miss: hämta från Asset+ och spara till backend i bakgrunden

```text
┌─────────────────────────────────────────────────────────────┐
│                    XKT Request Flow                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │ Viewer   │───>│ Memory Cache │───>│ Database/Storage│   │
│  │ Request  │    │ (session)    │    │ (persistent)    │   │
│  └──────────┘    └──────────────┘    └─────────────────┘   │
│       │                │                     │              │
│       │                │                     │              │
│       ▼                ▼                     ▼              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Om cache-miss                           │  │
│  │                                                      │  │
│  │  ┌──────────┐    ┌──────────────────────────────┐   │  │
│  │  │ Asset+   │───>│ Spara till Memory + Backend  │   │  │
│  │  │ API      │    │ (i bakgrunden)               │   │  │
│  │  └──────────┘    └──────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Steg 2: Uppdatera minneshantering
Förbättra `useXktPreload.ts`:
1. Exponera funktioner för att kontrollera/hämta från minnet
2. Öka gränsen för samtidiga modeller i minnet
3. Automatisk cleanup vid lågt minne

### Steg 3: Uppdatera xkt-cache-service
1. Lägg till en `saveModelFromViewer`-metod optimerad för bakgrundssparning
2. Hantera signerade URL-förnyelse
3. Bättre felhantering och retry-logik

### Steg 4: Förbättra synk-UI med feedback
Uppdatera synkdialogen för att visa:
- "XKT-synk stöds ej från servern - modeller cachas automatiskt när du öppnar 3D"
- Visa antal cachade modeller per byggnad

## Filer som ändras

| Fil | Förändring |
|-----|------------|
| `src/components/viewer/AssetPlusViewer.tsx` | Återaktivera och förbättra `setupCacheInterceptor` |
| `src/hooks/useXktPreload.ts` | Exponera minnescache-funktioner, förbättra preload |
| `src/services/xkt-cache-service.ts` | Lägg till `saveModelFromViewer` metod |
| `supabase/functions/asset-plus-sync/index.ts` | Förbättra felmeddelanden vid 3D API-misslyckande |
| UI-komponent för synkdialog | Visa förklaring om cache-on-load strategi |

## Fördelar

1. **Ingen manuell synk krävs** - Modeller cachas automatiskt vid första laddning
2. **Snabbare efter första gången** - Efterföljande laddningar hämtar från Lovable Cloud
3. **Fungerar oavsett Asset+ API-restriktioner** - Viewern har redan rätt behörigheter
4. **Session-prestanda** - Modeller hålls i minnet under sessionen

## Risker och mitigation

| Risk | Mitigation |
|------|------------|
| Stora XKT-filer kan ta tid att spara | Spara i bakgrunden utan att blockera viewern |
| Minnescache kan bli stor | Begränsa till 200 MB per session, prioritera arkitekturmodeller |
| Interceptor kan störa Asset+ paket | Använd passiv interceptor som klonar response istället för att modifiera |

## Testplan
1. Öppna 3D för en byggnad som aldrig visats
2. Verifiera att modellerna laddas från Asset+
3. Verifiera att modellerna sparas till backend (kolla `xkt_models` tabell)
4. Stäng och öppna 3D igen
5. Verifiera att laddningen går snabbare (från cache)
6. Byt byggnad och upprepa
