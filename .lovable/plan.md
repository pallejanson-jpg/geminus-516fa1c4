
## Gunnar Smartness Upgrade -- Strategisk Plan

### Nuvarande Tillstand

Gunnar ar idag en solid tool-calling-assistent med:
- 14 verktyg (assets, work orders, issues, documents, IoT-data, byggnadsinformation)
- 5 rundors iterativ tool-calling-loop
- Streaming-svar med action-knappar i markdown
- Kontextmedvetenhet (aktiv byggnad, vaning, rum, viewer-state)
- google/gemini-2.5-flash som modell

### Forbattringsstrategi -- 3 Nivaer

---

### Niva 1: Smartare Systemprompt (Storst Effekt, Minst Arbete)

Systemprompten ar bra men saknar flera saker som drastiskt okar kvalitet:

**A. Few-shot-exempel i prompten**
Lagg till 3-4 konkreta fraga-svar-exempel som visar Gunnar *hur* ett perfekt svar ser ut. Modeller presterar 30-50% battre med few-shot. Exempel:

```
EXAMPLE INTERACTION:
User: "Hur manga rum finns det pa plan 3 i Tornet?"
Assistant thinking: I need to first find the building "Tornet", then find floor 3, then count rooms.
1. Call get_building_summary(fm_guid for Tornet) -> get floors list
2. Call get_floor_details(floor 3 fm_guid) -> get rooms
3. Synthesize: "Plan 3 i Tornet har **12 rum** med en totalyta pa **485 m2**..."
```

**B. Domankompetens i prompten**
Lagg till svensk fastighetsterminologi direkt i systemprompten:
- NTA (nettoarea), BTA (bruttoarea), BOA, LOA definitioner
- Vanliga asset-typer och deras svenska/engelska namn
- SIS-standarder for fastighetsforvaltning (SS 876001)
- Vanliga nyckeltal (energiforbrukning per kvm, drift- och underhallskostnad)

**C. Resoneringsanvisningar**
Lagg till "chain-of-thought"-instruktioner: "Before answering, think step by step about what data you need. If the question requires combining data from multiple sources, plan your tool calls first."

---

### Niva 2: Fler och Smartare Verktyg

**A. Aggregerings-verktyg** (ny)
Skapa `aggregate_assets` som gor GROUP BY-liknande operationer direkt i databasen istallet for att hamta 1000 rader och lata modellen rakna:

```
aggregate_assets:
  - group_by: "asset_type" | "category" | "level_fm_guid"
  - metric: "count" | "sum_area" | "avg_area"
  - building_fm_guid: filter
```

Idag maste Gunnar hamta alla assets och rakna manuellt. Med aggregering far den svaret direkt.

**B. Jamforelse-verktyg** (ny)
`compare_buildings` -- hamtar sammanfattning for 2+ byggnader i ett anrop istallet for att gora separata get_building_summary-anrop.

**C. Tidsserie-analys for arbetsordrar** (ny)
`work_order_trends` -- grupperar arbetsordrar per manad/vecka for att svara pa "Okar felanmalningarna?" utan att hamta hundratals rader.

**D. Attribut-sokning** (forbattra befintlig)
Lagg till sokning i `attributes`-JSONB-kolumnen i assets-tabellen. Manga intressanta fastighetsdata (NTA-yta, materialval, installationsar) ligger dar men ar idag osokbara for Gunnar.

---

### Niva 3: Battre Modell och Konversationsminne

**A. Uppgradera till google/gemini-2.5-pro**
Pro-modellen ar markant battre pa:
- Komplex resonering (jamforelser, trendanalys)
- Att folja instruktioner exakt (action-knappar, format)
- Att hantera stora tool-resultat utan att tappa sammanhanget

Risk: Gemini 2.5 Pro kan ge 500-fel vid stora tool-definitioner (historiskt problem). Losning: testa noggrant, ha fallback till Flash.

**B. Konversationsminne over sessioner**
Idag aterstartar Gunnar vid varje kontextbyte. Lagg till:
- Spara konversationer i en `gunnar_conversations`-tabell
- Hamta de senaste 3-5 meddelandena fran forra sessionen som kontext
- Lat Gunnar referera till tidigare fragor: "Du fragade om Tornet forut..."

**C. Anvandarprofil i prompten**
Hamta anvandarprofilen (roll, namn) fran `profiles`-tabellen och inkludera i systemprompten. En forvaltare vill ha annat an en drifttekniker.

---

### Niva 4: Proaktiv och Handlingskraftig Gunnar

**A. Proaktiva insikter**
Nar Gunnar oppnas i kontexten av en byggnad, gor en snabb analys automatiskt:
- "Jag ser att det finns 3 oppna felanmalningar med hog prioritet i Tornet"
- "Temperaturen i rum 201 har legat over 26C de senaste 24h"

Implementera genom att gora initiala tool-anrop *innan* anvandaren stallert sin forsta fraga.

**B. Atgardsverktyg (write-tools)**
Lat Gunnar inte bara lasa utan aven agera:
- `create_work_order` -- skapa felanmalan direkt fran chatten
- `update_issue_status` -- stang/oppna arenden
- `add_bcf_comment` -- kommentera pa arenden

Dessa kopplas med bekraftelse-steg: Gunnar foreslsr, anvandaren klickar "Bekrafta".

---

### Prioriterad Implementationsordning

| Prioritet | Atgard | Effekt | Arbetsinsats |
|---|---|---|---|
| 1 | Few-shot-exempel + domankompetens i systemprompt | Hog | Lag |
| 2 | Aggregerings-verktyg (aggregate_assets) | Hog | Medel |
| 3 | Attribut-sokning i assets | Medel | Lag |
| 4 | Proaktiva insikter vid oppning | Hog | Medel |
| 5 | Konversationsminne (DB-tabell) | Medel | Medel |
| 6 | Jamforelse- och trendverktyg | Medel | Medel |
| 7 | Uppgradera till gemini-2.5-pro (med fallback) | Medel | Lag |
| 8 | Write-tools (skapa felanmalan etc.) | Hog | Hog |
| 9 | Anvandarprofil i prompten | Lag | Lag |

---

### Tekniska Andringar

**Filer som andras:**
- `supabase/functions/gunnar-chat/index.ts` -- systemprompt, nya verktyg, modell-uppgradering
- `src/components/chat/GunnarChat.tsx` -- bekraftelse-UI for write-tools, proaktiva insikter
- `src/components/chat/GunnarButton.tsx` -- trigga proaktiv analys vid oppning

**Ny databas-tabell (for konversationsminne):**
- `gunnar_conversations` (user_id, messages JSONB, building_fm_guid, created_at, updated_at)

**Inga nya beroenden kravs.** Allt bygger pa befintlig infrastruktur (Lovable AI Gateway, Supabase, befintliga tabeller).
