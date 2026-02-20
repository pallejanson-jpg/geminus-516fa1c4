

## Forbattringar: Vaningsnamn, 3D-laddning, FM-grid, Portfolio, BIM-namn

### Sammanfattning

Denna plan adresserar alla kvarstaende problem fran den tidigare analysen: namnlosa vaningar, trog 3D-laddning, FM-grid-buggar, Portfolio-duplicering och BIM-modellnamn.

---

### 1. Databasfix: Namnge 3 namnlosa vaningar i Smaviken

Tre vaningar saknar `common_name` och `name`. Rumnamnsmonster avslojar vilka vaningar de tillhor:

```text
38591717-... → rum heter "01.2.xxx" → Våning 02
15c10118-... → rum heter "01.3.xxx" → Våning 03
b78f0b93-... → rum heter "02.4.xxx" → Våning 04
```

**SQL-migrering:**
```sql
UPDATE assets SET common_name = '02', name = 'Våning 02' WHERE fm_guid = '38591717-d449-44c5-b28b-67c13c9941d4';
UPDATE assets SET common_name = '03', name = 'Våning 03' WHERE fm_guid = '15c10118-0d2e-4919-9c96-dd2f17932dbf';
UPDATE assets SET common_name = '04', name = 'Våning 04' WHERE fm_guid = 'b78f0b93-9a69-49d0-9727-37cc42c04003';
```

Detta fixar automatiskt alla stallen dar vaningsnamn visas (karusell, diagram, grid).

---

### 2. Radera 90% av IfcAlarm for Smaviken

Smaviken har 17 000+ alarm som gor allt trogt. Radera slumpmasigt 90% (ca 15 400 st):

```sql
DELETE FROM assets 
WHERE asset_type = 'IfcAlarm' 
  AND building_fm_guid = 'a8fe5835-e293-4ba3-92c6-c7e36f675f23'
  AND random() < 0.9;
```

---

### 3. Portfolio: Ta bort dubbletten Stadshuset Nykoping

Byggnaden `7cad5eda-796f-4b41-a74a-2f74dc290c31` (Stockholmshem-gruppen) har 0 rum och 0 vaningar -- den ar en tom kopia. Filtrera bort tomma byggnader i `PortfolioView.tsx`.

**Andring i `PortfolioView.tsx`:** I facilities-memo, filtrera bort byggnader som har exakt 0 barn-vaningar och 0 barn-rum i `allData`.

---

### 4. XKT Backend-cache: Direct Storage Upload

**Problem:** `saveModelFromViewer` skickar 50 MB base64-data via edge function -- den misslyckas (kroppen ar for stor for edge functions, 8 MB gransen). Loggen visar: `XKT save: Edge function upload failed - FunctionsHttpError`.

**Losning:** Byt fran edge function till direkt `supabase.storage.from('xkt-models').upload()` i klienten.

**Andring i `xkt-cache-service.ts` (`saveModelFromViewer`):**
- Ersatt `supabase.functions.invoke('xkt-cache', { body: { action: 'store', xktData: base64 } })`
- Med `supabase.storage.from('xkt-models').upload(path, xktBlob, { upsert: true, contentType: 'application/octet-stream' })`
- Behall metadata-upsert till `xkt_models`-tabellen (redan korrekt)
- Fordelning: ingen base64-konvertering behoves (sparar 33% minne), ingen edge function timeout

**RLS:** Saker att storage bucket `xkt-models` tillater authenticated uploads. Om inte, lagg till en policy.

---

### 5. FloorCarousel: Forbattrad namnfallback

Aven med databasfixen bor `FloorCarousel.tsx` ha battre generell fallback for namnlosa vaningar. Nuvarande kod visar "Vaning 1, 2, 3..." men numreringen ar sekventiell (inte baserad pa riktiga vaningsnummer).

**Forbattring:** Nar `rawName` ar ett GUID och vaningen har barn, analysera barnens namn for att haerleda vaningsnummer (monstra typ `xx.N.xxx` -> Vaning N).

---

### 6. FM-grid: MapPin-knappar till hoger om staplar

**Problem:** MapPin-knapparna ligger under diagrammet istallet for bredvid staplarna.

**Losning:** Byt layout fran vertikal till horisontell: diagrammet till vanster (85% bredd) + en kolumn med MapPin-knappar till hoger (15%). Varje MapPin-knapp placeras i linje med sin stapel.

**Implementering:** Ersatt `<div className="flex flex-wrap">` under diagrammet med en `flex`-layout dar diagrammet och knappkolumnen sitter sida vid sida. MapPin-knapparna renderas i en vertikal lista som matchar staplarnas positioner.

---

### 7. Oga-knappen i FM-grid: Annotation + Zoom

**Nuvarande status:** Koden ar redan korrekt i `drawerMode` -- den dispatchar `ALARM_ANNOTATIONS_SHOW_EVENT` med `flyTo: true`. I icke-drawerMode navigerar den till 3D-viewern med `entity`-param.

**Problem:** Anvandaren vill att den ALDRIG navigerar till fullskarms-3D. Den ska alltid dispatcha event.

**Fix:** I icke-drawerMode, dispatcha eventet ocksa (istallet for `navigateTo3D`). Om inline-viewern ar synlig (desktop) hanteras det dar. Om den inte ar synlig, ga till 3D med annotation-data i sessionStorage men utan fullskarmsnavigering.

---

### 8. BIM-modellnamn: Fixa for Smaviken

**Rotorsak:** `xkt_models`-tabellen har `model_name = GUID` for bada Smaviken-modellerna. Hooken `useModelNames` faller igenom till Asset+ API (`GetModels`-endpointen), men den returnerar troligen inga resultat (eftersom modellerna synkats med GUID-baserade filnamn).

**Losning (tvasteg):**

1. **Strategy 6/7 forbattring i `ModelVisibilitySelector`:** Nar `metaModel.rootMetaObject` ar null (vanligt for XKT-modeller), sok ALLA metaObjects av typen `IfcProject` och matcha via `metaObj.metaModel?.id`. Om `metaModel`-referensen ocksa saknas, anvand en position-baserad matchning: tilldela IfcProject-namn i ordning till modeller som saknar namn.

2. **Uppdatera `xkt_models` med riktiga namn:** Nar Strategy 6/7 hittar ett IfcProject-namn, skriv tillbaka det till databasen (`model_name`) sa det cachas for nasta gang.

---

### 9. Kompakt 3D-lage for Insights

**Problem:** Inline-viewern i Insights (400x500px) visar for mycket UI: FloorCarousel, NavCube, toolbar ar for breda.

**Losning:** Lagg till en prop `compactMode` pa `AssetPlusViewer` som:
- Doljer FloorCarousel helt
- Minskar NavCube-storleken
- Doljer toolbar-text (bara ikoner)
- Doljer Room Labels-knapp

Satt `compactMode={true}` pa `InsightsInlineViewer`s `AssetPlusViewer`.

---

### 10. Etikettfel: "Kan inte ladda etikettkonfigurationer"

Kontrollera `useRoomLabelConfigs` -- den soker i `room_label_configs`-tabellen. Felet kan bero pa att tabellen inte finns eller att RLS blockerar. Fixa genom att wrappa queryn i try/catch sa att felet inte visar en rod banner.

---

### Filer som andras

| Fil | Andring |
|---|---|
| Databasmigrering | 1) Namnge 3 vaningar, 2) Radera 90% alarm |
| `src/services/xkt-cache-service.ts` | Byt `saveModelFromViewer` till direkt Storage upload |
| `src/components/insights/BuildingInsightsView.tsx` | 1) MapPin-layout hoger om staplar, 2) Oga-knapp dispatchar event aven i icke-drawerMode |
| `src/components/viewer/FloorCarousel.tsx` | Forbattrad namnfallback med barnnamnsanalys |
| `src/components/portfolio/PortfolioView.tsx` | Filtrera bort tomma byggnader (0 rum + 0 vaningar) |
| `src/components/viewer/ModelVisibilitySelector.tsx` | Forbattrad Strategy 6/7 + write-back till DB |
| `src/hooks/useModelNames.ts` | Lagg till Strategy 6 write-back |
| `src/components/viewer/AssetPlusViewer.tsx` | Lagg till `compactMode` prop |

### Prioritetsordning

1. **Databasfixar** (vaningsnamn + alarm-reducering) -- omedelbar effekt
2. **XKT direct storage upload** -- fixar backend-cache, snabbare laddning
3. **Portfolio duplicering** -- enkel fix
4. **MapPin-layout + Oga-knapp** -- FM-grid forbattringar
5. **BIM-modellnamn** -- Strategy 6/7 forbattring + write-back
6. **Kompakt 3D-lage** -- responsivitet i Insights
7. **FloorCarousel fallback** -- sakerhetsnat for framtida byggnader

