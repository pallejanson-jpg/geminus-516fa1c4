
## Rotorsak: Korrupta cacheposter blockerar 3D-laddning för Akerselva Atrium

### Vad loggarna visar

Felet `[xeokit plugin XKTLoader]: Unsupported .XKT file version: 1769153147` visas för Akerselva Atrium (byggnad `9baa7a3a`). Det decimala värdet `1769153147` är `0x696F6E3B` i hex — vilket är ASCII-tecknen `ion;` — alltså början av ett **HTML- eller JSON-felsvar**, inte ett riktigt XKT-filhuvud.

### Databaskonfirmation

Akerselva Atrium har 3 poster i `xkt_models`:

| Model ID | Filstorlek | Status |
|---|---|---|
| `0e687ea4` | 9,2 MB | Troligen giltig |
| `bc185635` | **457 bytes** | KORRUPT (för liten) |
| `xkt_models` | **310 bytes** | KORRUPT (för liten) |

En riktig XKT-fil är åtminstone några hundra kilobyte. 457 och 310 bytes är definitivt ett HTML-felsvar som cachats av misstag — troligen ett "404 Not Found" eller "403 Forbidden" från Asset+ API som sparades som XKT-data.

### Flödet som orsakar problemet

```text
1. Viewer begär modell bc185635 → Asset+ API returnerar 403/404 (HTML-fel)
2. Fetch-interceptorn (row 2875): if (data.byteLength > 100) → 457 > 100 → TRUE
3. Felsvaret sparas till backend storage som .xkt-fil
4. Vid nästa laddning: memory hit eller database hit → returnerar HTML-felsvaret
5. Xeokit-parsern läser "ion;" i header → "Unsupported XKT version: 1769153147"
6. Modellen laddas inte → ingen 3D visas
```

Centralstationen fungerar för att dess enda egentliga modell (`494de6e6`, 14,7 MB) är giltig och inte träffar den korrupta cache-posten. Akerselva Atrium träffar alltid en korrupt post först.

### Fix: Tre delar

#### Del 1 — Rensa de korrupta databasposterna (migration)

Radera alla `xkt_models`-poster med `file_size < 50000` (50 KB) för Akerselva Atrium, och även den felaktiga `model_id = 'xkt_models'` som är ett generiskt alias, inte ett riktigt modell-ID:

```sql
DELETE FROM xkt_models 
WHERE building_fm_guid = '9baa7a3a-717d-4fcb-8718-0f5ca618b28a'
AND (file_size < 50000 OR model_id = 'xkt_models');
```

Mer generellt, rensa alla byggnader med suspekt litet filstorlek:
```sql
DELETE FROM xkt_models WHERE file_size < 50000;
```

#### Del 2 — Förbättra valideringen i fetch-interceptorn

I `AssetPlusViewer.tsx` rad 2875 är valideringen:
```typescript
if (data.byteLength > 100) {  // ← FEL: 457 bytes passerar detta!
```

Höj gränsen avsevärt och lägg till en XKT magic-byte check:

```typescript
// Validate actual XKT binary signature before caching
// Real XKT files start with the byte 0x78 ('x') or specific version headers
// Minimum realistic XKT model is at least 50KB
const MIN_VALID_XKT_BYTES = 50_000; // 50 KB minimum

if (data.byteLength >= MIN_VALID_XKT_BYTES) {
  // Extra: check that it's not an HTML error response
  const header = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  const firstChar = String.fromCharCode(header[0]);
  const isHtmlResponse = firstChar === '<' || firstChar === '{' || firstChar === 'E';
  
  if (!isHtmlResponse) {
    storeModelInMemory(modelId, resolvedBuildingGuid, data);
    xktCacheService.saveModelFromViewer(...);
  } else {
    console.warn(`XKT cache: Rejected ${modelId} — looks like HTML/JSON error response`);
  }
}
```

#### Del 3 — Rensa minneskaachen vid uppstart för Akerselva Atrium

Loggen visar `XKT cache: Memory hit for bc185635-9507-41b6-93d4-a7d484acc0fd` — det korrupta felet finns redan i minnescachen (15,4 MB totalt, 4 modeller). Preloaden laddade upp de korrupta posterna i minnet vid start.

Lösning: När en cachad modell returnerar "Unsupported XKT version" från xeokit, ska interceptorn invalidera den minnescachen. Men xeokit ger oss inget callback på detta.

Alternativ lösning: I `useXktPreload.ts`, lägg till filstorleksvalidering innan modeller laddas in i minnescachen:

```typescript
const fetchModel = async (model) => {
  // Skip models that are suspiciously small — likely corrupt cache entries
  if ((model.file_size || 0) < 50_000) {
    console.warn(`XKT Preload: Skipping ${model.model_id} — file_size ${model.file_size} too small (likely corrupt)`);
    return;
  }
  // ... rest of fetch logic
};
```

### Sammanfattning av ändringar

| Fil | Ändring |
|---|---|
| **Databas (migration)** | Radera korrupta poster med `file_size < 50000` |
| **`src/components/viewer/AssetPlusViewer.tsx`** | Höj valideringsgränsen från 100 till 50 000 bytes + kolla att svaret inte är HTML |
| **`src/hooks/useXktPreload.ts`** | Skippa modeller med `file_size < 50000` i preload-loopen |

Inga nya tabeller, inga edge functions, inga auth-ändringar.
