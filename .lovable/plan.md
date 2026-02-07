
# Spara ACC-inställningar och förbättra ACC-synkroniseringen

## Sammanfattning

Två huvudsakliga förbättringar:
1. **Spara ACC-inställningar persistent** -- Projekt-ID och region laddas automatiskt vid start
2. **Mappstruktur-browsning** -- Nytt "Visa mappar"-flöde som listar mappar i ACC via Data Management API (varje mapp kan motsvara en byggnad)

---

## Del 1: Spara projekt-ID och region

### Problem
Idag skriver du in projekt-ID och väljer region varje gång du öppnar inställningarna. Projekt-ID sparas redan i bakgrunden under synkronisering, men UI:t laddar inte tillbaka det i textfältet. Regionen sparas inte alls.

### Lösning
- Spara `acc_region` som en separat nyckel i `asset_plus_endpoint_cache` (samma tabell som redan används för `acc_project_id`)
- Ladda både projekt-ID och region automatiskt via `check-status`-anropet som körs vid start
- Fyll i textfältet och regionknappen med sparade värden

### Ändringar

**`supabase/functions/acc-sync/index.ts`**
- I `sync-locations`-casen: spara även `acc_region` i `asset_plus_endpoint_cache`
- I `check-status`-casen: hämta även `acc_region` och returnera `savedRegion`

**`src/components/settings/ApiSettingsModal.tsx`**
- I `handleCheckAccStatus`: populera `manualAccProjectId` med `savedProjectId` och `accRegion` med `savedRegion`
- Kör `handleCheckAccStatus()` automatiskt när ACC-sektionen öppnas (i `useEffect` vid mount)

---

## Del 2: Visa mappstrukturen i ACC (Data Management API)

### Problem
Användaren vill se vilka mappar (= byggnader) som finns i ACC-projektet, och vilka BIM-modeller (RVT/IFC) som finns i varje mapp. Idag synkas bara Locations API-data (Byggnader/Plan/Rum) och Assets API-data, men mappstrukturen med filerna visas aldrig.

### Hur ACC:s Data Management API fungerar

```text
Hub (b.{accountId})
  |
  +-- Project (b.{projectId})
        |
        +-- Top Folders (GET topFolders)
              |
              +-- "Project Files" (vanlig rot-mapp)
                    |
                    +-- "Småviken" (mapp = byggnad)
                    |     +-- Model_A.rvt (item = BIM-modell)
                    |     +-- Model_B.ifc (item = BIM-modell)
                    |
                    +-- "Storängen" (mapp = byggnad)
                          +-- Model_C.rvt
```

### Lösning
Lägga till ett nytt `list-folders`-action i `acc-sync` som:
1. Hämtar top-level mappar via `GET /data/v1/projects/b.{projectId}/topFolders`
2. Hittar "Project Files"-mappen (eller liknande)
3. Listar undermappar (= byggnader) och filer (= BIM-modeller) i varje mapp
4. Returnerar en trädstruktur till UI:t

I UI:t visas mapparna i en lista med expanderbara rader. Varje mapp visar sina BIM-filer.

### Ändringar

**`supabase/functions/acc-sync/index.ts`** -- Nytt action `list-folders`:
- Ny funktion `fetchTopFolders(token, projectId, hubId, region)` som anropar:
  - `GET /data/v1/projects/b.{projectId}/topFolders` (kräver `data:read` scope, redan konfigurerat)
- Ny funktion `fetchFolderContents(token, projectId, folderId, region)` som anropar:
  - `GET /data/v1/projects/b.{projectId}/folders/{folderId}/contents`
- Returnerar `{ folders: [{ id, name, items: [{ id, name, type, size }] }] }`

**`src/components/settings/ApiSettingsModal.tsx`**:
- Ny knapp "Visa mappar" bredvid "Hämta projekt"
- Ny state `accFolders` med mappträdet
- Rendera mapplistan med expanderbara rader som visar BIM-filerna (namn, typ, storlek)

---

## Teknisk sammanfattning

| Fil | Ändring |
|-----|---------|
| `supabase/functions/acc-sync/index.ts` | Spara/ladda `acc_region`, nytt `list-folders` action med Data Management API |
| `src/components/settings/ApiSettingsModal.tsx` | Auto-populera sparade inställningar, ny "Visa mappar"-knapp och mappvisning |

### Inga databasändringar krävs
Alla nya värden lagras i den befintliga tabellen `asset_plus_endpoint_cache`.

### API-endpoints som används (alla med 3-legged token)
- `GET /data/v1/projects/b.{projectId}/topFolders` -- lista rot-mappar
- `GET /data/v1/projects/b.{projectId}/folders/{folderId}/contents` -- lista mappinnehåll
- Befintliga: Locations API v2, Assets API v2, Categories API v1

### Ordning
1. Först: Spara och ladda projekt-ID + region (Del 1)
2. Sedan: Mappbrowsning (Del 2)
