

## Plan: Förbättra systempromten för Geminus AI

### Vad
Integrera de 8 domänspecifika instruktionerna och den förbättrade svarsstrukturen i den befintliga systempromten. Detta **ersätter inte** befintliga tekniska instruktioner utan **förstärker** dem med tydligare personlighet, domänkompetens och svarsformat.

### Ändringar

**Fil: `supabase/functions/gunnar-chat/index.ts`** — funktionen `buildSystemPrompt` (rad 1485-1777)

Infoga de nya sektionerna i systempromten, integrerat med befintlig text:

1. **Rad ~1485-1489**: Ersätt den korta intro-paragrafen med den nya **identiteten + personlighet & ton** (tydlig, konkret, aldrig onödigt teknisk, leder alltid till nästa steg, max en fråga åt gången, minimera skrivbörda)

2. **Rad ~1696-1718 (GUIDELINES)**: Ersätt nuvarande GUIDELINES-sektion med den nya **SVARSSTRUKTUR**-mallen:
   - Direkt svar (fetstil på nyckeltal)
   - Kontext (max 2 meningar, valfritt)
   - Nästa steg med klickbara alternativ
   - Tabeller vid jämförelser, punktlistor vid uppräkning, max 3 meningar löptext

3. **Infoga nya domänsektioner** (efter GUIDELINES, före EXAMPLES ~rad 1719):
   - **DOMÄN 1 – LARMHANTERING**: Aktiva/kvitterade/historiska larm, prioritering, koppling till arbetsorder
   - **DOMÄN 2 – ENERGIÖVERVAKNING**: Förbrukning el/värme/kyla/vatten, jämförelser, trender, avvikelser med ↑↓
   - **DOMÄN 3 – UNDERHÅLLSPLANERING**: Planerade/förfallna åtgärder, arbetsorder, servicehistorik
   - **DOMÄN 4 – UTRUSTNING & INVENTARIER**: Sökning per typ/plan/zon, tabellformat per plan när plan ej angett
   - **DOMÄN 5 – RITNINGAR & DOKUMENT**: Dokumenttyper grupperat, ritningar per system, koppling till arbetsorder
   - **DOMÄN 6 – STYRNING AV 3D/BIM-VISAREN**: Redan delvis täckt — förstärks med de specifika kommandoexemplen
   - **DOMÄN 7 – API-INTEGRERADE SYSTEM**: FM Access, Eon 360+, tydlig källa och tidsstämpel
   - **DOMÄN 8 – SYSTEMHJÄLP & KONFIGURATION**: Steg-för-steg, hänvisning till dokument

4. **Förstärk KONTEXTREGLER** (infoga efter domänerna):
   - Referera alltid till specifik fastighet/byggnad/plan/zon
   - Om kontext saknas: en preciserande fråga med klickbara alternativ
   - Gissa aldrig — visa källa och tidsstämpel
   - Tvetydigt visarkommando: bekräfta tolkningen först

5. **Förstärk SPRÅK-regler** (rad ~1697):
   - Byt aldrig språk utan explicit begäran
   - Anpassa formell/informell ton efter användaren

### Vad som behålls oförändrat
- Alla action tokens (rad 1490-1534)
- Alla dynamiska variabler (`${userCtx}`, `${ctx}`, `${buildingDirectory}`, `${modelsCtx}`, `${memoryCtx}`)
- Alla tekniska sektioner (REASONING, PROBLEM-SOLVING, WRITE OPERATIONS, FM ADVISOR, FM ACCESS, DOCUMENT Q&A, VIEWER CONTROL, SENSLINC, ASSET CATEGORIES, BIM MODEL NAMING, SWEDISH TERMINOLOGY)
- Alla EXAMPLES (rad 1719-1777)
- Ingen ändring av tools, tool-execution eller övrig logik

### Omfång
- 1 fil, ~100 rader tillagda/modifierade i systempromten
- Edge function deployas automatiskt

