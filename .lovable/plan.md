
## Vad loggarna visar (orsak till “Timeout/Försök igen”)

Jag kan se i nätverksloggarna att klienten upprepade gånger anropar `acc-sync` med `action: "download-derivative"` och får **HTTP 202** med:

- `{"pending": true, "translationStatus":"pending", "error":"Translation not complete (status: pending)"}`

Tidsstämplarna i samma körning går från **16:14:17** till minst **16:20:42** (alltså >6 minuter) och den är fortfarande `pending`. Samtidigt visar edge-funktionsloggarna för `acc-sync` en lång serie `download-derivative`-körningar (men ingen “klar”-händelse).

Det betyder: **Autodesk-översättningen är fortfarande inte klar när vi ger upp**, och därför hamnar UI i “Försök igen”.

## Varför det fortsätter även efter att vi ökade retries

I `src/services/acc-xkt-converter.ts` gör vi idag detta:

1) `translate-model` svarar med `status: "success"` även när jobbet bara “accepterats/startats”.
2) Frontend tolkar det som “success” och går direkt till `doDownloadAndConvert()`.
3) `doDownloadAndConvert()` loopar `download-derivative` i max 6 minuter och sätter sedan `failed` → UI visar “Försök igen”.

Det finns dessutom en viktig risk som kan göra problemet värre vid “Försök igen”:
- `translate-model` kör alltid med `"x-ads-force": "true"` och **startar om** översättningen även om ett jobb redan är igång, eftersom den bara “short-circuitar” när status redan är `success`.
- Om användaren klickar “Försök igen” kan vi i praktiken skapa en loop där jobbet aldrig hinner bli klart.

## Mål med fixen

1) **Sluta behandla “job started/accepted” som “success/complete”**.
2) **Poll:a via `check-translation` (manifest/progress) tills jobbet verkligen är `success`** (det kan ta 5–20 min på stora RVT).
3) **Undvik att starta om översättningsjobbet vid retry om ett jobb redan pågår**.
4) Säkerställ att `check-translation` fungerar korrekt för EMEA/`wipemea` (EU-endpoint).

---

## Ändringar som ska göras (kod)

### A) Backend-funktion: `supabase/functions/acc-sync/index.ts`

#### A1) `translate-model`: returnera “pending” när jobb startas (inte “success”)
- Behåll `alreadyDone: true` endast när vi vet att det redan är översatt.
- När vi skickar job till Autodesk och får “accepted”, returnera t.ex:
  - `status: "pending"`
  - `message: "Översättningsjobb startat…"`
  
Det gör att frontend inte försöker ladda ner innan det faktiskt finns en färdig derivative.

#### A2) `translate-model`: om en översättning redan pågår – starta inte om jobbet
Utöka DB-checken:
- Om `acc_model_translations.translation_status IN ("pending","inprogress")` och `started_at` är relativt nylig (t.ex. < 60 min):
  - returnera `{ success:true, status:"pending", message:"Översättning pågår redan. Fortsätter att bevaka status…" }`
  - gör **inte** POST `/job` igen.

Detta minskar risken att “Försök igen” orsakar omstart och extra väntetid.

#### A3) `check-translation`: använd EU endpoint för `wipemea`
Just nu används global endpoint:
- `https://developer.api.autodesk.com/modelderivative/v2/designdata/.../manifest`

Ändra så att den, precis som `translate-model` och `download-derivative`, detekterar `wipemea` och använder:
- EU: `.../modelderivative/v2/regions/eu/designdata/${urn}/manifest`
- Global: `.../modelderivative/v2/designdata/${urn}/manifest`

#### A4) `check-translation`: 403-fallback (3-legged → 2-legged)
Som i `translate-model`: om manifest-check får 403 med user-token, prova med app-token så polling inte fastnar pga rättigheter.

---

### B) Frontend: `src/services/acc-xkt-converter.ts`

#### B1) `startTranslation`: tolka svar som “pending” om det inte är `alreadyDone`
Ändra logiken så att:
- `alreadyDone === true` → `status: "success"`
- annars → `status: "pending"` (även om backend råkar skicka “success” idag)

Det gör flödet robust även om backend-svaret är otydligt.

#### B2) `runFullPipeline`: vänta på verklig `check-translation === success` innan `download-derivative`
Ändra så att standardflödet blir:

1) `translate-model`
2) `startPolling(versionUrn)` som kallar `check-translation` och uppdaterar UI med progress
3) När `check-translation` returnerar `success`:
   - kör `download-derivative` (normalt bara 1–3 försök)
   - om formatbegränsning (SVF2 multi-fil) → kör `tryServerConversion`

Viktigt: ta bort/neutralisera den hårda “>6 min => failed” när status fortfarande är “pending”. I stället ska vi:
- fortsätta poll:a translation upp till en högre maxgräns (t.ex. 20–30 minuter), och först därefter visa fel med tydligt meddelande.

#### B3) Inför en tydlig global timeout (men mycket längre)
Lägg en `MAX_TRANSLATION_WAIT_MS` (t.ex. 25 min) så att vi inte pollar oändligt.
- När tiden överskrids: visa “Tar längre tid än väntat, försök igen senare (jobbet fortsätter i Autodesk)”.

---

## Testplan (för att verifiera att felet är löst)

1) Starta 3D-konvertering för samma RVT.
2) Verifiera att UI inte går till “Försök igen” efter 6–12 min om Autodesk fortfarande är `pending`.
3) Verifiera att polling visar progress via `check-translation` (pending/inprogress/progress%).
4) När translation blir `success`:
   - `download-derivative` ska sluta ge 202 och börja ge en `downloadUrl`
   - konverteringen fortsätter till XKT som vanligt
5) Klicka “Konvertera 3D” igen under pågående translation:
   - verifiera att backend svarar “översättning pågår redan” och inte startar om jobbet.

---

## Var vi såg felet i loggarna (för spårbarhet)

- Nätverk: många `acc-sync` → `download-derivative` med **HTTP 202 pending** i >6 minuter.
- Edge-funktionsloggar: upprepade `ACC Sync action: download-derivative` men ingen framgång innan UI ger upp.

---

## (Valfritt) Förbättring efter fixen
- Visa “Du kan lämna den här vyn, vi fortsätter bevaka översättningen” och låt status ligga kvar i listan tills den är klar.
- Spara “last known status/progress” i DB (ni har redan `acc_model_translations`) och återställ UI efter refresh.

