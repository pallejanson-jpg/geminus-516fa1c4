
Mål: göra Jinus/Geminus AI stabil, snabb, relevant och naturlig i tal – på nivå “production-grade”.

1) Vad som är fel idag (faktisk diagnos)
- Stabilitet:
  - Backend-funktionen hade nyligen 503 p.g.a. boot-fel (dubbeldeklaration av `modelsCtx`) i version 686.
  - Senaste körning (version 688) svarar 200, men detta har sannolikt gett röda toastar hos användare.
- Svarstid:
  - Enkel fråga (“Hej”) tog ~6.0s server-exekvering.
  - Flödet gör ofta extra AI-anrop: först verktygsbeslut, sedan separat stream-svar.
  - Systemprompten är mycket stor och tung (många domänregler + exempel), vilket ökar tokenkostnad/latens.
- Konstiga svar:
  - Prompten innehåller motstridiga regler (“alltid action-knappar”, “alltid nästa steg”, samtidigt kort hälsning utan actions).
  - Verktygsytan är överlastad och delvis inkonsistent: `fm_access_get_*` finns i tool-listan men saknar implementation i `executeTool`.
  - Historik trimmas hårt till 8 meddelanden → modellen tappar kontext i längre dialog.
- Röstkvalitet:
  - Fortfarande beroende av browser-TTS; kvalitet varierar mellan enheter.
  - Röstval saknar robust kvalitetsrankning per klient/session, vilket kan ge mekanisk fallback-röst.

2) Kritiska rotorsaker (prioriterad)
1. Promptarkitektur (för stor + motsägelsefull)
2. Tool-arkitektur (för många tools + mismatch mellan deklaration och exekvering)
3. Latensarkitektur (onödiga dubbla modellanrop)
4. Minneshantering (aggressiv trimning + bug i konversationsupsert för `building_fm_guid = null`)
5. Voice pipeline (brist på robust voice discovery/ranking och prosodiprofilering)

3) Åtgärdsplan (implementationsplan)
Fas A — Stabilitet och korrekthet (högst prio, 1 sprint)
- Rensa tool-contract:
  - Antingen implementera `fm_access_get_drawings/fm_access_get_hierarchy/fm_access_search_objects/fm_access_get_floors`
  - eller ta bort dem ur `tools`.
- Inför strict tool schema-guard:
  - validera tool-arguments och fånga JSON-parsefel robust.
- Fixa konversationsupsert:
  - null-safe matchning för `building_fm_guid` (inte `eq("")`), så samma kontext uppdateras i stället för att skapa nya rader.
- Lägg till felklassning i klienttoast:
  - skilj på 401/429/402/503/timeout och ge tydliga, handlingsbara fel.

Fas B — Svarshastighet (1 sprint)
- Komprimera systemprompten kraftigt:
  - behåll kärnregler; flytta exempel till korta policy-block.
- Inför intent-router före full tool-loop:
  - “small talk/help/language/voice” går direkt till snabb väg utan tung verktygscykel.
- Optimera AI-loop:
  - om modellen inte behöver tools i första beslutet, streama direkt.
- Begränsa tool-lista dynamiskt per intent/domän i stället för att skicka allt varje gång.
- Mätning:
  - logga TTFT, totaltid, antal tool calls, tokenstorlek per request.

Fas C — Svarskvalitet (1 sprint)
- Prompt redesign:
  - ta bort motsägelser; definiera tydlig prioritet:
    1) korrekt fakta
    2) kort direkt svar
    3) max 1–3 relevanta actions när det finns faktisk nästa handling.
- Inför “grounded answer mode”:
  - svar ska baseras på faktiska tool-resultat och säga “ingen data” när det saknas.
- Höj minneskvalitet:
  - återställ mer kontext (inte bara 8 meddelanden) + sammanfattningsminne för längre dialoger.

Fas D — Röst (webbröst maximerad, 1 sprint)
- Voice discovery förbättras:
  - vänta på `voiceschanged`, bygg kvalitetspoäng per röst och persist i settings.
- Prosodi förbättras:
  - språkprofiler (sv/en), bättre segmentering, pauser, punktlisteläsning.
- Rösttestpanel:
  - A/B-test mellan toppröster och spara användarens preferens.
- Felsäkring:
  - fallback-kedja om vald röst saknas efter browser-update.

4) Konkreta leverabler per fil
- `supabase/functions/gunnar-chat/index.ts`
  - tool-list/executeTool alignment, prompt-komprimering, intent-router, bättre felhantering, null-safe conversation upsert.
- `src/components/chat/GunnarChat.tsx`
  - bättre feltoast-mappning, robust action parsing/validation, förbättrad voice initialization + quality ranking.
- `src/components/settings/GunnarSettings.tsx`
  - förbättrad rösttest/preview med toppröster och tydlig fallbackstatus.

5) Acceptanskriterier (definition of done)
- Stabilitet:
  - 0 st 5xx vid normal användning under testpass.
- Hastighet:
  - TTFT < 1.8s för enkla frågor, totaltid < 4s i median.
- Kvalitet:
  - Inga “Unknown tool”-fall i loggar.
  - Inga irrelevanta byggnadslistor vid enkel hälsning.
- Röst:
  - konsekvent val av högst rankad tillgänglig röst på samma enhet/browser.
- UX:
  - inga röda toastar utan tydlig orsak + åtgärdsförslag.

6) Teknisk detaljdel (varför detta ger störst effekt)
- Största kvalitetslyftet kommer inte i första hand från “annan modell”, utan från:
  1) mindre och renare prompt,
  2) korrekt tool-kontrakt,
  3) snabbare exekveringsväg för enkla intents,
  4) bättre minne.
- Datapunkter från nuvarande drift visar att grundfunktionen svarar, men med för hög latens och för mycket promptstyrd “över-beteende” (för många actions/konstigt svarsmönster).

7) Genomförandeordning
1. Fas A (stabilitet + tool-contract + minnesbugg)
2. Fas B (latensoptimering + mätning)
3. Fas C (svarskvalitet/prompt redesign)
4. Fas D (röstförfining)
5. Slutlig E2E-verifiering i sidopanel och /ai
