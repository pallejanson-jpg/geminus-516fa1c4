

# Komplett CRUD-process: Bidirektionell synk mellan Lovable och Asset+

## Nulageskartlaggning

### Vad finns idag

| Operation | Lovable -> Asset+ | Asset+ -> Lovable |
|-----------|------------------|-------------------|
| **Create** | `asset-plus-create` (enstaka objekt via AddObject) | `sync-structure`, `sync-assets-resumable` (bulk) |
| **Read** | Lokal databas via `fetchLocalAssets()` | Via `PublishDataServiceGetMerged` |
| **Update** | `asset-plus-update` (batch via UpdateBimObjectsPropertiesData) | Full re-sync (overskriver lokala varden) |
| **Delete** | Saknas helt | `sync-with-cleanup` (tar bort lokala orphans) |

### Aktuell data i databasen

- 85 523 synkade objekt (`is_local = false`)
- 15 lokalt skapade objekt (`is_local = true`)
- Totalt: 85 538 objekt

De 180 objekt som diskrepanskontrollen rapporterar avser **strukturobjekt** (Byggnad/Plan/Rum), inte tillgangar. Det ar troligen rum eller vaningsplan som tagits bort ur BIM-modellen i Asset+ men fortfarande finns kvar lokalt.

### Vad saknas for komplett CRUD

1. **Batch-push av lokala objekt till Asset+** (anvander `AddObjectList` istallet for enstaka `AddObject`)
2. **Delete/Expire** -- ingen mojlighet att ta bort objekt i Asset+ fran Lovable
3. **Inkrementell synk** -- bara full re-sync finns, ingen delta baserad pa `dateModified`
4. **Konflikthantering** -- nar bade Lovable och Asset+ andrat samma objekt
5. **Flytt av objekt** -- `UpsertRelationships` for att flytta objekt mellan rum/vaningsplan

---

## Losningsforslag: Komplett CRUD-arkitektur

### Grundprinciper

- **FM GUID** ar den unika nyckeln i bada systemen
- **`is_local`-flagga** avgpr om ett objekt enbart finns lokalt (true) eller ar synkat med Asset+ (false)
- **Asset+ ar master** for strukturobjekt (Building, Storey, Space) -- dessa skapas via BIM-import
- **Lovable ar master** for lokalt inventerade tillgangar tills de synkas
- **Senast andrad vinner** for uppdateringar, med manuell konfliktlosning som framtida tillagg

### CRUD-flode oversikt

```text
SKAPA (Create)
--------------
Lovable Inventering --> lokalt objekt (is_local=true)
                    --> "Pusha till Asset+" --> AddObjectList --> is_local=false

Asset+ BIM-import   --> sync-structure/sync-assets --> lokalt objekt (is_local=false)


LASA (Read)
-----------
Primar kalla: Lokal databas (snabbast)
Fallback: Asset+ API via PublishDataServiceGetMerged


UPPDATERA (Update)
------------------
Lokalt objekt (is_local=true)  --> uppdatera lokal DB
Synkat objekt (is_local=false) --> uppdatera lokal DB + UpdateBimObjectsPropertiesData
Fran Asset+                    --> delta-sync baserat pa dateModified


TA BORT (Delete / Expire)
-------------------------
Lokalt objekt   --> radera fran lokal DB (inget Asset+-anrop)
Synkat objekt   --> ExpireObject i Asset+ + radera/markera lokalt
Fran Asset+     --> sync-with-cleanup tar bort lokala orphans
```

---

## Implementationsplan

### Steg 1: Ny edge function `asset-plus-delete` (ExpireObject)

Skapar en ny edge function som anropar Asset+ API:ets `ExpireObject` endpoint. Objekt i Asset+ "tas inte bort" utan far ett utgangsdatum (soft delete).

**Funktionalitet:**
- Ta emot en lista av `fmGuids` att ta bort/expirera
- For lokala objekt (`is_local = true`): radera direkt fran lokal DB
- For synkade objekt (`is_local = false`): anropa `ExpireObject` i Asset+ och sedan radera lokalt
- Returnera resultat per objekt (lyckades/misslyckades)

**Asset+ API-anrop:**
```text
POST /ExpireObject
{
  "APIKey": "...",
  "ExpireBimObjects": [
    { "FmGuid": "xxx", "ExpireDate": "2026-02-06T12:00:00Z" }
  ]
}
```

### Steg 2: Uppgradera `asset-plus-create` till AddObjectList

Nuvarande `asset-plus-create` anvander `AddObject` (enstaka objekt). Uppgradera till `AddObjectList` for batch-stod:

**Andringar:**
- Acceptera en lista av objekt istallet for ett enstaka
- Anvand `AddObjectList` med `BimObjectWithParents`-format
- Stod for att pusha flera lokala objekt i en och samma begaran
- Uppdatera `is_local = false` och `synced_at` for alla lyckade objekt

### Steg 3: Ny action `push-local-to-remote` i `asset-plus-sync`

En ny action i befintliga sync-funktionen som:
1. Hamtar alla objekt med `is_local = true`
2. Validerar att de har `in_room_fm_guid` (krav fran Asset+)
3. Anropar `AddObjectList` i batch
4. Anropar `UpdateBimObjectsPropertiesData` for att satta egenskaper
5. Uppdaterar `is_local = false` for lyckade objekt

### Steg 4: Ny action `delta-sync` i `asset-plus-sync`

Inkrementell synk baserad pa `dateModified`:
1. Hamta senaste `synced_at` fran `asset_sync_state`
2. Fraga Asset+ efter objekt med `dateModified > last_sync_completed_at`
3. Upserta andrade objekt lokalt
4. Rapportera antal nya/andrade/borttagna

### Steg 5: Frontend-integration

**Egenskapsdialogen (UniversalPropertiesDialog):**
- Lagg till "Ta bort"-knapp (med bekraftelse) for Instance-objekt
- Visa tydlig status: "Lokal" (orange badge) vs "Synkad" (gron badge)
- "Pusha till Asset+"-knapp for lokala objekt

**Inventerings-vy (Inventory):**
- "Synka alla lokala" massatgardsknapp
- Statuskolumn som visar sync-status per objekt

**Settings Sync-flik:**
- Ny rad "Lokala objekt" som visar antal ospushade lokalt
- Knapp "Pusha lokala till Asset+" med progress

---

## Tekniska detaljer

### asset-plus-delete edge function

```text
Fil: supabase/functions/asset-plus-delete/index.ts

Input:  { fmGuids: string[], expireDate?: string }
Output: { success, results: [{ fmGuid, success, error?, expired? }], summary }

Flode:
1. Verifiera auth
2. Hamta assets fran lokal DB for att avgora is_local
3. Lokala objekt: DELETE fran assets-tabellen direkt
4. Synkade objekt: Anropa ExpireObject i Asset+ -> om OK, DELETE lokalt
5. Returnera resultat
```

### Uppgraderad asset-plus-create (AddObjectList)

```text
Fil: supabase/functions/asset-plus-create/index.ts (uppdatera)

Nytt format:
Input:  { objects: [{ parentSpaceFmGuid, designation, commonName, fmGuid, properties }] }
         -- Aven stod for enstaka objekt (bakatkompatiblitet)

Flode:
1. Bygg BimObjectWithParents-array
2. POST till AddObjectList
3. Upserta alla skapade objekt lokalt med is_local = false
```

### push-local-to-remote action

```text
I: supabase/functions/asset-plus-sync/index.ts (ny action)

Flode:
1. SELECT * FROM assets WHERE is_local = true AND in_room_fm_guid IS NOT NULL
2. Gruppera per building
3. For varje batch:
   a. AddObjectList (skapa i Asset+)
   b. UpdateBimObjectsPropertiesData (satt egenskaper)
   c. UPDATE assets SET is_local = false, synced_at = now() WHERE fm_guid IN (...)
4. Rapportera resultat
```

### delta-sync action

```text
I: supabase/functions/asset-plus-sync/index.ts (ny action)

Flode:
1. Hamta last_sync_completed_at fran asset_sync_state
2. Fraga Asset+ med filter: [dateModified, ">", last_sync_date] OR [dateCreated, ">", last_sync_date]
3. Upserta resultat i lokal DB
4. Uppdatera asset_sync_state
```

### Databas-andringar

RLS-policyn for DELETE pa assets saknas for vanliga anvandare. En ny RLS-policy behovs:

```sql
CREATE POLICY "Authenticated users can delete local assets"
  ON public.assets
  FOR DELETE
  TO authenticated
  USING (is_local = true);
```

Alternativt kan DELETE goras via service_role i edge function (som sync-with-cleanup redan gor).

### Frontend-andringar

| Fil | Andring |
|-----|---------|
| `UniversalPropertiesDialog.tsx` | "Ta bort"-knapp, sync-status badge, "Pusha till Asset+"-knapp |
| `Inventory.tsx` | "Synka alla lokala"-knapp, status-indikator |
| `ApiSettingsModal.tsx` | Ny rad for lokala objekt + push-knapp |
| `asset-plus-service.ts` | Ny `deleteAssets()` och `pushLocalToRemote()` |

---

## Implementationsordning

| Prio | Steg | Beskrivning | Filer |
|------|------|-------------|-------|
| 1 | Delete/Expire | `asset-plus-delete` edge function + frontend-knapp | Ny edge fn, `UniversalPropertiesDialog.tsx`, `asset-plus-service.ts` |
| 2 | Batch push | `push-local-to-remote` action + "Synka lokala" UI | `asset-plus-sync/index.ts`, `ApiSettingsModal.tsx`, `Inventory.tsx` |
| 3 | AddObjectList | Uppgradera `asset-plus-create` till batch | `asset-plus-create/index.ts` |
| 4 | Delta-sync | Inkrementell synk baserad pa dateModified | `asset-plus-sync/index.ts`, `ApiSettingsModal.tsx` |
| 5 | Sync-status UI | Tydliga badges, push-knappar, progress | `UniversalPropertiesDialog.tsx`, `Inventory.tsx` |

---

## Risker och begransningar

- **ExpireObject ar soft delete**: Asset+ tar inte bort objekt permanent utan satter ett utgangsdatum. Objekten kan fortfarande dyka upp i fragor om man inte filtrerar pa `dateExpired`.
- **BIM-modellskyddade objekt**: Objekt som skapats via BIM-import (`createdInModel = true`) bor troligen inte kunna tas bort fran Lovable -- de hanterasav BIM-modellen.
- **Edge function timeout**: Batch-push av manga lokala objekt kan ta tid. Anvander samma resumable-monster som befintliga synk-funktioner (45s max per anrop).
- **AddObjectList kraver parentFmGuid**: Lokala objekt utan `in_room_fm_guid` kan inte pushas till Asset+. UI:t bor guida anvandaren att tilldela ett rum forst.

