

# Plan: Tre prestandaoptimeringar + AI highlight-fix + FastNav-fix

## Sammanfattning
Tre ändringar i två filer för att snabba upp viewern och fixa buggar.

---

## 1. FastNav default → false

**Fil:** `src/components/viewer/NativeXeokitViewer.tsx` rad 348

Ändra `if (stored === null) return true;` till `return false;` så att FastNav respekterar inställningen (som defaultar till false i VoiceSettings).

---

## 2. AI "Visa i viewer" — colorize istället för highlight

**Fil:** `src/hooks/useAiViewerBridge.ts`

Problemet: `highlightEntities` använder `setObjectsHighlighted` som bara ger subtil outline — ser ut som xray utan infärgning.

Fix i `highlightEntities`-funktionen:
- Behåll xray-logiken (ghost allt, un-xray valda)
- Ersätt `setObjectsHighlighted(entityIds, true)` med `setObjectsColorized(entityIds, [1, 0.5, 0])` (orange)
- Lägg till fuzzy ID-matching: testa entity IDs mot scenen med lowercase + `.xkt`-prefix-stripping så att IDs från `geometry_entity_map` matchar viewerns interna format

---

## 3. Prestandaoptimering i NativeXeokitViewer

**Fil:** `src/components/viewer/NativeXeokitViewer.tsx`

### 3a. Skippa storage.list() om DB har modeller
Rad 189-191: `storagePromise` körs alltid men används bara som fallback om DB är tom. Ändra till att bara köra om DB-resultatet är tomt (sekventiell fallback istället för parallell).

**Approach:** Starta `storagePromise` parallellt men som en lazy promise — flytta den innanför `if (models.length === 0)`-blocket. Alternativt: behåll parallell men skippa processing om DB har data (redan delvis gjort men listningen kostar ~500ms).

Enklaste optimering: Gör `storagePromise` conditional — kör den bara om `dbResult` ger 0 modeller. Detta kräver att vi kör DB-query först, sedan storage vid behov.

### 3b. reuseGeometries: true
Rad 368: Ändra `reuseGeometries: false` till `reuseGeometries: true`. xeokit kan då instansiera identisk geometri och minska minnesfotavtrycket.

### 3c. Skippa asset-plus-sync om DB har modeller
Rad 454-482: Bootstrap-blocket med `asset-plus-sync` körs bara om `models.length === 0`, vilket redan är korrekt. Ingen ändring behövs här — det är redan optimerat.

---

## Teknisk sammanfattning

| Fil | Ändring |
|---|---|
| `NativeXeokitViewer.tsx` | FastNav default false; conditional storage.list(); reuseGeometries: true |
| `useAiViewerBridge.ts` | Colorize med orange istf highlight; fuzzy ID-matching |

**Uppskattad effekt:**
- FastNav: respekterar inställning korrekt
- Highlight: tydlig orange infärgning i viewer vid "Visa i viewer"
- Prestanda: ~300-500ms snabbare init (skippad storage.list()), potentiellt bättre minnesanvändning med reuseGeometries

