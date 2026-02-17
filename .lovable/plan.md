
## Plan: CRUD-process for Geminus <-> Asset+

Fyra problem identifierade, med losningar for varje:

---

### Problem 1: Skapa inventerade objekt i Asset+ fungerar inte

**Orsak:** `asset-plus-create` edge function skickar `parentSpaceFmGuid` som `inRoomFmGuid` till Asset+ API. Men Asset+ API:t kraver `AddObject` med korrekt payload-format -- nuvarande implementation saknar `APIKey` i ratt position (det skickas som toppniva-nyckel men borde ligga inuti BimObject-strukturen) och `UsedIdentifier` saknas. Dessutom: om det inventerade objektet ar lokalt (`is_local=true`) och forst ska skapas i Asset+, behover FMGUID genereras korrekt.

**Losning:** Uppdatera `asset-plus-create` edge function sa att:
- `AddObject`-payloaden foljer samma struktur som fungerar i `acc-to-assetplus` (med `BimObject`-wrapper, `APIKey` inuti, `UsedIdentifier: 1`)
- `building_fm_guid` setts pa det lokalt sparade objektet (harleds fran rum-hierarkin)
- Bättre felmeddelanden loggas vid misslyckande

**Filandringar:**
- `supabase/functions/asset-plus-create/index.ts` -- Omstrukturera payload till AddObject sa att det matchar Asset+ API-schema (BimObject-wrapper med APIKey, UsedIdentifier). Anvand samma format som fungerar i `acc-to-assetplus`.

---

### Problem 2: Radera objekt -- BIM-skydd + UI-koppling

**Orsak:** Backend-funktionen `asset-plus-delete` finns redan och fungerar korrekt -- den skyddar BIM-objekt (`created_in_model=true`) och expirar synkade objekt i Asset+. Men RLS-policyn pa `assets`-tabellen tillater bara DELETE for `is_local = true`. Edge function anvander service role key sa den gar forbi RLS, sa detta borde fungera redan.

**Problem i UI:** Delete-knappen i `UniversalPropertiesDialog` finns, men det ar oklart om den visas for alla objekt och om BIM-skyddet kommuniceras tydligt. Behover sakerstalla att:
- Delete-knappen visas for alla inventerade/lokala objekt
- Delete-knappen ar **dold eller disabled** for objekt med `created_in_model = true`
- Tydligt felmeddelande om man forsoker radera ett BIM-objekt
- Synkade objekt (is_local=false) visas med varning att de ocksa expirar i Asset+

**Filandringar:**
- `src/components/common/UniversalPropertiesDialog.tsx` -- Forbattra delete-sektionen: visa/dold baserat pa `created_in_model`, lagg till tydlig varning for synkade objekt, oversatt till svenska.

---

### Problem 3: "Synka ACC -> Asset+" knappen fungerar inte

**Orsak:** `acc-to-assetplus` edge function saknar `verifyAuth` -- den anvander inte auth-kontroll alls (importerar `corsHeaders` fran `_shared/auth.ts` men anropar aldrig `verifyAuth`). Aven `config.toml` har `verify_jwt = false`. Sa autentisering borde inte vara problemet.

Det verkliga problemet ar troligast att:
1. Klientkoden inte anropar funktionen korrekt (behover verifiera hur UI-knappen anropar)
2. Complex-skapandet misslyckas (det skapar en generisk "ACC Import" complex istallet for byggnadsnamnet)
3. Payload-formatet for `AddObjectList` matchar inte Asset+ API:s forvantade schema

**Losning:** 
- Verifiera och fixa API-anropet fran UI-knappen i `ApiSettingsModal.tsx`
- Lagg till auth-kontroll i edge function (verifyAuth) for sakerhet
- Forbattra felhantering och loggning

**Filandringar:**
- `supabase/functions/acc-to-assetplus/index.ts` -- Lagg till `verifyAuth`, forbattra AddObjectList payload-format
- `src/components/settings/ApiSettingsModal.tsx` -- Verifiera att synk-knappen anropar funktionen korrekt

---

### Problem 4: ACC-byggnader ska fa en Complex (Fastighet) med eget FMGUID

**Orsak:** Nuvarande logik i `acc-to-assetplus` skapar EN gemensam Complex kallad "ACC Import" for alla byggnader. Enligt krav ska varje byggnad ha sin egen Complex med samma namn som byggnaden.

**Losning:** Andrar synk-logiken sa att:
1. For varje ACC-byggnad: skapa en Complex (ObjectType 0) med samma namn som byggnaden
2. Anvand den byggnadens Complex som parent for Building-objektet
3. Spara Complex FMGUID i GUID-mappningen

**Filandringar:**
- `supabase/functions/acc-to-assetplus/index.ts` -- I `syncBuildingToAssetPlus`: skapa en Complex per byggnad istallet for att anvanda en delad Complex. Namnge Complex med byggnadens namn. Uppdatera `handleSync` sa den inte langre skapar en global "ACC Import"-complex.

---

### Tekniska detaljer

**Asset+ AddObject korrekt format (baserat pa fungerande kod i acc-to-assetplus):**
```typescript
// Korrekt format:
{
  BimObjectWithParents: [{
    BimObject: {
      ObjectType: 4,
      Designation: "Asset-001",
      CommonName: "Fire Extinguisher",
      APIKey: apiKey,
      FmGuid: "uuid-here",
      UsedIdentifier: 1,
    },
    ParentFmGuid: "parent-room-guid",
    UsedIdentifier: 1,
  }]
}

// Nuvarande (felaktigt) format i asset-plus-create:
{
  apiKey: "...",
  objectType: 4,
  designation: "...",
  inRoomFmGuid: "...",
}
```

**Complex per byggnad (ny logik):**
```typescript
// For varje byggnad:
const complexGuid = await getOrCreateGuid(supabase, `complex-${buildingFmGuid}`, ObjectType.Complex);
await addObjectList([{
  objectType: ObjectType.Complex,
  fmGuid: complexGuid,
  designation: buildingName,
  commonName: buildingName,
}], accessToken, apiKey);
// Sedan skapa Building med complexGuid som parent
```

**Delete-skydd i UI:**
```typescript
// Visa/dolj delete-knappen
const canDelete = !syncStatus?.hasBimCreated;
// Varningstext for synkade objekt
const deleteWarning = syncStatus?.allSynced 
  ? "Objektet kommer aven att tas bort (expieras) i Asset+"
  : null;
```

### Sammanfattning av filandringar

| Fil | Andring |
|-----|---------|
| `supabase/functions/asset-plus-create/index.ts` | Fixa AddObject payload-format (BimObject-wrapper) |
| `supabase/functions/acc-to-assetplus/index.ts` | Lagg till auth, skapa Complex per byggnad, fixa payload |
| `src/components/common/UniversalPropertiesDialog.tsx` | BIM-skydd for delete, varning for synkade objekt |
| `src/components/settings/ApiSettingsModal.tsx` | Verifiera synk-knappens funktionalitet |
