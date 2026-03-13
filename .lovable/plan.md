

## Analys: XKT-Worker och Asset+-byggnader som Småviken

### Nuläge

XKT-Workern är byggd för **IFC → XKT**-konvertering:
1. `batch-enqueue` hittar redan alla byggnader (IFC + XKT + ACC) — det fungerar
2. **Men** för Asset+-byggnader utan IFC-fil skapar den ett jobb med `ifc_storage_path` som pekar på en XKT-fil istället
3. `/pending`-endpointen genererar en signed URL från **`ifc-uploads`-bucketen** — men Asset+-modellerna ligger i **`xkt-models`-bucketen**
4. Workern försöker sedan läsa filen som IFC och crashar

**Kärnan i problemet**: Workern antar alltid att källfilen är IFC i `ifc-uploads`.

### Lösning

Utöka pipeline så att den hanterar två jobbtyper:

**Typ 1: IFC-jobb** (befintligt flöde, oförändrat)
- Källa: IFC-fil i `ifc-uploads`
- Worker: konverterar IFC → per-storey XKT + populerar hierarki

**Typ 2: XKT-reprocessering** (nytt)
- Källa: befintliga XKT-filer i `xkt-models` (från Asset+)
- Worker: laddar ner XKT, extraherar metadata/hierarki, kan slå samman eller re-tila om IFC finns tillgänglig
- Alternativt: tillåter att man laddar upp en IFC-fil till en befintlig Asset+-byggnad och kör full konvertering

### Ändringar

#### 1. `conversion_jobs`-tabellen — nytt fält
```sql
ALTER TABLE conversion_jobs ADD COLUMN source_type text NOT NULL DEFAULT 'ifc';
-- Värden: 'ifc', 'xkt', 'ifc-upload-to-existing'
ALTER TABLE conversion_jobs ADD COLUMN source_bucket text NOT NULL DEFAULT 'ifc-uploads';
```

#### 2. `conversion-worker-api/index.ts`

**`/pending`**: Generera signed URL från rätt bucket baserat på `source_bucket`-fältet istället för att alltid anta `ifc-uploads`.

**`/batch-enqueue`**: Sätt `source_type` och `source_bucket` korrekt:
- Om IFC finns i `ifc-uploads` → `source_type: 'ifc'`, `source_bucket: 'ifc-uploads'`
- Om bara XKT finns → `source_type: 'xkt'`, `source_bucket: 'xkt-models'`

#### 3. `worker.mjs` — hantera XKT-källa

Ny gren i `processJob`:
- Om `source_type === 'xkt'`: ladda ner XKT-filerna, extrahera metadata, kör `populate-hierarchy` utan konvertering
- Om `source_type === 'ifc'`: befintligt flöde

#### 4. `CreateBuildingPanel.tsx` — IFC-uppladdning för Asset+-byggnader

Tillåt att man laddar upp en IFC-fil till en byggnad som redan har Asset+-data. Jobbet skapas med `source_type: 'ifc-upload-to-existing'` och kör full konvertering + hierarki-population, vilket ger per-storey tiling även för Småviken.

### Resultat

- **Småviken** (och andra Asset+-byggnader) kan köas direkt via batch-enqueue
- Om det bara finns XKT: hierarki-population utan konvertering
- Om man laddar upp en IFC till en befintlig byggnad: full per-storey tiling + hierarki

