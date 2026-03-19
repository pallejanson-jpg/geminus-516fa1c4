

## Plan: Auto-fallback till metadata-only för stora IFC-filer

### Ändring

**Fil:** `supabase/functions/ifc-extract-systems/index.ts`

I det "standard mode"-blocket (rad 522-572), efter att filen laddats ner och storleken beräknats (rad 538-539), lägg till en storlekskontroll:

- Om `fileSizeMB > 10` → logga att filen är för stor för WASM, ladda metadata från `_metadata.json` istället (samma logik som `metadata-only` mode)
- Hoppa över WASM-import, IFC-parsning och XKT-modellering helt
- Om ingen cached metadata finns → returnera ett tydligt felmeddelande istället för att krascha

```text
Befintligt flöde (rad 522-572):
  download IFC → WASM → parse → crash (om >10MB)

Nytt flöde:
  download IFC → check size → if >10MB: load _metadata.json → continue
                             → else: WASM → parse → continue
```

### Filändringar

| Fil | Ändring |
|-----|---------|
| `supabase/functions/ifc-extract-systems/index.ts` | Lägg till size-guard efter rad 539 som faller tillbaka till cached metadata för filer >10MB |

