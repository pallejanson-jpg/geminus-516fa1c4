

## Problem

NativeXeokitViewer laddar **alla** XKT-modeller utan filtrering. Det finns ingen A-modell-whitelist som det arkitekturbeslut vi tagit kräver (bara modeller som börjar på "A" eller "ARK" ska laddas initialt). Det förklarar varför Brand-modeller laddas och varför prestandan inte förbättrats.

Rad 103-107 hämtar alla modeller från `xkt_models`-tabellen och rad 170-250 laddar samtliga utan filter.

## Plan

### 1. Lägg till A-modell-filtrering i NativeXeokitViewer
**Fil:** `src/components/viewer/NativeXeokitViewer.tsx`

Efter att modellerna hämtats (rad ~167), filtrera listan:
- Behåll bara modeller vars `model_id` eller `model_name` börjar med `A-`, `A_`, `ARK`, eller är ett UUID (som typiskt är en arkitekturmodell)
- Om filtret resulterar i 0 modeller, fallback till att ladda alla (recovery)
- Logga tydligt vilka modeller som filtreras bort och varför

Filtreringslogik (återanvänd befintlig policy):
```typescript
const isArchitectural = (id: string, name: string | null) => {
  const n = (name || id).toUpperCase();
  return n.startsWith('A-') || n.startsWith('A_') || n.startsWith('ARK') 
    || /^[0-9A-F]{8}-/i.test(id); // UUID = likely main model
};
const archModels = models.filter(m => isArchitectural(m.model_id, m.model_name));
const loadList = archModels.length > 0 ? archModels : models; // fallback
```

Logga filtrerade modeller:
```
[NativeViewer] A-filter: Loading 3/8 models, skipped: Brand_P1, V_P1, ...
```

### 2. Inga andra filändringar behövs

Filtrering är den enda saknade pusselbiten — SDK, viewer-skapande, memory cache och concurrency fungerar redan korrekt.

### Fil att ändra
- `src/components/viewer/NativeXeokitViewer.tsx` — lägg till A-modell-filter efter databasquery

