
## Mål
Du ska kunna få ett tydligt svar på *varför* inga objekt hittas i AI‑scanningen, och systemet ska sluta “skanna snabbt” utan att faktiskt analysera riktiga bilder.

## Min analys av problemet (baserat på koden + loggar)
I backend-funktionen `ai-asset-detection` sker flödet per bild så här:

1) Hitta en “giltig” Ivion-bild-URL (via `HEAD` som accepterar `200` eller `302`)
2) Ladda ner bilden och konvertera till base64 (`downloadImageAsBase64`)
3) Skicka bilden till AI (`analyzeImageWithAI`)
4) Spara `pending_detections`

I era backend‑loggar syns återkommande fel:
- `Download failed with status: 404` efter redirect-kedjan (302 → signed callback → 404)

Det leder till att:
- Bilden laddas aldrig ner (steg 2 faller)
- AI anropas då inte (steg 3 uteblir)
- Därför kan inga detektioner skapas (steg 4)

Varför känns det ändå som att allt “går fort och fungerar”?
- `processBatch` räknar ändå upp `processed_images` även när nedladdningen failar, vilket gör att UI ser “snabbt” ut.

Sannolika rotorsaker:
- **A) Behörighetsproblem i NavVis/Ivion**: kontot får lista/proba men inte hämta faktiska bilddata (GET).
- **B) Falska positiva “träffar” p.g.a. HEAD/302**: endpoint kan returnera 302 på HEAD även om själva bilden inte går att hämta via GET.
- (Mindre sannolikt just nu) **AI-format/prompt-problem**, eftersom AI inte ens får bilddata när nedladdningen failar.

## Lösning (vad vi bygger om)
Vi gör tre saker: (1) bättre diagnostik, (2) stoppa/faila snabbt när inga bilder kan laddas, (3) verifiera bild‑URL:er med riktig “mini‑GET” istället för bara HEAD.

---

## Del 1 — Lägg till “Testa bildnedladdning” i UI (riktig GET, inte bara HEAD)
### Varför
Nuvarande knapp “Testa bildåtkomst” anropar `test-image-access` som i praktiken bekräftar att datasets finns och att en URL kan hittas (ofta via HEAD/302). Den bevisar inte att bilden faktiskt kan hämtas.

### Ändringar
**Frontend**
- `src/components/ai-scan/ScanConfigPanel.tsx`
  - Byt befintlig test-knapp eller komplettera med en ny:
    - “Testa bildnedladdning (GET)”
  - Anropa backend action `test-image-download` (finns redan).
  - Visa resultat mer detaljerat:
    - om success: content-type + storlek
    - om fail: lista “attempts” (metod + status) så man ser exakt var det dör (302 → 404 etc.)

**Backend**
- Inga krav för att komma igång (action `test-image-download` finns redan).
- Små förbättringar: se till att `test-image-download` returnerar tydligaste feltexten i `message` som UI visar.

**Acceptanskriterium**
- Du kan trycka “Testa bildnedladdning” och få ett tydligt “OK (jpeg, X MB)” eller “MISSLYCKADES: saknar bildrättigheter / signed URL ger 404” med detaljer.

---

## Del 2 — Gör att scanningen inte “låtsas fungera” när nedladdning misslyckas
### Varför
Idag kan en scan job köra igenom många bilder, men egentligen bara samla fel i loggar och ändå öka räknare. Då blir det svårt att förstå problemet.

### Ändringar (backend: `supabase/functions/ai-asset-detection/index.ts`)
1) **Inför fail-fast när nedladdning misslyckas systematiskt**
   - Håll lokala räknare i `processBatch`:
     - `downloadFailures`, `aiFailures`, `noUrlSkips`
   - Om t.ex. de första 10 bilderna i rad misslyckas med download → markera job som `failed` direkt med ett begripligt fel:
     - “Kunde inte hämta panoramabilder (GET ger 404/403). Kontrollera NavVis/Ivion behörigheter för bildnedladdning.”
2) **Skriv felmeddelande löpande**
   - Uppdatera `scan_jobs.error_message` under körning (inte bara vid completion).
   - Exempel: “Download failures: 12/12. Senaste fel: 404 på signed callback …”
3) **UI-effekt**
   - `ScanProgressPanel` visar redan `error_message` om den finns. Med detta blir felet synligt direkt.

**Acceptanskriterium**
- Om bildnedladdning inte fungerar så stannar jobbet och visar fel i UI (inte bara i loggar).
- Det blir uppenbart *att AI inte kan analysera*, istället för att man tror att “AI hittar 0”.

---

## Del 3 — Gör bild-URL-val robust: verifiera med mini‑GET istället för HEAD/302
### Varför
`getPanoramaImageUrl` anser en URL “giltig” om `HEAD` ger 200 eller 302. Men i praktiken kan GET ändå bli 404 (vilket era loggar tyder på).

### Ändringar (backend)
- Uppdatera `getPanoramaImageUrl` så att den:
  - Antingen gör en liten GET med `Range: bytes=0-1023` (om servern stödjer range)
  - Eller gör GET men avbryter tidigt (med AbortController) efter att ha sett headers/content-type
- Endast acceptera URL som “giltig” om GET faktiskt ger 200/206 och content-type ser ut som `image/*`.

**Acceptanskriterium**
- Systemet väljer inte längre URL:er som senare dör med 404 vid nedladdning.
- När scanningen körs blir “processed_images” mer representativt för verklig analys.

---

## Efter dessa tre delar: vad du behöver göra utanför appen (om testet bekräftar behörighetsfel)
Om `test-image-download` visar att alla metoder failar (särskilt på signed callback), då är det nästan alltid **NavVis/Ivion-kontots rättigheter**:
- kontot kan se datasets men får inte ladda ner panoramabilder.

Då behöver vi:
- uppdatera Ivion/NavVis användaren/rollen så den har read/download access till storage/bilder
- alternativt använda ett annat konto/API-lösning som får hämta bilderna

---

## Extra (valfritt steg om nedladdning funkar men 0 detektioner kvarstår)
Om bildnedladdning blir OK men AI fortfarande hittar 0:
- Lägg till en “Analysera 1 testbild”-knapp som kör AI på en enda panorama och visar:
  - AI råsvar (första X tecken)
  - om JSON parsing lyckas
  - antal detektioner
Det gör prompt/template-felsökning mycket snabbare.

---

## Filer som kommer ändras
Frontend:
- `src/components/ai-scan/ScanConfigPanel.tsx` (byt/komplettera testknappen, visa testresultat)
- (ev.) `src/components/ai-scan/ScanProgressPanel.tsx` (små UI-texter/indikatorer för failures)

Backend:
- `supabase/functions/ai-asset-detection/index.ts`
  - förbättra `getPanoramaImageUrl` (verifiera med mini‑GET)
  - förbättra `processBatch` (fail-fast + löpande error_message + failure counters)
  - ev. bättre output i `test-image-download`

---

## Testplan (praktiskt)
1) Gå till AI‑scanning → välj byggnad → kör “Testa bildnedladdning”
2) Förväntat:
   - OK: vi får content-type + storlek
   - FAIL: vi får tydlig felkedja (vilken hop/metod som ger 404/403)
3) Starta scan igen:
   - Om nedladdning failar: jobbet ska faila snabbt med tydligt fel i UI
   - Om nedladdning funkar: då ska AI börja skapa `pending_detections` (även om få)

