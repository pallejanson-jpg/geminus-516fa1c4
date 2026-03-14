
Mål: Lösa tre problem i Geminus AI samtidigt utifrån din bekräftelse:
- Utkastning sker i sidopanelen (inte i fristående /ai)
- Svaren upplevs långsamma
- Rösten ska förbättras med webbläsarens röster (ingen extern premium-TTS)

1) Rotorsaksanalys (nuvarande läge)
- Sidopanelen använder `GunnarChat` i `embedded`-läge via `GunnarButton`.
- Klickbara svar triggar ofta navigations-actions (`openViewer`, `showFloorIn3D`, `showDrawing`) som idag går via route-navigation till `/viewer`.
- Det bryter arbetsflödet i sidopanelen och upplevs som att man “slängs ur”.
- Svarstiderna påverkas av:
  - Stor systemprompt (inkl. lång byggnadskatalog)
  - Iterativ tool-loop med upp till 4 rundor
  - Full konversationshistorik skickas från klienten
- Rösten använder ren Web Speech API utan kvalitetsscore för bästa tillgängliga röst, vilket ofta låter mekaniskt.

2) Implementationsplan – “utkastning” från sidopanel
Filer:
- `src/components/chat/GunnarChat.tsx`
- ev. `src/context/AppContext.tsx` (om liten hjälpfunktion behövs), annars ej

Ändring:
- Gör action-hanteringen kontextstyrd:
  - `ai-standalone` behåller route-navigation till `/viewer` (som idag).
  - `embedded` sidopanel i appen ska i stället öppna viewer via app-state (`setViewer3dFmGuid`) och events, inte via route-hop.
- För actions som behöver mode/floor/model:
  - Sätt byggnad via context-state
  - Dispatcha `VIEW_MODE_REQUESTED_EVENT`, `FLOOR_SELECTION_CHANGED_EVENT`, `GUNNAR_ISOLATE_MODEL` efter att viewer laddat.
- Ta bort auto-beteende som stänger chatten vid navigation i panelflödet (behåll panelen/minimera istället för att “kasta ut”).

Förväntat resultat:
- Klickbara svar fungerar utan att användaren lämnar sidopanel-flödet abrupt.
- Mindre “context loss” när man hoppar till 3D/2D från AI.

3) Implementationsplan – snabbare svar
Filer:
- `supabase/functions/gunnar-chat/index.ts`
- `src/components/chat/GunnarChat.tsx`

Backend-optimeringar:
- Sänk `MAX_TOOL_ROUNDS` från 4 → 2 (med fallback till slutstream som idag).
- Inför “fast-path” för enkla intents (hälsning, språk/voice, korta uppföljningar) utan full tool-loop.
- Minska promptstorlek:
  - Ta bort tung statisk byggnadslista i varje request
  - Instruera modellen att hämta byggnadslista via tool när den faktiskt behövs
- Byt standardmodell till snabbare standard enligt projektets AI-riktlinje (`google/gemini-3-flash-preview`) med fallback.

Frontend-optimeringar:
- Skicka endast senaste N turer (t.ex. 6–8), inte hela historiken.
- Rensa action-länkar ur assistant-historik innan återinskick (tokenbesparing).
- Behåll nuvarande streaming men med bättre timeout-/felkoppling för tydligare UX.

Förväntat resultat:
- Märkbart snabbare time-to-first-token.
- Kortare total svarstid i vanliga frågor.

4) Implementationsplan – mer naturlig webbröst
Filer:
- `src/components/chat/GunnarChat.tsx`
- `src/components/settings/GunnarSettings.tsx`

Ändring:
- Inför “best voice selector” för webbröster:
  - Prioritera exakt språkmatch + kvalitetsnamn (Google/Microsoft/Siri/Natural/Premium) när användaren inte valt specifik röst.
- Förbättra text-normalisering före uppläsning:
  - Rensa markdown bättre
  - Konvertera listor till naturliga pauser
  - Dela upp långa svar i frassegment för mindre monotoni
- Finjustera `rate/pitch` per språkprofil (`sv-SE`, `en-US`) för mer naturligt flyt.
- Lägg till “Testa röst”-knapp i Gunnar-inställningar så användaren direkt kan utvärdera röstval.

Förväntat resultat:
- Mindre robotkänsla, bättre prosodi, färre hack i långa svar.

5) Verifiering (E2E först)
- E2E 1 (viktigast): Öppna Geminus i sidopanel → klicka 5 olika action-svar (byggnad, floor, viewer, drawing, model) → bekräfta att användaren inte “kastas ur” chatflödet.
- E2E 2: Mät svarstid före/efter (TTFT + total) för 3 typfrågor.
- E2E 3: Testa röst i sv/en med auto-röst + manuell röst och jämför naturlighet.

6) Leveransordning
1. Fix sidopanel-navigation (utkastning)
2. Svarstidsoptimering (backend + klient)
3. Röstförbättring (web voice quality)
4. E2E och finjusteringar
