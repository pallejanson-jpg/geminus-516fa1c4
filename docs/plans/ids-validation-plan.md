# Plan: IDS-baserad datavalidering med BCF-rapportering

## Summary

Ett tillägg till IFC Federation-pipelinen (se [`ifc-federation-plan.md`](ifc-federation-plan.md)) som validerar uppladdade IFC-filer mot regler skrivna i **IDS** (Information Delivery Specification, buildingSMART-standard), och producerar en **BCF**-rapport (BIM Collaboration Format) som projektörer/designers kan öppna direkt i sitt eget verktyg, se exakt vad som är fel, åtgärda, och skicka tillbaka en korrigerad IFC-fil.

Detta är en **annan typ av validering** än vår FMGUID-hantering: FMGUID-logiken är Geminus egen lösning för objektidentitet över tid. IDS är en öppen, generell standard för att validera **vilken information som helst** i en BIM-modell — namnkonventioner, obligatoriska egenskaper, klassificeringar, materialangivelser, med mera. De kompletterar varandra, ersätter inte varandra.

## Vad är IDS, konkret (verifierat mot buildingSMARTs officiella spec)

En `.ids`-fil är en XML-fil uppbyggd av en eller flera **Specifications**. Varje specification har två delar:

- **Applicability** — vilka objekt gäller regeln för (t.ex. "alla väggar").
- **Requirements** — vad de objekten måste uppfylla (t.ex. "måste ha egenskapen brandklass").

Båda delarna byggs av sex möjliga **facets** (byggstenar): `Entity` (objekttyp), `Attribute` (IFC-attribut), `Classification` (klassificeringssystem, t.ex. BSAB/CoClass), `Property` (Pset-egenskap), `Material`, och `PartOf` (hierarkiska relationer, t.ex. "tillhör denna våning").

Exempel: "Alla `IfcWall`-objekt (Entity-facet i Applicability) måste ha en `FireRating`-egenskap (Property-facet i Requirements)."

IDS 1.0 publicerades av buildingSMART i juni 2024 — det är en etablerad, aktivt underhållen standard, inte experimentell. Källor: [buildingSMART IDS](https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/), [GitHub buildingSMART/IDS](https://github.com/buildingsmart/ids).

## Vad är BCF, konkret

En `.bcf`/`.bcfzip`-fil är i grunden en zip-fil med XML: en `markup.bcf` per "issue" (ärende) med beskrivning, status och referenser till specifika objekt via deras **IFC GUID**, plus valfria `viewpoint.bcfv`-filer (kameravy) och `snapshot.png`-bilder. Nästan alla BIM-verktyg (Revit, ArchiCAD, Solibri, BIMcollab, Navisworks m.fl.) kan öppna BCF och hoppa direkt till det refererade objektet. Källa: [buildingSMART BCF](https://www.buildingsmart.org/standards/bsi-standards/bim-collaboration-format/).

## Hur SimpleBIM (och liknande verktyg) löser detta

Enligt SimpleBIMs egen dokumentation ([simplebim.com](https://simplebim.com/bim-quality/), [Solibri/BIMcollab-jämförelser](https://www.engineering.com/reflections-on-bim-checking-and-validation/)): modellen valideras mot definierade krav, resultaten visas löpande i verktygets objekt-/egenskapspaneler som en **att-göra-lista** som uppdateras när man redigerar, och användaren kan skapa **BCF-ärenden direkt från valideringsträffar** för att kommunicera dem till andra parter i projektet. Mönstret är alltså: **regel → automatisk kontroll → mänsklig granskning av träffar → BCF-export för de som faktiskt behöver åtgärdas.** Det är precis den arbetsordningen den här planen följer.

## Verifierat i praktiken, inte bara i teorin

Testade `ifctester` på riktigt under research för den här planen — inte bara läst dokumentationen:

1. Installerade `ifcopenshell` + `ifctester` (`pip install ifcopenshell ifctester`) — fungerar utan problem på den här maskinen (Windows).
2. Skrev en enkel egen IDS-regel: "alla `IfcBuildingStorey` måste ha en `FmGuid`-egenskap i `FM_Pset`" — samma property vår egen pipeline redan letar efter.
3. Körde den mot en riktig fil från tidigare tester (`K-00-V-100 (NCC).ifc`) — resultat: **0/9 våningar godkända**, exakt samma siffra vår egen `federation-guid-validator.js` redan rapporterat för samma fil innan vår process kört (`hadFmguid: 0`). Två helt oberoende verktyg, samma slutsats — starkt tecken på att båda mäter rätt sak.
4. Genererade en BCF-rapport (`-r Bcf -o report.bcf`) — en riktig zip med **ett ärende per underkänd våning**. Öppnade och läste innehållet direkt: varje `markup.bcf` har en tydlig titel ("IfcBuildingStorey - Plan 10 - The required property set does not exist - 00Q_9q0pLCxRy2UnKdJ6p9"), och viewpoint-filen (`.bcfv`) väljer **rätt objekt via dess IfcGuid** (`<Component IfcGuid="00Q_9q0pLCxRy2UnKdJ6p9"/>`).

**Detta besvarar öppen fråga #2 ovan, om BCF-rapporten saknar geometri-viewpoints:** den har ingen renderad skärmdump eller anpassad kameravy (kameran är generisk/standard), men den **väljer korrekt objekt via GUID**. Det räcker för att i princip alla BIM-verktyg (Revit, ArchiCAD, Solibri, BIMcollab m.fl.) ska kunna öppna BCF-filen och hoppa/markera rätt objekt automatiskt — precis den arbetsgång du beskrev ("de öppnar den i sitt program, ser vad som är fel, åtgärdar").

## Nyckelbeslut: återanvänd `ifctester`, bygg inte en egen IDS-motor

**`ifctester`** är ett moget, aktivt underhållet open source-verktyg som är en del av **IfcOpenShell**-ekosystemet (samma ekosystem som `web-ifc`/IFC.js-familjen härstammar ur, men mer fullständigt för just detta syfte). Bekräftat via dess dokumentation ([docs.ifcopenshell.org/ifctester.html](https://docs.ifcopenshell.org/ifctester.html)):

- Körs som CLI: `python -m ifctester specs.ids model.ifc -r Bcf -o report.bcfzip`
- Tar en `.ids`-fil + en `.ifc`-fil som indata.
- Kan **direkt** producera rapporter i flera format via sin `reporter`-modul: `Console`, `Html`, `Json`, och **`Bcf`** — BCF-rapportering är inbyggd, inte något vi behöver bygga själva.
- Implementerar alla sex IDS-facet-typer korrekt mot IFC:s fulla datamodell (property sets, klassificeringar, materialrelationer, hierarki) — något som skulle vara ett betydande eget utvecklingsarbete att återskapa i JavaScript, med hög risk att missa edge-cases som redan är lösta i ett moget bibliotek.

**Beslut:** kör `ifctester` som en subprocess (Python) från vår Node-app, istället för att skriva en egen IDS-tolkare. Detta är samma princip som redan styrt hela pipelinen (återanvänd beprövad kod istället för att uppfinna på nytt), fast här handlar det om ett externt, öppet verktyg istället för intern kod.

**Konsekvens att vara medveten om:** detta introducerar ett **Python-beroende** i en annars ren Node.js-app. `ifctester`/IfcOpenShell har färdiga pip-paket för vanliga plattformar (Linux, Windows, macOS), så det är inte en showstopper, men det påverkar deployment (Render/Cloud Run-avbilden behöver Python + `pip install ifcopenshell ifctester` utöver Node) och är en ny sak att underhålla/uppdatera. Alternativet — en JS-implementation — undviker Python-beroendet men är ett mycket större och mer riskfyllt eget bygge. Rekommendation: acceptera Python-beroendet, det är en liten deployment-komplexitet mot ett stort utvecklingsarbete sparat.

## Föreslaget flöde i appen

1. **Ny sektion i UI:t**, efter dagens matchning/export-flöde: "5. Validera mot IDS".
2. Användaren laddar upp en eller flera `.ids`-regelfiler (antingen egna, eller ett gemensamt Geminus-standardbibliotek vi tillhandahåller — se öppna frågor).
3. Backend kör `ifctester <ids-fil> <ifc-fil> -r Bcf -o <output>.bcfzip` per uppladdad disciplinfil (subprocess, samma mönster som redan finns för Express+multer-hantering).
4. Resultat visas i UI:t som en sammanfattning (antal godkända/underkända kontroller per fil — `ifctester` har även en `Json`-rapportform som är enkel att rendera i tabellform, likt matchningsmatrisen).
5. Knapp: **"Ladda ner BCF-rapport"** — en zip med alla underkända kontroller, redo att skickas till projektören/designern som skapade filen. De öppnar den i sitt eget verktyg, ser exakt vilket objekt och vilken regel som brister, åtgärdar, och skickar tillbaka en korrigerad IFC.

Detta kan köras **oberoende av eller tillsammans med** dagens FMGUID-flöde — en fil kan valideras mot IDS innan, efter, eller utan att alls gå igenom våningsmatchningen.

## Öppna frågor att lösa innan byggstart

1. **Varifrån kommer `.ids`-reglerna?** Ska Geminus tillhandahålla ett standardbibliotek (t.ex. "kräv FMGUID + brandklass + klassificering på alla väggar"), låta varje projekt/kund ladda upp sina egna, eller båda? Detta är egentligen den viktigaste designfrågan — själva valideringsmotorn är löst via `ifctester`, men **vilka regler** som ska köras är en verksamhetsfråga, inte en teknisk.
2. ~~Saknar BCF-rapporten geometri-viewpoints?~~ **Löst, se "Verifierat i praktiken" ovan** — ingen skärmdump/anpassad kameravy, men korrekt objekt-GUID-referens, vilket räcker för de flesta BIM-verktyg.
3. **Var körs Python-processen?** Lokalt (som resten av appen idag) är enkelt — bara installera `ifcopenshell`/`ifctester` i `.venv` bredvid Node-processen. Vid molndeploy (Render/Cloud Run, se tidigare diskussion) behöver avbilden byggas med både Node och Python, vilket är en enkel men verklig extra rad i Dockerfile/build-steg.
4. **IDS-version och kompatibilitet:** IDS 1.0 (juni 2024) är den version vi bör utgå från; värt att bekräfta att `ifctester`s installerade version stödjer den fullt ut vid implementationstillfället.

## Föreslagen byggordning

1. **Proof of concept, fristående:** installera `ifcopenshell`/`ifctester` lokalt, kör manuellt mot en av våra befintliga testfixturer + en handskriven enkel `.ids`-fil (t.ex. "alla `IfcBuildingStorey` måste ha `FmGuid`-property" — vi kan validera vår egen pipelines output med IDS!). Bekräfta att BCF-utdatan faktiskt går att öppna i ett verktyg vi har tillgång till.
2. **Node-wrapper:** en ny modul (`ifc-federation/ids-validator.js` eller liknande) som anropar `ifctester` som subprocess och tolkar dess JSON-utdata till en struktur vårt UI kan visa.
3. **UI-integration:** ny sektion i `ifc-federation-app`, enligt flödet ovan.
4. **Regelbibliotek:** i samråd med er, bygg ett första gemensamt `.ids`-regelset för Geminus (kan med fördel inkludera "FMGUID måste finnas" som en IDS-regel, vilket faktiskt validerar hela vår egen pipeline med samma verktyg).

## Sources
- [buildingSMART IDS](https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/)
- [GitHub buildingSMART/IDS](https://github.com/buildingsmart/ids)
- [IDS User Manual](https://github.com/buildingSMART/IDS/blob/development/Documentation/UserManual/README.md)
- [buildingSMART BCF](https://www.buildingsmart.org/standards/bsi-standards/bim-collaboration-format/)
- [IfcTester documentation (IfcOpenShell)](https://docs.ifcopenshell.org/ifctester.html)
- [ifctester.reporter API docs](https://docs.ifcopenshell.org/autoapi/ifctester/reporter/index.html)
- [Simplebim — What is BIM quality?](https://simplebim.com/bim-quality/)
