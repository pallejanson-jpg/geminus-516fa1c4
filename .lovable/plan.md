
Mål: få viewer för t.ex. Labradorgatan 16 att självläka när lokal XKT saknas, istället för att fastna i fel-läget.

1) Bekräftad problembild (från loggar + data)
- `xkt_models` har 0 rader för `cc27795e...` och `xkt-models` storage har 0 filer för byggnaden.
- XKT-sync-kortet visar “i synk” missvisande: i koden sätts `inSync` till `true` så fort total `localCount > 0` globalt, inte per byggnad.
- Direkt test av backend-funktionen `sync-xkt-building` gav:
  - `success: true`
  - `hint: "cache-on-load"`
  - meddelande att servern inte kan hämta 3D-API i den miljön.
- `NativeXeokitViewer` har explicit avstängd auto-sync (`auto-sync disabled`) och failar direkt vid 0 lokala modeller.
- “Kunde inte ladda 3D-modellen” är fortfarande kvar i UI (ska vara engelska).

Do I know what the issue is?
Ja: kombination av (a) missvisande sync-status, (b) native-viewer som bara läser lokal cache, och (c) server-sync som i vissa fall inte kan hämta 3D-modeller — därför ingen fallback som faktiskt laddar första gången.

2) Implementationsplan
A. Fixa statusindikatorn i Settings
- Fil: `src/components/settings/ApiSettingsModal.tsx`
- Ändra XKT-kortets `inSync` till byggnadsmedveten status (inte global `localCount > 0`).
- Visa tydligt “X buildings with cached XKT / total buildings” och markera “Partial” när vissa byggnader saknar modeller.

B. Återinför verklig “first-open bootstrap” i viewer
- Fil: `src/components/viewer/NativeXeokitViewer.tsx`
- När inga lokala modeller hittas:
  1) Försök backend-sync (`action: sync-xkt-building`).
  2) Om resultat blir `hint: cache-on-load` eller `synced=0`, kör klient-bootstrap:
     - hämta token + config via `asset-plus-query` (`getToken`, `getConfig`)
     - upptäck fungerande GetModels-endpoint robust (flera URL-varianter)
     - hämta modell-lista, ladda XKT binärt i browsern
     - spara med `xktCacheService.saveModelFromViewer(...)`
     - lägg i memory-cache och fortsätt ladda viewer utan fel-overlay.
- Lägg progress-overlay: “Preparing 3D models for first load…”
- Endast faila till error-state om både lokal cache + bootstrap misslyckas.

C. Robustare tolkning av GetModels-svar
- Filer:
  - `supabase/functions/asset-plus-sync/index.ts`
  - `supabase/functions/asset-plus-query/index.ts` (test/debug-del)
- Acceptera fler response-shapes än ren array (`models/items/data`) och logga kort diagnostik (status + format) för enklare felsökning.

D. Språk-konsistens
- Fil: `src/components/viewer/NativeXeokitViewer.tsx`
- Byt kvarvarande svenska felrubriken till engelska:
  - “Failed to load 3D model”.

3) Teknisk detalj (designval)
- Behåll nuvarande cache-persistens mellan 2D/3D/split (den fungerar redan).
- Ingen IFC-uppladdning krävs i detta flöde; IFC ska vara alternativ, inte beroende.
- Bootstrap körs endast när byggnad saknar lokal XKT (inte vid normal last).

4) Verifiering efter implementation
- Byggnad utan lokal XKT (Labradorgatan 16):
  - öppna `/viewer?...mode=3d`
  - se bootstrap-progress istället för direkt error
  - verifiera att modeller laddas och att rader/filer skapas i cache.
- Ladda om viewer:
  - verifiera att den nu går direkt via lokal cache.
- Växla 2D ↔ 3D ↔ split ↔ tillbaka till landningssida ↔ in i viewer:
  - verifiera att XKT inte hämtas om i onödan.
- Kontrollera att Settings visar korrekt (inte falsk “i synk”).
